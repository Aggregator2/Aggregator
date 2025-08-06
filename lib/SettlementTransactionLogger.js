/**
 * Settlement Transaction Logger with Blockchain Reference System
 * Comprehensive logging for settlement transactions with MEV protection tracking
 * Optimized for high-throughput settlement processing
 */

const { Pool } = require('pg');
const { EventEmitter } = require('events');
const Redis = require('ioredis');
const crypto = require('crypto');

class SettlementTransactionLogger extends EventEmitter {
    constructor(config = {}) {
        super();
        
        this.config = {
            // Database configuration
            pgPool: config.pgPool || new Pool({
                host: process.env.DB_HOST || 'localhost',
                port: process.env.DB_PORT || 5432,
                database: process.env.DB_NAME || 'settlement_queue',
                user: process.env.DB_USER || 'postgres',
                password: process.env.DB_PASSWORD,
                max: 20,
                idleTimeoutMillis: 30000,
                connectionTimeoutMillis: 2000,
            }),
            
            // Redis for real-time updates
            redis: config.redis || new Redis({
                host: process.env.REDIS_HOST || 'localhost',
                port: process.env.REDIS_PORT || 6379,
                password: process.env.REDIS_PASSWORD,
            }),
            
            // Blockchain monitoring
            web3Providers: config.web3Providers || {},
            chainConfigurations: config.chainConfigurations || {
                1: { name: 'ethereum', blockTime: 12, confirmations: 12 },
                137: { name: 'polygon', blockTime: 2, confirmations: 30 },
                42161: { name: 'arbitrum', blockTime: 0.25, confirmations: 1 },
            },
            
            // Performance settings
            batchSize: config.batchSize || 100,
            maxRetries: config.maxRetries || 3,
            confirmationThreshold: config.confirmationThreshold || 12,
            reorgProtection: config.reorgProtection !== false,
            
            // MEV tracking
            mevTrackingEnabled: config.mevTrackingEnabled !== false,
            flashbotApiUrl: config.flashbotApiUrl || 'https://relay.flashbots.net',
            
            // Metrics and monitoring
            metricsEnabled: config.metricsEnabled !== false,
            alertingEnabled: config.alertingEnabled !== false,
        };
        
        // Transaction processing queues
        this.pendingTransactions = new Map();
        this.processingQueue = [];
        this.confirmationQueue = new Map();
        
        // MEV protection tracking
        this.mevBundles = new Map();
        this.flashbotBundles = new Map();
        
        // Metrics
        this.metrics = {
            transactionsLogged: 0,
            confirmationsProcessed: 0,
            reorgsDetected: 0,
            mevBundlesTracked: 0,
            failedTransactions: 0,
            avgProcessingTime: 0,
        };
        
        // Block monitoring
        this.lastProcessedBlock = new Map();
        this.blockSubscriptions = new Map();
        
        this.initialize();
    }
    
