/**
 * SettlementQueue API Gateway - Production Server
 * 
 * Enterprise-grade API Gateway with:
 * - GraphQL and REST endpoints
 * - WebSocket real-time streaming
 * - API versioning and validation
 * - Authentication and authorization
 * - Rate limiting and security
 * - Monitoring and analytics
 * - Response caching and compression
 */

import Fastify from 'fastify';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

// Import configuration
import config from './config/index.js';
import logger from './utils/logger.js';

// Import plugins and middlewares
import { registerCorePlugins } from './plugins/core.js';
import { registerSecurityPlugins } from './plugins/security.js';
import { registerGraphQLPlugin } from './plugins/graphql.js';
import { registerWebSocketPlugin } from './plugins/websocket.js';
import { registerAPIRoutes } from './routes/index.js';
import { registerMiddlewares } from './middleware/index.js';

// Import services
import { DatabaseService } from './services/database.js';
import { CacheService } from './services/cache.js';
import { AuthService } from './services/auth.js';
import { AnalyticsService } from './services/analytics.js';
import { BlockchainService } from './services/blockchain.js';

/**
 * Production API Gateway Server
 */
class APIGateway {
    constructor() {
        this.fastify = null;
        this.services = {};
        this.isShuttingDown = false;
    }

    /**
     * Initialize the API Gateway server
     */
    async initialize() {
        try {
            logger.info('🚀 Initializing SettlementQueue API Gateway...');
            
            // Create Fastify instance with optimized settings
            this.fastify = Fastify({
                logger: logger,
                trustProxy: true,
                keepAliveTimeout: 30000,
                connectionTimeout: 10000,
                bodyLimit: 1048576, // 1MB
                maxParamLength: 1000,
                ignoreTrailingSlash: true,
                ignoreDuplicateSlashes: true,
                caseSensitive: false,
                requestIdHeader: 'x-request-id',
                genReqId: this.generateRequestId,
                disableRequestLogging: false,
                requestIdLogLabel: 'requestId',
                // Production optimizations
                onProtoPoisoning: 'error',
                onConstructorPoisoning: 'error',
                ...config.server.fastify
            });

            // Initialize services
            await this.initializeServices();

            // Register core plugins
            await registerCorePlugins(this.fastify);

            // Register security plugins
            await registerSecurityPlugins(this.fastify);

            // Register middlewares
            await registerMiddlewares(this.fastify, this.services);

            // Register GraphQL
            await registerGraphQLPlugin(this.fastify, this.services);

            // Register WebSocket
            await registerWebSocketPlugin(this.fastify, this.services);

            // Register API routes
            await registerAPIRoutes(this.fastify, this.services);

            // Register health checks and monitoring
            await this.registerHealthChecks();

            // Register graceful shutdown
            this.registerGracefulShutdown();

            logger.info('✅ API Gateway initialization complete');

        } catch (error) {
            logger.error('❌ Failed to initialize API Gateway:', error);
            throw error;
        }
    }

    /**
     * Initialize all services
     */
    async initializeServices() {
        logger.info('🔧 Initializing services...');

        try {
            // Initialize database service
            this.services.database = new DatabaseService(config.database);
            await this.services.database.connect();

            // Initialize cache service
            this.services.cache = new CacheService(config.cache);
            await this.services.cache.connect();

            // Initialize authentication service
            this.services.auth = new AuthService(config.auth, this.services.database);
            await this.services.auth.initialize();

            // Initialize analytics service
            this.services.analytics = new AnalyticsService(
                config.analytics, 
                this.services.database,
                this.services.cache
            );
            await this.services.analytics.initialize();

            // Initialize blockchain service
            this.services.blockchain = new BlockchainService(config.blockchain);
            await this.services.blockchain.initialize();

            logger.info('✅ All services initialized successfully');

        } catch (error) {
            logger.error('❌ Service initialization failed:', error);
            throw error;
        }
    }

