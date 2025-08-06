/**
 * Analytics, Monitoring, and Billing Service
 * Comprehensive usage tracking, billing management, and system monitoring
 */

import { EventEmitter } from 'events';

/**
 * Analytics and Billing Service
 */
export class AnalyticsService extends EventEmitter {
    constructor(config, databaseService, cacheService) {
        super();
        
        this.config = config;
        this.db = databaseService;
        this.cache = cacheService;
        
        // Metrics collection
        this.metrics = {
            requests: new Map(),
            responses: new Map(),
            errors: new Map(),
            performance: new Map(),
            usage: new Map()
        };
        
        // Billing tracking
        this.billingCounters = new Map();
        this.tierLimits = config.billing?.tiers || {};
        
        // Performance monitoring
        this.performanceBuffer = [];
        this.maxBufferSize = 10000;
        
        // System metrics
        this.systemMetrics = {
            uptime: process.uptime(),
            memoryUsage: process.memoryUsage(),
            cpuUsage: process.cpuUsage(),
            startTime: Date.now()
        };
        
        this.setupPeriodicTasks();
    }

    /**
     * Setup periodic tasks for data processing and cleanup
     */
    setupPeriodicTasks() {
        // Process metrics every minute
        setInterval(() => {
            this.processMetrics();
        }, 60000);
        
        // Update system metrics every 30 seconds
        setInterval(() => {
            this.updateSystemMetrics();
        }, 30000);
        
        // Flush performance buffer every 5 minutes
        setInterval(() => {
            this.flushPerformanceBuffer();
        }, 300000);
        
        // Process billing data every hour
        setInterval(() => {
            this.processBillingData();
        }, 3600000);
        
        // Generate daily reports at midnight
        setInterval(() => {
            const now = new Date();
            if (now.getHours() === 0 && now.getMinutes() === 0) {
                this.generateDailyReport();
            }
        }, 60000);
    }

    /**
     * Track API request
     */
    async trackRequest(requestData) {
        try {
            const {
                method,
                url,
                userAgent,
                clientIP,
                userId,
                apiKeyId,
                timestamp = new Date(),
                size = 0
            } = requestData;

            // Store request data
            const requestRecord = {
                id: this.generateId(),
                method,
                url,
                userAgent,
                clientIP,
                userId,
                apiKeyId,
                timestamp,
                size
            };

            // Update metrics
            this.updateMetric('requests', this.getMetricKey(method, url), 1);
            
            // Track usage for billing
            if (userId || apiKeyId) {
                await this.trackUsage(userId || apiKeyId, 'request', 1, { endpoint: url });
            }

            // Store in database (async)
            this.storeRequestData(requestRecord);

            return requestRecord.id;

        } catch (error) {
            console.error('Error tracking request:', error);
        }
    }

    /**
     * Track API response
     */
    async trackResponse(responseData) {
        try {
            const {
                requestId,
                statusCode,
                responseTime,
                size = 0,
                cached = false,
                userId,
                apiKeyId,
                timestamp = new Date()
            } = responseData;

            // Store response data
            const responseRecord = {
                requestId,
                statusCode,
                responseTime,
                size,
                cached,
                userId,
                apiKeyId,
                timestamp
            };

            // Update metrics
            this.updateMetric('responses', `${statusCode}`, 1);
            this.updateMetric('performance', 'response_time', responseTime);
            
            if (statusCode >= 400) {
                this.updateMetric('errors', `${statusCode}`, 1);
            }

            // Track performance
            this.trackPerformance({
                responseTime,
                statusCode,
                size,
                cached,
                timestamp
            });

            // Store in database (async)
            this.storeResponseData(responseRecord);

        } catch (error) {
            console.error('Error tracking response:', error);
        }
    }

    /**
     * Track custom events
     */
    async trackEvent(eventType, eventData) {
        try {
            const eventRecord = {
                id: this.generateId(),
                type: eventType,
                data: eventData,
                timestamp: new Date(),
                userId: eventData.userId || null,
                apiKeyId: eventData.apiKeyId || null
            };

            // Update metrics
            this.updateMetric('events', eventType, 1);

            // Store in database (async)
            this.storeEventData(eventRecord);

            // Emit event for real-time processing
            this.emit('event', eventRecord);

        } catch (error) {
            console.error('Error tracking event:', error);
        }
    }

