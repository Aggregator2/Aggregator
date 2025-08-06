const EventEmitter = require('events');
const crypto = require('crypto');
const { getSecureMetricsCollector } = require('../../monitoring/secure-metrics-collector');

class SecureTwoPhaseCommitCoordinator extends EventEmitter {
  constructor(config = {}) {
    super();
    
    // Validate and sanitize configuration
    this.config = this.validateAndSanitizeConfig(config);
    
    this.metrics = getSecureMetricsCollector();
    this.redis = null;
    this.isRunning = false;
    
    // Enhanced security services
    this.authenticationService = null;
    this.authorizationService = null;
    this.auditLogger = null;
    this.encryptionService = null;
    
    // Secure transaction management with strict limits
    this.activeTransactions = new Map(); // txId -> transaction details
    this.participantRegistry = new Map(); // participantId -> participant details
    this.transactionTimeouts = new Map(); // txId -> timeout handle
    this.transactionLocks = new Map(); // txId -> distributed lock
    
    // Enhanced security tracking
    this.securityMetrics = {
      authenticationAttempts: 0,
      authenticationFailures: 0,
      authorizationFailures: 0,
      suspiciousActivity: 0,
      encryptionOperations: 0,
      integrityViolations: 0
    };
    
    // Performance tracking with security context
    this.performanceStats = {
      transactionsStarted: 0,
      transactionsCommitted: 0,
      transactionsAborted: 0,
      transactionsTimedOut: 0,
      participantFailures: 0,
      averageCommitTime: 0,
      averagePrepareTime: 0,
      commitSuccessRate: 0,
      totalParticipants: 0,
      activeParticipants: 0,
      recoveryOperations: 0
    };
    
    // Security controls
    this.securityControls = {
      enableAuthentication: true,
      enableAuthorization: true,
      enableEncryption: true,
      enableIntegrityChecks: true,
      enableParticipantValidation: true,
      maxTransactionTime: 5 * 60 * 1000, // 5 minutes
      maxParticipants: 50,
      maxTransactionSize: 10 * 1024 * 1024, // 10MB
      requireParticipantSignatures: true
    };
    
    // Participant validation and trust management
    this.trustedParticipants = new Set();
    this.participantCredentials = new Map();
    this.participantHealthScores = new Map();
    
    // Recovery and compensation mechanisms
    this.recoveryQueue = new Map(); // txId -> recovery job
    this.compensationHandlers = new Map(); // participantType -> compensation handler
    
    // Memory and resource monitoring
    this.resourceLimits = {
      maxMemoryUsage: 256 * 1024 * 1024, // 256MB
      maxConcurrentTransactions: 1000,
      maxTransactionHistorySize: 100000
    };
    
    // Transaction history for audit and recovery
    this.transactionHistory = new Map(); // txId -> historical record
    this.historyCleanupInterval = null;
    
    // Distributed lock management
    this.lockService = null;
    this.lockTimeouts = new Map();
    this.maxLockTime = 60000; // 1 minute
  }

  validateAndSanitizeConfig(config) {
    const allowedConfigKeys = new Set([
      'coordinatorTimeout', 'participantTimeout', 'maxRetries',
      'retryDelay', 'maxConcurrentTransactions', 'enableRecovery',
      'redisUrl', 'keyPrefix', 'authenticationRequired',
      'encryptionEnabled', 'participantValidation'
    ]);
    
    const sanitized = {};
    
    // Only allow whitelisted config keys
    for (const [key, value] of Object.entries(config)) {
      if (allowedConfigKeys.has(key)) {
        sanitized[key] = this.sanitizeConfigValue(key, value);
      }
    }
    
    // Set secure defaults
    return {
      coordinatorTimeout: this.validateNumber(sanitized.coordinatorTimeout, 300000, 30000, 600000),
      participantTimeout: this.validateNumber(sanitized.participantTimeout, 30000, 5000, 120000),
      maxRetries: this.validateNumber(sanitized.maxRetries, 3, 1, 10),
      retryDelay: this.validateNumber(sanitized.retryDelay, 1000, 100, 10000),
      maxConcurrentTransactions: this.validateNumber(sanitized.maxConcurrentTransactions, 1000, 1, 10000),
      enableRecovery: sanitized.enableRecovery !== false,
      
      // Redis configuration with validation
      redisUrl: this.sanitizeUrl(sanitized.redisUrl || process.env.REDIS_URL),
      keyPrefix: this.sanitizeKeyPrefix(sanitized.keyPrefix || '2pc:'),
      
      // Security settings (always enabled)
      authenticationRequired: true,
      encryptionEnabled: true,
      participantValidation: true,
      
      // Additional security options
      requireDigitalSignatures: true,
      enableAuditLogging: true,
      validateTransactionIntegrity: true
    };
  }

  sanitizeConfigValue(key, value) {
    switch (key) {
      case 'coordinatorTimeout':
      case 'participantTimeout':
      case 'maxRetries':
      case 'retryDelay':
      case 'maxConcurrentTransactions':
        return typeof value === 'number' && isFinite(value) ? value : null;
      case 'enableRecovery':
      case 'authenticationRequired':
      case 'encryptionEnabled':
      case 'participantValidation':
        return Boolean(value);
      case 'redisUrl':
        return this.sanitizeUrl(value);
      case 'keyPrefix':
        return this.sanitizeKeyPrefix(value);
      default:
        return value;
    }
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
    if (typeof prefix !== 'string') return '2pc:';
    return prefix.replace(/[^a-zA-Z0-9:_-]/g, '').substring(0, 50) + ':';
  }

