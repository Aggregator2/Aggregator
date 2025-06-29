import { EventEmitter } from 'events';
import { CircuitBreaker as CircuitBreakerType } from './types';

export interface PriceMovement {
  symbol: string;
  previousPrice: number;
  currentPrice: number;
  changePercent: number;
  timestamp: Date;
}

export interface VolumeSpike {
  symbol: string;
  normalVolume: number;
  currentVolume: number;
  spikeRatio: number;
  timestamp: Date;
}

export interface CircuitBreakerTrigger {
  id: string;
  circuitBreaker: CircuitBreakerType;
  triggerType: 'PRICE' | 'VOLUME' | 'VOLATILITY' | 'SYSTEM';
  triggerValue: number;
  threshold: number;
  action: 'HALT' | 'LIMIT_ONLY' | 'REDUCE_LEVERAGE' | 'COOLDOWN';
  duration: number;
  timestamp: Date;
}

export class CircuitBreakerManager extends EventEmitter {
  private circuitBreakers: Map<string, CircuitBreakerType> = new Map();
  private priceHistory: Map<string, PriceMovement[]> = new Map();
  private volumeHistory: Map<string, VolumeSpike[]> = new Map();
  private triggers: CircuitBreakerTrigger[] = [];
  private haltedSymbols: Set<string> = new Set();
  
  // Default thresholds
  private defaultPriceChangeThreshold = 0.1; // 10%
  private defaultVolumeThreshold = 5; // 5x normal volume
  private defaultCooldownPeriod = 300; // 5 minutes
  private volatilityMultiplier = 3; // 3 standard deviations

  constructor() {
    super();
    this.startMonitoring();
  }

  createCircuitBreaker(params: Omit<CircuitBreakerType, 'isActive' | 'triggeredAt' | 'expiresAt'>): void {
    const circuitBreaker: CircuitBreakerType = {
      ...params,
      isActive: false
    };
    
    this.circuitBreakers.set(params.symbol, circuitBreaker);
    this.emit('circuitBreakerCreated', circuitBreaker);
  }

  updatePrice(symbol: string, price: number): void {
    const history = this.priceHistory.get(symbol) || [];
    const previousPrice = history.length > 0 ? history[history.length - 1].currentPrice : price;
    
    const movement: PriceMovement = {
      symbol,
      previousPrice,
      currentPrice: price,
      changePercent: Math.abs((price - previousPrice) / previousPrice),
      timestamp: new Date()
    };
    
    history.push(movement);
    this.priceHistory.set(symbol, history);
    
    // Check for circuit breaker trigger
    this.checkPriceTrigger(symbol, movement);
  }

  updateVolume(symbol: string, volume: number): void {
    const history = this.volumeHistory.get(symbol) || [];
    const normalVolume = this.calculateNormalVolume(symbol);
    
    const spike: VolumeSpike = {
      symbol,
      normalVolume,
      currentVolume: volume,
      spikeRatio: volume / normalVolume,
      timestamp: new Date()
    };
    
    history.push(spike);
    this.volumeHistory.set(symbol, history);
    
    // Check for volume trigger
    this.checkVolumeTrigger(symbol, spike);
  }

  private checkPriceTrigger(symbol: string, movement: PriceMovement): void {
    const circuitBreaker = this.circuitBreakers.get(symbol);
    if (!circuitBreaker || circuitBreaker.isActive) return;
    
    // Check if price change exceeds threshold
    if (movement.changePercent >= circuitBreaker.priceChangeThreshold) {
      this.triggerCircuitBreaker(circuitBreaker, 'PRICE', movement.changePercent);
    }
    
    // Check for volatility-based triggers
    const volatility = this.calculateVolatility(symbol);
    const volatilityThreshold = this.calculateDynamicThreshold(symbol, volatility);
    
    if (movement.changePercent >= volatilityThreshold) {
      this.triggerCircuitBreaker(circuitBreaker, 'VOLATILITY', movement.changePercent);
    }
  }

