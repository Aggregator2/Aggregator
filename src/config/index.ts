import { config as dotenvConfig } from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import * as joi from 'joi';

// Load environment-specific .env file
const environment = process.env.NODE_ENV || 'development';
const envPath = path.resolve(process.cwd(), `.env.${environment}`);

// Load base .env file first
dotenvConfig();

// Then load environment-specific file
if (fs.existsSync(envPath)) {
  dotenvConfig({ path: envPath, override: true });
}

// Configuration schema validation
const configSchema = joi.object({
  // Environment
  NODE_ENV: joi.string()
    .valid('development', 'staging', 'production', 'test')
    .default('development'),
  
  // Application
  APP_NAME: joi.string().default('Trading Platform'),
  APP_VERSION: joi.string().default('1.0.0'),
  APP_PORT: joi.number().port().default(3000),
  APP_HOST: joi.string().hostname().default('localhost'),
  
  // Database
  DATABASE_URL: joi.string().uri().required(),
  DATABASE_POOL_MIN: joi.number().min(0).default(2),
  DATABASE_POOL_MAX: joi.number().min(1).default(10),
  DATABASE_SSL: joi.boolean().default(true),
  
  // Redis
  REDIS_URL: joi.string().uri().required(),
  REDIS_PASSWORD: joi.string().allow('').optional(),
  REDIS_TLS: joi.boolean().default(false),
  
  // Security
  JWT_SECRET: joi.string().min(32).required(),
  JWT_EXPIRES_IN: joi.string().default('24h'),
  ENCRYPTION_KEY: joi.string().min(32).required(),
  BCRYPT_ROUNDS: joi.number().min(10).default(12),
  SESSION_SECRET: joi.string().min(32).required(),
  
  // CORS
  CORS_ORIGIN: joi.string().default('*'),
  CORS_CREDENTIALS: joi.boolean().default(true),
  
  // Rate Limiting
  RATE_LIMIT_WINDOW: joi.number().default(15 * 60 * 1000), // 15 minutes
  RATE_LIMIT_MAX: joi.number().default(100),
  RATE_LIMIT_SKIP_SUCCESSFUL_REQUESTS: joi.boolean().default(false),
  
  // WebSocket
  WS_PORT: joi.number().port().default(3001),
  WS_PATH: joi.string().default('/ws'),
  WS_HEARTBEAT_INTERVAL: joi.number().default(30000),
  
  // External Services
  RPC_URL: joi.string().uri().required(),
  LIFI_API_KEY: joi.string().optional(),
  
  // Logging
  LOG_LEVEL: joi.string()
    .valid('error', 'warn', 'info', 'debug', 'trace')
    .default('info'),
  LOG_FORMAT: joi.string()
    .valid('json', 'pretty')
    .default('json'),
  LOG_DIR: joi.string().default('./logs'),
  
  // Monitoring
  METRICS_ENABLED: joi.boolean().default(true),
  METRICS_PORT: joi.number().port().default(9090),
  HEALTH_CHECK_INTERVAL: joi.number().default(30000),
  
  // Email
  SMTP_HOST: joi.string().hostname().optional(),
  SMTP_PORT: joi.number().port().default(587),
  SMTP_SECURE: joi.boolean().default(false),
  SMTP_USER: joi.string().optional(),
  SMTP_PASSWORD: joi.string().optional(),
  SMTP_FROM: joi.string().email().optional(),
  
  // Storage
  UPLOAD_DIR: joi.string().default('./uploads'),
  MAX_FILE_SIZE: joi.number().default(10 * 1024 * 1024), // 10MB
  ALLOWED_FILE_TYPES: joi.array().items(joi.string()).default(['image/jpeg', 'image/png', 'application/pdf']),
  
  // Features
  FEATURE_TRADING: joi.boolean().default(true),
  FEATURE_STAKING: joi.boolean().default(false),
  FEATURE_LENDING: joi.boolean().default(false),
  FEATURE_EXTERNAL_LIQUIDITY: joi.boolean().default(true),
  
  // Performance
  CLUSTER_ENABLED: joi.boolean().default(true),
  WORKER_COUNT: joi.number().min(1).default(0), // 0 = auto (CPU cores)
  
  // Backup
  BACKUP_ENABLED: joi.boolean().default(true),
  BACKUP_SCHEDULE: joi.string().default('0 2 * * *'), // 2 AM daily
  BACKUP_RETENTION_DAYS: joi.number().default(30),
  S3_BACKUP_BUCKET: joi.string().optional(),
  
  // Maintenance
  MAINTENANCE_MODE: joi.boolean().default(false),
  MAINTENANCE_MESSAGE: joi.string().default('System is under maintenance'),
  
  // Third-party services
  SLACK_WEBHOOK_URL: joi.string().uri().optional(),
  PAGERDUTY_INTEGRATION_KEY: joi.string().optional(),
  SENTRY_DSN: joi.string().uri().optional(),
  
  // Development
  DEBUG: joi.boolean().default(false),
  PLAYGROUND_ENABLED: joi.boolean().default(false),
}).unknown(true); // Allow additional environment variables

