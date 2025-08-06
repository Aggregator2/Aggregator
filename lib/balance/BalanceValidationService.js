const { ethers } = require('ethers');
const Redis = require('ioredis');
const EventEmitter = require('events');
const { performance } = require('perf_hooks');

/**
 * @class BalanceValidationService
 * @description Comprehensive balance validation service with real-time checking,
 *              multi-chain support, and historical proof capabilities
 * @extends EventEmitter
 * 
 * Features:
 * - Real-time balance checking before order acceptance
 * - Token allowance verification for trading contracts
 * - Multi-chain balance aggregation across networks
 * - Historical balance proofs for dispute resolution
 * - Archive node integration for past state queries
 * - Intelligent caching with transfer-based invalidation
 * - Fraud detection and suspicious activity monitoring
 */
class BalanceValidationService extends EventEmitter {
  /**
   * @param {Object} config - Configuration options
   * @param {Object} config.networks - Network configurations
   * @param {Object} config.redis - Redis configuration
   * @param {Object} config.cache - Cache configuration
   * @param {Object} config.validation - Validation parameters
   */
  constructor(config = {}) {
    super();
    
    this.config = {
      // Network configurations
      networks: {
        ethereum: {
          rpcUrl: config.networks?.ethereum?.rpcUrl || process.env.ETHEREUM_RPC_URL,
          archiveUrl: config.networks?.ethereum?.archiveUrl || process.env.ETHEREUM_ARCHIVE_URL,
          chainId: 1,
          blockTime: 12000, // 12 seconds
          confirmations: 3
        },
        polygon: {
          rpcUrl: config.networks?.polygon?.rpcUrl || process.env.POLYGON_RPC_URL,
          archiveUrl: config.networks?.polygon?.archiveUrl || process.env.POLYGON_ARCHIVE_URL,
          chainId: 137,
          blockTime: 2000, // 2 seconds
          confirmations: 10
        },
        arbitrum: {
          rpcUrl: config.networks?.arbitrum?.rpcUrl || process.env.ARBITRUM_RPC_URL,
          archiveUrl: config.networks?.arbitrum?.archiveUrl || process.env.ARBITRUM_ARCHIVE_URL,
          chainId: 42161,
          blockTime: 1000, // 1 second
          confirmations: 5
        },
        ...config.networks
      },
      
      // Redis configuration
      redis: {
        host: config.redis?.host || 'localhost',
        port: config.redis?.port || 6379,
        password: config.redis?.password,
        db: config.redis?.db || 1,
        keyPrefix: 'balance:',
        ...config.redis
      },
      
      // Cache configuration
      cache: {
        balanceTTL: config.cache?.balanceTTL || 30, // 30 seconds
        allowanceTTL: config.cache?.allowanceTTL || 60, // 60 seconds
        historicalTTL: config.cache?.historicalTTL || 3600, // 1 hour
        maxCacheSize: config.cache?.maxCacheSize || 1000000, // 1M entries
        ...config.cache
      },
      
      // Validation parameters
      validation: {
        minConfirmations: config.validation?.minConfirmations || 3,
        maxHistoryDepth: config.validation?.maxHistoryDepth || 7776000, // 90 days in blocks
        balanceThreshold: config.validation?.balanceThreshold || ethers.utils.parseEther('0.001'),
        proofValidityPeriod: config.validation?.proofValidityPeriod || 86400000, // 24 hours
        suspiciousVelocity: config.validation?.suspiciousVelocity || 10, // 10 transfers per minute
        ...config.validation
      },
      
      ...config
    };
    
    // Network providers
    this.providers = new Map();
    this.archiveProviders = new Map();
    
    // Redis client
    this.redis = this._createRedisClient();
    
    // Cache management
    this.balanceCache = new Map();
    this.allowanceCache = new Map();
    this.historicalCache = new Map();
    this.transferListeners = new Map();
    
    // Performance monitoring
    this.metrics = {
      balanceChecks: 0,
      cacheHits: 0,
      cacheMisses: 0,
      validationTime: [],
      errors: 0,
      proofGenerations: 0
    };
    
    // Fraud detection
    this.suspiciousActivity = new Map();
    this.transferVelocity = new Map();
    
    // Initialize service
    this._initializeProviders();
    this._startMonitoring();
  }

