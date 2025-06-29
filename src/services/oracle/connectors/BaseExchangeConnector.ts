import { EventEmitter } from 'events';
import axios, { AxiosInstance } from 'axios';
import { ExchangeConnector, PriceData, HealthStatus, ExchangeConfig } from '../types';

export abstract class BaseExchangeConnector extends EventEmitter implements ExchangeConnector {
  protected api: AxiosInstance;
  protected connected: boolean = false;
  protected lastRequestTime: number = 0;
  protected requestCount: number = 0;
  protected errorCount: number = 0;
  protected config: ExchangeConfig;

  constructor(config: ExchangeConfig) {
    super();
    this.config = config;
    this.api = axios.create({
      baseURL: config.apiUrl,
      timeout: config.timeout,
      headers: this.getHeaders()
    });
  }

  abstract name: string;
  abstract fetchPrice(symbol: string): Promise<PriceData>;
  protected abstract getHeaders(): Record<string, string>;
  protected abstract parseResponse(data: any, symbol: string): PriceData;

  async connect(): Promise<void> {
    try {
      await this.testConnection();
      this.connected = true;
      this.emit('connected', this.name);
    } catch (error) {
      this.connected = false;
      throw new Error(`Failed to connect to ${this.name}: ${error.message}`);
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.emit('disconnected', this.name);
  }

  isConnected(): boolean {
    return this.connected;
  }

  async getHealth(): Promise<HealthStatus> {
    const startTime = Date.now();
    let status: 'healthy' | 'degraded' | 'down' = 'healthy';
    
    try {
      await this.testConnection();
      const latency = Date.now() - startTime;
      
      if (latency > 1000) status = 'degraded';
      if (this.errorCount > 10) status = 'degraded';
      if (!this.connected) status = 'down';
      
    } catch (error) {
      status = 'down';
    }
    
    return {
      exchange: this.name,
      status,
      latency: Date.now() - startTime,
      lastUpdate: Date.now(),
      errorRate: this.requestCount > 0 ? this.errorCount / this.requestCount : 0
    };
  }

  protected async rateLimitedRequest<T>(request: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    const minInterval = 1000 / this.config.rateLimit;
    
    if (timeSinceLastRequest < minInterval) {
      await this.sleep(minInterval - timeSinceLastRequest);
    }
    
    this.lastRequestTime = Date.now();
    this.requestCount++;
    
    try {
      const result = await request();
      return result;
    } catch (error) {
      this.errorCount++;
      throw error;
    }
  }

  protected async testConnection(): Promise<void> {
    const testSymbol = 'BTC/USDT';
    await this.fetchPrice(testSymbol);
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  protected normalizeSymbol(symbol: string): string {
    return symbol.replace('/', '');
  }
}