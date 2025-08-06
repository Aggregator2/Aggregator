const EventEmitter = require('events');
const crypto = require('crypto');
const { getSecureMetricsCollector } = require('../../monitoring/secure-metrics-collector');

class SagaOrchestrator extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      // Validated timeout settings
      stepTimeout: this.validateNumber(config.stepTimeout, 30000, 5000, 300000),
      sagaTimeout: this.validateNumber(config.sagaTimeout, 300000, 60000, 3600000),
      compensationTimeout: this.validateNumber(config.compensationTimeout, 60000, 10000, 600000),
      
      // Retry configuration with validation
      maxRetries: this.validateNumber(config.maxRetries, 3, 1, 10),
      retryBackoff: this.validateNumber(config.retryBackoff, 1000, 100, 10000),
      
      // Performance settings
      maxConcurrentSagas: this.validateNumber(config.maxConcurrentSagas, 100, 10, 10000),
      sagaLogSize: this.validateNumber(config.sagaLogSize, 10000, 1000, 1000000),
      
      // Security settings
      authenticationRequired: config.authenticationRequired !== false,
      encryptionEnabled: config.encryptionEnabled !== false,
      
      // Redis configuration for saga persistence
      redisUrl: this.sanitizeUrl(config.redisUrl || process.env.REDIS_URL),
      keyPrefix: this.sanitizeKeyPrefix(config.keyPrefix || 'saga:'),
      
      // Compensation strategy
      compensationStrategy: this.validateCompensationStrategy(config.compensationStrategy || 'reverse_order'),
      
      // Parallel execution settings
      allowParallelSteps: config.allowParallelSteps !== false,
      maxParallelSteps: this.validateNumber(config.maxParallelSteps, 5, 1, 50),
      
      ...config
    };
    
    this.metrics = getSecureMetricsCollector();
    this.redis = null;
    this.isRunning = false;
    
    // Saga state management
    this.activeSagas = new Map(); // sagaId -> saga state
    this.sagaDefinitions = new Map(); // sagaType -> saga definition
    this.sagaLog = new Map(); // sagaId -> log entries
    
    // Step execution tracking
    this.stepExecutors = new Map(); // stepType -> executor function
    this.compensationHandlers = new Map(); // stepType -> compensation function
    
    // Performance tracking
    this.performanceStats = {
      sagasStarted: 0,
      sagasCompleted: 0,
      sagasFailed: 0,
      sagasCompensated: 0,
      averageExecutionTime: 0,
      averageStepsPerSaga: 0,
      successRate: 0,
      compensationRate: 0
    };
    
    // Timeout management
    this.timeouts = new Map(); // sagaId -> timeout handles
    
    // Recovery mechanisms
    this.recoveryInterval = null;
    this.recoveryEnabled = config.recoveryEnabled !== false;
    
    // Security tracking
    this.failedAttempts = new Map();
    this.authorizedUsers = new Set();
    
    // Parallel execution manager
    this.parallelExecutionSemaphore = new Map(); // sagaId -> semaphore count
  }

  validateNumber(value, defaultValue, min, max) {
    if (typeof value !== 'number' || !isFinite(value) || value < min || value > max) {
      return defaultValue;
    }
    return value;
  }

  validateCompensationStrategy(strategy) {
    const allowedStrategies = ['reverse_order', 'parallel', 'custom'];
    return allowedStrategies.includes(strategy) ? strategy : 'reverse_order';
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

  async initialize() {
    try {
      console.log('🎭 Initializing Saga Orchestrator...');
      
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
      
      // Load saga definitions
      await this.loadSagaDefinitions();
      
      // Recover pending sagas
      if (this.recoveryEnabled) {
        await this.recoverPendingSagas();
      }
      
      console.log('✅ Saga Orchestrator initialized');
    } catch (error) {
      console.error('Failed to initialize Saga Orchestrator:', error);
      throw error;
    }
  }

  async start() {
    if (this.isRunning) return;
    
    console.log('🚀 Starting Saga Orchestrator...');
    this.isRunning = true;
    
    // Start recovery monitoring
    if (this.recoveryEnabled) {
      this.startRecoveryMonitoring();
    }
    
    // Start performance monitoring
    this.startPerformanceMonitoring();
    
    console.log('✅ Saga Orchestrator started');
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

  // Define a saga with its steps and compensation logic
  defineSaga(sagaType, definition) {
    const sanitizedType = this.sanitizeString(sagaType);
    if (!sanitizedType) {
      throw new Error('Invalid saga type');
    }
    
    // Validate saga definition
    if (!this.validateSagaDefinition(definition)) {
      throw new Error('Invalid saga definition');
    }
    
    this.sagaDefinitions.set(sanitizedType, {
      type: sanitizedType,
      steps: definition.steps.map(step => this.sanitizeStepDefinition(step)),
      metadata: this.sanitizeObject(definition.metadata || {}),
      compensation: definition.compensation || {},
      timeout: this.validateNumber(definition.timeout, this.config.sagaTimeout, 60000, 3600000),
      retryPolicy: definition.retryPolicy || { maxRetries: this.config.maxRetries },
      parallelGroups: definition.parallelGroups || []
    });
    
    console.log(`Saga definition registered: ${sanitizedType} with ${definition.steps.length} steps`);
  }

  validateSagaDefinition(definition) {
    return definition &&
           Array.isArray(definition.steps) &&
           definition.steps.length > 0 &&
           definition.steps.every(step => this.validateStepDefinition(step));
  }

  validateStepDefinition(step) {
    return step &&
           typeof step.name === 'string' &&
           typeof step.action === 'string' &&
           (step.compensation === undefined || typeof step.compensation === 'string');
  }

  sanitizeStepDefinition(step) {
    return {
      name: this.sanitizeString(step.name),
      action: this.sanitizeString(step.action),
      compensation: step.compensation ? this.sanitizeString(step.compensation) : null,
      timeout: this.validateNumber(step.timeout, this.config.stepTimeout, 5000, 300000),
      retryable: step.retryable !== false,
      critical: step.critical === true,
      parallel: step.parallel === true,
      parallelGroup: step.parallelGroup ? this.sanitizeString(step.parallelGroup) : null,
      parameters: this.sanitizeObject(step.parameters || {})
    };
  }

  sanitizeObject(obj) {
    if (!obj || typeof obj !== 'object') return {};
    
    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      const cleanKey = this.sanitizeString(key);
      if (cleanKey && typeof value !== 'function') {
        if (typeof value === 'string') {
          sanitized[cleanKey] = this.sanitizeString(value);
        } else if (typeof value === 'number' && isFinite(value)) {
          sanitized[cleanKey] = value;
        } else if (typeof value === 'boolean') {
          sanitized[cleanKey] = value;
        } else if (typeof value === 'object' && value !== null) {
          sanitized[cleanKey] = this.sanitizeObject(value);
        }
      }
    }
    return sanitized;
  }

  // Register step executor
  registerStepExecutor(actionType, executor) {
    const sanitizedType = this.sanitizeString(actionType);
    if (!sanitizedType) {
      throw new Error('Invalid action type');
    }
    
    if (typeof executor !== 'function') {
      throw new Error('Executor must be a function');
    }
    
    this.stepExecutors.set(sanitizedType, executor);
    console.log(`Step executor registered: ${sanitizedType}`);
  }

  // Register compensation handler
  registerCompensationHandler(actionType, handler) {
    const sanitizedType = this.sanitizeString(actionType);
    if (!sanitizedType) {
      throw new Error('Invalid action type');
    }
    
    if (typeof handler !== 'function') {
      throw new Error('Compensation handler must be a function');
    }
    
    this.compensationHandlers.set(sanitizedType, handler);
    console.log(`Compensation handler registered: ${sanitizedType}`);
  }

  // Start a new saga
  async startSaga(sagaType, initialData = {}, authenticatedUser = null) {
    // Security validation
    if (this.config.authenticationRequired && !authenticatedUser) {
      throw new Error('Authentication required for saga execution');
    }
    
    // Check concurrent saga limit
    if (this.activeSagas.size >= this.config.maxConcurrentSagas) {
      throw new Error('Maximum concurrent sagas reached');
    }
    
    // Get saga definition
    const definition = this.sagaDefinitions.get(sagaType);
    if (!definition) {
      throw new Error(`Saga type not found: ${sagaType}`);
    }
    
    // Generate secure saga ID
    const sagaId = this.generateSagaId();
    
    // Create saga state
    const saga = {
      id: sagaId,
      type: sagaType,
      state: 'STARTED',
      currentStep: 0,
      completedSteps: [],
      failedSteps: [],
      compensatedSteps: [],
      data: this.sanitizeObject(initialData),
      startTime: Date.now(),
      authenticatedUser: authenticatedUser?.id,
      definition: definition,
      retryCount: 0,
      stepResults: new Map(),
      parallelExecutions: new Map()
    };
    
    // Store saga
    this.activeSagas.set(sagaId, saga);
    this.parallelExecutionSemaphore.set(sagaId, 0);
    
    // Log saga start
    await this.logSaga(sagaId, 'SAGA_STARTED', {
      type: sagaType,
      user: authenticatedUser?.id,
      steps: definition.steps.length
    });
    
    // Set saga timeout
    this.setSagaTimeout(sagaId, definition.timeout);
    
    try {
      console.log(`Starting saga: ${sagaId} (${sagaType}) with ${definition.steps.length} steps`);
      
      // Update performance stats
      this.performanceStats.sagasStarted++;
      
      // Execute saga
      const result = await this.executeSaga(sagaId);
      
      return {
        sagaId,
        status: result.status,
        steps: definition.steps.length,
        duration: result.duration,
        message: result.message
      };
      
    } catch (error) {
      console.error(`Saga ${sagaId} execution failed:`, error);
      await this.handleSagaFailure(sagaId, error);
      throw error;
    }
  }

  generateSagaId() {
    const timestamp = Date.now();
    const random = crypto.randomBytes(8).toString('hex');
    return `saga_${timestamp}_${random}`;
  }

  setSagaTimeout(sagaId, timeoutMs) {
    // Clear existing timeout
    this.clearSagaTimeout(sagaId);
    
    const timeout = setTimeout(async () => {
      console.warn(`Saga ${sagaId} timed out`);
      await this.handleSagaTimeout(sagaId);
    }, timeoutMs);
    
    this.timeouts.set(sagaId, timeout);
  }

  clearSagaTimeout(sagaId) {
    const timeout = this.timeouts.get(sagaId);
    if (timeout) {
      clearTimeout(timeout);
      this.timeouts.delete(sagaId);
    }
  }

  // Execute saga steps
  async executeSaga(sagaId) {
    const saga = this.activeSagas.get(sagaId);
    if (!saga) {
      throw new Error('Saga not found');
    }
    
    try {
      saga.state = 'EXECUTING';
      await this.logSaga(sagaId, 'SAGA_EXECUTION_STARTED', {});
      
      // Process steps according to parallel groups or sequentially
      if (saga.definition.parallelGroups.length > 0) {
        await this.executeParallelGroups(sagaId);
      } else {
        await this.executeSequentialSteps(sagaId);
      }
      
      // Mark saga as completed
      saga.state = 'COMPLETED';
      saga.endTime = Date.now();
      
      await this.logSaga(sagaId, 'SAGA_COMPLETED', {
        duration: saga.endTime - saga.startTime,
        stepsCompleted: saga.completedSteps.length
      });
      
      // Update performance stats
      this.performanceStats.sagasCompleted++;
      const duration = saga.endTime - saga.startTime;
      this.performanceStats.averageExecutionTime = 
        (this.performanceStats.averageExecutionTime * 0.9) + (duration * 0.1);
      
      // Clean up
      this.clearSagaTimeout(sagaId);
      this.activeSagas.delete(sagaId);
      this.parallelExecutionSemaphore.delete(sagaId);
      
      this.emit('saga_completed', {
        sagaId,
        type: saga.type,
        duration,
        steps: saga.completedSteps.length
      });
      
      console.log(`Saga completed successfully: ${sagaId}`);
      
      return {
        status: 'COMPLETED',
        duration,
        stepsCompleted: saga.completedSteps.length,
        message: 'All steps completed successfully'
      };
      
    } catch (error) {
      console.error(`Saga ${sagaId} execution failed:`, error);
      await this.compensateSaga(sagaId, error);
      throw error;
    }
  }

  async executeSequentialSteps(sagaId) {
    const saga = this.activeSagas.get(sagaId);
    const steps = saga.definition.steps;
    
    for (let i = 0; i < steps.length; i++) {
      saga.currentStep = i;
      const step = steps[i];
      
      try {
        await this.executeStep(sagaId, step, i);
        saga.completedSteps.push(i);
        
      } catch (error) {
        saga.failedSteps.push({ stepIndex: i, error: error.message });
        throw error;
      }
    }
  }

  async executeParallelGroups(sagaId) {
    const saga = this.activeSagas.get(sagaId);
    const steps = saga.definition.steps;
    const parallelGroups = saga.definition.parallelGroups;
    
    for (const group of parallelGroups) {
      const groupSteps = group.steps.map(stepName => {
        const stepIndex = steps.findIndex(s => s.name === stepName);
        return { step: steps[stepIndex], index: stepIndex };
      });
      
      if (group.parallel) {
        // Execute steps in parallel
        await this.executeStepsInParallel(sagaId, groupSteps);
      } else {
        // Execute steps sequentially within the group
        for (const { step, index } of groupSteps) {
          await this.executeStep(sagaId, step, index);
          saga.completedSteps.push(index);
        }
      }
    }
  }

  async executeStepsInParallel(sagaId, groupSteps) {
    const saga = this.activeSagas.get(sagaId);
    
    // Check parallel execution limit
    const currentParallel = this.parallelExecutionSemaphore.get(sagaId) || 0;
    if (currentParallel + groupSteps.length > this.config.maxParallelSteps) {
      throw new Error('Parallel execution limit exceeded');
    }
    
    // Update semaphore
    this.parallelExecutionSemaphore.set(sagaId, currentParallel + groupSteps.length);
    
    try {
      const promises = groupSteps.map(async ({ step, index }) => {
        try {
          const result = await this.executeStep(sagaId, step, index);
          saga.completedSteps.push(index);
          return { success: true, stepIndex: index, result };
        } catch (error) {
          saga.failedSteps.push({ stepIndex: index, error: error.message });
          return { success: false, stepIndex: index, error };
        }
      });
      
      const results = await Promise.all(promises);
      const failures = results.filter(r => !r.success);
      
      if (failures.length > 0) {
        throw new Error(`Parallel step execution failed: ${failures.map(f => f.error.message).join(', ')}`);
      }
      
    } finally {
      // Update semaphore
      this.parallelExecutionSemaphore.set(sagaId, currentParallel);
    }
  }

  async executeStep(sagaId, step, stepIndex) {
    const saga = this.activeSagas.get(sagaId);
    
    await this.logSaga(sagaId, 'STEP_STARTED', {
      stepIndex,
      stepName: step.name,
      action: step.action
    });
    
    // Get step executor
    const executor = this.stepExecutors.get(step.action);
    if (!executor) {
      throw new Error(`No executor found for action: ${step.action}`);
    }
    
    // Prepare step context
    const stepContext = {
      sagaId,
      stepIndex,
      stepName: step.name,
      sagaData: saga.data,
      stepParameters: step.parameters,
      previousResults: saga.stepResults
    };
    
    try {
      // Execute step with retry logic
      const result = await this.executeStepWithRetry(executor, stepContext, step);
      
      // Store result
      saga.stepResults.set(stepIndex, result);
      
      await this.logSaga(sagaId, 'STEP_COMPLETED', {
        stepIndex,
        stepName: step.name,
        result: this.sanitizeObject(result)
      });
      
      return result;
      
    } catch (error) {
      await this.logSaga(sagaId, 'STEP_FAILED', {
        stepIndex,
        stepName: step.name,
        error: error.message
      });
      
      throw error;
    }
  }

  async executeStepWithRetry(executor, stepContext, step) {
    let lastError;
    const maxRetries = step.retryable ? (step.retryPolicy?.maxRetries || this.config.maxRetries) : 0;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Set step timeout
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Step execution timeout')), step.timeout);
        });
        
        const executionPromise = executor(stepContext);
        const result = await Promise.race([executionPromise, timeoutPromise]);
        
        return result;
        
      } catch (error) {
        lastError = error;
        
        if (attempt < maxRetries) {
          const delay = this.config.retryBackoff * Math.pow(2, attempt);
          await new Promise(resolve => setTimeout(resolve, delay));
          console.log(`Retrying step ${stepContext.stepName} (attempt ${attempt + 1}/${maxRetries + 1})...`);
        }
      }
    }
    
    throw lastError;
  }

  // Compensate saga on failure
  async compensateSaga(sagaId, error) {
    const saga = this.activeSagas.get(sagaId);
    if (!saga) return;
    
    saga.state = 'COMPENSATING';
    
    await this.logSaga(sagaId, 'COMPENSATION_STARTED', {
      reason: error.message,
      stepsToCompensate: saga.completedSteps.length
    });
    
    try {
      // Compensate completed steps based on strategy
      if (this.config.compensationStrategy === 'reverse_order') {
        await this.compensateInReverseOrder(sagaId);
      } else if (this.config.compensationStrategy === 'parallel') {
        await this.compensateInParallel(sagaId);
      } else {
        await this.customCompensation(sagaId);
      }
      
      saga.state = 'COMPENSATED';
      saga.endTime = Date.now();
      
      await this.logSaga(sagaId, 'SAGA_COMPENSATED', {
        duration: saga.endTime - saga.startTime,
        stepsCompensated: saga.compensatedSteps.length
      });
      
      // Update performance stats
      this.performanceStats.sagasCompensated++;
      
      // Clean up
      this.clearSagaTimeout(sagaId);
      this.activeSagas.delete(sagaId);
      this.parallelExecutionSemaphore.delete(sagaId);
      
      this.emit('saga_compensated', {
        sagaId,
        type: saga.type,
        reason: error.message,
        stepsCompensated: saga.compensatedSteps.length
      });
      
      console.log(`Saga compensated: ${sagaId}`);
      
    } catch (compensationError) {
      saga.state = 'COMPENSATION_FAILED';
      
      await this.logSaga(sagaId, 'COMPENSATION_FAILED', {
        error: compensationError.message,
        originalError: error.message
      });
      
      this.emit('saga_compensation_failed', {
        sagaId,
        type: saga.type,
        compensationError: compensationError.message,
        originalError: error.message
      });
      
      console.error(`Saga compensation failed: ${sagaId}`, compensationError);
      throw compensationError;
    }
  }

  async compensateInReverseOrder(sagaId) {
    const saga = this.activeSagas.get(sagaId);
    const steps = saga.definition.steps;
    
    // Compensate in reverse order
    const completedSteps = [...saga.completedSteps].reverse();
    
    for (const stepIndex of completedSteps) {
      const step = steps[stepIndex];
      
      if (step.compensation) {
        try {
          await this.compensateStep(sagaId, step, stepIndex);
          saga.compensatedSteps.push(stepIndex);
          
        } catch (error) {
          console.error(`Failed to compensate step ${stepIndex}:`, error);
          // Continue with other compensations
        }
      }
    }
  }

  async compensateInParallel(sagaId) {
    const saga = this.activeSagas.get(sagaId);
    const steps = saga.definition.steps;
    
    const compensationPromises = saga.completedSteps.map(async (stepIndex) => {
      const step = steps[stepIndex];
      
      if (step.compensation) {
        try {
          await this.compensateStep(sagaId, step, stepIndex);
          saga.compensatedSteps.push(stepIndex);
          return { success: true, stepIndex };
        } catch (error) {
          console.error(`Failed to compensate step ${stepIndex}:`, error);
          return { success: false, stepIndex, error };
        }
      }
      
      return { success: true, stepIndex, skipped: true };
    });
    
    await Promise.all(compensationPromises);
  }

  async compensateStep(sagaId, step, stepIndex) {
    const saga = this.activeSagas.get(sagaId);
    
    await this.logSaga(sagaId, 'STEP_COMPENSATION_STARTED', {
      stepIndex,
      stepName: step.name,
      compensation: step.compensation
    });
    
    // Get compensation handler
    const handler = this.compensationHandlers.get(step.compensation);
    if (!handler) {
      throw new Error(`No compensation handler found for: ${step.compensation}`);
    }
    
    // Prepare compensation context
    const compensationContext = {
      sagaId,
      stepIndex,
      stepName: step.name,
      sagaData: saga.data,
      stepResult: saga.stepResults.get(stepIndex),
      originalParameters: step.parameters
    };
    
    try {
      // Execute compensation with timeout
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Compensation timeout')), this.config.compensationTimeout);
      });
      
      const compensationPromise = handler(compensationContext);
      const result = await Promise.race([compensationPromise, timeoutPromise]);
      
      await this.logSaga(sagaId, 'STEP_COMPENSATED', {
        stepIndex,
        stepName: step.name,
        result: this.sanitizeObject(result)
      });
      
      return result;
      
    } catch (error) {
      await this.logSaga(sagaId, 'STEP_COMPENSATION_FAILED', {
        stepIndex,
        stepName: step.name,
        error: error.message
      });
      
      throw error;
    }
  }

  async customCompensation(sagaId) {
    const saga = this.activeSagas.get(sagaId);
    
    // Implement custom compensation logic based on saga definition
    if (saga.definition.compensation.customHandler) {
      const handler = this.compensationHandlers.get(saga.definition.compensation.customHandler);
      if (handler) {
        await handler({
          sagaId,
          sagaData: saga.data,
          completedSteps: saga.completedSteps,
          stepResults: saga.stepResults
        });
      }
    } else {
      // Default to reverse order compensation
      await this.compensateInReverseOrder(sagaId);
    }
  }

  async handleSagaTimeout(sagaId) {
    const saga = this.activeSagas.get(sagaId);
    if (!saga) return;
    
    await this.logSaga(sagaId, 'SAGA_TIMEOUT', {});
    
    // Compensate saga due to timeout
    try {
      await this.compensateSaga(sagaId, new Error('Saga execution timeout'));
    } catch (error) {
      console.error(`Failed to compensate timed out saga ${sagaId}:`, error);
    }
  }

  async handleSagaFailure(sagaId, error) {
    const saga = this.activeSagas.get(sagaId);
    if (!saga) return;
    
    saga.state = 'FAILED';
    
    // Update performance stats
    this.performanceStats.sagasFailed++;
    
    await this.logSaga(sagaId, 'SAGA_FAILED', {
      error: error.message,
      failedStep: saga.currentStep,
      completedSteps: saga.completedSteps.length
    });
  }

  async logSaga(sagaId, event, data) {
    const logEntry = {
      sagaId,
      event,
      data,
      timestamp: Date.now()
    };
    
    try {
      // Store in memory log
      const sagaLog = this.sagaLog.get(sagaId) || [];
      sagaLog.push(logEntry);
      this.sagaLog.set(sagaId, sagaLog);
      
      // Persist to Redis for durability
      if (this.redis) {
        const key = `${this.config.keyPrefix}log:${sagaId}`;
        await this.redis.lpush(key, JSON.stringify(logEntry));
        await this.redis.expire(key, 86400); // Expire after 24 hours
      }
      
    } catch (error) {
      console.error('Failed to log saga event:', error);
    }
  }

  async loadSagaDefinitions() {
    // Load saga definitions from Redis or configuration
    console.log('Loading saga definitions...');
    // Implementation depends on specific requirements
  }

  async recoverPendingSagas() {
    console.log('🔄 Recovering pending sagas...');
    
    try {
      // Scan for saga logs in Redis
      const keys = await this.redis.keys(`${this.config.keyPrefix}log:*`);
      let recoveredCount = 0;
      
      for (const key of keys) {
        try {
          const sagaId = key.split(':').pop();
          const logs = await this.redis.lrange(key, 0, -1);
          
          if (logs.length > 0) {
            const lastLog = JSON.parse(logs[0]); // Most recent log entry
            
            // Check if saga needs recovery
            if (this.needsRecovery(lastLog)) {
              await this.recoverSaga(sagaId, logs);
              recoveredCount++;
            }
          }
        } catch (error) {
          console.error(`Failed to recover saga from key ${key}:`, error);
        }
      }
      
      console.log(`✅ Recovered ${recoveredCount} pending sagas`);
      
    } catch (error) {
      console.error('Failed to recover pending sagas:', error);
    }
  }

  needsRecovery(lastLog) {
    const recoverableStates = [
      'SAGA_STARTED',
      'EXECUTING',
      'STEP_STARTED',
      'COMPENSATING'
    ];
    
    return recoverableStates.includes(lastLog.event);
  }

  async recoverSaga(sagaId, logs) {
    console.log(`Recovering saga: ${sagaId}`);
    
    try {
      // Parse saga state from logs
      const parsedLogs = logs.map(log => JSON.parse(log)).reverse();
      const startLog = parsedLogs.find(log => log.event === 'SAGA_STARTED');
      
      if (!startLog) {
        console.warn(`No start log found for saga ${sagaId}, skipping recovery`);
        return;
      }
      
      // Determine recovery action based on last state
      const lastLog = parsedLogs[parsedLogs.length - 1];
      
      if (lastLog.event === 'EXECUTING' || lastLog.event === 'STEP_STARTED') {
        // Continue execution from where it left off
        await this.continueExecution(sagaId, parsedLogs);
      } else if (lastLog.event === 'COMPENSATING') {
        // Continue compensation
        await this.continueCompensation(sagaId, parsedLogs);
      } else {
        // Force compensation for unclear states
        await this.forceCompensation(sagaId, parsedLogs);
      }
      
    } catch (error) {
      console.error(`Failed to recover saga ${sagaId}:`, error);
    }
  }

  async continueExecution(sagaId, logs) {
    // Implementation for continuing saga execution
    await this.logSaga(sagaId, 'RECOVERY_CONTINUE_EXECUTION', {});
  }

  async continueCompensation(sagaId, logs) {
    // Implementation for continuing compensation
    await this.logSaga(sagaId, 'RECOVERY_CONTINUE_COMPENSATION', {});
  }

  async forceCompensation(sagaId, logs) {
    // Implementation for forcing compensation
    await this.logSaga(sagaId, 'RECOVERY_FORCE_COMPENSATION', {});
  }

  async performRecoveryCheck() {
    // Check for stale sagas
    const now = Date.now();
    const staleThreshold = 600000; // 10 minutes
    
    for (const [sagaId, saga] of this.activeSagas) {
      if (now - saga.startTime > staleThreshold) {
        console.warn(`Stale saga detected: ${sagaId}`);
        await this.handleStaleSaga(sagaId);
      }
    }
  }

  async handleStaleSaga(sagaId) {
    try {
      await this.compensateSaga(sagaId, new Error('Stale saga cleanup'));
    } catch (error) {
      console.error(`Failed to handle stale saga ${sagaId}:`, error);
    }
  }

  async updatePerformanceMetrics() {
    try {
      // Calculate success rate
      const total = this.performanceStats.sagasCompleted + this.performanceStats.sagasFailed;
      this.performanceStats.successRate = total > 0 ? 
        this.performanceStats.sagasCompleted / total : 0;
      
      // Calculate compensation rate
      this.performanceStats.compensationRate = total > 0 ? 
        this.performanceStats.sagasCompensated / total : 0;
      
      // Update metrics
      await this.metrics.setGauge('saga.active_sagas', this.activeSagas.size, {}, 'consistency');
      await this.metrics.setGauge('saga.sagas_completed', this.performanceStats.sagasCompleted, {}, 'consistency');
      await this.metrics.setGauge('saga.sagas_failed', this.performanceStats.sagasFailed, {}, 'consistency');
      await this.metrics.setGauge('saga.sagas_compensated', this.performanceStats.sagasCompensated, {}, 'consistency');
      await this.metrics.setGauge('saga.success_rate', this.performanceStats.successRate, {}, 'consistency');
      await this.metrics.setGauge('saga.compensation_rate', this.performanceStats.compensationRate, {}, 'consistency');
      await this.metrics.setGauge('saga.average_execution_time', this.performanceStats.averageExecutionTime, {}, 'consistency');
      
    } catch (error) {
      console.error('Failed to update performance metrics:', error);
    }
  }

  getSagaStatus(sagaId) {
    const saga = this.activeSagas.get(sagaId);
    if (!saga) {
      return { error: 'Saga not found' };
    }
    
    return {
      id: saga.id,
      type: saga.type,
      state: saga.state,
      currentStep: saga.currentStep,
      completedSteps: saga.completedSteps.length,
      totalSteps: saga.definition.steps.length,
      startTime: saga.startTime,
      duration: saga.endTime ? saga.endTime - saga.startTime : Date.now() - saga.startTime,
      retryCount: saga.retryCount
    };
  }

  getSystemStatus() {
    return {
      isRunning: this.isRunning,
      activeSagas: this.activeSagas.size,
      sagaDefinitions: this.sagaDefinitions.size,
      stepExecutors: this.stepExecutors.size,
      compensationHandlers: this.compensationHandlers.size,
      performanceStats: this.performanceStats,
      recoveryEnabled: this.recoveryEnabled
    };
  }

  stop() {
    if (!this.isRunning) return;
    
    console.log('🛑 Stopping Saga Orchestrator...');
    
    // Stop intervals
    if (this.recoveryInterval) clearInterval(this.recoveryInterval);
    if (this.performanceInterval) clearInterval(this.performanceInterval);
    
    // Clear all timeouts
    for (const timeout of this.timeouts.values()) {
      clearTimeout(timeout);
    }
    this.timeouts.clear();
    
    // Compensate all active sagas
    for (const sagaId of this.activeSagas.keys()) {
      try {
        this.compensateSaga(sagaId, new Error('System shutdown')).catch(console.error);
      } catch (error) {
        console.error(`Failed to compensate saga ${sagaId} during shutdown:`, error);
      }
    }
    
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
    this.parallelExecutionSemaphore.clear();
    
    this.isRunning = false;
    console.log('✅ Saga Orchestrator stopped');
  }
}

module.exports = SagaOrchestrator;