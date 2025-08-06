/**
 * Performance Optimization Middleware
 * Response compression, caching, and performance monitoring
 */

import compression from 'compression';
import NodeCache from 'node-cache';
import crypto from 'crypto';
import { promisify } from 'util';

/**
 * Multi-level caching service
 */
class CacheService {
    constructor(config = {}) {
        this.config = {
            memory: {
                stdTTL: 300, // 5 minutes
                checkperiod: 60, // Check for expired keys every minute
                maxKeys: 10000,
                deleteOnExpire: true,
                ...config.memory
            },
            redis: config.redis,
            ...config
        };

        // Initialize memory cache
        this.memoryCache = new NodeCache(this.config.memory);
        
        // Redis cache (will be injected)
        this.redisCache = null;
        
        // Cache statistics
        this.stats = {
            hits: 0,
            misses: 0,
            sets: 0,
            deletes: 0,
            errors: 0
        };

        this.setupCacheEvents();
    }

    /**
     * Setup cache event handlers
     */
    setupCacheEvents() {
        this.memoryCache.on('expired', (key, value) => {
            this.emit('expired', { key, value, level: 'memory' });
        });

        this.memoryCache.on('set', (key, value) => {
            this.stats.sets++;
        });

        this.memoryCache.on('del', (key, value) => {
            this.stats.deletes++;
        });
    }

    /**
     * Set Redis cache instance
     */
    setRedisCache(redisCache) {
        this.redisCache = redisCache;
    }

    /**
     * Generate cache key
     */
    generateKey(prefix, data) {
        const dataString = typeof data === 'object' ? JSON.stringify(data) : String(data);
        const hash = crypto.createHash('md5').update(dataString).digest('hex');
        return `${prefix}:${hash}`;
    }

    /**
     * Get from cache with fallback strategy
     */
    async get(key, options = {}) {
        const { 
            useMemory = true, 
            useRedis = true,
            deserialize = true 
        } = options;

        try {
            // Try memory cache first (fastest)
            if (useMemory) {
                const memoryValue = this.memoryCache.get(key);
                if (memoryValue !== undefined) {
                    this.stats.hits++;
                    return deserialize && typeof memoryValue === 'string' ? 
                           JSON.parse(memoryValue) : memoryValue;
                }
            }

            // Try Redis cache (slower but persistent)
            if (useRedis && this.redisCache) {
                const redisValue = await this.redisCache.get(key);
                if (redisValue !== null) {
                    this.stats.hits++;
                    
                    // Populate memory cache
                    if (useMemory) {
                        this.memoryCache.set(key, redisValue, this.config.memory.stdTTL);
                    }
                    
                    return deserialize ? JSON.parse(redisValue) : redisValue;
                }
            }

            this.stats.misses++;
            return null;

        } catch (error) {
            this.stats.errors++;
            console.error('Cache get error:', error);
            return null;
        }
    }

    /**
     * Set in cache with multi-level strategy
     */
    async set(key, value, ttl = null, options = {}) {
        const {
            useMemory = true,
            useRedis = true,
            serialize = true
        } = options;

        try {
            const serializedValue = serialize ? JSON.stringify(value) : value;
            const finalTTL = ttl || this.config.memory.stdTTL;

            // Set in memory cache
            if (useMemory) {
                this.memoryCache.set(key, serializedValue, finalTTL);
            }

            // Set in Redis cache
            if (useRedis && this.redisCache) {
                await this.redisCache.setex(key, finalTTL, serializedValue);
            }

            this.stats.sets++;
            return true;

        } catch (error) {
            this.stats.errors++;
            console.error('Cache set error:', error);
            return false;
        }
    }

    /**
     * Delete from cache
     */
    async delete(key, options = {}) {
        const { useMemory = true, useRedis = true } = options;

        try {
            let deleted = false;

            if (useMemory) {
                deleted = this.memoryCache.del(key) > 0 || deleted;
            }

            if (useRedis && this.redisCache) {
                const redisDeleted = await this.redisCache.del(key);
                deleted = redisDeleted > 0 || deleted;
            }

            if (deleted) {
                this.stats.deletes++;
            }

            return deleted;

        } catch (error) {
            this.stats.errors++;
            console.error('Cache delete error:', error);
            return false;
        }
    }

