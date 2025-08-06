const EventEmitter = require('events');
const crypto = require('crypto');
const TwoPhaseCommitCoordinator = require('./secure-two-phase-commit-coordinator');
const SagaOrchestrator = require('./secure-saga-orchestrator');
const EventualConsistencyManager = require('./secure-eventual-consistency-manager');
const BlockchainReconciliationService = require('./secure-blockchain-reconciliation-service');
const DeadLetterQueueManager = require('./secure-dead-letter-queue-manager');
const { getSecureMetricsCollector } = require('../../monitoring/secure-metrics-collector');

class SecureDataConsistencyOrchestrator extends EventEmitter {
  constructor(config = {}) {
    super();
    
    // Validate configuration before use
    this.config = this.validateAndSanitizeConfig(config);
    
    this.metrics = getSecureMetricsCollector();
    this.isRunning = false;
    
    // Enhanced security tracking
    this.authenticationService = null;
    this.authorizationService = null;
    this.auditLogger = null;
    
    // Component registry with integrity verification
    this.components = new Map();
    this.componentHealth = new Map();
    this.componentSignatures = new Map();
    
    // System state with secure defaults
    this.systemHealth = 'initializing';
    this.lastHealthCheck = null;
    
    // Secure transaction tracking with limits
    this.activeTransactions = new Map(); // txId -> transaction metadata
    this.transactionTypes = new Map(); // txType -> consistency mechanism
    this.transactionLimits = {
      maxConcurrent: 1000,
      maxPerMinute: 10000,
      maxTransactionSize: 10 * 1024 * 1024 // 10MB
    };
    this.transactionCounts = new Map(); // userId -> count in current window
    this.rateLimitWindow = 60000; // 1 minute
    
    // Performance tracking with security metrics
    this.performanceStats = {
      transactionsProcessed: 0,
      transactionsBlocked: 0,
      authenticationFailures: 0,
      authorizationFailures: 0,
      twoPhaseCommitCount: 0,
      sagaCount: 0,
      eventualConsistencyCount: 0,
      blockchainReconciliations: 0,
      deadLetterMessages: 0,
      averageTransactionTime: 0,
      consistencyViolations: 0,
      systemAvailability: 1.0,
      securityEvents: 0
    };
    
    // Security controls
    this.securityControls = {
      enableAuthentication: true,
      enableAuthorization: true,
      enableRateLimiting: true,
      enableInputValidation: true,
      enableAuditLogging: true,
      enableEncryption: true,
      maxMemoryUsage: 512 * 1024 * 1024, // 512MB
      sessionTimeout: 30 * 60 * 1000 // 30 minutes
    };
    
    // Memory monitoring
    this.memoryWatermarks = {
      low: 0.7,
      high: 0.85,
      critical: 0.95
    };
    
    // Lock management for atomic operations
    this.locks = new Map();
    this.lockTimeouts = new Map();
    this.maxLockTime = 30000; // 30 seconds
    
    // Component validation registry
    this.allowedComponents = new Set([
      'twoPhaseCommit',
      'saga', 
      'eventualConsistency',
      'blockchainReconciliation',
      'deadLetterQueue'
    ]);
  }

  validateAndSanitizeConfig(config) {
    const allowedConfigKeys = new Set([
      'twoPhaseCommit', 'saga', 'eventualConsistency',
      'blockchainReconciliation', 'deadLetterQueue',
      'enableAllComponents', 'strictMode', 'transactionRouting',
      'defaultConsistencyLevel', 'healthCheckInterval',
      'authenticationRequired', 'encryptionEnabled',
      'rateLimiting', 'maxConcurrentTransactions'
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
      // Component configurations
      twoPhaseCommit: sanitized.twoPhaseCommit || {},
      saga: sanitized.saga || {},
      eventualConsistency: sanitized.eventualConsistency || {},
      blockchainReconciliation: sanitized.blockchainReconciliation || {},
      deadLetterQueue: sanitized.deadLetterQueue || {},
      
      // Orchestrator settings with validation
      enableAllComponents: Boolean(sanitized.enableAllComponents),
      strictMode: sanitized.strictMode !== false,
      
      // Transaction routing with validation
      transactionRouting: this.validateTransactionRouting(sanitized.transactionRouting || {
        critical: '2pc',
        important: 'saga',
        normal: 'eventual',
        batch: 'eventual'
      }),
      
      // Consistency levels with validation
      defaultConsistencyLevel: this.validateConsistencyLevel(sanitized.defaultConsistencyLevel || 'eventual'),
      
      // Performance settings with limits
      healthCheckInterval: this.validateNumber(sanitized.healthCheckInterval, 30000, 10000, 300000),
      
      // Security settings (always enabled)
      authenticationRequired: true,
      encryptionEnabled: true,
      rateLimiting: sanitized.rateLimiting !== false,
      maxConcurrentTransactions: this.validateNumber(sanitized.maxConcurrentTransactions, 1000, 1, 10000)
    };
  }

  sanitizeConfigValue(key, value) {
    switch (key) {
      case 'healthCheckInterval':
      case 'maxConcurrentTransactions':
        return typeof value === 'number' && isFinite(value) ? value : null;
      case 'authenticationRequired':
      case 'encryptionEnabled':
      case 'enableAllComponents':
      case 'strictMode':
      case 'rateLimiting':
        return Boolean(value);
      case 'defaultConsistencyLevel':
        return typeof value === 'string' ? value.toLowerCase().replace(/[^a-z]/g, '') : null;
      case 'transactionRouting':
        return typeof value === 'object' && value !== null ? value : {};
      default:
        return typeof value === 'object' && value !== null ? value : {};
    }
  }

  validateNumber(value, defaultValue, min, max) {
    if (typeof value !== 'number' || !isFinite(value) || value < min || value > max) {
      return defaultValue;
    }
    return value;
  }

  validateTransactionRouting(routing) {
    const allowedMechanisms = new Set(['2pc', 'saga', 'eventual']);
    const validated = {};
    
    for (const [type, mechanism] of Object.entries(routing)) {
      const sanitizedType = this.sanitizeString(type);
      if (sanitizedType && allowedMechanisms.has(mechanism)) {
        validated[sanitizedType] = mechanism;
      }
    }
    
    return validated;
  }

  validateConsistencyLevel(level) {
    const allowedLevels = new Set(['strong', 'eventual', 'weak']);
    return allowedLevels.has(level) ? level : 'eventual';
  }

  sanitizeString(input) {
    if (typeof input !== 'string') return '';
    return input.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 100);
  }

