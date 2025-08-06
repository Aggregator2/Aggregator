/**
 * @title Structured Logger
 * @author DEX Monitoring Team
 * @notice High-performance structured logging for ELK stack integration
 * @dev Optimized for log aggregation, correlation, and business intelligence
 */

const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const { ElasticsearchTransport } = require('winston-elasticsearch');
const crypto = require('crypto');
const os = require('os');

class StructuredLogger {
    constructor(config) {
        this.config = {
            // Service configuration
            serviceName: config.serviceName || 'dex-platform',
            serviceVersion: config.serviceVersion || '1.0.0',
            environment: config.environment || 'production',
            nodeId: config.nodeId || os.hostname(),
            
            // Log levels and output
            logLevel: config.logLevel || 'info',
            enableConsole: config.enableConsole !== false,
            enableFile: config.enableFile !== false,
            enableElasticsearch: config.enableElasticsearch !== false,
            
            // File logging configuration
            logDirectory: config.logDirectory || './logs',
            maxFileSize: config.maxFileSize || '100m',
            maxFiles: config.maxFiles || '30d',
            
            // Elasticsearch configuration
            elasticsearchHost: config.elasticsearchHost || 'http://localhost:9200',
            elasticsearchIndex: config.elasticsearchIndex || 'dex-logs',
            elasticsearchUsername: config.elasticsearchUsername,
            elasticsearchPassword: config.elasticsearchPassword,
            
            // Performance configuration
            enableBuffering: config.enableBuffering !== false,
            bufferSize: config.bufferSize || 1000,
            flushInterval: config.flushInterval || 5000, // 5 seconds
            
            // Correlation and tracing
            enableCorrelation: config.enableCorrelation !== false,
            enableProfiling: config.enableProfiling || false,
            
            // Security and privacy
            enableSanitization: config.enableSanitization !== false,
            maskSensitiveData: config.maskSensitiveData !== false,
            
            ...config
        };

        // Core logger instance
        this.logger = null;
        
        // Correlation and context
        this.correlationStore = new Map();
        this.contextStack = [];
        
        // Performance tracking
        this.performanceMetrics = new PerformanceMetrics();
        this.logBuffer = [];
        this.flushTimer = null;
        
        // Business event tracking
        this.businessEventTracker = new BusinessEventTracker(this.config);
        this.securityEventTracker = new SecurityEventTracker(this.config);
        
        // Formatters and serializers
        this.logFormatter = new LogFormatter(this.config);
        this.dataSerializer = new DataSerializer(this.config);
        
        this._initializeLogger();
    }

    /**
     * Initialize Winston logger with transports
     * @private
     */
    _initializeLogger() {
        const transports = [];
        
        // Console transport
        if (this.config.enableConsole) {
            transports.push(new winston.transports.Console({
                level: this.config.logLevel,
                format: winston.format.combine(
                    winston.format.colorize(),
                    winston.format.timestamp(),
                    winston.format.printf(this._consoleFormat.bind(this))
                )
            }));
        }
        
        // File transport with rotation
        if (this.config.enableFile) {
            transports.push(new DailyRotateFile({
                filename: `${this.config.logDirectory}/${this.config.serviceName}-%DATE%.log`,
                datePattern: 'YYYY-MM-DD',
                zippedArchive: true,
                maxSize: this.config.maxFileSize,
                maxFiles: this.config.maxFiles,
                level: this.config.logLevel,
                format: winston.format.combine(
                    winston.format.timestamp(),
                    winston.format.json()
                )
            }));
            
            // Separate error log file
            transports.push(new DailyRotateFile({
                filename: `${this.config.logDirectory}/${this.config.serviceName}-error-%DATE%.log`,
                datePattern: 'YYYY-MM-DD',
                zippedArchive: true,
                maxSize: this.config.maxFileSize,
                maxFiles: this.config.maxFiles,
                level: 'error',
                format: winston.format.combine(
                    winston.format.timestamp(),
                    winston.format.json()
                )
            }));
        }
        
        // Elasticsearch transport
        if (this.config.enableElasticsearch) {
            const esOptions = {
                level: this.config.logLevel,
                clientOpts: {
                    node: this.config.elasticsearchHost,
                    auth: this.config.elasticsearchUsername ? {
                        username: this.config.elasticsearchUsername,
                        password: this.config.elasticsearchPassword
                    } : undefined
                },
                index: this.config.elasticsearchIndex,
                transformer: this._elasticsearchTransformer.bind(this)
            };
            
            transports.push(new ElasticsearchTransport(esOptions));
        }
        
        // Create logger instance
        this.logger = winston.createLogger({
            level: this.config.logLevel,
            defaultMeta: {
                service: this.config.serviceName,
                version: this.config.serviceVersion,
                environment: this.config.environment,
                nodeId: this.config.nodeId
            },
            transports,
            exitOnError: false
        });
        
        // Start buffer flushing if enabled
        if (this.config.enableBuffering) {
            this._startBufferFlushing();
        }
        
        console.log(`Structured Logger initialized for ${this.config.serviceName}`);
    }

