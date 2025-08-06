/**
 * @fileoverview Hot Wallet Balance Cache for SwappiQ Protocol
 * @author SwappiQ Protocol
 * @description High-performance wallet balance caching with real-time updates, staleness detection, and batch operations
 */

const crypto = require('crypto');
const EventEmitter = require('events');

/**
 * Wallet Balance Cache Manager
 * Provides real-time balance caching, staleness detection, and intelligent refresh strategies
 */
class WalletBalanceCache extends EventEmitter {
    constructor(redis, config) {
        super();
        
        this.redis = redis;
        this.config = {
            ttl: config.ttl || 30, // 30 seconds default
            refreshThreshold: config.refreshThreshold || 0.8, // Refresh when 80% of TTL is consumed
            batchSize: config.batchSize || 50,
            stalenessThreshold: config.stalenessThreshold || 5000, // 5 seconds
            enableRealtimeUpdates: config.enableRealtimeUpdates !== false,
            enableStaleServing: config.enableStaleServing !== false,
            maxStaleAge: config.maxStaleAge || 300, // 5 minutes max stale age
            compressionEnabled: config.compressionEnabled || false,
            encryptionEnabled: config.encryptionEnabled || false,
            balanceValidationEnabled: config.balanceValidationEnabled !== false,
            tokenPriceCache: config.tokenPriceCache !== false,
            networkSpecific: config.networkSpecific !== false,
            ...config
        };

        this.state = {
            stats: {
                cacheHits: 0,
                cacheMisses: 0,
                staleServed: 0,
                refreshes: 0,
                validationFailures: 0,
                batchOperations: 0,
                avgRefreshTime: 0,
                totalRequests: 0
            },
            activeRefreshes: new Set(),
            pendingRefreshes: new Map(),
            priceCache: new Map(),
            networkBalances: new Map()
        };

        // Network configuration for multi-chain support
        this.networks = {
            ethereum: { id: 1, rpcUrl: config.networks?.ethereum?.rpcUrl },
            polygon: { id: 137, rpcUrl: config.networks?.polygon?.rpcUrl },
            bsc: { id: 56, rpcUrl: config.networks?.bsc?.rpcUrl },
            arbitrum: { id: 42161, rpcUrl: config.networks?.arbitrum?.rpcUrl },
            optimism: { id: 10, rpcUrl: config.networks?.optimism?.rpcUrl }
        };

        // Lua scripts for atomic operations
        this.luaScripts = {};
    }

    /**
     * Initialize wallet balance cache
     */
    async initialize() {
        try {
            await this._loadLuaScripts();
            await this._startRefreshScheduler();
            await this._loadTokenPrices();
            console.log('Wallet Balance Cache initialized');
        } catch (error) {
            console.error('Failed to initialize Wallet Balance Cache:', error);
            throw error;
        }
    }

