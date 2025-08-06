const EventEmitter = require('events');
const TwoPhaseCommitCoordinator = require('./two-phase-commit-coordinator');
const SagaOrchestrator = require('./saga-orchestrator');
const EventualConsistencyManager = require('./eventual-consistency-manager');
const BlockchainReconciliationService = require('./blockchain-reconciliation-service');
const DeadLetterQueueManager = require('./dead-letter-queue-manager');
const { getSecureMetricsCollector } = require('../../monitoring/secure-metrics-collector');

class DataConsistencyOrchestrator extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      // Component configurations
      twoPhaseCommit: config.twoPhaseCommit || {},
      saga: config.saga || {},
      eventualConsistency: config.eventualConsistency || {},
      blockchainReconciliation: config.blockchainReconciliation || {},
      deadLetterQueue: config.deadLetterQueue || {},
      
      // Orchestrator settings
      enableAllComponents: config.enableAllComponents !== false,
      strictMode: config.strictMode !== false,
      
      // Transaction routing
      transactionRouting: this.validateTransactionRouting(config.transactionRouting || {
        critical: '2pc',      // Use 2PC for critical operations
        important: 'saga',    // Use Saga for important operations
        normal: 'eventual',   // Use eventual consistency for normal operations
        batch: 'eventual'     // Use eventual consistency for batch operations
      }),
      
      // Consistency levels
      defaultConsistencyLevel: this.validateConsistencyLevel(config.defaultConsistencyLevel || 'eventual'),
      
      // Performance settings
      healthCheckInterval: this.validateNumber(config.healthCheckInterval, 30000, 10000, 300000),
      
      // Security settings
      authenticationRequired: config.authenticationRequired !== false,
      
      ...config
    };
    
    this.metrics = getSecureMetricsCollector();
    this.isRunning = false;
    
    // Data consistency components
    this.components = new Map();
    this.componentHealth = new Map();
    
    // System state
    this.systemHealth = 'healthy';
    this.lastHealthCheck = null;
    
    // Transaction tracking
    this.activeTransactions = new Map(); // txId -> transaction metadata
    this.transactionTypes = new Map(); // txType -> consistency mechanism
    
    // Performance tracking
    this.performanceStats = {
      transactionsProcessed: 0,
      twoPhaseCommitCount: 0,
      sagaCount: 0,
      eventualConsistencyCount: 0,
      blockchainReconciliations: 0,
      deadLetterMessages: 0,
      averageTransactionTime: 0,
      consistencyViolations: 0,
      systemAvailability: 1.0
    };
  }

  validateNumber(value, defaultValue, min, max) {
    if (typeof value !== 'number' || !isFinite(value) || value < min || value > max) {
      return defaultValue;
    }
    return value;
  }

  validateTransactionRouting(routing) {
    const allowedMechanisms = ['2pc', 'saga', 'eventual'];
    const validated = {};
    
    for (const [type, mechanism] of Object.entries(routing)) {
      if (allowedMechanisms.includes(mechanism)) {
        validated[type] = mechanism;
      }
    }
    
    return validated;
  }

  validateConsistencyLevel(level) {
    const allowedLevels = ['strong', 'eventual', 'weak'];
    return allowedLevels.includes(level) ? level : 'eventual';
  }

  async initialize() {
    try {
      console.log('🎯 Initializing Data Consistency Orchestrator...');
      
      // Initialize metrics
      await this.metrics.initialize();
      
      // Initialize all components
      await this.initializeComponents();
      
      // Setup component event handlers
      this.setupComponentEventHandlers();
      
      // Setup transaction type routing
      this.setupTransactionRouting();
      
      console.log('✅ Data Consistency Orchestrator initialized');
      
    } catch (error) {
      console.error('Failed to initialize Data Consistency Orchestrator:', error);
      throw error;
    }
  }

  async initializeComponents() {
    const componentConfigs = [
      { 
        name: 'twoPhaseCommit', 
        class: TwoPhaseCommitCoordinator, 
        config: this.config.twoPhaseCommit,
        enabled: true
      },
      { 
        name: 'saga', 
        class: SagaOrchestrator, 
        config: this.config.saga,
        enabled: true
      },
      { 
        name: 'eventualConsistency', 
        class: EventualConsistencyManager, 
        config: this.config.eventualConsistency,
        enabled: true
      },
      { 
        name: 'blockchainReconciliation', 
        class: BlockchainReconciliationService, 
        config: this.config.blockchainReconciliation,
        enabled: this.config.enableAllComponents
      },
      { 
        name: 'deadLetterQueue', 
        class: DeadLetterQueueManager, 
        config: this.config.deadLetterQueue,
        enabled: true
      }
    ];
    
    for (const { name, class: ComponentClass, config, enabled } of componentConfigs) {
      if (!enabled) {
        console.log(`Skipping ${name} (disabled)`);
        continue;
      }
      
      try {
        console.log(`Initializing ${name}...`);
        
        const component = new ComponentClass(config);
        await component.initialize();
        
        this.components.set(name, component);
        this.componentHealth.set(name, {
          status: 'healthy',
          lastCheck: Date.now(),
          errors: 0,
          initialized: true
        });
        
        console.log(`✅ ${name} initialized`);
        
      } catch (error) {
        console.error(`Failed to initialize ${name}:`, error);
        
        this.componentHealth.set(name, {
          status: 'failed',
          lastCheck: Date.now(),
          errors: 1,
          initialized: false,
          error: error.message
        });
        
        if (this.config.strictMode) {
          throw error;
        }
      }
    }
  }

  setupComponentEventHandlers() {
    // Two-Phase Commit Events
    const tpc = this.components.get('twoPhaseCommit');
    if (tpc) {
      tpc.on('transaction_committed', (data) => {
        this.handleTransactionEvent('2pc_committed', data);
        this.performanceStats.twoPhaseCommitCount++;
      });
      
      tpc.on('transaction_aborted', (data) => {
        this.handleTransactionEvent('2pc_aborted', data);
      });
      
      tpc.on('critical_consistency_error', (data) => {
        this.handleCriticalConsistencyError('2pc', data);
      });
    }
    
    // Saga Events
    const saga = this.components.get('saga');
    if (saga) {
      saga.on('saga_completed', (data) => {
        this.handleTransactionEvent('saga_completed', data);
        this.performanceStats.sagaCount++;
      });
      
      saga.on('saga_compensated', (data) => {
        this.handleTransactionEvent('saga_compensated', data);
      });
      
      saga.on('saga_compensation_failed', (data) => {
        this.handleCriticalConsistencyError('saga', data);
      });
    }
    
    // Eventual Consistency Events
    const ec = this.components.get('eventualConsistency');
    if (ec) {
      ec.on('event_appended', (data) => {
        this.handleTransactionEvent('event_appended', data);
        this.performanceStats.eventualConsistencyCount++;
      });
      
      ec.on('state_discrepancy_detected', (data) => {
        this.handleConsistencyViolation('eventual_consistency', data);
      });
      
      ec.on('conflict_resolved', (data) => {
        this.handleTransactionEvent('conflict_resolved', data);
      });
    }
    
    // Blockchain Reconciliation Events
    const blockchain = this.components.get('blockchainReconciliation');
    if (blockchain) {
      blockchain.on('state_discrepancy_detected', (data) => {
        this.handleConsistencyViolation('blockchain', data);
      });
      
      blockchain.on('reconciliation_completed', (data) => {
        this.handleTransactionEvent('blockchain_reconciled', data);
        this.performanceStats.blockchainReconciliations++;
      });
    }
    
    // Dead Letter Queue Events
    const dlq = this.components.get('deadLetterQueue');
    if (dlq) {
      dlq.on('message_dead_lettered', (data) => {
        this.handleDeadLetterEvent(data);
        this.performanceStats.deadLetterMessages++;
      });
      
      dlq.on('failure_pattern_alert', (data) => {
        this.handleFailurePattern(data);
      });
    }
  }

  setupTransactionRouting() {
    // Register transaction types with their consistency mechanisms
    for (const [type, mechanism] of Object.entries(this.config.transactionRouting)) {
      this.transactionTypes.set(type, mechanism);
    }
    
    console.log('Transaction routing configured:', Object.fromEntries(this.transactionTypes));
  }

  async start() {
    if (this.isRunning) return;
    
    console.log('🚀 Starting Data Consistency Orchestrator...');
    this.isRunning = true;
    
    // Start all components
    await this.startComponents();
    
    // Start health monitoring
    this.startHealthMonitoring();
    
    // Start performance monitoring
    this.startPerformanceMonitoring();
    
    console.log('✅ Data Consistency Orchestrator started');
    
    // Emit system ready event
    this.emit('system_ready', {
      timestamp: Date.now(),
      components: Array.from(this.components.keys()),
      systemHealth: this.systemHealth
    });
  }

  async startComponents() {
    for (const [name, component] of this.components) {
      try {
        console.log(`Starting ${name}...`);
        
        await component.start();
        
        const health = this.componentHealth.get(name);
        health.status = 'running';
        health.lastCheck = Date.now();
        
        console.log(`✅ ${name} started`);
        
      } catch (error) {
        console.error(`Failed to start ${name}:`, error);
        
        const health = this.componentHealth.get(name);
        health.status = 'failed';
        health.errors++;
        health.error = error.message;
        
        if (this.config.strictMode) {
          throw error;
        }
      }
    }
  }

  startHealthMonitoring() {
    this.healthCheckInterval = setInterval(async () => {
      try {
        await this.performHealthCheck();
      } catch (error) {
        console.error('Health check error:', error);
      }
    }, this.config.healthCheckInterval);
  }

  startPerformanceMonitoring() {
    this.performanceInterval = setInterval(async () => {
      await this.updatePerformanceMetrics();
    }, 60000); // Every minute
  }

  // Main transaction execution methods
  async executeTransaction(transactionType, transactionData, participants = [], authenticatedUser = null) {
    const startTime = Date.now();
    
    // Determine consistency mechanism
    const mechanism = this.transactionTypes.get(transactionType) || this.config.defaultConsistencyLevel;
    
    // Generate transaction ID
    const transactionId = this.generateTransactionId();
    
    // Track transaction
    this.activeTransactions.set(transactionId, {
      id: transactionId,
      type: transactionType,
      mechanism,
      startTime,
      status: 'executing',
      user: authenticatedUser?.id
    });
    
    try {
      let result;
      
      switch (mechanism) {
        case '2pc':
          result = await this.executeTwoPhaseCommit(transactionId, transactionData, participants, authenticatedUser);
          break;
        case 'saga':
          result = await this.executeSaga(transactionId, transactionType, transactionData, authenticatedUser);
          break;
        case 'eventual':
          result = await this.executeEventualConsistency(transactionId, transactionType, transactionData, authenticatedUser);
          break;
        default:
          throw new Error(`Unknown consistency mechanism: ${mechanism}`);
      }
      
      // Update transaction
      const transaction = this.activeTransactions.get(transactionId);
      transaction.status = 'completed';
      transaction.endTime = Date.now();
      transaction.result = result;
      
      // Update performance stats
      this.performanceStats.transactionsProcessed++;
      const transactionTime = transaction.endTime - transaction.startTime;
      this.performanceStats.averageTransactionTime = 
        (this.performanceStats.averageTransactionTime * 0.9) + (transactionTime * 0.1);
      
      // Clean up
      this.activeTransactions.delete(transactionId);
      
      this.emit('transaction_completed', {
        transactionId,
        type: transactionType,
        mechanism,
        duration: transactionTime,
        success: true
      });
      
      return {
        transactionId,
        mechanism,
        status: 'completed',
        duration: transactionTime,
        result
      };
      
    } catch (error) {
      console.error(`Transaction ${transactionId} failed:`, error);
      
      // Update transaction
      const transaction = this.activeTransactions.get(transactionId);
      if (transaction) {
        transaction.status = 'failed';
        transaction.error = error.message;
        transaction.endTime = Date.now();
      }
      
      // Handle failure through dead letter queue
      await this.handleTransactionFailure(transactionId, transactionType, error);
      
      // Clean up
      this.activeTransactions.delete(transactionId);
      
      this.emit('transaction_failed', {
        transactionId,
        type: transactionType,
        mechanism,
        error: error.message
      });
      
      throw error;
    }
  }

  generateTransactionId() {
    const timestamp = Date.now();
    const random = require('crypto').randomBytes(8).toString('hex');
    return `tx_orchestrator_${timestamp}_${random}`;
  }

  async executeTwoPhaseCommit(transactionId, transactionData, participants, authenticatedUser) {
    const tpc = this.components.get('twoPhaseCommit');
    if (!tpc) {
      throw new Error('Two-Phase Commit Coordinator not available');
    }
    
    console.log(`Executing 2PC transaction: ${transactionId}`);
    return await tpc.startTransaction(transactionData, participants, authenticatedUser);
  }

  async executeSaga(transactionId, sagaType, transactionData, authenticatedUser) {
    const saga = this.components.get('saga');
    if (!saga) {
      throw new Error('Saga Orchestrator not available');
    }
    
    console.log(`Executing Saga transaction: ${transactionId} (${sagaType})`);
    return await saga.startSaga(sagaType, transactionData, authenticatedUser);
  }

  async executeEventualConsistency(transactionId, eventType, transactionData, authenticatedUser) {
    const ec = this.components.get('eventualConsistency');
    if (!ec) {
      throw new Error('Eventual Consistency Manager not available');
    }
    
    console.log(`Executing eventual consistency transaction: ${transactionId} (${eventType})`);
    
    // Extract entity information from transaction data
    const entityId = transactionData.entityId || transactionId;
    const entityType = transactionData.entityType || 'generic';
    
    return await ec.appendEvent(entityId, entityType, eventType, transactionData, 'important', authenticatedUser);
  }

  async handleTransactionFailure(transactionId, transactionType, error) {
    const dlq = this.components.get('deadLetterQueue');
    if (!dlq) {
      console.error(`No dead letter queue available for failed transaction: ${transactionId}`);
      return;
    }
    
    // Queue failed transaction for retry
    await dlq.enqueueMessage('failed_transaction', {
      transactionId,
      transactionType,
      error: error.message,
      timestamp: Date.now()
    }, 'high');
  }

  // Event handlers
  handleTransactionEvent(eventType, data) {
    console.log(`Transaction event: ${eventType}`, data);
    
    // Update metrics based on event type
    this.updateEventMetrics(eventType, data);
    
    // Emit to external listeners
    this.emit('consistency_event', {
      type: eventType,
      data,
      timestamp: Date.now()
    });
  }

  handleCriticalConsistencyError(component, data) {
    console.error(`Critical consistency error in ${component}:`, data);
    
    this.performanceStats.consistencyViolations++;
    
    // Emit critical alert
    this.emit('critical_consistency_error', {
      component,
      data,
      timestamp: Date.now(),
      severity: 'critical'
    });
    
    // Send to dead letter queue for manual review
    const dlq = this.components.get('deadLetterQueue');
    if (dlq) {
      dlq.enqueueMessage('consistency_violation', {
        component,
        data,
        severity: 'critical'
      }, 'critical');
    }
  }

  handleConsistencyViolation(component, data) {
    console.warn(`Consistency violation in ${component}:`, data);
    
    this.performanceStats.consistencyViolations++;
    
    this.emit('consistency_violation', {
      component,
      data,
      timestamp: Date.now(),
      severity: 'warning'
    });
  }

  handleDeadLetterEvent(data) {
    console.warn('Message moved to dead letter queue:', data);
    
    this.emit('dead_letter_event', {
      ...data,
      timestamp: Date.now()
    });
  }

  handleFailurePattern(data) {
    console.warn('Failure pattern detected:', data);
    
    this.emit('failure_pattern_detected', {
      ...data,
      timestamp: Date.now()
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

  async performHealthCheck() {
    let healthyComponents = 0;
    let totalComponents = 0;
    
    for (const [name, component] of this.components) {
      totalComponents++;
      
      try {
        let isHealthy = false;
        
        // Check component health
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
    
    // Emit health status
    this.emit('health_check', {
      systemHealth: this.systemHealth,
      healthyComponents,
      totalComponents,
      componentHealth: Object.fromEntries(this.componentHealth),
      timestamp: Date.now()
    });
  }

  async updatePerformanceMetrics() {
    try {
      // Update orchestrator metrics
      await this.metrics.setGauge('consistency.transactions_processed', this.performanceStats.transactionsProcessed, {}, 'consistency');
      await this.metrics.setGauge('consistency.2pc_count', this.performanceStats.twoPhaseCommitCount, {}, 'consistency');
      await this.metrics.setGauge('consistency.saga_count', this.performanceStats.sagaCount, {}, 'consistency');
      await this.metrics.setGauge('consistency.eventual_consistency_count', this.performanceStats.eventualConsistencyCount, {}, 'consistency');
      await this.metrics.setGauge('consistency.blockchain_reconciliations', this.performanceStats.blockchainReconciliations, {}, 'consistency');
      await this.metrics.setGauge('consistency.dead_letter_messages', this.performanceStats.deadLetterMessages, {}, 'consistency');
      await this.metrics.setGauge('consistency.average_transaction_time', this.performanceStats.averageTransactionTime, {}, 'consistency');
      await this.metrics.setGauge('consistency.consistency_violations', this.performanceStats.consistencyViolations, {}, 'consistency');
      await this.metrics.setGauge('consistency.system_availability', this.performanceStats.systemAvailability, {}, 'consistency');
      await this.metrics.setGauge('consistency.active_transactions', this.activeTransactions.size, {}, 'consistency');
      
      // Update component counts
      const healthyComponents = Array.from(this.componentHealth.values())
        .filter(h => h.status === 'healthy').length;
      
      await this.metrics.setGauge('consistency.healthy_components', healthyComponents, {}, 'consistency');
      await this.metrics.setGauge('consistency.total_components', this.componentHealth.size, {}, 'consistency');
      
    } catch (error) {
      console.error('Failed to update performance metrics:', error);
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
      components: Object.fromEntries(
        Array.from(this.components.keys()).map(name => [
          name,
          {
            enabled: this.components.has(name),
            health: this.componentHealth.get(name)
          }
        ])
      ),
      performanceStats: this.performanceStats,
      transactionRouting: Object.fromEntries(this.transactionTypes)
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
      ...componentStatus
    };
  }

  stop() {
    if (!this.isRunning) return;
    
    console.log('🛑 Stopping Data Consistency Orchestrator...');
    
    // Stop monitoring intervals
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    if (this.performanceInterval) {
      clearInterval(this.performanceInterval);
    }
    
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
    this.activeTransactions.clear();
    this.transactionTypes.clear();
    
    this.isRunning = false;
    console.log('✅ Data Consistency Orchestrator stopped');
  }
}

module.exports = DataConsistencyOrchestrator;