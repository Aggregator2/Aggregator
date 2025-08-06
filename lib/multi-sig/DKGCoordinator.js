const { ethers } = require('ethers');
const DistributedKeyGeneration = require('./DistributedKeyGeneration');
const EventEmitter = require('events');

/**
 * DKG Coordinator - Manages the distributed key generation protocol
 * Handles communication between participants and protocol phases
 */
class DKGCoordinator extends EventEmitter {
    constructor(communicationLayer) {
        super();
        this.dkg = new DistributedKeyGeneration();
        this.comm = communicationLayer; // Abstract communication layer
        this.sessions = new Map();
        
        // Protocol timeouts (in milliseconds)
        this.timeouts = {
            commitment: 30000,      // 30 seconds for commitment phase
            distribution: 30000,    // 30 seconds for share distribution
            complaint: 60000,       // 60 seconds for complaint phase
            total: 300000          // 5 minutes total timeout
        };
        
        this.setupMessageHandlers();
    }
    
    /**
     * Start a new DKG session as coordinator
     */
    async startSession(sessionConfig) {
        const { threshold, participants, sessionId = this.generateSessionId() } = sessionConfig;
        
        // Validate inputs
        if (threshold < 2) {
            throw new Error('Threshold must be at least 2');
        }
        
        if (participants.length < threshold) {
            throw new Error('Not enough participants for threshold');
        }
        
        // Find node's index in participant list
        const nodeAddress = await this.comm.getNodeAddress();
        const nodeIndex = participants.indexOf(nodeAddress);
        
        if (nodeIndex === -1) {
            throw new Error('Node not in participant list');
        }
        
        // Initialize session
        const session = this.dkg.initializeSession(
            sessionId,
            threshold,
            participants,
            nodeIndex
        );
        
        // Store session
        this.sessions.set(sessionId, {
            session,
            receivedCommitments: new Map(),
            receivedShares: new Map(),
            receivedComplaints: new Map(),
            timer: null
        });
        
        // Start protocol
        this.executeProtocol(sessionId);
        
        return sessionId;
    }
    
    /**
     * Join an existing DKG session
     */
    async joinSession(sessionId, sessionConfig) {
        const { threshold, participants } = sessionConfig;
        
        // Find node's index
        const nodeAddress = await this.comm.getNodeAddress();
        const nodeIndex = participants.indexOf(nodeAddress);
        
        if (nodeIndex === -1) {
            throw new Error('Node not in participant list');
        }
        
        // Initialize session
        const session = this.dkg.initializeSession(
            sessionId,
            threshold,
            participants,
            nodeIndex
        );
        
        // Store session
        this.sessions.set(sessionId, {
            session,
            receivedCommitments: new Map(),
            receivedShares: new Map(),
            receivedComplaints: new Map(),
            timer: null
        });
        
        // Execute protocol
        this.executeProtocol(sessionId);
        
        return sessionId;
    }
    
    /**
     * Execute DKG protocol phases
     */
    async executeProtocol(sessionId) {
        const sessionData = this.sessions.get(sessionId);
        if (!sessionData) {
            throw new Error('Session not found');
        }
        
        try {
            // Phase 1: Generate secret
            this.dkg.generateSecret(sessionData.session);
            
            // Phase 2: Create and broadcast commitments
            const commitmentData = this.dkg.createCommitments(sessionData.session);
            await this.broadcastMessage(sessionId, 'commitment', commitmentData);
            
            // Wait for all commitments
            await this.waitForPhase(sessionId, 'commitment', this.timeouts.commitment);
            
            // Phase 3: Calculate and send shares
            const shares = this.dkg.calculateShares(sessionData.session);
            
            // Send shares privately to each participant
            for (const [participant, share] of Object.entries(shares)) {
                if (participant !== sessionData.session.participants[sessionData.session.nodeIndex]) {
                    await this.sendPrivateMessage(sessionId, participant, 'share', {
                        from: sessionData.session.nodeIndex,
                        share
                    });
                }
            }
            
            // Wait for all shares
            await this.waitForPhase(sessionId, 'share', this.timeouts.distribution);
            
            // Phase 4: Verify shares and submit complaints
            const complaints = this.verifyReceivedShares(sessionId);
            if (complaints.length > 0) {
                await this.broadcastMessage(sessionId, 'complaint', complaints);
            }
            
            // Wait for complaint phase
            await this.waitForPhase(sessionId, 'complaint', this.timeouts.complaint);
            
            // Phase 5: Process complaints
            const allComplaints = Array.from(sessionData.receivedComplaints.values()).flat();
            this.dkg.processComplaints(sessionData.session, allComplaints);
            
            // Phase 6: Generate distributed key
            const keyMaterial = this.dkg.generateDistributedKey(
                sessionData.session,
                Object.fromEntries(sessionData.receivedShares),
                Object.fromEntries(sessionData.receivedCommitments)
            );
            
            // Emit completion event
            this.emit('sessionCompleted', {
                sessionId,
                keyMaterial
            });
            
            // Store key material
            await this.storeKeyMaterial(sessionId, keyMaterial);
            
            return keyMaterial;
            
        } catch (error) {
            this.emit('sessionFailed', {
                sessionId,
                error: error.message
            });
            throw error;
        } finally {
            // Cleanup
            this.cleanupSession(sessionId);
        }
    }
    