    /**
     * Clear cache with pattern
     */
    async clear(pattern = null) {
        try {
            if (pattern) {
                // Clear memory cache with pattern
                const keys = this.memoryCache.keys();
                const matchingKeys = keys.filter(key => 
                    new RegExp(pattern.replace('*', '.*')).test(key)
                );
                this.memoryCache.del(matchingKeys);

                // Clear Redis cache with pattern
                if (this.redisCache) {
                    const redisKeys = await this.redisCache.keys(pattern);
                    if (redisKeys.length > 0) {
                        await this.redisCache.del(redisKeys);
                    }
                }
            } else {
                // Clear all
                this.memoryCache.flushAll();
                if (this.redisCache) {
                    await this.redisCache.flushdb();
                }
            }

            return true;

        } catch (error) {
            this.stats.errors++;
            console.error('Cache clear error:', error);
            return false;
        }
    }

    /**
     * Get cache statistics
     */
    getStats() {
        const memoryStats = this.memoryCache.getStats();
        
        return {
            ...this.stats,
            memory: {
                keys: memoryStats.keys,
                hits: memoryStats.hits,
                misses: memoryStats.misses,
                ksize: memoryStats.ksize,
                vsize: memoryStats.vsize
            },
            hitRate: this.stats.hits / (this.stats.hits + this.stats.misses) || 0
        };
    }

    /**
     * Cache with callback (get or set)
     */
    async wrap(key, fetchFunction, ttl = null, options = {}) {
        // Try to get from cache first
        const cached = await this.get(key, options);
        if (cached !== null) {
            return cached;
        }

        // Execute fetch function
        try {
            const result = await fetchFunction();
            await this.set(key, result, ttl, options);
            return result;
        } catch (error) {
            throw error;
        }
    }
}

/**
 * Response compression middleware
 */
export function createCompressionMiddleware(options = {}) {
    const config = {
        threshold: 1024, // Compress responses > 1KB
        level: 6, // Compression level (1-9)
        filter: (req, res) => {
            // Don't compress images, videos, or already compressed content
            const contentType = res.getHeader('content-type');
            if (!contentType) return false;
            
            const compressibleTypes = [
                'text/',
                'application/json',
                'application/javascript',
                'application/xml',
                'application/rss+xml',
                'application/atom+xml'
            ];
            
            return compressibleTypes.some(type => contentType.includes(type));
        },
        ...options
    };

    return compression(config);
}

/**
 * Response caching middleware
 */
export function createResponseCacheMiddleware(cacheService, options = {}) {
    const config = {
        ttl: 300, // 5 minutes default
        keyGenerator: (request) => {
            const url = request.url;
            const method = request.method;
            const userId = request.user?.address || 'anonymous';
            return `response:${method}:${url}:${userId}`;
        },
        skipCache: (request, reply) => {
            // Skip caching for non-GET requests
            if (request.method !== 'GET') return true;
            
            // Skip caching for authenticated requests to sensitive endpoints
            if (request.url.includes('/balance') || 
                request.url.includes('/orders') ||
                request.url.includes('/user')) {
                return !!request.user;
            }
            
            return false;
        },
        ...options
    };

    return async function responseCacheMiddleware(request, reply) {
        // Skip caching if conditions met
        if (config.skipCache(request, reply)) {
            return;
        }

        const cacheKey = config.keyGenerator(request);
        
        // Try to get cached response
        const cached = await cacheService.get(cacheKey);
        if (cached) {
            // Set cache headers
            reply.header('X-Cache', 'HIT');
            reply.header('X-Cache-Key', cacheKey);
            
            // Send cached response
            return reply.send(cached);
        }

        // Intercept response to cache it
        const originalSend = reply.send;
        reply.send = function(payload) {
            // Cache successful responses
            if (reply.statusCode >= 200 && reply.statusCode < 300) {
                cacheService.set(cacheKey, payload, config.ttl).catch(err => {
                    console.error('Failed to cache response:', err);
                });
            }
            
            // Set cache headers
            reply.header('X-Cache', 'MISS');
            reply.header('X-Cache-Key', cacheKey);
            
            return originalSend.call(this, payload);
        };
    };
}

/**
 * ETags middleware for conditional requests
 */
