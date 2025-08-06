/**
 * Request Validation and Sanitization Middleware
 * Comprehensive input validation, sanitization, and security controls
 */

import Joi from 'joi';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import DOMPurify from 'isomorphic-dompurify';
import { rateLimit } from '@fastify/rate-limit';
import crypto from 'crypto';

/**
 * Validation service with multiple validation engines
 */
class ValidationService {
    constructor(config = {}) {
        this.config = {
            stripUnknown: true,
            abortEarly: false,
            allowUnknown: false,
            convert: true,
            ...config
        };
        
        // Initialize AJV with formats
        this.ajv = new Ajv({
            allErrors: true,
            removeAdditional: this.config.stripUnknown,
            coerceTypes: this.config.convert,
            useDefaults: true
        });
        addFormats(this.ajv);
        
        // Add custom formats
        this.setupCustomFormats();
        
        // Validation cache for performance
        this.validationCache = new Map();
        this.cacheMaxSize = 1000;
    }

    /**
     * Setup custom validation formats
     */
    setupCustomFormats() {
        // Ethereum address format
        this.ajv.addFormat('ethereum-address', {
            type: 'string',
            validate: (data) => /^0x[a-fA-F0-9]{40}$/.test(data)
        });

        // Transaction hash format
        this.ajv.addFormat('transaction-hash', {
            type: 'string',
            validate: (data) => /^0x[a-fA-F0-9]{64}$/.test(data)
        });

        // BigInt string format
        this.ajv.addFormat('bigint-string', {
            type: 'string',
            validate: (data) => {
                try {
                    BigInt(data);
                    return true;
                } catch {
                    return false;
                }
            }
        });

        // Safe HTML format
        this.ajv.addFormat('safe-html', {
            type: 'string',
            validate: (data) => {
                const sanitized = DOMPurify.sanitize(data);
                return sanitized === data;
            }
        });

        // API key format
        this.ajv.addFormat('api-key', {
            type: 'string',
            validate: (data) => /^sq_[a-zA-Z0-9]{32}$/.test(data)
        });

        // Order status enum
        this.ajv.addFormat('order-status', {
            type: 'string',
            validate: (data) => ['PENDING', 'COMMITTED', 'REVEALED', 'PROCESSING', 'COMPLETED', 'CANCELLED', 'FAILED'].includes(data)
        });

        // Chain ID format
        this.ajv.addFormat('chain-id', {
            type: 'integer',
            validate: (data) => data > 0 && data <= 2147483647 // Max int32
        });
    }

    /**
     * Validate data using Joi schema
     */
    async validateWithJoi(data, schema, options = {}) {
        const validationOptions = {
            ...this.config,
            ...options
        };

        try {
            const result = await schema.validateAsync(data, validationOptions);
            return { isValid: true, value: result, errors: null };
        } catch (error) {
            return {
                isValid: false,
                value: null,
                errors: error.details.map(detail => ({
                    field: detail.path.join('.'),
                    message: detail.message,
                    value: detail.context?.value
                }))
            };
        }
    }

    /**
     * Validate data using JSON Schema (AJV)
     */
    validateWithJsonSchema(data, schema, options = {}) {
        const cacheKey = this.generateCacheKey(schema);
        
        // Get or compile validator
        let validate = this.validationCache.get(cacheKey);
        if (!validate) {
            validate = this.ajv.compile(schema);
            
            // Cache management
            if (this.validationCache.size >= this.cacheMaxSize) {
                const firstKey = this.validationCache.keys().next().value;
                this.validationCache.delete(firstKey);
            }
            
            this.validationCache.set(cacheKey, validate);
        }

        const isValid = validate(data);
        
        return {
            isValid,
            value: isValid ? data : null,
            errors: isValid ? null : validate.errors.map(error => ({
                field: error.instancePath.substring(1) || error.schemaPath.split('/').pop(),
                message: error.message,
                value: error.data,
                constraint: error.params
            }))
        };
    }

    /**
     * Generate cache key for schema
     */
    generateCacheKey(schema) {
        return crypto.createHash('md5').update(JSON.stringify(schema)).digest('hex');
    }

    /**
     * Sanitize input data
     */
    sanitizeInput(data, options = {}) {
        if (typeof data === 'string') {
            return this.sanitizeString(data, options);
        } else if (Array.isArray(data)) {
            return data.map(item => this.sanitizeInput(item, options));
        } else if (data && typeof data === 'object') {
            return this.sanitizeObject(data, options);
        }
        
        return data;
    }

