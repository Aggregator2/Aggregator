export interface OrderBookDatabaseConfig {
  redis: {
    host: string;
    port: number;
    password?: string;
    db?: number;
    keyPrefix: string;
    enableOfflineQueue?: boolean;
    maxRetriesPerRequest?: number;
    retryStrategy?: (times: number) => number | null;
  };
  postgres: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    ssl?: boolean;
    poolSize?: number;
    idleTimeoutMillis?: number;
    connectionTimeoutMillis?: number;
    statement_timeout?: number;
  };
  websocket: {
    port: number;
    path: string;
    pingInterval: number;
    pingTimeout: number;
    maxConnections?: number;
    cors?: {
      origin: string | string[];
      credentials?: boolean;
    };
  };
  orderExpiration: {
    enabled: boolean;
    checkInterval: number; // ms
    defaultTTL?: number; // seconds
    customTTL?: Record<string, number>; // pair -> TTL
  };
  replication: {
    enabled: boolean;
    replicas?: {
      redis?: string[];
      postgres?: string[];
    };
    failoverTimeout?: number;
    healthCheckInterval?: number;
  };
  backup: {
    enabled: boolean;
    interval: number; // ms
    retention: number; // days
    s3?: {
      bucket: string;
      region: string;
      accessKeyId: string;
      secretAccessKey: string;
      prefix?: string;
    };
    local?: {
      path: string;
      compress?: boolean;
    };
  };
  performance: {
    batchSize: number;
    flushInterval: number; // ms
    maxBatchDelay: number; // ms
    indexCacheSize: number;
    enableCompression?: boolean;
  };
}

export const defaultConfig: OrderBookDatabaseConfig = {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_DB || '0'),
    keyPrefix: 'orderbook:',
    enableOfflineQueue: false,
    maxRetriesPerRequest: 3,
    retryStrategy: (times: number) => {
      if (times > 3) return null;
      return Math.min(times * 100, 3000);
    }
  },
  postgres: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432'),
    database: process.env.POSTGRES_DB || 'orderbook',
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'postgres',
    ssl: process.env.POSTGRES_SSL === 'true',
    poolSize: parseInt(process.env.POSTGRES_POOL_SIZE || '20'),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    statement_timeout: 30000
  },
  websocket: {
    port: parseInt(process.env.WS_PORT || '8080'),
    path: '/orderbook',
    pingInterval: 30000,
    pingTimeout: 5000,
    maxConnections: 10000,
    cors: {
      origin: process.env.WS_CORS_ORIGIN || '*',
      credentials: true
    }
  },
  orderExpiration: {
    enabled: true,
    checkInterval: 60000, // 1 minute
    defaultTTL: 86400, // 24 hours
    customTTL: {
      'ETH/USDC': 3600, // 1 hour
      'BTC/USDT': 7200  // 2 hours
    }
  },
  replication: {
    enabled: process.env.ENABLE_REPLICATION === 'true',
    failoverTimeout: 5000,
    healthCheckInterval: 10000
  },
  backup: {
    enabled: process.env.ENABLE_BACKUP === 'true',
    interval: 3600000, // 1 hour
    retention: 30, // 30 days
    local: {
      path: './backups',
      compress: true
    }
  },
  performance: {
    batchSize: 100,
    flushInterval: 100,
    maxBatchDelay: 1000,
    indexCacheSize: 10000,
    enableCompression: true
  }
};