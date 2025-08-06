const EventEmitter = require('events');
const Redis = require('ioredis');
const { StatsD } = require('node-statsd');

/**
 * Business SLA Monitoring System
 * Tracks and monitors Service Level Agreements and business metrics
 */
class SLAMonitor extends EventEmitter {
    constructor(config) {
        super();
        
        this.config = {
            redisUrl: config.redisUrl || 'redis://localhost:6379',
            checkInterval: config.checkInterval || 60000, // 1 minute
            ...config
        };
        
        this.redis = new Redis(this.config.redisUrl);
        this.slas = new Map();
        this.measurements = new Map();
        
        // StatsD client
        this.statsd = new StatsD({
            host: config.statsdHost || 'localhost',
            port: config.statsdPort || 8125,
            prefix: 'swappiq.sla.'
        });
        
        // SLA types
        this.slaTypes = {
            availability: this.checkAvailabilitySLA.bind(this),
            latency: this.checkLatencySLA.bind(this),
            throughput: this.checkThroughputSLA.bind(this),
            errorRate: this.checkErrorRateSLA.bind(this),
            successRate: this.checkSuccessRateSLA.bind(this),
            composite: this.checkCompositeSLA.bind(this)
        };
        
        this.startSLAMonitoring();
    }
    
    /**
     * Define an SLA
     */
    defineSLA(slaConfig) {
        const sla = {
            id: slaConfig.id,
            name: slaConfig.name,
            description: slaConfig.description,
            type: slaConfig.type,
            target: slaConfig.target,
            measurement: slaConfig.measurement,
            window: slaConfig.window || 300000, // 5 minutes default
            businessHours: slaConfig.businessHours || null,
            excludeMaintenanceWindows: slaConfig.excludeMaintenanceWindows || true,
            criticalThreshold: slaConfig.criticalThreshold || slaConfig.target,
            warningThreshold: slaConfig.warningThreshold || slaConfig.target * 0.95,
            components: slaConfig.components || [], // For composite SLAs
            metadata: slaConfig.metadata || {},
            active: true,
            createdAt: Date.now()
        };
        
        this.slas.set(sla.id, sla);
        this.emit('slaCreated', sla);
        
        return sla;
    }
    
    /**
     * Record SLA measurement
     */
    async recordMeasurement(slaId, value, timestamp = Date.now()) {
        const sla = this.slas.get(slaId);
        if (!sla || !sla.active) return;
        
        // Check if within business hours
        if (sla.businessHours && !this.isWithinBusinessHours(timestamp, sla.businessHours)) {
            return;
        }
        
        // Check if in maintenance window
        if (sla.excludeMaintenanceWindows && await this.isInMaintenanceWindow(timestamp)) {
            return;
        }
        
        // Store measurement
        const measurementKey = `sla:${slaId}:measurements`;
        await this.redis.zadd(measurementKey, timestamp, JSON.stringify({ value, timestamp }));
        
        // Expire old measurements
        const expireTime = timestamp - (sla.window * 10); // Keep 10 windows
        await this.redis.zremrangebyscore(measurementKey, '-inf', expireTime);
        
        // Update current measurement cache
        if (!this.measurements.has(slaId)) {
            this.measurements.set(slaId, []);
        }
        
        const measurements = this.measurements.get(slaId);
        measurements.push({ value, timestamp });
        
        // Keep only recent measurements
        const cutoffTime = timestamp - sla.window;
        this.measurements.set(
            slaId,
            measurements.filter(m => m.timestamp > cutoffTime)
        );
        
        // Check SLA compliance immediately
        await this.checkSLACompliance(slaId);
    }
    