  /**
   * Validate user balance before accepting order
   * @param {string} userAddress - User's wallet address
   * @param {string} tokenAddress - Token contract address
   * @param {string} amount - Required amount (in wei/smallest unit)
   * @param {string} chainId - Network chain ID
   * @param {Object} options - Additional validation options
   * @returns {Promise<Object>} Validation result with detailed information
   */
  async validateBalance(userAddress, tokenAddress, amount, chainId, options = {}) {
    const startTime = performance.now();
    
    try {
      // Input validation
      this._validateInputs(userAddress, tokenAddress, amount, chainId);
      
      // Check cache first
      const cacheKey = this._getBalanceCacheKey(userAddress, tokenAddress, chainId);
      const cached = await this._getCachedBalance(cacheKey);
      
      let balance;
      let blockNumber;
      let fromCache = false;
      
      if (cached && this._isCacheValid(cached)) {
        balance = cached.balance;
        blockNumber = cached.blockNumber;
        fromCache = true;
        this.metrics.cacheHits++;
      } else {
        // Fetch real-time balance
        const balanceData = await this._fetchRealTimeBalance(userAddress, tokenAddress, chainId);
        balance = balanceData.balance;
        blockNumber = balanceData.blockNumber;
        
        // Cache the result
        await this._cacheBalance(cacheKey, balance, blockNumber);
        this.metrics.cacheMisses++;
      }
      
      // Perform validation
      const requiredAmount = ethers.BigNumber.from(amount);
      const hasBalance = balance.gte(requiredAmount);
      
      // Additional checks
      const validationResult = {
        valid: hasBalance,
        userAddress,
        tokenAddress,
        chainId,
        requiredAmount: requiredAmount.toString(),
        actualBalance: balance.toString(),
        blockNumber,
        fromCache,
        timestamp: Date.now(),
        validationTime: performance.now() - startTime
      };
      
      // Check for suspicious activity
      await this._checkSuspiciousActivity(userAddress, tokenAddress, amount, chainId);
      
      // Record metrics
      this.metrics.balanceChecks++;
      this.metrics.validationTime.push(validationResult.validationTime);
      
      // Emit validation event
      this.emit('balance_validated', validationResult);
      
      return validationResult;
      
    } catch (error) {
      this.metrics.errors++;
      this.emit('validation_error', {
        userAddress,
        tokenAddress,
        chainId,
        error: error.message,
        timestamp: Date.now()
      });
      
      throw new Error(`Balance validation failed: ${error.message}`);
    }
  }

  /**
   * Verify token allowance for trading contract
   * @param {string} userAddress - User's wallet address
   * @param {string} tokenAddress - Token contract address
   * @param {string} spenderAddress - Trading contract address
   * @param {string} requiredAmount - Required allowance amount
   * @param {string} chainId - Network chain ID
   * @returns {Promise<Object>} Allowance validation result
   */
  async validateAllowance(userAddress, tokenAddress, spenderAddress, requiredAmount, chainId) {
    try {
      // Input validation
      this._validateInputs(userAddress, tokenAddress, requiredAmount, chainId);
      if (!ethers.utils.isAddress(spenderAddress)) {
        throw new Error('Invalid spender address');
      }
      
      // Check cache
      const cacheKey = this._getAllowanceCacheKey(userAddress, tokenAddress, spenderAddress, chainId);
      const cached = await this._getCachedAllowance(cacheKey);
      
      let allowance;
      let blockNumber;
      let fromCache = false;
      
      if (cached && this._isCacheValid(cached)) {
        allowance = cached.allowance;
        blockNumber = cached.blockNumber;
        fromCache = true;
      } else {
        // Fetch real-time allowance
        const allowanceData = await this._fetchRealTimeAllowance(
          userAddress, tokenAddress, spenderAddress, chainId
        );
        allowance = allowanceData.allowance;
        blockNumber = allowanceData.blockNumber;
        
        // Cache the result
        await this._cacheAllowance(cacheKey, allowance, blockNumber);
      }
      
      // Validate allowance
      const required = ethers.BigNumber.from(requiredAmount);
      const hasAllowance = allowance.gte(required);
      
      return {
        valid: hasAllowance,
        userAddress,
        tokenAddress,
        spenderAddress,
        chainId,
        requiredAmount: required.toString(),
        actualAllowance: allowance.toString(),
        blockNumber,
        fromCache,
        timestamp: Date.now()
      };
      
    } catch (error) {
      this.emit('allowance_validation_error', {
        userAddress,
        tokenAddress,
        spenderAddress,
        chainId,
        error: error.message
      });
      
      throw new Error(`Allowance validation failed: ${error.message}`);
    }
  }