    /**
     * Track performance metrics
     */
    trackPerformance(performanceData) {
        this.performanceBuffer.push({
            ...performanceData,
            timestamp: performanceData.timestamp || new Date()
        });

        // Prevent memory overflow
        if (this.performanceBuffer.length > this.maxBufferSize) {
            this.performanceBuffer = this.performanceBuffer.slice(-this.maxBufferSize);
        }
    }

    /**
     * Track usage for billing
     */
    async trackUsage(identifier, usageType, quantity, metadata = {}) {
        try {
            const usageKey = `${identifier}:${usageType}`;
            const currentUsage = this.billingCounters.get(usageKey) || {
                quantity: 0,
                metadata: {},
                lastUpdated: new Date()
            };

            currentUsage.quantity += quantity;
            currentUsage.metadata = { ...currentUsage.metadata, ...metadata };
            currentUsage.lastUpdated = new Date();

            this.billingCounters.set(usageKey, currentUsage);

            // Check usage limits
            await this.checkUsageLimits(identifier, usageType, currentUsage.quantity);

        } catch (error) {
            console.error('Error tracking usage:', error);
        }
    }

    /**
     * Check usage limits for billing tiers
     */
    async checkUsageLimits(identifier, usageType, currentQuantity) {
        try {
            // Get user or API key tier
            const entity = await this.getEntityInfo(identifier);
            if (!entity) return;

            const tier = entity.tier || 'free';
            const limits = this.tierLimits[tier];
            
            if (!limits) return;

            // Check specific limit
            const limitKey = `${usageType}PerMonth`;
            const limit = limits[limitKey];
            
            if (limit && limit > 0 && currentQuantity >= limit) {
                // Emit usage limit exceeded event
                this.emit('usageLimitExceeded', {
                    identifier,
                    tier,
                    usageType,
                    currentQuantity,
                    limit
                });

                // Store in database
                await this.db.logUsageEvent({
                    identifier,
                    type: 'limit_exceeded',
                    usageType,
                    quantity: currentQuantity,
                    limit,
                    timestamp: new Date()
                });
            } else if (limit && limit > 0 && currentQuantity >= limit * 0.8) {
                // Warning at 80% usage
                this.emit('usageWarning', {
                    identifier,
                    tier,
                    usageType,
                    currentQuantity,
                    limit,
                    percentage: (currentQuantity / limit) * 100
                });
            }

        } catch (error) {
            console.error('Error checking usage limits:', error);
        }
    }

    /**
     * Get analytics dashboard data
     */
    async getDashboardData(timeRange = '24h', userId = null) {
        try {
            const endTime = new Date();
            const startTime = new Date(endTime.getTime() - this.parseTimeRange(timeRange));

            // Get request metrics
            const requestMetrics = await this.db.getRequestMetrics(startTime, endTime, userId);
            
            // Get response metrics
            const responseMetrics = await this.db.getResponseMetrics(startTime, endTime, userId);
            
            // Get error metrics
            const errorMetrics = await this.db.getErrorMetrics(startTime, endTime, userId);
            
            // Get performance metrics
            const performanceMetrics = await this.getPerformanceMetrics(startTime, endTime, userId);
            
            // Get usage metrics
            const usageMetrics = await this.getUsageMetrics(startTime, endTime, userId);

            return {
                timeRange,
                startTime,
                endTime,
                requests: requestMetrics,
                responses: responseMetrics,
                errors: errorMetrics,
                performance: performanceMetrics,
                usage: usageMetrics,
                system: this.getSystemMetrics()
            };

        } catch (error) {
            console.error('Error getting dashboard data:', error);
            throw error;
        }
    }