    /**
     * Check SLA compliance
     */
    async checkSLACompliance(slaId) {
        const sla = this.slas.get(slaId);
        if (!sla || !sla.active) return;
        
        try {
            const checker = this.slaTypes[sla.type];
            if (!checker) {
                throw new Error(`Unknown SLA type: ${sla.type}`);
            }
            
            const result = await checker(sla);
            
            // Emit events based on compliance
            if (!result.compliant) {
                this.emit('slaViolation', {
                    sla,
                    result,
                    timestamp: Date.now()
                });
                
                // Track violation
                this.statsd.increment(`violation.${slaId}`);
            } else if (result.value < sla.warningThreshold) {
                this.emit('slaWarning', {
                    sla,
                    result,
                    timestamp: Date.now()
                });
            }
            
            // Update SLA status
            sla.lastCheck = Date.now();
            sla.lastResult = result;
            sla.status = result.compliant ? 'compliant' : 'violated';
            
            // Record metrics
            this.statsd.gauge(`compliance.${slaId}`, result.value);
            
            return result;
            
        } catch (error) {
            console.error(`SLA check error for ${slaId}:`, error);
            this.emit('error', { slaId, error });
        }
    }
    
    /**
     * Check availability SLA
     */
    async checkAvailabilitySLA(sla) {
        const measurements = await this.getRecentMeasurements(sla.id, sla.window);
        
        if (measurements.length === 0) {
            return {
                compliant: false,
                value: 0,
                target: sla.target,
                reason: 'No measurements available'
            };
        }
        
        // Calculate uptime percentage
        const totalChecks = measurements.length;
        const successfulChecks = measurements.filter(m => m.value === 1).length;
        const availability = (successfulChecks / totalChecks) * 100;
        
        return {
            compliant: availability >= sla.target,
            value: availability,
            target: sla.target,
            totalChecks,
            successfulChecks,
            failedChecks: totalChecks - successfulChecks,
            window: sla.window,
            details: {
                downtimeMinutes: ((totalChecks - successfulChecks) * sla.window) / 60000,
                lastFailure: measurements.find(m => m.value === 0)?.timestamp
            }
        };
    }
    
    /**
     * Check latency SLA
     */
    async checkLatencySLA(sla) {
        const measurements = await this.getRecentMeasurements(sla.id, sla.window);
        
        if (measurements.length === 0) {
            return {
                compliant: false,
                value: 0,
                target: sla.target,
                reason: 'No measurements available'
            };
        }
        
        // Calculate percentile (default p95)
        const percentile = sla.measurement.percentile || 95;
        const sorted = measurements.map(m => m.value).sort((a, b) => a - b);
        const index = Math.ceil((percentile / 100) * sorted.length) - 1;
        const percentileValue = sorted[index];
        
        // Calculate statistics
        const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
        const min = sorted[0];
        const max = sorted[sorted.length - 1];
        
        return {
            compliant: percentileValue <= sla.target,
            value: percentileValue,
            target: sla.target,
            percentile,
            measurements: sorted.length,
            statistics: {
                average: avg,
                min,
                max,
                p50: sorted[Math.floor(sorted.length / 2)],
                p95: sorted[Math.floor(sorted.length * 0.95)],
                p99: sorted[Math.floor(sorted.length * 0.99)]
            }
        };
    }
    
    /**
     * Check throughput SLA
     */
    async checkThroughputSLA(sla) {
        const measurements = await this.getRecentMeasurements(sla.id, sla.window);
        
        if (measurements.length === 0) {
            return {
                compliant: false,
                value: 0,
                target: sla.target,
                reason: 'No measurements available'
            };
        }
        
        // Calculate throughput (requests per second)
        const windowSeconds = sla.window / 1000;
        const totalRequests = measurements.reduce((sum, m) => sum + m.value, 0);
        const throughput = totalRequests / windowSeconds;
        
        // Calculate statistics
        const values = measurements.map(m => m.value);
        const maxBurst = Math.max(...values);
        const avgRate = values.reduce((a, b) => a + b, 0) / values.length;
        
        return {
            compliant: throughput >= sla.target,
            value: throughput,
            target: sla.target,
            totalRequests,
            windowSeconds,
            statistics: {
                averageRate: avgRate,
                maxBurst,
                measurements: values.length
            }
        };
    }
    