  /**
   * Aggregate balances across multiple chains
   * @param {string} userAddress - User's wallet address
   * @param {string} tokenAddress - Token contract address (or native token symbol)
   * @param {Array<string>} chainIds - Array of chain IDs to check
   * @returns {Promise<Object>} Aggregated balance information
   */
  async aggregateMultiChainBalance(userAddress, tokenAddress, chainIds) {
    try {
      const balancePromises = chainIds.map(async (chainId) => {
        try {
          const result = await this.validateBalance(userAddress, tokenAddress, '0', chainId);
          return {
            chainId,
            balance: result.actualBalance,
            blockNumber: result.blockNumber,
            network: this._getNetworkName(chainId),
            valid: true
          };
        } catch (error) {
          return {
            chainId,
            balance: '0',
            blockNumber: 0,
            network: this._getNetworkName(chainId),
            valid: false,
            error: error.message
          };
        }
      });
      
      const results = await Promise.all(balancePromises);
      
      // Calculate total balance
      const totalBalance = results
        .filter(r => r.valid)
        .reduce((sum, r) => sum.add(ethers.BigNumber.from(r.balance)), ethers.BigNumber.from('0'));
      
      return {
        userAddress,
        tokenAddress,
        chains: results,
        totalBalance: totalBalance.toString(),
        validChains: results.filter(r => r.valid).length,
        timestamp: Date.now()
      };
      
    } catch (error) {
      throw new Error(`Multi-chain balance aggregation failed: ${error.message}`);
    }
  }

  /**
   * Generate historical balance proof for dispute resolution
   * @param {string} userAddress - User's wallet address
   * @param {string} tokenAddress - Token contract address
   * @param {number} blockNumber - Historical block number
   * @param {string} chainId - Network chain ID
   * @returns {Promise<Object>} Historical balance proof with verification data
   */
  async generateHistoricalProof(userAddress, tokenAddress, blockNumber, chainId) {
    try {
      // Check if proof is already cached
      const cacheKey = this._getHistoricalCacheKey(userAddress, tokenAddress, blockNumber, chainId);
      const cached = await this._getCachedHistoricalProof(cacheKey);
      
      if (cached) {
        return cached;
      }
      
      const provider = this.archiveProviders.get(chainId);
      if (!provider) {
        throw new Error(`Archive provider not available for chain ${chainId}`);
      }
      
      // Validate block number
      const currentBlock = await provider.getBlockNumber();
      if (blockNumber > currentBlock) {
        throw new Error('Block number is in the future');
      }
      
      if (currentBlock - blockNumber > this.config.validation.maxHistoryDepth) {
        throw new Error('Block number too old for proof generation');
      }
      
      // Generate proof components
      const proof = await this._generateBalanceProof(userAddress, tokenAddress, blockNumber, chainId);
      
      // Cache the proof
      await this._cacheHistoricalProof(cacheKey, proof);
      
      this.metrics.proofGenerations++;
      
      this.emit('proof_generated', {
        userAddress,
        tokenAddress,
        blockNumber,
        chainId,
        timestamp: Date.now()
      });
      
      return proof;
      
    } catch (error) {
      this.emit('proof_generation_error', {
        userAddress,
        tokenAddress,
        blockNumber,
        chainId,
        error: error.message
      });
      
      throw new Error(`Historical proof generation failed: ${error.message}`);
    }
  }

