const EventEmitter = require('events');
const { getSecureMetricsCollector } = require('../monitoring/secure-metrics-collector');

class CircuitBreakerManager extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      // Circuit breaker thresholds
      failureThreshold: config.failureThreshold || 10,
      volumeThreshold: config.volumeThreshold || 1000000, // $1M in 1 minute
      latencyThreshold: config.latencyThreshold || 5000, // 5 seconds
      errorRateThreshold: config.errorRateThreshold || 0.1, // 10%
      
      // Time windows
      timeWindow: config.timeWindow || 60000, // 1 minute
      halfOpenWindow: config.halfOpenWindow || 30000, // 30 seconds
      resetWindow: config.resetWindow || 300000, // 5 minutes
      
      // Recovery settings
      successThreshold: config.successThreshold || 5, // Success count to close
      maxTestRequests: config.maxTestRequests || 3, // Max requests in half-open
      
      // System-wide circuit breakers
      systemBreakers: config.systemBreakers || {
        trading: { enabled: true, priority: 'critical' },
        withdrawal: { enabled: true, priority: 'high' },
        deposit: { enabled: true, priority: 'medium' },
        api: { enabled: true, priority: 'medium' }
      },
      
      // Auto-recovery settings
      autoRecovery: config.autoRecovery !== false,
      recoveryTimeout: config.recoveryTimeout || 600000, // 10 minutes
      
      // Emergency settings
      emergencyMode: config.emergencyMode || false,
      emergencyThreshold: config.emergencyThreshold || 0.5, // 50% error rate
      
      // Redis configuration
      redisUrl: config.redisUrl || process.env.REDIS_URL,
      keyPrefix: config.keyPrefix || 'risk:circuit:',
      
      ...config
    };
    
    this.metrics = getSecureMetricsCollector();
    this.redis = null;
    this.isRunning = false;
    
    // Circuit breaker states
    this.circuitBreakers = new Map(); // breakerId -> state
    this.systemState = 'normal'; // normal, degraded, emergency
    
    // Monitoring data
    this.requestCounts = new Map(); // breakerId -> counts
    this.errorCounts = new Map(); // breakerId -> errors
    this.latencyData = new Map(); // breakerId -> latency stats
    this.volumeData = new Map(); // breakerId -> volume stats
    
    // State management
    this.stateHistory = new Map(); // breakerId -> state changes
    this.testRequests = new Map(); // breakerId -> test request count
    this.lastStateChange = new Map(); // breakerId -> timestamp
    
    // Emergency mode
    this.emergencyStartTime = null;
    this.emergencyTriggers = [];
    
    // Performance tracking
    this.performanceStats = {
      tripsPerHour: 0,
      averageRecoveryTime: 0,
      falsePositiveRate: 0,
      systemAvailability: 1.0
    };
  }

  async initialize() {
    try {
      // Initialize Redis connection
      const Redis = require('redis');
      this.redis = Redis.createClient({ url: this.config.redisUrl });
      await this.redis.connect();
      
      // Load existing circuit breaker states
      await this.loadCircuitBreakerStates();
      
      // Initialize system circuit breakers
      await this.initializeSystemBreakers();
      
      console.log('✅ Circuit breaker manager initialized');
      
    } catch (error) {
      console.error('Failed to initialize circuit breaker manager:', error);
      throw error;
    }
  }

  async start() {
    if (this.isRunning) return;
    
    console.log('⚡ Starting circuit breaker manager...');
    this.isRunning = true;
    
    // Start monitoring
    this.startMonitoring();
    
    // Start auto-recovery
    if (this.config.autoRecovery) {
      this.startAutoRecovery();
    }
    
    // Start performance tracking
    this.startPerformanceTracking();
    
    console.log('✅ Circuit breaker manager started');
  }

  startMonitoring() {
    this.monitoringInterval = setInterval(async () => {
      try {
        await this.evaluateAllCircuitBreakers();
        await this.checkSystemHealth();
        await this.cleanupOldData();
      } catch (error) {
        console.error('Circuit breaker monitoring error:', error);
        await this.metrics.incrementCounter('circuit_breaker.monitoring_errors', 1, {}, 'risk');
      }
    }, 10000); // Every 10 seconds
  }

  startAutoRecovery() {
    this.recoveryInterval = setInterval(async () => {
      try {
        await this.attemptAutoRecovery();
      } catch (error) {
        console.error('Auto-recovery error:', error);
      }
    }, 30000); // Every 30 seconds
  }

  startPerformanceTracking() {
    this.performanceInterval = setInterval(async () => {
      await this.updatePerformanceMetrics();
    }, 60000); // Every minute
  }

  async initializeSystemBreakers() {
    for (const [breakerId, config] of Object.entries(this.config.systemBreakers)) {
      if (config.enabled) {
        await this.createCircuitBreaker(breakerId, {
          type: 'system',
          priority: config.priority,
          ...config
        });
      }
    }
  }

  async createCircuitBreaker(breakerId, config = {}) {
    const breaker = {
      id: breakerId,
      state: 'closed', // closed, open, half-open
      type: config.type || 'custom',
      priority: config.priority || 'medium',
      
      // Thresholds
      failureThreshold: config.failureThreshold || this.config.failureThreshold,
      volumeThreshold: config.volumeThreshold || this.config.volumeThreshold,
      latencyThreshold: config.latencyThreshold || this.config.latencyThreshold,
      errorRateThreshold: config.errorRateThreshold || this.config.errorRateThreshold,
      
      // Counters
      requestCount: 0,
      errorCount: 0,
      successCount: 0,
      
      // Timing
      lastFailureTime: null,
      lastSuccessTime: null,
      stateChangeTime: Date.now(),
      nextAttemptTime: null,
      
      // Statistics
      totalRequests: 0,
      totalErrors: 0,
      averageLatency: 0,
      
      // Configuration
      timeWindow: config.timeWindow || this.config.timeWindow,
      resetWindow: config.resetWindow || this.config.resetWindow,
      
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    
    this.circuitBreakers.set(breakerId, breaker);
    
    // Initialize monitoring data
    this.requestCounts.set(breakerId, []);
    this.errorCounts.set(breakerId, []);
    this.latencyData.set(breakerId, []);
    this.volumeData.set(breakerId, []);
    this.stateHistory.set(breakerId, []);
    this.testRequests.set(breakerId, 0);
    
    // Save to Redis
    await this.saveCircuitBreakerState(breakerId);
    
    this.emit('circuit_breaker_created', { breakerId, config: breaker });
    
    console.log(`Circuit breaker created: ${breakerId} (${breaker.type})`);
    
    return breaker;
  }

  async recordRequest(breakerId, result) {
    const breaker = this.circuitBreakers.get(breakerId);
    if (!breaker) {
      throw new Error(`Circuit breaker not found: ${breakerId}`);
    }
    
    const now = Date.now();
    
    // Record request
    breaker.requestCount++;
    breaker.totalRequests++;
    breaker.updatedAt = now;
    
    // Record result
    if (result.success) {
      breaker.successCount++;
      breaker.lastSuccessTime = now;
      
      // Record latency
      if (result.latency) {
        this.recordLatency(breakerId, result.latency);
        
        // Update average latency
        const alpha = 0.1;
        breaker.averageLatency = 
          (1 - alpha) * breaker.averageLatency + alpha * result.latency;
      }
      
      // Record volume
      if (result.volume) {
        this.recordVolume(breakerId, result.volume);
      }
      
    } else {
      breaker.errorCount++;
      breaker.totalErrors++;
      breaker.lastFailureTime = now;
      
      // Record error details
      this.recordError(breakerId, result.error || 'unknown');
    }
    
    // Evaluate circuit breaker state
    await this.evaluateCircuitBreaker(breakerId);
    
    // Update metrics
    await this.updateCircuitBreakerMetrics(breakerId);
    
    // Save state
    await this.saveCircuitBreakerState(breakerId);
  }

  recordLatency(breakerId, latency) {
    const latencyArray = this.latencyData.get(breakerId);
    latencyArray.push({ timestamp: Date.now(), latency });
    
    // Keep only recent data
    const cutoff = Date.now() - this.config.timeWindow;
    this.latencyData.set(breakerId, 
      latencyArray.filter(l => l.timestamp > cutoff).slice(-1000));
  }

  recordVolume(breakerId, volume) {
    const volumeArray = this.volumeData.get(breakerId);
    volumeArray.push({ timestamp: Date.now(), volume });
    
    // Keep only recent data
    const cutoff = Date.now() - this.config.timeWindow;
    this.volumeData.set(breakerId, 
      volumeArray.filter(v => v.timestamp > cutoff));
  }

  recordError(breakerId, error) {
    const errorArray = this.errorCounts.get(breakerId);
    errorArray.push({ timestamp: Date.now(), error });
    
    // Keep only recent data
    const cutoff = Date.now() - this.config.timeWindow;
    this.errorCounts.set(breakerId, 
      errorArray.filter(e => e.timestamp > cutoff));
  }

  async evaluateCircuitBreaker(breakerId) {
    const breaker = this.circuitBreakers.get(breakerId);
    if (!breaker) return;
    
    const now = Date.now();
    const oldState = breaker.state;
    
    switch (breaker.state) {
      case 'closed':
        if (this.shouldTripCircuitBreaker(breakerId)) {
          await this.tripCircuitBreaker(breakerId);
        }
        break;
        
      case 'open':
        if (this.shouldAttemptReset(breakerId)) {
          await this.transitionToHalfOpen(breakerId);
        }
        break;
        
      case 'half-open':
        if (this.shouldCloseCircuitBreaker(breakerId)) {
          await this.closeCircuitBreaker(breakerId);
        } else if (this.shouldReopenCircuitBreaker(breakerId)) {
          await this.tripCircuitBreaker(breakerId);
        }
        break;
    }
    
    // Record state change
    if (breaker.state !== oldState) {
      this.recordStateChange(breakerId, oldState, breaker.state);
    }
  }

  shouldTripCircuitBreaker(breakerId) {
    const breaker = this.circuitBreakers.get(breakerId);
    const now = Date.now();
    const windowStart = now - breaker.timeWindow;
    
    // Check failure count threshold
    const recentErrors = this.errorCounts.get(breakerId)
      .filter(e => e.timestamp > windowStart);
    
    if (recentErrors.length >= breaker.failureThreshold) {
      return true;
    }
    
    // Check error rate threshold
    const recentRequests = Math.max(breaker.requestCount, 1);
    const errorRate = recentErrors.length / recentRequests;
    
    if (errorRate >= breaker.errorRateThreshold && recentRequests >= 10) {
      return true;
    }
    
    // Check latency threshold
    const recentLatencies = this.latencyData.get(breakerId)
      .filter(l => l.timestamp > windowStart);
    
    if (recentLatencies.length > 0) {
      const avgLatency = recentLatencies.reduce((sum, l) => sum + l.latency, 0) 
        / recentLatencies.length;
      
      if (avgLatency > breaker.latencyThreshold) {
        return true;
      }
    }
    
    // Check volume threshold
    const recentVolumes = this.volumeData.get(breakerId)
      .filter(v => v.timestamp > windowStart);
    
    if (recentVolumes.length > 0) {
      const totalVolume = recentVolumes.reduce((sum, v) => sum + v.volume, 0);
      
      if (totalVolume > breaker.volumeThreshold) {
        return true;
      }
    }
    
    return false;
  }

  shouldAttemptReset(breakerId) {
    const breaker = this.circuitBreakers.get(breakerId);
    const now = Date.now();
    
    return now - breaker.stateChangeTime >= breaker.resetWindow;
  }

  shouldCloseCircuitBreaker(breakerId) {
    const breaker = this.circuitBreakers.get(breakerId);
    const testCount = this.testRequests.get(breakerId);
    
    return breaker.successCount >= this.config.successThreshold && 
           testCount >= this.config.maxTestRequests;
  }

  shouldReopenCircuitBreaker(breakerId) {
    const breaker = this.circuitBreakers.get(breakerId);
    const testCount = this.testRequests.get(breakerId);
    
    return breaker.errorCount > 0 || testCount >= this.config.maxTestRequests;
  }

  async tripCircuitBreaker(breakerId) {
    const breaker = this.circuitBreakers.get(breakerId);
    breaker.state = 'open';
    breaker.stateChangeTime = Date.now();
    breaker.nextAttemptTime = Date.now() + breaker.resetWindow;
    
    // Reset counters
    breaker.requestCount = 0;
    breaker.errorCount = 0;
    breaker.successCount = 0;
    this.testRequests.set(breakerId, 0);
    
    this.emit('circuit_breaker_opened', {
      breakerId,
      timestamp: Date.now(),
      reason: 'threshold_exceeded'
    });
    
    await this.metrics.incrementCounter('circuit_breaker.trips', 1, {
      breakerId: breakerId,
      priority: breaker.priority
    }, 'risk');
    
    console.warn(`Circuit breaker opened: ${breakerId}`);
    
    // Check if this triggers emergency mode
    await this.checkEmergencyMode();
  }

  async transitionToHalfOpen(breakerId) {
    const breaker = this.circuitBreakers.get(breakerId);
    breaker.state = 'half-open';
    breaker.stateChangeTime = Date.now();
    
    // Reset counters for testing
    breaker.requestCount = 0;
    breaker.errorCount = 0;
    breaker.successCount = 0;
    this.testRequests.set(breakerId, 0);
    
    this.emit('circuit_breaker_half_open', {
      breakerId,
      timestamp: Date.now()
    });
    
    console.log(`Circuit breaker half-open: ${breakerId}`);
  }

  async closeCircuitBreaker(breakerId) {
    const breaker = this.circuitBreakers.get(breakerId);
    breaker.state = 'closed';
    breaker.stateChangeTime = Date.now();
    breaker.nextAttemptTime = null;
    
    // Reset counters
    breaker.requestCount = 0;
    breaker.errorCount = 0;
    breaker.successCount = 0;
    this.testRequests.set(breakerId, 0);
    
    this.emit('circuit_breaker_closed', {
      breakerId,
      timestamp: Date.now(),
      reason: 'recovery_successful'
    });
    
    await this.metrics.incrementCounter('circuit_breaker.recoveries', 1, {
      breakerId: breakerId
    }, 'risk');
    
    console.log(`Circuit breaker closed: ${breakerId}`);
    
    // Check if we can exit emergency mode
    await this.checkEmergencyModeExit();
  }

  async checkEmergencyMode() {
    if (this.config.emergencyMode || this.systemState === 'emergency') {
      return;
    }
    
    const criticalBreakers = Array.from(this.circuitBreakers.values())
      .filter(b => b.priority === 'critical' && b.state === 'open');
    
    const totalBreakers = Array.from(this.circuitBreakers.values()).length;
    const openBreakers = Array.from(this.circuitBreakers.values())
      .filter(b => b.state === 'open').length;
    
    const openRatio = openBreakers / totalBreakers;
    
    // Trigger emergency mode if:
    // 1. Any critical breaker is open, OR
    // 2. More than emergency threshold of breakers are open
    if (criticalBreakers.length > 0 || openRatio >= this.config.emergencyThreshold) {
      await this.enterEmergencyMode({
        criticalBreakers: criticalBreakers.length,
        openRatio,
        trigger: criticalBreakers.length > 0 ? 'critical_system_down' : 'cascade_failure'
      });
    }
  }

  async enterEmergencyMode(trigger) {
    this.systemState = 'emergency';
    this.emergencyStartTime = Date.now();
    this.emergencyTriggers.push({
      ...trigger,
      timestamp: Date.now()
    });
    
    this.emit('emergency_mode_activated', {
      trigger,
      timestamp: Date.now(),
      systemState: this.systemState
    });
    
    await this.metrics.incrementCounter('circuit_breaker.emergency_mode', 1, {
      trigger: trigger.trigger
    }, 'risk');
    
    console.error('🚨 EMERGENCY MODE ACTIVATED', trigger);
  }

  async checkEmergencyModeExit() {
    if (this.systemState !== 'emergency') return;
    
    const criticalBreakers = Array.from(this.circuitBreakers.values())
      .filter(b => b.priority === 'critical' && b.state === 'open');
    
    const openBreakers = Array.from(this.circuitBreakers.values())
      .filter(b => b.state === 'open').length;
    
    // Exit emergency mode if no critical breakers are open and
    // less than half of all breakers are open
    if (criticalBreakers.length === 0 && openBreakers < this.circuitBreakers.size / 2) {
      await this.exitEmergencyMode();
    }
  }

  async exitEmergencyMode() {
    const emergencyDuration = Date.now() - this.emergencyStartTime;
    
    this.systemState = 'normal';
    this.emergencyStartTime = null;
    
    this.emit('emergency_mode_deactivated', {
      duration: emergencyDuration,
      timestamp: Date.now(),
      systemState: this.systemState
    });
    
    await this.metrics.incrementCounter('circuit_breaker.emergency_mode_exit', 1, {
      duration: emergencyDuration
    }, 'risk');
    
    console.log('✅ Emergency mode deactivated', { duration: emergencyDuration });
  }

  async canExecuteRequest(breakerId) {
    const breaker = this.circuitBreakers.get(breakerId);
    if (!breaker) {
      return { allowed: true, reason: 'no_breaker' };
    }
    
    switch (breaker.state) {
      case 'closed':
        return { allowed: true, state: 'closed' };
        
      case 'open':
        return { 
          allowed: false, 
          state: 'open',
          reason: 'circuit_breaker_open',
          nextAttempt: breaker.nextAttemptTime
        };
        
      case 'half-open':
        const testCount = this.testRequests.get(breakerId);
        if (testCount < this.config.maxTestRequests) {
          this.testRequests.set(breakerId, testCount + 1);
          return { 
            allowed: true, 
            state: 'half-open',
            testRequest: true 
          };
        } else {
          return { 
            allowed: false, 
            state: 'half-open',
            reason: 'test_limit_reached'
          };
        }
        
      default:
        return { allowed: false, reason: 'invalid_state' };
    }
  }

  async forceOpenCircuitBreaker(breakerId, reason = 'manual') {
    const breaker = this.circuitBreakers.get(breakerId);
    if (!breaker) {
      throw new Error(`Circuit breaker not found: ${breakerId}`);
    }
    
    await this.tripCircuitBreaker(breakerId);
    
    this.emit('circuit_breaker_forced_open', {
      breakerId,
      reason,
      timestamp: Date.now()
    });
    
    console.warn(`Circuit breaker force opened: ${breakerId}, reason: ${reason}`);
  }

  async forceCloseCircuitBreaker(breakerId, reason = 'manual') {
    const breaker = this.circuitBreakers.get(breakerId);
    if (!breaker) {
      throw new Error(`Circuit breaker not found: ${breakerId}`);
    }
    
    await this.closeCircuitBreaker(breakerId);
    
    this.emit('circuit_breaker_forced_closed', {
      breakerId,
      reason,
      timestamp: Date.now()
    });
    
    console.log(`Circuit breaker force closed: ${breakerId}, reason: ${reason}`);
  }

  recordStateChange(breakerId, oldState, newState) {
    const stateHistory = this.stateHistory.get(breakerId);
    stateHistory.push({
      from: oldState,
      to: newState,
      timestamp: Date.now()
    });
    
    // Keep only recent history
    if (stateHistory.length > 100) {
      stateHistory.shift();
    }
  }

  async evaluateAllCircuitBreakers() {
    for (const breakerId of this.circuitBreakers.keys()) {
      await this.evaluateCircuitBreaker(breakerId);
    }
  }

  async checkSystemHealth() {
    const openBreakers = Array.from(this.circuitBreakers.values())
      .filter(b => b.state === 'open').length;
    
    const totalBreakers = this.circuitBreakers.size;
    const availability = totalBreakers > 0 ? 
      (totalBreakers - openBreakers) / totalBreakers : 1.0;
    
    this.performanceStats.systemAvailability = availability;
    
    // Determine system state
    if (this.systemState !== 'emergency') {
      if (availability < 0.7) {
        this.systemState = 'degraded';
      } else {
        this.systemState = 'normal';
      }
    }
  }

  async attemptAutoRecovery() {
    if (!this.config.autoRecovery) return;
    
    const now = Date.now();
    
    for (const [breakerId, breaker] of this.circuitBreakers) {
      if (breaker.state === 'open' && 
          now - breaker.stateChangeTime >= this.config.recoveryTimeout) {
        
        console.log(`Attempting auto-recovery for circuit breaker: ${breakerId}`);
        await this.transitionToHalfOpen(breakerId);
      }
    }
  }

  async cleanupOldData() {
    const cutoff = Date.now() - this.config.timeWindow * 2;
    
    for (const breakerId of this.circuitBreakers.keys()) {
      // Clean latency data
      const latencyArray = this.latencyData.get(breakerId);
      this.latencyData.set(breakerId, 
        latencyArray.filter(l => l.timestamp > cutoff));
      
      // Clean error data
      const errorArray = this.errorCounts.get(breakerId);
      this.errorCounts.set(breakerId, 
        errorArray.filter(e => e.timestamp > cutoff));
      
      // Clean volume data
      const volumeArray = this.volumeData.get(breakerId);
      this.volumeData.set(breakerId, 
        volumeArray.filter(v => v.timestamp > cutoff));
    }
  }

  async updateCircuitBreakerMetrics(breakerId) {
    const breaker = this.circuitBreakers.get(breakerId);
    
    await this.metrics.setGauge('circuit_breaker.state', 
      breaker.state === 'closed' ? 0 : breaker.state === 'half-open' ? 1 : 2, 
      { breakerId }, 'risk');
    
    await this.metrics.setGauge('circuit_breaker.error_count', 
      breaker.errorCount, { breakerId }, 'risk');
    
    await this.metrics.setGauge('circuit_breaker.request_count', 
      breaker.requestCount, { breakerId }, 'risk');
    
    await this.metrics.setGauge('circuit_breaker.average_latency', 
      breaker.averageLatency, { breakerId }, 'risk');
  }

  async updatePerformanceMetrics() {
    await this.metrics.setGauge('circuit_breaker.system_availability', 
      this.performanceStats.systemAvailability, {}, 'risk');
    
    await this.metrics.setGauge('circuit_breaker.trips_per_hour', 
      this.performanceStats.tripsPerHour, {}, 'risk');
    
    await this.metrics.setGauge('circuit_breaker.emergency_mode', 
      this.systemState === 'emergency' ? 1 : 0, {}, 'risk');
    
    // Count breakers by state
    const states = { closed: 0, open: 0, 'half-open': 0 };
    for (const breaker of this.circuitBreakers.values()) {
      states[breaker.state]++;
    }
    
    for (const [state, count] of Object.entries(states)) {
      await this.metrics.setGauge('circuit_breaker.count_by_state', 
        count, { state }, 'risk');
    }
  }

  async saveCircuitBreakerState(breakerId) {
    const breaker = this.circuitBreakers.get(breakerId);
    await this.redis.hSet(
      `${this.config.keyPrefix}states`,
      breakerId,
      JSON.stringify(breaker)
    );
  }

  async loadCircuitBreakerStates() {
    try {
      const states = await this.redis.hGetAll(`${this.config.keyPrefix}states`);
      for (const [breakerId, data] of Object.entries(states)) {
        const breaker = JSON.parse(data);
        this.circuitBreakers.set(breakerId, breaker);
        
        // Initialize monitoring data
        this.requestCounts.set(breakerId, []);
        this.errorCounts.set(breakerId, []);
        this.latencyData.set(breakerId, []);
        this.volumeData.set(breakerId, []);
        this.stateHistory.set(breakerId, []);
        this.testRequests.set(breakerId, 0);
      }
      console.log(`Loaded ${this.circuitBreakers.size} circuit breaker states`);
    } catch (error) {
      console.error('Failed to load circuit breaker states:', error);
    }
  }

  getCircuitBreakerStatus() {
    const status = {
      systemState: this.systemState,
      emergencyMode: this.systemState === 'emergency',
      emergencyDuration: this.emergencyStartTime ? 
        Date.now() - this.emergencyStartTime : null,
      
      breakers: {},
      summary: {
        total: this.circuitBreakers.size,
        closed: 0,
        open: 0,
        halfOpen: 0
      },
      
      performance: this.performanceStats
    };
    
    for (const [breakerId, breaker] of this.circuitBreakers) {
      status.breakers[breakerId] = {
        state: breaker.state,
        priority: breaker.priority,
        errorCount: breaker.errorCount,
        requestCount: breaker.requestCount,
        averageLatency: breaker.averageLatency,
        stateChangeTime: breaker.stateChangeTime,
        nextAttemptTime: breaker.nextAttemptTime
      };
      
      status.summary[breaker.state.replace('-', '')]++;
    }
    
    return status;
  }

  stop() {
    if (!this.isRunning) return;
    
    console.log('🛑 Stopping circuit breaker manager...');
    
    // Stop intervals
    if (this.monitoringInterval) clearInterval(this.monitoringInterval);
    if (this.recoveryInterval) clearInterval(this.recoveryInterval);
    if (this.performanceInterval) clearInterval(this.performanceInterval);
    
    // Close Redis connection
    if (this.redis) {
      this.redis.quit();
    }
    
    // Clear data
    this.circuitBreakers.clear();
    this.requestCounts.clear();
    this.errorCounts.clear();
    this.latencyData.clear();
    this.volumeData.clear();
    this.stateHistory.clear();
    this.testRequests.clear();
    this.lastStateChange.clear();
    
    this.isRunning = false;
    console.log('✅ Circuit breaker manager stopped');
  }
}

module.exports = CircuitBreakerManager;