// Validate configuration
const { error, value: validatedConfig } = configSchema.validate(process.env, {
  abortEarly: false,
  stripUnknown: true
});

if (error) {
  console.error('Configuration validation error:', error.details);
  process.exit(1);
}

// Configuration object with proper typing
export interface Config {
  env: string;
  isDevelopment: boolean;
  isProduction: boolean;
  isTest: boolean;
  
  app: {
    name: string;
    version: string;
    port: number;
    host: string;
  };
  
  database: {
    url: string;
    pool: {
      min: number;
      max: number;
    };
    ssl: boolean;
  };
  
  redis: {
    url: string;
    password?: string;
    tls: boolean;
  };
  
  security: {
    jwtSecret: string;
    jwtExpiresIn: string;
    encryptionKey: string;
    bcryptRounds: number;
    sessionSecret: string;
  };
  
  cors: {
    origin: string | string[];
    credentials: boolean;
  };
  
  rateLimit: {
    windowMs: number;
    max: number;
    skipSuccessfulRequests: boolean;
  };
  
  websocket: {
    port: number;
    path: string;
    heartbeatInterval: number;
  };
  
  external: {
    rpcUrl: string;
    lifiApiKey?: string;
  };
  
  logging: {
    level: string;
    format: string;
    dir: string;
  };
  
  monitoring: {
    enabled: boolean;
    port: number;
    healthCheckInterval: number;
  };
  
  email: {
    host?: string;
    port: number;
    secure: boolean;
    auth?: {
      user: string;
      pass: string;
    };
    from?: string;
  };
  
  storage: {
    uploadDir: string;
    maxFileSize: number;
    allowedFileTypes: string[];
  };
  
  features: {
    trading: boolean;
    staking: boolean;
    lending: boolean;
    externalLiquidity: boolean;
  };
  
  performance: {
    clusterEnabled: boolean;
    workerCount: number;
  };
  
  backup: {
    enabled: boolean;
    schedule: string;
    retentionDays: number;
    s3Bucket?: string;
  };
  
  maintenance: {
    enabled: boolean;
    message: string;
  };
  
  integrations: {
    slack?: {
      webhookUrl: string;
    };
    pagerduty?: {
      integrationKey: string;
    };
    sentry?: {
      dsn: string;
    };
  };
  
  debug: boolean;
  playgroundEnabled: boolean;
}

