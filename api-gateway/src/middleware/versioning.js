/**
 * API Versioning Middleware
 * Handles API versioning strategies including URL path, headers, and content negotiation
 */

import semver from 'semver';

/**
 * API Version Manager
 */
class APIVersionManager {
    constructor(config) {
        this.config = config;
        this.versions = new Map();
        this.deprecatedVersions = new Set();
        this.currentVersion = config.currentVersion || '1.0.0';
        this.defaultVersion = config.defaultVersion || '1.0.0';
        
        this.setupVersions();
    }

    /**
     * Setup available API versions
     */
    setupVersions() {
        // Define supported versions with their configurations
        const versionConfigs = [
            {
                version: '1.0.0',
                status: 'stable',
                releaseDate: '2025-01-01',
                deprecationDate: null,
                features: ['basic_orders', 'balances', 'settlements'],
                breaking_changes: [],
                migration_guide: null
            },
            {
                version: '1.1.0',
                status: 'stable',
                releaseDate: '2025-02-01',
                deprecationDate: null,
                features: ['basic_orders', 'balances', 'settlements', 'batch_orders'],
                breaking_changes: [],
                migration_guide: '/docs/migration/v1.0-to-v1.1'
            },
            {
                version: '2.0.0',
                status: 'beta',
                releaseDate: '2025-07-01',
                deprecationDate: null,
                features: ['advanced_orders', 'balances', 'settlements', 'batch_orders', 'graphql', 'websockets'],
                breaking_changes: [
                    'Order schema changed',
                    'Authentication moved to JWT',
                    'Rate limiting updated'
                ],
                migration_guide: '/docs/migration/v1.x-to-v2.0'
            }
        ];

        versionConfigs.forEach(config => {
            this.versions.set(config.version, config);
        });

        // Mark deprecated versions
        this.deprecatedVersions.add('0.9.0');
    }