    /**
     * Sanitize string input
     */
    sanitizeString(str, options = {}) {
        if (typeof str !== 'string') return str;

        // Trim whitespace
        let sanitized = str.trim();

        // Remove null bytes
        sanitized = sanitized.replace(/\0/g, '');

        // Handle HTML content
        if (options.allowHtml) {
            sanitized = DOMPurify.sanitize(sanitized, {
                ALLOWED_TAGS: options.allowedTags || ['b', 'i', 'em', 'strong'],
                ALLOWED_ATTR: options.allowedAttributes || []
            });
        } else {
            // Escape HTML entities
            sanitized = sanitized
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#x27;');
        }

        // Remove control characters except newlines and tabs
        sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

        // Limit length
        if (options.maxLength && sanitized.length > options.maxLength) {
            sanitized = sanitized.substring(0, options.maxLength);
        }

        return sanitized;
    }

    /**
     * Sanitize object recursively
     */
    sanitizeObject(obj, options = {}) {
        if (!obj || typeof obj !== 'object') return obj;

        const sanitized = {};
        const allowedKeys = options.allowedKeys;

        for (const [key, value] of Object.entries(obj)) {
            // Check if key is allowed
            if (allowedKeys && !allowedKeys.includes(key)) {
                continue;
            }

            // Sanitize key name
            const sanitizedKey = this.sanitizeString(key, { maxLength: 100 });
            
            // Recursively sanitize value
            sanitized[sanitizedKey] = this.sanitizeInput(value, options);
        }

        return sanitized;
    }

    /**
     * Validate Ethereum address
     */
    validateEthereumAddress(address) {
        if (typeof address !== 'string') {
            return { isValid: false, error: 'Address must be a string' };
        }

        if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
            return { isValid: false, error: 'Invalid address format' };
        }

        // EIP-55 checksum validation
        if (this.isChecksumAddress(address) && !this.validateChecksum(address)) {
            return { isValid: false, error: 'Invalid address checksum' };
        }

        return { isValid: true, address: address.toLowerCase() };
    }

    /**
     * Check if address has checksum
     */
    isChecksumAddress(address) {
        return address !== address.toLowerCase() && address !== address.toUpperCase();
    }

    /**
     * Validate EIP-55 checksum
     */
    validateChecksum(address) {
        const cleanAddress = address.slice(2);
        const hash = crypto.createHash('keccak256').update(cleanAddress.toLowerCase()).digest('hex');
        
        for (let i = 0; i < cleanAddress.length; i++) {
            const char = cleanAddress[i];
            if (isNaN(parseInt(char, 16))) continue;
            
            const shouldBeUppercase = parseInt(hash[i], 16) >= 8;
            if ((shouldBeUppercase && char !== char.toUpperCase()) ||
                (!shouldBeUppercase && char !== char.toLowerCase())) {
                return false;
            }
        }
        
        return true;
    }

    /**
     * Validate amount string
     */
    validateAmount(amount, options = {}) {
        if (typeof amount !== 'string' && typeof amount !== 'number') {
            return { isValid: false, error: 'Amount must be string or number' };
        }

        try {
            const parsed = BigInt(amount);
            
            if (parsed < 0n) {
                return { isValid: false, error: 'Amount cannot be negative' };
            }

            if (options.min && parsed < BigInt(options.min)) {
                return { isValid: false, error: `Amount must be at least ${options.min}` };
            }

            if (options.max && parsed > BigInt(options.max)) {
                return { isValid: false, error: `Amount must not exceed ${options.max}` };
            }

            return { isValid: true, amount: parsed.toString() };
        } catch (error) {
            return { isValid: false, error: 'Invalid amount format' };
        }
    }

    /**
     * Validate signature
     */
    validateSignature(signature) {
        if (typeof signature !== 'string') {
            return { isValid: false, error: 'Signature must be a string' };
        }

        if (!/^0x[a-fA-F0-9]{130}$/.test(signature)) {
            return { isValid: false, error: 'Invalid signature format' };
        }

        return { isValid: true, signature };
    }
}

/**
 * Common validation schemas using Joi
 */