  /**
   * Verify a historical balance proof
   * @param {Object} proof - Historical balance proof object
   * @returns {Promise<boolean>} Whether the proof is valid
   */
  async verifyHistoricalProof(proof) {
    try {
      const {
        userAddress,
        tokenAddress,
        blockNumber,
        chainId,
        balance,
        merkleProof,
        stateRoot,
        blockHash,
        timestamp
      } = proof;
      
      // Check proof validity period
      if (Date.now() - timestamp > this.config.validation.proofValidityPeriod) {
        return false;
      }
      
      const provider = this.archiveProviders.get(chainId);
      if (!provider) {
        throw new Error(`Archive provider not available for chain ${chainId}`);
      }
      
      // Verify block data
      const block = await provider.getBlock(blockNumber);
      if (block.hash !== blockHash || block.stateRoot !== stateRoot) {
        return false;
      }
      
      // Verify merkle proof (simplified - in production use proper merkle tree verification)
      const verified = await this._verifyMerkleProof(
        userAddress, tokenAddress, balance, merkleProof, stateRoot
      );
      
      this.emit('proof_verified', {
        userAddress,
        tokenAddress,
        blockNumber,
        chainId,
        valid: verified,
        timestamp: Date.now()
      });
      
      return verified;
      
    } catch (error) {
      this.emit('proof_verification_error', {
        proof,
        error: error.message
      });
      
      return false;
    }
  }

  /**
   * Invalidate cache entries based on transfer events
   * @param {string} tokenAddress - Token contract address
   * @param {string} fromAddress - Sender address
   * @param {string} toAddress - Receiver address
   * @param {string} chainId - Network chain ID
   */
  async invalidateBalanceCache(tokenAddress, fromAddress, toAddress, chainId) {
    try {
      const invalidationKeys = [
        this._getBalanceCacheKey(fromAddress, tokenAddress, chainId),
        this._getBalanceCacheKey(toAddress, tokenAddress, chainId)
      ];
      
      // Remove from local cache
      for (const key of invalidationKeys) {
        this.balanceCache.delete(key);
        
        // Remove from Redis cache
        await this.redis.del(key);
      }
      
      // Invalidate related allowance caches
      await this._invalidateAllowanceCaches(tokenAddress, fromAddress, toAddress, chainId);
      
      this.emit('cache_invalidated', {
        tokenAddress,
        fromAddress,
        toAddress,
        chainId,
        keys: invalidationKeys,
        timestamp: Date.now()
      });
      
    } catch (error) {
      console.error('Cache invalidation failed:', error);
    }
  }

  /**
   * Start monitoring transfer events for cache invalidation
   * @param {string} tokenAddress - Token contract address
   * @param {string} chainId - Network chain ID
   */
  async startTransferMonitoring(tokenAddress, chainId) {
    try {
      const provider = this.providers.get(chainId);
      if (!provider) {
        throw new Error(`Provider not available for chain ${chainId}`);
      }
      
      // ERC20 Transfer event filter
      const transferFilter = {
        address: tokenAddress,
        topics: [
          ethers.utils.id('Transfer(address,address,uint256)')
        ]
      };
      
      // Create event listener
      const listener = async (log) => {
        try {
          const decoded = this._decodeTransferEvent(log);
          if (decoded) {
            await this.invalidateBalanceCache(
              tokenAddress,
              decoded.from,
              decoded.to,
              chainId
            );
            
            // Track transfer velocity for fraud detection
            await this._trackTransferVelocity(decoded.from, decoded.to, chainId);
          }
        } catch (error) {
          console.error('Transfer event processing failed:', error);
        }
      };
      
      // Start listening
      provider.on(transferFilter, listener);
      
      // Store listener reference for cleanup
      const listenerKey = `${tokenAddress}-${chainId}`;
      this.transferListeners.set(listenerKey, {
        provider,
        filter: transferFilter,
        listener
      });
      
      this.emit('monitoring_started', {
        tokenAddress,
        chainId,
        timestamp: Date.now()
      });
      
    } catch (error) {
      this.emit('monitoring_error', {
        tokenAddress,
        chainId,
        error: error.message
      });
      
      throw new Error(`Failed to start transfer monitoring: ${error.message}`);
    }
  }