export function createETagsMiddleware(options = {}) {
    const config = {
        algorithm: 'md5',
        weak: false,
        ...options
    };

    return async function etagsMiddleware(request, reply) {
        // Only handle GET and HEAD requests
        if (!['GET', 'HEAD'].includes(request.method)) {
            return;
        }

        const originalSend = reply.send;
        reply.send = function(payload) {
            if (payload && reply.statusCode >= 200 && reply.statusCode < 300) {
                // Generate ETag
                const payloadString = typeof payload === 'string' ? 
                                    payload : JSON.stringify(payload);
                const hash = crypto.createHash(config.algorithm)
                                 .update(payloadString)
                                 .digest('hex');
                const etag = config.weak ? `W/"${hash}"` : `"${hash}"`;
                
                // Set ETag header
                reply.header('ETag', etag);
                
                // Check If-None-Match header
                const ifNoneMatch = request.headers['if-none-match'];
                if (ifNoneMatch === etag) {
                    return reply.code(304).send();
                }
            }
            
            return originalSend.call(this, payload);
        };
    };
}

/**
 * Performance monitoring middleware
 */
export function createPerformanceMonitoringMiddleware(analyticsService) {
    return async function performanceMonitoringMiddleware(request, reply) {
        const startTime = process.hrtime.bigint();
        
        // Track request start
        request.startTime = startTime;
        
        // Add response time tracking
        reply.addHook('onSend', async (request, reply, payload) => {
            const endTime = process.hrtime.bigint();
            const responseTime = Number(endTime - startTime) / 1000000; // Convert to ms
            
            // Set response time header
            reply.header('X-Response-Time', `${responseTime.toFixed(2)}ms`);
            
            // Track performance metrics
            if (analyticsService) {
                await analyticsService.trackPerformance({
                    method: request.method,
                    url: request.url,
                    statusCode: reply.statusCode,
                    responseTime,
                    contentLength: payload ? Buffer.byteLength(payload, 'utf8') : 0,
                    userId: request.user?.address,
                    userAgent: request.headers['user-agent'],
                    timestamp: new Date()
                });
            }
            
            return payload;
        });
    };
}

/**
 * Static content caching middleware
 */
export function createStaticCacheMiddleware(options = {}) {
    const config = {
        maxAge: 86400, // 24 hours for static content
        immutable: false,
        ...options
    };

    const staticExtensions = [
        '.js', '.css', '.png', '.jpg', '.jpeg', '.gif', '.svg', 
        '.ico', '.woff', '.woff2', '.ttf', '.eot'
    ];

    return async function staticCacheMiddleware(request, reply) {
        const url = request.url.split('?')[0]; // Remove query parameters
        const isStatic = staticExtensions.some(ext => url.endsWith(ext));
        
        if (isStatic) {
            // Set cache headers for static content
            reply.header('Cache-Control', 
                `public, max-age=${config.maxAge}${config.immutable ? ', immutable' : ''}`);
            reply.header('Expires', new Date(Date.now() + config.maxAge * 1000).toUTCString());
        } else {
            // Set no-cache headers for dynamic content
            reply.header('Cache-Control', 'no-cache, no-store, must-revalidate');
            reply.header('Pragma', 'no-cache');
            reply.header('Expires', '0');
        }
    };
}

/**
 * Request/Response size monitoring
 */
export function createSizeMonitoringMiddleware(options = {}) {
    const config = {
        logLargeRequests: true,
        logLargeResponses: true,
        largeRequestThreshold: 1048576, // 1MB
        largeResponseThreshold: 1048576, // 1MB
        ...options
    };

    return async function sizeMonitoringMiddleware(request, reply) {
        // Monitor request size
        if (request.body) {
            const requestSize = JSON.stringify(request.body).length;
            request.requestSize = requestSize;
            
            if (config.logLargeRequests && requestSize > config.largeRequestThreshold) {
                console.warn(`Large request detected: ${requestSize} bytes for ${request.method} ${request.url}`);
            }
        }

        // Monitor response size
        const originalSend = reply.send;
        reply.send = function(payload) {
            if (payload) {
                const responseSize = Buffer.byteLength(JSON.stringify(payload), 'utf8');
                reply.header('X-Response-Size', responseSize);
                
                if (config.logLargeResponses && responseSize > config.largeResponseThreshold) {
                    console.warn(`Large response detected: ${responseSize} bytes for ${request.method} ${request.url}`);
                }
            }
            
            return originalSend.call(this, payload);
        };
    };
}

