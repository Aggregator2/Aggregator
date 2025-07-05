import { EventEmitter } from 'events';

export interface CircuitBreakerConfig {
  failureThreshold: number; // Number of failures before opening
  successThreshold: number; // Number of successes before closing
  timeout: number; // Time in ms before attempting to close
  volumeThreshold: number; // Minimum requests for statistical significance
  monitoringWindow: number; // Time window for failure rate calculation
}

export interface ProviderHealth {
  provider: string;
  state: 'closed' | 'open' | 'half-open';
  failures: number;
  successes: number;
  lastFailure?: Date;
  lastSuccess?: Date;
  lastStateChange: Date;
  errorRate: number;
  averageLatency: number;
  availability: number; // Percentage
}

export interface FallbackStrategy {
  type: 'internal-only' | 'alternative-provider' | 'cached-quote' | 'reject';
  alternativeProviders?: string[];
  cacheTimeout?: number;
}

export class ExternalLiquidityCircuitBreaker extends EventEmitter {
  private providerStates: Map<string, {
    state: 'closed' | 'open' | 'half-open';
    failures: number;
    successes: number;
    lastFailure?: Date;
    lastSuccess?: Date;
    lastStateChange: Date;
    requests: Array<{ timestamp: number; success: boolean; latency: number }>;
  }> = new Map();

  private config: CircuitBreakerConfig;
  private fallbackStrategies: Map<string, FallbackStrategy> = new Map();
  private quotesCache: Map<string, { quote: any; timestamp: number }> = new Map();
  private healthCheckInterval?: NodeJS.Timer;

  constructor(config: CircuitBreakerConfig) {
    super();
    this.config = config;
    this.startHealthChecking();
  }

  registerProvider(provider: string, fallbackStrategy: FallbackStrategy): void {
    this.providerStates.set(provider, {
      state: 'closed',
      failures: 0,
      successes: 0,
      lastStateChange: new Date(),
      requests: []
    });
    this.fallbackStrategies.set(provider, fallbackStrategy);
    
    this.emit('provider:registered', { provider, strategy: fallbackStrategy });
  }

  async executeWithCircuitBreaker<T>(
    provider: string,
    operation: () => Promise<T>,
    context?: { pair?: string; quantity?: number }
  ): Promise<T> {
    const state = this.providerStates.get(provider);
    if (!state) {
      throw new Error(`Provider ${provider} not registered`);
    }

    // Check circuit breaker state
    if (state.state === 'open') {
      // Check if timeout has passed
      const timeSinceLastFailure = Date.now() - (state.lastFailure?.getTime() || 0);
      
      if (timeSinceLastFailure >= this.config.timeout) {
        // Try half-open state
        this.transitionState(provider, 'half-open');
      } else {
        // Circuit is open, use fallback
        return this.executeFallback(provider, context);
      }
    }

    // Execute operation
    const startTime = Date.now();
    
    try {
      const result = await operation();
      const latency = Date.now() - startTime;
      
      this.recordSuccess(provider, latency);
      
      // Cache successful quotes
      if (context?.pair && result) {
        this.cacheQuote(provider, context.pair, result);
      }
      
      return result;
    } catch (error) {
      const latency = Date.now() - startTime;
      this.recordFailure(provider, latency, error);
      
      // Check if we should open the circuit
      if (this.shouldOpenCircuit(provider)) {
        this.transitionState(provider, 'open');
      }
      
      // Execute fallback
      return this.executeFallback(provider, context);
    }
  }

  private recordSuccess(provider: string, latency: number): void {
    const state = this.providerStates.get(provider)!;
    
    state.successes++;
    state.lastSuccess = new Date();
    state.requests.push({
      timestamp: Date.now(),
      success: true,
      latency
    });
    
    // Clean old requests
    this.cleanOldRequests(state);
    
    // Check if we should close the circuit
    if (state.state === 'half-open' && state.successes >= this.config.successThreshold) {
      this.transitionState(provider, 'closed');
    }
    
    this.emit('provider:success', {
      provider,
      latency,
      state: state.state
    });
  }

