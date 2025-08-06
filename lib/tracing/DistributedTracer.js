/**
 * @title Distributed Tracer
 * @author DEX Monitoring Team
 * @notice Comprehensive distributed tracing with OpenTelemetry and Jaeger
 * @dev Provides end-to-end visibility across microservices and trading operations
 */

const { NodeSDK } = require('@opentelemetry/sdk-node');
const { Resource } = require('@opentelemetry/resources');
const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');
const { JaegerExporter } = require('@opentelemetry/exporter-jaeger');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-otlp-http');
const { SimpleSpanProcessor, BatchSpanProcessor } = require('@opentelemetry/sdk-trace-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { trace, context, SpanStatusCode, SpanKind } = require('@opentelemetry/api');
const crypto = require('crypto');

class DistributedTracer {
    constructor(config) {
        this.config = {
            // Service configuration
            serviceName: config.serviceName || 'dex-platform',
            serviceVersion: config.serviceVersion || '1.0.0',
            environment: config.environment || 'production',
            
            // Jaeger configuration
            jaegerEndpoint: config.jaegerEndpoint || 'http://localhost:14268/api/traces',
            jaegerAgentHost: config.jaegerAgentHost || 'localhost',
            jaegerAgentPort: config.jaegerAgentPort || 6832,
            
            // OTLP configuration
            otlpEndpoint: config.otlpEndpoint || 'http://localhost:4318/v1/traces',
            otlpHeaders: config.otlpHeaders || {},
            
            // Sampling configuration
            samplingRate: config.samplingRate || 1.0, // 100% sampling for trading systems
            enableSampling: config.enableSampling !== false,
            
            // Performance configuration
            enableBatching: config.enableBatching !== false,
            batchTimeout: config.batchTimeout || 5000, // 5 seconds
            maxBatchSize: config.maxBatchSize || 512,
            
            // Custom configuration
            enableCustomMetrics: config.enableCustomMetrics !== false,
            enableBusinessTracing: config.enableBusinessTracing !== false,
            enableSecurityTracing: config.enableSecurityTracing !== false,
            
            // Instrumentation configuration
            enableAutoInstrumentation: config.enableAutoInstrumentation !== false,
            instrumentations: config.instrumentations || [],
            
            ...config
        };

        // Tracer instances
        this.tracer = null;
        this.sdk = null;
        
        // Business tracing components
        this.businessTracer = new BusinessTracer(this.config);
        this.securityTracer = new SecurityTracer(this.config);
        this.performanceTracer = new PerformanceTracer(this.config);
        
        // Context management
        this.contextManager = new TraceContextManager();
        this.correlationManager = new CorrelationManager();
        
        // Span processors and exporters
        this.spanProcessors = [];
        this.exporters = [];
        
        this._initializeTracing();
    }

    /**
     * Initialize distributed tracing
     * @private
     */
    _initializeTracing() {
        try {
            // Create resource
            const resource = new Resource({
                [SemanticResourceAttributes.SERVICE_NAME]: this.config.serviceName,
                [SemanticResourceAttributes.SERVICE_VERSION]: this.config.serviceVersion,
                [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: this.config.environment,
                [SemanticResourceAttributes.SERVICE_INSTANCE_ID]: crypto.randomUUID()
            });

            // Setup exporters
            this._setupExporters();
            
            // Setup span processors
            this._setupSpanProcessors();
            
            // Create SDK
            this.sdk = new NodeSDK({
                resource,
                spanProcessors: this.spanProcessors,
                instrumentations: this.config.enableAutoInstrumentation 
                    ? getNodeAutoInstrumentations({
                        '@opentelemetry/instrumentation-fs': { enabled: false },
                        '@opentelemetry/instrumentation-http': {
                            ignoreRequestHook: (req) => {
                                // Ignore health check requests
                                return req.url?.includes('/health');
                            }
                        }
                    })
                    : this.config.instrumentations
            });

            // Initialize SDK
            this.sdk.start();
            
            // Get tracer
            this.tracer = trace.getTracer(this.config.serviceName, this.config.serviceVersion);
            
            // Initialize business tracers
            this.businessTracer.initialize(this.tracer);
            this.securityTracer.initialize(this.tracer);
            this.performanceTracer.initialize(this.tracer);
            
            console.log(`Distributed Tracing initialized for ${this.config.serviceName}`);
            
        } catch (error) {
            console.error('Failed to initialize distributed tracing:', error);
            throw error;
        }
    }

    /**
     * Setup trace exporters
     * @private
     */
    _setupExporters() {
        // Jaeger exporter
        if (this.config.jaegerEndpoint) {
            this.exporters.push(new JaegerExporter({
                endpoint: this.config.jaegerEndpoint
            }));
        }
        
        // OTLP exporter
        if (this.config.otlpEndpoint) {
            this.exporters.push(new OTLPTraceExporter({
                url: this.config.otlpEndpoint,
                headers: this.config.otlpHeaders
            }));
        }
    }

    /**
     * Setup span processors
     * @private
     */
    _setupSpanProcessors() {
        this.exporters.forEach(exporter => {
            if (this.config.enableBatching) {
                this.spanProcessors.push(new BatchSpanProcessor(exporter, {
                    scheduledDelayMillis: this.config.batchTimeout,
                    maxExportBatchSize: this.config.maxBatchSize
                }));
            } else {
                this.spanProcessors.push(new SimpleSpanProcessor(exporter));
            }
        });
    }

    /**
     * Start a new span
     * @param {string} name Span name
     * @param {Object} options Span options
     * @param {Function} fn Function to execute within span
     * @returns {*} Function result
     */
    async trace(name, options = {}, fn = null) {
        // Handle different parameter combinations
        if (typeof options === 'function') {
            fn = options;
            options = {};
        }

        const spanOptions = {
            kind: SpanKind.INTERNAL,
            attributes: {},
            ...options
        };

        // Create span
        const span = this.tracer.startSpan(name, spanOptions);
        
        try {
            // Add custom attributes
            if (options.userId) {
                span.setAttributes({
                    'user.id': options.userId,
                    'user.type': options.userType || 'unknown'
                });
            }
            
            if (options.businessContext) {
                span.setAttributes({
                    'business.operation': options.businessContext.operation,
                    'business.entity': options.businessContext.entity,
                    'business.value': options.businessContext.value
                });
            }
            
            // Execute function within span context
            if (fn) {
                return await context.with(trace.setSpan(context.active(), span), async () => {
                    try {
                        const result = await fn(span);
                        span.setStatus({ code: SpanStatusCode.OK });
                        return result;
                    } catch (error) {
                        span.recordException(error);
                        span.setStatus({
                            code: SpanStatusCode.ERROR,
                            message: error.message
                        });
                        throw error;
                    }
                });
            } else {
                return span;
            }
        } finally {
            span.end();
        }
    }

    /**
     * Trace API request
     * @param {Object} request Request data
     * @param {Function} handler Request handler
     * @returns {*} Handler result
     */
    async traceApiRequest(request, handler) {
        const spanName = `${request.method} ${request.path}`;
        
        return this.trace(spanName, {
            kind: SpanKind.SERVER,
            attributes: {
                'http.method': request.method,
                'http.url': request.url,
                'http.route': request.path,
                'http.user_agent': request.userAgent,
                'http.client_ip': request.clientIp,
                'user.id': request.userId
            }
        }, async (span) => {
            const startTime = Date.now();
            
            try {
                const result = await handler();
                
                // Add response attributes
                span.setAttributes({
                    'http.status_code': result.statusCode || 200,
                    'http.response_size': result.size || 0,
                    'http.duration': Date.now() - startTime
                });
                
                return result;
            } catch (error) {
                span.setAttributes({
                    'http.status_code': error.statusCode || 500,
                    'http.duration': Date.now() - startTime
                });
                throw error;
            }
        });
    }

    /**
     * Trace database operation
     * @param {string} operation Database operation
     * @param {string} table Table/collection name
     * @param {Function} dbOperation Database operation function
     * @returns {*} Operation result
     */
    async traceDatabase(operation, table, dbOperation) {
        const spanName = `db.${operation}`;
        
        return this.trace(spanName, {
            kind: SpanKind.CLIENT,
            attributes: {
                'db.system': 'postgresql',
                'db.operation': operation,
                'db.name': 'dex_platform',
                'db.collection.name': table
            }
        }, async (span) => {
            const startTime = Date.now();
            
            try {
                const result = await dbOperation();
                
                span.setAttributes({
                    'db.duration': Date.now() - startTime,
                    'db.rows_affected': result.rowCount || 0
                });
                
                return result;
            } catch (error) {
                span.setAttributes({
                    'db.duration': Date.now() - startTime,
                    'db.error': error.message
                });
                throw error;
            }
        });
    }

    /**
     * Trace external service call
     * @param {string} serviceName External service name
     * @param {string} operation Operation name
     * @param {Function} serviceCall Service call function
     * @returns {*} Service call result
     */
    async traceExternalService(serviceName, operation, serviceCall) {
        const spanName = `${serviceName}.${operation}`;
        
        return this.trace(spanName, {
            kind: SpanKind.CLIENT,
            attributes: {
                'service.name': serviceName,
                'service.operation': operation,
                'component': 'external_service'
            }
        }, async (span) => {
            const startTime = Date.now();
            
            try {
                const result = await serviceCall();
                
                span.setAttributes({
                    'service.duration': Date.now() - startTime,
                    'service.success': true
                });
                
                return result;
            } catch (error) {
                span.setAttributes({
                    'service.duration': Date.now() - startTime,
                    'service.success': false,
                    'service.error': error.message
                });
                throw error;
            }
        });
    }

    /**
     * Trace business operation
     * @param {string} operation Business operation
     * @param {Object} businessData Business context data
     * @param {Function} businessLogic Business logic function
     * @returns {*} Business operation result
     */
    async traceBusiness(operation, businessData, businessLogic) {
        return this.businessTracer.trace(operation, businessData, businessLogic);
    }

    /**
     * Trace security operation
     * @param {string} operation Security operation
     * @param {Object} securityData Security context data
     * @param {Function} securityLogic Security logic function
     * @returns {*} Security operation result
     */
    async traceSecurity(operation, securityData, securityLogic) {
        return this.securityTracer.trace(operation, securityData, securityLogic);
    }

    /**
     * Trace performance-sensitive operation
     * @param {string} operation Performance operation
     * @param {Object} performanceData Performance context data
     * @param {Function} performanceLogic Performance logic function
     * @returns {*} Performance operation result
     */
    async tracePerformance(operation, performanceData, performanceLogic) {
        return this.performanceTracer.trace(operation, performanceData, performanceLogic);
    }

    /**
     * Create child span
     * @param {string} name Span name
     * @param {Object} options Span options
     * @returns {Object} Span
     */
    createChildSpan(name, options = {}) {
        return this.tracer.startSpan(name, {
            parent: trace.getActiveSpan(),
            ...options
        });
    }

    /**
     * Get current trace context
     * @returns {Object} Trace context
     */
    getCurrentContext() {
        const span = trace.getActiveSpan();
        if (!span) return null;
        
        const spanContext = span.spanContext();
        return {
            traceId: spanContext.traceId,
            spanId: spanContext.spanId,
            traceFlags: spanContext.traceFlags
        };
    }

    /**
     * Create correlation ID for request tracking
     * @param {Object} context Initial context
     * @returns {string} Correlation ID
     */
    createCorrelation(context = {}) {
        return this.correlationManager.create(context);
    }

    /**
     * Get correlation data
     * @param {string} correlationId Correlation ID
     * @returns {Object} Correlation data
     */
    getCorrelation(correlationId) {
        return this.correlationManager.get(correlationId);
    }

    /**
     * Add custom attributes to current span
     * @param {Object} attributes Attributes to add
     */
    addAttributes(attributes) {
        const span = trace.getActiveSpan();
        if (span) {
            span.setAttributes(attributes);
        }
    }

    /**
     * Add event to current span
     * @param {string} name Event name
     * @param {Object} attributes Event attributes
     */
    addEvent(name, attributes = {}) {
        const span = trace.getActiveSpan();
        if (span) {
            span.addEvent(name, attributes);
        }
    }

    /**
     * Record exception in current span
     * @param {Error} error Error to record
     */
    recordException(error) {
        const span = trace.getActiveSpan();
        if (span) {
            span.recordException(error);
            span.setStatus({
                code: SpanStatusCode.ERROR,
                message: error.message
            });
        }
    }

    /**
     * Get tracing statistics
     * @returns {Object} Statistics
     */
    getStatistics() {
        return {
            activeSpans: this.contextManager.getActiveSpanCount(),
            correlations: this.correlationManager.getCount(),
            businessTraces: this.businessTracer.getStatistics(),
            securityTraces: this.securityTracer.getStatistics(),
            performanceTraces: this.performanceTracer.getStatistics()
        };
    }

    /**
     * Shutdown tracing
     */
    async shutdown() {
        try {
            await this.sdk.shutdown();
            console.log('Distributed Tracing shutdown completed');
        } catch (error) {
            console.error('Error shutting down tracing:', error);
        }
    }
}

// =============================================================================
// BUSINESS TRACER
// =============================================================================

class BusinessTracer {
    constructor(config) {
        this.config = config;
        this.tracer = null;
        this.businessMetrics = new Map();
    }

    initialize(tracer) {
        this.tracer = tracer;
    }

    async trace(operation, businessData, businessLogic) {
        const spanName = `business.${operation}`;
        
        const span = this.tracer.startSpan(spanName, {
            kind: SpanKind.INTERNAL,
            attributes: {
                'business.operation': operation,
                'business.entity_type': businessData.entityType,
                'business.entity_id': businessData.entityId,
                'business.user_id': businessData.userId,
                'business.amount': businessData.amount,
                'business.currency': businessData.currency,
                'business.trading_pair': businessData.tradingPair
            }
        });

        try {
            return await context.with(trace.setSpan(context.active(), span), async () => {
                const startTime = Date.now();
                
                try {
                    const result = await businessLogic();
                    
                    // Record business metrics
                    span.setAttributes({
                        'business.success': true,
                        'business.duration': Date.now() - startTime,
                        'business.result_value': result.value || 0
                    });
                    
                    // Track business KPIs
                    this._trackBusinessKPI(operation, businessData, result);
                    
                    span.setStatus({ code: SpanStatusCode.OK });
                    return result;
                } catch (error) {
                    span.setAttributes({
                        'business.success': false,
                        'business.duration': Date.now() - startTime,
                        'business.error': error.message
                    });
                    
                    span.recordException(error);
                    span.setStatus({
                        code: SpanStatusCode.ERROR,
                        message: error.message
                    });
                    throw error;
                }
            });
        } finally {
            span.end();
        }
    }

    _trackBusinessKPI(operation, businessData, result) {
        const key = `${operation}_${businessData.entityType}`;
        
        if (!this.businessMetrics.has(key)) {
            this.businessMetrics.set(key, {
                count: 0,
                totalValue: 0,
                successRate: 0
            });
        }
        
        const metrics = this.businessMetrics.get(key);
        metrics.count++;
        
        if (businessData.amount) {
            metrics.totalValue += businessData.amount;
        }
        
        if (result.success !== false) {
            metrics.successRate = ((metrics.successRate * (metrics.count - 1)) + 1) / metrics.count;
        }
    }

    getStatistics() {
        return {
            businessOperations: this.businessMetrics.size,
            metrics: Object.fromEntries(this.businessMetrics)
        };
    }
}

// =============================================================================
// SECURITY TRACER
// =============================================================================

class SecurityTracer {
    constructor(config) {
        this.config = config;
        this.tracer = null;
        this.securityEvents = new Map();
    }

    initialize(tracer) {
        this.tracer = tracer;
    }

    async trace(operation, securityData, securityLogic) {
        const spanName = `security.${operation}`;
        
        const span = this.tracer.startSpan(spanName, {
            kind: SpanKind.INTERNAL,
            attributes: {
                'security.operation': operation,
                'security.user_id': securityData.userId,
                'security.client_ip': securityData.clientIp,
                'security.risk_score': securityData.riskScore,
                'security.auth_method': securityData.authMethod,
                'security.session_id': securityData.sessionId
            }
        });

        try {
            return await context.with(trace.setSpan(context.active(), span), async () => {
                const startTime = Date.now();
                
                try {
                    const result = await securityLogic();
                    
                    span.setAttributes({
                        'security.success': result.success !== false,
                        'security.duration': Date.now() - startTime,
                        'security.threat_detected': result.threatDetected || false,
                        'security.action_taken': result.actionTaken || 'none'
                    });
                    
                    // Track security events
                    this._trackSecurityEvent(operation, securityData, result);
                    
                    span.setStatus({ code: SpanStatusCode.OK });
                    return result;
                } catch (error) {
                    span.setAttributes({
                        'security.success': false,
                        'security.duration': Date.now() - startTime,
                        'security.error': error.message
                    });
                    
                    span.recordException(error);
                    span.setStatus({
                        code: SpanStatusCode.ERROR,
                        message: error.message
                    });
                    throw error;
                }
            });
        } finally {
            span.end();
        }
    }

    _trackSecurityEvent(operation, securityData, result) {
        const key = operation;
        
        if (!this.securityEvents.has(key)) {
            this.securityEvents.set(key, {
                count: 0,
                threatsDetected: 0,
                averageRiskScore: 0
            });
        }
        
        const event = this.securityEvents.get(key);
        event.count++;
        
        if (result.threatDetected) {
            event.threatsDetected++;
        }
        
        if (securityData.riskScore) {
            event.averageRiskScore = ((event.averageRiskScore * (event.count - 1)) + securityData.riskScore) / event.count;
        }
    }

    getStatistics() {
        return {
            securityOperations: this.securityEvents.size,
            events: Object.fromEntries(this.securityEvents)
        };
    }
}

// =============================================================================
// PERFORMANCE TRACER
// =============================================================================

class PerformanceTracer {
    constructor(config) {
        this.config = config;
        this.tracer = null;
        this.performanceData = new Map();
    }

    initialize(tracer) {
        this.tracer = tracer;
    }

    async trace(operation, performanceData, performanceLogic) {
        const spanName = `performance.${operation}`;
        
        const span = this.tracer.startSpan(spanName, {
            kind: SpanKind.INTERNAL,
            attributes: {
                'performance.operation': operation,
                'performance.expected_duration': performanceData.expectedDuration,
                'performance.priority': performanceData.priority || 'normal',
                'performance.batch_size': performanceData.batchSize
            }
        });

        try {
            return await context.with(trace.setSpan(context.active(), span), async () => {
                const startTime = process.hrtime.bigint();
                const startMemory = process.memoryUsage();
                
                try {
                    const result = await performanceLogic();
                    
                    const endTime = process.hrtime.bigint();
                    const endMemory = process.memoryUsage();
                    const duration = Number(endTime - startTime) / 1000000; // Convert to milliseconds
                    
                    span.setAttributes({
                        'performance.actual_duration': duration,
                        'performance.memory_used': endMemory.heapUsed - startMemory.heapUsed,
                        'performance.cpu_time': process.cpuUsage().user,
                        'performance.operations_count': result.operationsCount || 1,
                        'performance.throughput': result.operationsCount ? (result.operationsCount / duration * 1000) : 0
                    });
                    
                    // Track performance metrics
                    this._trackPerformanceMetric(operation, duration, performanceData);
                    
                    span.setStatus({ code: SpanStatusCode.OK });
                    return result;
                } catch (error) {
                    const endTime = process.hrtime.bigint();
                    const duration = Number(endTime - startTime) / 1000000;
                    
                    span.setAttributes({
                        'performance.actual_duration': duration,
                        'performance.error': error.message
                    });
                    
                    span.recordException(error);
                    span.setStatus({
                        code: SpanStatusCode.ERROR,
                        message: error.message
                    });
                    throw error;
                }
            });
        } finally {
            span.end();
        }
    }

    _trackPerformanceMetric(operation, duration, performanceData) {
        const key = operation;
        
        if (!this.performanceData.has(key)) {
            this.performanceData.set(key, {
                count: 0,
                totalDuration: 0,
                averageDuration: 0,
                minDuration: Infinity,
                maxDuration: 0
            });
        }
        
        const metrics = this.performanceData.get(key);
        metrics.count++;
        metrics.totalDuration += duration;
        metrics.averageDuration = metrics.totalDuration / metrics.count;
        metrics.minDuration = Math.min(metrics.minDuration, duration);
        metrics.maxDuration = Math.max(metrics.maxDuration, duration);
    }

    getStatistics() {
        return {
            performanceOperations: this.performanceData.size,
            metrics: Object.fromEntries(this.performanceData)
        };
    }
}

// =============================================================================
// SUPPORTING CLASSES
// =============================================================================

class TraceContextManager {
    constructor() {
        this.activeSpans = new Set();
    }

    getActiveSpanCount() {
        return this.activeSpans.size;
    }

    addSpan(span) {
        this.activeSpans.add(span);
    }

    removeSpan(span) {
        this.activeSpans.delete(span);
    }
}

class CorrelationManager {
    constructor() {
        this.correlations = new Map();
    }

    create(context = {}) {
        const correlationId = crypto.randomUUID();
        
        this.correlations.set(correlationId, {
            id: correlationId,
            createdAt: Date.now(),
            ...context
        });
        
        return correlationId;
    }

    get(correlationId) {
        return this.correlations.get(correlationId);
    }

    getCount() {
        return this.correlations.size;
    }
}

module.exports = {
    DistributedTracer,
    BusinessTracer,
    SecurityTracer,
    PerformanceTracer,
    TraceContextManager,
    CorrelationManager
};