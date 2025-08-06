/**
 * Configuration Management for API Gateway
 * Supports multiple environments with validation and security
 */

import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Environment detection
const environment = process.env.NODE_ENV || 'development';
const isProduction = environment === 'production';
const isDevelopment = environment === 'development';
const isTest = environment === 'test';

/**
 * Base configuration
 */
const baseConfig = {
    environment,
    isProduction,
    isDevelopment,
    isTest,

    // Server configuration
    server: {
        host: process.env.HOST || '0.0.0.0',
        port: parseInt(process.env.PORT) || 3000,
        fastify: {
            requestTimeout: 30000,
            keepAliveTimeout: 5000,
            maxRequestsPerSocket: 0, // No limit
            requestIdHeader: 'x-request-id',
            trustProxy: isProduction
        }
    },

    // Database configuration
    database: {
        postgresql: {
            host: process.env.POSTGRES_HOST || 'localhost',
            port: parseInt(process.env.POSTGRES_PORT) || 5432,
            database: process.env.POSTGRES_DB || 'settlement_queue',
            username: process.env.POSTGRES_USER || 'postgres',
            password: process.env.POSTGRES_PASSWORD || 'password',
            ssl: isProduction ? { rejectUnauthorized: false } : false,
            pool: {
                min: parseInt(process.env.POSTGRES_POOL_MIN) || 2,
                max: parseInt(process.env.POSTGRES_POOL_MAX) || 20,
                acquireTimeoutMillis: 60000,
                idleTimeoutMillis: 30000,
                reapIntervalMillis: 1000,
                createRetryIntervalMillis: 200
            }
        },
        mongodb: {
            url: process.env.MONGODB_URL || 'mongodb://localhost:27017',
            database: process.env.MONGODB_DB || 'settlement_analytics',
            options: {
                maxPoolSize: 10,
                serverSelectionTimeoutMS: 5000,
                socketTimeoutMS: 45000,
                family: 4,
                retryWrites: true,
                writeConcern: {
                    w: 'majority'
                }
            }
        }
    },

    // Cache configuration (Redis)
    cache: {
        redis: {
            host: process.env.REDIS_HOST || 'localhost',
            port: parseInt(process.env.REDIS_PORT) || 6379,
            password: process.env.REDIS_PASSWORD,
            db: parseInt(process.env.REDIS_DB) || 0,
            family: 4,
            keyPrefix: 'sq:',
            retryDelayOnFailover: 100,
            enableReadyCheck: true,
            maxRetriesPerRequest: 3,
            lazyConnect: true,
            // Cluster configuration for production
            ...(isProduction && process.env.REDIS_CLUSTER_HOSTS ? {
                cluster: {
                    enableOfflineQueue: false,
                    redisOptions: {
                        password: process.env.REDIS_PASSWORD
                    },
                    nodes: process.env.REDIS_CLUSTER_HOSTS.split(',').map(host => {
                        const [hostname, port] = host.split(':');
                        return { host: hostname, port: parseInt(port) || 6379 };
                    })
                }
            } : {})
        },
        ttl: {
            default: 300, // 5 minutes
            short: 60,    // 1 minute
            medium: 900,  // 15 minutes
            long: 3600,   // 1 hour
            extended: 86400 // 24 hours
        }
    },

    // Authentication & Authorization
    auth: {
        jwt: {
            secret: process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production',
            expiresIn: process.env.JWT_EXPIRES_IN || '1h',
            refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
            algorithm: 'HS256',
            issuer: 'settlementqueue-api-gateway',
            audience: 'settlementqueue-clients'
        },
        apiKey: {
            headerName: 'x-api-key',
            saltRounds: 12,
            expiresIn: '1y' // API keys expire in 1 year
        },
        oauth: {
            google: {
                clientId: process.env.GOOGLE_CLIENT_ID,
                clientSecret: process.env.GOOGLE_CLIENT_SECRET
            },
            github: {
                clientId: process.env.GITHUB_CLIENT_ID,
                clientSecret: process.env.GITHUB_CLIENT_SECRET
            }
        }
    },

    // Rate limiting configuration
    rateLimit: {
        global: {
            max: 1000, // requests per window
            timeWindow: 60000, // 1 minute
            skipOnError: false,
            skipSuccessfulRequests: false,
            keyGenerator: (request) => {
                return request.headers['x-api-key'] || 
                       request.headers['x-forwarded-for'] || 
                       request.connection.remoteAddress;
            }
        },
        authenticated: {
            max: 5000,
            timeWindow: 60000
        },
        anonymous: {
            max: 100,
            timeWindow: 60000
        },
        graphql: {
            max: 1000,
            timeWindow: 60000,
            depthLimit: 10,
            costAnalysis: {
                maximumCost: 1000,
                defaultCost: 1,
                scalarCost: 1,
                objectCost: 1,
                listFactor: 10,
                introspectionCost: 1000
            }
        }
    },

    // Security configuration
    security: {
        helmet: {
            contentSecurityPolicy: {
                directives: {
                    defaultSrc: ["'self'"],
                    styleSrc: ["'self'", "'unsafe-inline'"],
                    scriptSrc: ["'self'"],
                    imgSrc: ["'self'", "data:", "https:"],
                    connectSrc: ["'self'"],
                    fontSrc: ["'self'"],
                    objectSrc: ["'none'"],
                    mediaSrc: ["'self'"],
                    frameSrc: ["'none'"]
                }
            },
            crossOriginEmbedderPolicy: false,
            hsts: isProduction ? {
                maxAge: 31536000,
                includeSubDomains: true,
                preload: true
            } : false
        },
        cors: {
            origin: process.env.ALLOWED_ORIGINS ? 
                    process.env.ALLOWED_ORIGINS.split(',') : 
                    (isProduction ? false : true),
            credentials: true,
            methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
            allowedHeaders: [
                'Content-Type',
                'Authorization',
                'x-api-key',
                'x-request-id',
                'x-client-version'
            ]
        },
        // Input validation
        validation: {
            stripUnknown: true,
            abortEarly: false,
            cache: true,
            debug: isDevelopment
        }
    },

    // GraphQL configuration
    graphql: {
        path: '/graphql',
        graphiql: isDevelopment || process.env.ENABLE_GRAPHIQL === 'true',
        playground: isDevelopment,
        introspection: isDevelopment || process.env.ENABLE_INTROSPECTION === 'true',
        subscription: {
            enabled: true,
            path: '/graphql/subscriptions'
        },
        cache: {
            enabled: true,
            ttl: 300 // 5 minutes
        },
        complexity: {
            maximumCost: 1000,
            defaultCost: 1
        },
        depthLimit: 10
    },

    // WebSocket configuration
    websocket: {
        path: '/ws',
        compression: 'deflate',
        maxPayload: 1024 * 1024, // 1MB
        heartbeatInterval: 30000, // 30 seconds
        connectionTimeout: 60000, // 1 minute
        maxConnections: isProduction ? 10000 : 100,
        origins: process.env.WS_ALLOWED_ORIGINS ? 
                process.env.WS_ALLOWED_ORIGINS.split(',') : 
                (isProduction ? [] : ['*'])
    },

    // Blockchain configuration
    blockchain: {
        networks: {
            ethereum: {
                rpcUrl: process.env.ETHEREUM_RPC_URL || 'https://eth-mainnet.alchemyapi.io/v2/your-api-key',
                chainId: 1,
                blockConfirmations: 12
            },
            polygon: {
                rpcUrl: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',
                chainId: 137,
                blockConfirmations: 20
            },
            arbitrum: {
                rpcUrl: process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc',
                chainId: 42161,
                blockConfirmations: 1
            }
        },
        contracts: {
            settlementQueue: {
                address: process.env.SETTLEMENT_CONTRACT_ADDRESS,
                abi: [] // Will be loaded from file
            }
        },
        polling: {
            interval: 15000, // 15 seconds
            batchSize: 100
        }
    },

    // Analytics and monitoring
    analytics: {
        enabled: true,
        retention: {
            apiLogs: '30d',
            metrics: '90d',
            billing: '2y'
        },
        sampling: {
            requests: isProduction ? 0.1 : 1.0, // 10% in production
            errors: 1.0 // Always log errors
        },
        metrics: {
            buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120, 300]
        }
    },

    // Billing configuration
    billing: {
        enabled: isProduction,
        tiers: {
            free: {
                requestsPerMonth: 10000,
                rateLimitPerMinute: 100,
                features: ['basic_api', 'rest_endpoints']
            },
            pro: {
                requestsPerMonth: 1000000,
                rateLimitPerMinute: 1000,
                features: ['basic_api', 'rest_endpoints', 'graphql', 'websockets']
            },
            enterprise: {
                requestsPerMonth: -1, // unlimited
                rateLimitPerMinute: 10000,
                features: ['all']
            }
        },
        pricing: {
            free: 0,
            pro: 99, // $99/month
            enterprise: 999 // $999/month
        }
    },

    // Logging configuration
    logging: {
        level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
        format: isProduction ? 'json' : 'pretty',
        file: {
            enabled: isProduction,
            filename: 'logs/api-gateway.log',
            maxsize: 10 * 1024 * 1024, // 10MB
            maxFiles: 5,
            compress: true
        },
        console: {
            enabled: true,
            colorize: !isProduction
        }
    },

    // Performance configuration
    performance: {
        compression: {
            enabled: true,
            threshold: 1024, // compress responses > 1KB
            level: 6 // compression level (1-9)
        },
        keepAlive: {
            enabled: true,
            timeout: 65000
        },
        clustering: {
            enabled: isProduction && process.env.CLUSTER_MODE === 'true',
            workers: parseInt(process.env.CLUSTER_WORKERS) || require('os').cpus().length
        }
    }
};