  private recordFailure(provider: string, latency: number, error: any): void {
    const state = this.providerStates.get(provider)!;
    
    state.failures++;
    state.lastFailure = new Date();
    state.requests.push({
      timestamp: Date.now(),
      success: false,
      latency
    });
    
    // Clean old requests
    this.cleanOldRequests(state);
    
    // Reset to open if in half-open state
    if (state.state === 'half-open') {
      this.transitionState(provider, 'open');
    }
    
    this.emit('provider:failure', {
      provider,
      error: error?.message || 'Unknown error',
      latency,
      state: state.state
    });
  }

  private shouldOpenCircuit(provider: string): boolean {
    const state = this.providerStates.get(provider)!;
    
    if (state.state !== 'closed') {
      return false;
    }
    
    // Check if we have enough requests for statistical significance
    if (state.requests.length < this.config.volumeThreshold) {
      return false;
    }
    
    // Calculate failure rate in monitoring window
    const recentRequests = state.requests.filter(
      r => r.timestamp > Date.now() - this.config.monitoringWindow
    );
    
    const failureCount = recentRequests.filter(r => !r.success).length;
    const failureRate = failureCount / recentRequests.length;
    
    return failureCount >= this.config.failureThreshold || failureRate > 0.5;
  }

  private transitionState(
    provider: string,
    newState: 'closed' | 'open' | 'half-open'
  ): void {
    const state = this.providerStates.get(provider)!;
    const oldState = state.state;
    
    state.state = newState;
    state.lastStateChange = new Date();
    
    if (newState === 'closed') {
      state.failures = 0;
      state.successes = 0;
    }
    
    this.emit('circuit:state-change', {
      provider,
      oldState,
      newState,
      timestamp: state.lastStateChange
    });
  }

  private async executeFallback<T>(
    provider: string,
    context?: { pair?: string; quantity?: number }
  ): Promise<T> {
    const strategy = this.fallbackStrategies.get(provider);
    if (!strategy) {
      throw new Error(`No fallback strategy for provider ${provider}`);
    }
    
    this.emit('fallback:executed', {
      provider,
      strategy: strategy.type,
      context
    });
    
    switch (strategy.type) {
      case 'cached-quote':
        return this.getCachedQuote(provider, context?.pair);
        
      case 'alternative-provider':
        if (strategy.alternativeProviders) {
          for (const altProvider of strategy.alternativeProviders) {
            const altState = this.providerStates.get(altProvider);
            if (altState && altState.state === 'closed') {
              throw new Error(`Fallback to ${altProvider}`);
            }
          }
        }
        throw new Error('No available alternative providers');
        
      case 'internal-only':
        throw new Error('Fallback to internal liquidity only');
        
      case 'reject':
      default:
        throw new Error('External liquidity unavailable');
    }
  }

  private cacheQuote(provider: string, pair: string, quote: any): void {
    const cacheKey = `${provider}-${pair}`;
    this.quotesCache.set(cacheKey, {
      quote,
      timestamp: Date.now()
    });
  }

  private getCachedQuote<T>(provider: string, pair?: string): T {
    if (!pair) {
      throw new Error('No cached quote available');
    }
    
    const cacheKey = `${provider}-${pair}`;
    const cached = this.quotesCache.get(cacheKey);
    
    if (!cached) {
      throw new Error('No cached quote available');
    }
    
    const strategy = this.fallbackStrategies.get(provider);
    const cacheTimeout = strategy?.cacheTimeout || 60000; // 1 minute default
    
    if (Date.now() - cached.timestamp > cacheTimeout) {
      this.quotesCache.delete(cacheKey);
      throw new Error('Cached quote expired');
    }
    
    return cached.quote as T;
  }

  private cleanOldRequests(state: any): void {
    const cutoff = Date.now() - this.config.monitoringWindow;
    state.requests = state.requests.filter((r: any) => r.timestamp > cutoff);
  }