    /**
     * Load Lua scripts for atomic balance operations
     */
    async _loadLuaScripts() {
        // Atomic balance update with validation
        this.luaScripts.updateBalance = await this.redis.defineCommand('updateBalance', {
            numberOfKeys: 2,
            lua: `
                local balanceKey = KEYS[1]
                local metadataKey = KEYS[2]
                
                local walletAddress = ARGV[1]
                local tokenAddress = ARGV[2]
                local balance = ARGV[3]
                local blockNumber = tonumber(ARGV[4])
                local timestamp = tonumber(ARGV[5])
                local ttl = tonumber(ARGV[6])
                local network = ARGV[7]
                
                -- Get current metadata
                local currentMeta = redis.call('HGET', metadataKey, 'blockNumber')
                local currentBlock = tonumber(currentMeta) or 0
                
                -- Only update if block number is newer
                if blockNumber >= currentBlock then
                    -- Update balance
                    redis.call('HSET', balanceKey, tokenAddress, balance)
                    redis.call('EXPIRE', balanceKey, ttl)
                    
                    -- Update metadata
                    redis.call('HMSET', metadataKey, 
                        'blockNumber', blockNumber,
                        'lastUpdate', timestamp,
                        'network', network,
                        'wallet', walletAddress
                    )
                    redis.call('EXPIRE', metadataKey, ttl)
                    
                    return {true, 'updated', blockNumber}
                else
                    return {false, 'stale_block', currentBlock}
                end
            `
        });

        // Batch balance update
        this.luaScripts.batchUpdateBalances = await this.redis.defineCommand('batchUpdateBalances', {
            numberOfKeys: 1,
            lua: `
                local baseKey = KEYS[1]
                local ttl = tonumber(ARGV[1])
                local timestamp = tonumber(ARGV[2])
                local network = ARGV[3]
                local blockNumber = tonumber(ARGV[4])
                
                local updateCount = 0
                local argIndex = 5
                
                while argIndex <= #ARGV do
                    local walletAddress = ARGV[argIndex]
                    local tokenAddress = ARGV[argIndex + 1]
                    local balance = ARGV[argIndex + 2]
                    
                    local balanceKey = baseKey .. ':balance:' .. walletAddress
                    local metadataKey = baseKey .. ':meta:' .. walletAddress
                    
                    -- Update balance
                    redis.call('HSET', balanceKey, tokenAddress, balance)
                    redis.call('EXPIRE', balanceKey, ttl)
                    
                    -- Update metadata
                    redis.call('HMSET', metadataKey,
                        'blockNumber', blockNumber,
                        'lastUpdate', timestamp,
                        'network', network,
                        'wallet', walletAddress
                    )
                    redis.call('EXPIRE', metadataKey, ttl)
                    
                    updateCount = updateCount + 1
                    argIndex = argIndex + 3
                end
                
                return {updateCount, timestamp}
            `
        });

        // Get balance with staleness check
        this.luaScripts.getBalanceWithMeta = await this.redis.defineCommand('getBalanceWithMeta', {
            numberOfKeys: 2,
            lua: `
                local balanceKey = KEYS[1]
                local metadataKey = KEYS[2]
                local tokenAddress = ARGV[1]
                local maxStaleAge = tonumber(ARGV[2])
                local currentTime = tonumber(ARGV[3])
                
                -- Get balance and metadata
                local balance = redis.call('HGET', balanceKey, tokenAddress)
                local metadata = redis.call('HGETALL', metadataKey)
                
                if not balance then
                    return {nil, nil, 'not_found'}
                end
                
                -- Check staleness
                local lastUpdate = tonumber(metadata[4]) or 0  -- metadata[4] is lastUpdate value
                local age = currentTime - lastUpdate
                local isStale = age > maxStaleAge
                
                return {balance, metadata, isStale and 'stale' or 'fresh'}
            `
        });
    }