    /**
     * Get user usage statistics
     */
    async getUserUsage(userId, period = 'current_month') {
        try {
            const { startTime, endTime } = this.getPeriodRange(period);
            
            const usage = await this.db.getUserUsage(userId, startTime, endTime);
            const user = await this.db.getUserByAddress(userId);
            
            if (!user) {
                throw new Error('User not found');
            }

            const tier = user.tier || 'free';
            const limits = this.tierLimits[tier] || {};

            return {
                userId,
                tier,
                period,
                usage: {
                    requests: usage.requests || 0,
                    dataTransfer: usage.dataTransfer || 0,
                    apiCalls: usage.apiCalls || 0,
                    storage: usage.storage || 0
                },
                limits: {
                    requests: limits.requestsPerMonth || -1,
                    dataTransfer: limits.dataTransferPerMonth || -1,
                    apiCalls: limits.apiCallsPerMonth || -1,
                    storage: limits.storageLimit || -1
                },
                billing: {
                    estimatedCost: this.calculateEstimatedCost(usage, tier),
                    overageCharges: this.calculateOverageCharges(usage, limits),
                    nextBillingDate: this.getNextBillingDate(userId)
                }
            };

        } catch (error) {
            console.error('Error getting user usage:', error);
            throw error;
        }
    }

    /**
     * Generate billing report
     */
    async generateBillingReport(period = 'current_month') {
        try {
            const { startTime, endTime } = this.getPeriodRange(period);
            
            // Get all users with usage
            const usageData = await this.db.getAllUserUsage(startTime, endTime);
            
            const billingReport = {
                period,
                startTime,
                endTime,
                totalUsers: usageData.length,
                totalRevenue: 0,
                users: []
            };

            for (const userUsage of usageData) {
                const user = await this.db.getUserByAddress(userUsage.userId);
                if (!user) continue;

                const tier = user.tier || 'free';
                const limits = this.tierLimits[tier] || {};
                
                const baseCost = this.config.billing?.pricing?.[tier] || 0;
                const overageCharges = this.calculateOverageCharges(userUsage, limits);
                const totalCost = baseCost + overageCharges;

                billingReport.totalRevenue += totalCost;
                billingReport.users.push({
                    userId: userUsage.userId,
                    email: user.email,
                    tier,
                    usage: userUsage,
                    billing: {
                        baseCost,
                        overageCharges,
                        totalCost
                    }
                });
            }

            // Store billing report
            await this.db.storeBillingReport(billingReport);

            return billingReport;

        } catch (error) {
            console.error('Error generating billing report:', error);
            throw error;
        }
    }

    /**
     * Get Prometheus metrics format
     */
    async getPrometheusMetrics() {
        try {
            const metrics = [];
            
            // Request metrics
            metrics.push('# HELP api_requests_total Total number of API requests');
            metrics.push('# TYPE api_requests_total counter');
            for (const [key, value] of this.metrics.requests) {
                const [method, endpoint] = key.split(':');
                metrics.push(`api_requests_total{method="${method}",endpoint="${endpoint}"} ${value}`);
            }

            // Response metrics
            metrics.push('# HELP api_responses_total Total number of API responses by status code');
            metrics.push('# TYPE api_responses_total counter');
            for (const [statusCode, count] of this.metrics.responses) {
                metrics.push(`api_responses_total{status_code="${statusCode}"} ${count}`);
            }

            // Performance metrics
            metrics.push('# HELP api_response_time_seconds API response time in seconds');
            metrics.push('# TYPE api_response_time_seconds histogram');
            const performanceStats = this.getPerformanceStats();
            metrics.push(`api_response_time_seconds_sum ${performanceStats.totalTime / 1000}`);
            metrics.push(`api_response_time_seconds_count ${performanceStats.count}`);

            // System metrics
            const systemMetrics = this.getSystemMetrics();
            metrics.push('# HELP process_memory_usage_bytes Process memory usage');
            metrics.push('# TYPE process_memory_usage_bytes gauge');
            metrics.push(`process_memory_usage_bytes{type="rss"} ${systemMetrics.memoryUsage.rss}`);
            metrics.push(`process_memory_usage_bytes{type="heapUsed"} ${systemMetrics.memoryUsage.heapUsed}`);
            
            metrics.push('# HELP process_uptime_seconds Process uptime in seconds');
            metrics.push('# TYPE process_uptime_seconds gauge');
            metrics.push(`process_uptime_seconds ${systemMetrics.uptime}`);

            return metrics.join('\n');

        } catch (error) {
            console.error('Error generating Prometheus metrics:', error);
            return '';
        }
    }