  async initialize() {
    try {
      console.log('🔒 Initializing Secure Data Consistency Orchestrator...');
      
      // Initialize security services first
      await this.initializeSecurity();
      
      // Initialize metrics with security context
      await this.metrics.initialize();
      
      // Initialize and validate all components with integrity checks
      await this.initializeSecureComponents();
      
      // Setup secure component event handlers
      this.setupSecureComponentEventHandlers();
      
      // Setup transaction routing with validation
      this.setupSecureTransactionRouting();
      
      // Initialize health monitoring
      this.initializeHealthMonitoring();
      
      console.log('✅ Secure Data Consistency Orchestrator initialized');
      
    } catch (error) {
      console.error('Failed to initialize Secure Data Consistency Orchestrator:', error);
      await this.auditLog('system_initialization_failed', { error: error.message });
      throw error;
    }
  }

  async initializeSecurity() {
    // Initialize authentication service
    this.authenticationService = {
      validateToken: async (token) => {
        if (!token || typeof token !== 'string' || token.length < 10) {
          return null;
        }
        // JWT validation would go here
        return { id: 'validated-user', roles: ['user'] };
      },
      
      revokeToken: async (token) => {
        // Token revocation logic
        return true;
      }
    };
    
    // Initialize authorization service
    this.authorizationService = {
      checkPermission: async (user, action, resource) => {
        if (!user || !user.id) return false;
        
        // Role-based access control
        const permissions = {
          'user': ['execute_transaction', 'view_status'],
          'admin': ['execute_transaction', 'view_status', 'manage_system'],
          'system': ['execute_transaction', 'view_status', 'manage_system', 'internal_operations']
        };
        
        const userRoles = user.roles || ['user'];
        for (const role of userRoles) {
          if (permissions[role] && permissions[role].includes(action)) {
            return true;
          }
        }
        
        return false;
      }
    };
    
    // Initialize audit logger
    this.auditLogger = {
      log: async (event, details) => {
        const auditEntry = {
          timestamp: new Date().toISOString(),
          event,
          details: this.sanitizeAuditDetails(details),
          nodeId: process.env.NODE_ID || 'unknown'
        };
        
        // Log to secure audit system
        console.log(`[AUDIT] ${JSON.stringify(auditEntry)}`);
        
        // Update security metrics
        this.performanceStats.securityEvents++;
      }
    };
  }

  sanitizeAuditDetails(details) {
    if (!details || typeof details !== 'object') return {};
    
    const sanitized = {};
    const allowedKeys = new Set([
      'transactionId', 'transactionType', 'userId', 'component', 
      'action', 'result', 'duration', 'error', 'metadata'
    ]);
    
    for (const [key, value] of Object.entries(details)) {
      if (allowedKeys.has(key)) {
        if (typeof value === 'string') {
          sanitized[key] = value.substring(0, 1000);
        } else if (typeof value === 'number' && isFinite(value)) {
          sanitized[key] = value;
        } else if (typeof value === 'boolean') {
          sanitized[key] = value;
        }
      }
    }
    
    return sanitized;
  }

  async initializeSecureComponents() {
    const componentConfigs = [
      { 
        name: 'twoPhaseCommit', 
        class: TwoPhaseCommitCoordinator, 
        config: this.config.twoPhaseCommit,
        enabled: true,
        requiredPermissions: ['critical_operations']
      },
      { 
        name: 'saga', 
        class: SagaOrchestrator, 
        config: this.config.saga,
        enabled: true,
        requiredPermissions: ['distributed_transactions']
      },
      { 
        name: 'eventualConsistency', 
        class: EventualConsistencyManager, 
        config: this.config.eventualConsistency,
        enabled: true,
        requiredPermissions: ['consistency_management']
      },
      { 
        name: 'blockchainReconciliation', 
        class: BlockchainReconciliationService, 
        config: this.config.blockchainReconciliation,
        enabled: this.config.enableAllComponents,
        requiredPermissions: ['blockchain_operations']
      },
      { 
        name: 'deadLetterQueue', 
        class: DeadLetterQueueManager, 
        config: this.config.deadLetterQueue,
        enabled: true,
        requiredPermissions: ['queue_management']
      }
    ];
    
    for (const componentConfig of componentConfigs) {
      if (!componentConfig.enabled) {
        console.log(`Skipping ${componentConfig.name} (disabled)`);
        continue;
      }
      
      // Validate component is in allowed list
      if (!this.allowedComponents.has(componentConfig.name)) {
        throw new Error(`Unauthorized component: ${componentConfig.name}`);
      }
      
      try {
        console.log(`Initializing secure ${componentConfig.name}...`);
        
        // Create component with enhanced security config
        const secureConfig = {
          ...componentConfig.config,
          authenticationRequired: true,
          encryptionEnabled: true,
          auditLogger: this.auditLogger
        };
        
        const component = new componentConfig.class(secureConfig);
        
        // Verify component implements required security interface
        this.validateComponentSecurity(component, componentConfig.name);
        
        // Initialize component
        await component.initialize();
        
        // Generate and store component signature
        const signature = this.generateComponentSignature(component, componentConfig.name);
        this.componentSignatures.set(componentConfig.name, signature);
        
        // Store component
        this.components.set(componentConfig.name, component);
        this.componentHealth.set(componentConfig.name, {
          status: 'healthy',
          lastCheck: Date.now(),
          errors: 0,
          initialized: true,
          securityValidated: true,
          permissions: componentConfig.requiredPermissions
        });
        
        console.log(`✅ Secure ${componentConfig.name} initialized`);
        
      } catch (error) {
        console.error(`Failed to initialize ${componentConfig.name}:`, error);
        
        this.componentHealth.set(componentConfig.name, {
          status: 'failed',
          lastCheck: Date.now(),
          errors: 1,
          initialized: false,
          securityValidated: false,
          error: error.message
        });
        
        await this.auditLog('component_initialization_failed', {
          component: componentConfig.name,
          error: error.message
        });
        
        if (this.config.strictMode) {
          throw error;
        }
      }
    }
  }