    /**
     * Log info level message
     * @param {string} message Log message
     * @param {Object} meta Additional metadata
     * @param {Object} context Log context
     */
    info(message, meta = {}, context = {}) {
        this._log('info', message, meta, context);
    }

    /**
     * Log warning level message
     * @param {string} message Log message
     * @param {Object} meta Additional metadata
     * @param {Object} context Log context
     */
    warn(message, meta = {}, context = {}) {
        this._log('warn', message, meta, context);
    }

    /**
     * Log error level message
     * @param {string} message Log message
     * @param {Error|Object} error Error object or metadata
     * @param {Object} context Log context
     */
    error(message, error = {}, context = {}) {
        const errorMeta = error instanceof Error ? {
            error: {
                name: error.name,
                message: error.message,
                stack: error.stack,
                code: error.code
            }
        } : error;
        
        this._log('error', message, errorMeta, context);
    }

    /**
     * Log debug level message
     * @param {string} message Log message
     * @param {Object} meta Additional metadata
     * @param {Object} context Log context
     */
    debug(message, meta = {}, context = {}) {
        this._log('debug', message, meta, context);
    }

    /**
     * Log business event
     * @param {string} eventType Business event type
     * @param {Object} eventData Event data
     * @param {Object} context Event context
     */
    businessEvent(eventType, eventData = {}, context = {}) {
        const businessMeta = this.businessEventTracker.track(eventType, eventData);
        
        this._log('info', `Business Event: ${eventType}`, {
            ...businessMeta,
            business_event: eventType,
            event_data: this.dataSerializer.serialize(eventData)
        }, context);
    }

    /**
     * Log security event
     * @param {string} eventType Security event type
     * @param {Object} eventData Event data
     * @param {Object} context Event context
     */
    securityEvent(eventType, eventData = {}, context = {}) {
        const securityMeta = this.securityEventTracker.track(eventType, eventData);
        
        this._log('warn', `Security Event: ${eventType}`, {
            ...securityMeta,
            security_event: eventType,
            event_data: this.dataSerializer.serialize(eventData),
            alert_priority: this._calculateSecurityPriority(eventType, eventData)
        }, context);
    }

    /**
     * Log API request
     * @param {Object} requestData Request data
     * @param {Object} responseData Response data
     * @param {Object} context Request context
     */
    apiRequest(requestData, responseData = {}, context = {}) {
        const duration = responseData.duration || 0;
        const statusCode = responseData.statusCode || 200;
        
        this._log('info', 'API Request', {
            log_category: 'api_request',
            http_method: requestData.method,
            api_path: requestData.path,
            user_id: requestData.userId,
            client_ip: requestData.clientIp,
            user_agent: requestData.userAgent,
            request_duration: duration,
            status_code: statusCode,
            request_size: requestData.size || 0,
            response_size: responseData.size || 0
        }, context);
    }

    /**
     * Log trade execution
     * @param {Object} tradeData Trade data
     * @param {Object} context Trade context
     */
    tradeExecution(tradeData, context = {}) {
        this._log('info', 'Trade Executed', {
            log_category: 'trade_execution',
            business_event: 'trade',
            trade_id: tradeData.tradeId,
            trading_pair: tradeData.pair,
            trade_amount: tradeData.amount,
            trade_price: tradeData.price,
            trade_value: tradeData.amount * tradeData.price,
            trader_id: tradeData.userId,
            order_type: tradeData.orderType,
            execution_time: tradeData.executionTime
        }, context);
        
        // Track business metrics
        this.businessEventTracker.recordTrade(tradeData);
    }

    /**
     * Log order event
     * @param {string} action Order action (submitted, cancelled, filled, etc.)
     * @param {Object} orderData Order data
     * @param {Object} context Order context
     */
    orderEvent(action, orderData, context = {}) {
        this._log('info', `Order ${action}`, {
            log_category: 'order_management',
            business_event: 'order',
            order_action: action,
            order_id: orderData.orderId,
            order_type: orderData.type,
            order_side: orderData.side,
            order_amount: orderData.amount,
            order_price: orderData.price,
            user_id: orderData.userId,
            trading_pair: orderData.pair
        }, context);
        
        // Track business metrics
        this.businessEventTracker.recordOrder(action, orderData);
    }