    /**
     * Update user statistics
     */
    async updateUserStats(userId, stats) {
        try {
            const currentStats = await this.db.getUserStats(userId) || {};
            
            const updatedStats = {
                totalOrders: (currentStats.totalOrders || 0) + (stats.totalOrders || 0),
                totalVolume: BigInt(currentStats.totalVolume || 0) + BigInt(stats.totalVolume || 0),
                totalGasSaved: BigInt(currentStats.totalGasSaved || 0) + BigInt(stats.totalGasSaved || 0),
                lastUpdated: new Date()
            };

            // Calculate success rate
            if (stats.successfulOrders !== undefined && stats.totalOrderAttempts !== undefined) {
                const totalSuccessful = (currentStats.successfulOrders || 0) + stats.successfulOrders;
                const totalAttempts = (currentStats.totalOrderAttempts || 0) + stats.totalOrderAttempts;
                updatedStats.successRate = totalAttempts > 0 ? totalSuccessful / totalAttempts : 0;
                updatedStats.successfulOrders = totalSuccessful;
                updatedStats.totalOrderAttempts = totalAttempts;
            }

            await this.db.updateUserStats(userId, updatedStats);

        } catch (error) {
            console.error('Error updating user stats:', error);
        }
    }

    /**
     * Get system analytics
     */
    async getSystemAnalytics() {
        try {
            const analytics = await this.db.getSystemAnalytics();
            
            return {
                totalUsers: analytics.totalUsers || 0,
                totalOrders: analytics.totalOrders || 0,
                totalVolume: analytics.totalVolume || '0',
                totalRequests: analytics.totalRequests || 0,
                averageResponseTime: analytics.averageResponseTime || 0,
                errorRate: analytics.errorRate || 0,
                topEndpoints: analytics.topEndpoints || [],
                topUsers: analytics.topUsers || [],
                revenueMetrics: analytics.revenueMetrics || {},
                systemHealth: this.getSystemMetrics()
            };

        } catch (error) {
            console.error('Error getting system analytics:', error);
            throw error;
        }
    }

    /**
     * Helper methods
     */
    updateMetric(category, key, value) {
        const metricMap = this.metrics[category];
        if (!metricMap) return;
        
        const current = metricMap.get(key) || 0;
        metricMap.set(key, current + value);
    }

    getMetricKey(method, url) {
        // Normalize URL to remove IDs and query params
        const normalizedUrl = url.split('?')[0].replace(/\/\d+/g, '/:id');
        return `${method}:${normalizedUrl}`;
    }

    generateId() {
        return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    parseTimeRange(timeRange) {
        const units = {
            '1h': 3600000,
            '24h': 86400000,
            '7d': 604800000,
            '30d': 2592000000
        };
        return units[timeRange] || units['24h'];
    }

    getPeriodRange(period) {
        const now = new Date();
        let startTime, endTime = now;

        switch (period) {
            case 'current_month':
                startTime = new Date(now.getFullYear(), now.getMonth(), 1);
                break;
            case 'last_month':
                startTime = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                endTime = new Date(now.getFullYear(), now.getMonth(), 0);
                break;
            case 'current_year':
                startTime = new Date(now.getFullYear(), 0, 1);
                break;
            default:
                startTime = new Date(now.getTime() - 86400000); // 24 hours
        }

        return { startTime, endTime };
    }

    calculateEstimatedCost(usage, tier) {
        const baseCost = this.config.billing?.pricing?.[tier] || 0;
        const limits = this.tierLimits[tier] || {};
        
        return baseCost + this.calculateOverageCharges(usage, limits);
    }

    calculateOverageCharges(usage, limits) {
        let overageCharges = 0;
        
        // Calculate overage for each usage type
        if (limits.requestsPerMonth > 0 && usage.requests > limits.requestsPerMonth) {
            const overage = usage.requests - limits.requestsPerMonth;
            overageCharges += overage * (this.config.billing?.overage?.perRequest || 0.001);
        }
        
        if (limits.dataTransferPerMonth > 0 && usage.dataTransfer > limits.dataTransferPerMonth) {
            const overage = usage.dataTransfer - limits.dataTransferPerMonth;
            overageCharges += overage * (this.config.billing?.overage?.perGB || 0.1);
        }
        
        return overageCharges;
    }

    getNextBillingDate(userId) {
        // This would be retrieved from the database in a real implementation
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth() + 1, 1);
    }