    /**
     * Get wallet balance for specific token
     */
    async getBalance(walletAddress, tokenAddress, network = 'ethereum', options = {}) {
        const startTime = Date.now();
        
        try {
            // Validate inputs
            this._validateWalletAddress(walletAddress);
            this._validateTokenAddress(tokenAddress);
            
            const {
                allowStale = this.config.enableStaleServing,
                forceRefresh = false,
                includeUSDValue = false
            } = options;

            const balanceKey = this._getBalanceKey(walletAddress, network);
            const metadataKey = this._getMetadataKey(walletAddress, network);
            
            // Get balance with metadata
            const result = await this.redis.getBalanceWithMeta(
                balanceKey,
                metadataKey,
                tokenAddress,
                this.config.stalenessThreshold,
                Date.now()
            );

            this.state.stats.totalRequests++;

            if (!result[0]) {
                // Cache miss
                this.state.stats.cacheMisses++;
                
                if (forceRefresh || !allowStale) {
                    // Fetch fresh balance
                    const freshBalance = await this._fetchFreshBalance(walletAddress, tokenAddress, network);
                    if (freshBalance) {
                        await this._storeBalance(walletAddress, tokenAddress, freshBalance, network);
                        return this._formatBalanceResponse(freshBalance, includeUSDValue, 'fresh');
                    }
                }
                
                return null;
            }

            // Parse metadata
            const metadata = this._parseMetadata(result[1]);
            const staleness = result[2];
            
            if (staleness === 'stale') {
                this.state.stats.staleServed++;
                
                if (!allowStale || forceRefresh) {
                    // Refresh in background
                    this._scheduleBackgroundRefresh(walletAddress, tokenAddress, network);
                }
            } else {
                this.state.stats.cacheHits++;
            }

            // Check if refresh is needed based on threshold
            if (this._shouldRefresh(metadata) && !forceRefresh) {
                this._scheduleBackgroundRefresh(walletAddress, tokenAddress, network);
            }

            const balance = {
                value: result[0],
                tokenAddress,
                walletAddress,
                network,
                metadata,
                staleness
            };

            this._updateStats('get', Date.now() - startTime);
            return this._formatBalanceResponse(balance, includeUSDValue, staleness);

        } catch (error) {
            console.error('Get balance error:', error);
            throw error;
        }
    }

    /**
     * Get multiple token balances for a wallet
     */
    async getMultipleBalances(walletAddress, tokenAddresses, network = 'ethereum', options = {}) {
        try {
            const balanceKey = this._getBalanceKey(walletAddress, network);
            const metadataKey = this._getMetadataKey(walletAddress, network);
            
            // Get all balances at once
            const balances = await this.redis.hmget(balanceKey, ...tokenAddresses);
            const metadata = await this.redis.hgetall(metadataKey);
            
            const results = {};
            const missingTokens = [];
            
            for (let i = 0; i < tokenAddresses.length; i++) {
                const tokenAddress = tokenAddresses[i];
                const balance = balances[i];
                
                if (balance !== null) {
                    results[tokenAddress] = {
                        value: balance,
                        tokenAddress,
                        walletAddress,
                        network,
                        metadata: this._parseMetadata(Object.entries(metadata)),
                        staleness: this._calculateStaleness(metadata.lastUpdate)
                    };
                } else {
                    missingTokens.push(tokenAddress);
                }
            }
            
            // Fetch missing balances if needed
            if (missingTokens.length > 0 && options.fetchMissing !== false) {
                const freshBalances = await this._batchFetchBalances(walletAddress, missingTokens, network);
                Object.assign(results, freshBalances);
            }
            
            return results;
            
        } catch (error) {
            console.error('Get multiple balances error:', error);
            throw error;
        }
    }

    /**
     * Update wallet balance (usually called from blockchain events)
     */
    async updateBalance(walletAddress, tokenAddress, balance, blockNumber, network = 'ethereum') {
        try {
            this._validateWalletAddress(walletAddress);
            this._validateTokenAddress(tokenAddress);
            this._validateBalance(balance);
            
            const balanceKey = this._getBalanceKey(walletAddress, network);
            const metadataKey = this._getMetadataKey(walletAddress, network);
            
            const result = await this.redis.updateBalance(
                balanceKey,
                metadataKey,
                walletAddress,
                tokenAddress,
                balance.toString(),
                blockNumber,
                Date.now(),
                this.config.ttl,
                network
            );
            
            if (result[0]) {
                // Emit update event for real-time subscribers
                this.emit('balanceUpdated', {
                    walletAddress,
                    tokenAddress,
                    balance,
                    blockNumber,
                    network,
                    timestamp: Date.now()
                });
                
                this.state.stats.refreshes++;
                return { success: true, blockNumber: result[2] };
            } else {
                return { success: false, reason: result[1], currentBlock: result[2] };
            }
            
        } catch (error) {
            console.error('Update balance error:', error);
            throw error;
        }
    }

