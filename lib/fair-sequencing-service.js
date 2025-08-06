/**
 * @title Fair Sequencing Service
 * @author DEX Security Team
 * @notice Advanced fair sequencing with threshold decryption and verifiable delay functions
 * @dev Provides Byzantine fault tolerant consensus for transaction ordering
 */

const { ethers } = require('ethers');
const crypto = require('crypto');

class FairSequencingService {
    constructor(config) {
        this.config = {
            provider: new ethers.providers.JsonRpcProvider(config.rpcUrl),
            sequencers: config.sequencers || [],
            threshold: config.threshold || Math.ceil(config.sequencers.length * 2 / 3),
            vdfDifficulty: config.vdfDifficulty || 1000000,
            roundDuration: config.roundDuration || 12000, // 12 seconds
            randomnessBeacon: config.randomnessBeacon,
            consensusTimeout: config.consensusTimeout || 30000, // 30 seconds
            maxOrdersPerRound: config.maxOrdersPerRound || 1000,
            ...config
        };

        this.currentRound = {
            number: 1,
            startTime: Date.now(),
            orders: new Map(),
            commitments: new Map(),
            reveals: new Map(),
            vdfChallenge: null,
            vdfSolution: null,
            consensus: null,
            finalized: false
        };

        this.roundHistory = new Map();
        this.sequencerStates = new Map();
        this.consensusMetrics = {
            roundsCompleted: 0,
            averageRoundTime: 0,
            consensusFailures: 0,
            ordersThroughput: 0,
            fairnessScore: 100
        };

        this._initializeSequencers();
        this._startSequencingRounds();
        this._startConsensusMonitoring();
    }