  private startHealthChecking(): void {
    this.healthCheckInterval = setInterval(() => {
      for (const [provider, state] of this.providerStates) {
        const health = this.getProviderHealth(provider);
        
        // Auto-recover if error rate improves
        if (state.state === 'open' && health.errorRate < 0.1 && health.availability > 0.9) {
          const timeSinceLastFailure = Date.now() - (state.lastFailure?.getTime() || 0);
          if (timeSinceLastFailure > this.config.timeout * 2) {
            this.transitionState(provider, 'half-open');
          }
        }
        
        this.emit('health:check', { provider, health });
      }
    }, 30000); // Every 30 seconds
  }

  getProviderHealth(provider: string): ProviderHealth {
    const state = this.providerStates.get(provider);
    if (!state) {
      throw new Error(`Provider ${provider} not found`);
    }
    
    const recentRequests = state.requests.filter(
      r => r.timestamp > Date.now() - this.config.monitoringWindow
    );
    
    const successCount = recentRequests.filter(r => r.success).length;
    const totalCount = recentRequests.length;
    
    const errorRate = totalCount > 0 ? (totalCount - successCount) / totalCount : 0;
    const availability = totalCount > 0 ? successCount / totalCount : 1;
    
    const avgLatency = recentRequests.length > 0
      ? recentRequests.reduce((sum, r) => sum + r.latency, 0) / recentRequests.length
      : 0;
    
    return {
      provider,
      state: state.state,
      failures: state.failures,
      successes: state.successes,
      lastFailure: state.lastFailure,
      lastSuccess: state.lastSuccess,
      lastStateChange: state.lastStateChange,
      errorRate,
      averageLatency: avgLatency,
      availability: availability * 100
    };
  }

  getAllProviderHealth(): ProviderHealth[] {
    return Array.from(this.providerStates.keys()).map(provider => 
      this.getProviderHealth(provider)
    );
  }

  resetProvider(provider: string): void {
    const state = this.providerStates.get(provider);
    if (!state) return;
    
    state.state = 'closed';
    state.failures = 0;
    state.successes = 0;
    state.requests = [];
    state.lastStateChange = new Date();
    
    this.emit('provider:reset', { provider });
  }

  updateConfig(config: Partial<CircuitBreakerConfig>): void {
    Object.assign(this.config, config);
    this.emit('config:updated', this.config);
  }

  stop(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
  }
}

// Helper class for managing multiple circuit breakers
export class CircuitBreakerManager {
  private circuitBreakers: Map<string, ExternalLiquidityCircuitBreaker> = new Map();
  private globalConfig: CircuitBreakerConfig = {
    failureThreshold: 5,
    successThreshold: 3,
    timeout: 60000, // 1 minute
    volumeThreshold: 10,
    monitoringWindow: 300000 // 5 minutes
  };

  getOrCreateCircuitBreaker(name: string): ExternalLiquidityCircuitBreaker {
    let cb = this.circuitBreakers.get(name);
    if (!cb) {
      cb = new ExternalLiquidityCircuitBreaker(this.globalConfig);
      this.circuitBreakers.set(name, cb);
    }
    return cb;
  }

  getGlobalHealth(): {
    totalProviders: number;
    healthyProviders: number;
    degradedProviders: number;
    unavailableProviders: number;
    overallAvailability: number;
  } {
    let totalProviders = 0;
    let healthyProviders = 0;
    let degradedProviders = 0;
    let unavailableProviders = 0;
    let totalAvailability = 0;

    for (const cb of this.circuitBreakers.values()) {
      const providers = cb.getAllProviderHealth();
      totalProviders += providers.length;
      
      for (const health of providers) {
        if (health.state === 'closed' && health.availability >= 95) {
          healthyProviders++;
        } else if (health.state === 'half-open' || health.availability >= 80) {
          degradedProviders++;
        } else {
          unavailableProviders++;
        }
        totalAvailability += health.availability;
      }
    }

    return {
      totalProviders,
      healthyProviders,
      degradedProviders,
      unavailableProviders,
      overallAvailability: totalProviders > 0 ? totalAvailability / totalProviders : 0
    };
  }

  stopAll(): void {
    for (const cb of this.circuitBreakers.values()) {
      cb.stop();
    }
  }
}