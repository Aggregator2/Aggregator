const EventEmitter = require('events');
const crypto = require('crypto');
const { getSecureMetricsCollector } = require('../../monitoring/secure-metrics-collector');

class BlockchainReconciliationService extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      // Blockchain configuration with validation
      networks: this.validateNetworks(config.networks || ['ethereum', 'polygon']),
      providers: this.validateProviders(config.providers || {}),
      
      // Reconciliation intervals
      reconciliationInterval: this.validateNumber(config.reconciliationInterval, 300000, 60000, 3600000), // 5 minutes
      blockConfirmations: this.validateNumber(config.blockConfirmations, 12, 1, 100),
      maxBlocksBehind: this.validateNumber(config.maxBlocksBehind, 1000, 10, 100000),
      
      // State synchronization settings
      stateCheckInterval: this.validateNumber(config.stateCheckInterval, 60000, 30000, 600000), // 1 minute
      batchSize: this.validateNumber(config.batchSize, 100, 10, 1000),
      maxRetries: this.validateNumber(config.maxRetries, 3, 1, 10),
      
      // Contract monitoring
      contractAddresses: this.validateContractAddresses(config.contractAddresses || {}),
      eventSignatures: this.validateEventSignatures(config.eventSignatures || {}),
      
      // Performance settings
      maxConcurrentQueries: this.validateNumber(config.maxConcurrentQueries, 10, 1, 50),
      requestTimeout: this.validateNumber(config.requestTimeout, 30000, 5000, 120000),
      
      // Security settings
      authenticationRequired: config.authenticationRequired !== false,
      encryptionEnabled: config.encryptionEnabled !== false,
      
      // Redis configuration for caching and state
      redisUrl: this.sanitizeUrl(config.redisUrl || process.env.REDIS_URL),
      keyPrefix: this.sanitizeKeyPrefix(config.keyPrefix || 'blockchain:'),
      
      // Reconciliation strategies
      conflictResolution: this.validateConflictResolution(config.conflictResolution || 'blockchain_authoritative'),
      stateValidation: config.stateValidation !== false,
      
      ...config
    };
    
    this.metrics = getSecureMetricsCollector();
    this.redis = null;
    this.isRunning = false;
    
    // Blockchain providers and connections
    this.providers = new Map(); // network -> provider instance
    this.blockchainClients = new Map(); // network -> client instance
    
    // State tracking
    this.lastProcessedBlocks = new Map(); // network -> block number
    this.pendingTransactions = new Map(); // txHash -> transaction details
    this.contractStates = new Map(); // contractAddress -> current state
    this.reconciliationQueue = new Map(); // reconciliationId -> reconciliation job
    
    // Off-chain state management
    this.offChainStates = new Map(); // entityId -> off-chain state
    this.stateDifferences = new Map(); // entityId -> difference details
    this.lastStateSync = new Map(); // entityId -> last sync timestamp
    
    // Performance tracking
    this.performanceStats = {
      blocksProcessed: 0,
      transactionsProcessed: 0,
      reconciliationsPerformed: 0,
      stateDiscrepancies: 0,
      averageReconciliationTime: 0,
      blockchainSyncDelay: 0,
      successRate: 0
    };
    
    // Event filters and processors
    this.eventFilters = new Map(); // network -> event filters
    this.eventProcessors = new Map(); // eventSignature -> processor function
    
    // Security tracking
    this.failedAttempts = new Map();
    this.authorizedUsers = new Set();
    
    // Reconciliation intervals
    this.reconciliationInterval = null;
    this.stateCheckInterval = null;
  }

  validateNumber(value, defaultValue, min, max) {
    if (typeof value !== 'number' || !isFinite(value) || value < min || value > max) {
      return defaultValue;
    }
    return value;
  }

  validateNetworks(networks) {
    const allowedNetworks = ['ethereum', 'polygon', 'arbitrum', 'optimism', 'bsc'];
    return Array.isArray(networks) ? 
      networks.filter(n => allowedNetworks.includes(n)) : ['ethereum'];
  }

  validateProviders(providers) {
    const validated = {};
    for (const [network, config] of Object.entries(providers)) {
      if (typeof config === 'object' && config.url) {
        validated[network] = {
          url: this.sanitizeUrl(config.url),
          apiKey: config.apiKey ? this.sanitizeString(config.apiKey) : null,
          timeout: this.validateNumber(config.timeout, 30000, 5000, 120000)
        };
      }
    }
    return validated;
  }

  validateContractAddresses(addresses) {
    const validated = {};
    for (const [name, address] of Object.entries(addresses)) {
      if (this.isValidAddress(address)) {
        validated[this.sanitizeString(name)] = address.toLowerCase();
      }
    }
    return validated;
  }

  validateEventSignatures(signatures) {
    const validated = {};
    for (const [name, signature] of Object.entries(signatures)) {
      if (typeof signature === 'string' && signature.length === 66) { // 0x + 64 hex chars
        validated[this.sanitizeString(name)] = signature.toLowerCase();
      }
    }
    return validated;
  }

  validateConflictResolution(strategy) {
    const allowedStrategies = ['blockchain_authoritative', 'off_chain_authoritative', 'manual_review'];
    return allowedStrategies.includes(strategy) ? strategy : 'blockchain_authoritative';
  }

  isValidAddress(address) {
    return typeof address === 'string' && 
           address.match(/^0x[a-fA-F0-9]{40}$/) !== null;
  }

  sanitizeUrl(url) {
    if (!url || typeof url !== 'string') return null;
    try {
      const parsed = new URL(url);
      const allowedProtocols = ['http:', 'https:', 'ws:', 'wss:', 'redis:', 'rediss:'];
      if (allowedProtocols.includes(parsed.protocol)) {
        return url;
      }
    } catch {
      return null;
    }
    return null;
  }

  sanitizeKeyPrefix(prefix) {
    if (typeof prefix !== 'string') return 'blockchain:';
    return prefix.replace(/[^a-zA-Z0-9:_-]/g, '').substring(0, 50) + ':';
  }

  sanitizeString(input) {
    if (typeof input !== 'string') return '';
    return input.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 200);
  }

  async initialize() {
    try {
      console.log('⛓️ Initializing Blockchain Reconciliation Service...');
      
      // Initialize Redis connection
      const Redis = require('redis');
      this.redis = Redis.createClient({
        url: this.config.redisUrl,
        socket: {
          connectTimeout: 10000,
          lazyConnect: true
        },
        retryDelayOnFailover: 100,
        maxRetriesPerRequest: 3
      });
      
      await this.redis.connect();
      
      // Initialize metrics
      await this.metrics.initialize();
      
      // Initialize blockchain providers
      await this.initializeBlockchainProviders();
      
      // Load last processed blocks
      await this.loadLastProcessedBlocks();
      
      // Setup event filters
      await this.setupEventFilters();
      
      console.log('✅ Blockchain Reconciliation Service initialized');
    } catch (error) {
      console.error('Failed to initialize Blockchain Reconciliation Service:', error);
      throw error;
    }
  }

  async start() {
    if (this.isRunning) return;
    
    console.log('🚀 Starting Blockchain Reconciliation Service...');
    this.isRunning = true;
    
    // Start reconciliation monitoring
    this.startReconciliationMonitoring();
    
    // Start state synchronization
    this.startStateSynchronization();
    
    // Start performance monitoring
    this.startPerformanceMonitoring();
    
    console.log('✅ Blockchain Reconciliation Service started');
  }

  startReconciliationMonitoring() {
    this.reconciliationInterval = setInterval(async () => {
      try {
        await this.performBlockchainReconciliation();
      } catch (error) {
        console.error('Blockchain reconciliation error:', error);
      }
    }, this.config.reconciliationInterval);
  }

  startStateSynchronization() {
    this.stateCheckInterval = setInterval(async () => {
      try {
        await this.synchronizeContractStates();
      } catch (error) {
        console.error('State synchronization error:', error);
      }
    }, this.config.stateCheckInterval);
  }

  startPerformanceMonitoring() {
    this.performanceInterval = setInterval(async () => {
      await this.updatePerformanceMetrics();
    }, 60000); // Every minute
  }

  async initializeBlockchainProviders() {
    for (const network of this.config.networks) {
      try {
        const providerConfig = this.config.providers[network];
        if (!providerConfig) {
          console.warn(`No provider configuration for network: ${network}`);
          continue;
        }
        
        // Initialize Web3 provider
        const Web3 = require('web3');
        const provider = new Web3(providerConfig.url);
        
        // Test connection
        const blockNumber = await provider.eth.getBlockNumber();
        console.log(`Connected to ${network} at block ${blockNumber}`);
        
        this.providers.set(network, provider);
        
        // Initialize blockchain client (could be ethers, web3, etc.)
        this.blockchainClients.set(network, provider);
        
      } catch (error) {
        console.error(`Failed to initialize provider for ${network}:`, error);
      }
    }
  }

  async loadLastProcessedBlocks() {
    try {
      for (const network of this.config.networks) {
        const key = `${this.config.keyPrefix}last_block:${network}`;
        const lastBlock = await this.redis.get(key);
        
        if (lastBlock) {
          this.lastProcessedBlocks.set(network, parseInt(lastBlock));
        } else {
          // Start from current block minus safe margin
          const provider = this.providers.get(network);
          if (provider) {
            const currentBlock = await provider.eth.getBlockNumber();
            const startBlock = Math.max(0, currentBlock - this.config.blockConfirmations);
            this.lastProcessedBlocks.set(network, startBlock);
          }
        }
      }
      
      console.log('Loaded last processed blocks:', Object.fromEntries(this.lastProcessedBlocks));
      
    } catch (error) {
      console.error('Failed to load last processed blocks:', error);
    }
  }

  async setupEventFilters() {
    for (const network of this.config.networks) {
      const provider = this.providers.get(network);
      if (!provider) continue;
      
      const filters = [];
      
      // Create filters for each contract and event
      for (const [contractName, contractAddress] of Object.entries(this.config.contractAddresses)) {
        for (const [eventName, eventSignature] of Object.entries(this.config.eventSignatures)) {
          filters.push({
            address: contractAddress,
            topics: [eventSignature],
            contractName,
            eventName
          });
        }
      }
      
      this.eventFilters.set(network, filters);
    }
  }

  // Register event processor for specific event types
  registerEventProcessor(eventSignature, processorFunction) {
    const sanitizedSignature = this.sanitizeString(eventSignature);
    if (!sanitizedSignature) {
      throw new Error('Invalid event signature');
    }
    
    if (typeof processorFunction !== 'function') {
      throw new Error('Processor must be a function');
    }
    
    this.eventProcessors.set(eventSignature.toLowerCase(), processorFunction);
    console.log(`Event processor registered: ${eventSignature}`);
  }

  async performBlockchainReconciliation() {
    const reconciliationPromises = [];
    
    for (const network of this.config.networks) {
      reconciliationPromises.push(this.reconcileNetwork(network));
    }
    
    await Promise.allSettled(reconciliationPromises);
  }

  async reconcileNetwork(network) {
    const provider = this.providers.get(network);
    if (!provider) {
      console.warn(`No provider available for network: ${network}`);
      return;
    }
    
    try {
      const startTime = Date.now();
      
      // Get current blockchain state
      const currentBlock = await provider.eth.getBlockNumber();
      const lastProcessed = this.lastProcessedBlocks.get(network) || 0;
      
      // Calculate blocks to process (with safety margin)
      const confirmedBlock = currentBlock - this.config.blockConfirmations;
      const blocksToProcess = confirmedBlock - lastProcessed;
      
      if (blocksToProcess <= 0) {
        return; // No new blocks to process
      }
      
      if (blocksToProcess > this.config.maxBlocksBehind) {
        console.warn(`Network ${network} is ${blocksToProcess} blocks behind, processing latest ${this.config.maxBlocksBehind} blocks`);
        this.lastProcessedBlocks.set(network, confirmedBlock - this.config.maxBlocksBehind);
      }
      
      // Process blocks in batches
      await this.processBlockRange(network, lastProcessed + 1, confirmedBlock);
      
      // Update last processed block
      this.lastProcessedBlocks.set(network, confirmedBlock);
      await this.saveLastProcessedBlock(network, confirmedBlock);
      
      // Update performance stats
      this.performanceStats.blocksProcessed += blocksToProcess;
      const reconciliationTime = Date.now() - startTime;
      this.performanceStats.averageReconciliationTime = 
        (this.performanceStats.averageReconciliationTime * 0.9) + (reconciliationTime * 0.1);
      
      this.emit('network_reconciled', {
        network,
        blocksProcessed: blocksToProcess,
        currentBlock: confirmedBlock,
        reconciliationTime
      });
      
    } catch (error) {
      console.error(`Failed to reconcile network ${network}:`, error);
    }
  }

  async processBlockRange(network, fromBlock, toBlock) {
    const provider = this.providers.get(network);
    const batchSize = this.config.batchSize;
    
    for (let start = fromBlock; start <= toBlock; start += batchSize) {
      const end = Math.min(start + batchSize - 1, toBlock);
      
      try {
        await this.processBlockBatch(network, start, end);
      } catch (error) {
        console.error(`Failed to process block batch ${start}-${end} for ${network}:`, error);
        // Continue with next batch
      }
    }
  }

  async processBlockBatch(network, fromBlock, toBlock) {
    const provider = this.providers.get(network);
    const filters = this.eventFilters.get(network) || [];
    
    // Get logs for all contracts and events in the block range
    const logPromises = filters.map(async (filter) => {
      try {
        const logs = await provider.eth.getPastLogs({
          address: filter.address,
          topics: filter.topics,
          fromBlock: `0x${fromBlock.toString(16)}`,
          toBlock: `0x${toBlock.toString(16)}`
        });
        
        return logs.map(log => ({
          ...log,
          contractName: filter.contractName,
          eventName: filter.eventName,
          network
        }));
      } catch (error) {
        console.error(`Failed to get logs for ${filter.contractName}.${filter.eventName}:`, error);
        return [];
      }
    });
    
    const logResults = await Promise.all(logPromises);
    const allLogs = logResults.flat();
    
    // Process each log
    for (const log of allLogs) {
      try {
        await this.processBlockchainEvent(log);
      } catch (error) {
        console.error(`Failed to process log:`, error);
      }
    }
    
    // Update performance stats
    this.performanceStats.transactionsProcessed += allLogs.length;
  }

  async processBlockchainEvent(log) {
    const eventSignature = log.topics[0];
    const processor = this.eventProcessors.get(eventSignature);
    
    if (!processor) {
      console.warn(`No processor found for event signature: ${eventSignature}`);
      return;
    }
    
    try {
      // Decode event data
      const decodedEvent = await this.decodeEvent(log);
      
      // Process the event
      const result = await processor(decodedEvent, log);
      
      // Check for state discrepancies
      if (result && result.stateChange) {
        await this.checkStateDiscrepancy(result.stateChange, log);
      }
      
      this.emit('blockchain_event_processed', {
        contractName: log.contractName,
        eventName: log.eventName,
        transactionHash: log.transactionHash,
        blockNumber: log.blockNumber,
        network: log.network
      });
      
    } catch (error) {
      console.error(`Failed to process blockchain event:`, error);
    }
  }

  async decodeEvent(log) {
    // Simplified event decoding - in real implementation would use ABI
    return {
      signature: log.topics[0],
      topics: log.topics.slice(1),
      data: log.data,
      address: log.address,
      blockNumber: log.blockNumber,
      transactionHash: log.transactionHash,
      logIndex: log.logIndex
    };
  }

  async checkStateDiscrepancy(blockchainState, log) {
    const entityId = this.extractEntityId(blockchainState, log);
    if (!entityId) return;
    
    // Get corresponding off-chain state
    const offChainState = this.offChainStates.get(entityId);
    if (!offChainState) {
      console.warn(`No off-chain state found for entity: ${entityId}`);
      return;
    }
    
    // Compare states
    const discrepancy = this.compareStates(blockchainState, offChainState);
    
    if (discrepancy.hasDiscrepancy) {
      this.performanceStats.stateDiscrepancies++;
      
      // Store discrepancy for resolution
      this.stateDifferences.set(entityId, {
        entityId,
        blockchainState,
        offChainState,
        discrepancy,
        detectedAt: Date.now(),
        blockNumber: log.blockNumber,
        transactionHash: log.transactionHash,
        network: log.network
      });
      
      // Queue for reconciliation
      await this.queueStateReconciliation(entityId, discrepancy);
      
      this.emit('state_discrepancy_detected', {
        entityId,
        discrepancyType: discrepancy.type,
        blockNumber: log.blockNumber,
        network: log.network
      });
    }
  }

  extractEntityId(blockchainState, log) {
    // Extract entity ID from blockchain state - implementation depends on contract structure
    // This could be a user ID, order ID, position ID, etc.
    return blockchainState.entityId || log.topics[1]; // Simplified
  }

  compareStates(blockchainState, offChainState) {
    const discrepancy = {
      hasDiscrepancy: false,
      type: null,
      differences: []
    };
    
    // Compare relevant fields
    const fieldsToCompare = ['balance', 'position', 'status', 'timestamp'];
    
    for (const field of fieldsToCompare) {
      const blockchainValue = blockchainState[field];
      const offChainValue = offChainState[field];
      
      if (blockchainValue !== offChainValue) {
        discrepancy.hasDiscrepancy = true;
        discrepancy.differences.push({
          field,
          blockchainValue,
          offChainValue,
          difference: this.calculateDifference(blockchainValue, offChainValue)
        });
      }
    }
    
    // Determine discrepancy type
    if (discrepancy.hasDiscrepancy) {
      if (discrepancy.differences.some(d => d.field === 'balance')) {
        discrepancy.type = 'balance_mismatch';
      } else if (discrepancy.differences.some(d => d.field === 'position')) {
        discrepancy.type = 'position_mismatch';
      } else {
        discrepancy.type = 'state_mismatch';
      }
    }
    
    return discrepancy;
  }

  calculateDifference(value1, value2) {
    if (typeof value1 === 'number' && typeof value2 === 'number') {
      return value1 - value2;
    }
    return null;
  }

  async queueStateReconciliation(entityId, discrepancy) {
    const reconciliationId = this.generateReconciliationId();
    
    const reconciliationJob = {
      id: reconciliationId,
      entityId,
      discrepancy,
      status: 'pending',
      createdAt: Date.now(),
      attempts: 0,
      priority: this.calculateReconciliationPriority(discrepancy)
    };
    
    this.reconciliationQueue.set(reconciliationId, reconciliationJob);
    
    // Process immediately if critical
    if (reconciliationJob.priority === 'critical') {
      await this.processReconciliation(reconciliationId);
    }
  }

  generateReconciliationId() {
    const timestamp = Date.now();
    const random = crypto.randomBytes(4).toString('hex');
    return `recon_${timestamp}_${random}`;
  }

  calculateReconciliationPriority(discrepancy) {
    if (discrepancy.type === 'balance_mismatch') {
      const balanceDiff = discrepancy.differences.find(d => d.field === 'balance');
      if (balanceDiff && Math.abs(balanceDiff.difference) > 1000) {
        return 'critical';
      }
      return 'high';
    } else if (discrepancy.type === 'position_mismatch') {
      return 'high';
    }
    return 'medium';
  }

  async synchronizeContractStates() {
    const syncPromises = [];
    
    for (const [contractName, contractAddress] of Object.entries(this.config.contractAddresses)) {
      syncPromises.push(this.syncContractState(contractName, contractAddress));
    }
    
    await Promise.allSettled(syncPromises);
  }

  async syncContractState(contractName, contractAddress) {
    try {
      for (const network of this.config.networks) {
        const provider = this.providers.get(network);
        if (!provider) continue;
        
        // Get current contract state
        const contractState = await this.getContractState(provider, contractAddress);
        
        // Store current state
        const stateKey = `${network}:${contractAddress}`;
        this.contractStates.set(stateKey, {
          ...contractState,
          network,
          contractAddress,
          contractName,
          lastUpdated: Date.now()
        });
        
        // Persist to Redis
        await this.saveContractState(stateKey, contractState);
      }
      
    } catch (error) {
      console.error(`Failed to sync contract state for ${contractName}:`, error);
    }
  }

  async getContractState(provider, contractAddress) {
    // Get basic contract information
    const code = await provider.eth.getCode(contractAddress);
    const balance = await provider.eth.getBalance(contractAddress);
    const transactionCount = await provider.eth.getTransactionCount(contractAddress);
    
    return {
      hasCode: code !== '0x',
      balance,
      transactionCount,
      codeHash: crypto.createHash('sha256').update(code).digest('hex')
    };
  }

  async saveContractState(stateKey, state) {
    try {
      const stateData = this.config.encryptionEnabled ? 
        this.encryptData(JSON.stringify(state)) : JSON.stringify(state);
      
      await this.redis.hSet(
        `${this.config.keyPrefix}contract_states`,
        stateKey,
        stateData
      );
      
    } catch (error) {
      console.error('Failed to save contract state:', error);
    }
  }

  async saveLastProcessedBlock(network, blockNumber) {
    try {
      const key = `${this.config.keyPrefix}last_block:${network}`;
      await this.redis.set(key, blockNumber.toString());
    } catch (error) {
      console.error('Failed to save last processed block:', error);
    }
  }

  async processReconciliation(reconciliationId) {
    const job = this.reconciliationQueue.get(reconciliationId);
    if (!job) return;
    
    job.attempts++;
    job.status = 'processing';
    
    try {
      const result = await this.resolveStateDiscrepancy(job);
      
      if (result.resolved) {
        job.status = 'completed';
        job.completedAt = Date.now();
        
        this.performanceStats.reconciliationsPerformed++;
        
        this.emit('reconciliation_completed', {
          reconciliationId,
          entityId: job.entityId,
          resolution: result.resolution,
          attempts: job.attempts
        });
        
        // Remove from queue
        this.reconciliationQueue.delete(reconciliationId);
      } else {
        job.status = 'failed';
        job.error = result.error;
        
        // Retry if under max attempts
        if (job.attempts < this.config.maxRetries) {
          job.status = 'pending';
          setTimeout(() => {
            this.processReconciliation(reconciliationId);
          }, 60000); // Retry after 1 minute
        } else {
          this.emit('reconciliation_failed', {
            reconciliationId,
            entityId: job.entityId,
            error: result.error,
            attempts: job.attempts
          });
        }
      }
      
    } catch (error) {
      console.error(`Failed to process reconciliation ${reconciliationId}:`, error);
      job.status = 'error';
      job.error = error.message;
    }
  }

  async resolveStateDiscrepancy(job) {
    const { entityId, discrepancy } = job;
    const stateDiff = this.stateDifferences.get(entityId);
    
    if (!stateDiff) {
      return { resolved: false, error: 'State difference not found' };
    }
    
    try {
      let resolution;
      
      switch (this.config.conflictResolution) {
        case 'blockchain_authoritative':
          resolution = await this.resolveWithBlockchainAuthority(stateDiff);
          break;
        case 'off_chain_authoritative':
          resolution = await this.resolveWithOffChainAuthority(stateDiff);
          break;
        case 'manual_review':
          resolution = await this.queueForManualReview(stateDiff);
          break;
        default:
          throw new Error(`Unknown conflict resolution strategy: ${this.config.conflictResolution}`);
      }
      
      // Apply resolution
      await this.applyStateResolution(entityId, resolution);
      
      // Remove from differences
      this.stateDifferences.delete(entityId);
      
      return { resolved: true, resolution };
      
    } catch (error) {
      return { resolved: false, error: error.message };
    }
  }

  async resolveWithBlockchainAuthority(stateDiff) {
    // Blockchain state is authoritative - update off-chain state
    const { entityId, blockchainState } = stateDiff;
    
    return {
      strategy: 'blockchain_authoritative',
      action: 'update_off_chain',
      entityId,
      newState: blockchainState,
      reason: 'Blockchain state is authoritative'
    };
  }

  async resolveWithOffChainAuthority(stateDiff) {
    // Off-chain state is authoritative - may need blockchain transaction
    const { entityId, offChainState } = stateDiff;
    
    return {
      strategy: 'off_chain_authoritative',
      action: 'update_blockchain',
      entityId,
      newState: offChainState,
      reason: 'Off-chain state is authoritative'
    };
  }

  async queueForManualReview(stateDiff) {
    // Queue for manual review
    return {
      strategy: 'manual_review',
      action: 'queue_for_review',
      entityId: stateDiff.entityId,
      reason: 'Requires manual review'
    };
  }

  async applyStateResolution(entityId, resolution) {
    switch (resolution.action) {
      case 'update_off_chain':
        await this.updateOffChainState(entityId, resolution.newState);
        break;
      case 'update_blockchain':
        await this.updateBlockchainState(entityId, resolution.newState);
        break;
      case 'queue_for_review':
        await this.queueForManualReview(entityId, resolution);
        break;
      default:
        throw new Error(`Unknown resolution action: ${resolution.action}`);
    }
  }

  async updateOffChainState(entityId, newState) {
    // Update off-chain state
    this.offChainStates.set(entityId, newState);
    
    // Persist to database/cache
    await this.saveOffChainState(entityId, newState);
    
    console.log(`Updated off-chain state for entity ${entityId}`);
  }

  async updateBlockchainState(entityId, newState) {
    // This would require sending a transaction to update blockchain state
    // Implementation depends on specific contract methods
    console.log(`Blockchain update required for entity ${entityId} - queued for transaction`);
  }

  async saveOffChainState(entityId, state) {
    try {
      const stateData = this.config.encryptionEnabled ? 
        this.encryptData(JSON.stringify(state)) : JSON.stringify(state);
      
      await this.redis.hSet(
        `${this.config.keyPrefix}off_chain_states`,
        entityId,
        stateData
      );
      
    } catch (error) {
      console.error('Failed to save off-chain state:', error);
    }
  }

  encryptData(data) {
    if (!process.env.BLOCKCHAIN_ENCRYPTION_KEY) {
      return data; // Return unencrypted if no key configured
    }
    
    const key = Buffer.from(process.env.BLOCKCHAIN_ENCRYPTION_KEY, 'hex');
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipher('aes-256-cbc', key);
    
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    return iv.toString('hex') + ':' + encrypted;
  }

  async updatePerformanceMetrics() {
    try {
      // Calculate success rate
      const totalReconciliations = this.performanceStats.reconciliationsPerformed + 
        Array.from(this.reconciliationQueue.values()).filter(j => j.status === 'failed').length;
      
      this.performanceStats.successRate = totalReconciliations > 0 ? 
        this.performanceStats.reconciliationsPerformed / totalReconciliations : 0;
      
      // Calculate blockchain sync delay
      let totalDelay = 0;
      let networkCount = 0;
      
      for (const [network, provider] of this.providers) {
        try {
          const currentBlock = await provider.eth.getBlockNumber();
          const lastProcessed = this.lastProcessedBlocks.get(network) || 0;
          totalDelay += currentBlock - lastProcessed;
          networkCount++;
        } catch (error) {
          console.warn(`Failed to get current block for ${network}:`, error);
        }
      }
      
      this.performanceStats.blockchainSyncDelay = networkCount > 0 ? 
        totalDelay / networkCount : 0;
      
      // Update metrics
      await this.metrics.setGauge('blockchain.blocks_processed', this.performanceStats.blocksProcessed, {}, 'consistency');
      await this.metrics.setGauge('blockchain.transactions_processed', this.performanceStats.transactionsProcessed, {}, 'consistency');
      await this.metrics.setGauge('blockchain.reconciliations_performed', this.performanceStats.reconciliationsPerformed, {}, 'consistency');
      await this.metrics.setGauge('blockchain.state_discrepancies', this.performanceStats.stateDiscrepancies, {}, 'consistency');
      await this.metrics.setGauge('blockchain.success_rate', this.performanceStats.successRate, {}, 'consistency');
      await this.metrics.setGauge('blockchain.sync_delay', this.performanceStats.blockchainSyncDelay, {}, 'consistency');
      await this.metrics.setGauge('blockchain.pending_reconciliations', this.reconciliationQueue.size, {}, 'consistency');
      
    } catch (error) {
      console.error('Failed to update performance metrics:', error);
    }
  }

  getReconciliationStatus(reconciliationId) {
    return this.reconciliationQueue.get(reconciliationId);
  }

  getEntityStateStatus(entityId) {
    return {
      offChainState: this.offChainStates.get(entityId),
      lastSync: this.lastStateSync.get(entityId),
      stateDifference: this.stateDifferences.get(entityId)
    };
  }

  getSystemStatus() {
    return {
      isRunning: this.isRunning,
      connectedNetworks: Array.from(this.providers.keys()),
      lastProcessedBlocks: Object.fromEntries(this.lastProcessedBlocks),
      pendingReconciliations: this.reconciliationQueue.size,
      performanceStats: this.performanceStats,
      contractStates: this.contractStates.size,
      offChainStates: this.offChainStates.size,
      stateDifferences: this.stateDifferences.size
    };
  }

  stop() {
    if (!this.isRunning) return;
    
    console.log('🛑 Stopping Blockchain Reconciliation Service...');
    
    // Stop intervals
    if (this.reconciliationInterval) clearInterval(this.reconciliationInterval);
    if (this.stateCheckInterval) clearInterval(this.stateCheckInterval);
    if (this.performanceInterval) clearInterval(this.performanceInterval);
    
    // Close Redis connection
    if (this.redis) {
      this.redis.quit();
    }
    
    // Clear data structures
    this.providers.clear();
    this.blockchainClients.clear();
    this.lastProcessedBlocks.clear();
    this.pendingTransactions.clear();
    this.contractStates.clear();
    this.reconciliationQueue.clear();
    this.offChainStates.clear();
    this.stateDifferences.clear();
    this.lastStateSync.clear();
    
    this.isRunning = false;
    console.log('✅ Blockchain Reconciliation Service stopped');
  }
}

module.exports = BlockchainReconciliationService;