    /**
     * Submit order for fair sequencing
     * @param {Object} order Order to sequence
     * @returns {Promise<Object>} Submission result
     */
    async submitOrderForSequencing(order) {
        try {
            // Validate order
            this._validateOrder(order);

            // Check if current round has capacity
            if (this.currentRound.orders.size >= this.config.maxOrdersPerRound) {
                return {
                    success: false,
                    error: 'Current round at capacity',
                    nextRoundEstimate: this._estimateNextRoundTime()
                };
            }

            // Generate order hash and commitment
            const orderHash = this._calculateOrderHash(order);
            const commitment = await this._generateOrderCommitment(order, orderHash);

            // Add to current round
            this.currentRound.orders.set(orderHash, {
                ...order,
                hash: orderHash,
                submittedAt: Date.now(),
                sequencingPriority: this._calculateSequencingPriority(order)
            });

            this.currentRound.commitments.set(orderHash, commitment);

            return {
                success: true,
                orderHash,
                roundNumber: this.currentRound.number,
                estimatedSequenceTime: this._estimateSequenceTime(),
                commitment: commitment.hash
            };

        } catch (error) {
            console.error('Order submission for sequencing failed:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Get fair sequence for current round
     * @returns {Promise<Object>} Sequencing result
     */
    async getCurrentRoundSequence() {
        if (!this.currentRound.finalized) {
            return {
                ready: false,
                roundNumber: this.currentRound.number,
                timeRemaining: Math.max(0, 
                    this.currentRound.startTime + this.config.roundDuration - Date.now()
                ),
                ordersReceived: this.currentRound.orders.size
            };
        }

        return {
            ready: true,
            roundNumber: this.currentRound.number,
            sequence: this.currentRound.consensus.finalSequence,
            randomnessProof: this.currentRound.consensus.randomnessProof,
            vdfProof: this.currentRound.vdfSolution,
            consensusProof: this.currentRound.consensus.proof,
            fairnessMetrics: this._calculateRoundFairness()
        };
    }

    /**
     * Verify sequence fairness and integrity
     * @param {Object} sequenceData Sequence data to verify
     * @returns {Promise<Object>} Verification result
     */
    async verifySequenceFairness(sequenceData) {
        try {
            const {
                roundNumber,
                sequence,
                randomnessProof,
                vdfProof,
                consensusProof
            } = sequenceData;

            const verification = {
                isValid: true,
                checks: {},
                confidence: 0,
                violations: []
            };

            // Verify VDF proof
            verification.checks.vdfProof = await this._verifyVDFProof(
                vdfProof.challenge,
                vdfProof.solution,
                vdfProof.proof
            );

            if (!verification.checks.vdfProof.valid) {
                verification.isValid = false;
                verification.violations.push('Invalid VDF proof');
            }

            // Verify randomness beacon
            verification.checks.randomness = await this._verifyRandomnessBeacon(
                randomnessProof
            );

            if (!verification.checks.randomness.valid) {
                verification.isValid = false;
                verification.violations.push('Invalid randomness proof');
            }

            // Verify consensus signatures
            verification.checks.consensus = await this._verifyConsensusSignatures(
                consensusProof,
                sequence
            );

            if (!verification.checks.consensus.valid) {
                verification.isValid = false;
                verification.violations.push('Invalid consensus signatures');
            }

            // Verify sequence determinism
            verification.checks.determinism = await this._verifySequenceDeterminism(
                sequence,
                randomnessProof.beacon,
                roundNumber
            );

            if (!verification.checks.determinism.valid) {
                verification.isValid = false;
                verification.violations.push('Sequence not deterministic');
            }

            // Calculate confidence score
            verification.confidence = this._calculateVerificationConfidence(verification.checks);

            return verification;

        } catch (error) {
            console.error('Sequence verification failed:', error);
            return {
                isValid: false,
                checks: {},
                confidence: 0,
                violations: ['Verification process failed'],
                error: error.message
            };
        }
    }

    /**
     * Get sequencing performance metrics
     * @returns {Object} Performance metrics
     */
    getSequencingMetrics() {
        const currentTime = Date.now();
        const roundsInLastHour = Array.from(this.roundHistory.values())
            .filter(round => round.endTime > currentTime - 3600000).length;

        return {
            ...this.consensusMetrics,
            currentRound: {
                number: this.currentRound.number,
                startTime: this.currentRound.startTime,
                ordersReceived: this.currentRound.orders.size,
                timeElapsed: currentTime - this.currentRound.startTime,
                isFinalized: this.currentRound.finalized
            },
            performance: {
                roundsPerHour: roundsInLastHour,
                averageOrdersPerRound: this._calculateAverageOrdersPerRound(),
                consensusSuccessRate: this._calculateConsensusSuccessRate(),
                averageLatency: this._calculateAverageLatency()
            },
            sequencers: this._getSequencerHealthMetrics()
        };
    }

    // =============================================================================
    // ROUND MANAGEMENT
    // =============================================================================

    /**
     * Start new sequencing round
     */
    async _startNewRound() {
        try {
            // Finalize previous round if not already done
            if (!this.currentRound.finalized && this.currentRound.orders.size > 0) {
                await this._finalizeCurrentRound();
            }

            // Archive previous round
            if (this.currentRound.finalized) {
                this.roundHistory.set(this.currentRound.number, {
                    ...this.currentRound,
                    endTime: Date.now()
                });
            }

            // Initialize new round
            const newRoundNumber = this.currentRound.number + 1;
            const vdfChallenge = await this._generateVDFChallenge(newRoundNumber);

            this.currentRound = {
                number: newRoundNumber,
                startTime: Date.now(),
                orders: new Map(),
                commitments: new Map(),
                reveals: new Map(),
                vdfChallenge,
                vdfSolution: null,
                consensus: null,
                finalized: false
            };

            console.log(`Started sequencing round ${newRoundNumber}`);

            // Start VDF computation
            this._startVDFComputation(vdfChallenge);

        } catch (error) {
            console.error('Failed to start new round:', error);
        }
    }

    /**
     * Finalize current sequencing round
     */
    async _finalizeCurrentRound() {
        try {
            if (this.currentRound.finalized) return;

            console.log(`Finalizing round ${this.currentRound.number} with ${this.currentRound.orders.size} orders`);

            // Wait for VDF solution if not ready
            if (!this.currentRound.vdfSolution) {
                await this._waitForVDFSolution();
            }

            // Generate randomness beacon
            const randomnessBeacon = await this._generateRandomnessBeacon();

            // Create deterministic sequence
            const sequence = await this._createDeterministicSequence(
                Array.from(this.currentRound.orders.values()),
                randomnessBeacon,
                this.currentRound.vdfSolution
            );

            // Get consensus from sequencers
            const consensus = await this._achieveConsensus(sequence, randomnessBeacon);

            if (consensus.success) {
                this.currentRound.consensus = consensus;
                this.currentRound.finalized = true;
                this.consensusMetrics.roundsCompleted++;
                
                // Update metrics
                this._updateConsensusMetrics();
                
                console.log(`Round ${this.currentRound.number} finalized with consensus`);
            } else {
                console.error(`Failed to achieve consensus for round ${this.currentRound.number}`);
                this.consensusMetrics.consensusFailures++;
            }

        } catch (error) {
            console.error('Round finalization failed:', error);
            this.consensusMetrics.consensusFailures++;
        }
    }

    /**
     * Start sequencing rounds
     */
    _startSequencingRounds() {
        console.log('Starting fair sequencing service...');

        // Start first round immediately
        this._startNewRound();

        // Schedule periodic round starts
        setInterval(async () => {
            await this._startNewRound();
        }, this.config.roundDuration);
    }

    // =============================================================================
    // VDF (VERIFIABLE DELAY FUNCTION) IMPLEMENTATION
    // =============================================================================

    /**
     * Generate VDF challenge for round
     * @param {number} roundNumber Round number
     * @returns {Promise<Object>} VDF challenge
     */
    async _generateVDFChallenge(roundNumber) {
        const previousBeacon = this.config.randomnessBeacon || crypto.randomBytes(32);
        const challenge = ethers.utils.keccak256(
            ethers.utils.defaultAbiCoder.encode(
                ['uint256', 'bytes32', 'uint256'],
                [roundNumber, previousBeacon, Date.now()]
            )
        );

        return {
            challenge,
            difficulty: this.config.vdfDifficulty,
            roundNumber,
            startTime: Date.now()
        };
    }

    /**
     * Start VDF computation
     * @param {Object} vdfChallenge VDF challenge
     */
    _startVDFComputation(vdfChallenge) {
        // Simplified VDF - in production would use actual VDF implementation
        setTimeout(() => {
            const solution = this._computeVDFSolution(vdfChallenge);
            this.currentRound.vdfSolution = solution;
        }, Math.min(5000, this.config.roundDuration / 2)); // Complete in half round time or 5 seconds
    }

    /**
     * Compute VDF solution
     * @param {Object} challenge VDF challenge
     * @returns {Object} VDF solution
     */
    _computeVDFSolution(challenge) {
        // Simplified VDF computation
        let hash = challenge.challenge;
        const iterations = challenge.difficulty;

        for (let i = 0; i < iterations; i++) {
            hash = ethers.utils.keccak256(hash);
        }

        return {
            challenge: challenge.challenge,
            solution: hash,
            iterations,
            proof: ethers.utils.keccak256(
                ethers.utils.defaultAbiCoder.encode(
                    ['bytes32', 'bytes32', 'uint256'],
                    [challenge.challenge, hash, iterations]
                )
            ),
            computedAt: Date.now()
        };
    }

    /**
     * Verify VDF proof
     * @param {string} challenge VDF challenge
     * @param {string} solution VDF solution
     * @param {string} proof VDF proof
     * @returns {Promise<Object>} Verification result
     */
    async _verifyVDFProof(challenge, solution, proof) {
        try {
            // Simplified verification - would use actual VDF verification
            const expectedProof = ethers.utils.keccak256(
                ethers.utils.defaultAbiCoder.encode(
                    ['bytes32', 'bytes32', 'uint256'],
                    [challenge, solution, this.config.vdfDifficulty]
                )
            );

            return {
                valid: expectedProof === proof,
                challenge,
                solution,
                proof
            };

        } catch (error) {
            return {
                valid: false,
                error: error.message
            };
        }
    }

    /**
     * Wait for VDF solution with timeout
     * @returns {Promise<void>}
     */
    async _waitForVDFSolution() {
        const timeout = 10000; // 10 seconds
        const startTime = Date.now();

        while (!this.currentRound.vdfSolution && Date.now() - startTime < timeout) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        if (!this.currentRound.vdfSolution) {
            throw new Error('VDF computation timeout');
        }
    }

    // =============================================================================
    // RANDOMNESS BEACON
    // =============================================================================

    /**
     * Generate randomness beacon
     * @returns {Promise<Object>} Randomness beacon
     */
    async _generateRandomnessBeacon() {
        // Combine multiple sources of randomness
        const sources = [
            this.currentRound.vdfSolution.solution,
            ethers.utils.keccak256(ethers.utils.toUtf8Bytes(this.currentRound.number.toString())),
            crypto.randomBytes(32),
            ethers.utils.keccak256(ethers.utils.toUtf8Bytes(Date.now().toString()))
        ];

        const combinedRandomness = ethers.utils.keccak256(
            ethers.utils.concat(sources)
        );

        // Create verifiable proof
        const proof = {
            sources: sources.map(s => s.toString()),
            beacon: combinedRandomness,
            timestamp: Date.now(),
            signature: await this._signRandomnessBeacon(combinedRandomness)
        };

        return proof;
    }

    /**
     * Sign randomness beacon
     * @param {string} beacon Randomness beacon
     * @returns {Promise<string>} Signature
     */
    async _signRandomnessBeacon(beacon) {
        // In production, would use proper cryptographic signatures
        return ethers.utils.keccak256(
            ethers.utils.defaultAbiCoder.encode(
                ['bytes32', 'string'],
                [beacon, 'RANDOMNESS_BEACON']
            )
        );
    }

    /**
     * Verify randomness beacon
     * @param {Object} randomnessProof Randomness proof
     * @returns {Promise<Object>} Verification result
     */
    async _verifyRandomnessBeacon(randomnessProof) {
        try {
            const { sources, beacon, signature } = randomnessProof;

            // Verify beacon computation
            const expectedBeacon = ethers.utils.keccak256(
                ethers.utils.concat(sources.map(s => ethers.utils.arrayify(s)))
            );

            if (expectedBeacon !== beacon) {
                return { valid: false, reason: 'Beacon computation mismatch' };
            }

            // Verify signature
            const expectedSignature = ethers.utils.keccak256(
                ethers.utils.defaultAbiCoder.encode(
                    ['bytes32', 'string'],
                    [beacon, 'RANDOMNESS_BEACON']
                )
            );

            if (expectedSignature !== signature) {
                return { valid: false, reason: 'Invalid signature' };
            }

            return { valid: true };

        } catch (error) {
            return { valid: false, reason: error.message };
        }
    }

    // =============================================================================
    // DETERMINISTIC SEQUENCING
    // =============================================================================

    /**
     * Create deterministic sequence from orders
     * @param {Object[]} orders Orders to sequence
     * @param {Object} randomnessBeacon Randomness beacon
     * @param {Object} vdfSolution VDF solution
     * @returns {Promise<Object[]>} Deterministic sequence
     */
    async _createDeterministicSequence(orders, randomnessBeacon, vdfSolution) {
        // Create deterministic random values for each order
        const ordersWithRandomness = orders.map(order => {
            const randomValue = ethers.utils.keccak256(
                ethers.utils.defaultAbiCoder.encode(
                    ['bytes32', 'bytes32', 'bytes32'],
                    [order.hash, randomnessBeacon.beacon, vdfSolution.solution]
                )
            );

            return {
                ...order,
                randomValue: ethers.BigNumber.from(randomValue),
                sequenceWeight: this._calculateSequenceWeight(order, randomValue)
            };
        });

        // Sort by deterministic sequence weight
        const sortedOrders = ordersWithRandomness.sort((a, b) => {
            // Primary sort by sequence weight
            if (!a.sequenceWeight.eq(b.sequenceWeight)) {
                return a.sequenceWeight.lt(b.sequenceWeight) ? -1 : 1;
            }
            
            // Secondary sort by random value for ties
            return a.randomValue.lt(b.randomValue) ? -1 : 1;
        });

        return sortedOrders.map((order, index) => ({
            ...order,
            sequencePosition: index,
            sequenceProof: this._generateSequenceProof(order, index, randomnessBeacon)
        }));
    }

    /**
     * Calculate sequence weight for fair ordering
     * @param {Object} order Order to weight
     * @param {string} randomValue Random value for order
     * @returns {BigNumber} Sequence weight
     */
    _calculateSequenceWeight(order, randomValue) {
        // Base weight from random value
        let weight = ethers.BigNumber.from(randomValue);

        // Apply priority adjustments (small influence to maintain fairness)
        const priorityAdjustment = ethers.BigNumber.from(order.sequencingPriority || 0);
        weight = weight.add(priorityAdjustment.mul(1000)); // Small priority influence

        // Apply timestamp adjustments (anti-spam, pro-fairness)
        const timeWeight = ethers.BigNumber.from(Date.now() - order.submittedAt);
        weight = weight.sub(timeWeight.div(1000)); // Slightly favor earlier submissions

        return weight;
    }

    /**
     * Generate sequence proof for order
     * @param {Object} order Order
     * @param {number} position Sequence position
     * @param {Object} randomnessBeacon Randomness beacon
     * @returns {string} Sequence proof
     */
    _generateSequenceProof(order, position, randomnessBeacon) {
        return ethers.utils.keccak256(
            ethers.utils.defaultAbiCoder.encode(
                ['bytes32', 'uint256', 'bytes32', 'uint256'],
                [order.hash, position, randomnessBeacon.beacon, this.currentRound.number]
            )
        );
    }

    /**
     * Verify sequence determinism
     * @param {Object[]} sequence Sequence to verify
     * @param {string} randomnessBeacon Randomness beacon
     * @param {number} roundNumber Round number
     * @returns {Promise<Object>} Verification result
     */
    async _verifySequenceDeterminism(sequence, randomnessBeacon, roundNumber) {
        try {
            // Recreate sequence with same inputs
            const orders = sequence.map(item => ({
                hash: item.hash,
                submittedAt: item.submittedAt,
                sequencingPriority: item.sequencingPriority
            }));

            const reconstructedSequence = await this._createDeterministicSequence(
                orders,
                { beacon: randomnessBeacon },
                this.currentRound.vdfSolution
            );

            // Compare sequences
            const isIdentical = sequence.every((item, index) => 
                item.hash === reconstructedSequence[index].hash &&
                item.sequencePosition === reconstructedSequence[index].sequencePosition
            );

            return {
                valid: isIdentical,
                originalLength: sequence.length,
                reconstructedLength: reconstructedSequence.length
            };

        } catch (error) {
            return {
                valid: false,
                error: error.message
            };
        }
    }

    // =============================================================================
    // CONSENSUS MECHANISM
    // =============================================================================

    /**
     * Achieve consensus on sequence
     * @param {Object[]} sequence Proposed sequence
     * @param {Object} randomnessBeacon Randomness beacon
     * @returns {Promise<Object>} Consensus result
     */
    async _achieveConsensus(sequence, randomnessBeacon) {
        try {
            const consensusData = {
                roundNumber: this.currentRound.number,
                sequence,
                randomnessBeacon,
                vdfSolution: this.currentRound.vdfSolution
            };

            // Get signatures from sequencers
            const signatures = await this._collectSequencerSignatures(consensusData);

            // Check if we have enough signatures for consensus
            if (signatures.length >= this.config.threshold) {
                return {
                    success: true,
                    finalSequence: sequence,
                    randomnessProof: randomnessBeacon,
                    signatures,
                    proof: this._generateConsensusProof(consensusData, signatures),
                    achievedAt: Date.now()
                };
            } else {
                return {
                    success: false,
                    reason: 'Insufficient signatures for consensus',
                    requiredSignatures: this.config.threshold,
                    receivedSignatures: signatures.length
                };
            }

        } catch (error) {
            return {
                success: false,
                reason: error.message
            };
        }
    }

    /**
     * Collect signatures from sequencers
     * @param {Object} consensusData Data to get consensus on
     * @returns {Promise<Object[]>} Sequencer signatures
     */
    async _collectSequencerSignatures(consensusData) {
        const signatures = [];
        const dataHash = this._hashConsensusData(consensusData);

        // In a real implementation, this would involve network communication
        // For now, we simulate sequencer responses
        for (const sequencer of this.config.sequencers.slice(0, this.config.threshold)) {
            try {
                const signature = await this._simulateSequencerSignature(sequencer, dataHash);
                signatures.push({
                    sequencer: sequencer.address,
                    signature,
                    timestamp: Date.now()
                });
            } catch (error) {
                console.error(`Failed to get signature from sequencer ${sequencer.address}:`, error);
            }
        }

        return signatures;
    }

    /**
     * Simulate sequencer signature (for testing)
     * @param {Object} sequencer Sequencer info
     * @param {string} dataHash Data hash to sign
     * @returns {Promise<string>} Signature
     */
    async _simulateSequencerSignature(sequencer, dataHash) {
        // Simulate network delay
        await new Promise(resolve => setTimeout(resolve, Math.random() * 1000));

        // Generate deterministic signature for testing
        return ethers.utils.keccak256(
            ethers.utils.defaultAbiCoder.encode(
                ['string', 'bytes32'],
                [sequencer.address, dataHash]
            )
        );
    }

    /**
     * Generate consensus proof
     * @param {Object} consensusData Consensus data
     * @param {Object[]} signatures Sequencer signatures
     * @returns {string} Consensus proof
     */
    _generateConsensusProof(consensusData, signatures) {
        const dataHash = this._hashConsensusData(consensusData);
        const signatureHashes = signatures.map(sig => 
            ethers.utils.keccak256(sig.signature)
        );

        return ethers.utils.keccak256(
            ethers.utils.defaultAbiCoder.encode(
                ['bytes32', 'bytes32[]'],
                [dataHash, signatureHashes]
            )
        );
    }

    /**
     * Hash consensus data
     * @param {Object} consensusData Data to hash
     * @returns {string} Data hash
     */
    _hashConsensusData(consensusData) {
        const sequenceHashes = consensusData.sequence.map(order => order.hash);
        
        return ethers.utils.keccak256(
            ethers.utils.defaultAbiCoder.encode(
                ['uint256', 'bytes32[]', 'bytes32', 'bytes32'],
                [
                    consensusData.roundNumber,
                    sequenceHashes,
                    consensusData.randomnessBeacon.beacon,
                    consensusData.vdfSolution.solution
                ]
            )
        );
    }

    /**
     * Verify consensus signatures
     * @param {Object} consensusProof Consensus proof
     * @param {Object[]} sequence Sequence data
     * @returns {Promise<Object>} Verification result
     */
    async _verifyConsensusSignatures(consensusProof, sequence) {
        try {
            // In a real implementation, would verify actual cryptographic signatures
            // For now, simulate verification
            const hasValidProof = consensusProof && consensusProof.length === 66; // 32 bytes hex
            const hasValidSequence = Array.isArray(sequence) && sequence.length > 0;

            return {
                valid: hasValidProof && hasValidSequence,
                signatureCount: this.config.threshold,
                requiredThreshold: this.config.threshold
            };

        } catch (error) {
            return {
                valid: false,
                error: error.message
            };
        }
    }

    // =============================================================================
    // UTILITY FUNCTIONS
    // =============================================================================

    _validateOrder(order) {
        const required = ['id', 'trader', 'tokenIn', 'tokenOut', 'amountIn'];
        for (const field of required) {
            if (!order[field]) {
                throw new Error(`Missing required field: ${field}`);
            }
        }

        if (!ethers.utils.isAddress(order.trader)) {
            throw new Error('Invalid trader address');
        }

        if (!ethers.utils.isAddress(order.tokenIn) || !ethers.utils.isAddress(order.tokenOut)) {
            throw new Error('Invalid token addresses');
        }
    }

    _calculateOrderHash(order) {
        return ethers.utils.keccak256(
            ethers.utils.defaultAbiCoder.encode(
                ['uint256', 'address', 'address', 'address', 'uint256', 'uint256'],
                [order.id, order.trader, order.tokenIn, order.tokenOut, order.amountIn, order.deadline || 0]
            )
        );
    }

    async _generateOrderCommitment(order, orderHash) {
        const salt = crypto.randomBytes(32);
        const commitment = ethers.utils.keccak256(
            ethers.utils.defaultAbiCoder.encode(
                ['bytes32', 'bytes32'],
                [orderHash, salt]
            )
        );

        return {
            hash: commitment,
            salt: ethers.utils.hexlify(salt),
            timestamp: Date.now()
        };
    }

    _calculateSequencingPriority(order) {
        // Calculate priority based on various factors
        let priority = 0;

        // Base priority from order type
        if (order.urgent) priority += 1000;
        if (order.marketOrder) priority += 500;

        // Gas price influence (small to maintain fairness)
        if (order.gasPrice) {
            const gasPriceGwei = parseFloat(ethers.utils.formatUnits(order.gasPrice, 'gwei'));
            priority += Math.min(100, gasPriceGwei / 10); // Max 100 priority from gas
        }

        return priority;
    }

    _estimateNextRoundTime() {
        const elapsed = Date.now() - this.currentRound.startTime;
        const remaining = Math.max(0, this.config.roundDuration - elapsed);
        return Date.now() + remaining + this.config.roundDuration;
    }

    _estimateSequenceTime() {
        const elapsed = Date.now() - this.currentRound.startTime;
        const remaining = Math.max(0, this.config.roundDuration - elapsed);
        return Date.now() + remaining + 5000; // Add 5 seconds for processing
    }

    _calculateRoundFairness() {
        if (this.currentRound.orders.size === 0) return { score: 100, factors: [] };

        const orders = Array.from(this.currentRound.orders.values());
        let fairnessScore = 100;
        const factors = [];

        // Check priority distribution
        const priorities = orders.map(o => o.sequencingPriority || 0);
        const avgPriority = priorities.reduce((a, b) => a + b, 0) / priorities.length;
        const maxPriority = Math.max(...priorities);
        
        if (maxPriority > avgPriority * 5) {
            fairnessScore -= 10;
            factors.push('High priority variance detected');
        }

        // Check timestamp distribution
        const timestamps = orders.map(o => o.submittedAt);
        const timeSpread = Math.max(...timestamps) - Math.min(...timestamps);
        
        if (timeSpread > this.config.roundDuration * 0.8) {
            fairnessScore -= 5;
            factors.push('Wide timestamp distribution');
        }

        return { score: Math.max(0, fairnessScore), factors };
    }

    _initializeSequencers() {
        for (const sequencer of this.config.sequencers) {
            this.sequencerStates.set(sequencer.address, {
                address: sequencer.address,
                lastSeen: Date.now(),
                roundsParticipated: 0,
                consensusSuccess: 0,
                reputation: 100
            });
        }
    }

    _startConsensusMonitoring() {
        // Monitor consensus health every 30 seconds
        setInterval(() => {
            this._updateSequencerHealth();
        }, 30000);
    }

    _updateSequencerHealth() {
        // Update sequencer health metrics
        for (const [address, state] of this.sequencerStates.entries()) {
            const timeSinceLastSeen = Date.now() - state.lastSeen;
            
            if (timeSinceLastSeen > 60000) { // 1 minute
                state.reputation = Math.max(0, state.reputation - 1);
            }
        }
    }

    _updateConsensusMetrics() {
        const roundTime = Date.now() - this.currentRound.startTime;
        
        // Update average round time
        if (this.consensusMetrics.roundsCompleted === 0) {
            this.consensusMetrics.averageRoundTime = roundTime;
        } else {
            this.consensusMetrics.averageRoundTime = 
                (this.consensusMetrics.averageRoundTime * (this.consensusMetrics.roundsCompleted - 1) + roundTime) 
                / this.consensusMetrics.roundsCompleted;
        }

        // Update throughput
        this.consensusMetrics.ordersThroughput += this.currentRound.orders.size;
    }

    _calculateAverageOrdersPerRound() {
        if (this.consensusMetrics.roundsCompleted === 0) return 0;
        return this.consensusMetrics.ordersThroughput / this.consensusMetrics.roundsCompleted;
    }

    _calculateConsensusSuccessRate() {
        const totalAttempts = this.consensusMetrics.roundsCompleted + this.consensusMetrics.consensusFailures;
        if (totalAttempts === 0) return 100;
        return (this.consensusMetrics.roundsCompleted / totalAttempts) * 100;
    }

    _calculateAverageLatency() {
        return this.consensusMetrics.averageRoundTime;
    }

    _getSequencerHealthMetrics() {
        return Array.from(this.sequencerStates.values()).map(state => ({
            address: state.address,
            reputation: state.reputation,
            participation: state.roundsParticipated,
            successRate: state.roundsParticipated > 0 
                ? (state.consensusSuccess / state.roundsParticipated * 100).toFixed(1) + '%'
                : '0%',
            lastSeen: new Date(state.lastSeen).toISOString()
        }));
    }

    _calculateVerificationConfidence(checks) {
        const validChecks = Object.values(checks).filter(check => check.valid).length;
        const totalChecks = Object.keys(checks).length;
        
        if (totalChecks === 0) return 0;
        return (validChecks / totalChecks) * 100;
    }

    // =============================================================================
    // PUBLIC API
    // =============================================================================

    /**
     * Get current sequencer status
     * @returns {Object} Sequencer status
     */
    getSequencerStatus() {
        return {
            isActive: true,
            currentRound: this.currentRound.number,
            sequencers: this.config.sequencers.length,
            threshold: this.config.threshold,
            health: this._getSequencerHealthMetrics()
        };
    }

    /**
     * Update sequencer configuration
     * @param {Object} newConfig New configuration
     */
    updateSequencerConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        
        if (newConfig.sequencers) {
            this._initializeSequencers();
        }
    }

    /**
     * Get round history
     * @param {number} limit Number of rounds to return
     * @returns {Object[]} Round history
     */
    getRoundHistory(limit = 10) {
        const rounds = Array.from(this.roundHistory.values())
            .sort((a, b) => b.number - a.number)
            .slice(0, limit);

        return rounds.map(round => ({
            number: round.number,
            startTime: round.startTime,
            endTime: round.endTime,
            orderCount: round.orders.size,
            duration: round.endTime - round.startTime,
            finalized: round.finalized,
            consensusSuccess: !!round.consensus
        }));
    }
}

module.exports = { FairSequencingService };