    /**
     * Check error rate SLA
     */
    async checkErrorRateSLA(sla) {
        const measurements = await this.getRecentMeasurements(sla.id, sla.window);
        
        if (measurements.length === 0) {
            return {
                compliant: true,
                value: 0,
                target: sla.target,
                reason: 'No measurements available'
            };
        }
        
        // Calculate error rate
        const totalRequests = measurements.length;
        const errors = measurements.filter(m => m.value === 1).length; // 1 = error
        const errorRate = (errors / totalRequests) * 100;
        
        // Get error details
        const errorTypes = {};
        for (const m of measurements) {
            if (m.value === 1 && m.errorType) {
                errorTypes[m.errorType] = (errorTypes[m.errorType] || 0) + 1;
            }
        }
        
        return {
            compliant: errorRate <= sla.target,
            value: errorRate,
            target: sla.target,
            totalRequests,
            errors,
            errorTypes,
            details: {
                lastError: measurements.filter(m => m.value === 1).pop()?.timestamp,
                errorRate: `${errorRate.toFixed(2)}%`
            }
        };
    }
    
    /**
     * Check success rate SLA
     */
    async checkSuccessRateSLA(sla) {
        const measurements = await this.getRecentMeasurements(sla.id, sla.window);
        
        if (measurements.length === 0) {
            return {
                compliant: false,
                value: 0,
                target: sla.target,
                reason: 'No measurements available'
            };
        }
        
        // Calculate success rate
        const totalOperations = measurements.length;
        const successful = measurements.filter(m => m.value === 1).length; // 1 = success
        const successRate = (successful / totalOperations) * 100;
        
        // Get failure reasons
        const failureReasons = {};
        for (const m of measurements) {
            if (m.value === 0 && m.reason) {
                failureReasons[m.reason] = (failureReasons[m.reason] || 0) + 1;
            }
        }
        
        return {
            compliant: successRate >= sla.target,
            value: successRate,
            target: sla.target,
            totalOperations,
            successful,
            failed: totalOperations - successful,
            failureReasons,
            details: {
                successRate: `${successRate.toFixed(2)}%`,
                lastFailure: measurements.filter(m => m.value === 0).pop()?.timestamp
            }
        };
    }
    
    /**
     * Check composite SLA
     */
    async checkCompositeSLA(sla) {
        const componentResults = [];
        let allCompliant = true;
        let weightedScore = 0;
        let totalWeight = 0;
        
        for (const component of sla.components) {
            const componentSLA = this.slas.get(component.slaId);
            if (!componentSLA) continue;
            
            const result = await this.checkSLACompliance(component.slaId);
            const weight = component.weight || 1;
            
            componentResults.push({
                slaId: component.slaId,
                name: componentSLA.name,
                result,
                weight
            });
            
            if (!result.compliant) {
                allCompliant = false;
            }
            
            // Calculate weighted score
            const normalizedValue = result.value / result.target;
            weightedScore += normalizedValue * weight;
            totalWeight += weight;
        }
        
        const compositeScore = totalWeight > 0 ? (weightedScore / totalWeight) * 100 : 0;
        
        return {
            compliant: allCompliant && compositeScore >= sla.target,
            value: compositeScore,
            target: sla.target,
            components: componentResults,
            allCompliant,
            details: {
                totalComponents: sla.components.length,
                compliantComponents: componentResults.filter(c => c.result.compliant).length,
                weightedScore: compositeScore.toFixed(2)
            }
        };
    }
    
    /**
     * Get recent measurements
     */
    async getRecentMeasurements(slaId, window) {
        const cached = this.measurements.get(slaId);
        const cutoffTime = Date.now() - window;
        
        if (cached && cached.length > 0 && cached[0].timestamp > cutoffTime) {
            return cached.filter(m => m.timestamp > cutoffTime);
        }
        
        // Fetch from Redis
        const key = `sla:${slaId}:measurements`;
        const data = await this.redis.zrangebyscore(
            key,
            cutoffTime,
            '+inf',
            'WITHSCORES'
        );
        
        const measurements = [];
        for (let i = 0; i < data.length; i += 2) {
            const measurement = JSON.parse(data[i]);
            measurements.push(measurement);
        }
        
        return measurements;
    }
    
