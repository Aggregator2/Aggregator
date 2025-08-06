/**
 * @fileoverview Order Book Snapshot Manager for SwappiQ Protocol
 * @author SwappiQ Protocol
 * @description Fast recovery system with compressed snapshots and incremental updates
 */

const EventEmitter = require('events');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

/**
 * Snapshot Manager for order book fast recovery
 */
class SnapshotManager extends EventEmitter {
    constructor(config) {
        super();
        
        this.config = {
            // Snapshot settings
            snapshotInterval: config.snapshotInterval || 300000, // 5 minutes
            incrementalInterval: config.incrementalInterval || 5000, // 5 seconds
            maxSnapshots: config.maxSnapshots || 100,
            maxIncrementals: config.maxIncrementals || 1000,
            
            // Storage settings
            storage: {
                type: config.storage?.type || 'file', // file, memory, redis, s3
                path: config.storage?.path || '/var/lib/swappiq/snapshots',
                compression: config.storage?.compression !== false,
                encryption: config.storage?.encryption || false,
                backupEnabled: config.storage?.backupEnabled !== false
            },
            
            // Recovery settings
            recovery: {
                maxRecoveryTime: config.recovery?.maxRecoveryTime || 30000, // 30 seconds
                checksumValidation: config.recovery?.checksumValidation !== false,
                integrityChecks: config.recovery?.integrityChecks !== false,
                fallbackEnabled: config.recovery?.fallbackEnabled !== false
            },
            
            // Performance settings
            performance: {
                compressionLevel: config.performance?.compressionLevel || 6,
                parallelSnapshots: config.performance?.parallelSnapshots || 3,
                batchSize: config.performance?.batchSize || 1000,
                memoryLimit: config.performance?.memoryLimit || 100 * 1024 * 1024 // 100MB
            },
            
            // Trading pairs to snapshot
            tradingPairs: config.tradingPairs || ['ETH/USDT', 'BTC/USDT'],
            
            auditLogging: config.auditLogging !== false,
            ...config
        };

        this.state = {
            snapshots: new Map(), // symbol -> latest snapshot info
            incrementalUpdates: new Map(), // symbol -> incremental updates
            recoveryPoints: new Map(), // symbol -> recovery point info
            activeSnapshots: new Set(), // currently being created
            lastSnapshotTime: new Map(), // symbol -> timestamp
            
            metrics: {
                snapshotsCreated: 0,
                incrementalsCreated: 0,
                recoveriesPerformed: 0,
                totalDataSize: 0,
                compressionRatio: 0,
                averageRecoveryTime: 0
            }
        };

        this.compressor = null;
        this.encryptor = null;
        this.auditLogger = null;
        
        this.initialize();
    }

    /**
     * Initialize snapshot manager
     */
    async initialize() {
        try {
            await this._initializeStorage();
            await this._initializeCompression();
            await this._initializeEncryption();
            await this._initializeAuditLogging();
            await this._loadExistingSnapshots();
            await this._startSnapshotScheduler();
            
            console.log('Snapshot Manager initialized');
            this.emit('initialized');
            
        } catch (error) {
            console.error('Failed to initialize Snapshot Manager:', error);
            throw error;
        }
    }