  private checkVolumeTrigger(symbol: string, spike: VolumeSpike): void {
    const circuitBreaker = this.circuitBreakers.get(symbol);
    if (!circuitBreaker || circuitBreaker.isActive) return;
    
    if (spike.spikeRatio >= circuitBreaker.volumeThreshold) {
      this.triggerCircuitBreaker(circuitBreaker, 'VOLUME', spike.spikeRatio);
    }
  }

  private triggerCircuitBreaker(
    circuitBreaker: CircuitBreakerType,
    triggerType: CircuitBreakerTrigger['triggerType'],
    triggerValue: number
  ): void {
    // Update circuit breaker state
    circuitBreaker.isActive = true;
    circuitBreaker.triggeredAt = new Date();
    circuitBreaker.expiresAt = new Date(Date.now() + circuitBreaker.cooldownPeriod * 1000);
    
    // Determine action based on severity
    const action = this.determineAction(triggerType, triggerValue, circuitBreaker);
    
    const trigger: CircuitBreakerTrigger = {
      id: `${circuitBreaker.symbol}-${Date.now()}`,
      circuitBreaker,
      triggerType,
      triggerValue,
      threshold: this.getThreshold(circuitBreaker, triggerType),
      action,
      duration: circuitBreaker.cooldownPeriod,
      timestamp: new Date()
    };
    
    this.triggers.push(trigger);
    
    // Execute action
    this.executeAction(circuitBreaker.symbol, action);
    
    // Emit events
    this.emit('circuitBreakerTriggered', trigger);
    
    // Schedule automatic reset
    setTimeout(() => {
      this.resetCircuitBreaker(circuitBreaker.symbol);
    }, circuitBreaker.cooldownPeriod * 1000);
  }

  private executeAction(symbol: string, action: CircuitBreakerTrigger['action']): void {
    switch (action) {
      case 'HALT':
        this.haltTrading(symbol);
        break;
      case 'LIMIT_ONLY':
        this.restrictToLimitOrders(symbol);
        break;
      case 'REDUCE_LEVERAGE':
        this.reduceLeverage(symbol);
        break;
      case 'COOLDOWN':
        this.applyCooldown(symbol);
        break;
    }
  }

  private haltTrading(symbol: string): void {
    this.haltedSymbols.add(symbol);
    this.emit('tradingHalted', { symbol, timestamp: new Date() });
  }

  private restrictToLimitOrders(symbol: string): void {
    this.emit('limitOrdersOnly', { symbol, timestamp: new Date() });
  }

  private reduceLeverage(symbol: string): void {
    // Reduce maximum allowed leverage by 50%
    this.emit('leverageReduced', { 
      symbol, 
      reductionFactor: 0.5,
      timestamp: new Date() 
    });
  }

  private applyCooldown(symbol: string): void {
    // Apply rate limiting to new orders
    this.emit('cooldownApplied', { 
      symbol,
      cooldownMs: 1000, // 1 second between orders
      timestamp: new Date() 
    });
  }

  private resetCircuitBreaker(symbol: string): void {
    const circuitBreaker = this.circuitBreakers.get(symbol);
    if (!circuitBreaker) return;
    
    circuitBreaker.isActive = false;
    circuitBreaker.triggeredAt = undefined;
    circuitBreaker.expiresAt = undefined;
    
    this.haltedSymbols.delete(symbol);
    
    this.emit('circuitBreakerReset', { symbol, timestamp: new Date() });
  }

  isSymbolHalted(symbol: string): boolean {
    return this.haltedSymbols.has(symbol);
  }

  getActiveCircuitBreakers(): CircuitBreakerType[] {
    return Array.from(this.circuitBreakers.values()).filter(cb => cb.isActive);
  }

  getTriggerHistory(symbol?: string, hours: number = 24): CircuitBreakerTrigger[] {
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
    
    return this.triggers.filter(trigger => {
      const matchesSymbol = !symbol || trigger.circuitBreaker.symbol === symbol;
      const withinTimeframe = trigger.timestamp > cutoff;
      return matchesSymbol && withinTimeframe;
    });
  }