  validateComponentSecurity(component, componentName) {
    const requiredMethods = [
      'initialize', 'start', 'stop', 'getSystemStatus'
    ];
    
    for (const method of requiredMethods) {
      if (typeof component[method] !== 'function') {
        throw new Error(`Component ${componentName} missing required method: ${method}`);
      }
    }
    
    // Verify component has security configuration
    if (!component.config || typeof component.config !== 'object') {
      throw new Error(`Component ${componentName} missing security configuration`);
    }
    
    // Verify component implements EventEmitter for secure communication
    if (!component.on || !component.emit) {
      throw new Error(`Component ${componentName} must implement EventEmitter interface`);
    }
  }

  generateComponentSignature(component, componentName) {
    // Generate integrity signature for component
    const componentData = {
      name: componentName,
      methods: Object.getOwnPropertyNames(Object.getPrototypeOf(component)),
      config: component.config ? Object.keys(component.config) : [],
      timestamp: Date.now()
    };
    
    return crypto
      .createHash('sha256')
      .update(JSON.stringify(componentData))
      .digest('hex');
  }

  setupSecureComponentEventHandlers() {
    // Two-Phase Commit Events with validation
    const tpc = this.components.get('twoPhaseCommit');
    if (tpc) {
      tpc.on('transaction_committed', (data) => {
        if (this.validateEventData(data, 'transaction_committed')) {
          this.handleSecureTransactionEvent('2pc_committed', data);
          this.performanceStats.twoPhaseCommitCount++;
        }
      });
      
      tpc.on('transaction_aborted', (data) => {
        if (this.validateEventData(data, 'transaction_aborted')) {
          this.handleSecureTransactionEvent('2pc_aborted', data);
        }
      });
      
      tpc.on('critical_consistency_error', (data) => {
        if (this.validateEventData(data, 'critical_consistency_error')) {
          this.handleCriticalConsistencyError('2pc', data);
        }
      });
    }
    
    // Saga Events with validation
    const saga = this.components.get('saga');
    if (saga) {
      saga.on('saga_completed', (data) => {
        if (this.validateEventData(data, 'saga_completed')) {
          this.handleSecureTransactionEvent('saga_completed', data);
          this.performanceStats.sagaCount++;
        }
      });
      
      saga.on('saga_compensated', (data) => {
        if (this.validateEventData(data, 'saga_compensated')) {
          this.handleSecureTransactionEvent('saga_compensated', data);
        }
      });
      
      saga.on('saga_compensation_failed', (data) => {
        if (this.validateEventData(data, 'saga_compensation_failed')) {
          this.handleCriticalConsistencyError('saga', data);
        }
      });
    }
    
    // Eventual Consistency Events with validation
    const ec = this.components.get('eventualConsistency');
    if (ec) {
      ec.on('event_appended', (data) => {
        if (this.validateEventData(data, 'event_appended')) {
          this.handleSecureTransactionEvent('event_appended', data);
          this.performanceStats.eventualConsistencyCount++;
        }
      });
      
      ec.on('state_discrepancy_detected', (data) => {
        if (this.validateEventData(data, 'state_discrepancy_detected')) {
          this.handleConsistencyViolation('eventual_consistency', data);
        }
      });
      
      ec.on('conflict_resolved', (data) => {
        if (this.validateEventData(data, 'conflict_resolved')) {
          this.handleSecureTransactionEvent('conflict_resolved', data);
        }
      });
    }
    
    // Blockchain Reconciliation Events with validation
    const blockchain = this.components.get('blockchainReconciliation');
    if (blockchain) {
      blockchain.on('state_discrepancy_detected', (data) => {
        if (this.validateEventData(data, 'state_discrepancy_detected')) {
          this.handleConsistencyViolation('blockchain', data);
        }
      });
      
      blockchain.on('reconciliation_completed', (data) => {
        if (this.validateEventData(data, 'reconciliation_completed')) {
          this.handleSecureTransactionEvent('blockchain_reconciled', data);
          this.performanceStats.blockchainReconciliations++;
        }
      });
    }
    
    // Dead Letter Queue Events with validation
    const dlq = this.components.get('deadLetterQueue');
    if (dlq) {
      dlq.on('message_dead_lettered', (data) => {
        if (this.validateEventData(data, 'message_dead_lettered')) {
          this.handleDeadLetterEvent(data);
          this.performanceStats.deadLetterMessages++;
        }
      });
      
      dlq.on('failure_pattern_alert', (data) => {
        if (this.validateEventData(data, 'failure_pattern_alert')) {
          this.handleFailurePattern(data);
        }
      });
    }
  }