    /**
     * Log authentication event
     * @param {string} result Authentication result
     * @param {Object} authData Authentication data
     * @param {Object} context Auth context
     */
    authenticationEvent(result, authData, context = {}) {
        this._log('info', `Authentication ${result}`, {
            log_category: 'authentication',
            security_event: 'auth_attempt',
            auth_result: result,
            user_id: authData.userId,
            auth_method: authData.method,
            client_ip: authData.clientIp,
            auth_duration: authData.duration,
            risk_score: authData.riskScore
        }, context);
        
        // Track security metrics
        this.securityEventTracker.recordAuth(result, authData);
    }

    /**
     * Log performance metric
     * @param {string} metricName Metric name
     * @param {number} value Metric value
     * @param {string} unit Metric unit
     * @param {Object} tags Additional tags
     */
    performanceMetric(metricName, value, unit = '', tags = {}) {
        this._log('info', 'Performance Metric', {
            log_category: 'performance_metric',
            metric_type: 'business_kpi',
            metric_name: metricName,
            metric_value: value,
            metric_unit: unit,
            service_name: this.config.serviceName,
            ...tags
        });
        
        // Track performance metrics
        this.performanceMetrics.record(metricName, value, unit, tags);
    }

    /**
     * Start performance timing
     * @param {string} operation Operation name
     * @returns {Function} End timing function
     */
    startTiming(operation) {
        const startTime = process.hrtime.bigint();
        
        return (additionalMeta = {}) => {
            const endTime = process.hrtime.bigint();
            const duration = Number(endTime - startTime) / 1000000; // Convert to milliseconds
            
            this.performanceMetric(`${operation}_duration`, duration, 'ms', additionalMeta);
            
            return duration;
        };
    }

    /**
     * Create correlation context
     * @param {string} correlationId Correlation ID
     * @param {Object} context Initial context
     * @returns {Object} Context manager
     */
    correlate(correlationId = null, context = {}) {
        const id = correlationId || crypto.randomUUID();
        
        const correlationContext = {
            correlationId: id,
            requestId: crypto.randomUUID(),
            sessionId: context.sessionId,
            userId: context.userId,
            traceId: context.traceId,
            spanId: context.spanId,
            startTime: Date.now(),
            ...context
        };
        
        this.correlationStore.set(id, correlationContext);
        
        return {
            id,
            context: correlationContext,
            child: (childContext = {}) => {
                return this.correlate(null, {
                    ...correlationContext,
                    parentCorrelationId: id,
                    ...childContext
                });
            },
            end: () => {
                this.correlationStore.delete(id);
            }
        };
    }

    /**
     * Core logging method
     * @param {string} level Log level
     * @param {string} message Log message
     * @param {Object} meta Metadata
     * @param {Object} context Context
     * @private
     */
    _log(level, message, meta = {}, context = {}) {
        try {
            // Get current correlation context
            const correlation = this._getCurrentCorrelation(context);
            
            // Sanitize sensitive data
            const sanitizedMeta = this.config.enableSanitization 
                ? this._sanitizeData(meta) 
                : meta;
            
            // Format log entry
            const logEntry = this.logFormatter.format({
                level,
                message,
                timestamp: new Date().toISOString(),
                correlation,
                meta: sanitizedMeta,
                context: this._getCurrentContext(),
                performance: this.config.enableProfiling ? this._getPerformanceData() : undefined
            });
            
            // Buffer or log immediately
            if (this.config.enableBuffering) {
                this.logBuffer.push(logEntry);
                
                if (this.logBuffer.length >= this.config.bufferSize) {
                    this._flushBuffer();
                }
            } else {
                this.logger.log(logEntry);
            }
            
        } catch (error) {
            console.error('Logging error:', error);
            // Fallback to simple console logging
            console.log(`[${level}] ${message}`, meta);
        }
    }

    /**
     * Get current correlation context
     * @param {Object} context Provided context
     * @returns {Object} Correlation data
     * @private
     */
    _getCurrentCorrelation(context) {
        // Try to get from provided context
        if (context.correlationId) {
            return this.correlationStore.get(context.correlationId) || {};
        }
        
        // Try to get from current context stack
        if (this.contextStack.length > 0) {
            const currentContext = this.contextStack[this.contextStack.length - 1];
            return this.correlationStore.get(currentContext.correlationId) || {};
        }
        
        return {};
    }