  /**
   * Stop monitoring transfer events
   * @param {string} tokenAddress - Token contract address
   * @param {string} chainId - Network chain ID
   */
  async stopTransferMonitoring(tokenAddress, chainId) {
    const listenerKey = `${tokenAddress}-${chainId}`;
    const listenerData = this.transferListeners.get(listenerKey);
    
    if (listenerData) {
      listenerData.provider.off(listenerData.filter, listenerData.listener);
      this.transferListeners.delete(listenerKey);
      
      this.emit('monitoring_stopped', {
        tokenAddress,
        chainId,
        timestamp: Date.now()
      });
    }
  }

  /**
   * Get service statistics and metrics
   * @returns {Object} Service statistics
   */
  getStatistics() {
    const avgValidationTime = this.metrics.validationTime.length > 0
      ? this.metrics.validationTime.reduce((a, b) => a + b, 0) / this.metrics.validationTime.length
      : 0;
    
    return {
      metrics: {
        ...this.metrics,
        avgValidationTime,
        cacheHitRate: this.metrics.balanceChecks > 0
          ? (this.metrics.cacheHits / this.metrics.balanceChecks * 100).toFixed(2) + '%'
          : '0%'
      },
      cache: {
        balanceCacheSize: this.balanceCache.size,
        allowanceCacheSize: this.allowanceCache.size,
        historicalCacheSize: this.historicalCache.size
      },
      monitoring: {
        activeListeners: this.transferListeners.size,
        suspiciousActivities: this.suspiciousActivity.size
      },
      networks: {
        available: Array.from(this.providers.keys()),
        archiveAvailable: Array.from(this.archiveProviders.keys())
      }
    };
  }

  // Private methods

  /**
   * Initialize network providers
   * @private
   */
  _initializeProviders() {
    for (const [networkName, config] of Object.entries(this.config.networks)) {
      try {
        // Main RPC provider
        if (config.rpcUrl) {
          const provider = new ethers.providers.JsonRpcProvider(config.rpcUrl);
          this.providers.set(config.chainId.toString(), provider);
        }
        
        // Archive RPC provider
        if (config.archiveUrl) {
          const archiveProvider = new ethers.providers.JsonRpcProvider(config.archiveUrl);
          this.archiveProviders.set(config.chainId.toString(), archiveProvider);
        }
      } catch (error) {
        console.error(`Failed to initialize provider for ${networkName}:`, error);
      }
    }
  }

  /**
   * Create Redis client
   * @private
   */
  _createRedisClient() {
    const client = new Redis(this.config.redis);
    
    client.on('error', (error) => {
      console.error('Redis client error:', error);
      this.emit('redis_error', error);
    });
    
    return client;
  }

  /**
   * Validate input parameters
   * @private
   */
  _validateInputs(userAddress, tokenAddress, amount, chainId) {
    if (!ethers.utils.isAddress(userAddress)) {
      throw new Error('Invalid user address');
    }
    
    if (!ethers.utils.isAddress(tokenAddress)) {
      throw new Error('Invalid token address');
    }
    
    try {
      ethers.BigNumber.from(amount);
    } catch {
      throw new Error('Invalid amount format');
    }
    
    if (!this.providers.has(chainId.toString())) {
      throw new Error(`Unsupported chain ID: ${chainId}`);
    }
  }

  /**
   * Fetch real-time balance from blockchain
   * @private
   */
  async _fetchRealTimeBalance(userAddress, tokenAddress, chainId) {
    const provider = this.providers.get(chainId.toString());
    
    let balance;
    const blockNumber = await provider.getBlockNumber();
    
    if (tokenAddress === ethers.constants.AddressZero) {
      // Native token balance
      balance = await provider.getBalance(userAddress, blockNumber);
    } else {
      // ERC20 token balance
      const tokenContract = new ethers.Contract(
        tokenAddress,
        ['function balanceOf(address) view returns (uint256)'],
        provider
      );
      balance = await tokenContract.balanceOf(userAddress, { blockTag: blockNumber });
    }
    
    return { balance, blockNumber };
  }