export const JoiSchemas = {
    // Ethereum address
    ethereumAddress: Joi.string()
        .pattern(/^0x[a-fA-F0-9]{40}$/)
        .required()
        .messages({
            'string.pattern.base': 'Invalid Ethereum address format'
        }),

    // Transaction hash
    transactionHash: Joi.string()
        .pattern(/^0x[a-fA-F0-9]{64}$/)
        .required()
        .messages({
            'string.pattern.base': 'Invalid transaction hash format'
        }),

    // BigInt amount
    bigIntAmount: Joi.string()
        .custom((value, helpers) => {
            try {
                const parsed = BigInt(value);
                if (parsed < 0n) {
                    return helpers.error('any.invalid');
                }
                return value;
            } catch {
                return helpers.error('any.invalid');
            }
        })
        .required()
        .messages({
            'any.invalid': 'Invalid amount format'
        }),

    // Order priority
    orderPriority: Joi.number()
        .integer()
        .min(1)
        .max(1000)
        .default(100),

    // Chain ID
    chainId: Joi.number()
        .integer()
        .min(1)
        .max(2147483647)
        .default(1),

    // Pagination
    pagination: Joi.object({
        page: Joi.number().integer().min(1).default(1),
        limit: Joi.number().integer().min(1).max(100).default(20),
        sortBy: Joi.string().valid('createdAt', 'updatedAt', 'priority', 'amount').default('createdAt'),
        sortOrder: Joi.string().valid('asc', 'desc').default('desc')
    }),

    // Date range
    dateRange: Joi.object({
        from: Joi.date().iso(),
        to: Joi.date().iso().greater(Joi.ref('from'))
    }),

    // API key
    apiKey: Joi.string()
        .pattern(/^sq_[a-zA-Z0-9]{32}$/)
        .required()
        .messages({
            'string.pattern.base': 'Invalid API key format'
        }),

    // Order submission
    submitOrder: Joi.object({
        tokenIn: Joi.ref('#ethereumAddress'),
        tokenOut: Joi.ref('#ethereumAddress'),
        amountIn: Joi.ref('#bigIntAmount'),
        minAmountOut: Joi.ref('#bigIntAmount'),
        deadline: Joi.date().iso().greater('now').required(),
        priority: Joi.ref('#orderPriority'),
        chainId: Joi.ref('#chainId'),
        signature: Joi.string().pattern(/^0x[a-fA-F0-9]{130}$/).required(),
        nonce: Joi.ref('#bigIntAmount'),
        metadata: Joi.object().optional()
    }).custom((value, helpers) => {
        // Ensure tokenIn and tokenOut are different
        if (value.tokenIn.toLowerCase() === value.tokenOut.toLowerCase()) {
            return helpers.error('custom.sameTokens');
        }
        return value;
    }).messages({
        'custom.sameTokens': 'Token in and token out cannot be the same'
    })
};

/**
 * JSON Schema definitions
 */
export const JsonSchemas = {
    // Submit order schema
    submitOrder: {
        type: 'object',
        required: ['tokenIn', 'tokenOut', 'amountIn', 'minAmountOut', 'deadline', 'signature', 'nonce'],
        properties: {
            tokenIn: { type: 'string', format: 'ethereum-address' },
            tokenOut: { type: 'string', format: 'ethereum-address' },
            amountIn: { type: 'string', format: 'bigint-string' },
            minAmountOut: { type: 'string', format: 'bigint-string' },
            deadline: { type: 'string', format: 'date-time' },
            priority: { type: 'integer', minimum: 1, maximum: 1000, default: 100 },
            chainId: { type: 'integer', format: 'chain-id', default: 1 },
            signature: { type: 'string', pattern: '^0x[a-fA-F0-9]{130}$' },
            nonce: { type: 'string', format: 'bigint-string' },
            metadata: { type: 'object', additionalProperties: true }
        },
        additionalProperties: false
    },

    // Get orders query
    getOrdersQuery: {
        type: 'object',
        properties: {
            status: { type: 'string', format: 'order-status' },
            tokenIn: { type: 'string', format: 'ethereum-address' },
            tokenOut: { type: 'string', format: 'ethereum-address' },
            minAmount: { type: 'string', format: 'bigint-string' },
            maxAmount: { type: 'string', format: 'bigint-string' },
            createdAfter: { type: 'string', format: 'date-time' },
            createdBefore: { type: 'string', format: 'date-time' },
            page: { type: 'integer', minimum: 1, default: 1 },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
            sortBy: { type: 'string', enum: ['createdAt', 'updatedAt', 'priority', 'amount'], default: 'createdAt' },
            sortOrder: { type: 'string', enum: ['asc', 'desc'], default: 'desc' }
        },
        additionalProperties: false
    },

    // Authentication
    login: {
        type: 'object',
        required: ['address', 'signature', 'message', 'nonce'],
        properties: {
            address: { type: 'string', format: 'ethereum-address' },
            signature: { type: 'string', pattern: '^0x[a-fA-F0-9]{130}$' },
            message: { type: 'string', minLength: 1, maxLength: 1000 },
            nonce: { type: 'string', minLength: 1, maxLength: 100 }
        },
        additionalProperties: false
    },

    // API key creation
    createApiKey: {
        type: 'object',
        required: ['name', 'permissions'],
        properties: {
            name: { type: 'string', minLength: 1, maxLength: 100 },
            permissions: {
                type: 'array',
                items: { type: 'string', enum: ['read', 'write', 'admin'] },
                minItems: 1,
                uniqueItems: true
            },
            expiresIn: { type: 'string', pattern: '^\\d+[dwmy]$', default: '1y' }
        },
        additionalProperties: false
    }
};

