const EventEmitter = require('events');
const crypto = require('crypto');
const { getSecureMetricsCollector } = require('../../monitoring/secure-metrics-collector');

class SecureSagaOrchestrator extends EventEmitter {
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
    this.sandboxService = null;
    
    // Secure saga state management with strict validation
    this.activeSagas = new Map(); // sagaId -> saga state
    this.sagaDefinitions = new Map(); // sagaType -> validated saga definition
    this.sagaLog = new Map(); // sagaId -> encrypted log entries
    this.trustedSagaTypes = new Set(); // Whitelist of allowed saga types
    
    // Secure step execution with sandboxing
    this.stepExecutors = new Map(); // stepType -> validated executor function
    this.compensationHandlers = new Map(); // stepType -> validated compensation function
    this.executorSignatures = new Map(); // stepType -> cryptographic signature
    
    // Enhanced security tracking
    this.securityMetrics = {
      authenticationAttempts: 0,
      authenticationFailures: 0,
      authorizationFailures: 0,
      suspiciousExecutorRegistrations: 0,
      sandboxViolations: 0,
      integrityViolations: 0,
      encryptionOperations: 0
    };
    
    // Performance tracking with security context
    this.performanceStats = {
      sagasStarted: 0,
      sagasCompleted: 0,
      sagasFailed: 0,
      sagasCompensated: 0,
      compensationFailures: 0,
      averageExecutionTime: 0,
      averageStepsPerSaga: 0,
      successRate: 0,
      compensationRate: 0,
      parallelExecutionCount: 0,
      securityViolations: 0
    };
    
    // Security controls
    this.securityControls = {
      enableAuthentication: true,
      enableAuthorization: true,
      enableEncryption: true,
      enableSandboxing: true,
      enableStepValidation: true,
      requireExecutorSignatures: true,
      maxSagaTime: 30 * 60 * 1000, // 30 minutes
      maxStepsPerSaga: 100,
      maxSagaSize: 10 * 1024 * 1024, // 10MB
      maxParallelSteps: 10
    };
    
    // Timeout management with security
    this.timeouts = new Map(); // sagaId -> timeout handles
    this.stepTimeouts = new Map(); // stepId -> timeout handles
    
    // Recovery and compensation mechanisms
    this.recoveryQueue = new Map(); // sagaId -> recovery job
    this.compensationQueue = new Map(); // sagaId -> compensation job
    
    // Parallel execution management with atomic operations
    this.parallelExecutionSemaphore = new Map(); // sagaId -> semaphore count
    this.parallelExecutionLocks = new Map(); // sagaId -> lock
    
    // Memory and resource monitoring
    this.resourceLimits = {
      maxMemoryUsage: 512 * 1024 * 1024, // 512MB
      maxConcurrentSagas: 1000,
      maxSagaHistorySize: 100000
    };
    
    // Saga history for audit and recovery
    this.sagaHistory = new Map(); // sagaId -> historical record
    this.historyCleanupInterval = null;
    
    // Distributed lock management
    this.lockService = null;
    this.lockTimeouts = new Map();
    this.maxLockTime = 60000; // 1 minute
    
