import { EventEmitter } from 'events';
import { 
  OracleConfig, 
  ExchangeConnector, 
  PriceData, 
  AggregatedPrice,
  PriceSource,
  HealthStatus,
  PriceCache
} from './types';
import { BinanceConnector } from './connectors/BinanceConnector';
import { CoinbaseConnector } from './connectors/CoinbaseConnector';
import { KrakenConnector } from './connectors/KrakenConnector';
import { PriceAggregator } from './PriceAggregator';
import { ManipulationDetector } from './ManipulationDetector';
import { SubscriptionManager } from './SubscriptionManager';
import { DataValidator } from './DataValidator';
import { OutlierDetector } from './OutlierDetector';

export class OracleService extends EventEmitter {
  private connectors: Map<string, ExchangeConnector> = new Map();
  private priceAggregator: PriceAggregator;
  private manipulationDetector: ManipulationDetector;
  private subscriptionManager: SubscriptionManager;
  private dataValidator: DataValidator;
  private priceCache: PriceCache = {};
  private updateInterval?: NodeJS.Timeout;
  private healthCheckInterval?: NodeJS.Timeout;
  private failedConnectors: Set<string> = new Set();
  private config: OracleConfig;

  constructor(config: OracleConfig) {
    super();
    this.config = config;
    this.priceAggregator = new PriceAggregator(
      config.volumeWeightEnabled,
      config.reputationEnabled
    );
    this.manipulationDetector = new ManipulationDetector();
    this.subscriptionManager = new SubscriptionManager();
    this.dataValidator = new DataValidator(config);
    
    this.initializeConnectors();
    this.setupEventListeners();
  }

  private initializeConnectors(): void {
    this.config.exchanges.forEach(exchangeConfig => {
      if (!exchangeConfig.enabled) return;

      let connector: ExchangeConnector;
      switch (exchangeConfig.name.toLowerCase()) {
        case 'binance':
          connector = new BinanceConnector(exchangeConfig);
          break;
        case 'coinbase':
          connector = new CoinbaseConnector(exchangeConfig);
          break;
        case 'kraken':
          connector = new KrakenConnector(exchangeConfig);
          break;
        default:
          console.warn(`Unknown exchange: ${exchangeConfig.name}`);
          return;
      }

      this.connectors.set(exchangeConfig.name, connector);
    });
  }

  private setupEventListeners(): void {
    this.manipulationDetector.on('manipulation-detected', (alert) => {
      this.emit('manipulation-alert', alert);
    });

    this.subscriptionManager.on('price-published', (price) => {
      this.emit('price-update', price);
    });
  }

  async start(): Promise<void> {
    await this.connectExchanges();
    this.startPriceUpdates();
    this.startHealthChecks();
    this.emit('oracle-started');
  }

  async stop(): Promise<void> {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    
    await this.disconnectExchanges();
    this.subscriptionManager.clearAll();
    this.emit('oracle-stopped');
  }

  private async connectExchanges(): Promise<void> {
    const connectionPromises = Array.from(this.connectors.entries()).map(
      async ([name, connector]) => {
        try {
          await connector.connect();
          this.failedConnectors.delete(name);
          console.log(`Connected to ${name}`);
        } catch (error) {
          console.error(`Failed to connect to ${name}:`, error);
          this.failedConnectors.add(name);
        }
      }
    );

    await Promise.allSettled(connectionPromises);

    const connectedCount = this.connectors.size - this.failedConnectors.size;
    if (connectedCount < this.config.minSources) {
      throw new Error(
        `Insufficient exchanges connected: ${connectedCount}/${this.config.minSources} required`
      );
    }
  }

  private async disconnectExchanges(): Promise<void> {
    const disconnectionPromises = Array.from(this.connectors.values()).map(
      connector => connector.disconnect()
    );
    await Promise.allSettled(disconnectionPromises);
  }

  private startPriceUpdates(): void {
    const updatePrices = async () => {
      const symbols = this.subscriptionManager.getActiveSymbols();
      
      for (const symbol of symbols) {
        try {
          const price = await this.fetchAggregatedPrice(symbol);
          this.subscriptionManager.publishPrice(price);
        } catch (error) {
          console.error(`Failed to update price for ${symbol}:`, error);
          this.emit('price-update-error', { symbol, error });
        }
      }
    };

    this.updateInterval = setInterval(updatePrices, 1000);
  }

  private startHealthChecks(): void {
    const checkHealth = async () => {
      for (const [name, connector] of this.connectors) {
        try {
          const health = await connector.getHealth();
          
          if (health.status === 'down' && !this.failedConnectors.has(name)) {
            await this.handleConnectorFailure(name, connector);
          } else if (health.status === 'healthy' && this.failedConnectors.has(name)) {
            await this.handleConnectorRecovery(name, connector);
          }
          
          this.emit('health-update', health);
        } catch (error) {
          console.error(`Health check failed for ${name}:`, error);
        }
      }
    };

    this.healthCheckInterval = setInterval(checkHealth, 30000);
  }

