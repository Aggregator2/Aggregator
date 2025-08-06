const EventEmitter = require('events');
const crypto = require('crypto');
const { getSecureMetricsCollector } = require('../../monitoring/secure-metrics-collector');

class TwoPhaseCommitCoordinator extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      // Validated timeout settings
      prepareTimeout: this.validateNumber(config.prepareTimeout, 30000, 5000, 300000),
      commitTimeout: this.validateNumber(config.commitTimeout, 60000, 10000, 600000),
      abortTimeout: this.validateNumber(config.abortTimeout, 30000, 5000, 300000),
      
      // Retry configuration with validation
      maxRetries: this.validateNumber(config.maxRetries, 3, 1, 10),
      retryBackoff: this.validateNumber(config.retryBackoff, 1000, 100, 10000),
      
      // Performance settings
      maxConcurrentTransactions: this.validateNumber(config.maxConcurrentTransactions, 100, 10, 10000),
      transactionLogSize: this.validateNumber(config.transactionLogSize, 10000, 1000, 1000000),
      
      // Security settings
      authenticationRequired: config.authenticationRequired !== false,
      encryptionEnabled: config.encryptionEnabled !== false,
      
      // Redis configuration for transaction log
      redisUrl: this.sanitizeUrl(config.redisUrl || process.env.REDIS_URL),
      keyPrefix: this.sanitizeKeyPrefix(config.keyPrefix || 'tx:2pc:'),
      
      ...config
    };
    
    this.metrics = getSecureMetricsCollector();
    this.redis = null;
    this.isRunning = false;
    
    // Transaction state management
    this.activeTransactions = new Map(); // txId -> transaction state
    this.participants = new Map(); // participantId -> participant interface
    this.transactionLog = new Map(); // txId -> log entries
    
    // Performance tracking
    this.performanceStats = {
      transactionsStarted: 0,
      transactionsCommitted: 0,
      transactionsAborted: 0,
      averageCommitTime: 0,
      successRate: 0,
      participantFailures: 0
    };
    
    // Timeout management
    this.timeouts = new Map(); // txId -> timeout handles
    
    // Recovery mechanisms
    this.recoveryInterval = null;
    this.recoveryEnabled = config.recoveryEnabled !== false;
    
    // Security tracking
    this.failedAttempts = new Map();
    this.authorizedUsers = new Set();
  }

  validateNumber(value, defaultValue, min, max) {
    if (typeof value !== 'number' || !isFinite(value) || value < min || value > max) {
      return defaultValue;
    }
    return value;
  }

  sanitizeUrl(url) {
    if (!url || typeof url !== 'string') return null;
    try {
      const parsed = new URL(url);
      if (!['redis:', 'rediss:'].includes(parsed.protocol)) {
        throw new Error('Invalid Redis URL protocol');
      }
      return url;
    } catch {
      return null;
    }
  }

  sanitizeKeyPrefix(prefix) {
    if (typeof prefix !== 'string') return 'tx:2pc:';
    return prefix.replace(/[^a-zA-Z0-9:_-]/g, '').substring(0, 50) + ':';
  }

  sanitizeString(input) {
    if (typeof input !== 'string') return '';
    return input.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 200);
  }

  async initialize() {
    try {
      console.log('🔄 Initializing Two-Phase Commit Coordinator...');
      
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
      
      // Recover pending transactions
      if (this.recoveryEnabled) {
        await this.recoverPendingTransactions();
      }
      
      console.log('✅ Two-Phase Commit Coordinator initialized');
    } catch (error) {
      console.error('Failed to initialize Two-Phase Commit Coordinator:', error);
      throw error;
    }
  }

  async start() {
    if (this.isRunning) return;
    
    console.log('🚀 Starting Two-Phase Commit Coordinator...');
    this.isRunning = true;
    
    // Start recovery monitoring
    if (this.recoveryEnabled) {
      this.startRecoveryMonitoring();
    }
    
    // Start performance monitoring
    this.startPerformanceMonitoring();
    
    console.log('✅ Two-Phase Commit Coordinator started');
  }

  startRecoveryMonitoring() {
    this.recoveryInterval = setInterval(async () => {
      try {
        await this.performRecoveryCheck();
      } catch (error) {
        console.error('Recovery check error:', error);
      }
    }, 60000); // Every minute
  }

  startPerformanceMonitoring() {
    this.performanceInterval = setInterval(async () => {
      await this.updatePerformanceMetrics();
    }, 30000); // Every 30 seconds
  }

  // Register a participant in the distributed transaction
  registerParticipant(participantId, participantInterface) {
    const sanitizedId = this.sanitizeString(participantId);
    if (!sanitizedId) {
      throw new Error('Invalid participant ID');
    }
    
    // Validate participant interface
    if (!this.validateParticipantInterface(participantInterface)) {
      throw new Error('Invalid participant interface');
    }
    
    this.participants.set(sanitizedId, {
      id: sanitizedId,
      interface: participantInterface,
      registeredAt: Date.now(),
      healthy: true,
      failureCount: 0
    });
    
    console.log(`Participant registered: ${sanitizedId}`);
  }

  validateParticipantInterface(participant) {
    return participant &&
           typeof participant.prepare === 'function' &&
           typeof participant.commit === 'function' &&
           typeof participant.abort === 'function' &&
           typeof participant.canParticipate === 'function';
  }

  // Start a new distributed transaction
  async startTransaction(transactionData, participantIds = [], authenticatedUser = null) {
    // Security validation
    if (this.config.authenticationRequired && !authenticatedUser) {
      throw new Error('Authentication required for transactions');
    }
    
    // Check concurrent transaction limit
    if (this.activeTransactions.size >= this.config.maxConcurrentTransactions) {
      throw new Error('Maximum concurrent transactions reached');
    }
    
    // Generate secure transaction ID
    const transactionId = this.generateTransactionId();
    
    // Validate participants
    const validatedParticipants = this.validateParticipants(participantIds);
    
    // Create transaction state
    const transaction = {
      id: transactionId,
      state: 'PREPARING',
      participants: validatedParticipants,
      data: this.sanitizeTransactionData(transactionData),
      startTime: Date.now(),
      coordinator: 'local',
      authenticatedUser: authenticatedUser?.id,
      retryCount: 0,
      log: []
    };
    
    // Store transaction
    this.activeTransactions.set(transactionId, transaction);
    
    // Log transaction start
    await this.logTransaction(transactionId, 'TRANSACTION_STARTED', {
      participants: validatedParticipants,
      user: authenticatedUser?.id
    });
    
    // Start prepare phase with timeout
    this.setTransactionTimeout(transactionId, this.config.prepareTimeout, 'PREPARE_TIMEOUT');
    
    try {
      console.log(`Starting transaction: ${transactionId} with ${validatedParticipants.length} participants`);
      
      // Execute prepare phase
      const prepareResult = await this.executePhase1(transactionId);
      
      if (prepareResult.success) {
        return {
          transactionId,
          status: 'PREPARED',
          participants: validatedParticipants.length,
          message: 'All participants prepared successfully'
        };
      } else {
        await this.abortTransaction(transactionId, 'PREPARE_FAILED');
        return {
          transactionId,
          status: 'ABORTED',
          reason: 'PREPARE_FAILED',
          failures: prepareResult.failures
        };
      }
      
    } catch (error) {
      console.error(`Transaction ${transactionId} preparation failed:`, error);
      await this.abortTransaction(transactionId, 'PREPARE_ERROR');
      throw error;
    }
  }

  generateTransactionId() {
    const timestamp = Date.now();
    const random = crypto.randomBytes(8).toString('hex');
    return `tx_${timestamp}_${random}`;
  }

  validateParticipants(participantIds) {
    const validated = [];
    
    for (const id of participantIds) {
      const sanitizedId = this.sanitizeString(id);
      if (sanitizedId && this.participants.has(sanitizedId)) {
        const participant = this.participants.get(sanitizedId);
        if (participant.healthy) {
          validated.push(sanitizedId);
        } else {
          console.warn(`Participant ${sanitizedId} is marked as unhealthy, skipping`);
        }
      } else {
        console.warn(`Unknown participant: ${id}`);
      }
    }
    
    return validated;
  }

  sanitizeTransactionData(data) {
    if (!data || typeof data !== 'object') return {};
    
    // Deep sanitization of transaction data
    const sanitized = {};
    for (const [key, value] of Object.entries(data)) {
      const cleanKey = this.sanitizeString(key);
      if (cleanKey && typeof value !== 'function') {
        if (typeof value === 'string') {
          sanitized[cleanKey] = this.sanitizeString(value);
        } else if (typeof value === 'number' && isFinite(value)) {
          sanitized[cleanKey] = value;
        } else if (typeof value === 'boolean') {
          sanitized[cleanKey] = value;
        } else if (typeof value === 'object' && value !== null) {
          sanitized[cleanKey] = this.sanitizeTransactionData(value);
        }
      }
    }
    
    return sanitized;
  }

  setTransactionTimeout(transactionId, timeoutMs, reason) {
    // Clear existing timeout
    this.clearTransactionTimeout(transactionId);
    
    const timeout = setTimeout(async () => {
      console.warn(`Transaction ${transactionId} timed out: ${reason}`);
      await this.handleTransactionTimeout(transactionId, reason);
    }, timeoutMs);
    
    this.timeouts.set(transactionId, timeout);
  }

  clearTransactionTimeout(transactionId) {
    const timeout = this.timeouts.get(transactionId);
    if (timeout) {
      clearTimeout(timeout);
      this.timeouts.delete(transactionId);
    }
  }

  // Phase 1: Prepare phase
  async executePhase1(transactionId) {
    const transaction = this.activeTransactions.get(transactionId);
    if (!transaction) {
      throw new Error('Transaction not found');
    }
    
    transaction.state = 'PREPARING';
    await this.logTransaction(transactionId, 'PHASE1_STARTED', {});
    
    const preparePromises = transaction.participants.map(async (participantId) => {
      try {
        const participant = this.participants.get(participantId);
        if (!participant) {
          throw new Error(`Participant ${participantId} not found`);
        }
        
        // Check if participant can participate
        const canParticipate = await participant.interface.canParticipate(transaction.data);
        if (!canParticipate) {
          throw new Error(`Participant ${participantId} cannot participate`);
        }
        
        // Execute prepare
        const result = await this.executeWithRetry(
          () => participant.interface.prepare(transactionId, transaction.data),
          this.config.maxRetries
        );
        
        await this.logTransaction(transactionId, 'PARTICIPANT_PREPARED', {
          participantId,
          result
        });
        
        return { participantId, success: true, result };
        
      } catch (error) {
        console.error(`Prepare failed for participant ${participantId}:`, error);
        
        await this.logTransaction(transactionId, 'PARTICIPANT_PREPARE_FAILED', {
          participantId,
          error: error.message
        });
        
        // Mark participant as unhealthy
        const participant = this.participants.get(participantId);
        if (participant) {
          participant.failureCount++;
          if (participant.failureCount >= 3) {
            participant.healthy = false;
          }
        }
        
        return { participantId, success: false, error: error.message };
      }
    });
    
    const results = await Promise.all(preparePromises);
    const failures = results.filter(r => !r.success);
    
    if (failures.length === 0) {
      transaction.state = 'PREPARED';
      await this.logTransaction(transactionId, 'PHASE1_SUCCESS', { results });
      
      return { success: true, results };
    } else {
      transaction.state = 'PREPARE_FAILED';
      await this.logTransaction(transactionId, 'PHASE1_FAILED', { failures });
      
      return { success: false, failures };
    }
  }

  // Phase 2: Commit phase
  async commitTransaction(transactionId, authenticatedUser = null) {
    const transaction = this.activeTransactions.get(transactionId);
    if (!transaction) {
      throw new Error('Transaction not found');
    }
    
    if (transaction.state !== 'PREPARED') {
      throw new Error(`Cannot commit transaction in state: ${transaction.state}`);
    }
    
    // Security check
    if (this.config.authenticationRequired) {
      if (!authenticatedUser || transaction.authenticatedUser !== authenticatedUser.id) {
        throw new Error('Unauthorized commit attempt');
      }
    }
    
    // Clear prepare timeout and set commit timeout
    this.clearTransactionTimeout(transactionId);
    this.setTransactionTimeout(transactionId, this.config.commitTimeout, 'COMMIT_TIMEOUT');
    
    try {
      transaction.state = 'COMMITTING';
      await this.logTransaction(transactionId, 'PHASE2_STARTED', {});
      
      const commitPromises = transaction.participants.map(async (participantId) => {
        try {
          const participant = this.participants.get(participantId);
          if (!participant) {
            throw new Error(`Participant ${participantId} not found`);
          }
          
          const result = await this.executeWithRetry(
            () => participant.interface.commit(transactionId),
            this.config.maxRetries
          );
          
          await this.logTransaction(transactionId, 'PARTICIPANT_COMMITTED', {
            participantId,
            result
          });
          
          return { participantId, success: true, result };
          
        } catch (error) {
          console.error(`Commit failed for participant ${participantId}:`, error);
          
          await this.logTransaction(transactionId, 'PARTICIPANT_COMMIT_FAILED', {
            participantId,
            error: error.message
          });
          
          return { participantId, success: false, error: error.message };
        }
      });
      
      const results = await Promise.all(commitPromises);
      const failures = results.filter(r => !r.success);
      
      if (failures.length === 0) {
        transaction.state = 'COMMITTED';
        transaction.endTime = Date.now();
        
        await this.logTransaction(transactionId, 'TRANSACTION_COMMITTED', {
          duration: transaction.endTime - transaction.startTime,
          results
        });
        
        // Update performance stats
        this.performanceStats.transactionsCommitted++;
        const duration = transaction.endTime - transaction.startTime;
        this.performanceStats.averageCommitTime = 
          (this.performanceStats.averageCommitTime * 0.9) + (duration * 0.1);
        
        // Clean up
        this.clearTransactionTimeout(transactionId);
        this.activeTransactions.delete(transactionId);
        
        this.emit('transaction_committed', {
          transactionId,
          duration,
          participants: transaction.participants.length
        });
        
        console.log(`Transaction committed successfully: ${transactionId}`);
        
        return {
          transactionId,
          status: 'COMMITTED',
          duration,
          participants: results.length
        };
        
      } else {
        // Partial commit failure - this is a critical consistency issue
        transaction.state = 'COMMIT_FAILED';
        
        await this.logTransaction(transactionId, 'TRANSACTION_COMMIT_FAILED', {
          failures,
          criticalInconsistency: true
        });
        
        // Attempt compensation or manual intervention required
        await this.handlePartialCommitFailure(transactionId, failures);
        
        throw new Error(`Partial commit failure - manual intervention required for transaction ${transactionId}`);
      }
      
    } catch (error) {
      console.error(`Transaction ${transactionId} commit failed:`, error);
      await this.logTransaction(transactionId, 'COMMIT_ERROR', { error: error.message });
      throw error;
    }
  }

  // Abort transaction
  async abortTransaction(transactionId, reason = 'USER_ABORT') {
    const transaction = this.activeTransactions.get(transactionId);
    if (!transaction) {
      throw new Error('Transaction not found');
    }
    
    // Clear any existing timeout
    this.clearTransactionTimeout(transactionId);
    this.setTransactionTimeout(transactionId, this.config.abortTimeout, 'ABORT_TIMEOUT');
    
    try {
      transaction.state = 'ABORTING';
      await this.logTransaction(transactionId, 'ABORT_STARTED', { reason });
      
      const abortPromises = transaction.participants.map(async (participantId) => {
        try {
          const participant = this.participants.get(participantId);
          if (!participant) {
            console.warn(`Participant ${participantId} not found during abort`);
            return { participantId, success: true, skipped: true };
          }
          
          const result = await this.executeWithRetry(
            () => participant.interface.abort(transactionId),
            this.config.maxRetries
          );
          
          await this.logTransaction(transactionId, 'PARTICIPANT_ABORTED', {
            participantId,
            result
          });
          
          return { participantId, success: true, result };
          
        } catch (error) {
          console.error(`Abort failed for participant ${participantId}:`, error);
          
          await this.logTransaction(transactionId, 'PARTICIPANT_ABORT_FAILED', {
            participantId,
            error: error.message
          });
          
          return { participantId, success: false, error: error.message };
        }
      });
      
      const results = await Promise.all(abortPromises);
      
      transaction.state = 'ABORTED';
      transaction.endTime = Date.now();
      
      await this.logTransaction(transactionId, 'TRANSACTION_ABORTED', {
        reason,
        duration: transaction.endTime - transaction.startTime,
        results
      });
      
      // Update performance stats
      this.performanceStats.transactionsAborted++;
      
      // Clean up
      this.clearTransactionTimeout(transactionId);
      this.activeTransactions.delete(transactionId);
      
      this.emit('transaction_aborted', {
        transactionId,
        reason,
        duration: transaction.endTime - transaction.startTime
      });
      
      console.log(`Transaction aborted: ${transactionId} (${reason})`);
      
      return {
        transactionId,
        status: 'ABORTED',
        reason,
        results
      };
      
    } catch (error) {
      console.error(`Transaction ${transactionId} abort failed:`, error);
      await this.logTransaction(transactionId, 'ABORT_ERROR', { error: error.message });
      throw error;
    }
  }

  async executeWithRetry(operation, maxRetries) {
    let lastError;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        
        if (attempt < maxRetries) {
          const delay = this.config.retryBackoff * Math.pow(2, attempt);
          await new Promise(resolve => setTimeout(resolve, delay));
          console.log(`Retrying operation (attempt ${attempt + 1}/${maxRetries + 1})...`);
        }
      }
    }
    
    throw lastError;
  }

  async handleTransactionTimeout(transactionId, reason) {
    const transaction = this.activeTransactions.get(transactionId);
    if (!transaction) return;
    
    await this.logTransaction(transactionId, 'TRANSACTION_TIMEOUT', { reason });
    
    // Abort timed out transaction
    try {
      await this.abortTransaction(transactionId, `TIMEOUT_${reason}`);
    } catch (error) {
      console.error(`Failed to abort timed out transaction ${transactionId}:`, error);
    }
  }

  async handlePartialCommitFailure(transactionId, failures) {
    // This is a critical consistency issue that requires special handling
    const transaction = this.activeTransactions.get(transactionId);
    
    await this.logTransaction(transactionId, 'PARTIAL_COMMIT_FAILURE', {
      failures,
      requiresManualIntervention: true
    });
    
    // Emit critical alert
    this.emit('critical_consistency_error', {
      transactionId,
      failures,
      transaction: transaction ? {
        participants: transaction.participants,
        data: transaction.data,
        startTime: transaction.startTime
      } : null
    });
    
    // Mark transaction for manual review
    transaction.state = 'REQUIRES_MANUAL_INTERVENTION';
    transaction.criticalError = true;
    
    console.error(`CRITICAL: Partial commit failure for transaction ${transactionId} - manual intervention required`);
  }

  async logTransaction(transactionId, event, data) {
    const logEntry = {
      transactionId,
      event,
      data,
      timestamp: Date.now(),
      coordinator: 'local'
    };
    
    try {
      // Store in memory log
      const transactionLog = this.transactionLog.get(transactionId) || [];
      transactionLog.push(logEntry);
      this.transactionLog.set(transactionId, transactionLog);
      
      // Persist to Redis for durability
      if (this.redis) {
        const key = `${this.config.keyPrefix}log:${transactionId}`;
        await this.redis.lpush(key, JSON.stringify(logEntry));
        await this.redis.expire(key, 86400); // Expire after 24 hours
      }
      
    } catch (error) {
      console.error('Failed to log transaction event:', error);
    }
  }

  async recoverPendingTransactions() {
    console.log('🔄 Recovering pending transactions...');
    
    try {
      // Scan for transaction logs in Redis
      const keys = await this.redis.keys(`${this.config.keyPrefix}log:*`);
      let recoveredCount = 0;
      
      for (const key of keys) {
        try {
          const transactionId = key.split(':').pop();
          const logs = await this.redis.lrange(key, 0, -1);
          
          if (logs.length > 0) {
            const lastLog = JSON.parse(logs[0]); // Most recent log entry
            
            // Check if transaction needs recovery
            if (this.needsRecovery(lastLog)) {
              await this.recoverTransaction(transactionId, logs);
              recoveredCount++;
            }
          }
        } catch (error) {
          console.error(`Failed to recover transaction from key ${key}:`, error);
        }
      }
      
      console.log(`✅ Recovered ${recoveredCount} pending transactions`);
      
    } catch (error) {
      console.error('Failed to recover pending transactions:', error);
    }
  }

  needsRecovery(lastLog) {
    const recoverableStates = [
      'PHASE1_STARTED',
      'PREPARING',
      'PHASE2_STARTED',
      'COMMITTING',
      'ABORTING'
    ];
    
    return recoverableStates.includes(lastLog.event) || 
           recoverableStates.includes(lastLog.data?.state);
  }

  async recoverTransaction(transactionId, logs) {
    console.log(`Recovering transaction: ${transactionId}`);
    
    try {
      // Parse transaction state from logs
      const parsedLogs = logs.map(log => JSON.parse(log)).reverse();
      const startLog = parsedLogs.find(log => log.event === 'TRANSACTION_STARTED');
      
      if (!startLog) {
        console.warn(`No start log found for transaction ${transactionId}, skipping recovery`);
        return;
      }
      
      // Determine recovery action based on last state
      const lastLog = parsedLogs[parsedLogs.length - 1];
      
      if (lastLog.event === 'PREPARING' || lastLog.event === 'PHASE1_STARTED') {
        // Abort transactions stuck in prepare phase
        await this.forceAbortTransaction(transactionId, 'RECOVERY_PREPARE_TIMEOUT');
      } else if (lastLog.event === 'COMMITTING' || lastLog.event === 'PHASE2_STARTED') {
        // Attempt to complete commit for transactions in commit phase
        await this.forceCompleteCommit(transactionId, startLog.data);
      } else if (lastLog.event === 'ABORTING') {
        // Complete abort for transactions stuck in abort phase
        await this.forceCompleteAbort(transactionId, startLog.data);
      }
      
    } catch (error) {
      console.error(`Failed to recover transaction ${transactionId}:`, error);
    }
  }

  async forceAbortTransaction(transactionId, reason) {
    await this.logTransaction(transactionId, 'FORCE_ABORT', { reason });
    // Implementation depends on specific participant recovery mechanisms
  }

  async forceCompleteCommit(transactionId, transactionData) {
    await this.logTransaction(transactionId, 'FORCE_COMPLETE_COMMIT', {});
    // Implementation depends on specific participant recovery mechanisms
  }

  async forceCompleteAbort(transactionId, transactionData) {
    await this.logTransaction(transactionId, 'FORCE_COMPLETE_ABORT', {});
    // Implementation depends on specific participant recovery mechanisms
  }

  async performRecoveryCheck() {
    // Check for stale transactions
    const now = Date.now();
    const staleThreshold = 300000; // 5 minutes
    
    for (const [transactionId, transaction] of this.activeTransactions) {
      if (now - transaction.startTime > staleThreshold) {
        console.warn(`Stale transaction detected: ${transactionId}`);
        await this.handleStaleTransaction(transactionId);
      }
    }
  }

  async handleStaleTransaction(transactionId) {
    try {
      await this.abortTransaction(transactionId, 'STALE_TRANSACTION');
    } catch (error) {
      console.error(`Failed to abort stale transaction ${transactionId}:`, error);
    }
  }

  async updatePerformanceMetrics() {
    try {
      // Calculate success rate
      const total = this.performanceStats.transactionsCommitted + this.performanceStats.transactionsAborted;
      this.performanceStats.successRate = total > 0 ? 
        this.performanceStats.transactionsCommitted / total : 0;
      
      // Update metrics
      await this.metrics.setGauge('2pc.active_transactions', this.activeTransactions.size, {}, 'consistency');
      await this.metrics.setGauge('2pc.transactions_committed', this.performanceStats.transactionsCommitted, {}, 'consistency');
      await this.metrics.setGauge('2pc.transactions_aborted', this.performanceStats.transactionsAborted, {}, 'consistency');
      await this.metrics.setGauge('2pc.success_rate', this.performanceStats.successRate, {}, 'consistency');
      await this.metrics.setGauge('2pc.average_commit_time', this.performanceStats.averageCommitTime, {}, 'consistency');
      
    } catch (error) {
      console.error('Failed to update performance metrics:', error);
    }
  }

  getTransactionStatus(transactionId) {
    const transaction = this.activeTransactions.get(transactionId);
    if (!transaction) {
      return { error: 'Transaction not found' };
    }
    
    return {
      id: transaction.id,
      state: transaction.state,
      participants: transaction.participants,
      startTime: transaction.startTime,
      endTime: transaction.endTime,
      duration: transaction.endTime ? transaction.endTime - transaction.startTime : Date.now() - transaction.startTime,
      retryCount: transaction.retryCount
    };
  }

  getSystemStatus() {
    return {
      isRunning: this.isRunning,
      activeTransactions: this.activeTransactions.size,
      registeredParticipants: this.participants.size,
      performanceStats: this.performanceStats,
      recoveryEnabled: this.recoveryEnabled
    };
  }

  stop() {
    if (!this.isRunning) return;
    
    console.log('🛑 Stopping Two-Phase Commit Coordinator...');
    
    // Stop intervals
    if (this.recoveryInterval) clearInterval(this.recoveryInterval);
    if (this.performanceInterval) clearInterval(this.performanceInterval);
    
    // Clear all timeouts
    for (const timeout of this.timeouts.values()) {
      clearTimeout(timeout);
    }
    this.timeouts.clear();
    
    // Abort all active transactions
    for (const transactionId of this.activeTransactions.keys()) {
      try {
        this.abortTransaction(transactionId, 'COORDINATOR_SHUTDOWN').catch(console.error);
      } catch (error) {
        console.error(`Failed to abort transaction ${transactionId} during shutdown:`, error);
      }
    }
    
    // Close Redis connection
    if (this.redis) {
      this.redis.quit();
    }
    
    // Clear data structures
    this.activeTransactions.clear();
    this.participants.clear();
    this.transactionLog.clear();
    
    this.isRunning = false;
    console.log('✅ Two-Phase Commit Coordinator stopped');
  }
}

module.exports = TwoPhaseCommitCoordinator;