    /**
     * Create snapshot of order book
     */
    async createSnapshot(symbol, orderBook, options = {}) {
        try {
            if (this.state.activeSnapshots.has(symbol)) {
                console.warn(`Snapshot already in progress for ${symbol}`);
                return null;
            }

            this.state.activeSnapshots.add(symbol);
            const startTime = Date.now();

            // Get order book data
            const snapshot = {
                symbol,
                timestamp: startTime,
                sequence: orderBook.state.sequence,
                data: {
                    bids: orderBook.state.bids.iterator().map(([price, level]) => ({
                        price,
                        quantity: level.totalQuantity,
                        orderCount: level.orderCount,
                        orders: options.includeOrders ? Array.from(level.orders.values()) : []
                    })),
                    asks: orderBook.state.asks.iterator().map(([price, level]) => ({
                        price,
                        quantity: level.totalQuantity,
                        orderCount: level.orderCount,
                        orders: options.includeOrders ? Array.from(level.orders.values()) : []
                    })),
                    spread: orderBook.spread,
                    midPrice: orderBook.midPrice,
                    lastPrice: orderBook.lastPrice,
                    volume24h: orderBook.volume24h,
                    trades: options.includeTrades ? orderBook.state.trades.toArray() : []
                },
                metadata: {
                    version: '1.0',
                    orderCount: orderBook.state.orders.size,
                    levelCount: orderBook.state.bids.size() + orderBook.state.asks.size(),
                    createdBy: 'SnapshotManager',
                    options
                }
            };

            // Calculate checksum
            snapshot.checksum = this._calculateChecksum(snapshot.data);

            // Compress if enabled
            let processedData = snapshot;
            if (this.config.storage.compression) {
                processedData = await this._compressSnapshot(snapshot);
                this.state.metrics.compressionRatio = 
                    processedData.compressedSize / processedData.originalSize;
            }

            // Encrypt if enabled
            if (this.config.storage.encryption) {
                processedData = await this._encryptSnapshot(processedData);
            }

            // Store snapshot
            const snapshotId = await this._storeSnapshot(symbol, processedData);

            // Update state
            this.state.snapshots.set(symbol, {
                id: snapshotId,
                timestamp: startTime,
                sequence: snapshot.sequence,
                size: processedData.size || JSON.stringify(processedData).length,
                checksum: snapshot.checksum,
                compressed: this.config.storage.compression,
                encrypted: this.config.storage.encryption
            });

            this.state.lastSnapshotTime.set(symbol, startTime);
            this.state.metrics.snapshotsCreated++;
            this.state.metrics.totalDataSize += processedData.size || 0;

            // Clear old incrementals
            this._clearOldIncrementals(symbol, snapshot.sequence);

            // Create recovery point
            await this._createRecoveryPoint(symbol, snapshotId, snapshot.sequence);

            const duration = Date.now() - startTime;
            
            await this._auditLog('SNAPSHOT_CREATED', {
                symbol,
                snapshotId,
                sequence: snapshot.sequence,
                duration,
                size: processedData.size,
                compressed: this.config.storage.compression,
                encrypted: this.config.storage.encryption
            });

            this.emit('snapshotCreated', {
                symbol,
                snapshotId,
                timestamp: startTime,
                duration,
                size: processedData.size
            });

            return snapshotId;

        } catch (error) {
            console.error(`Failed to create snapshot for ${symbol}:`, error);
            throw error;
        } finally {
            this.state.activeSnapshots.delete(symbol);
        }
    }

    /**
     * Create incremental update
     */
    async createIncremental(symbol, update) {
        try {
            const timestamp = Date.now();
            const incrementalUpdate = {
                symbol,
                timestamp,
                sequence: update.sequence,
                type: update.type,
                data: update.data,
                checksum: this._calculateChecksum(update.data)
            };

            // Store incremental
            if (!this.state.incrementalUpdates.has(symbol)) {
                this.state.incrementalUpdates.set(symbol, []);
            }

            const incrementals = this.state.incrementalUpdates.get(symbol);
            incrementals.push(incrementalUpdate);

            // Limit incremental history
            if (incrementals.length > this.config.maxIncrementals) {
                incrementals.splice(0, incrementals.length - this.config.maxIncrementals);
            }

            this.state.metrics.incrementalsCreated++;

            // Store to persistent storage if configured
            if (this.config.storage.type !== 'memory') {
                await this._storeIncremental(symbol, incrementalUpdate);
            }

            this.emit('incrementalCreated', {
                symbol,
                sequence: update.sequence,
                type: update.type,
                timestamp
            });

            return incrementalUpdate;

        } catch (error) {
            console.error(`Failed to create incremental for ${symbol}:`, error);
            throw error;
        }
    }