  /**
   * Fetch real-time allowance from blockchain
   * @private
   */
  async _fetchRealTimeAllowance(userAddress, tokenAddress, spenderAddress, chainId) {
    const provider = this.providers.get(chainId.toString());
    const blockNumber = await provider.getBlockNumber();
    
    const tokenContract = new ethers.Contract(
      tokenAddress,
      ['function allowance(address,address) view returns (uint256)'],
      provider
    );
    
    const allowance = await tokenContract.allowance(userAddress, spenderAddress, {
      blockTag: blockNumber
    });
    
    return { allowance, blockNumber };
  }

  /**
   * Generate cache keys
   * @private
   */
  _getBalanceCacheKey(userAddress, tokenAddress, chainId) {
    return `balance:${chainId}:${tokenAddress}:${userAddress}`;
  }

  _getAllowanceCacheKey(userAddress, tokenAddress, spenderAddress, chainId) {
    return `allowance:${chainId}:${tokenAddress}:${userAddress}:${spenderAddress}`;
  }

  _getHistoricalCacheKey(userAddress, tokenAddress, blockNumber, chainId) {
    return `historical:${chainId}:${tokenAddress}:${userAddress}:${blockNumber}`;
  }

  /**
   * Cache management methods
   * @private
   */
  async _getCachedBalance(key) {
    try {
      const cached = await this.redis.hgetall(key);
      if (cached.balance) {
        return {
          balance: ethers.BigNumber.from(cached.balance),
          blockNumber: parseInt(cached.blockNumber),
          timestamp: parseInt(cached.timestamp)
        };
      }
    } catch (error) {
      console.error('Cache retrieval failed:', error);
    }
    return null;
  }

  async _cacheBalance(key, balance, blockNumber) {
    try {
      await this.redis.hset(key, {
        balance: balance.toString(),
        blockNumber: blockNumber.toString(),
        timestamp: Date.now().toString()
      });
      await this.redis.expire(key, this.config.cache.balanceTTL);
    } catch (error) {
      console.error('Cache storage failed:', error);
    }
  }

  _isCacheValid(cached) {
    const age = Date.now() - cached.timestamp;
    return age < (this.config.cache.balanceTTL * 1000);
  }

  /**
   * Check for suspicious activity
   * @private
   */
  async _checkSuspiciousActivity(userAddress, tokenAddress, amount, chainId) {
    const key = `${userAddress}:${tokenAddress}:${chainId}`;
    const now = Date.now();
    const window = 60000; // 1 minute
    
    if (!this.transferVelocity.has(key)) {
      this.transferVelocity.set(key, []);
    }
    
    const transfers = this.transferVelocity.get(key);
    
    // Remove old transfers
    while (transfers.length > 0 && now - transfers[0] > window) {
      transfers.shift();
    }
    
    transfers.push(now);
    
    // Check if velocity exceeds threshold
    if (transfers.length > this.config.validation.suspiciousVelocity) {
      this.emit('suspicious_activity', {
        userAddress,
        tokenAddress,
        chainId,
        velocity: transfers.length,
        window: window / 1000,
        timestamp: now
      });
    }
  }

  /**
   * Start monitoring processes
   * @private
   */
  _startMonitoring() {
    // Performance metrics cleanup
    setInterval(() => {
      if (this.metrics.validationTime.length > 1000) {
        this.metrics.validationTime = this.metrics.validationTime.slice(-500);
      }
    }, 60000);
    
    // Cache size monitoring
    setInterval(() => {
      this.emit('cache_stats', {
        balanceCache: this.balanceCache.size,
        allowanceCache: this.allowanceCache.size,
        historicalCache: this.historicalCache.size,
        timestamp: Date.now()
      });
    }, 30000);
  }

  /**
   * Cleanup resources
   */
  async shutdown() {
    // Stop all transfer monitoring
    for (const [key] of this.transferListeners) {
      const [tokenAddress, chainId] = key.split('-');
      await this.stopTransferMonitoring(tokenAddress, chainId);
    }
    
    // Close Redis connection
    await this.redis.quit();
    
    // Clear caches
    this.balanceCache.clear();
    this.allowanceCache.clear();
    this.historicalCache.clear();
    
    this.emit('shutdown', { timestamp: Date.now() });
  }
}

module.exports = BalanceValidationService;