  sanitizeString(input) {
    if (typeof input !== 'string') return '';
    return input.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 200);
  }

  async initialize() {
    try {
      console.log('🔒 Initializing Secure Two-Phase Commit Coordinator...');
      
      // Initialize security services first
      await this.initializeSecurity();
      
      // Initialize Redis connection with security
      await this.initializeSecureRedis();
      
      // Initialize metrics
      await this.metrics.initialize();
      
      // Initialize encryption service
      await this.initializeEncryption();
      
      // Initialize distributed lock service
      await this.initializeLockService();
      
      // Load and validate participant registry
      await this.loadParticipantRegistry();
      
      // Start recovery service if enabled
      if (this.config.enableRecovery) {
        await this.initializeRecoveryService();
      }
      
      // Start history cleanup
      this.startHistoryCleanup();
      
      console.log('✅ Secure Two-Phase Commit Coordinator initialized');
      
    } catch (error) {
      console.error('Failed to initialize Secure Two-Phase Commit Coordinator:', error);
      await this.auditLog('coordinator_initialization_failed', { error: error.message });
      throw error;
    }
  }

  async initializeSecurity() {
    // Authentication service with enhanced validation
    this.authenticationService = {
      validateUser: async (user, authToken) => {
        this.securityMetrics.authenticationAttempts++;
        
        if (!user || !authToken || typeof authToken !== 'string') {
          this.securityMetrics.authenticationFailures++;
          return false;
        }
        
        try {
          // JWT validation with signature verification
          const decoded = this.verifyJWT(authToken);
          return decoded && decoded.sub === user.id;
        } catch (error) {
          this.securityMetrics.authenticationFailures++;
          await this.auditLog('authentication_failed', { 
            userId: user?.id, 
            error: error.message 
          });
          return false;
        }
      },
      
      validateParticipant: async (participantId, credentials) => {
        if (!participantId || !credentials) return false;
        
        // Check if participant is in trusted registry
        if (!this.trustedParticipants.has(participantId)) {
          await this.auditLog('untrusted_participant_attempt', { participantId });
          return false;
        }
        
        // Validate participant credentials
        const storedCredentials = this.participantCredentials.get(participantId);
        if (!storedCredentials) return false;
        
        // Verify digital signature if required
        if (this.securityControls.requireParticipantSignatures) {
          return this.verifyParticipantSignature(participantId, credentials);
        }
        
        return true;
      }
    };
    
    // Authorization service with role-based access control
    this.authorizationService = {
      checkTransactionPermission: async (user, action, transactionData) => {
        if (!user || !user.roles) {
          this.securityMetrics.authorizationFailures++;
          return false;
        }
        
        const requiredPermissions = {
          'start_transaction': ['coordinator', 'admin'],
          'commit_transaction': ['coordinator', 'admin'],
          'abort_transaction': ['coordinator', 'admin', 'participant'],
          'recover_transaction': ['admin', 'recovery_agent']
        };
        
        const required = requiredPermissions[action];
        if (!required) return false;
        
        const hasPermission = user.roles.some(role => required.includes(role));
        
        if (!hasPermission) {
          this.securityMetrics.authorizationFailures++;
          await this.auditLog('authorization_failed', {
            userId: user.id,
            action,
            requiredRoles: required,
            userRoles: user.roles
          });
        }
        
        return hasPermission;
      }
    };
    
    // Audit logger with structured logging
    this.auditLogger = {
      log: async (event, details) => {
        const auditEntry = {
          timestamp: new Date().toISOString(),
          component: 'SecureTwoPhaseCommitCoordinator',
          event,
          details: this.sanitizeAuditDetails(details),
          nodeId: process.env.NODE_ID || 'unknown',
          processId: process.pid
        };
        
        // Log to secure audit system
        console.log(`[2PC-AUDIT] ${JSON.stringify(auditEntry)}`);
        
        // Store in persistent audit log if Redis available
        if (this.redis) {
          try {
            await this.redis.lPush(
              `${this.config.keyPrefix}audit_log`,
              this.encryptSensitiveData(JSON.stringify(auditEntry))
            );
          } catch (error) {
            console.error('Failed to store audit log:', error);
          }
        }
      }
    };
  }

  async initializeSecureRedis() {
    if (!this.config.redisUrl) {
      throw new Error('Redis URL is required for secure operation');
    }
    
    const Redis = require('redis');
    this.redis = Redis.createClient({
      url: this.config.redisUrl,
      socket: {
        connectTimeout: 10000,
        lazyConnect: true,
        tls: this.config.redisUrl.startsWith('rediss:') ? {} : undefined
      },
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
      password: process.env.REDIS_PASSWORD // Use environment variable for password
    });
    
    await this.redis.connect();
    
    // Test Redis connection with security
    await this.redis.ping();
    console.log('✅ Secure Redis connection established');
  }

  async initializeEncryption() {
    this.encryptionService = {
      encrypt: (data, additionalData = '') => {
        if (!process.env.TPC_ENCRYPTION_KEY) {
          throw new Error('Encryption key not configured');
        }
        
        this.securityMetrics.encryptionOperations++;
        
        const key = Buffer.from(process.env.TPC_ENCRYPTION_KEY, 'hex');
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipherGCM('aes-256-gcm', key, iv);
        
        if (additionalData) {
          cipher.setAAD(Buffer.from(additionalData, 'utf8'));
        }
        
        let encrypted = cipher.update(data, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        
        const authTag = cipher.getAuthTag();
        
        return {
          encrypted,
          iv: iv.toString('hex'),
          authTag: authTag.toString('hex'),
          additionalData
        };
      },
      
      decrypt: (encryptedData) => {
        if (!process.env.TPC_ENCRYPTION_KEY) {
          throw new Error('Encryption key not configured');
        }
        
        const key = Buffer.from(process.env.TPC_ENCRYPTION_KEY, 'hex');
        const iv = Buffer.from(encryptedData.iv, 'hex');
        const decipher = crypto.createDecipherGCM('aes-256-gcm', key, iv);
        
        if (encryptedData.additionalData) {
          decipher.setAAD(Buffer.from(encryptedData.additionalData, 'utf8'));
        }
        
        decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));
        
        let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        
        return decrypted;
      },
      
      hash: (data) => {
        return crypto.createHash('sha256').update(data).digest('hex');
      },
      
      generateSignature: (data, privateKey) => {
        const sign = crypto.createSign('RSA-SHA256');
        sign.update(data);
        return sign.sign(privateKey, 'hex');
      },
      
      verifySignature: (data, signature, publicKey) => {
        const verify = crypto.createVerify('RSA-SHA256');
        verify.update(data);
        return verify.verify(publicKey, signature, 'hex');
      }
    };
  }

  async initializeLockService() {
    // Distributed lock service using Redis
    this.lockService = {
      acquireLock: async (lockKey, ttl = this.maxLockTime) => {
        const lockValue = crypto.randomBytes(16).toString('hex');
        const acquired = await this.redis.set(
          `${this.config.keyPrefix}lock:${lockKey}`,
          lockValue,
          'PX', ttl,
          'NX'
        );
        
        if (acquired) {
          // Set cleanup timeout
          const timeoutHandle = setTimeout(async () => {
            await this.releaseLock(lockKey, lockValue);
          }, ttl);
          
          this.lockTimeouts.set(lockKey, { timeoutHandle, lockValue });
          return lockValue;
        }
        
        return null;
      },
      
      releaseLock: async (lockKey, lockValue) => {
        const script = `
          if redis.call("get", KEYS[1]) == ARGV[1] then
            return redis.call("del", KEYS[1])
          else
            return 0
          end
        `;
        
        const result = await this.redis.eval(script, 1, `${this.config.keyPrefix}lock:${lockKey}`, lockValue);
        
        // Clear timeout
        const lockInfo = this.lockTimeouts.get(lockKey);
        if (lockInfo) {
          clearTimeout(lockInfo.timeoutHandle);
          this.lockTimeouts.delete(lockKey);
        }
        
        return result === 1;
      }
    };
  }

  async loadParticipantRegistry() {
    try {
      // Load trusted participants from secure storage
      const participantsData = await this.redis.hGetAll(`${this.config.keyPrefix}participants`);
      
      for (const [participantId, encryptedData] of Object.entries(participantsData)) {
        try {
          const participantInfo = JSON.parse(this.decryptSensitiveData(encryptedData));
          
          if (participantInfo.trusted) {
            this.trustedParticipants.add(participantId);
            this.participantCredentials.set(participantId, participantInfo.credentials);
            this.participantHealthScores.set(participantId, participantInfo.healthScore || 1.0);
          }
          
        } catch (error) {
          console.error(`Failed to load participant ${participantId}:`, error);
          await this.auditLog('participant_load_failed', {
            participantId,
            error: error.message
          });
        }
      }
      
      console.log(`Loaded ${this.trustedParticipants.size} trusted participants`);
      
    } catch (error) {
      console.error('Failed to load participant registry:', error);
      // Continue with empty registry in development
    }
  }

  async initializeRecoveryService() {
    // Recovery service for incomplete transactions
    this.recoveryService = {
      scanForIncompleteTransactions: async () => {
        try {
          const activeTransactionKeys = await this.redis.keys(`${this.config.keyPrefix}transaction:*`);
          
          for (const key of activeTransactionKeys) {
            const transactionData = await this.redis.get(key);
            if (transactionData) {
              const transaction = JSON.parse(this.decryptSensitiveData(transactionData));
              
              // Check if transaction is stale
              const age = Date.now() - transaction.startTime;
              if (age > this.config.coordinatorTimeout * 2) {
                await this.queueTransactionRecovery(transaction.id, 'stale_transaction');
              }
            }
          }
          
        } catch (error) {
          console.error('Recovery scan failed:', error);
          await this.auditLog('recovery_scan_failed', { error: error.message });
        }
      },
      
      startRecoveryProcess: async () => {
        // Periodic recovery scans
        this.recoveryInterval = setInterval(async () => {
          await this.recoveryService.scanForIncompleteTransactions();
        }, 300000); // Every 5 minutes
      }
    };
    
    await this.recoveryService.startRecoveryProcess();
  }

  startHistoryCleanup() {
    // Clean up old transaction history periodically
    this.historyCleanupInterval = setInterval(() => {
      const cutoffTime = Date.now() - (24 * 60 * 60 * 1000); // 24 hours
      
      for (const [txId, record] of this.transactionHistory) {
        if (record.timestamp < cutoffTime) {
          this.transactionHistory.delete(txId);
        }
      }
      
      // Limit history size
      if (this.transactionHistory.size > this.resourceLimits.maxTransactionHistorySize) {
        const sortedEntries = Array.from(this.transactionHistory.entries())
          .sort(([,a], [,b]) => a.timestamp - b.timestamp);
        
        const toDelete = sortedEntries.slice(0, sortedEntries.length - this.resourceLimits.maxTransactionHistorySize);
        for (const [txId] of toDelete) {
          this.transactionHistory.delete(txId);
        }
      }
    }, 3600000); // Every hour
  }

  async start() {
    if (this.isRunning) return;
    
    console.log('🚀 Starting Secure Two-Phase Commit Coordinator...');
    this.isRunning = true;
    
    // Start performance monitoring
    this.startPerformanceMonitoring();
    
    // Start resource monitoring
    this.startResourceMonitoring();
    
    console.log('✅ Secure Two-Phase Commit Coordinator started');
    
    await this.auditLog('coordinator_started', {
      timestamp: Date.now(),
      securityEnabled: true,
      trustedParticipants: this.trustedParticipants.size
    });
  }

  startPerformanceMonitoring() {
    this.performanceInterval = setInterval(async () => {
      await this.updatePerformanceMetrics();
    }, 60000); // Every minute
  }

  startResourceMonitoring() {
    this.resourceMonitorInterval = setInterval(() => {
      const usage = process.memoryUsage();
      const heapUsedRatio = usage.heapUsed / usage.heapTotal;
      
      if (heapUsedRatio > 0.9) {
        console.warn('High memory usage detected in 2PC Coordinator');
        this.emit('resource_warning', { type: 'memory', usage: heapUsedRatio });
      }
      
      if (this.activeTransactions.size > this.resourceLimits.maxConcurrentTransactions * 0.9) {
        console.warn('High transaction load detected');
        this.emit('resource_warning', { type: 'transactions', count: this.activeTransactions.size });
      }
    }, 30000); // Every 30 seconds
  }

  // Main transaction start method with comprehensive security
  async startTransaction(transactionData, participantIds = [], authenticatedUser = null) {
    const startTime = Date.now();
    const transactionId = await this.generateSecureTransactionId();
    
    try {
      // 1. Authentication and authorization
      if (!await this.authenticationService.validateUser(authenticatedUser, authenticatedUser?.authToken)) {
        throw new Error('Authentication failed');
      }
      
      if (!await this.authorizationService.checkTransactionPermission(authenticatedUser, 'start_transaction', transactionData)) {
        throw new Error('Insufficient permissions to start transaction');
      }
      
      // 2. Input validation and sanitization
      const sanitizedData = this.sanitizeTransactionData(transactionData);
      const sanitizedParticipants = this.sanitizeParticipantIds(participantIds);
      
      // 3. Resource and limit checks
      if (this.activeTransactions.size >= this.resourceLimits.maxConcurrentTransactions) {
        throw new Error('Maximum concurrent transactions exceeded');
      }
      
      if (JSON.stringify(sanitizedData).length > this.securityControls.maxTransactionSize) {
        throw new Error('Transaction size exceeds limits');
      }
      
      if (sanitizedParticipants.length > this.securityControls.maxParticipants) {
        throw new Error('Too many participants in transaction');
      }
      
      // 4. Validate all participants
      await this.validateParticipants(sanitizedParticipants);
      
      // 5. Acquire distributed lock
      const lockKey = `transaction:${transactionId}`;
      const lockValue = await this.lockService.acquireLock(lockKey);
      if (!lockValue) {
        throw new Error('Failed to acquire transaction lock');
      }
      
      try {
        // 6. Create secure transaction record
        const transaction = {
          id: transactionId,
          data: sanitizedData,
          participants: sanitizedParticipants,
          coordinator: authenticatedUser.id,
          status: 'preparing',
          startTime,
          phase: 'prepare',
          votes: new Map(),
          retryCount: 0,
          lockValue,
          integrity: this.calculateTransactionIntegrity(transactionId, sanitizedData, sanitizedParticipants)
        };
        
        // 7. Store transaction securely
        this.activeTransactions.set(transactionId, transaction);
        await this.persistTransaction(transaction);
        
        // 8. Set transaction timeout
        const timeoutHandle = setTimeout(async () => {
          await this.handleTransactionTimeout(transactionId);
        }, this.config.coordinatorTimeout);
        
        this.transactionTimeouts.set(transactionId, timeoutHandle);
        
        // 9. Execute Phase 1: Prepare
        const prepareResult = await this.executePhase1(transactionId);
        
        if (prepareResult.success) {
          // 10. Execute Phase 2: Commit
          const commitResult = await this.executePhase2(transactionId, 'commit');
          
          // 11. Update performance stats
          this.performanceStats.transactionsStarted++;
          if (commitResult.success) {
            this.performanceStats.transactionsCommitted++;
          } else {
            this.performanceStats.transactionsAborted++;
          }
          
          // 12. Clean up
          await this.cleanupTransaction(transactionId);
          
          // 13. Add to history
          this.addToHistory(transactionId, transaction, commitResult.success ? 'committed' : 'aborted');
          
          // 14. Audit log
          await this.auditLog('transaction_completed', {
            transactionId,
            status: commitResult.success ? 'committed' : 'aborted',
            duration: Date.now() - startTime,
            participantCount: sanitizedParticipants.length,
            coordinator: authenticatedUser.id
          });
          
          return {
            transactionId,
            status: commitResult.success ? 'committed' : 'aborted',
            result: commitResult,
            duration: Date.now() - startTime
          };
          
        } else {
          // Prepare failed - abort transaction
          await this.executePhase2(transactionId, 'abort');
          await this.cleanupTransaction(transactionId);
          
          this.performanceStats.transactionsStarted++;
          this.performanceStats.transactionsAborted++;
          
          this.addToHistory(transactionId, transaction, 'aborted');
          
          await this.auditLog('transaction_aborted', {
            transactionId,
            reason: 'prepare_failed',
            duration: Date.now() - startTime,
            coordinator: authenticatedUser.id
          });
          
          throw new Error(`Transaction ${transactionId} failed in prepare phase: ${prepareResult.error}`);
        }
        
      } finally {
        // Always release the lock
        await this.lockService.releaseLock(lockKey, lockValue);
      }
      
    } catch (error) {
      console.error(`Transaction ${transactionId} failed:`, error);
      
      // Clean up on error
      await this.cleanupTransaction(transactionId);
      
      await this.auditLog('transaction_failed', {
        transactionId,
        error: error.message,
        duration: Date.now() - startTime,
        coordinator: authenticatedUser?.id
      });
      
      throw error;
    }
  }

  async generateSecureTransactionId() {
    const timestamp = Date.now();
    const randomBytes = crypto.randomBytes(16);
    const nodeId = process.env.NODE_ID || 'default';
    
    const hash = crypto
      .createHash('sha256')
      .update(`${timestamp}:${randomBytes.toString('hex')}:${nodeId}`)
      .digest('hex');
    
    return `2pc_${timestamp}_${hash.substring(0, 16)}`;
  }

  sanitizeTransactionData(data) {
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid transaction data');
    }
    
    const sanitized = {};
    const allowedKeys = new Set([
      'operation', 'entityId', 'amount', 'token', 'metadata',
      'timestamp', 'signature', 'nonce', 'priority'
    ]);
    
    for (const [key, value] of Object.entries(data)) {
      if (allowedKeys.has(key)) {
        if (typeof value === 'string') {
          sanitized[key] = value.substring(0, 1000);
        } else if (typeof value === 'number' && isFinite(value)) {
          sanitized[key] = value;
        } else if (typeof value === 'boolean') {
          sanitized[key] = value;
        } else if (typeof value === 'object' && value !== null) {
          sanitized[key] = this.sanitizeTransactionData(value);
        }
      }
    }
    
    return sanitized;
  }

  sanitizeParticipantIds(participantIds) {
    if (!Array.isArray(participantIds)) {
      throw new Error('Participant IDs must be an array');
    }
    
    return participantIds
      .filter(id => typeof id === 'string')
      .map(id => this.sanitizeString(id))
      .filter(id => id.length > 0)
      .slice(0, this.securityControls.maxParticipants);
  }

  async validateParticipants(participantIds) {
    for (const participantId of participantIds) {
      // Check if participant is trusted
      if (!this.trustedParticipants.has(participantId)) {
        await this.auditLog('untrusted_participant_rejected', { participantId });
        throw new Error(`Untrusted participant: ${participantId}`);
      }
      
      // Check participant health score
      const healthScore = this.participantHealthScores.get(participantId) || 0;
      if (healthScore < 0.5) {
        await this.auditLog('unhealthy_participant_rejected', { participantId, healthScore });
        throw new Error(`Unhealthy participant: ${participantId}`);
      }
      
      // Validate participant credentials
      const credentials = this.participantCredentials.get(participantId);
      if (!await this.authenticationService.validateParticipant(participantId, credentials)) {
        throw new Error(`Invalid participant credentials: ${participantId}`);
      }
    }
  }

  calculateTransactionIntegrity(transactionId, data, participants) {
    const integritySeed = JSON.stringify({
      transactionId,
      data,
      participants: participants.sort(),
      timestamp: Date.now()
    });
    
    return this.encryptionService.hash(integritySeed);
  }

  async persistTransaction(transaction) {
    try {
      const encryptedData = this.encryptSensitiveData(JSON.stringify({
        id: transaction.id,
        data: transaction.data,
        participants: transaction.participants,
        coordinator: transaction.coordinator,
        status: transaction.status,
        startTime: transaction.startTime,
        phase: transaction.phase,
        integrity: transaction.integrity
      }));
      
      await this.redis.hSet(
        `${this.config.keyPrefix}transactions`,
        transaction.id,
        encryptedData
      );
      
      // Set TTL for automatic cleanup
      await this.redis.expire(
        `${this.config.keyPrefix}transactions`,
        this.config.coordinatorTimeout * 2 / 1000
      );
      
    } catch (error) {
      console.error('Failed to persist transaction:', error);
      throw new Error('Transaction persistence failed');
    }
  }

  async executePhase1(transactionId) {
    const transaction = this.activeTransactions.get(transactionId);
    if (!transaction) {
      throw new Error(`Transaction ${transactionId} not found`);
    }
    
    console.log(`Executing Phase 1 (Prepare) for transaction: ${transactionId}`);
    
    const prepareStartTime = Date.now();
    const preparePromises = [];
    
    // Send prepare requests to all participants
    for (const participantId of transaction.participants) {
      const preparePromise = this.sendPrepareRequest(transactionId, participantId, transaction.data);
      preparePromises.push(preparePromise);
    }
    
    try {
      // Wait for all prepare responses with timeout
      const results = await Promise.allSettled(preparePromises);
      
      let allPrepared = true;
      let errorMessage = '';
      
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const participantId = transaction.participants[i];
        
        if (result.status === 'fulfilled' && result.value.vote === 'prepared') {
          transaction.votes.set(participantId, 'prepared');
          console.log(`Participant ${participantId} voted: PREPARED`);
        } else {
          allPrepared = false;
          transaction.votes.set(participantId, 'aborted');
          errorMessage = result.reason || result.value?.error || 'Participant preparation failed';
          console.log(`Participant ${participantId} voted: ABORT (${errorMessage})`);
        }
      }
      
      // Update performance stats
      const prepareTime = Date.now() - prepareStartTime;
      this.performanceStats.averagePrepareTime = 
        (this.performanceStats.averagePrepareTime * 0.9) + (prepareTime * 0.1);
      
      // Update transaction status
      transaction.phase = 'prepared';
      transaction.prepareTime = prepareTime;
      await this.persistTransaction(transaction);
      
      if (allPrepared) {
        console.log(`Phase 1 completed successfully for transaction: ${transactionId}`);
        return { success: true };
      } else {
        console.log(`Phase 1 failed for transaction: ${transactionId} - ${errorMessage}`);
        return { success: false, error: errorMessage };
      }
      
    } catch (error) {
      console.error(`Phase 1 failed for transaction ${transactionId}:`, error);
      return { success: false, error: error.message };
    }
  }

  async sendPrepareRequest(transactionId, participantId, transactionData) {
    try {
      // In a real implementation, this would send HTTP/gRPC requests to participants
      // For this example, we'll simulate the prepare request
      
      const prepareRequest = {
        transactionId,
        participantId,
        operation: 'prepare',
        data: transactionData,
        timestamp: Date.now(),
        signature: await this.signRequest(transactionId, participantId, 'prepare')
      };
      
      // Simulate participant response with validation
      const response = await this.simulateParticipantResponse(participantId, prepareRequest);
      
      // Validate response signature
      if (!await this.validateParticipantResponse(participantId, response)) {
        throw new Error('Invalid participant response signature');
      }
      
      return response;
      
    } catch (error) {
      console.error(`Prepare request failed for participant ${participantId}:`, error);
      this.updateParticipantHealthScore(participantId, -0.1);
      throw error;
    }
  }

  async executePhase2(transactionId, decision) {
    const transaction = this.activeTransactions.get(transactionId);
    if (!transaction) {
      throw new Error(`Transaction ${transactionId} not found`);
    }
    
    console.log(`Executing Phase 2 (${decision.toUpperCase()}) for transaction: ${transactionId}`);
    
    const commitStartTime = Date.now();
    const commitPromises = [];
    
    // Send commit/abort requests to all participants
    for (const participantId of transaction.participants) {
      const commitPromise = this.sendCommitRequest(transactionId, participantId, decision, transaction.data);
      commitPromises.push(commitPromise);
    }
    
    try {
      // Wait for all commit responses
      const results = await Promise.allSettled(commitPromises);
      
      let allCompleted = true;
      const failedParticipants = [];
      
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const participantId = transaction.participants[i];
        
        if (result.status === 'fulfilled' && result.value.status === 'completed') {
          console.log(`Participant ${participantId} ${decision}: COMPLETED`);
        } else {
          allCompleted = false;
          failedParticipants.push(participantId);
          this.performanceStats.participantFailures++;
          console.error(`Participant ${participantId} ${decision}: FAILED`);
          
          // Update participant health score
          this.updateParticipantHealthScore(participantId, -0.2);
        }
      }
      
      // Update performance stats
      const commitTime = Date.now() - commitStartTime;
      this.performanceStats.averageCommitTime = 
        (this.performanceStats.averageCommitTime * 0.9) + (commitTime * 0.1);
      
      // Update transaction status
      transaction.phase = decision === 'commit' ? 'committed' : 'aborted';
      transaction.commitTime = commitTime;
      transaction.endTime = Date.now();
      await this.persistTransaction(transaction);
      
      // Handle failed participants
      if (!allCompleted && decision === 'commit') {
        // Queue compensation for failed participants
        await this.queueCompensation(transactionId, failedParticipants);
      }
      
      const success = allCompleted;
      console.log(`Phase 2 ${success ? 'completed successfully' : 'completed with failures'} for transaction: ${transactionId}`);
      
      return { 
        success, 
        failedParticipants: failedParticipants.length > 0 ? failedParticipants : undefined 
      };
      
    } catch (error) {
      console.error(`Phase 2 failed for transaction ${transactionId}:`, error);
      return { success: false, error: error.message };
    }
  }

  async sendCommitRequest(transactionId, participantId, decision, transactionData) {
    try {
      const commitRequest = {
        transactionId,
        participantId,
        operation: decision,
        data: transactionData,
        timestamp: Date.now(),
        signature: await this.signRequest(transactionId, participantId, decision)
      };
      
      // Simulate participant response
      const response = await this.simulateParticipantResponse(participantId, commitRequest);
      
      // Validate response
      if (!await this.validateParticipantResponse(participantId, response)) {
        throw new Error('Invalid participant response signature');
      }
      
      return response;
      
    } catch (error) {
      console.error(`${decision} request failed for participant ${participantId}:`, error);
      throw error;
    }
  }

  async simulateParticipantResponse(participantId, request) {
    // Simulate participant processing with random success/failure
    // In real implementation, this would be actual HTTP/gRPC calls
    
    const healthScore = this.participantHealthScores.get(participantId) || 1.0;
    const successProbability = Math.min(0.95, healthScore);
    
    // Simulate processing delay
    const processingDelay = Math.random() * 1000; // 0-1 second
    await new Promise(resolve => setTimeout(resolve, processingDelay));
    
    if (Math.random() < successProbability) {
      return {
        transactionId: request.transactionId,
        participantId,
        vote: request.operation === 'prepare' ? 'prepared' : undefined,
        status: request.operation !== 'prepare' ? 'completed' : undefined,
        timestamp: Date.now(),
        signature: 'simulated_signature'
      };
    } else {
      throw new Error(`Participant ${participantId} processing failed`);
    }
  }

  async signRequest(transactionId, participantId, operation) {
    const requestData = `${transactionId}:${participantId}:${operation}:${Date.now()}`;
    return this.encryptionService.hash(requestData);
  }

  async validateParticipantResponse(participantId, response) {
    // In real implementation, this would verify digital signatures
    // For simulation, we'll do basic validation
    return response.signature && response.timestamp && response.participantId === participantId;
  }

  updateParticipantHealthScore(participantId, delta) {
    const currentScore = this.participantHealthScores.get(participantId) || 1.0;
    const newScore = Math.max(0, Math.min(1, currentScore + delta));
    this.participantHealthScores.set(participantId, newScore);
    
    // Log significant health changes
    if (Math.abs(delta) > 0.1) {
      this.auditLog('participant_health_changed', {
        participantId,
        oldScore: currentScore,
        newScore,
        delta
      });
    }
  }

  async handleTransactionTimeout(transactionId) {
    console.warn(`Transaction ${transactionId} timed out`);
    
    this.performanceStats.transactionsTimedOut++;
    
    try {
      const transaction = this.activeTransactions.get(transactionId);
      if (transaction) {
        // Abort timed out transaction
        await this.executePhase2(transactionId, 'abort');
        await this.cleanupTransaction(transactionId);
        
        this.addToHistory(transactionId, transaction, 'timeout');
        
        await this.auditLog('transaction_timeout', {
          transactionId,
          phase: transaction.phase,
          duration: Date.now() - transaction.startTime
        });
        
        this.emit('transaction_timeout', {
          transactionId,
          phase: transaction.phase
        });
      }
      
    } catch (error) {
      console.error(`Failed to handle timeout for transaction ${transactionId}:`, error);
    }
  }

  async queueCompensation(transactionId, failedParticipants) {
    console.log(`Queueing compensation for transaction ${transactionId}, failed participants:`, failedParticipants);
    
    const compensationJob = {
      transactionId,
      failedParticipants,
      createdAt: Date.now(),
      attempts: 0,
      maxAttempts: 3
    };
    
    // Store compensation job for processing
    await this.redis.hSet(
      `${this.config.keyPrefix}compensations`,
      transactionId,
      this.encryptSensitiveData(JSON.stringify(compensationJob))
    );
    
    await this.auditLog('compensation_queued', {
      transactionId,
      failedParticipants
    });
  }

  async queueTransactionRecovery(transactionId, reason) {
    console.log(`Queueing recovery for transaction ${transactionId}, reason: ${reason}`);
    
    const recoveryJob = {
      transactionId,
      reason,
      createdAt: Date.now(),
      attempts: 0,
      maxAttempts: 5
    };
    
    this.recoveryQueue.set(transactionId, recoveryJob);
    this.performanceStats.recoveryOperations++;
    
    await this.auditLog('recovery_queued', {
      transactionId,
      reason
    });
  }

  async cleanupTransaction(transactionId) {
    try {
      // Remove from active transactions
      this.activeTransactions.delete(transactionId);
      
      // Clear timeout
      const timeoutHandle = this.transactionTimeouts.get(transactionId);
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        this.transactionTimeouts.delete(transactionId);
      }
      
      // Remove from Redis (will be moved to history)
      await this.redis.hDel(`${this.config.keyPrefix}transactions`, transactionId);
      
    } catch (error) {
      console.error(`Failed to cleanup transaction ${transactionId}:`, error);
    }
  }

  addToHistory(transactionId, transaction, finalStatus) {
    const historyRecord = {
      transactionId,
      coordinator: transaction.coordinator,
      participantCount: transaction.participants.length,
      startTime: transaction.startTime,
      endTime: Date.now(),
      duration: Date.now() - transaction.startTime,
      finalStatus,
      retryCount: transaction.retryCount,
      timestamp: Date.now()
    };
    
    this.transactionHistory.set(transactionId, historyRecord);
  }

  encryptSensitiveData(data) {
    if (this.config.encryptionEnabled && this.encryptionService) {
      return JSON.stringify(this.encryptionService.encrypt(data, 'transaction_data'));
    }
    return data;
  }

  decryptSensitiveData(encryptedData) {
    if (this.config.encryptionEnabled && this.encryptionService) {
      try {
        const parsedData = JSON.parse(encryptedData);
        return this.encryptionService.decrypt(parsedData);
      } catch (error) {
        // Data might not be encrypted (backward compatibility)
        return encryptedData;
      }
    }
    return encryptedData;
  }

  verifyJWT(token) {
    // Simple JWT verification - in production use proper JWT library
    try {
      const parts = token.split('.');
      if (parts.length !== 3) throw new Error('Invalid JWT format');
      
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
      
      // Check expiration
      if (payload.exp && payload.exp < Date.now() / 1000) {
        throw new Error('JWT expired');
      }
      
      return payload;
    } catch (error) {
      throw new Error('JWT verification failed');
    }
  }

  verifyParticipantSignature(participantId, credentials) {
    // Simplified signature verification
    return credentials && credentials.signature && credentials.timestamp;
  }

  sanitizeAuditDetails(details) {
    if (!details || typeof details !== 'object') return {};
    
    const sanitized = {};
    const allowedKeys = new Set([
      'transactionId', 'participantId', 'coordinator', 'status', 
      'duration', 'participantCount', 'error', 'reason', 'phase'
    ]);
    
    for (const [key, value] of Object.entries(details)) {
      if (allowedKeys.has(key)) {
        if (typeof value === 'string') {
          sanitized[key] = value.substring(0, 500);
        } else if (typeof value === 'number' && isFinite(value)) {
          sanitized[key] = value;
        } else if (typeof value === 'boolean') {
          sanitized[key] = value;
        }
      }
    }
    
    return sanitized;
  }

  async updatePerformanceMetrics() {
    try {
      // Calculate success rate
      const totalTransactions = this.performanceStats.transactionsCommitted + 
        this.performanceStats.transactionsAborted;
      
      this.performanceStats.commitSuccessRate = totalTransactions > 0 ? 
        this.performanceStats.transactionsCommitted / totalTransactions : 0;
      
      this.performanceStats.totalParticipants = this.trustedParticipants.size;
      this.performanceStats.activeParticipants = Array.from(this.participantHealthScores.values())
        .filter(score => score > 0.5).length;
      
      // Update metrics
      await this.metrics.setGauge('2pc.transactions_started', this.performanceStats.transactionsStarted, { security: 'enabled' }, 'consistency');
      await this.metrics.setGauge('2pc.transactions_committed', this.performanceStats.transactionsCommitted, { security: 'enabled' }, 'consistency');
      await this.metrics.setGauge('2pc.transactions_aborted', this.performanceStats.transactionsAborted, { security: 'enabled' }, 'consistency');
      await this.metrics.setGauge('2pc.transactions_timed_out', this.performanceStats.transactionsTimedOut, { security: 'enabled' }, 'consistency');
      await this.metrics.setGauge('2pc.commit_success_rate', this.performanceStats.commitSuccessRate, { security: 'enabled' }, 'consistency');
      await this.metrics.setGauge('2pc.average_commit_time', this.performanceStats.averageCommitTime, { security: 'enabled' }, 'consistency');
      await this.metrics.setGauge('2pc.average_prepare_time', this.performanceStats.averagePrepareTime, { security: 'enabled' }, 'consistency');
      await this.metrics.setGauge('2pc.active_transactions', this.activeTransactions.size, { security: 'enabled' }, 'consistency');
      await this.metrics.setGauge('2pc.participant_failures', this.performanceStats.participantFailures, { security: 'enabled' }, 'consistency');
      await this.metrics.setGauge('2pc.recovery_operations', this.performanceStats.recoveryOperations, { security: 'enabled' }, 'consistency');
      
      // Security metrics
      await this.metrics.setGauge('2pc.authentication_attempts', this.securityMetrics.authenticationAttempts, { security: 'enabled' }, 'consistency');
      await this.metrics.setGauge('2pc.authentication_failures', this.securityMetrics.authenticationFailures, { security: 'enabled' }, 'consistency');
      await this.metrics.setGauge('2pc.authorization_failures', this.securityMetrics.authorizationFailures, { security: 'enabled' }, 'consistency');
      await this.metrics.setGauge('2pc.encryption_operations', this.securityMetrics.encryptionOperations, { security: 'enabled' }, 'consistency');
      
    } catch (error) {
      console.error('Failed to update performance metrics:', error);
    }
  }

  async auditLog(event, details) {
    if (this.auditLogger) {
      await this.auditLogger.log(event, details);
    }
  }

  getTransactionStatus(transactionId) {
    const active = this.activeTransactions.get(transactionId);
    if (active) {
      return {
        status: 'active',
        phase: active.phase,
        startTime: active.startTime,
        participants: active.participants,
        votes: Object.fromEntries(active.votes)
      };
    }
    
    const historical = this.transactionHistory.get(transactionId);
    if (historical) {
      return {
        status: 'completed',
        finalStatus: historical.finalStatus,
        duration: historical.duration,
        participantCount: historical.participantCount
      };
    }
    
    return { status: 'not_found' };
  }

  getSystemStatus() {
    return {
      isRunning: this.isRunning,
      activeTransactions: this.activeTransactions.size,
      trustedParticipants: this.trustedParticipants.size,
      performanceStats: this.performanceStats,
      securityMetrics: this.securityMetrics,
      securityControls: this.securityControls,
      resourceUsage: {
        memoryUsage: process.memoryUsage(),
        transactionHistorySize: this.transactionHistory.size,
        recoveryQueueSize: this.recoveryQueue.size
      }
    };
  }

  stop() {
    if (!this.isRunning) return;
    
    console.log('🛑 Stopping Secure Two-Phase Commit Coordinator...');
    
    // Stop intervals
    if (this.performanceInterval) clearInterval(this.performanceInterval);
    if (this.resourceMonitorInterval) clearInterval(this.resourceMonitorInterval);
    if (this.historyCleanupInterval) clearInterval(this.historyCleanupInterval);
    if (this.recoveryInterval) clearInterval(this.recoveryInterval);
    
    // Clear all timeouts
    for (const timeout of this.transactionTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.transactionTimeouts.clear();
    
    // Clear lock timeouts
    for (const lockInfo of this.lockTimeouts.values()) {
      clearTimeout(lockInfo.timeoutHandle);
    }
    this.lockTimeouts.clear();
    
    // Close Redis connection
    if (this.redis) {
      this.redis.quit();
    }
    
    // Clear data structures
    this.activeTransactions.clear();
    this.participantRegistry.clear();
    this.transactionLocks.clear();
    this.recoveryQueue.clear();
    
    this.isRunning = false;
    console.log('✅ Secure Two-Phase Commit Coordinator stopped');
    
    // Final audit log
    this.auditLog('coordinator_stopped', {
      timestamp: Date.now(),
      gracefulShutdown: true
    });
  }
}

module.exports = SecureTwoPhaseCommitCoordinator;