  validateEventData(data, eventType) {
    if (!data || typeof data !== 'object') {
      console.warn(`Invalid event data for ${eventType}`);
      return false;
    }
    
    // Validate based on event type
    const requiredFields = {
      'transaction_committed': ['transactionId'],
      'transaction_aborted': ['transactionId'],
      'saga_completed': ['sagaId'],
      'saga_compensated': ['sagaId'],
      'event_appended': ['eventId'],
      'state_discrepancy_detected': ['entityId'],
      'conflict_resolved': ['conflictId'],
      'reconciliation_completed': ['reconciliationId'],
      'message_dead_lettered': ['messageId'],
      'failure_pattern_alert': ['pattern']
    };
    
    const required = requiredFields[eventType];
    if (required) {
      for (const field of required) {
        if (!data[field]) {
          console.warn(`Missing required field ${field} for event ${eventType}`);
          return false;
        }
      }
    }
    
    return true;
  }

  setupSecureTransactionRouting() {
    // Register transaction types with validation
    for (const [type, mechanism] of Object.entries(this.config.transactionRouting)) {
      const sanitizedType = this.sanitizeString(type);
      if (sanitizedType && ['2pc', 'saga', 'eventual'].includes(mechanism)) {
        this.transactionTypes.set(sanitizedType, mechanism);
      }
    }
    
    console.log('Secure transaction routing configured:', Object.fromEntries(this.transactionTypes));
  }

  initializeHealthMonitoring() {
    // Start health monitoring with security checks
    this.healthCheckInterval = setInterval(async () => {
      try {
        await this.performSecureHealthCheck();
      } catch (error) {
        console.error('Health check error:', error);
        await this.auditLog('health_check_failed', { error: error.message });
      }
    }, this.config.healthCheckInterval);
  }

  async start() {
    if (this.isRunning) return;
    
    console.log('🚀 Starting Secure Data Consistency Orchestrator...');
    this.isRunning = true;
    
    // Start all components with security validation
    await this.startSecureComponents();
    
    // Start monitoring with security metrics
    this.startSecureMonitoring();
    
    // Start memory monitoring
    this.startMemoryMonitoring();
    
    console.log('✅ Secure Data Consistency Orchestrator started');
    
    // Emit secure system ready event
    this.emit('system_ready', {
      timestamp: Date.now(),
      components: Array.from(this.components.keys()),
      systemHealth: this.systemHealth,
      securityEnabled: true
    });
    
    await this.auditLog('orchestrator_started', {
      components: Array.from(this.components.keys()),
      securityControls: Object.keys(this.securityControls).filter(k => this.securityControls[k])
    });
  }

  async startSecureComponents() {
    for (const [name, component] of this.components) {
      try {
        console.log(`Starting secure ${name}...`);
        
        // Verify component integrity before starting
        const currentSignature = this.generateComponentSignature(component, name);
        const expectedSignature = this.componentSignatures.get(name);
        
        if (currentSignature !== expectedSignature) {
          throw new Error(`Component integrity check failed for ${name}`);
        }
        
        await component.start();
        
        const health = this.componentHealth.get(name);
        health.status = 'running';
        health.lastCheck = Date.now();
        
        console.log(`✅ Secure ${name} started`);
        
      } catch (error) {
        console.error(`Failed to start ${name}:`, error);
        
        const health = this.componentHealth.get(name);
        health.status = 'failed';
        health.errors++;
        health.error = error.message;
        
        await this.auditLog('component_start_failed', {
          component: name,
          error: error.message
        });
        
        if (this.config.strictMode) {
          throw error;
        }
      }
    }
  }

  startSecureMonitoring() {
    // Performance monitoring with security metrics
    this.performanceInterval = setInterval(async () => {
      await this.updateSecurePerformanceMetrics();
    }, 60000); // Every minute
    
    // Rate limit window reset
    this.rateLimitResetInterval = setInterval(() => {
      this.transactionCounts.clear();
    }, this.rateLimitWindow);
  }

  startMemoryMonitoring() {
    this.memoryMonitorInterval = setInterval(() => {
      const usage = process.memoryUsage();
      const heapUsedRatio = usage.heapUsed / usage.heapTotal;
      
      if (heapUsedRatio > this.memoryWatermarks.critical) {
        console.error('CRITICAL: Memory usage exceeds safe limits');
        this.emit('memory_critical', { usage, ratio: heapUsedRatio });
      } else if (heapUsedRatio > this.memoryWatermarks.high) {
        console.warn('WARNING: High memory usage detected');
        this.emit('memory_high', { usage, ratio: heapUsedRatio });
      }
      
      // Force garbage collection if needed and available
      if (global.gc && heapUsedRatio > this.memoryWatermarks.high) {
        global.gc();
      }
    }, 30000); // Every 30 seconds
  }