    /**
     * Register health check endpoints
     */
    async registerHealthChecks() {
        // Basic health check
        this.fastify.get('/health', async (request, reply) => {
            const health = {
                status: 'healthy',
                timestamp: new Date().toISOString(),
                version: process.env.npm_package_version || '1.0.0',
                uptime: process.uptime(),
                environment: config.environment,
                requestId: request.id
            };

            return reply.code(200).send(health);
        });

        // Detailed health check
        this.fastify.get('/health/detailed', async (request, reply) => {
            const checks = await Promise.allSettled([
                this.services.database.healthCheck(),
                this.services.cache.healthCheck(),
                this.services.blockchain.healthCheck()
            ]);

            const health = {
                status: checks.every(check => check.status === 'fulfilled') ? 'healthy' : 'degraded',
                timestamp: new Date().toISOString(),
                version: process.env.npm_package_version || '1.0.0',
                uptime: process.uptime(),
                environment: config.environment,
                services: {
                    database: checks[0].status === 'fulfilled' ? 'healthy' : 'unhealthy',
                    cache: checks[1].status === 'fulfilled' ? 'healthy' : 'unhealthy',
                    blockchain: checks[2].status === 'fulfilled' ? 'healthy' : 'unhealthy'
                },
                memory: process.memoryUsage(),
                requestId: request.id
            };

            const statusCode = health.status === 'healthy' ? 200 : 503;
            return reply.code(statusCode).send(health);
        });

        // Readiness probe
        this.fastify.get('/ready', async (request, reply) => {
            if (this.isShuttingDown) {
                return reply.code(503).send({ status: 'shutting_down' });
            }

            return reply.code(200).send({ 
                status: 'ready',
                timestamp: new Date().toISOString() 
            });
        });

        // Liveness probe
        this.fastify.get('/live', async (request, reply) => {
            return reply.code(200).send({ 
                status: 'alive',
                timestamp: new Date().toISOString() 
            });
        });

        // Metrics endpoint (Prometheus format)
        this.fastify.get('/metrics', async (request, reply) => {
            const metrics = await this.services.analytics.getPrometheusMetrics();
            reply.type('text/plain').send(metrics);
        });
    }

    /**
     * Generate unique request ID
     */
    generateRequestId(req) {
        return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Register graceful shutdown handlers
     */
    registerGracefulShutdown() {
        const gracefulShutdown = async (signal) => {
            logger.info(`📴 Received ${signal}, starting graceful shutdown...`);
            this.isShuttingDown = true;

            try {
                // Stop accepting new connections
                await this.fastify.close();

                // Close services
                await Promise.all([
                    this.services.database?.disconnect(),
                    this.services.cache?.disconnect(),
                    this.services.blockchain?.disconnect()
                ]);

                logger.info('✅ Graceful shutdown completed');
                process.exit(0);

            } catch (error) {
                logger.error('❌ Error during shutdown:', error);
                process.exit(1);
            }
        };

        // Register signal handlers
        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
        process.on('SIGINT', () => gracefulShutdown('SIGINT'));
        process.on('SIGUSR2', () => gracefulShutdown('SIGUSR2')); // nodemon

        // Handle uncaught exceptions
        process.on('uncaughtException', (error) => {
            logger.error('🔥 Uncaught Exception:', error);
            gracefulShutdown('uncaughtException');
        });

        process.on('unhandledRejection', (reason, promise) => {
            logger.error('🔥 Unhandled Rejection at:', promise, 'reason:', reason);
            gracefulShutdown('unhandledRejection');
        });
    }

    /**
     * Start the server
     */
    async start() {
        try {
            const host = config.server.host || '0.0.0.0';
            const port = config.server.port || 3000;

            await this.fastify.listen({ 
                host, 
                port,
                backlog: 1024 // Increase connection queue
            });

            logger.info(`🌟 SettlementQueue API Gateway running on http://${host}:${port}`);
            logger.info(`📊 Environment: ${config.environment}`);
            logger.info(`🔍 GraphQL Playground: http://${host}:${port}/graphiql`);
            logger.info(`📖 API Documentation: http://${host}:${port}/docs`);
            logger.info(`🔧 Health Check: http://${host}:${port}/health`);

        } catch (error) {
            logger.error('❌ Failed to start server:', error);
            process.exit(1);
        }
    }

    /**
     * Get server instance (for testing)
     */
    getServer() {
        return this.fastify;
    }
}

// Start the server if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
    const gateway = new APIGateway();
    
    (async () => {
        try {
            await gateway.initialize();
            await gateway.start();
        } catch (error) {
            logger.error('💥 Failed to start API Gateway:', error);
            process.exit(1);
        }
    })();
}

export { APIGateway };
export default APIGateway;