  private calculateVolatility(symbol: string): number {
    const history = this.priceHistory.get(symbol) || [];
    if (history.length < 20) return 0.01; // Default 1% if insufficient data
    
    // Calculate standard deviation of returns
    const returns = history.slice(-20).map((h, i) => {
      if (i === 0) return 0;
      return (h.currentPrice - history[i - 1].currentPrice) / history[i - 1].currentPrice;
    }).slice(1);
    
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;
    
    return Math.sqrt(variance);
  }

  private calculateDynamicThreshold(symbol: string, volatility: number): number {
    // Dynamic threshold based on current volatility
    const baseThreshold = this.circuitBreakers.get(symbol)?.priceChangeThreshold || this.defaultPriceChangeThreshold;
    return Math.max(baseThreshold, volatility * this.volatilityMultiplier);
  }

  private calculateNormalVolume(symbol: string): number {
    const history = this.volumeHistory.get(symbol) || [];
    if (history.length < 10) return 1000; // Default if insufficient data
    
    // 10-period moving average
    const recentVolumes = history.slice(-10).map(h => h.currentVolume);
    return recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length;
  }

  private determineAction(
    triggerType: CircuitBreakerTrigger['triggerType'],
    triggerValue: number,
    circuitBreaker: CircuitBreakerType
  ): CircuitBreakerTrigger['action'] {
    // Determine severity and appropriate action
    const severityScore = this.calculateSeverity(triggerType, triggerValue, circuitBreaker);
    
    if (severityScore >= 0.9) return 'HALT';
    if (severityScore >= 0.7) return 'LIMIT_ONLY';
    if (severityScore >= 0.5) return 'REDUCE_LEVERAGE';
    return 'COOLDOWN';
  }

  private calculateSeverity(
    triggerType: CircuitBreakerTrigger['triggerType'],
    triggerValue: number,
    circuitBreaker: CircuitBreakerType
  ): number {
    switch (triggerType) {
      case 'PRICE':
        return triggerValue / (circuitBreaker.priceChangeThreshold * 2);
      case 'VOLUME':
        return triggerValue / (circuitBreaker.volumeThreshold * 2);
      case 'VOLATILITY':
        return Math.min(1, triggerValue / 0.2); // 20% max for volatility
      case 'SYSTEM':
        return 1; // System triggers are always severe
      default:
        return 0.5;
    }
  }

  private getThreshold(
    circuitBreaker: CircuitBreakerType,
    triggerType: CircuitBreakerTrigger['triggerType']
  ): number {
    switch (triggerType) {
      case 'PRICE':
      case 'VOLATILITY':
        return circuitBreaker.priceChangeThreshold;
      case 'VOLUME':
        return circuitBreaker.volumeThreshold;
      default:
        return 0;
    }
  }

  private startMonitoring(): void {
    // Clean up old history data every hour
    setInterval(() => {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours
      
      this.priceHistory.forEach((history, symbol) => {
        const filtered = history.filter(h => h.timestamp > cutoff);
        this.priceHistory.set(symbol, filtered);
      });
      
      this.volumeHistory.forEach((history, symbol) => {
        const filtered = history.filter(h => h.timestamp > cutoff);
        this.volumeHistory.set(symbol, filtered);
      });
      
      this.triggers = this.triggers.filter(t => t.timestamp > cutoff);
    }, 60 * 60 * 1000); // Every hour
  }

  // System-wide circuit breaker
  triggerSystemCircuitBreaker(reason: string): void {
    // Halt all trading
    this.circuitBreakers.forEach((cb, symbol) => {
      if (!cb.isActive) {
        this.triggerCircuitBreaker(cb, 'SYSTEM', 1);
      }
    });
    
    this.emit('systemCircuitBreakerTriggered', { reason, timestamp: new Date() });
  }
}