/**
 * Rate limiting configurations
 */
export const RateLimitConfigs = {
    // Global rate limiting
    global: {
        max: 1000,
        timeWindow: 60000, // 1 minute
        skipOnError: false,
        skipSuccessfulRequests: false
    },

    // Authentication endpoints
    auth: {
        max: 5,
        timeWindow: 300000, // 5 minutes
        skipOnError: true,
        skipSuccessfulRequests: false,
        keyGenerator: (request) => {
            return request.ip || request.headers['x-forwarded-for'] || 'unknown';
        }
    },

    // Order submission
    orderSubmission: {
        max: 10,
        timeWindow: 60000, // 1 minute
        skipOnError: false,
        skipSuccessfulRequests: false,
        keyGenerator: (request) => {
            return request.user?.address || request.ip || 'anonymous';
        }
    },

    // API key operations
    apiKeyOps: {
        max: 10,
        timeWindow: 3600000, // 1 hour
        skipOnError: false,
        skipSuccessfulRequests: true
    },

    // Tier-based rate limiting
    getTierLimits: (tier) => {
        const limits = {
            free: { max: 100, timeWindow: 60000 },
            pro: { max: 1000, timeWindow: 60000 },
            enterprise: { max: 10000, timeWindow: 60000 }
        };
        return limits[tier] || limits.free;
    }
};

/**
 * Input sanitization middleware
 */
export function createSanitizationMiddleware(options = {}) {
    const validator = new ValidationService();

    return async function sanitizationMiddleware(request, reply) {
        // Sanitize request body
        if (request.body && typeof request.body === 'object') {
            request.body = validator.sanitizeInput(request.body, {
                allowHtml: false,
                maxLength: options.maxStringLength || 10000,
                allowedKeys: options.allowedBodyKeys
            });
        }

        // Sanitize query parameters
        if (request.query && typeof request.query === 'object') {
            request.query = validator.sanitizeInput(request.query, {
                allowHtml: false,
                maxLength: options.maxQueryLength || 1000
            });
        }

        // Sanitize URL parameters
        if (request.params && typeof request.params === 'object') {
            request.params = validator.sanitizeInput(request.params, {
                allowHtml: false,
                maxLength: options.maxParamLength || 100
            });
        }

        // Sanitize headers (selected ones)
        const sanitizedHeaders = {};
        const allowedHeaders = [
            'user-agent', 'x-forwarded-for', 'x-real-ip', 
            'x-api-key', 'authorization', 'x-request-id'
        ];

        for (const header of allowedHeaders) {
            if (request.headers[header]) {
                sanitizedHeaders[header] = validator.sanitizeString(
                    request.headers[header], 
                    { maxLength: 1000 }
                );
            }
        }

        request.sanitizedHeaders = sanitizedHeaders;
    };
}

/**
 * Validation middleware factory
 */