/**
 * Environment-specific overrides
 */
const environmentConfigs = {
    development: {
        server: {
            host: 'localhost'
        },
        logging: {
            level: 'debug'
        },
        security: {
            cors: {
                origin: true // Allow all origins in development
            }
        }
    },

    test: {
        server: {
            port: 0 // Use random port for testing
        },
        database: {
            postgresql: {
                database: 'settlement_queue_test'
            },
            mongodb: {
                database: 'settlement_analytics_test'
            }
        },
        cache: {
            redis: {
                db: 15 // Use test database
            }
        },
        logging: {
            level: 'error' // Minimize test output
        }
    },

    production: {
        server: {
            fastify: {
                requestTimeout: 30000,
                keepAliveTimeout: 65000
            }
        },
        security: {
            cors: {
                origin: false // Restrict CORS in production
            }
        },
        performance: {
            clustering: {
                enabled: true
            }
        }
    }
};

/**
 * Merge configurations
 */
function mergeConfigs(base, override) {
    const result = { ...base };
    
    for (const key in override) {
        if (typeof override[key] === 'object' && !Array.isArray(override[key])) {
            result[key] = mergeConfigs(base[key] || {}, override[key]);
        } else {
            result[key] = override[key];
        }
    }
    
    return result;
}

// Apply environment-specific configuration
const config = mergeConfigs(baseConfig, environmentConfigs[environment] || {});

/**
 * Validate required configuration
 */
function validateConfig() {
    const required = [
        'JWT_SECRET'
    ];

    if (isProduction) {
        required.push(
            'POSTGRES_PASSWORD',
            'REDIS_PASSWORD'
        );
    }

    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
        throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
}

// Validate configuration in production
if (isProduction) {
    validateConfig();
}

export default config;