    /**
     * Extract version from request
     */
    extractVersion(request) {
        // Priority order: URL path > Accept header > X-API-Version header > Query param > Default
        
        // 1. Check URL path (/api/v1/orders, /api/v2/orders)
        const pathMatch = request.url.match(/^\/api\/v(\d+(?:\.\d+)?(?:\.\d+)?)\//);
        if (pathMatch) {
            return this.normalizeVersion(pathMatch[1]);
        }

        // 2. Check Accept header (application/vnd.settlementqueue.v2+json)
        const acceptHeader = request.headers.accept;
        if (acceptHeader) {
            const acceptMatch = acceptHeader.match(/application\/vnd\.settlementqueue\.v(\d+(?:\.\d+)?(?:\.\d+)?)\+json/);
            if (acceptMatch) {
                return this.normalizeVersion(acceptMatch[1]);
            }
        }

        // 3. Check X-API-Version header
        const versionHeader = request.headers['x-api-version'];
        if (versionHeader) {
            return this.normalizeVersion(versionHeader);
        }

        // 4. Check query parameter
        const queryVersion = request.query?.version;
        if (queryVersion) {
            return this.normalizeVersion(queryVersion);
        }

        // 5. Return default version
        return this.defaultVersion;
    }

    /**
     * Normalize version string (e.g., "1" -> "1.0.0", "1.1" -> "1.1.0")
     */
    normalizeVersion(versionString) {
        if (!versionString) return this.defaultVersion;
        
        // Remove 'v' prefix if present
        const cleanVersion = versionString.replace(/^v/, '');
        
        // Handle different version formats
        const parts = cleanVersion.split('.');
        
        if (parts.length === 1) {
            return `${parts[0]}.0.0`;
        } else if (parts.length === 2) {
            return `${parts[0]}.${parts[1]}.0`;
        } else if (parts.length >= 3) {
            return `${parts[0]}.${parts[1]}.${parts[2]}`;
        }
        
        return this.defaultVersion;
    }

    /**
     * Validate version
     */
    validateVersion(version) {
        if (!semver.valid(version)) {
            throw new Error(`Invalid version format: ${version}`);
        }

        if (!this.versions.has(version)) {
            throw new Error(`Unsupported API version: ${version}`);
        }

        if (this.deprecatedVersions.has(version)) {
            throw new Error(`API version ${version} is deprecated`);
        }

        return true;
    }

    /**
     * Get version information
     */
    getVersionInfo(version) {
        return this.versions.get(version);
    }

    /**
     * Get all supported versions
     */
    getSupportedVersions() {
        return Array.from(this.versions.keys());
    }

    /**
     * Find compatible version
     */
    findCompatibleVersion(requestedVersion) {
        const available = this.getSupportedVersions();
        
        // Try exact match first
        if (available.includes(requestedVersion)) {
            return requestedVersion;
        }

        // Find highest compatible version
        const compatible = available
            .filter(v => semver.satisfies(v, `~${requestedVersion}`))
            .sort(semver.rcompare);

        return compatible[0] || this.defaultVersion;
    }

    /**
     * Check if version supports feature
     */
    supportsFeature(version, feature) {
        const versionInfo = this.getVersionInfo(version);
        return versionInfo?.features?.includes(feature) || false;
    }

    /**
     * Get deprecation warning for version
     */
    getDeprecationWarning(version) {
        const versionInfo = this.getVersionInfo(version);
        if (!versionInfo?.deprecationDate) {
            return null;
        }

        const deprecationDate = new Date(versionInfo.deprecationDate);
        const now = new Date();
        const daysUntilDeprecation = Math.ceil((deprecationDate - now) / (1000 * 60 * 60 * 24));

        if (daysUntilDeprecation <= 0) {
            return {
                level: 'error',
                message: `API version ${version} is deprecated and no longer supported`,
                action: 'upgrade_required'
            };
        } else if (daysUntilDeprecation <= 30) {
            return {
                level: 'warning',
                message: `API version ${version} will be deprecated in ${daysUntilDeprecation} days`,
                action: 'upgrade_recommended',
                migration_guide: versionInfo.migration_guide
            };
        }

        return null;
    }
}

/**
 * Version resolution middleware
 */
export function createVersioningMiddleware(config = {}) {
    const versionManager = new APIVersionManager(config);

    return async function versioningMiddleware(request, reply) {
        try {
            // Extract requested version
            const requestedVersion = versionManager.extractVersion(request);
            
            // Validate version
            versionManager.validateVersion(requestedVersion);
            
            // Find compatible version
            const resolvedVersion = versionManager.findCompatibleVersion(requestedVersion);
            
            // Get version info
            const versionInfo = versionManager.getVersionInfo(resolvedVersion);
            
            // Set version context
            request.apiVersion = {
                requested: requestedVersion,
                resolved: resolvedVersion,
                info: versionInfo,
                manager: versionManager
            };

            // Add version headers to response
            reply.header('X-API-Version', resolvedVersion);
            reply.header('X-API-Version-Requested', requestedVersion);
            
            // Check for deprecation warnings
            const deprecationWarning = versionManager.getDeprecationWarning(resolvedVersion);
            if (deprecationWarning) {
                reply.header('X-API-Deprecation-Warning', deprecationWarning.message);
                reply.header('X-API-Migration-Guide', deprecationWarning.migration_guide || '');
                
                if (deprecationWarning.level === 'error') {
                    return reply.code(410).send({
                        error: 'VERSION_DEPRECATED',
                        message: deprecationWarning.message,
                        migration_guide: deprecationWarning.migration_guide,
                        supported_versions: versionManager.getSupportedVersions()
                    });
                }
            }

            // Add version links to response
            reply.header('Link', versionManager.getSupportedVersions()
                .map(v => `</api/v${v.split('.')[0]}>; rel="version"; version="${v}"`)
                .join(', '));

        } catch (error) {
            return reply.code(400).send({
                error: 'VERSION_ERROR',
                message: error.message,
                supported_versions: versionManager.getSupportedVersions(),
                default_version: versionManager.defaultVersion
            });
        }
    };
}

/**
 * Version-specific routing middleware
 */
export function createVersionRoutingMiddleware() {
    return async function versionRoutingMiddleware(request, reply) {
        const version = request.apiVersion?.resolved;
        if (!version) return;

        // Modify request URL to include version-specific routing
        const majorVersion = semver.major(version);
        
        // Rewrite URL to include version prefix if not already present
        if (!request.url.includes(`/v${majorVersion}/`)) {
            const urlParts = request.url.split('/');
            if (urlParts[1] === 'api' && !urlParts[2].startsWith('v')) {
                urlParts.splice(2, 0, `v${majorVersion}`);
                request.url = urlParts.join('/');
            }
        }
    };
}

/**
 * Response format middleware based on version
 */
export function createVersionResponseMiddleware() {
    return async function versionResponseMiddleware(request, reply) {
        const version = request.apiVersion?.resolved;
        if (!version) return;

        // Version-specific response transformations
        const originalSend = reply.send;
        
        reply.send = function(payload) {
            // Transform response based on API version
            if (payload && typeof payload === 'object') {
                const transformedPayload = transformResponseForVersion(payload, version);
                return originalSend.call(this, transformedPayload);
            }
            
            return originalSend.call(this, payload);
        };
    };
}

/**
 * Transform response payload based on API version
 */
function transformResponseForVersion(payload, version) {
    const majorVersion = semver.major(version);
    
    switch (majorVersion) {
        case 1:
            return transformV1Response(payload);
        case 2:
            return transformV2Response(payload);
        default:
            return payload;
    }
}

/**
 * V1 response transformation
 */
function transformV1Response(payload) {
    // V1 specific transformations
    if (payload.data && payload.data.order) {
        const order = payload.data.order;
        
        // V1 uses different field names
        if (order.userAddress) {
            order.user_address = order.userAddress;
            delete order.userAddress;
        }
        
        if (order.tokenIn) {
            order.token_in = order.tokenIn;
            delete order.tokenIn;
        }
        
        if (order.tokenOut) {
            order.token_out = order.tokenOut;
            delete order.tokenOut;
        }
        
        if (order.amountIn) {
            order.amount_in = order.amountIn;
            delete order.amountIn;
        }
        
        if (order.minAmountOut) {
            order.min_amount_out = order.minAmountOut;
            delete order.minAmountOut;
        }
        
        if (order.createdAt) {
            order.created_at = order.createdAt;
            delete order.createdAt;
        }
        
        if (order.updatedAt) {
            order.updated_at = order.updatedAt;
            delete order.updatedAt;
        }
    }
    
    return payload;
}

/**
 * V2 response transformation
 */
function transformV2Response(payload) {
    // V2 uses camelCase and includes additional metadata
    if (payload.data) {
        payload.meta = {
            version: '2.0.0',
            timestamp: new Date().toISOString(),
            request_id: payload.request_id || undefined
        };
    }
    
    return payload;
}

/**
 * Feature flag middleware
 */
export function createFeatureFlagMiddleware() {
    return async function featureFlagMiddleware(request, reply) {
        const version = request.apiVersion?.resolved;
        const manager = request.apiVersion?.manager;
        
        if (!version || !manager) return;
        
        // Add feature check helper to request
        request.supportsFeature = (feature) => {
            return manager.supportsFeature(version, feature);
        };
        
        // Add version-specific utilities
        request.versionUtils = {
            isV1: () => semver.major(version) === 1,
            isV2: () => semver.major(version) === 2,
            isV2OrHigher: () => semver.gte(version, '2.0.0'),
            getVersion: () => version,
            getMajorVersion: () => semver.major(version),
            getMinorVersion: () => semver.minor(version),
            getPatchVersion: () => semver.patch(version)
        };
    };
}

/**
 * API versioning documentation middleware
 */
export function createVersionDocumentationMiddleware() {
    return async function versionDocumentationMiddleware(request, reply) {
        // Add version information to API documentation
        if (request.url === '/api/versions' || request.url === '/versions') {
            const version = request.apiVersion?.resolved;
            const manager = request.apiVersion?.manager;
            
            if (manager) {
                const versions = manager.getSupportedVersions().map(v => {
                    const info = manager.getVersionInfo(v);
                    return {
                        version: v,
                        status: info.status,
                        release_date: info.releaseDate,
                        deprecation_date: info.deprecationDate,
                        features: info.features,
                        breaking_changes: info.breaking_changes,
                        migration_guide: info.migration_guide,
                        endpoints: {
                            rest: `/api/v${semver.major(v)}/`,
                            graphql: `/graphql?version=${v}`,
                            websocket: `/ws?version=${v}`
                        }
                    };
                });
                
                return reply.send({
                    success: true,
                    data: {
                        current_version: manager.currentVersion,
                        default_version: manager.defaultVersion,
                        requested_version: version,
                        supported_versions: versions
                    }
                });
            }
        }
    };
}

/**
 * Complete versioning plugin registration
 */
export async function registerVersioningMiddleware(fastify, config = {}) {
    // Register all versioning middlewares
    await fastify.register(async function (fastify) {
        fastify.addHook('preHandler', createVersioningMiddleware(config));
        fastify.addHook('preHandler', createVersionRoutingMiddleware());
        fastify.addHook('preHandler', createVersionResponseMiddleware());
        fastify.addHook('preHandler', createFeatureFlagMiddleware());
        fastify.addHook('preHandler', createVersionDocumentationMiddleware());
    });

    fastify.log.info('✅ API versioning middleware registered successfully');
}

export default {
    createVersioningMiddleware,
    createVersionRoutingMiddleware,
    createVersionResponseMiddleware,
    createFeatureFlagMiddleware,
    createVersionDocumentationMiddleware,
    registerVersioningMiddleware,
    APIVersionManager
};