    /**
     * Batch update multiple wallet balances
     */
    async batchUpdateBalances(updates, network = 'ethereum') {
        const startTime = Date.now();
        
        try {
            if (!Array.isArray(updates) || updates.length === 0) {
                throw new Error('Updates must be a non-empty array');
            }
            
            const baseKey = this._getBaseKey(network);
            const args = [this.config.ttl, Date.now(), network, updates[0].blockNumber || 0];
            
            // Flatten updates into arguments
            for (const update of updates) {
                args.push(
                    update.walletAddress,
                    update.tokenAddress,
                    update.balance.toString()
                );
            }
            
            const result = await this.redis.batchUpdateBalances(baseKey, ...args);
            
            // Emit batch update event
            this.emit('batchBalanceUpdated', {
                updates,
                network,
                updateCount: result[0],
                timestamp: result[1]
            });
            
            this.state.stats.batchOperations++;
            this.state.stats.refreshes += result[0];
            
            this._updateStats('batchUpdate', Date.now() - startTime);
            return { success: true, updateCount: result[0] };
            
        } catch (error) {
            console.error('Batch update balances error:', error);
            throw error;
        }
    }

    /**
     * Refresh all balances for a wallet
     */
    async refreshWalletBalances(walletAddress, network = 'ethereum', tokenAddresses = null) {
        try {
            const refreshKey = `${walletAddress}:${network}`;
            
            // Prevent concurrent refreshes for the same wallet
            if (this.state.activeRefreshes.has(refreshKey)) {
                return { success: false, reason: 'refresh_in_progress' };
            }
            
            this.state.activeRefreshes.add(refreshKey);
            
            try {
                let tokens = tokenAddresses;
                
                // If no specific tokens provided, get all cached tokens
                if (!tokens) {
                    const balanceKey = this._getBalanceKey(walletAddress, network);
                    tokens = await this.redis.hkeys(balanceKey);
                }
                
                if (tokens.length === 0) {
                    return { success: true, refreshed: 0 };
                }
                
                // Fetch fresh balances
                const freshBalances = await this._batchFetchBalances(walletAddress, tokens, network);
                
                // Store updates
                const updates = Object.entries(freshBalances).map(([tokenAddress, balanceData]) => ({
                    walletAddress,
                    tokenAddress,
                    balance: balanceData.value,
                    blockNumber: balanceData.blockNumber || 0
                }));
                
                if (updates.length > 0) {
                    await this.batchUpdateBalances(updates, network);
                }
                
                return { success: true, refreshed: updates.length };
                
            } finally {
                this.state.activeRefreshes.delete(refreshKey);
            }
            
        } catch (error) {
            console.error('Refresh wallet balances error:', error);
            throw error;
        }
    }

    /**
     * Invalidate cached balance
     */
    async invalidateBalance(walletAddress, tokenAddress, network = 'ethereum') {
        try {
            const balanceKey = this._getBalanceKey(walletAddress, network);
            const deleted = await this.redis.hdel(balanceKey, tokenAddress);
            
            return { success: deleted > 0 };
        } catch (error) {
            console.error('Invalidate balance error:', error);
            throw error;
        }
    }

    /**
     * Get wallet portfolio summary
     */
    async getPortfolioSummary(walletAddress, network = 'ethereum', includeUSDValue = true) {
        try {
            const balanceKey = this._getBalanceKey(walletAddress, network);
            const metadataKey = this._getMetadataKey(walletAddress, network);
            
            const [balances, metadata] = await Promise.all([
                this.redis.hgetall(balanceKey),
                this.redis.hgetall(metadataKey)
            ]);
            
            if (Object.keys(balances).length === 0) {
                return null;
            }
            
            const portfolio = {
                walletAddress,
                network,
                tokens: {},
                totalUSDValue: 0,
                tokenCount: 0,
                lastUpdate: parseInt(metadata.lastUpdate) || 0,
                staleness: this._calculateStaleness(metadata.lastUpdate)
            };
            
            for (const [tokenAddress, balance] of Object.entries(balances)) {
                const tokenData = {
                    address: tokenAddress,
                    balance,
                    usdValue: 0
                };
                
                if (includeUSDValue) {
                    const price = await this._getTokenPrice(tokenAddress, network);
                    if (price) {
                        tokenData.usdValue = parseFloat(balance) * price;
                        portfolio.totalUSDValue += tokenData.usdValue;
                    }
                }
                
                portfolio.tokens[tokenAddress] = tokenData;
                portfolio.tokenCount++;
            }
            
            return portfolio;
            
        } catch (error) {
            console.error('Get portfolio summary error:', error);
            throw error;
        }
    }