    // Vector clock for saga ordering with security
    this.vectorClock = new Map();
    this.nodeId = this.generateSecureNodeId();
  }

  validateAndSanitizeConfig(config) {
    const allowedConfigKeys = new Set([
      'stepTimeout', 'sagaTimeout', 'compensationTimeout',
      'maxRetries', 'retryBackoff', 'maxConcurrentSagas',
      'sagaLogSize', 'allowParallelSteps', 'maxParallelSteps',
      'compensationStrategy', 'redisUrl', 'keyPrefix',
      'authenticationRequired', 'encryptionEnabled'
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
      stepTimeout: this.validateNumber(sanitized.stepTimeout, 30000, 5000, 300000),
      sagaTimeout: this.validateNumber(sanitized.sagaTimeout, 1800000, 60000, 3600000), // 30 min
      compensationTimeout: this.validateNumber(sanitized.compensationTimeout, 60000, 10000, 600000),
      maxRetries: this.validateNumber(sanitized.maxRetries, 3, 1, 10),
      retryBackoff: this.validateNumber(sanitized.retryBackoff, 1000, 100, 10000),
      maxConcurrentSagas: this.validateNumber(sanitized.maxConcurrentSagas, 1000, 10, 10000),
      sagaLogSize: this.validateNumber(sanitized.sagaLogSize, 10000, 1000, 1000000),
      allowParallelSteps: sanitized.allowParallelSteps !== false,
      maxParallelSteps: this.validateNumber(sanitized.maxParallelSteps, 10, 1, 50),
      compensationStrategy: this.validateCompensationStrategy(sanitized.compensationStrategy || 'reverse_order'),
      
      // Redis configuration with validation
      redisUrl: this.sanitizeUrl(sanitized.redisUrl || process.env.REDIS_URL),
      keyPrefix: this.sanitizeKeyPrefix(sanitized.keyPrefix || 'saga:'),
      
      // Security settings (always enabled)
      authenticationRequired: true,
      encryptionEnabled: true,
      sandboxingEnabled: true,
      stepValidationRequired: true
    };
  }

  sanitizeConfigValue(key, value) {
    switch (key) {
      case 'stepTimeout':
      case 'sagaTimeout':
      case 'compensationTimeout':
      case 'maxRetries':
      case 'retryBackoff':
      case 'maxConcurrentSagas':
      case 'sagaLogSize':
      case 'maxParallelSteps':
        return typeof value === 'number' && isFinite(value) ? value : null;
      case 'allowParallelSteps':
      case 'authenticationRequired':
      case 'encryptionEnabled':
        return Boolean(value);
      case 'compensationStrategy':
        return this.validateCompensationStrategy(value);
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

  validateCompensationStrategy(strategy) {
    const allowedStrategies = new Set(['reverse_order', 'parallel', 'custom']);
    return allowedStrategies.has(strategy) ? strategy : 'reverse_order';
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
    if (typeof prefix !== 'string') return 'saga:';
    return prefix.replace(/[^a-zA-Z0-9:_-]/g, '').substring(0, 50) + ':';
  }

  sanitizeString(input) {
    if (typeof input !== 'string') return '';
    return input.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 200);
  }

  generateSecureNodeId() {
    const hostname = require('os').hostname();
    const processId = process.pid;
    const randomBytes = crypto.randomBytes(8);
    
    return crypto
      .createHash('sha256')
      .update(`${hostname}:${processId}:${randomBytes.toString('hex')}`)
      .digest('hex')
      .substring(0, 16);
  }

  async initialize() {
    try {
      console.log('🔒 Initializing Secure Saga Orchestrator...');
      
      // Initialize security services first
      await this.initializeSecurity();
      
      // Initialize Redis connection with security
      await this.initializeSecureRedis();
      
      // Initialize metrics
      await this.metrics.initialize();
      
      // Initialize encryption service
      await this.initializeEncryption();
      
      // Initialize sandboxing service
      await this.initializeSandboxing();
      
      // Initialize distributed lock service
      await this.initializeLockService();
      
      // Load trusted saga definitions
      await this.loadTrustedSagaDefinitions();
      
      // Start recovery service
      await this.initializeRecoveryService();
      
      // Start history cleanup
      this.startHistoryCleanup();
      
      // Initialize vector clock
      this.vectorClock.set(this.nodeId, 0);
      
      console.log('✅ Secure Saga Orchestrator initialized');
      
    } catch (error) {
      console.error('Failed to initialize Secure Saga Orchestrator:', error);
      await this.auditLog('orchestrator_initialization_failed', { error: error.message });
      throw error;
    }
  }

  async initializeSecurity() {
    // Enhanced authentication service
    this.authenticationService = {
      validateUser: async (user, authToken) => {
        this.securityMetrics.authenticationAttempts++;
        
        if (!user || !authToken || typeof authToken !== 'string') {
          this.securityMetrics.authenticationFailures++;
          return false;
        }
        
        try {
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
      }
    };
    
    // Enhanced authorization service
    this.authorizationService = {
      checkSagaPermission: async (user, action, sagaType) => {
        if (!user || !user.roles) {
          this.securityMetrics.authorizationFailures++;
          return false;
        }
        
        const requiredPermissions = {
          'start_saga': ['orchestrator', 'admin'],
          'compensate_saga': ['orchestrator', 'admin'],
          'register_executor': ['admin', 'system'],
          'register_saga': ['admin', 'system']
        };
        
        const required = requiredPermissions[action];
        if (!required) return false;
        
        const hasPermission = user.roles.some(role => required.includes(role));
        
        if (!hasPermission) {
          this.securityMetrics.authorizationFailures++;
          await this.auditLog('authorization_failed', {
            userId: user.id,
            action,
            sagaType,
            requiredRoles: required,
            userRoles: user.roles
          });
        }
        
        return hasPermission;
      }
    };
    
    // Enhanced audit logger
    this.auditLogger = {
      log: async (event, details) => {
        const auditEntry = {
          timestamp: new Date().toISOString(),
          component: 'SecureSagaOrchestrator',
          event,
          details: this.sanitizeAuditDetails(details),
          nodeId: this.nodeId,
          processId: process.pid
        };
        
        console.log(`[SAGA-AUDIT] ${JSON.stringify(auditEntry)}`);
        
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
      password: process.env.REDIS_PASSWORD
    });
    
    await this.redis.connect();
    await this.redis.ping();
    console.log('✅ Secure Redis connection established for Saga');
  }

  async initializeEncryption() {
    this.encryptionService = {
      encrypt: (data, additionalData = '') => {
        if (!process.env.SAGA_ENCRYPTION_KEY) {
          throw new Error('Saga encryption key not configured');
        }
        
        this.securityMetrics.encryptionOperations++;
        
        const key = Buffer.from(process.env.SAGA_ENCRYPTION_KEY, 'hex');
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
        if (!process.env.SAGA_ENCRYPTION_KEY) {
          throw new Error('Saga encryption key not configured');
        }
        
        const key = Buffer.from(process.env.SAGA_ENCRYPTION_KEY, 'hex');
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
      
      generateExecutorSignature: (executorFunction, stepType) => {
        const functionCode = executorFunction.toString();
        const signatureData = `${stepType}:${functionCode}:${Date.now()}`;
        return this.encryptionService.hash(signatureData);
      }
    };
  }

  async initializeSandboxing() {
    // Secure sandboxing service for step executors
    this.sandboxService = {
      validateExecutorFunction: (executorFunction, stepType) => {
        if (typeof executorFunction !== 'function') {
          throw new Error('Executor must be a function');
        }
        
        const functionCode = executorFunction.toString();
        
        // Check for dangerous patterns
        const dangerousPatterns = [
          /require\s*\(/gi,
          /import\s+/gi,
          /eval\s*\(/gi,
          /Function\s*\(/gi,
          /setTimeout\s*\(/gi,
          /setInterval\s*\(/gi,
          /process\./gi,
          /global\./gi,
          /console\./gi,
          /Buffer\./gi,
          /child_process/gi,
          /fs\./gi,
          /path\./gi,
          /os\./gi,
          /crypto\./gi,
          /http\./gi,
          /https\./gi,
          /net\./gi,
          /cluster\./gi,
          /worker_threads/gi
        ];
        
        for (const pattern of dangerousPatterns) {
          if (pattern.test(functionCode)) {
            this.securityMetrics.sandboxViolations++;
            throw new Error(`Dangerous pattern detected in executor: ${pattern.source}`);
          }
        }
        
        // Check function complexity
        if (functionCode.length > 10000) { // 10KB limit
          throw new Error('Executor function too large');
        }
        
        // Validate allowed operations
        const allowedOperations = [
          'Math.', 'Date.', 'JSON.', 'String.', 'Number.', 'Array.',
          'Object.', 'Promise.', 'Error.', 'RegExp.'
        ];
        
        return true;
      },
      
      createSandboxedExecutor: (executorFunction, stepType) => {
        // Validate the function first
        this.sandboxService.validateExecutorFunction(executorFunction, stepType);
        
        // Create a sandboxed execution context
        return async (stepData, sagaContext) => {
          try {
            // Create isolated context with limited API
            const sandboxContext = {
              stepData: this.sanitizeStepData(stepData),
              sagaContext: this.sanitizeSagaContext(sagaContext),
              Math,
              Date,
              JSON,
              String,
              Number,
              Array,
              Object,
              Promise,
              Error,
              RegExp
            };
            
            // Execute with timeout and memory limits
            const result = await this.executeWithLimits(executorFunction, sandboxContext);
            
            return this.sanitizeExecutorResult(result);
            
          } catch (error) {
            this.securityMetrics.sandboxViolations++;
            await this.auditLog('sandbox_violation', {
              stepType,
              error: error.message,
              executorSignature: this.executorSignatures.get(stepType)
            });
            throw new Error(`Sandboxed execution failed: ${error.message}`);
          }
        };
      },
      
      executeWithLimits: async (executorFunction, context) => {
        return new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Executor timeout'));
          }, this.config.stepTimeout);
          
          try {
            // Bind the function to the sandbox context
            const result = executorFunction.call(context, context.stepData, context.sagaContext);
            
            if (result && typeof result.then === 'function') {
              result
                .then(resolve)
                .catch(reject)
                .finally(() => clearTimeout(timeout));
            } else {
              clearTimeout(timeout);
              resolve(result);
            }
          } catch (error) {
            clearTimeout(timeout);
            reject(error);
          }
        });
      }
    };
  }

  async initializeLockService() {
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
        
        const lockInfo = this.lockTimeouts.get(lockKey);
        if (lockInfo) {
          clearTimeout(lockInfo.timeoutHandle);
          this.lockTimeouts.delete(lockKey);
        }
        
        return result === 1;
      }
    };
  }

  async loadTrustedSagaDefinitions() {
    try {
      // Load trusted saga definitions from secure storage
      const sagaDefsData = await this.redis.hGetAll(`${this.config.keyPrefix}saga_definitions`);
      
      for (const [sagaType, encryptedData] of Object.entries(sagaDefsData)) {
        try {
          const sagaDefinition = JSON.parse(this.decryptSensitiveData(encryptedData));
          
          if (this.validateSagaDefinition(sagaDefinition)) {
            this.trustedSagaTypes.add(sagaType);
            this.sagaDefinitions.set(sagaType, sagaDefinition);
          }
          
        } catch (error) {
          console.error(`Failed to load saga definition ${sagaType}:`, error);
          await this.auditLog('saga_definition_load_failed', {
            sagaType,
            error: error.message
          });
        }
      }
      
      console.log(`Loaded ${this.trustedSagaTypes.size} trusted saga definitions`);
      
    } catch (error) {
      console.error('Failed to load saga definitions:', error);
    }
  }

  validateSagaDefinition(definition) {
    if (!definition || typeof definition !== 'object') return false;
    
    const requiredFields = ['name', 'steps', 'version'];
    for (const field of requiredFields) {
      if (!definition[field]) return false;
    }
    
    if (!Array.isArray(definition.steps)) return false;
    if (definition.steps.length > this.securityControls.maxStepsPerSaga) return false;
    
    // Validate each step
    for (const step of definition.steps) {
      if (!step.name || !step.type || !step.executor) return false;
      if (typeof step.name !== 'string' || typeof step.type !== 'string') return false;
    }
    
    return true;
  }

  async initializeRecoveryService() {
    this.recoveryService = {
      scanForIncompleteSagas: async () => {
        try {
          const activeSagaKeys = await this.redis.keys(`${this.config.keyPrefix}saga:*`);
          
          for (const key of activeSagaKeys) {
            const sagaData = await this.redis.get(key);
            if (sagaData) {
              const saga = JSON.parse(this.decryptSensitiveData(sagaData));
              
              const age = Date.now() - saga.startTime;
              if (age > this.config.sagaTimeout * 2) {
                await this.queueSagaRecovery(saga.id, 'stale_saga');
              }
            }
          }
          
        } catch (error) {
          console.error('Recovery scan failed:', error);
          await this.auditLog('recovery_scan_failed', { error: error.message });
        }
      },
      
      startRecoveryProcess: async () => {
        this.recoveryInterval = setInterval(async () => {
          await this.recoveryService.scanForIncompleteSagas();
        }, 300000); // Every 5 minutes
      }
    };
    
    await this.recoveryService.startRecoveryProcess();
  }

  startHistoryCleanup() {
    this.historyCleanupInterval = setInterval(() => {
      const cutoffTime = Date.now() - (24 * 60 * 60 * 1000); // 24 hours
      
      for (const [sagaId, record] of this.sagaHistory) {
        if (record.timestamp < cutoffTime) {
          this.sagaHistory.delete(sagaId);
        }
      }
      
      if (this.sagaHistory.size > this.resourceLimits.maxSagaHistorySize) {
        const sortedEntries = Array.from(this.sagaHistory.entries())
          .sort(([,a], [,b]) => a.timestamp - b.timestamp);
        
        const toDelete = sortedEntries.slice(0, sortedEntries.length - this.resourceLimits.maxSagaHistorySize);
        for (const [sagaId] of toDelete) {
          this.sagaHistory.delete(sagaId);
        }
      }
    }, 3600000); // Every hour
  }

  async start() {
    if (this.isRunning) return;
    
    console.log('🚀 Starting Secure Saga Orchestrator...');
    this.isRunning = true;
    
    this.startPerformanceMonitoring();
    this.startResourceMonitoring();
    
    console.log('✅ Secure Saga Orchestrator started');
    
    await this.auditLog('orchestrator_started', {
      timestamp: Date.now(),
      securityEnabled: true,
      trustedSagaTypes: this.trustedSagaTypes.size
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
        console.warn('High memory usage detected in Saga Orchestrator');
        this.emit('resource_warning', { type: 'memory', usage: heapUsedRatio });
      }
      
      if (this.activeSagas.size > this.resourceLimits.maxConcurrentSagas * 0.9) {
        console.warn('High saga load detected');
        this.emit('resource_warning', { type: 'sagas', count: this.activeSagas.size });
      }
    }, 30000); // Every 30 seconds
  }

  // Secure step executor registration with comprehensive validation
  async registerStepExecutor(stepType, executorFunction, authenticatedUser = null) {
    try {
      // Authentication and authorization
      if (!await this.authenticationService.validateUser(authenticatedUser, authenticatedUser?.authToken)) {
        throw new Error('Authentication failed');
      }
      
      if (!await this.authorizationService.checkSagaPermission(authenticatedUser, 'register_executor', stepType)) {
        throw new Error('Insufficient permissions to register executor');
      }
      
      // Input validation
      const sanitizedStepType = this.sanitizeString(stepType);
      if (!sanitizedStepType) {
        throw new Error('Invalid step type');
      }
      
      // Validate and sandbox the executor function
      const sandboxedExecutor = this.sandboxService.createSandboxedExecutor(executorFunction, sanitizedStepType);
      
      // Generate cryptographic signature for the executor
      const signature = this.encryptionService.generateExecutorSignature(executorFunction, sanitizedStepType);
      
      // Store the validated executor
      this.stepExecutors.set(sanitizedStepType, sandboxedExecutor);
      this.executorSignatures.set(sanitizedStepType, signature);
      
      // Persist to secure storage
      await this.persistStepExecutor(sanitizedStepType, executorFunction.toString(), signature);
      
      await this.auditLog('step_executor_registered', {
        stepType: sanitizedStepType,
        registeredBy: authenticatedUser.id,
        signature
      });
      
      console.log(`✅ Step executor registered: ${sanitizedStepType}`);
      
    } catch (error) {
      this.securityMetrics.suspiciousExecutorRegistrations++;
      await this.auditLog('step_executor_registration_failed', {
        stepType,
        error: error.message,
        userId: authenticatedUser?.id
      });
      throw error;
    }
  }

  // Secure compensation handler registration
  async registerCompensationHandler(stepType, compensationFunction, authenticatedUser = null) {
    try {
      // Authentication and authorization
      if (!await this.authenticationService.validateUser(authenticatedUser, authenticatedUser?.authToken)) {
        throw new Error('Authentication failed');
      }
      
      if (!await this.authorizationService.checkSagaPermission(authenticatedUser, 'register_executor', stepType)) {
        throw new Error('Insufficient permissions to register compensation handler');
      }
      
      // Input validation
      const sanitizedStepType = this.sanitizeString(stepType);
      if (!sanitizedStepType) {
        throw new Error('Invalid step type');
      }
      
      // Validate and sandbox the compensation function
      const sandboxedCompensation = this.sandboxService.createSandboxedExecutor(compensationFunction, `${sanitizedStepType}_compensation`);
      
      // Store the validated compensation handler
      this.compensationHandlers.set(sanitizedStepType, sandboxedCompensation);
      
      await this.auditLog('compensation_handler_registered', {
        stepType: sanitizedStepType,
        registeredBy: authenticatedUser.id
      });
      
      console.log(`✅ Compensation handler registered: ${sanitizedStepType}`);
      
    } catch (error) {
      await this.auditLog('compensation_handler_registration_failed', {
        stepType,
        error: error.message,
        userId: authenticatedUser?.id
      });
      throw error;
    }
  }

  // Secure saga definition registration
  async registerSagaDefinition(sagaType, sagaDefinition, authenticatedUser = null) {
    try {
      // Authentication and authorization
      if (!await this.authenticationService.validateUser(authenticatedUser, authenticatedUser?.authToken)) {
        throw new Error('Authentication failed');
      }
      
      if (!await this.authorizationService.checkSagaPermission(authenticatedUser, 'register_saga', sagaType)) {
        throw new Error('Insufficient permissions to register saga definition');
      }
      
      // Input validation
      const sanitizedSagaType = this.sanitizeString(sagaType);
      if (!sanitizedSagaType) {
        throw new Error('Invalid saga type');
      }
      
      // Validate saga definition
      if (!this.validateSagaDefinition(sagaDefinition)) {
        throw new Error('Invalid saga definition');
      }
      
      // Store the validated saga definition
      this.trustedSagaTypes.add(sanitizedSagaType);
      this.sagaDefinitions.set(sanitizedSagaType, sagaDefinition);
      
      // Persist to secure storage
      await this.persistSagaDefinition(sanitizedSagaType, sagaDefinition);
      
      await this.auditLog('saga_definition_registered', {
        sagaType: sanitizedSagaType,
        registeredBy: authenticatedUser.id,
        stepCount: sagaDefinition.steps.length
      });
      
      console.log(`✅ Saga definition registered: ${sanitizedSagaType}`);
      
    } catch (error) {
      await this.auditLog('saga_definition_registration_failed', {
        sagaType,
        error: error.message,
        userId: authenticatedUser?.id
      });
      throw error;
    }
  }

  // Main saga start method with comprehensive security
  async startSaga(sagaType, sagaData, authenticatedUser = null) {
    const startTime = Date.now();
    const sagaId = await this.generateSecureSagaId();
    
    try {
      // Authentication and authorization
      if (!await this.authenticationService.validateUser(authenticatedUser, authenticatedUser?.authToken)) {
        throw new Error('Authentication failed');
      }
      
      if (!await this.authorizationService.checkSagaPermission(authenticatedUser, 'start_saga', sagaType)) {
        throw new Error('Insufficient permissions to start saga');
      }
      
      // Input validation and sanitization
      const sanitizedSagaType = this.sanitizeString(sagaType);
      const sanitizedSagaData = this.sanitizeSagaData(sagaData);
      
      // Validate saga type is trusted
      if (!this.trustedSagaTypes.has(sanitizedSagaType)) {
        throw new Error(`Untrusted saga type: ${sanitizedSagaType}`);
      }
      
      // Resource and limit checks
      if (this.activeSagas.size >= this.resourceLimits.maxConcurrentSagas) {
        throw new Error('Maximum concurrent sagas exceeded');
      }
      
      if (JSON.stringify(sanitizedSagaData).length > this.securityControls.maxSagaSize) {
        throw new Error('Saga size exceeds limits');
      }
      
      // Get saga definition
      const sagaDefinition = this.sagaDefinitions.get(sanitizedSagaType);
      if (!sagaDefinition) {
        throw new Error(`No definition found for saga type: ${sanitizedSagaType}`);
      }
      
      // Acquire distributed lock
      const lockKey = `saga:${sagaId}`;
      const lockValue = await this.lockService.acquireLock(lockKey);
      if (!lockValue) {
        throw new Error('Failed to acquire saga lock');
      }
      
      try {
        // Create secure saga state
        const saga = {
          id: sagaId,
          type: sanitizedSagaType,
          definition: sagaDefinition,
          data: sanitizedSagaData,
          coordinator: authenticatedUser.id,
          status: 'running',
          currentStep: 0,
          completedSteps: [],
          failedSteps: [],
          startTime,
          vectorClock: this.incrementVectorClock(),
          lockValue,
          retryCount: 0,
          integrity: this.calculateSagaIntegrity(sagaId, sanitizedSagaType, sanitizedSagaData)
        };
        
        // Store saga securely
        this.activeSagas.set(sagaId, saga);
        await this.persistSaga(saga);
        
        // Set saga timeout
        const timeoutHandle = setTimeout(async () => {
          await this.handleSagaTimeout(sagaId);
        }, this.config.sagaTimeout);
        
        this.timeouts.set(sagaId, timeoutHandle);
        
        // Initialize saga log
        this.sagaLog.set(sagaId, []);
        await this.logSagaEvent(sagaId, 'saga_started', { sagaType: sanitizedSagaType, coordinator: authenticatedUser.id });
        
        // Execute saga steps
        const result = await this.executeSagaSteps(sagaId);
        
        // Update performance stats
        this.performanceStats.sagasStarted++;
        
        if (result.success) {
          this.performanceStats.sagasCompleted++;
          await this.logSagaEvent(sagaId, 'saga_completed', { duration: Date.now() - startTime });
        } else {
          this.performanceStats.sagasFailed++;
          await this.logSagaEvent(sagaId, 'saga_failed', { error: result.error });
        }
        
        // Clean up
        await this.cleanupSaga(sagaId);
        
        // Add to history
        this.addToHistory(sagaId, saga, result.success ? 'completed' : 'failed');
        
        // Audit log
        await this.auditLog('saga_completed', {
          sagaId,
          sagaType: sanitizedSagaType,
          status: result.success ? 'completed' : 'failed',
          duration: Date.now() - startTime,
          stepCount: sagaDefinition.steps.length,
          coordinator: authenticatedUser.id
        });
        
        return {
          sagaId,
          status: result.success ? 'completed' : 'failed',
          result,
          duration: Date.now() - startTime
        };
        
      } finally {
        // Always release the lock
        await this.lockService.releaseLock(lockKey, lockValue);
      }
      
    } catch (error) {
      console.error(`Saga ${sagaId} failed:`, error);
      
      // Clean up on error
      await this.cleanupSaga(sagaId);
      
      await this.auditLog('saga_failed', {
        sagaId,
        sagaType,
        error: error.message,
        duration: Date.now() - startTime,
        coordinator: authenticatedUser?.id
      });
      
      throw error;
    }
  }

  async generateSecureSagaId() {
    const timestamp = Date.now();
    const randomBytes = crypto.randomBytes(16);
    const nodeId = this.nodeId;
    
    const hash = crypto
      .createHash('sha256')
      .update(`${timestamp}:${randomBytes.toString('hex')}:${nodeId}`)
      .digest('hex');
    
    return `saga_${timestamp}_${hash.substring(0, 16)}`;
  }

  sanitizeSagaData(data) {
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid saga data');
    }
    
    const sanitized = {};
    const allowedKeys = new Set([
      'entityId', 'entityType', 'operation', 'amount', 'token',
      'metadata', 'timestamp', 'signature', 'priority', 'context'
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
          sanitized[key] = this.sanitizeSagaData(value);
        }
      }
    }
    
    return sanitized;
  }

  sanitizeStepData(data) {
    if (!data || typeof data !== 'object') return {};
    
    // Similar sanitization as saga data but more restrictive
    const sanitized = {};
    const allowedKeys = new Set(['input', 'output', 'metadata', 'timestamp']);
    
    for (const [key, value] of Object.entries(data)) {
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

  sanitizeSagaContext(context) {
    if (!context || typeof context !== 'object') return {};
    
    const sanitized = {};
    const allowedKeys = new Set(['sagaId', 'stepIndex', 'sagaData', 'previousResults']);
    
    for (const [key, value] of Object.entries(context)) {
      if (allowedKeys.has(key)) {
        if (typeof value === 'string') {
          sanitized[key] = value.substring(0, 200);
        } else if (typeof value === 'number' && isFinite(value)) {
          sanitized[key] = value;
        } else if (typeof value === 'object' && value !== null) {
          sanitized[key] = this.sanitizeSagaContext(value);
        }
      }
    }
    
    return sanitized;
  }

  sanitizeExecutorResult(result) {
    if (result === null || result === undefined) return result;
    
    if (typeof result === 'string') {
      return result.substring(0, 1000);
    } else if (typeof result === 'number' && isFinite(result)) {
      return result;
    } else if (typeof result === 'boolean') {
      return result;
    } else if (typeof result === 'object') {
      const sanitized = {};
      const allowedKeys = new Set(['success', 'result', 'error', 'data', 'metadata']);
      
      for (const [key, value] of Object.entries(result)) {
        if (allowedKeys.has(key)) {
          sanitized[key] = this.sanitizeExecutorResult(value);
        }
      }
      
      return sanitized;
    }
    
    return null;
  }

  incrementVectorClock() {
    const currentValue = this.vectorClock.get(this.nodeId) || 0;
    this.vectorClock.set(this.nodeId, currentValue + 1);
    
    return Object.fromEntries(this.vectorClock);
  }

  calculateSagaIntegrity(sagaId, sagaType, sagaData) {
    const integritySeed = JSON.stringify({
      sagaId,
      sagaType,
      sagaData,
      timestamp: Date.now(),
      nodeId: this.nodeId
    });
    
    return this.encryptionService.hash(integritySeed);
  }

  async persistSaga(saga) {
    try {
      const encryptedData = this.encryptSensitiveData(JSON.stringify({
        id: saga.id,
        type: saga.type,
        data: saga.data,
        coordinator: saga.coordinator,
        status: saga.status,
        currentStep: saga.currentStep,
        startTime: saga.startTime,
        vectorClock: saga.vectorClock,
        integrity: saga.integrity
      }));
      
      await this.redis.hSet(
        `${this.config.keyPrefix}sagas`,
        saga.id,
        encryptedData
      );
      
      await this.redis.expire(
        `${this.config.keyPrefix}sagas`,
        this.config.sagaTimeout * 2 / 1000
      );
      
    } catch (error) {
      console.error('Failed to persist saga:', error);
      throw new Error('Saga persistence failed');
    }
  }

  async persistStepExecutor(stepType, functionCode, signature) {
    try {
      const executorData = {
        stepType,
        functionCode,
        signature,
        registeredAt: Date.now()
      };
      
      await this.redis.hSet(
        `${this.config.keyPrefix}step_executors`,
        stepType,
        this.encryptSensitiveData(JSON.stringify(executorData))
      );
      
    } catch (error) {
      console.error('Failed to persist step executor:', error);
      throw new Error('Step executor persistence failed');
    }
  }

  async persistSagaDefinition(sagaType, definition) {
    try {
      await this.redis.hSet(
        `${this.config.keyPrefix}saga_definitions`,
        sagaType,
        this.encryptSensitiveData(JSON.stringify(definition))
      );
      
    } catch (error) {
      console.error('Failed to persist saga definition:', error);
      throw new Error('Saga definition persistence failed');
    }
  }

  async logSagaEvent(sagaId, eventType, eventData) {
    const logEntry = {
      timestamp: Date.now(),
      eventType,
      eventData: this.sanitizeAuditDetails(eventData),
      nodeId: this.nodeId
    };
    
    const sagaLogEntries = this.sagaLog.get(sagaId) || [];
    sagaLogEntries.push(logEntry);
    
    // Limit log size
    if (sagaLogEntries.length > this.config.sagaLogSize) {
      sagaLogEntries.shift();
    }
    
    this.sagaLog.set(sagaId, sagaLogEntries);
    
    // Persist to Redis
    try {
      await this.redis.lPush(
        `${this.config.keyPrefix}saga_log:${sagaId}`,
        this.encryptSensitiveData(JSON.stringify(logEntry))
      );
    } catch (error) {
      console.error('Failed to persist saga log entry:', error);
    }
  }

  async executeSagaSteps(sagaId) {
    const saga = this.activeSagas.get(sagaId);
    if (!saga) {
      throw new Error(`Saga ${sagaId} not found`);
    }
    
    console.log(`Executing saga steps: ${sagaId} (${saga.type})`);
    
    try {
      const steps = saga.definition.steps;
      const results = [];
      
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        saga.currentStep = i;
        await this.persistSaga(saga);
        
        console.log(`Executing step ${i + 1}/${steps.length}: ${step.name} (${step.type})`);
        
        try {
          const stepResult = await this.executeStep(sagaId, step, i, results);
          
          results.push(stepResult);
          saga.completedSteps.push({
            stepIndex: i,
            stepName: step.name,
            stepType: step.type,
            result: stepResult,
            completedAt: Date.now()
          });
          
          await this.logSagaEvent(sagaId, 'step_completed', {
            stepIndex: i,
            stepName: step.name,
            stepType: step.type
          });
          
        } catch (error) {
          console.error(`Step ${i + 1} failed:`, error);
          
          saga.failedSteps.push({
            stepIndex: i,
            stepName: step.name,
            stepType: step.type,
            error: error.message,
            failedAt: Date.now()
          });
          
          await this.logSagaEvent(sagaId, 'step_failed', {
            stepIndex: i,
            stepName: step.name,
            stepType: step.type,
            error: error.message
          });
          
          // Execute compensation
          const compensationResult = await this.executeCompensation(sagaId, i);
          
          return {
            success: false,
            error: error.message,
            completedSteps: saga.completedSteps,
            failedSteps: saga.failedSteps,
            compensationResult
          };
        }
      }
      
      saga.status = 'completed';
      await this.persistSaga(saga);
      
      console.log(`Saga ${sagaId} completed successfully`);
      
      return {
        success: true,
        results,
        completedSteps: saga.completedSteps
      };
      
    } catch (error) {
      console.error(`Saga execution failed for ${sagaId}:`, error);
      
      saga.status = 'failed';
      await this.persistSaga(saga);
      
      return {
        success: false,
        error: error.message
      };
    }
  }

  async executeStep(sagaId, step, stepIndex, previousResults) {
    const startTime = Date.now();
    
    // Get step executor
    const executor = this.stepExecutors.get(step.type);
    if (!executor) {
      throw new Error(`No executor found for step type: ${step.type}`);
    }
    
    // Verify executor integrity
    const currentSignature = this.executorSignatures.get(step.type);
    if (!currentSignature) {
      this.securityMetrics.integrityViolations++;
      throw new Error(`No signature found for step executor: ${step.type}`);
    }
    
    // Create step execution context
    const stepData = {
      input: step.input || {},
      metadata: step.metadata || {}
    };
    
    const sagaContext = {
      sagaId,
      stepIndex,
      sagaData: this.activeSagas.get(sagaId).data,
      previousResults: previousResults.slice() // Copy array
    };
    
    // Set step timeout
    const stepTimeoutHandle = setTimeout(() => {
      throw new Error(`Step ${step.name} timed out`);
    }, this.config.stepTimeout);
    
    this.stepTimeouts.set(`${sagaId}:${stepIndex}`, stepTimeoutHandle);
    
    try {
      // Execute step with sandbox
      const result = await executor(stepData, sagaContext);
      
      clearTimeout(stepTimeoutHandle);
      this.stepTimeouts.delete(`${sagaId}:${stepIndex}`);
      
      // Update performance stats
      const executionTime = Date.now() - startTime;
      this.performanceStats.averageExecutionTime = 
        (this.performanceStats.averageExecutionTime * 0.9) + (executionTime * 0.1);
      
      return result;
      
    } catch (error) {
      clearTimeout(stepTimeoutHandle);
      this.stepTimeouts.delete(`${sagaId}:${stepIndex}`);
      
      throw error;
    }
  }

  async executeCompensation(sagaId, failedStepIndex) {
    const saga = this.activeSagas.get(sagaId);
    if (!saga) {
      throw new Error(`Saga ${sagaId} not found`);
    }
    
    console.log(`Executing compensation for saga ${sagaId}, failed at step ${failedStepIndex}`);
    
    this.performanceStats.sagasCompensated++;
    
    const compensationResults = [];
    
    try {
      // Compensate completed steps in reverse order
      for (let i = failedStepIndex - 1; i >= 0; i--) {
        const completedStep = saga.completedSteps.find(cs => cs.stepIndex === i);
        if (!completedStep) continue;
        
        const compensationHandler = this.compensationHandlers.get(completedStep.stepType);
        if (!compensationHandler) {
          console.warn(`No compensation handler for step type: ${completedStep.stepType}`);
          continue;
        }
        
        try {
          console.log(`Compensating step ${i + 1}: ${completedStep.stepName}`);
          
          const compensationResult = await compensationHandler(
            { 
              originalResult: completedStep.result,
              metadata: { stepIndex: i, stepName: completedStep.stepName }
            },
            { sagaId, compensationReason: 'step_failure' }
          );
          
          compensationResults.push({
            stepIndex: i,
            stepName: completedStep.stepName,
            stepType: completedStep.stepType,
            compensationResult,
            compensatedAt: Date.now()
          });
          
          await this.logSagaEvent(sagaId, 'step_compensated', {
            stepIndex: i,
            stepName: completedStep.stepName,
            stepType: completedStep.stepType
          });
          
        } catch (error) {
          console.error(`Compensation failed for step ${i + 1}:`, error);
          
          this.performanceStats.compensationFailures++;
          
          compensationResults.push({
            stepIndex: i,
            stepName: completedStep.stepName,
            stepType: completedStep.stepType,
            error: error.message,
            compensatedAt: Date.now()
          });
          
          await this.logSagaEvent(sagaId, 'compensation_failed', {
            stepIndex: i,
            stepName: completedStep.stepName,
            error: error.message
          });
        }
      }
      
      saga.status = 'compensated';
      await this.persistSaga(saga);
      
      await this.logSagaEvent(sagaId, 'saga_compensated', {
        compensatedSteps: compensationResults.length
      });
      
      return {
        success: true,
        compensatedSteps: compensationResults
      };
      
    } catch (error) {
      console.error(`Compensation execution failed for saga ${sagaId}:`, error);
      
      return {
        success: false,
        error: error.message,
        compensatedSteps: compensationResults
      };
    }
  }

  async handleSagaTimeout(sagaId) {
    console.warn(`Saga ${sagaId} timed out`);
    
    try {
      const saga = this.activeSagas.get(sagaId);
      if (saga) {
        // Execute compensation for timed out saga
        const compensationResult = await this.executeCompensation(sagaId, saga.currentStep);
        
        saga.status = 'timeout';
        await this.persistSaga(saga);
        
        this.addToHistory(sagaId, saga, 'timeout');
        
        await this.auditLog('saga_timeout', {
          sagaId,
          currentStep: saga.currentStep,
          duration: Date.now() - saga.startTime
        });
        
        this.emit('saga_timeout', {
          sagaId,
          currentStep: saga.currentStep,
          compensationResult
        });
      }
      
    } catch (error) {
      console.error(`Failed to handle timeout for saga ${sagaId}:`, error);
    }
  }

  async queueSagaRecovery(sagaId, reason) {
    console.log(`Queueing recovery for saga ${sagaId}, reason: ${reason}`);
    
    const recoveryJob = {
      sagaId,
      reason,
      createdAt: Date.now(),
      attempts: 0,
      maxAttempts: 5
    };
    
    this.recoveryQueue.set(sagaId, recoveryJob);
    
    await this.auditLog('saga_recovery_queued', {
      sagaId,
      reason
    });
  }

  async cleanupSaga(sagaId) {
    try {
      // Remove from active sagas
      this.activeSagas.delete(sagaId);
      
      // Clear timeout
      const timeoutHandle = this.timeouts.get(sagaId);
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        this.timeouts.delete(sagaId);
      }
      
      // Clear step timeouts
      for (const [key, handle] of this.stepTimeouts) {
        if (key.startsWith(`${sagaId}:`)) {
          clearTimeout(handle);
          this.stepTimeouts.delete(key);
        }
      }
      
      // Remove from Redis (will be moved to history)
      await this.redis.hDel(`${this.config.keyPrefix}sagas`, sagaId);
      
    } catch (error) {
      console.error(`Failed to cleanup saga ${sagaId}:`, error);
    }
  }

  addToHistory(sagaId, saga, finalStatus) {
    const historyRecord = {
      sagaId,
      sagaType: saga.type,
      coordinator: saga.coordinator,
      stepCount: saga.definition.steps.length,
      completedSteps: saga.completedSteps.length,
      startTime: saga.startTime,
      endTime: Date.now(),
      duration: Date.now() - saga.startTime,
      finalStatus,
      retryCount: saga.retryCount,
      timestamp: Date.now()
    };
    
    this.sagaHistory.set(sagaId, historyRecord);
  }

  encryptSensitiveData(data) {
    if (this.config.encryptionEnabled && this.encryptionService) {
      return JSON.stringify(this.encryptionService.encrypt(data, 'saga_data'));
    }
    return data;
  }

  decryptSensitiveData(encryptedData) {
    if (this.config.encryptionEnabled && this.encryptionService) {
      try {
        const parsedData = JSON.parse(encryptedData);
        return this.encryptionService.decrypt(parsedData);
      } catch (error) {
        return encryptedData;
      }
    }
    return encryptedData;
  }

  verifyJWT(token) {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) throw new Error('Invalid JWT format');
      
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
      
      if (payload.exp && payload.exp < Date.now() / 1000) {
        throw new Error('JWT expired');
      }
      
      return payload;
    } catch (error) {
      throw new Error('JWT verification failed');
    }
  }

  sanitizeAuditDetails(details) {
    if (!details || typeof details !== 'object') return {};
    
    const sanitized = {};
    const allowedKeys = new Set([
      'sagaId', 'sagaType', 'stepIndex', 'stepName', 'stepType',
      'coordinator', 'status', 'duration', 'error', 'reason'
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
      const totalSagas = this.performanceStats.sagasCompleted + 
        this.performanceStats.sagasFailed;
      
      this.performanceStats.successRate = totalSagas > 0 ? 
        this.performanceStats.sagasCompleted / totalSagas : 0;
      
      this.performanceStats.compensationRate = totalSagas > 0 ? 
        this.performanceStats.sagasCompensated / totalSagas : 0;
      
      this.performanceStats.averageStepsPerSaga = this.performanceStats.sagasStarted > 0 ?
        Array.from(this.sagaDefinitions.values())
          .reduce((sum, def) => sum + def.steps.length, 0) / this.sagaDefinitions.size : 0;
      
      // Update metrics
      await this.metrics.setGauge('saga.sagas_started', this.performanceStats.sagasStarted, { security: 'enabled' }, 'consistency');
      await this.metrics.setGauge('saga.sagas_completed', this.performanceStats.sagasCompleted, { security: 'enabled' }, 'consistency');
      await this.metrics.setGauge('saga.sagas_failed', this.performanceStats.sagasFailed, { security: 'enabled' }, 'consistency');
      await this.metrics.setGauge('saga.sagas_compensated', this.performanceStats.sagasCompensated, { security: 'enabled' }, 'consistency');
      await this.metrics.setGauge('saga.success_rate', this.performanceStats.successRate, { security: 'enabled' }, 'consistency');
      await this.metrics.setGauge('saga.compensation_rate', this.performanceStats.compensationRate, { security: 'enabled' }, 'consistency');
      await this.metrics.setGauge('saga.average_execution_time', this.performanceStats.averageExecutionTime, { security: 'enabled' }, 'consistency');
      await this.metrics.setGauge('saga.active_sagas', this.activeSagas.size, { security: 'enabled' }, 'consistency');
      
      // Security metrics
      await this.metrics.setGauge('saga.authentication_attempts', this.securityMetrics.authenticationAttempts, { security: 'enabled' }, 'consistency');
      await this.metrics.setGauge('saga.authentication_failures', this.securityMetrics.authenticationFailures, { security: 'enabled' }, 'consistency');
      await this.metrics.setGauge('saga.sandbox_violations', this.securityMetrics.sandboxViolations, { security: 'enabled' }, 'consistency');
      await this.metrics.setGauge('saga.integrity_violations', this.securityMetrics.integrityViolations, { security: 'enabled' }, 'consistency');
      
    } catch (error) {
      console.error('Failed to update performance metrics:', error);
    }
  }

  async auditLog(event, details) {
    if (this.auditLogger) {
      await this.auditLogger.log(event, details);
    }
  }

  getSagaStatus(sagaId) {
    const active = this.activeSagas.get(sagaId);
    if (active) {
      return {
        status: 'active',
        sagaType: active.type,
        currentStep: active.currentStep,
        startTime: active.startTime,
        completedSteps: active.completedSteps,
        failedSteps: active.failedSteps
      };
    }
    
    const historical = this.sagaHistory.get(sagaId);
    if (historical) {
      return {
        status: 'completed',
        finalStatus: historical.finalStatus,
        duration: historical.duration,
        stepCount: historical.stepCount,
        completedSteps: historical.completedSteps
      };
    }
    
    return { status: 'not_found' };
  }

  getSystemStatus() {
    return {
      isRunning: this.isRunning,
      activeSagas: this.activeSagas.size,
      trustedSagaTypes: this.trustedSagaTypes.size,
      registeredExecutors: this.stepExecutors.size,
      performanceStats: this.performanceStats,
      securityMetrics: this.securityMetrics,
      securityControls: this.securityControls,
      resourceUsage: {
        memoryUsage: process.memoryUsage(),
        sagaHistorySize: this.sagaHistory.size,
        recoveryQueueSize: this.recoveryQueue.size
      }
    };
  }

  stop() {
    if (!this.isRunning) return;
    
    console.log('🛑 Stopping Secure Saga Orchestrator...');
    
    // Stop intervals
    if (this.performanceInterval) clearInterval(this.performanceInterval);
    if (this.resourceMonitorInterval) clearInterval(this.resourceMonitorInterval);
    if (this.historyCleanupInterval) clearInterval(this.historyCleanupInterval);
    if (this.recoveryInterval) clearInterval(this.recoveryInterval);
    
    // Clear all timeouts
    for (const timeout of this.timeouts.values()) {
      clearTimeout(timeout);
    }
    this.timeouts.clear();
    
    for (const timeout of this.stepTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.stepTimeouts.clear();
    
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
    this.activeSagas.clear();
    this.sagaDefinitions.clear();
    this.sagaLog.clear();
    this.stepExecutors.clear();
    this.compensationHandlers.clear();
    this.executorSignatures.clear();
    this.recoveryQueue.clear();
    this.parallelExecutionSemaphore.clear();
    this.parallelExecutionLocks.clear();
    
    this.isRunning = false;
    console.log('✅ Secure Saga Orchestrator stopped');
    
    // Final audit log
    this.auditLog('orchestrator_stopped', {
      timestamp: Date.now(),
      gracefulShutdown: true
    });
  }
}

module.exports = SecureSagaOrchestrator;