    /**
     * Get current context
     * @returns {Object} Current context
     * @private
     */
    _getCurrentContext() {
        return this.contextStack.length > 0 
            ? this.contextStack[this.contextStack.length - 1] 
            : {};
    }

    /**
     * Get performance data
     * @returns {Object} Performance data
     * @private
     */
    _getPerformanceData() {
        const memUsage = process.memoryUsage();
        const cpuUsage = process.cpuUsage();
        
        return {
            memory: {
                heapUsed: memUsage.heapUsed,
                heapTotal: memUsage.heapTotal,
                rss: memUsage.rss
            },
            cpu: {
                user: cpuUsage.user,
                system: cpuUsage.system
            },
            uptime: process.uptime()
        };
    }

    /**
     * Sanitize sensitive data
     * @param {Object} data Data to sanitize
     * @returns {Object} Sanitized data
     * @private
     */
    _sanitizeData(data) {
        if (!this.config.maskSensitiveData) return data;
        
        const sensitiveFields = [
            'password', 'secret', 'token', 'key', 'auth', 'credential',
            'privateKey', 'seed', 'mnemonic', 'signature'
        ];
        
        return this._deepSanitize(data, sensitiveFields);
    }

    /**
     * Deep sanitize object
     * @param {*} obj Object to sanitize
     * @param {Array} sensitiveFields Sensitive field names
     * @returns {*} Sanitized object
     * @private
     */
    _deepSanitize(obj, sensitiveFields) {
        if (typeof obj !== 'object' || obj === null) {
            return obj;
        }
        
        if (Array.isArray(obj)) {
            return obj.map(item => this._deepSanitize(item, sensitiveFields));
        }
        
        const sanitized = {};
        for (const [key, value] of Object.entries(obj)) {
            const keyLower = key.toLowerCase();
            const isSensitive = sensitiveFields.some(field => keyLower.includes(field));
            
            if (isSensitive) {
                sanitized[key] = '[REDACTED]';
            } else {
                sanitized[key] = this._deepSanitize(value, sensitiveFields);
            }
        }
        
        return sanitized;
    }

    /**
     * Calculate security event priority
     * @param {string} eventType Event type
     * @param {Object} eventData Event data
     * @returns {string} Priority level
     * @private
     */
    _calculateSecurityPriority(eventType, eventData) {
        const highPriorityEvents = [
            'authentication_failure_burst',
            'suspicious_trading_pattern',
            'potential_wash_trading',
            'privilege_escalation_attempt',
            'unauthorized_access_attempt'
        ];
        
        const mediumPriorityEvents = [
            'authentication_failure',
            'unusual_trading_volume',
            'api_rate_limit_exceeded',
            'invalid_signature'
        ];
        
        if (highPriorityEvents.includes(eventType)) {
            return 'high';
        } else if (mediumPriorityEvents.includes(eventType)) {
            return 'medium';
        } else {
            return 'low';
        }
    }

    /**
     * Console format function
     * @param {Object} info Log info
     * @returns {string} Formatted string
     * @private
     */
    _consoleFormat(info) {
        const { timestamp, level, message, ...meta } = info;
        const metaStr = Object.keys(meta).length > 0 ? JSON.stringify(meta, null, 2) : '';
        return `${timestamp} [${level}] ${message} ${metaStr}`;
    }

    /**
     * Elasticsearch transformer
     * @param {Object} logData Log data
     * @returns {Object} Transformed log data
     * @private
     */
    _elasticsearchTransformer(logData) {
        return {
            '@timestamp': logData.timestamp,
            level: logData.level,
            message: logData.message,
            service: this.config.serviceName,
            environment: this.config.environment,
            ...logData
        };
    }

    /**
     * Start buffer flushing timer
     * @private
     */
    _startBufferFlushing() {
        this.flushTimer = setInterval(() => {
            if (this.logBuffer.length > 0) {
                this._flushBuffer();
            }
        }, this.config.flushInterval);
    }

    /**
     * Flush log buffer
     * @private
     */
    _flushBuffer() {
        const logsToFlush = this.logBuffer.splice(0);
        
        logsToFlush.forEach(logEntry => {
            this.logger.log(logEntry);
        });
    }