// Build configuration object
const config: Config = {
  env: validatedConfig.NODE_ENV,
  isDevelopment: validatedConfig.NODE_ENV === 'development',
  isProduction: validatedConfig.NODE_ENV === 'production',
  isTest: validatedConfig.NODE_ENV === 'test',
  
  app: {
    name: validatedConfig.APP_NAME,
    version: validatedConfig.APP_VERSION,
    port: validatedConfig.APP_PORT,
    host: validatedConfig.APP_HOST,
  },
  
  database: {
    url: validatedConfig.DATABASE_URL,
    pool: {
      min: validatedConfig.DATABASE_POOL_MIN,
      max: validatedConfig.DATABASE_POOL_MAX,
    },
    ssl: validatedConfig.DATABASE_SSL,
  },
  
  redis: {
    url: validatedConfig.REDIS_URL,
    password: validatedConfig.REDIS_PASSWORD,
    tls: validatedConfig.REDIS_TLS,
  },
  
  security: {
    jwtSecret: validatedConfig.JWT_SECRET,
    jwtExpiresIn: validatedConfig.JWT_EXPIRES_IN,
    encryptionKey: validatedConfig.ENCRYPTION_KEY,
    bcryptRounds: validatedConfig.BCRYPT_ROUNDS,
    sessionSecret: validatedConfig.SESSION_SECRET,
  },
  
  cors: {
    origin: validatedConfig.CORS_ORIGIN.split(',').map((o: string) => o.trim()),
    credentials: validatedConfig.CORS_CREDENTIALS,
  },
  
  rateLimit: {
    windowMs: validatedConfig.RATE_LIMIT_WINDOW,
    max: validatedConfig.RATE_LIMIT_MAX,
    skipSuccessfulRequests: validatedConfig.RATE_LIMIT_SKIP_SUCCESSFUL_REQUESTS,
  },
  
  websocket: {
    port: validatedConfig.WS_PORT,
    path: validatedConfig.WS_PATH,
    heartbeatInterval: validatedConfig.WS_HEARTBEAT_INTERVAL,
  },
  
  external: {
    rpcUrl: validatedConfig.RPC_URL,
    lifiApiKey: validatedConfig.LIFI_API_KEY,
  },
  
  logging: {
    level: validatedConfig.LOG_LEVEL,
    format: validatedConfig.LOG_FORMAT,
    dir: validatedConfig.LOG_DIR,
  },
  
  monitoring: {
    enabled: validatedConfig.METRICS_ENABLED,
    port: validatedConfig.METRICS_PORT,
    healthCheckInterval: validatedConfig.HEALTH_CHECK_INTERVAL,
  },
  
  email: {
    host: validatedConfig.SMTP_HOST,
    port: validatedConfig.SMTP_PORT,
    secure: validatedConfig.SMTP_SECURE,
    auth: validatedConfig.SMTP_USER && validatedConfig.SMTP_PASSWORD ? {
      user: validatedConfig.SMTP_USER,
      pass: validatedConfig.SMTP_PASSWORD,
    } : undefined,
    from: validatedConfig.SMTP_FROM,
  },
  
  storage: {
    uploadDir: validatedConfig.UPLOAD_DIR,
    maxFileSize: validatedConfig.MAX_FILE_SIZE,
    allowedFileTypes: validatedConfig.ALLOWED_FILE_TYPES,
  },
  
  features: {
    trading: validatedConfig.FEATURE_TRADING,
    staking: validatedConfig.FEATURE_STAKING,
    lending: validatedConfig.FEATURE_LENDING,
    externalLiquidity: validatedConfig.FEATURE_EXTERNAL_LIQUIDITY,
  },
  
  performance: {
    clusterEnabled: validatedConfig.CLUSTER_ENABLED,
    workerCount: validatedConfig.WORKER_COUNT || require('os').cpus().length,
  },
  
  backup: {
    enabled: validatedConfig.BACKUP_ENABLED,
    schedule: validatedConfig.BACKUP_SCHEDULE,
    retentionDays: validatedConfig.BACKUP_RETENTION_DAYS,
    s3Bucket: validatedConfig.S3_BACKUP_BUCKET,
  },
  
  maintenance: {
    enabled: validatedConfig.MAINTENANCE_MODE,
    message: validatedConfig.MAINTENANCE_MESSAGE,
  },
  
  integrations: {
    slack: validatedConfig.SLACK_WEBHOOK_URL ? {
      webhookUrl: validatedConfig.SLACK_WEBHOOK_URL,
    } : undefined,
    pagerduty: validatedConfig.PAGERDUTY_INTEGRATION_KEY ? {
      integrationKey: validatedConfig.PAGERDUTY_INTEGRATION_KEY,
    } : undefined,
    sentry: validatedConfig.SENTRY_DSN ? {
      dsn: validatedConfig.SENTRY_DSN,
    } : undefined,
  },
  
  debug: validatedConfig.DEBUG,
  playgroundEnabled: validatedConfig.PLAYGROUND_ENABLED,
};

// Freeze configuration to prevent modifications
Object.freeze(config);

// Export configuration
export default config;

// Export validation schema for testing
export { configSchema };

// Helper function to get config value by path
export function getConfigValue(path: string, defaultValue?: any): any {
  const keys = path.split('.');
  let value: any = config;
  
  for (const key of keys) {
    if (value && typeof value === 'object' && key in value) {
      value = value[key];
    } else {
      return defaultValue;
    }
  }
  
  return value;
}

// Log configuration (sanitized)
if (config.isDevelopment || config.debug) {
  const sanitizedConfig = JSON.parse(JSON.stringify(config));
  
  // Remove sensitive values
  if (sanitizedConfig.security) {
    sanitizedConfig.security.jwtSecret = '***';
    sanitizedConfig.security.encryptionKey = '***';
    sanitizedConfig.security.sessionSecret = '***';
  }
  
  if (sanitizedConfig.database) {
    sanitizedConfig.database.url = sanitizedConfig.database.url.replace(/:([^@]+)@/, ':***@');
  }
  
  if (sanitizedConfig.redis) {
    sanitizedConfig.redis.url = sanitizedConfig.redis.url.replace(/:([^@]+)@/, ':***@');
    if (sanitizedConfig.redis.password) {
      sanitizedConfig.redis.password = '***';
    }
  }
  
  if (sanitizedConfig.email?.auth) {
    sanitizedConfig.email.auth.pass = '***';
  }
  
  console.log('Configuration loaded:', JSON.stringify(sanitizedConfig, null, 2));
}