    updateSystemMetrics() {
        this.systemMetrics = {
            uptime: process.uptime(),
            memoryUsage: process.memoryUsage(),
            cpuUsage: process.cpuUsage(),
            timestamp: Date.now()
        };
    }

    getSystemMetrics() {
        return {
            ...this.systemMetrics,
            activeConnections: this.metrics.requests.size,
            totalRequests: Array.from(this.metrics.requests.values()).reduce((a, b) => a + b, 0),
            totalErrors: Array.from(this.metrics.errors.values()).reduce((a, b) => a + b, 0)
        };
    }

    getPerformanceStats() {
        if (this.performanceBuffer.length === 0) {
            return { count: 0, totalTime: 0, averageTime: 0 };
        }

        const totalTime = this.performanceBuffer.reduce((sum, item) => sum + item.responseTime, 0);
        return {
            count: this.performanceBuffer.length,
            totalTime,
            averageTime: totalTime / this.performanceBuffer.length
        };
    }

    async processMetrics() {
        try {
            // Store current metrics to database
            const metricsSnapshot = {
                timestamp: new Date(),
                requests: Object.fromEntries(this.metrics.requests),
                responses: Object.fromEntries(this.metrics.responses),
                errors: Object.fromEntries(this.metrics.errors),
                performance: Object.fromEntries(this.metrics.performance),
                system: this.systemMetrics
            };

            await this.db.storeMetricsSnapshot(metricsSnapshot);

            // Reset counters (keep last hour for rate calculations)
            // In production, you might want to implement a sliding window instead

        } catch (error) {
            console.error('Error processing metrics:', error);
        }
    }

    async flushPerformanceBuffer() {
        if (this.performanceBuffer.length === 0) return;

        try {
            // Store performance data in batches
            await this.db.storePerformanceData(this.performanceBuffer);
            this.performanceBuffer = [];

        } catch (error) {
            console.error('Error flushing performance buffer:', error);
        }
    }

    async processBillingData() {
        try {
            // Process current billing counters
            for (const [key, data] of this.billingCounters) {
                const [identifier, usageType] = key.split(':');
                
                await this.db.updateUsageRecord({
                    identifier,
                    usageType,
                    quantity: data.quantity,
                    metadata: data.metadata,
                    timestamp: data.lastUpdated
                });
            }

            // Reset counters
            this.billingCounters.clear();

        } catch (error) {
            console.error('Error processing billing data:', error);
        }
    }

    async generateDailyReport() {
        try {
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            
            const report = await this.getDashboardData('24h');
            await this.db.storeDailyReport(yesterday, report);

            this.emit('dailyReport', { date: yesterday, report });

        } catch (error) {
            console.error('Error generating daily report:', error);
        }
    }

    // Async storage methods (to be implemented based on database choice)
    async storeRequestData(data) {
        // Implementation would store to database
    }

    async storeResponseData(data) {
        // Implementation would store to database
    }

    async storeEventData(data) {
        // Implementation would store to database
    }

    async getEntityInfo(identifier) {
        // Implementation would get user or API key info
        return { tier: 'free' };
    }

    async getPerformanceMetrics(startTime, endTime, userId) {
        // Implementation would get performance metrics from database
        return {};
    }

    async getUsageMetrics(startTime, endTime, userId) {
        // Implementation would get usage metrics from database
        return {};
    }

    /**
     * Initialize service
     */
    async initialize() {
        // Load any persistent data
        this.updateSystemMetrics();
        console.log('✅ AnalyticsService initialized successfully');
    }

    /**
     * Health check
     */
    async healthCheck() {
        return {
            status: 'healthy',
            metricsBufferSize: this.performanceBuffer.length,
            billingCounters: this.billingCounters.size,
            systemMetrics: this.systemMetrics
        };
    }
}

export default AnalyticsService;