    /**
     * Recover order book from snapshot and incrementals
     */
    async recoverOrderBook(symbol, targetSequence = null) {
        try {
            const startTime = Date.now();
            
            // Find best recovery point
            const recoveryPoint = await this._findBestRecoveryPoint(symbol, targetSequence);
            if (!recoveryPoint) {
                throw new Error(`No recovery point found for ${symbol}`);
            }

            // Load snapshot
            const snapshot = await this._loadSnapshot(symbol, recoveryPoint.snapshotId);
            if (!snapshot) {
                throw new Error(`Failed to load snapshot ${recoveryPoint.snapshotId}`);
            }

            // Validate snapshot integrity
            if (this.config.recovery.checksumValidation) {
                await this._validateSnapshotIntegrity(snapshot);
            }

            // Load and apply incrementals if needed
            let appliedIncrementals = 0;
            if (targetSequence && targetSequence > snapshot.sequence) {
                const incrementals = await this._loadIncrementals(symbol, snapshot.sequence, targetSequence);
                
                for (const incremental of incrementals) {
                    // Apply incremental update to snapshot
                    this._applyIncrementalToSnapshot(snapshot, incremental);
                    appliedIncrementals++;
                }
            }

            const recoveryTime = Date.now() - startTime;
            this.state.metrics.recoveriesPerformed++;
            this.state.metrics.averageRecoveryTime = 
                (this.state.metrics.averageRecoveryTime + recoveryTime) / 2;

            await this._auditLog('RECOVERY_COMPLETED', {
                symbol,
                snapshotId: recoveryPoint.snapshotId,
                snapshotSequence: snapshot.sequence,
                targetSequence,
                incrementalsApplied: appliedIncrementals,
                recoveryTime
            });

            this.emit('recoveryCompleted', {
                symbol,
                snapshotSequence: snapshot.sequence,
                targetSequence,
                incrementalsApplied: appliedIncrementals,
                recoveryTime
            });

            return snapshot;

        } catch (error) {
            console.error(`Recovery failed for ${symbol}:`, error);
            
            // Try fallback recovery if enabled
            if (this.config.recovery.fallbackEnabled) {
                return await this._fallbackRecovery(symbol);
            }
            
            throw error;
        }
    }

    /**
     * Get available snapshots for symbol
     */
    getAvailableSnapshots(symbol) {
        const snapshots = [];
        const snapshotInfo = this.state.snapshots.get(symbol);
        
        if (snapshotInfo) {
            snapshots.push({
                symbol,
                id: snapshotInfo.id,
                timestamp: snapshotInfo.timestamp,
                sequence: snapshotInfo.sequence,
                size: snapshotInfo.size,
                compressed: snapshotInfo.compressed,
                encrypted: snapshotInfo.encrypted
            });
        }

        return snapshots;
    }

    /**
     * Get incremental updates for symbol
     */
    getIncrementalUpdates(symbol, fromSequence = 0, toSequence = Infinity) {
        const incrementals = this.state.incrementalUpdates.get(symbol) || [];
        
        return incrementals.filter(inc => 
            inc.sequence > fromSequence && inc.sequence <= toSequence
        );
    }

    // ========== PRIVATE METHODS ==========

    async _initializeStorage() {
        if (this.config.storage.type === 'file') {
            await fs.mkdir(this.config.storage.path, { recursive: true });
        }
    }

    async _initializeCompression() {
        if (this.config.storage.compression) {
            const zlib = require('zlib');
            this.compressor = zlib;
        }
    }

    async _initializeEncryption() {
        if (this.config.storage.encryption) {
            this.encryptor = {
                algorithm: 'aes-256-gcm',
                key: crypto.randomBytes(32)
            };
        }
    }