    /**
     * Get cache statistics
     */
    getStats() {
        return {
            ...this.state.stats,
            hitRate: this.state.stats.totalRequests > 0 
                ? this.state.stats.cacheHits / this.state.stats.totalRequests 
                : 0,
            activeRefreshes: this.state.activeRefreshes.size,
            pendingRefreshes: this.state.pendingRefreshes.size,
            config: {
                ttl: this.config.ttl,
                refreshThreshold: this.config.refreshThreshold,
                stalenessThreshold: this.config.stalenessThreshold,
                batchSize: this.config.batchSize
            }
        };
    }

    /**
     * Health check
     */
    async healthCheck() {
        try {
            const testWallet = '0x0000000000000000000000000000000000000001';
            const testToken = '0x0000000000000000000000000000000000000002';
            const testKey = this._getBalanceKey(testWallet, 'ethereum');
            
            await this.redis.hset(testKey, testToken, '1000');
            const retrieved = await this.redis.hget(testKey, testToken);
            await this.redis.hdel(testKey, testToken);
            
            return {
                status: 'healthy',
                canWrite: retrieved === '1000',
                scriptsLoaded: Object.keys(this.luaScripts).length
            };
        } catch (error) {
            return {
                status: 'unhealthy',
                error: error.message
            };
        }
    }

    // ========== PRIVATE METHODS ==========

    /**
     * Fetch fresh balance from blockchain
     */
    async _fetchFreshBalance(walletAddress, tokenAddress, network) {
        // This would integrate with blockchain RPC or service
        // Mock implementation for now
        return {
            value: '1000000000000000000', // 1 ETH in wei
            blockNumber: Date.now(),
            timestamp: Date.now()
        };
    }

    /**
     * Batch fetch balances from blockchain
     */
    async _batchFetchBalances(walletAddress, tokenAddresses, network) {
        const results = {};
        
        // This would batch fetch from blockchain
        for (const tokenAddress of tokenAddresses) {
            const balance = await this._fetchFreshBalance(walletAddress, tokenAddress, network);
            if (balance) {
                results[tokenAddress] = balance;
            }
        }
        
        return results;
    }

    /**
     * Store balance in cache
     */
    async _storeBalance(walletAddress, tokenAddress, balanceData, network) {
        return this.updateBalance(
            walletAddress,
            tokenAddress,
            balanceData.value,
            balanceData.blockNumber || 0,
            network
        );
    }

    /**
     * Schedule background refresh
     */
    _scheduleBackgroundRefresh(walletAddress, tokenAddress, network) {
        const refreshKey = `${walletAddress}:${tokenAddress}:${network}`;
        
        if (!this.state.pendingRefreshes.has(refreshKey)) {
            this.state.pendingRefreshes.set(refreshKey, setTimeout(async () => {
                try {
                    const freshBalance = await this._fetchFreshBalance(walletAddress, tokenAddress, network);
                    if (freshBalance) {
                        await this._storeBalance(walletAddress, tokenAddress, freshBalance, network);
                    }
                } catch (error) {
                    console.error('Background refresh error:', error);
                } finally {
                    this.state.pendingRefreshes.delete(refreshKey);
                }
            }, 0));
        }
    }