    /**
     * Verify all received shares
     */
    verifyReceivedShares(sessionId) {
        const sessionData = this.sessions.get(sessionId);
        const complaints = [];
        
        sessionData.receivedShares.forEach((shareData, sender) => {
            const commitments = sessionData.receivedCommitments.get(sender);
            
            if (!commitments) {
                complaints.push({
                    accuser: sessionData.session.nodeIndex,
                    accused: sender,
                    reason: 'missing_commitments'
                });
                return;
            }
            
            if (!this.dkg.verifyShare(shareData.share, sessionData.session.nodeIndex, commitments)) {
                complaints.push({
                    accuser: sessionData.session.nodeIndex,
                    accused: sender,
                    share: shareData.share,
                    proof: commitments
                });
            }
        });
        
        return complaints;
    }
    
    /**
     * Wait for protocol phase completion
     */
    async waitForPhase(sessionId, phase, timeout) {
        return new Promise((resolve, reject) => {
            const sessionData = this.sessions.get(sessionId);
            const startTime = Date.now();
            
            const checkInterval = setInterval(() => {
                let received = 0;
                const expected = sessionData.session.participants.length;
                
                switch (phase) {
                    case 'commitment':
                        received = sessionData.receivedCommitments.size + 1; // +1 for self
                        break;
                    case 'share':
                        received = sessionData.receivedShares.size + 1;
                        break;
                    case 'complaint':
                        // Complaint phase has fixed timeout
                        if (Date.now() - startTime >= timeout) {
                            clearInterval(checkInterval);
                            resolve();
                            return;
                        }
                        break;
                }
                
                if (received >= expected) {
                    clearInterval(checkInterval);
                    resolve();
                } else if (Date.now() - startTime >= timeout) {
                    clearInterval(checkInterval);
                    reject(new Error(`Timeout waiting for ${phase} phase`));
                }
            }, 1000);
        });
    }
    
    /**
     * Message handlers
     */
    setupMessageHandlers() {
        this.comm.on('dkg:commitment', (data) => {
            const sessionData = this.sessions.get(data.sessionId);
            if (sessionData && data.nodeIndex !== sessionData.session.nodeIndex) {
                sessionData.receivedCommitments.set(data.nodeIndex, data.commitments);
                this.emit('commitmentReceived', data);
            }
        });
        
        this.comm.on('dkg:share', (data) => {
            const sessionData = this.sessions.get(data.sessionId);
            if (sessionData) {
                sessionData.receivedShares.set(data.from, data);
                this.emit('shareReceived', data);
            }
        });
        
        this.comm.on('dkg:complaint', (data) => {
            const sessionData = this.sessions.get(data.sessionId);
            if (sessionData) {
                sessionData.receivedComplaints.set(data.nodeIndex, data.complaints);
                this.emit('complaintReceived', data);
            }
        });
    }
    
    /**
     * Communication helpers
     */
    async broadcastMessage(sessionId, type, data) {
        const sessionData = this.sessions.get(sessionId);
        await this.comm.broadcast(`dkg:${type}`, {
            sessionId,
            nodeIndex: sessionData.session.nodeIndex,
            ...data
        });
    }
    
    async sendPrivateMessage(sessionId, recipient, type, data) {
        await this.comm.sendPrivate(recipient, `dkg:${type}`, {
            sessionId,
            ...data
        });
    }
    
    /**
     * Generate unique session ID
     */
    generateSessionId() {
        return ethers.utils.id(Date.now().toString() + Math.random().toString());
    }
    
    /**
     * Store key material securely
     */
    async storeKeyMaterial(sessionId, keyMaterial) {
        // This should integrate with secure key storage
        // For now, emit event for external storage
        this.emit('storeKeyMaterial', {
            sessionId,
            keyMaterial
        });
    }
    
    /**
     * Cleanup session data
     */
    cleanupSession(sessionId) {
        const sessionData = this.sessions.get(sessionId);
        if (sessionData && sessionData.timer) {
            clearTimeout(sessionData.timer);
        }
        this.sessions.delete(sessionId);
    }
    
    /**
     * Create threshold signature
     */
    async createThresholdSignature(message, sessionId) {
        const keyMaterial = await this.loadKeyMaterial(sessionId);
        if (!keyMaterial) {
            throw new Error('Key material not found');
        }
        
        return this.dkg.createSignatureShare(
            message,
            keyMaterial.secretKeyShare,
            sessionId
        );
    }
    
    /**
     * Combine signature shares
     */
    combineSignatures(signatureShares, participantIndices) {
        return this.dkg.combineSignatures(signatureShares, participantIndices);
    }
    
    /**
     * Load key material from storage
     */
    async loadKeyMaterial(sessionId) {
        // This should integrate with secure key storage
        // For now, return from memory if available
        const sessionData = this.sessions.get(sessionId);
        if (sessionData && sessionData.session.phase === 'completed') {
            return this.dkg.exportKeyMaterial(sessionData.session);
        }
        
        // Emit event for external storage
        return new Promise((resolve) => {
            this.emit('loadKeyMaterial', { sessionId }, (keyMaterial) => {
                resolve(keyMaterial);
            });
        });
    }
}

module.exports = DKGCoordinator;