  // Secure transaction execution with comprehensive validation
  async executeTransaction(transactionType, transactionData, participants = [], authToken = null) {
    const startTime = Date.now();
    let transactionId = null;
    let authenticatedUser = null;
    
    try {
      // 1. Authentication and authorization
      authenticatedUser = await this.authenticateRequest(authToken);
      
      if (!await this.authorizeRequest(authenticatedUser, 'execute_transaction', transactionType)) {
        this.performanceStats.authorizationFailures++;
        throw new Error('Insufficient permissions for transaction execution');
      }
      
      // 2. Input validation and sanitization
      const {
        sanitizedTransactionType,
        sanitizedTransactionData,
        sanitizedParticipants
      } = await this.validateAndSanitizeTransactionInput(
        transactionType, 
        transactionData, 
        participants
      );
      
      // 3. Rate limiting check
      if (!await this.checkRateLimit(authenticatedUser)) {
        this.performanceStats.transactionsBlocked++;
        throw new Error('Rate limit exceeded');
      }
      
      // 4. Memory usage check
      if (!this.checkMemoryLimits()) {
        throw new Error('System memory limits exceeded');
      }
      
      // 5. Generate secure transaction ID
      transactionId = await this.generateSecureTransactionId();
      
      // 6. Determine consistency mechanism with validation
      const mechanism = this.transactionTypes.get(sanitizedTransactionType) || this.config.defaultConsistencyLevel;
      
      // 7. Acquire transaction lock
      const lockId = await this.acquireTransactionLock(transactionId);
      
      try {
        // 8. Track transaction with limits
        if (this.activeTransactions.size >= this.transactionLimits.maxConcurrent) {
          throw new Error('Maximum concurrent transactions exceeded');
        }
        
        this.activeTransactions.set(transactionId, {
          id: transactionId,
          type: sanitizedTransactionType,
          mechanism,
          startTime,
          status: 'executing',
          userId: authenticatedUser.id,
          size: JSON.stringify(sanitizedTransactionData).length,
          lockId
        });
        
        // 9. Execute transaction with appropriate mechanism
        let result;
        switch (mechanism) {
          case '2pc':
            result = await this.executeSecureTwoPhaseCommit(
              transactionId, 
              sanitizedTransactionData, 
              sanitizedParticipants, 
              authenticatedUser
            );
            break;
          case 'saga':
            result = await this.executeSecureSaga(
              transactionId, 
              sanitizedTransactionType, 
              sanitizedTransactionData, 
              authenticatedUser
            );
            break;
          case 'eventual':
            result = await this.executeSecureEventualConsistency(
              transactionId, 
              sanitizedTransactionType, 
              sanitizedTransactionData, 
              authenticatedUser
            );
            break;
          default:
            throw new Error(`Unsupported consistency mechanism: ${mechanism}`);
        }
        
        // 10. Update transaction status
        const transaction = this.activeTransactions.get(transactionId);
        transaction.status = 'completed';
        transaction.endTime = Date.now();
        transaction.result = this.sanitizeTransactionResult(result);
        
        // 11. Update performance stats
        this.performanceStats.transactionsProcessed++;
        const transactionTime = transaction.endTime - transaction.startTime;
        this.performanceStats.averageTransactionTime = 
          (this.performanceStats.averageTransactionTime * 0.9) + (transactionTime * 0.1);
        
        // 12. Clean up
        this.activeTransactions.delete(transactionId);
        await this.releaseTransactionLock(lockId);
        
        // 13. Audit successful transaction
        await this.auditLog('transaction_completed', {
          transactionId,
          transactionType: sanitizedTransactionType,
          mechanism,
          duration: transactionTime,
          userId: authenticatedUser.id,
          success: true
        });
        
        this.emit('transaction_completed', {
          transactionId,
          type: sanitizedTransactionType,
          mechanism,
          duration: transactionTime,
          success: true
        });
        
        return {
          transactionId,
          mechanism,
          status: 'completed',
          duration: transactionTime,
          result: transaction.result
        };
        
      } finally {
        // Always release lock
        if (lockId) {
          await this.releaseTransactionLock(lockId);
        }
      }
      
    } catch (error) {
      console.error(`Transaction ${transactionId || 'unknown'} failed:`, error);
      
      // Update transaction status if it exists
      if (transactionId && this.activeTransactions.has(transactionId)) {
        const transaction = this.activeTransactions.get(transactionId);
        transaction.status = 'failed';
        transaction.error = error.message;
        transaction.endTime = Date.now();
        
        this.activeTransactions.delete(transactionId);
      }
      
      // Handle failure through dead letter queue
      if (transactionId) {
        await this.handleSecureTransactionFailure(transactionId, transactionType, error, authenticatedUser);
      }
      
      // Audit failed transaction
      await this.auditLog('transaction_failed', {
        transactionId: transactionId || 'unknown',
        transactionType,
        error: error.message,
        userId: authenticatedUser?.id
      });
      
      this.emit('transaction_failed', {
        transactionId: transactionId || 'unknown',
        type: transactionType,
        error: error.message
      });
      
      throw error;
    }
  }

  async authenticateRequest(authToken) {
    if (!this.securityControls.enableAuthentication) {
      return { id: 'system', roles: ['system'] }; // System user for testing
    }
    
    if (!authToken) {
      this.performanceStats.authenticationFailures++;
      throw new Error('Authentication token required');
    }
    
    try {
      const user = await this.authenticationService.validateToken(authToken);
      if (!user) {
        this.performanceStats.authenticationFailures++;
        throw new Error('Invalid authentication token');
      }
      
      return user;
      
    } catch (error) {
      this.performanceStats.authenticationFailures++;
      await this.auditLog('authentication_failed', { error: error.message });
      throw error;
    }
  }

  async authorizeRequest(user, action, resource) {
    if (!this.securityControls.enableAuthorization) {
      return true; // Skip authorization for testing
    }
    
    try {
      const authorized = await this.authorizationService.checkPermission(user, action, resource);
      
      if (!authorized) {
        await this.auditLog('authorization_failed', {
          userId: user.id,
          action,
          resource
        });
      }
      
      return authorized;
      
    } catch (error) {
      await this.auditLog('authorization_error', {
        userId: user.id,
        action,
        resource,
        error: error.message
      });
      return false;
    }
  }