/**
 * Memory usage monitoring
 */
export function createMemoryMonitoringMiddleware(options = {}) {
    const config = {
        logInterval: 60000, // Log every minute
        warningThreshold: 0.8, // 80% memory usage
        ...options
    };

    let lastLogTime = 0;

    return async function memoryMonitoringMiddleware(request, reply) {
        const now = Date.now();
        
        if (now - lastLogTime > config.logInterval) {
            const memUsage = process.memoryUsage();
            const totalMemory = require('os').totalmem();
            const usagePercent = memUsage.rss / totalMemory;
            
            if (usagePercent > config.warningThreshold) {
                console.warn(`High memory usage detected: ${(usagePercent * 100).toFixed(2)}%`, {
                    rss: Math.round(memUsage.rss / 1024 / 1024),
                    heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
                    heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
                    external: Math.round(memUsage.external / 1024 / 1024)
                });
            }
            
            lastLogTime = now;
        }
    };
}

/**
 * Complete performance middleware registration
 */
export async function registerPerformanceMiddleware(fastify, services, config = {}) {
    // Initialize cache service
    const cacheService = new CacheService(config.cache);
    if (services.cache) {
        cacheService.setRedisCache(services.cache);
    }
    
    // Add cache service to services
    services.responseCache = cacheService;

    // Register compression
    if (config.compression?.enabled !== false) {
        await fastify.register(import('@fastify/compress'), {
            threshold: config.compression?.threshold || 1024,
            encodings: ['gzip', 'deflate'],
            ...config.compression
        });
    }

    // Register performance monitoring
    fastify.addHook('preHandler', createPerformanceMonitoringMiddleware(services.analytics));
    
    // Register response caching
    if (config.responseCache?.enabled !== false) {
        fastify.addHook('preHandler', createResponseCacheMiddleware(cacheService, config.responseCache));
    }
    
    // Register ETags
    if (config.etags?.enabled !== false) {
        fastify.addHook('preHandler', createETagsMiddleware(config.etags));
    }
    
    // Register static content caching
    if (config.staticCache?.enabled !== false) {
        fastify.addHook('preHandler', createStaticCacheMiddleware(config.staticCache));
    }
    
    // Register size monitoring
    if (config.sizeMonitoring?.enabled !== false) {
        fastify.addHook('preHandler', createSizeMonitoringMiddleware(config.sizeMonitoring));
    }
    
    // Register memory monitoring
    if (config.memoryMonitoring?.enabled !== false) {
        fastify.addHook('preHandler', createMemoryMonitoringMiddleware(config.memoryMonitoring));
    }

    // Cache management endpoints
    fastify.register(async function (fastify) {
        // Cache stats endpoint
        fastify.get('/admin/cache/stats', {
            preHandler: [fastify.authenticate, fastify.requireAdmin]
        }, async (request, reply) => {
            const stats = cacheService.getStats();
            return reply.send({
                success: true,
                data: stats
            });
        });

        // Clear cache endpoint
        fastify.delete('/admin/cache', {
            preHandler: [fastify.authenticate, fastify.requireAdmin]
        }, async (request, reply) => {
            const { pattern } = request.query;
            await cacheService.clear(pattern);
            
            return reply.send({
                success: true,
                message: pattern ? `Cache cleared for pattern: ${pattern}` : 'All cache cleared'
            });
        });
    });

    // Add performance utilities to fastify instance
    fastify.decorate('performance', {
        cache: cacheService,
        clearCache: (pattern) => cacheService.clear(pattern),
        getCacheStats: () => cacheService.getStats(),
        setCache: (key, value, ttl) => cacheService.set(key, value, ttl),
        getCache: (key) => cacheService.get(key)
    });

    fastify.log.info('✅ Performance middleware registered successfully');
}

export default {
    CacheService,
    createCompressionMiddleware,
    createResponseCacheMiddleware,
    createETagsMiddleware,
    createPerformanceMonitoringMiddleware,
    createStaticCacheMiddleware,
    createSizeMonitoringMiddleware,
    createMemoryMonitoringMiddleware,
    registerPerformanceMiddleware
};