    async _initializeAuditLogging() {
        if (!this.config.auditLogging) return;

        const winston = require('winston');
        
        this.auditLogger = winston.createLogger({
            level: 'info',
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.json()
            ),
            transports: [
                new winston.transports.File({
                    filename: '/var/log/swappiq/snapshot-manager.log',
                    maxsize: 100 * 1024 * 1024,
                    maxFiles: 10
                })
            ]
        });
    }

    async _loadExistingSnapshots() {
        // Load existing snapshots from storage
        for (const symbol of this.config.tradingPairs) {
            try {
                const snapshots = await this._listSnapshots(symbol);
                if (snapshots.length > 0) {
                    const latest = snapshots[snapshots.length - 1];
                    this.state.snapshots.set(symbol, latest);
                }
            } catch (error) {
                console.warn(`Failed to load existing snapshots for ${symbol}:`, error);
            }
        }
    }

    async _startSnapshotScheduler() {
        // Schedule regular snapshots
        setInterval(async () => {
            await this._createScheduledSnapshots();
        }, this.config.snapshotInterval);

        // Schedule incremental cleanup
        setInterval(async () => {
            await this._cleanupOldData();
        }, this.config.snapshotInterval * 2);
    }

    async _createScheduledSnapshots() {
        const promises = [];
        
        for (const symbol of this.config.tradingPairs) {
            promises.push(this._createScheduledSnapshot(symbol));
        }

        await Promise.allSettled(promises);
    }

    async _createScheduledSnapshot(symbol) {
        try {
            // This would integrate with the order book manager
            // For now, we'll emit an event requesting a snapshot
            this.emit('snapshotRequested', { symbol });
        } catch (error) {
            console.error(`Failed to create scheduled snapshot for ${symbol}:`, error);
        }
    }

    _calculateChecksum(data) {
        const hash = crypto.createHash('sha256');
        hash.update(JSON.stringify(data));
        return hash.digest('hex');
    }

    async _compressSnapshot(snapshot) {
        if (!this.compressor) return snapshot;

        const originalData = JSON.stringify(snapshot);
        const originalSize = Buffer.byteLength(originalData);
        
        const compressed = await new Promise((resolve, reject) => {
            this.compressor.gzip(originalData, { level: this.config.performance.compressionLevel }, (err, result) => {
                if (err) reject(err);
                else resolve(result);
            });
        });

        return {
            ...snapshot,
            compressed: true,
            compressedData: compressed,
            originalSize,
            compressedSize: compressed.length
        };
    }

    async _encryptSnapshot(snapshot) {
        if (!this.encryptor) return snapshot;

        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipher(this.encryptor.algorithm, this.encryptor.key);
        
        const data = snapshot.compressed ? snapshot.compressedData : JSON.stringify(snapshot);
        
        let encrypted = cipher.update(data);
        encrypted = Buffer.concat([encrypted, cipher.final()]);
        
        const authTag = cipher.getAuthTag();

        return {
            ...snapshot,
            encrypted: true,
            encryptedData: encrypted,
            iv: iv.toString('hex'),
            authTag: authTag.toString('hex')
        };
    }

    async _storeSnapshot(symbol, snapshot) {
        const snapshotId = `${symbol}_${snapshot.timestamp}_${crypto.randomBytes(8).toString('hex')}`;
        
        switch (this.config.storage.type) {
            case 'file':
                await this._storeSnapshotToFile(snapshotId, snapshot);
                break;
            case 'memory':
                // Already in memory
                break;
            default:
                throw new Error(`Unsupported storage type: ${this.config.storage.type}`);
        }

        return snapshotId;
    }

    async _storeSnapshotToFile(snapshotId, snapshot) {
        const filePath = path.join(this.config.storage.path, `${snapshotId}.json`);
        const data = JSON.stringify(snapshot, null, 2);
        await fs.writeFile(filePath, data);
    }

    async _loadSnapshot(symbol, snapshotId) {
        switch (this.config.storage.type) {
            case 'file':
                return await this._loadSnapshotFromFile(snapshotId);
            case 'memory':
                return this.state.snapshots.get(symbol);
            default:
                throw new Error(`Unsupported storage type: ${this.config.storage.type}`);
        }
    }

    async _loadSnapshotFromFile(snapshotId) {
        const filePath = path.join(this.config.storage.path, `${snapshotId}.json`);
        const data = await fs.readFile(filePath, 'utf8');
        return JSON.parse(data);
    }

    async _listSnapshots(symbol) {
        // Implementation depends on storage type
        return [];
    }

    _clearOldIncrementals(symbol, sequence) {
        const incrementals = this.state.incrementalUpdates.get(symbol);
        if (!incrementals) return;

        // Remove incrementals older than the snapshot
        const filtered = incrementals.filter(inc => inc.sequence > sequence);
        this.state.incrementalUpdates.set(symbol, filtered);
    }

    async _createRecoveryPoint(symbol, snapshotId, sequence) {
        this.state.recoveryPoints.set(symbol, {
            snapshotId,
            sequence,
            timestamp: Date.now()
        });
    }

    async _findBestRecoveryPoint(symbol, targetSequence) {
        return this.state.recoveryPoints.get(symbol);
    }

    async _loadIncrementals(symbol, fromSequence, toSequence) {
        return this.getIncrementalUpdates(symbol, fromSequence, toSequence);
    }

    _applyIncrementalToSnapshot(snapshot, incremental) {
        // Apply incremental update to snapshot data
        const { type, data } = incremental;
        
        switch (type) {
            case 'add':
                this._applyAddUpdate(snapshot, data);
                break;
            case 'update':
                this._applyUpdateOrder(snapshot, data);
                break;
            case 'remove':
                this._applyRemoveUpdate(snapshot, data);
                break;
            case 'trade':
                this._applyTradeUpdate(snapshot, data);
                break;
        }
        
        snapshot.sequence = incremental.sequence;
    }

    _applyAddUpdate(snapshot, data) {
        const side = data.side === 'buy' ? 'bids' : 'asks';
        const levels = snapshot.data[side];
        
        // Find or create price level
        let level = levels.find(l => l.price === data.price);
        if (!level) {
            level = { price: data.price, quantity: 0, orderCount: 0, orders: [] };
            levels.push(level);
            levels.sort((a, b) => side === 'bids' ? b.price - a.price : a.price - b.price);
        }
        
        level.quantity += data.quantity;
        level.orderCount++;
        if (level.orders) {
            level.orders.push(data);
        }
    }

    _applyUpdateOrder(snapshot, data) {
        // Similar implementation for order updates
    }

    _applyRemoveUpdate(snapshot, data) {
        // Similar implementation for order removals
    }

    _applyTradeUpdate(snapshot, data) {
        snapshot.data.lastPrice = data.price;
        if (snapshot.data.trades) {
            snapshot.data.trades.push(data);
        }
    }

    async _validateSnapshotIntegrity(snapshot) {
        if (snapshot.checksum) {
            const calculatedChecksum = this._calculateChecksum(snapshot.data);
            if (calculatedChecksum !== snapshot.checksum) {
                throw new Error('Snapshot integrity check failed');
            }
        }
    }

    async _fallbackRecovery(symbol) {
        console.warn(`Attempting fallback recovery for ${symbol}`);
        // Implementation would try alternative recovery methods
        return null;
    }

    async _storeIncremental(symbol, incremental) {
        // Store incremental update to persistent storage
    }

    async _cleanupOldData() {
        const now = Date.now();
        const retentionPeriod = 7 * 24 * 60 * 60 * 1000; // 7 days
        
        // Cleanup old snapshots and incrementals
        for (const symbol of this.config.tradingPairs) {
            const incrementals = this.state.incrementalUpdates.get(symbol) || [];
            const filtered = incrementals.filter(inc => now - inc.timestamp < retentionPeriod);
            this.state.incrementalUpdates.set(symbol, filtered);
        }
    }

    async _auditLog(action, details) {
        if (!this.auditLogger) return;

        this.auditLogger.info('SNAPSHOT_AUDIT', {
            timestamp: new Date().toISOString(),
            action,
            details,
            source: 'SnapshotManager'
        });
    }

    /**
     * Get metrics
     */
    getMetrics() {
        return {
            ...this.state.metrics,
            storage: {
                type: this.config.storage.type,
                compression: this.config.storage.compression,
                encryption: this.config.storage.encryption
            },
            snapshots: {
                active: this.state.snapshots.size,
                inProgress: this.state.activeSnapshots.size
            },
            incrementals: {
                total: Array.from(this.state.incrementalUpdates.values())
                    .reduce((sum, arr) => sum + arr.length, 0)
            },
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Cleanup resources
     */
    async cleanup() {
        this.state.snapshots.clear();
        this.state.incrementalUpdates.clear();
        this.state.recoveryPoints.clear();
        
        console.log('Snapshot Manager cleaned up');
    }
}

module.exports = { SnapshotManager };