  private async handleConnectorFailure(name: string, connector: ExchangeConnector): Promise<void> {
    this.failedConnectors.add(name);
    this.emit('connector-failed', { name });

    setTimeout(async () => {
      try {
        await connector.connect();
        await this.handleConnectorRecovery(name, connector);
      } catch (error) {
        console.error(`Reconnection failed for ${name}:`, error);
      }
    }, 60000);
  }

  private async handleConnectorRecovery(name: string, connector: ExchangeConnector): Promise<void> {
    this.failedConnectors.delete(name);
    this.emit('connector-recovered', { name });
  }

  async fetchAggregatedPrice(symbol: string): Promise<AggregatedPrice> {
    const cached = this.getCachedPrice(symbol);
    if (cached) return cached;

    const sources = await this.fetchPriceFromAllExchanges(symbol);
    const validSources = this.validateAndFilterSources(sources);

    if (validSources.length < this.config.minSources) {
      throw new Error(
        `Insufficient valid price sources: ${validSources.length}/${this.config.minSources}`
      );
    }

    const aggregatedPrice = this.priceAggregator.aggregate(symbol, validSources);
    
    const manipulationAlerts = this.manipulationDetector.detectManipulation(
      symbol,
      {
        symbol,
        price: aggregatedPrice.price,
        volume24h: validSources.reduce((sum, s) => sum + s.volume, 0),
        timestamp: Date.now(),
        source: 'aggregated'
      },
      validSources
    );

    if (manipulationAlerts.length > 0) {
      aggregatedPrice.confidence *= 0.5;
    }

    this.cachePrice(symbol, aggregatedPrice, sources);
    return aggregatedPrice;
  }

  private async fetchPriceFromAllExchanges(symbol: string): Promise<PriceData[]> {
    const activeConnectors = Array.from(this.connectors.entries())
      .filter(([name]) => !this.failedConnectors.has(name));

    const pricePromises = activeConnectors.map(async ([name, connector]) => {
      try {
        const price = await connector.fetchPrice(symbol);
        return price;
      } catch (error) {
        console.error(`Failed to fetch price from ${name}:`, error);
        return null;
      }
    });

    const results = await Promise.allSettled(pricePromises);
    return results
      .filter((result): result is PromiseFulfilledResult<PriceData | null> => 
        result.status === 'fulfilled' && result.value !== null
      )
      .map(result => result.value!);
  }

  private validateAndFilterSources(prices: PriceData[]): PriceSource[] {
    const validSources: PriceSource[] = [];

    prices.forEach(price => {
      const validation = this.dataValidator.validatePriceData(price);
      if (validation.isValid) {
        validSources.push({
          exchange: price.source,
          price: price.price,
          volume: price.volume24h,
          weight: 1,
          timestamp: price.timestamp
        });
      } else {
        console.warn(`Invalid price data from ${price.source}:`, validation.errors);
      }
    });

    return validSources;
  }

  private getCachedPrice(symbol: string): AggregatedPrice | null {
    const cached = this.priceCache[symbol];
    if (!cached) return null;

    const age = Date.now() - cached.timestamp;
    if (age > 5000) {
      delete this.priceCache[symbol];
      return null;
    }

    return cached.price;
  }

  private cachePrice(symbol: string, price: AggregatedPrice, raw: PriceData[]): void {
    this.priceCache[symbol] = {
      price,
      raw,
      timestamp: Date.now()
    };
  }

  subscribe(
    symbols: string[],
    callback: (price: AggregatedPrice) => void,
    interval?: number
  ): string {
    return this.subscriptionManager.subscribe(symbols, callback, interval);
  }

  unsubscribe(id: string): boolean {
    return this.subscriptionManager.unsubscribe(id);
  }

  async getHealth(): Promise<HealthStatus[]> {
    const healthPromises = Array.from(this.connectors.entries()).map(
      async ([name, connector]) => {
        try {
          return await connector.getHealth();
        } catch (error) {
          return {
            exchange: name,
            status: 'down' as const,
            latency: -1,
            lastUpdate: Date.now(),
            errorRate: 1
          };
        }
      }
    );

    return Promise.all(healthPromises);
  }

  getReputations() {
    return this.priceAggregator.getReputations();
  }

  clearCache(symbol?: string): void {
    if (symbol) {
      delete this.priceCache[symbol];
    } else {
      this.priceCache = {};
    }
  }
}