import { PriceData, PriceSource, ValidationResult, OracleConfig } from './types';

export class DataValidator {
  private readonly maxPriceAge: number;
  private readonly minPrice: number = 0.00000001;
  private readonly maxPrice: number = 1000000000;
  private readonly validSymbolPattern: RegExp = /^[A-Z0-9]+\/[A-Z0-9]+$/;
  private readonly priceVarianceThreshold: number = 0.05; // 5% variance threshold

  constructor(config: OracleConfig) {
    this.maxPriceAge = config.maxPriceAge || 60000;
  }

  validatePriceData(data: PriceData): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!this.validateSymbol(data.symbol)) {
      errors.push(`Invalid symbol format: ${data.symbol}`);
    }

    if (!this.validatePrice(data.price)) {
      errors.push(`Invalid price: ${data.price}`);
    }

    if (!this.validateVolume(data.volume24h)) {
      warnings.push(`Suspicious volume: ${data.volume24h}`);
    }

    if (!this.validateTimestamp(data.timestamp)) {
      errors.push(`Stale price data: ${new Date(data.timestamp).toISOString()}`);
    }

    if (!data.source || data.source.trim() === '') {
      errors.push('Missing price source');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  validatePriceSource(source: PriceSource): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!source.exchange || source.exchange.trim() === '') {
      errors.push('Missing exchange name');
    }

    if (!this.validatePrice(source.price)) {
      errors.push(`Invalid price from ${source.exchange}: ${source.price}`);
    }

    if (source.volume < 0) {
      errors.push(`Negative volume from ${source.exchange}`);
    }

    if (source.weight < 0 || source.weight > 1) {
      warnings.push(`Invalid weight for ${source.exchange}: ${source.weight}`);
    }

    if (!this.validateTimestamp(source.timestamp)) {
      warnings.push(`Stale data from ${source.exchange}`);
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  validatePriceSources(sources: PriceSource[]): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (sources.length === 0) {
      errors.push('No price sources provided');
      return { isValid: false, errors, warnings };
    }

    const exchangeSet = new Set<string>();
    sources.forEach(source => {
      const result = this.validatePriceSource(source);
      errors.push(...result.errors);
      warnings.push(...result.warnings);

      if (exchangeSet.has(source.exchange)) {
        errors.push(`Duplicate exchange: ${source.exchange}`);
      }
      exchangeSet.add(source.exchange);
    });

    const priceVariance = this.calculatePriceVariance(sources);
    if (priceVariance > this.priceVarianceThreshold) {
      warnings.push(`High price variance detected: ${(priceVariance * 100).toFixed(2)}%`);
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  private validateSymbol(symbol: string): boolean {
    return this.validSymbolPattern.test(symbol);
  }

  private validatePrice(price: number): boolean {
    return (
      typeof price === 'number' &&
      !isNaN(price) &&
      isFinite(price) &&
      price >= this.minPrice &&
      price <= this.maxPrice
    );
  }

  private validateVolume(volume: number): boolean {
    return (
      typeof volume === 'number' &&
      !isNaN(volume) &&
      isFinite(volume) &&
      volume >= 0
    );
  }

  private validateTimestamp(timestamp: number): boolean {
    const age = Date.now() - timestamp;
    return (
      typeof timestamp === 'number' &&
      timestamp > 0 &&
      age >= 0 &&
      age <= this.maxPriceAge
    );
  }

  private calculatePriceVariance(sources: PriceSource[]): number {
    if (sources.length < 2) return 0;

    const prices = sources.map(s => s.price);
    const mean = prices.reduce((sum, price) => sum + price, 0) / prices.length;
    const variance = prices.reduce((sum, price) => sum + Math.pow(price - mean, 2), 0) / prices.length;
    
    return Math.sqrt(variance) / mean;
  }

  sanitizePriceData(data: PriceData): PriceData {
    return {
      symbol: data.symbol.toUpperCase().trim(),
      price: Math.max(this.minPrice, Math.min(this.maxPrice, data.price)),
      volume24h: Math.max(0, data.volume24h),
      timestamp: data.timestamp > Date.now() ? Date.now() : data.timestamp,
      source: data.source.trim()
    };
  }

  isHealthyDataFeed(recentErrors: number, totalRequests: number): boolean {
    if (totalRequests === 0) return true;
    const errorRate = recentErrors / totalRequests;
    return errorRate < 0.1;
  }
}