export function createValidationMiddleware(schema, options = {}) {
    const validator = new ValidationService(options);
    const isJoiSchema = schema.isJoi || schema._type; // Joi schema detection
    
    return async function validationMiddleware(request, reply) {
        let dataToValidate;
        
        // Determine what to validate
        switch (options.source || 'body') {
            case 'query':
                dataToValidate = request.query;
                break;
            case 'params':
                dataToValidate = request.params;
                break;
            case 'headers':
                dataToValidate = request.headers;
                break;
            default:
                dataToValidate = request.body;
        }

        // Perform validation
        let result;
        if (isJoiSchema) {
            result = await validator.validateWithJoi(dataToValidate, schema, options);
        } else {
            result = validator.validateWithJsonSchema(dataToValidate, schema, options);
        }

        // Handle validation errors
        if (!result.isValid) {
            return reply.code(400).send({
                error: 'VALIDATION_ERROR',
                message: 'Request validation failed',
                details: result.errors
            });
        }

        // Store validated data
        switch (options.source || 'body') {
            case 'query':
                request.validatedQuery = result.value;
                break;
            case 'params':
                request.validatedParams = result.value;
                break;
            case 'headers':
                request.validatedHeaders = result.value;
                break;
            default:
                request.validatedBody = result.value;
        }
    };
}

/**
 * Security headers middleware
 */
export function createSecurityHeadersMiddleware() {
    return async function securityHeadersMiddleware(request, reply) {
        // Content Security Policy
        reply.header('Content-Security-Policy', 
            "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'");
        
        // XSS Protection
        reply.header('X-XSS-Protection', '1; mode=block');
        
        // Content Type Options
        reply.header('X-Content-Type-Options', 'nosniff');
        
        // Frame Options
        reply.header('X-Frame-Options', 'DENY');
        
        // Referrer Policy
        reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
        
        // Permission Policy
        reply.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    };
}

/**
 * Request size limiting middleware
 */
export function createRequestSizeLimitMiddleware(options = {}) {
    const maxBodySize = options.maxBodySize || 1048576; // 1MB
    const maxQuerySize = options.maxQuerySize || 8192; // 8KB
    const maxHeaderSize = options.maxHeaderSize || 8192; // 8KB

    return async function requestSizeLimitMiddleware(request, reply) {
        // Check body size
        if (request.body) {
            const bodySize = JSON.stringify(request.body).length;
            if (bodySize > maxBodySize) {
                return reply.code(413).send({
                    error: 'PAYLOAD_TOO_LARGE',
                    message: `Request body too large. Maximum size: ${maxBodySize} bytes`
                });
            }
        }

        // Check query size
        if (request.query) {
            const querySize = new URLSearchParams(request.query).toString().length;
            if (querySize > maxQuerySize) {
                return reply.code(413).send({
                    error: 'QUERY_TOO_LARGE',
                    message: `Query string too large. Maximum size: ${maxQuerySize} bytes`
                });
            }
        }

        // Check headers size
        const headersSize = JSON.stringify(request.headers).length;
        if (headersSize > maxHeaderSize) {
            return reply.code(413).send({
                error: 'HEADERS_TOO_LARGE',
                message: `Headers too large. Maximum size: ${maxHeaderSize} bytes`
            });
        }
    };
}

/**
 * Complete validation middleware registration
 */
export async function registerValidationMiddleware(fastify, config = {}) {
    // Global sanitization
    fastify.addHook('preHandler', createSanitizationMiddleware(config.sanitization));
    
    // Security headers
    fastify.addHook('preHandler', createSecurityHeadersMiddleware());
    
    // Request size limits
    fastify.addHook('preHandler', createRequestSizeLimitMiddleware(config.requestLimits));

    // Add validation utilities to fastify instance
    fastify.decorate('validate', {
        joi: (schema, options) => createValidationMiddleware(schema, { ...options, engine: 'joi' }),
        jsonSchema: (schema, options) => createValidationMiddleware(schema, { ...options, engine: 'jsonSchema' }),
        ethereum: new ValidationService().validateEthereumAddress.bind(new ValidationService()),
        amount: new ValidationService().validateAmount.bind(new ValidationService()),
        signature: new ValidationService().validateSignature.bind(new ValidationService())
    });

    fastify.log.info('✅ Validation middleware registered successfully');
}

export default {
    ValidationService,
    JoiSchemas,
    JsonSchemas,
    RateLimitConfigs,
    createSanitizationMiddleware,
    createValidationMiddleware,
    createSecurityHeadersMiddleware,
    createRequestSizeLimitMiddleware,
    registerValidationMiddleware
};