    async initialize() {
        try {
            // Test database connection
            await this.config.pgPool.query('SELECT 1');
            
            // Initialize blockchain monitoring
            await this.initializeBlockchainMonitoring();
            
            // Start background processors
            this.startBackgroundProcessors();
            
            this.emit('ready');
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }
    
    // =============================================================================
    // CORE TRANSACTION LOGGING
    // =============================================================================
    
    /**
     * Log a settlement transaction with full blockchain context
     */
    async logSettlementTransaction(transactionData) {
        const startTime = Date.now();
        
        try {
            // Validate input data
            this.validateTransactionData(transactionData);
            
            // Generate settlement ID if not provided
            const settlementId = transactionData.settlementId || this.generateSettlementId(transactionData);
            
            // Create transaction record
            const txRecord = {
                tx_hash: transactionData.txHash,
                block_number: transactionData.blockNumber,
                block_hash: transactionData.blockHash,
                log_index: transactionData.logIndex,
                chain_id: transactionData.chainId || 1,
                settlement_id: settlementId,
                batch_id: transactionData.batchId,
                settlement_type: transactionData.settlementType || 'single',
                order_ids: transactionData.orderIds || [],
                primary_order_id: transactionData.primaryOrderId,
                total_volume_usd: transactionData.totalVolumeUsd,
                gas_price: transactionData.gasPrice,
                gas_used: transactionData.gasUsed,
                gas_cost_wei: BigInt(transactionData.gasPrice) * BigInt(transactionData.gasUsed),
                protocol_fee_wei: transactionData.protocolFeeWei || 0,
                settler_address: transactionData.settlerAddress,
                operator_address: transactionData.operatorAddress,
                mev_protection_used: transactionData.mevProtectionUsed || false,
                flashbot_bundle_hash: transactionData.flashbotBundleHash,
                bundle_block_number: transactionData.bundleBlockNumber,
                status: transactionData.status || 'pending',
                metadata: transactionData.metadata || {},
            };
            
            // Insert into database
            const insertedTx = await this.insertTransaction(txRecord);
            
            // Track for confirmation monitoring
            if (transactionData.txHash && transactionData.blockNumber) {
                this.trackForConfirmation(insertedTx);
            }
            
            // Track MEV protection if enabled
            if (this.config.mevTrackingEnabled && transactionData.mevProtectionUsed) {
                await this.trackMevProtection(insertedTx);
            }
            
            // Update metrics
            this.metrics.transactionsLogged++;
            this.metrics.avgProcessingTime = this.updateAverageTime(
                this.metrics.avgProcessingTime,
                Date.now() - startTime,
                this.metrics.transactionsLogged
            );
            
            // Emit event for real-time processing
            this.emit('transactionLogged', insertedTx);
            
            // Publish to Redis for real-time updates
            await this.publishTransactionUpdate(insertedTx, 'logged');
            
            return insertedTx;
            
        } catch (error) {
            this.metrics.failedTransactions++;
            this.emit('loggingError', { transactionData, error });
            throw error;
        }
    }
    
    /**
     * Batch log multiple settlement transactions
     */
    async batchLogTransactions(transactions) {
        if (transactions.length === 0) return [];
        
        const client = await this.config.pgPool.connect();
        
        try {
            await client.query('BEGIN');
            
            const results = [];
            
            // Process transactions in batches
            for (let i = 0; i < transactions.length; i += this.config.batchSize) {
                const batch = transactions.slice(i, i + this.config.batchSize);
                const batchResults = await this.processBatch(client, batch);
                results.push(...batchResults);
            }
            
            await client.query('COMMIT');
            
            // Start confirmation tracking for all transactions
            results.forEach(tx => {
                if (tx.tx_hash && tx.block_number) {
                    this.trackForConfirmation(tx);
                }
            });
            
            return results;
            
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
    
    /**
     * Update transaction status with confirmation data
     */
    async updateTransactionStatus(txHash, status, confirmationData = {}) {
        try {
            const updateQuery = `
                UPDATE settlement_transactions 
                SET 
                    status = $2,
                    confirmed_at = $3,
                    finalized_at = $4,
                    error_message = $5,
                    metadata = metadata || $6
                WHERE tx_hash = $1
                RETURNING *
            `;
            
            const result = await this.config.pgPool.query(updateQuery, [
                Buffer.from(txHash.slice(2), 'hex'),
                status,
                confirmationData.confirmedAt || (status === 'confirmed' ? new Date() : null),
                confirmationData.finalizedAt || (status === 'finalized' ? new Date() : null),
                confirmationData.errorMessage || null,
                JSON.stringify(confirmationData.metadata || {})
            ]);
            
            if (result.rows.length === 0) {
                throw new Error(`Transaction not found: ${txHash}`);
            }
            
            const updatedTx = result.rows[0];
            
            // Emit status update event
            this.emit('statusUpdated', { txHash, status, transaction: updatedTx });
            
            // Publish to Redis
            await this.publishTransactionUpdate(updatedTx, 'status_updated');
            
            // Remove from confirmation tracking if finalized
            if (status === 'finalized' || status === 'failed') {
                this.confirmationQueue.delete(txHash);
            }
            
            return updatedTx;
            
        } catch (error) {
            this.emit('updateError', { txHash, status, error });
            throw error;
        }
    }
    
    // =============================================================================
    // BLOCKCHAIN MONITORING AND CONFIRMATION TRACKING
    // =============================================================================
    
    async initializeBlockchainMonitoring() {
        for (const [chainId, config] of Object.entries(this.config.chainConfigurations)) {
            const provider = this.config.web3Providers[chainId];
            if (!provider) continue;
            
            // Subscribe to new blocks
            await this.subscribeToBlocks(chainId, provider);
            
            // Initialize last processed block
            const lastBlock = await provider.getBlockNumber();
            this.lastProcessedBlock.set(chainId, lastBlock);
        }
    }
    
    async subscribeToBlocks(chainId, provider) {
        try {
            const subscription = await provider.on('block', async (blockNumber) => {
                await this.processNewBlock(chainId, blockNumber);
            });
            
            this.blockSubscriptions.set(chainId, subscription);
        } catch (error) {
            console.error(`Failed to subscribe to blocks for chain ${chainId}:`, error);
            // Fallback to polling
            this.startBlockPolling(chainId, provider);
        }
    }
    
    startBlockPolling(chainId, provider) {
        const config = this.config.chainConfigurations[chainId];
        const interval = config.blockTime * 1000; // Convert to milliseconds
        
        setInterval(async () => {
            try {
                const currentBlock = await provider.getBlockNumber();
                const lastProcessed = this.lastProcessedBlock.get(chainId) || 0;
                
                for (let blockNumber = lastProcessed + 1; blockNumber <= currentBlock; blockNumber++) {
                    await this.processNewBlock(chainId, blockNumber);
                }
            } catch (error) {
                console.error(`Block polling error for chain ${chainId}:`, error);
            }
        }, interval);
    }
    
    async processNewBlock(chainId, blockNumber) {
        try {
            const provider = this.config.web3Providers[chainId];
            const block = await provider.getBlock(blockNumber, true);
            
            // Check for reorgs
            if (this.config.reorgProtection) {
                await this.checkForReorganization(chainId, block);
            }
            
            // Process confirmations for pending transactions
            await this.processConfirmations(chainId, blockNumber);
            
            // Update last processed block
            this.lastProcessedBlock.set(chainId, blockNumber);
            
            this.emit('blockProcessed', { chainId, blockNumber, transactionCount: block.transactions.length });
            
        } catch (error) {
            this.emit('blockProcessingError', { chainId, blockNumber, error });
        }
    }
    
    async processConfirmations(chainId, blockNumber) {
        const config = this.config.chainConfigurations[chainId];
        const confirmationThreshold = config.confirmations || this.config.confirmationThreshold;
        
        // Check transactions waiting for confirmation
        for (const [txHash, txData] of this.confirmationQueue) {
            if (txData.chainId !== parseInt(chainId)) continue;
            
            const confirmations = blockNumber - txData.blockNumber;
            
            if (confirmations >= confirmationThreshold && txData.status === 'pending') {
                await this.updateTransactionStatus(txHash, 'confirmed', {
                    confirmedAt: new Date(),
                    confirmations: confirmations,
                    metadata: { confirmationBlock: blockNumber }
                });
                
                this.metrics.confirmationsProcessed++;
            }
            
            // Mark as finalized after additional confirmations
            const finalizationThreshold = confirmationThreshold * 2;
            if (confirmations >= finalizationThreshold && txData.status === 'confirmed') {
                await this.updateTransactionStatus(txHash, 'finalized', {
                    finalizedAt: new Date(),
                    confirmations: confirmations
                });
            }
        }
    }
    
    async checkForReorganization(chainId, newBlock) {
        const lastBlock = this.lastProcessedBlock.get(chainId);
        if (!lastBlock || newBlock.number <= lastBlock) return;
        
        const provider = this.config.web3Providers[chainId];
        
        try {
            // Check if previous block hash matches
            const previousBlock = await provider.getBlock(newBlock.number - 1);
            
            // Get our stored hash for comparison (simplified - in production, store block hashes)
            const storedPreviousHash = this.getStoredBlockHash(chainId, newBlock.number - 1);
            
            if (storedPreviousHash && previousBlock.hash !== storedPreviousHash) {
                // Reorganization detected
                this.metrics.reorgsDetected++;
                
                await this.handleReorganization(chainId, newBlock.number - 1);
                
                this.emit('reorganizationDetected', {
                    chainId,
                    reorgBlock: newBlock.number - 1,
                    newHash: previousBlock.hash,
                    oldHash: storedPreviousHash
                });
            }
        } catch (error) {
            console.error(`Reorg check failed for chain ${chainId}:`, error);
        }
    }
    
    async handleReorganization(chainId, reorgBlock) {
        // Mark affected transactions as potentially invalid
        const affectedQuery = `
            UPDATE settlement_transactions 
            SET 
                status = 'pending',
                metadata = metadata || $2
            WHERE chain_id = $1 AND block_number >= $3
            RETURNING tx_hash, id
        `;
        
        const result = await this.config.pgPool.query(affectedQuery, [
            chainId,
            JSON.stringify({ reorganization: true, reorgDetectedAt: new Date() }),
            reorgBlock
        ]);
        
        // Re-track affected transactions for confirmation
        result.rows.forEach(row => {
            const txHash = '0x' + row.tx_hash.toString('hex');
            this.trackForConfirmation({ tx_hash: txHash, id: row.id });
        });
        
        this.emit('reorgHandled', { chainId, reorgBlock, affectedCount: result.rowCount });
    }
    
    // =============================================================================
    // MEV PROTECTION TRACKING
    // =============================================================================
    
    async trackMevProtection(transaction) {
        if (!transaction.mev_protection_used) return;
        
        try {
            // Track flashbot bundle if present
            if (transaction.flashbot_bundle_hash) {
                await this.trackFlashbotBundle(transaction);
            }
            
            // Analyze MEV protection effectiveness
            const mevAnalysis = await this.analyzeMevProtection(transaction);
            
            // Update transaction metadata with MEV analysis
            const updateQuery = `
                UPDATE settlement_transactions 
                SET metadata = metadata || $2
                WHERE id = $1
            `;
            
            await this.config.pgPool.query(updateQuery, [
                transaction.id,
                JSON.stringify({ mevAnalysis })
            ]);
            
            this.metrics.mevBundlesTracked++;
            
        } catch (error) {
            this.emit('mevTrackingError', { transaction, error });
        }
    }
    
    async trackFlashbotBundle(transaction) {
        const bundleHash = transaction.flashbot_bundle_hash;
        if (!bundleHash) return;
        
        try {
            // Query Flashbot API for bundle information
            const bundleInfo = await this.queryFlashbotBundle(bundleHash);
            
            this.flashbotBundles.set(bundleHash, {
                transaction: transaction,
                bundleInfo: bundleInfo,
                trackedAt: new Date()
            });
            
            // Store bundle analysis in metadata
            const bundleAnalysis = {
                bundleHash: bundleHash,
                bundleIncluded: bundleInfo.included,
                bundlePosition: bundleInfo.position,
                mevProtected: bundleInfo.included && bundleInfo.position === 0,
                bundleRevenue: bundleInfo.revenue,
                gasPrice: bundleInfo.gasPrice
            };
            
            return bundleAnalysis;
            
        } catch (error) {
            console.error(`Failed to track Flashbot bundle ${bundleHash}:`, error);
            return null;
        }
    }
    
    async analyzeMevProtection(transaction) {
        // Analyze the effectiveness of MEV protection
        const analysis = {
            protectionType: this.identifyProtectionType(transaction),
            effectivenessScore: 0,
            mevSaved: 0,
            gasOverhead: 0,
            sandwichProtected: false,
            frontrunProtected: false,
            timestamp: new Date()
        };
        
        // Calculate effectiveness based on various factors
        if (transaction.flashbot_bundle_hash) {
            analysis.effectivenessScore += 0.8; // High score for flashbot usage
            analysis.frontrunProtected = true;
        }
        
        // Check for sandwich attack protection
        const sandwichCheck = await this.checkSandwichProtection(transaction);
        if (sandwichCheck.protected) {
            analysis.sandwichProtected = true;
            analysis.effectivenessScore += 0.6;
            analysis.mevSaved = sandwichCheck.estimatedSavings;
        }
        
        // Calculate gas overhead
        analysis.gasOverhead = this.calculateGasOverhead(transaction);
        
        return analysis;
    }
    
    // =============================================================================
    // DATABASE OPERATIONS
    // =============================================================================
    
    async insertTransaction(txRecord) {
        const insertQuery = `
            INSERT INTO settlement_transactions (
                tx_hash, block_number, block_hash, log_index, chain_id,
                settlement_id, batch_id, settlement_type, order_ids, primary_order_id,
                total_volume_usd, gas_price, gas_used, gas_cost_wei, protocol_fee_wei,
                settler_address, operator_address, mev_protection_used,
                flashbot_bundle_hash, bundle_block_number, status, metadata
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22
            ) RETURNING *
        `;
        
        const values = [
            Buffer.from(txRecord.tx_hash.slice(2), 'hex'),
            txRecord.block_number,
            txRecord.block_hash ? Buffer.from(txRecord.block_hash.slice(2), 'hex') : null,
            txRecord.log_index,
            txRecord.chain_id,
            Buffer.from(txRecord.settlement_id.slice(2), 'hex'),
            txRecord.batch_id,
            txRecord.settlement_type,
            txRecord.order_ids,
            txRecord.primary_order_id,
            txRecord.total_volume_usd,
            txRecord.gas_price,
            txRecord.gas_used,
            txRecord.gas_cost_wei.toString(),
            txRecord.protocol_fee_wei.toString(),
            Buffer.from(txRecord.settler_address.slice(2), 'hex'),
            txRecord.operator_address ? Buffer.from(txRecord.operator_address.slice(2), 'hex') : null,
            txRecord.mev_protection_used,
            txRecord.flashbot_bundle_hash ? Buffer.from(txRecord.flashbot_bundle_hash.slice(2), 'hex') : null,
            txRecord.bundle_block_number,
            txRecord.status,
            JSON.stringify(txRecord.metadata)
        ];
        
        const result = await this.config.pgPool.query(insertQuery, values);
        return this.formatTransactionRecord(result.rows[0]);
    }
    
    async processBatch(client, transactions) {
        const results = [];
        
        for (const tx of transactions) {
            try {
                const txRecord = await this.insertTransactionInBatch(client, tx);
                results.push(txRecord);
            } catch (error) {
                results.push({ error: error.message, originalData: tx });
            }
        }
        
        return results;
    }
    
    // =============================================================================
    // UTILITY FUNCTIONS
    // =============================================================================
    
    validateTransactionData(data) {
        const required = ['txHash', 'blockNumber', 'settlementType', 'gasPrice', 'gasUsed', 'settlerAddress'];
        
        for (const field of required) {
            if (!data[field]) {
                throw new Error(`Missing required field: ${field}`);
            }
        }
        
        if (!data.txHash.startsWith('0x') || data.txHash.length !== 66) {
            throw new Error('Invalid transaction hash format');
        }
        
        if (!data.settlerAddress.startsWith('0x') || data.settlerAddress.length !== 42) {
            throw new Error('Invalid settler address format');
        }
    }
    
    generateSettlementId(transactionData) {
        const data = `${transactionData.txHash}:${transactionData.blockNumber}:${transactionData.logIndex || 0}`;
        return '0x' + crypto.createHash('sha256').update(data).digest('hex');
    }
    
    trackForConfirmation(transaction) {
        const txHash = transaction.tx_hash.startsWith('0x') 
            ? transaction.tx_hash 
            : '0x' + transaction.tx_hash.toString('hex');
            
        this.confirmationQueue.set(txHash, {
            id: transaction.id,
            blockNumber: transaction.block_number,
            chainId: transaction.chain_id,
            status: transaction.status || 'pending',
            trackedAt: new Date()
        });
    }
    
    formatTransactionRecord(row) {
        return {
            id: row.id,
            tx_hash: '0x' + row.tx_hash.toString('hex'),
            block_number: row.block_number,
            block_hash: row.block_hash ? '0x' + row.block_hash.toString('hex') : null,
            log_index: row.log_index,
            chain_id: row.chain_id,
            settlement_id: '0x' + row.settlement_id.toString('hex'),
            batch_id: row.batch_id,
            settlement_type: row.settlement_type,
            order_ids: row.order_ids,
            primary_order_id: row.primary_order_id,
            total_volume_usd: row.total_volume_usd,
            gas_price: row.gas_price,
            gas_used: row.gas_used,
            gas_cost_wei: row.gas_cost_wei,
            protocol_fee_wei: row.protocol_fee_wei,
            settler_address: '0x' + row.settler_address.toString('hex'),
            operator_address: row.operator_address ? '0x' + row.operator_address.toString('hex') : null,
            mev_protection_used: row.mev_protection_used,
            flashbot_bundle_hash: row.flashbot_bundle_hash ? '0x' + row.flashbot_bundle_hash.toString('hex') : null,
            bundle_block_number: row.bundle_block_number,
            status: row.status,
            created_at: row.created_at,
            confirmed_at: row.confirmed_at,
            finalized_at: row.finalized_at,
            error_message: row.error_message,
            metadata: row.metadata
        };
    }
    
    async publishTransactionUpdate(transaction, eventType) {
        if (!this.config.redis) return;
        
        try {
            const message = {
                eventType,
                transaction,
                timestamp: new Date().toISOString()
            };
            
            await this.config.redis.publish('settlement_transactions', JSON.stringify(message));
        } catch (error) {
            console.error('Failed to publish transaction update:', error);
        }
    }
    
    updateAverageTime(currentAvg, newTime, count) {
        return ((currentAvg * (count - 1)) + newTime) / count;
    }
    
    startBackgroundProcessors() {
        // Process confirmation queue every 30 seconds
        setInterval(() => this.processConfirmationQueue(), 30000);
        
        // Clean up old tracking data every 5 minutes
        setInterval(() => this.cleanupTrackingData(), 300000);
        
        // Emit metrics every minute
        if (this.config.metricsEnabled) {
            setInterval(() => this.emitMetrics(), 60000);
        }
    }
    
    async processConfirmationQueue() {
        // Process any pending confirmations that might have been missed
        for (const [txHash, txData] of this.confirmationQueue) {
            try {
                const provider = this.config.web3Providers[txData.chainId];
                if (!provider) continue;
                
                const receipt = await provider.getTransactionReceipt(txHash);
                if (receipt && receipt.status === 1) {
                    const currentBlock = await provider.getBlockNumber();
                    const confirmations = currentBlock - receipt.blockNumber;
                    
                    const config = this.config.chainConfigurations[txData.chainId];
                    const threshold = config?.confirmations || this.config.confirmationThreshold;
                    
                    if (confirmations >= threshold && txData.status === 'pending') {
                        await this.updateTransactionStatus(txHash, 'confirmed');
                    }
                }
            } catch (error) {
                // Transaction might be pending or failed
                continue;
            }
        }
    }
    
    cleanupTrackingData() {
        const cutoff = Date.now() - (24 * 60 * 60 * 1000); // 24 hours ago
        
        // Clean up old confirmation tracking
        for (const [txHash, data] of this.confirmationQueue) {
            if (data.trackedAt.getTime() < cutoff) {
                this.confirmationQueue.delete(txHash);
            }
        }
        
        // Clean up old MEV bundle tracking
        for (const [bundleHash, data] of this.flashbotBundles) {
            if (data.trackedAt.getTime() < cutoff) {
                this.flashbotBundles.delete(bundleHash);
            }
        }
    }
    
    emitMetrics() {
        this.emit('metrics', {
            ...this.metrics,
            pendingConfirmations: this.confirmationQueue.size,
            trackedBundles: this.flashbotBundles.size,
            timestamp: new Date().toISOString()
        });
    }
    
    // =============================================================================
    // PUBLIC API
    // =============================================================================
    
    async getTransactionById(id) {
        const query = 'SELECT * FROM settlement_transactions WHERE id = $1';
        const result = await this.config.pgPool.query(query, [id]);
        
        return result.rows.length > 0 ? this.formatTransactionRecord(result.rows[0]) : null;
    }
    
    async getTransactionByHash(txHash) {
        const query = 'SELECT * FROM settlement_transactions WHERE tx_hash = $1';
        const result = await this.config.pgPool.query(query, [Buffer.from(txHash.slice(2), 'hex')]);
        
        return result.rows.length > 0 ? this.formatTransactionRecord(result.rows[0]) : null;
    }
    
    async getTransactionsByOrderId(orderId) {
        const query = 'SELECT * FROM settlement_transactions WHERE $1 = ANY(order_ids) ORDER BY created_at DESC';
        const result = await this.config.pgPool.query(query, [orderId]);
        
        return result.rows.map(row => this.formatTransactionRecord(row));
    }
    
    getMetrics() {
        return {
            ...this.metrics,
            pendingConfirmations: this.confirmationQueue.size,
            trackedBundles: this.flashbotBundles.size,
            lastUpdate: new Date().toISOString()
        };
    }
    
    async healthCheck() {
        try {
            await this.config.pgPool.query('SELECT 1');
            
            // Check blockchain connections
            const chainStatuses = {};
            for (const [chainId, provider] of Object.entries(this.config.web3Providers)) {
                try {
                    await provider.getBlockNumber();
                    chainStatuses[chainId] = 'connected';
                } catch (error) {
                    chainStatuses[chainId] = 'disconnected';
                }
            }
            
            return {
                status: 'healthy',
                database: 'connected',
                chains: chainStatuses,
                metrics: this.getMetrics(),
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return {
                status: 'unhealthy',
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }
    
    async shutdown() {
        // Unsubscribe from blockchain events
        for (const [chainId, subscription] of this.blockSubscriptions) {
            try {
                if (typeof subscription.removeAllListeners === 'function') {
                    subscription.removeAllListeners();
                }
            } catch (error) {
                console.error(`Error unsubscribing from chain ${chainId}:`, error);
            }
        }
        
        // Close database connections
        await this.config.pgPool.end();
        
        // Close Redis connection
        if (this.config.redis) {
            await this.config.redis.quit();
        }
        
        this.emit('shutdown');
    }
}

module.exports = SettlementTransactionLogger;