    /**
     * Get logging statistics
     * @returns {Object} Statistics
     */
    getStatistics() {
        return {
            bufferSize: this.logBuffer.length,
            correlationContexts: this.correlationStore.size,
            contextStack: this.contextStack.length,
            performanceMetrics: this.performanceMetrics.getStats(),
            businessEvents: this.businessEventTracker.getStats(),
            securityEvents: this.securityEventTracker.getStats()
        };
    }

    /**
     * Cleanup resources
     */
    destroy() {
        if (this.flushTimer) {
            clearInterval(this.flushTimer);
        }
        
        // Flush remaining logs
        this._flushBuffer();
        
        // Clear stores
        this.correlationStore.clear();
        this.contextStack = [];
        
        console.log('Structured Logger destroyed');
    }
}

// =============================================================================
// SUPPORTING CLASSES
// =============================================================================

class PerformanceMetrics {
    constructor() {
        this.metrics = new Map();
    }

    record(name, value, unit, tags) {
        const key = `${name}_${JSON.stringify(tags)}`;
        if (!this.metrics.has(key)) {
            this.metrics.set(key, {
                name,
                unit,
                tags,
                values: [],
                count: 0,
                sum: 0,
                min: Infinity,
                max: -Infinity
            });
        }
        
        const metric = this.metrics.get(key);
        metric.values.push({ value, timestamp: Date.now() });
        metric.count++;
        metric.sum += value;
        metric.min = Math.min(metric.min, value);
        metric.max = Math.max(metric.max, value);
    }

    getStats() {
        const stats = {};
        for (const [key, metric] of this.metrics) {
            stats[key] = {
                ...metric,
                average: metric.sum / metric.count,
                values: undefined // Don't include raw values in stats
            };
        }
        return stats;
    }
}

class BusinessEventTracker {
    constructor(config) {
        this.config = config;
        this.events = new Map();
    }

    track(eventType, eventData) {
        const timestamp = Date.now();
        
        if (!this.events.has(eventType)) {
            this.events.set(eventType, {
                count: 0,
                firstSeen: timestamp,
                lastSeen: timestamp
            });
        }
        
        const event = this.events.get(eventType);
        event.count++;
        event.lastSeen = timestamp;
        
        return {
            event_count: event.count,
            event_first_seen: event.firstSeen,
            event_last_seen: event.lastSeen
        };
    }

    recordTrade(tradeData) {
        // Track trade-specific metrics
        this.track('trade_executed', tradeData);
    }

    recordOrder(action, orderData) {
        // Track order-specific metrics
        this.track(`order_${action}`, orderData);
    }

    getStats() {
        return Object.fromEntries(this.events);
    }
}

class SecurityEventTracker {
    constructor(config) {
        this.config = config;
        this.events = new Map();
        this.riskScores = new Map();
    }

    track(eventType, eventData) {
        const timestamp = Date.now();
        
        if (!this.events.has(eventType)) {
            this.events.set(eventType, {
                count: 0,
                firstSeen: timestamp,
                lastSeen: timestamp
            });
        }
        
        const event = this.events.get(eventType);
        event.count++;
        event.lastSeen = timestamp;
        
        return {
            security_event_count: event.count,
            security_event_first_seen: event.firstSeen,
            security_event_last_seen: event.lastSeen
        };
    }

    recordAuth(result, authData) {
        this.track(`auth_${result}`, authData);
        
        // Track user risk scores
        if (authData.userId && authData.riskScore) {
            this.riskScores.set(authData.userId, {
                score: authData.riskScore,
                timestamp: Date.now()
            });
        }
    }

    getStats() {
        return {
            events: Object.fromEntries(this.events),
            highRiskUsers: Array.from(this.riskScores.entries())
                .filter(([_, data]) => data.score > 0.7)
                .length
        };
    }
}

class LogFormatter {
    constructor(config) {
        this.config = config;
    }

    format(logData) {
        return {
            level: logData.level,
            message: logData.message,
            timestamp: logData.timestamp,
            service: this.config.serviceName,
            version: this.config.serviceVersion,
            environment: this.config.environment,
            correlation: logData.correlation,
            context: logData.context,
            performance: logData.performance,
            ...logData.meta
        };
    }
}

class DataSerializer {
    constructor(config) {
        this.config = config;
    }

    serialize(data) {
        try {
            return JSON.stringify(data);
        } catch (error) {
            return '[Serialization Error]';
        }
    }
}

module.exports = {
    StructuredLogger,
    PerformanceMetrics,
    BusinessEventTracker,
    SecurityEventTracker,
    LogFormatter,
    DataSerializer
};