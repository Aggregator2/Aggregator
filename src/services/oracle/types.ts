export interface PriceData {
  symbol: string;
  price: number;
  volume24h: number;
  timestamp: number;
  source: string;
}

export interface AggregatedPrice {
  symbol: string;
  price: number;
  sources: PriceSource[];
  timestamp: number;
  confidence: number;
  outliers: OutlierData[];
}

export interface PriceSource {
  exchange: string;
  price: number;
  volume: number;
  weight: number;
  timestamp: number;
  isOutlier?: boolean;
}

export interface OutlierData {
  exchange: string;
  price: number;
  deviation: number;
  reason: string;
}

export interface OracleConfig {
  exchanges: ExchangeConfig[];
  outlierThreshold: number;
  minSources: number;
  maxPriceAge: number;
  volumeWeightEnabled: boolean;
  reputationEnabled: boolean;
}

export interface ExchangeConfig {
  name: string;
  apiUrl: string;
  apiKey?: string;
  apiSecret?: string;
  weight: number;
  rateLimit: number;
  timeout: number;
  enabled: boolean;
}

export interface OracleReputation {
  exchange: string;
  score: number;
  totalSubmissions: number;
  accurateSubmissions: number;
  averageDeviation: number;
  lastUpdated: number;
}

export interface PriceSubscription {
  id: string;
  symbols: string[];
  callback: (price: AggregatedPrice) => void;
  interval: number;
}

export interface ManipulationAlert {
  symbol: string;
  type: 'pump' | 'dump' | 'wash_trading' | 'spoofing';
  severity: 'low' | 'medium' | 'high' | 'critical';
  exchange: string;
  details: string;
  timestamp: number;
}

export interface ExchangeConnector {
  name: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  fetchPrice(symbol: string): Promise<PriceData>;
  isConnected(): boolean;
  getHealth(): Promise<HealthStatus>;
}

export interface HealthStatus {
  exchange: string;
  status: 'healthy' | 'degraded' | 'down';
  latency: number;
  lastUpdate: number;
  errorRate: number;
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface PriceCache {
  [symbol: string]: {
    price: AggregatedPrice;
    raw: PriceData[];
    timestamp: number;
  };
}