    /**
     * Check if balance should be refreshed
     */
    _shouldRefresh(metadata) {
        if (!metadata.lastUpdate) return true;
        
        const age = Date.now() - parseInt(metadata.lastUpdate);
        const refreshThreshold = this.config.ttl * 1000 * this.config.refreshThreshold;
        
        return age > refreshThreshold;
    }

    /**
     * Calculate staleness status
     */
    _calculateStaleness(lastUpdate) {
        if (!lastUpdate) return 'unknown';
        
        const age = Date.now() - parseInt(lastUpdate);
        
        if (age > this.config.maxStaleAge * 1000) {
            return 'very_stale';
        } else if (age > this.config.stalenessThreshold) {
            return 'stale';
        } else {
            return 'fresh';
        }
    }

    /**
     * Format balance response
     */
    _formatBalanceResponse(balance, includeUSDValue, staleness) {
        const response = {
            ...balance,
            staleness,
            timestamp: Date.now()
        };
        
        if (includeUSDValue && balance.tokenAddress) {
            // Add USD value calculation
            response.usdValue = 0; // Would calculate from price cache
        }
        
        return response;
    }

    /**
     * Parse metadata array into object
     */
    _parseMetadata(metadataArray) {
        const metadata = {};
        
        for (let i = 0; i < metadataArray.length; i += 2) {
            metadata[metadataArray[i]] = metadataArray[i + 1];
        }
        
        return metadata;
    }

    /**
     * Load token prices for USD value calculation
     */
    async _loadTokenPrices() {
        if (this.config.tokenPriceCache) {
            // Implementation would load token prices from external API
            console.log('Token price cache loaded');
        }
    }

    /**
     * Get token price for USD calculation
     */
    async _getTokenPrice(tokenAddress, network) {
        // Implementation would fetch price from cache or API
        return 1; // Mock price
    }

    /**
     * Start refresh scheduler
     */
    async _startRefreshScheduler() {
        setInterval(async () => {
            try {
                // Cleanup expired pending refreshes
                for (const [key, timeout] of this.state.pendingRefreshes) {
                    if (timeout._destroyed) {
                        this.state.pendingRefreshes.delete(key);
                    }
                }
            } catch (error) {
                console.error('Refresh scheduler error:', error);
            }
        }, 60000); // Every minute
    }

    /**
     * Update performance statistics
     */
    _updateStats(operation, responseTime) {
        this.state.stats.avgRefreshTime = 
            (this.state.stats.avgRefreshTime * this.state.stats.refreshes + responseTime) / 
            (this.state.stats.refreshes + 1);
    }

    /**
     * Validation methods
     */
    _validateWalletAddress(address) {
        if (!address || typeof address !== 'string' || !address.match(/^0x[a-fA-F0-9]{40}$/)) {
            throw new Error('Invalid wallet address format');
        }
    }

    _validateTokenAddress(address) {
        if (!address || typeof address !== 'string' || !address.match(/^0x[a-fA-F0-9]{40}$/)) {
            throw new Error('Invalid token address format');
        }
    }

    _validateBalance(balance) {
        if (balance === null || balance === undefined || isNaN(parseFloat(balance))) {
            throw new Error('Invalid balance value');
        }
    }

    /**
     * Generate cache keys
     */
    _getBalanceKey(walletAddress, network) {
        return `wallet:balance:${network}:${walletAddress}`;
    }

    _getMetadataKey(walletAddress, network) {
        return `wallet:meta:${network}:${walletAddress}`;
    }

    _getBaseKey(network) {
        return `wallet:${network}`;
    }

    /**
     * Cleanup resources
     */
    async cleanup() {
        // Clear pending refreshes
        for (const timeout of this.state.pendingRefreshes.values()) {
            clearTimeout(timeout);
        }
        this.state.pendingRefreshes.clear();
        
        console.log('Wallet Balance Cache cleanup completed');
    }
}

module.exports = { WalletBalanceCache };