    /**
     * Check if within business hours
     */
    isWithinBusinessHours(timestamp, businessHours) {
        const date = new Date(timestamp);
        const dayOfWeek = date.getDay();
        const hour = date.getHours();
        const minute = date.getMinutes();
        
        // Check if day is included
        if (!businessHours.days.includes(dayOfWeek)) {
            return false;
        }
        
        // Check time
        const currentMinutes = hour * 60 + minute;
        const startMinutes = businessHours.startHour * 60 + (businessHours.startMinute || 0);
        const endMinutes = businessHours.endHour * 60 + (businessHours.endMinute || 0);
        
        return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
    }
    
    /**
     * Check if in maintenance window
     */
    async isInMaintenanceWindow(timestamp) {
        const windows = await this.redis.zrangebyscore(
            'maintenance_windows',
            timestamp,
            timestamp
        );
        
        return windows.length > 0;
    }
    
    /**
     * Get SLA report
     */
    async getSLAReport(slaId, startTime, endTime) {
        const sla = this.slas.get(slaId);
        if (!sla) return null;
        
        // Get historical measurements
        const key = `sla:${slaId}:measurements`;
        const data = await this.redis.zrangebyscore(
            key,
            startTime,
            endTime,
            'WITHSCORES'
        );
        
        const measurements = [];
        for (let i = 0; i < data.length; i += 2) {
            measurements.push(JSON.parse(data[i]));
        }
        
        // Calculate compliance over time windows
        const windowSize = 3600000; // 1 hour
        const windows = [];
        
        for (let time = startTime; time < endTime; time += windowSize) {
            const windowMeasurements = measurements.filter(
                m => m.timestamp >= time && m.timestamp < time + windowSize
            );
            
            if (windowMeasurements.length > 0) {
                const result = await this.calculateWindowCompliance(sla, windowMeasurements);
                windows.push({
                    startTime: time,
                    endTime: time + windowSize,
                    ...result
                });
            }
        }
        
        // Calculate overall statistics
        const overallResult = await this.calculateWindowCompliance(sla, measurements);
        
        return {
            sla,
            period: { startTime, endTime },
            overall: overallResult,
            windows,
            summary: {
                totalWindows: windows.length,
                compliantWindows: windows.filter(w => w.compliant).length,
                compliancePercentage: (windows.filter(w => w.compliant).length / windows.length) * 100
            }
        };
    }
    
    /**
     * Calculate compliance for a time window
     */
    async calculateWindowCompliance(sla, measurements) {
        switch (sla.type) {
            case 'availability':
                const successful = measurements.filter(m => m.value === 1).length;
                const availability = (successful / measurements.length) * 100;
                return {
                    compliant: availability >= sla.target,
                    value: availability,
                    measurements: measurements.length
                };
                
            case 'latency':
                const sorted = measurements.map(m => m.value).sort((a, b) => a - b);
                const p95 = sorted[Math.floor(sorted.length * 0.95)];
                return {
                    compliant: p95 <= sla.target,
                    value: p95,
                    measurements: measurements.length
                };
                
            default:
                return {
                    compliant: false,
                    value: 0,
                    measurements: measurements.length
                };
        }
    }
    
    /**
     * Start SLA monitoring
     */
    startSLAMonitoring() {
        setInterval(async () => {
            try {
                for (const [slaId, sla] of this.slas) {
                    if (sla.active) {
                        await this.checkSLACompliance(slaId);
                    }
                }
            } catch (error) {
                console.error('SLA monitoring error:', error);
                this.emit('error', error);
            }
        }, this.config.checkInterval);
    }
    
    /**
     * Export SLA configuration
     */
    exportSLAs() {
        const slas = [];
        for (const [id, sla] of this.slas) {
            slas.push({
                ...sla,
                lastResult: undefined // Don't export runtime data
            });
        }
        return slas;
    }
    
    /**
     * Import SLA configuration
     */
    importSLAs(slas) {
        for (const sla of slas) {
            this.defineSLA(sla);
        }
    }
}

module.exports = SLAMonitor;