  async validateAndSanitizeTransactionInput(transactionType, transactionData, participants) {
    // Validate transaction type
    const sanitizedTransactionType = this.sanitizeString(transactionType);
    if (!sanitizedTransactionType) {
      throw new Error('Invalid transaction type');
    }
    
    // Validate transaction data
    if (!transactionData || typeof transactionData !== 'object') {
      throw new Error('Invalid transaction data');
    }
    
    const sanitizedTransactionData = this.sanitizeTransactionData(transactionData);
    
    // Check transaction size limits
    const transactionSize = JSON.stringify(sanitizedTransactionData).length;
    if (transactionSize > this.transactionLimits.maxTransactionSize) {
      throw new Error('Transaction size exceeds limits');
    }
    
    // Validate participants
    const sanitizedParticipants = this.sanitizeParticipants(participants);
    
    return {
      sanitizedTransactionType,
      sanitizedTransactionData,
      sanitizedParticipants
    };
  }

  sanitizeTransactionData(data) {
    if (!data || typeof data !== 'object') return {};
    
    const sanitized = {};
    const allowedKeys = new Set([
      'entityId', 'entityType', 'amount', 'token', 'userId', 
      'orderId', 'marketId', 'price', 'quantity', 'side',
      'metadata', 'timestamp', 'signature'
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

  sanitizeParticipants(participants) {
    if (!Array.isArray(participants)) return [];
    
    return participants
      .filter(p => typeof p === 'string')
      .map(p => this.sanitizeString(p))
      .filter(p => p.length > 0)
      .slice(0, 10); // Limit to 10 participants
  }

  sanitizeTransactionResult(result) {
    if (!result || typeof result !== 'object') return {};
    
    const sanitized = {};
    const allowedKeys = new Set([
      'transactionId', 'status', 'result', 'timestamp', 
      'blockNumber', 'gasUsed', 'confirmations'
    ]);
    
    for (const [key, value] of Object.entries(result)) {
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

  async checkRateLimit(user) {
    if (!this.securityControls.enableRateLimiting) {
      return true;
    }
    
    const userId = user.id;
    const currentCount = this.transactionCounts.get(userId) || 0;
    
    if (currentCount >= this.transactionLimits.maxPerMinute) {
      await this.auditLog('rate_limit_exceeded', { userId });
      return false;
    }
    
    this.transactionCounts.set(userId, currentCount + 1);
    return true;
  }

  checkMemoryLimits() {
    const usage = process.memoryUsage();
    const heapUsedRatio = usage.heapUsed / usage.heapTotal;
    
    return heapUsedRatio < this.memoryWatermarks.high;
  }

  async generateSecureTransactionId() {
    // Use cryptographically secure random generation
    const timestamp = Date.now();
    const randomBytes = crypto.randomBytes(16);
    const nodeId = process.env.NODE_ID || 'default';
    
    const hash = crypto
      .createHash('sha256')
      .update(`${timestamp}:${randomBytes.toString('hex')}:${nodeId}`)
      .digest('hex');
    
    return `tx_secure_${timestamp}_${hash.substring(0, 16)}`;
  }

  async acquireTransactionLock(transactionId) {
    const lockId = `lock_${transactionId}`;
    const lockTimeout = Date.now() + this.maxLockTime;
    
    // Simple lock implementation - in production, use Redis distributed locks
    if (this.locks.has(lockId)) {
      throw new Error('Transaction lock already exists');
    }
    
    this.locks.set(lockId, {
      transactionId,
      acquiredAt: Date.now(),
      expiresAt: lockTimeout
    });
    
    // Set cleanup timeout
    const timeoutHandle = setTimeout(() => {
      this.locks.delete(lockId);
      this.lockTimeouts.delete(lockId);
    }, this.maxLockTime);
    
    this.lockTimeouts.set(lockId, timeoutHandle);
    
    return lockId;
  }

  async releaseTransactionLock(lockId) {
    if (this.locks.has(lockId)) {
      this.locks.delete(lockId);
    }
    
    const timeoutHandle = this.lockTimeouts.get(lockId);
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      this.lockTimeouts.delete(lockId);
    }
  }

  async executeSecureTwoPhaseCommit(transactionId, transactionData, participants, authenticatedUser) {
    const tpc = this.components.get('twoPhaseCommit');
    if (!tpc) {
      throw new Error('Two-Phase Commit Coordinator not available');
    }
    
    console.log(`Executing secure 2PC transaction: ${transactionId}`);
    return await tpc.startTransaction(transactionData, participants, authenticatedUser);
  }

  async executeSecureSaga(transactionId, sagaType, transactionData, authenticatedUser) {
    const saga = this.components.get('saga');
    if (!saga) {
      throw new Error('Saga Orchestrator not available');
    }
    
    console.log(`Executing secure Saga transaction: ${transactionId} (${sagaType})`);
    return await saga.startSaga(sagaType, transactionData, authenticatedUser);
  }

  async executeSecureEventualConsistency(transactionId, eventType, transactionData, authenticatedUser) {
    const ec = this.components.get('eventualConsistency');
    if (!ec) {
      throw new Error('Eventual Consistency Manager not available');
    }
    
    console.log(`Executing secure eventual consistency transaction: ${transactionId} (${eventType})`);
    
    // Extract entity information from transaction data
    const entityId = transactionData.entityId || transactionId;
    const entityType = transactionData.entityType || 'generic';
    
    return await ec.appendEvent(entityId, entityType, eventType, transactionData, 'important', authenticatedUser);
  }

  async handleSecureTransactionFailure(transactionId, transactionType, error, authenticatedUser) {
    const dlq = this.components.get('deadLetterQueue');
    if (!dlq) {
      console.error(`No dead letter queue available for failed transaction: ${transactionId}`);
      return;
    }
    
    // Queue failed transaction for retry with security context
    await dlq.enqueueMessage('failed_transaction', {
      transactionId,
      transactionType,
      error: error.message,
      userId: authenticatedUser?.id,
      timestamp: Date.now(),
      securityContext: {
        authenticated: !!authenticatedUser,
        userId: authenticatedUser?.id
      }
    }, 'high', null, authenticatedUser);
  }

  // Event handlers with security validation
  handleSecureTransactionEvent(eventType, data) {
    console.log(`Secure transaction event: ${eventType}`, this.sanitizeAuditDetails(data));
    
    // Update metrics based on event type
    this.updateEventMetrics(eventType, data);
    
    // Emit to external listeners with sanitized data
    this.emit('consistency_event', {
      type: eventType,
      data: this.sanitizeAuditDetails(data),
      timestamp: Date.now(),
      security: { validated: true }
    });
  }

  handleCriticalConsistencyError(component, data) {
    console.error(`Critical consistency error in ${component}:`, data);
    
    this.performanceStats.consistencyViolations++;
    
    // Emit critical alert with security context
    this.emit('critical_consistency_error', {
      component,
      data: this.sanitizeAuditDetails(data),
      timestamp: Date.now(),
      severity: 'critical',
      security: { validated: true }
    });
    
    // Send to dead letter queue for manual review
    const dlq = this.components.get('deadLetterQueue');
    if (dlq) {
      dlq.enqueueMessage('consistency_violation', {
        component,
        data: this.sanitizeAuditDetails(data),
        severity: 'critical'
      }, 'critical');
    }
    
    // Log to audit system
    this.auditLog('critical_consistency_error', {
      component,
      severity: 'critical',
      details: this.sanitizeAuditDetails(data)
    });
  }

  handleConsistencyViolation(component, data) {
    console.warn(`Consistency violation in ${component}:`, data);
    
    this.performanceStats.consistencyViolations++;
    
    this.emit('consistency_violation', {
      component,
      data: this.sanitizeAuditDetails(data),
      timestamp: Date.now(),
      severity: 'warning',
      security: { validated: true }
    });
    
    // Log to audit system
    this.auditLog('consistency_violation', {
      component,
      severity: 'warning',
      details: this.sanitizeAuditDetails(data)
    });
  }

  handleDeadLetterEvent(data) {
    console.warn('Message moved to dead letter queue:', this.sanitizeAuditDetails(data));
    
    this.emit('dead_letter_event', {
      ...this.sanitizeAuditDetails(data),
      timestamp: Date.now(),
      security: { validated: true }
    });
    
    // Log to audit system
    this.auditLog('dead_letter_event', {
      details: this.sanitizeAuditDetails(data)
    });
  }

  handleFailurePattern(data) {
    console.warn('Failure pattern detected:', this.sanitizeAuditDetails(data));
    
    this.emit('failure_pattern_detected', {
      ...this.sanitizeAuditDetails(data),
      timestamp: Date.now(),
      security: { validated: true }
    });
    
    // Log to audit system
    this.auditLog('failure_pattern_detected', {
      details: this.sanitizeAuditDetails(data)
    });
  }

  updateEventMetrics(eventType, data) {
    // Update specific metrics based on event type
    switch (eventType) {
      case '2pc_committed':
      case 'saga_completed':
      case 'event_appended':
        // Success events - already tracked in component handlers
        break;
      case '2pc_aborted':
      case 'saga_compensated':
        // Compensated transactions
        break;
      case 'conflict_resolved':
      case 'blockchain_reconciled':
        // Recovery events
        break;
    }
  }

  async performSecureHealthCheck() {
    let healthyComponents = 0;
    let totalComponents = 0;
    
    for (const [name, component] of this.components) {
      totalComponents++;
      
      try {
        // Verify component integrity
        const currentSignature = this.generateComponentSignature(component, name);
        const expectedSignature = this.componentSignatures.get(name);
        
        if (currentSignature !== expectedSignature) {
          console.error(`Component integrity check failed for ${name}`);
          const health = this.componentHealth.get(name);
          health.status = 'compromised';
          health.errors++;
          continue;
        }
        
        // Check component health
        let isHealthy = false;
        if (typeof component.getSystemStatus === 'function') {
          const status = component.getSystemStatus();
          isHealthy = status.isRunning;
        } else if (typeof component.isRunning !== 'undefined') {
          isHealthy = component.isRunning;
        }
        
        const health = this.componentHealth.get(name);
        if (isHealthy) {
          health.status = 'healthy';
          health.lastCheck = Date.now();
          healthyComponents++;
        } else {
          health.status = 'unhealthy';
          health.errors++;
        }
        
      } catch (error) {
        console.error(`Health check failed for ${name}:`, error);
        
        const health = this.componentHealth.get(name);
        health.status = 'failed';
        health.errors++;
        health.error = error.message;
      }
    }
    
    // Determine overall system health
    const healthRatio = healthyComponents / totalComponents;
    
    if (healthRatio >= 0.8) {
      this.systemHealth = 'healthy';
    } else if (healthRatio >= 0.5) {
      this.systemHealth = 'degraded';
    } else {
      this.systemHealth = 'critical';
    }
    
    // Update system availability
    this.performanceStats.systemAvailability = healthRatio;
    
    this.lastHealthCheck = Date.now();
    
    // Emit health status with security validation
    this.emit('health_check', {
      systemHealth: this.systemHealth,
      healthyComponents,
      totalComponents,
      componentHealth: Object.fromEntries(this.componentHealth),
      timestamp: Date.now(),
      security: { validated: true }
    });
    
    // Log critical health issues
    if (this.systemHealth === 'critical') {
      await this.auditLog('system_health_critical', {
        healthRatio,
        healthyComponents,
        totalComponents
      });
    }
  }

  async updateSecurePerformanceMetrics() {
    try {
      // Update orchestrator metrics with security context
      await this.metrics.setGauge('consistency.transactions_processed', this.performanceStats.transactionsProcessed, { security: 'enabled' }, 'consistency');
      await this.metrics.setGauge('consistency.transactions_blocked', this.performanceStats.transactionsBlocked, { security: 'enabled' }, 'consistency');
      await this.metrics.setGauge('consistency.authentication_failures', this.performanceStats.authenticationFailures, { security: 'enabled' }, 'consistency');
      await this.metrics.setGauge('consistency.authorization_failures', this.performanceStats.authorizationFailures, { security: 'enabled' }, 'consistency');
      await this.metrics.setGauge('consistency.2pc_count', this.performanceStats.twoPhaseCommitCount, { security: 'enabled' }, 'consistency');
      await this.metrics.setGauge('consistency.saga_count', this.performanceStats.sagaCount, { security: 'enabled' }, 'consistency');
      await this.metrics.setGauge('consistency.eventual_consistency_count', this.performanceStats.eventualConsistencyCount, { security: 'enabled' }, 'consistency');
      await this.metrics.setGauge('consistency.blockchain_reconciliations', this.performanceStats.blockchainReconciliations, { security: 'enabled' }, 'consistency');
      await this.metrics.setGauge('consistency.dead_letter_messages', this.performanceStats.deadLetterMessages, { security: 'enabled' }, 'consistency');
      await this.metrics.setGauge('consistency.average_transaction_time', this.performanceStats.averageTransactionTime, { security: 'enabled' }, 'consistency');
      await this.metrics.setGauge('consistency.consistency_violations', this.performanceStats.consistencyViolations, { security: 'enabled' }, 'consistency');
      await this.metrics.setGauge('consistency.system_availability', this.performanceStats.systemAvailability, { security: 'enabled' }, 'consistency');
      await this.metrics.setGauge('consistency.active_transactions', this.activeTransactions.size, { security: 'enabled' }, 'consistency');
      await this.metrics.setGauge('consistency.security_events', this.performanceStats.securityEvents, { security: 'enabled' }, 'consistency');
      
      // Update component counts
      const healthyComponents = Array.from(this.componentHealth.values())
        .filter(h => h.status === 'healthy').length;
      
      await this.metrics.setGauge('consistency.healthy_components', healthyComponents, { security: 'enabled' }, 'consistency');
      await this.metrics.setGauge('consistency.total_components', this.componentHealth.size, { security: 'enabled' }, 'consistency');
      
      // Memory metrics
      const usage = process.memoryUsage();
      await this.metrics.setGauge('consistency.memory_usage', usage.heapUsed, { security: 'enabled' }, 'consistency');
      await this.metrics.setGauge('consistency.memory_total', usage.heapTotal, { security: 'enabled' }, 'consistency');
      
    } catch (error) {
      console.error('Failed to update performance metrics:', error);
      await this.auditLog('metrics_update_failed', { error: error.message });
    }
  }

  async auditLog(event, details) {
    if (this.auditLogger) {
      await this.auditLogger.log(event, details);
    }
  }

  // Utility methods
  getTransactionStatus(transactionId) {
    return this.activeTransactions.get(transactionId);
  }

  getSystemStatus() {
    return {
      isRunning: this.isRunning,
      systemHealth: this.systemHealth,
      lastHealthCheck: this.lastHealthCheck,
      activeTransactions: this.activeTransactions.size,
      securityEnabled: true,
      securityControls: this.securityControls,
      components: Object.fromEntries(
        Array.from(this.components.keys()).map(name => [
          name,
          {
            enabled: this.components.has(name),
            health: this.componentHealth.get(name),
            signature: this.componentSignatures.get(name)
          }
        ])
      ),
      performanceStats: this.performanceStats,
      transactionRouting: Object.fromEntries(this.transactionTypes),
      memoryUsage: process.memoryUsage()
    };
  }

  getComponentStatus(componentName) {
    const component = this.components.get(componentName);
    if (!component) {
      return { error: 'Component not found' };
    }
    
    const health = this.componentHealth.get(componentName);
    let componentStatus = {};
    
    if (typeof component.getSystemStatus === 'function') {
      componentStatus = component.getSystemStatus();
    }
    
    return {
      health,
      signature: this.componentSignatures.get(componentName),
      ...componentStatus
    };
  }

  stop() {
    if (!this.isRunning) return;
    
    console.log('🛑 Stopping Secure Data Consistency Orchestrator...');
    
    // Stop monitoring intervals
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    if (this.performanceInterval) {
      clearInterval(this.performanceInterval);
    }
    if (this.rateLimitResetInterval) {
      clearInterval(this.rateLimitResetInterval);
    }
    if (this.memoryMonitorInterval) {
      clearInterval(this.memoryMonitorInterval);
    }
    
    // Clean up all locks
    for (const [lockId, timeoutHandle] of this.lockTimeouts) {
      clearTimeout(timeoutHandle);
    }
    this.locks.clear();
    this.lockTimeouts.clear();
    
    // Stop all components
    for (const [name, component] of this.components) {
      try {
        if (typeof component.stop === 'function') {
          component.stop();
        }
        console.log(`✅ ${name} stopped`);
      } catch (error) {
        console.error(`Failed to stop ${name}:`, error);
      }
    }
    
    // Clear data
    this.components.clear();
    this.componentHealth.clear();
    this.componentSignatures.clear();
    this.activeTransactions.clear();
    this.transactionTypes.clear();
    this.transactionCounts.clear();
    
    this.isRunning = false;
    console.log('✅ Secure Data Consistency Orchestrator stopped');
    
    // Final audit log
    this.auditLog('orchestrator_stopped', {
      timestamp: Date.now(),
      gracefulShutdown: true
    });
  }
}

module.exports = SecureDataConsistencyOrchestrator;