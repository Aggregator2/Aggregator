const EventEmitter = require('events');
const { StatsD } = require('node-statsd');
const Redis = require('ioredis');

/**
 * ML-based Anomaly Detection System
 * Uses statistical methods and pattern recognition for real-time anomaly detection
 */
class AnomalyDetector extends EventEmitter {
    constructor(config) {
        super();
        
        this.config = {
            redisUrl: config.redisUrl || 'redis://localhost:6379',
            windowSize: config.windowSize || 300, // 5 minutes
            sensitivity: config.sensitivity || 2.5, // Standard deviations
            minDataPoints: config.minDataPoints || 20,
            seasonalityPeriod: config.seasonalityPeriod || 86400, // 24 hours
            ...config
        };
        
        this.redis = new Redis(this.config.redisUrl);
        this.models = new Map(); // Metric -> Model mapping
        this.alerts = new Map();
        
        // Initialize StatsD for metrics
        this.statsd = new StatsD({
            host: config.statsdHost || 'localhost',
            port: config.statsdPort || 8125,
            prefix: 'swappiq.anomaly.'
        });
        
        // Detection algorithms
        this.algorithms = {
            'zscore': this.zScoreDetection.bind(this),
            'mad': this.madDetection.bind(this),
            'isolation_forest': this.isolationForestDetection.bind(this),
            'lstm': this.lstmDetection.bind(this),
            'prophet': this.prophetDetection.bind(this)
        };
        
        this.startPeriodicDetection();
    }
    
    /**
     * Train model for a specific metric
     */
    async trainModel(metricName, historicalData, algorithm = 'zscore') {
        const model = {
            metric: metricName,
            algorithm,
            trained: false,
            parameters: {},
            statistics: {},
            lastTraining: null
        };
        
        switch (algorithm) {
            case 'zscore':
            case 'mad':
                model.statistics = this.calculateStatistics(historicalData);
                model.trained = true;
                break;
                
            case 'isolation_forest':
                model.parameters = await this.trainIsolationForest(historicalData);
                model.trained = true;
                break;
                
            case 'lstm':
                model.parameters = await this.trainLSTM(historicalData);
                model.trained = true;
                break;
                
            case 'prophet':
                model.parameters = await this.trainProphet(historicalData);
                model.trained = true;
                break;
        }
        
        model.lastTraining = new Date();
        this.models.set(metricName, model);
        
        // Store model in Redis
        await this.redis.set(
            `model:${metricName}`,
            JSON.stringify(model),
            'EX',
            86400 // 24 hour expiry
        );
        
        this.emit('modelTrained', { metric: metricName, algorithm });
        return model;
    }
    
    /**
     * Detect anomalies in real-time data
     */
    async detectAnomaly(metricName, value, timestamp = Date.now()) {
        const model = this.models.get(metricName);
        if (!model || !model.trained) {
            // Auto-train if no model exists
            const historicalData = await this.getHistoricalData(metricName);
            if (historicalData.length >= this.config.minDataPoints) {
                await this.trainModel(metricName, historicalData);
            } else {
                return { isAnomaly: false, reason: 'Insufficient data' };
            }
        }
        
        // Run detection algorithm
        const algorithm = this.algorithms[model.algorithm];
        const result = await algorithm(metricName, value, model);
        
        // Store data point
        await this.storeDataPoint(metricName, value, timestamp);
        
        // Update statistics incrementally
        this.updateIncrementalStats(model, value);
        
        if (result.isAnomaly) {
            await this.handleAnomaly(metricName, value, result, timestamp);
        }
        
        return result;
    }
    
    /**
     * Z-Score based anomaly detection
     */
    async zScoreDetection(metricName, value, model) {
        const { mean, stdDev } = model.statistics;
        const zScore = Math.abs((value - mean) / stdDev);
        
        const isAnomaly = zScore > this.config.sensitivity;
        const anomalyScore = zScore / this.config.sensitivity;
        
        return {
            isAnomaly,
            algorithm: 'zscore',
            score: anomalyScore,
            threshold: this.config.sensitivity,
            zScore,
            expectedRange: {
                min: mean - (this.config.sensitivity * stdDev),
                max: mean + (this.config.sensitivity * stdDev)
            },
            confidence: Math.min(0.99, 1 - Math.exp(-zScore))
        };
    }
    
    /**
     * Median Absolute Deviation (MAD) detection
     */
    async madDetection(metricName, value, model) {
        const { median, mad } = model.statistics;
        const modifiedZScore = 0.6745 * Math.abs(value - median) / mad;
        
        const isAnomaly = modifiedZScore > this.config.sensitivity;
        const anomalyScore = modifiedZScore / this.config.sensitivity;
        
        return {
            isAnomaly,
            algorithm: 'mad',
            score: anomalyScore,
            threshold: this.config.sensitivity,
            modifiedZScore,
            expectedRange: {
                min: median - (this.config.sensitivity * mad / 0.6745),
                max: median + (this.config.sensitivity * mad / 0.6745)
            },
            confidence: Math.min(0.99, 1 - Math.exp(-modifiedZScore))
        };
    }
    
    /**
     * Isolation Forest detection (simplified version)
     */
    async isolationForestDetection(metricName, value, model) {
        // Simplified isolation score calculation
        const { trees, avgPathLength } = model.parameters;
        
        let totalPathLength = 0;
        for (const tree of trees) {
            totalPathLength += this.getPathLength(value, tree);
        }
        
        const avgPath = totalPathLength / trees.length;
        const anomalyScore = Math.pow(2, -avgPath / avgPathLength);
        
        const isAnomaly = anomalyScore > 0.6;
        
        return {
            isAnomaly,
            algorithm: 'isolation_forest',
            score: anomalyScore,
            threshold: 0.6,
            avgPathLength: avgPath,
            confidence: anomalyScore
        };
    }
    
    /**
     * LSTM-based detection (simplified)
     */
    async lstmDetection(metricName, value, model) {
        // Get recent sequence
        const sequence = await this.getRecentSequence(metricName, 10);
        
        // Simplified LSTM prediction
        const { weights, bias } = model.parameters;
        const prediction = this.simpleLSTMPredict(sequence, weights, bias);
        
        const error = Math.abs(value - prediction);
        const threshold = model.statistics.stdDev * this.config.sensitivity;
        const isAnomaly = error > threshold;
        
        return {
            isAnomaly,
            algorithm: 'lstm',
            score: error / threshold,
            threshold,
            prediction,
            actual: value,
            error,
            confidence: Math.min(0.99, 1 - Math.exp(-error / threshold))
        };
    }
    
    /**
     * Prophet-based detection (simplified)
     */
    async prophetDetection(metricName, value, model) {
        const { trend, seasonality, holidays } = model.parameters;
        const timestamp = Date.now();
        
        // Calculate expected value
        const trendValue = this.calculateTrend(timestamp, trend);
        const seasonalValue = this.calculateSeasonality(timestamp, seasonality);
        const holidayEffect = this.getHolidayEffect(timestamp, holidays);
        
        const expected = trendValue + seasonalValue + holidayEffect;
        const error = Math.abs(value - expected);
        const threshold = model.statistics.stdDev * this.config.sensitivity;
        const isAnomaly = error > threshold;
        
        return {
            isAnomaly,
            algorithm: 'prophet',
            score: error / threshold,
            threshold,
            expected,
            actual: value,
            components: {
                trend: trendValue,
                seasonality: seasonalValue,
                holiday: holidayEffect
            },
            confidence: Math.min(0.99, 1 - Math.exp(-error / threshold))
        };
    }
    
    /**
     * Handle detected anomalies
     */
    async handleAnomaly(metricName, value, detection, timestamp) {
        const anomaly = {
            metric: metricName,
            value,
            timestamp,
            detection,
            id: `${metricName}-${timestamp}`,
            severity: this.calculateSeverity(detection)
        };
        
        // Check if this is a new anomaly or continuation
        const lastAlert = this.alerts.get(metricName);
        if (!lastAlert || timestamp - lastAlert.timestamp > 300000) { // 5 minutes
            // New anomaly
            this.emit('anomalyDetected', anomaly);
            
            // Store in Redis
            await this.redis.zadd(
                'anomalies',
                timestamp,
                JSON.stringify(anomaly)
            );
            
            // Update metrics
            this.statsd.increment(`anomaly.detected.${metricName}`);
            this.statsd.gauge(`anomaly.score.${metricName}`, detection.score);
        }
        
        this.alerts.set(metricName, anomaly);
    }
    
    /**
     * Calculate anomaly severity
     */
    calculateSeverity(detection) {
        const { score, confidence } = detection;
        
        if (score > 5 && confidence > 0.9) return 'critical';
        if (score > 3 && confidence > 0.8) return 'high';
        if (score > 2 && confidence > 0.7) return 'medium';
        return 'low';
    }
    
    /**
     * Get historical data for training
     */
    async getHistoricalData(metricName, hours = 24) {
        const endTime = Date.now();
        const startTime = endTime - (hours * 3600000);
        
        const data = await this.redis.zrangebyscore(
            `metric:${metricName}`,
            startTime,
            endTime,
            'WITHSCORES'
        );
        
        const points = [];
        for (let i = 0; i < data.length; i += 2) {
            points.push({
                value: parseFloat(data[i]),
                timestamp: parseInt(data[i + 1])
            });
        }
        
        return points;
    }
    
    /**
     * Store data point
     */
    async storeDataPoint(metricName, value, timestamp) {
        await this.redis.zadd(
            `metric:${metricName}`,
            timestamp,
            value.toString()
        );
        
        // Expire old data (keep 7 days)
        const expireTime = timestamp - (7 * 86400000);
        await this.redis.zremrangebyscore(
            `metric:${metricName}`,
            '-inf',
            expireTime
        );
    }
    
    /**
     * Calculate statistics for a dataset
     */
    calculateStatistics(data) {
        const values = data.map(d => d.value);
        const n = values.length;
        
        // Mean
        const mean = values.reduce((a, b) => a + b, 0) / n;
        
        // Standard deviation
        const variance = values.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / n;
        const stdDev = Math.sqrt(variance);
        
        // Median
        const sorted = [...values].sort((a, b) => a - b);
        const median = n % 2 === 0
            ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
            : sorted[Math.floor(n / 2)];
        
        // MAD
        const deviations = values.map(v => Math.abs(v - median));
        const madSorted = deviations.sort((a, b) => a - b);
        const mad = n % 2 === 0
            ? (madSorted[n / 2 - 1] + madSorted[n / 2]) / 2
            : madSorted[Math.floor(n / 2)];
        
        // Percentiles
        const p95 = sorted[Math.floor(n * 0.95)];
        const p99 = sorted[Math.floor(n * 0.99)];
        
        return {
            mean,
            stdDev,
            median,
            mad,
            min: sorted[0],
            max: sorted[n - 1],
            p95,
            p99,
            count: n
        };
    }
    
    /**
     * Update statistics incrementally
     */
    updateIncrementalStats(model, value) {
        const stats = model.statistics;
        const n = stats.count;
        
        // Update mean incrementally
        const newMean = (stats.mean * n + value) / (n + 1);
        
        // Update variance incrementally
        const newVariance = (n * (stats.stdDev * stats.stdDev + Math.pow(stats.mean - newMean, 2)) +
            Math.pow(value - newMean, 2)) / (n + 1);
        
        stats.mean = newMean;
        stats.stdDev = Math.sqrt(newVariance);
        stats.count = n + 1;
        
        // Update min/max
        stats.min = Math.min(stats.min, value);
        stats.max = Math.max(stats.max, value);
    }
    
    /**
     * Train isolation forest (simplified)
     */
    async trainIsolationForest(data) {
        const numTrees = 100;
        const sampleSize = Math.min(256, data.length);
        const trees = [];
        
        for (let i = 0; i < numTrees; i++) {
            // Random sample
            const sample = this.randomSample(data, sampleSize);
            const tree = this.buildIsolationTree(sample.map(d => d.value), 0);
            trees.push(tree);
        }
        
        // Calculate average path length
        const avgPathLength = this.calculateAvgPathLength(sampleSize);
        
        return { trees, avgPathLength };
    }
    
    /**
     * Build isolation tree
     */
    buildIsolationTree(values, depth, maxDepth = 10) {
        if (values.length <= 1 || depth >= maxDepth) {
            return { type: 'leaf', size: values.length, depth };
        }
        
        const min = Math.min(...values);
        const max = Math.max(...values);
        
        if (min === max) {
            return { type: 'leaf', size: values.length, depth };
        }
        
        // Random split
        const splitValue = min + Math.random() * (max - min);
        const left = values.filter(v => v < splitValue);
        const right = values.filter(v => v >= splitValue);
        
        return {
            type: 'node',
            splitValue,
            left: this.buildIsolationTree(left, depth + 1, maxDepth),
            right: this.buildIsolationTree(right, depth + 1, maxDepth),
            depth
        };
    }
    
    /**
     * Get path length in isolation tree
     */
    getPathLength(value, tree) {
        if (tree.type === 'leaf') {
            return tree.depth + this.estimatePathLength(tree.size);
        }
        
        if (value < tree.splitValue) {
            return this.getPathLength(value, tree.left);
        } else {
            return this.getPathLength(value, tree.right);
        }
    }
    
    /**
     * Estimate average path length
     */
    calculateAvgPathLength(n) {
        if (n <= 1) return 0;
        if (n === 2) return 1;
        
        const H = Math.log(n - 1) + 0.5772156649; // Euler's constant
        return 2 * H - (2 * (n - 1) / n);
    }
    
    /**
     * Estimate path length for external nodes
     */
    estimatePathLength(n) {
        if (n <= 1) return 0;
        if (n === 2) return 1;
        return this.calculateAvgPathLength(n);
    }
    
    /**
     * Random sample from array
     */
    randomSample(array, size) {
        const shuffled = [...array].sort(() => 0.5 - Math.random());
        return shuffled.slice(0, size);
    }
    
    /**
     * Simple LSTM prediction
     */
    simpleLSTMPredict(sequence, weights, bias) {
        // Simplified LSTM calculation
        let hidden = 0;
        for (const value of sequence) {
            hidden = Math.tanh(hidden * weights.recurrent + value.value * weights.input + bias);
        }
        return hidden * weights.output;
    }
    
    /**
     * Train simplified LSTM
     */
    async trainLSTM(data) {
        // Very simplified LSTM training
        return {
            weights: {
                input: 0.5,
                recurrent: 0.8,
                output: 1.0
            },
            bias: 0.1
        };
    }
    
    /**
     * Train Prophet model (simplified)
     */
    async trainProphet(data) {
        // Simplified trend calculation
        const x = data.map((_, i) => i);
        const y = data.map(d => d.value);
        const trend = this.linearRegression(x, y);
        
        // Simplified seasonality (daily pattern)
        const seasonality = this.calculateDailySeasonality(data);
        
        return {
            trend,
            seasonality,
            holidays: []
        };
    }
    
    /**
     * Linear regression
     */
    linearRegression(x, y) {
        const n = x.length;
        const sumX = x.reduce((a, b) => a + b, 0);
        const sumY = y.reduce((a, b) => a + b, 0);
        const sumXY = x.reduce((acc, xi, i) => acc + xi * y[i], 0);
        const sumX2 = x.reduce((acc, xi) => acc + xi * xi, 0);
        
        const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
        const intercept = (sumY - slope * sumX) / n;
        
        return { slope, intercept };
    }
    
    /**
     * Calculate daily seasonality pattern
     */
    calculateDailySeasonality(data) {
        const hourlyAverages = new Array(24).fill(0);
        const hourlyCounts = new Array(24).fill(0);
        
        for (const point of data) {
            const hour = new Date(point.timestamp).getHours();
            hourlyAverages[hour] += point.value;
            hourlyCounts[hour]++;
        }
        
        return hourlyAverages.map((sum, hour) => 
            hourlyCounts[hour] > 0 ? sum / hourlyCounts[hour] : 0
        );
    }
    
    /**
     * Calculate trend value
     */
    calculateTrend(timestamp, trend) {
        const t = timestamp / 1000; // Convert to seconds
        return trend.slope * t + trend.intercept;
    }
    
    /**
     * Calculate seasonality value
     */
    calculateSeasonality(timestamp, seasonality) {
        const hour = new Date(timestamp).getHours();
        return seasonality[hour] || 0;
    }
    
    /**
     * Get holiday effect
     */
    getHolidayEffect(timestamp, holidays) {
        // Simplified: no holiday effect
        return 0;
    }
    
    /**
     * Get recent sequence
     */
    async getRecentSequence(metricName, length) {
        const data = await this.redis.zrevrange(
            `metric:${metricName}`,
            0,
            length - 1,
            'WITHSCORES'
        );
        
        const sequence = [];
        for (let i = 0; i < data.length; i += 2) {
            sequence.push({
                value: parseFloat(data[i]),
                timestamp: parseInt(data[i + 1])
            });
        }
        
        return sequence.reverse();
    }
    
    /**
     * Periodic detection for all metrics
     */
    startPeriodicDetection() {
        setInterval(async () => {
            try {
                // Get all tracked metrics
                const metrics = await this.redis.smembers('tracked_metrics');
                
                for (const metric of metrics) {
                    const latestData = await this.redis.zrevrange(
                        `metric:${metric}`,
                        0,
                        0,
                        'WITHSCORES'
                    );
                    
                    if (latestData.length >= 2) {
                        const value = parseFloat(latestData[0]);
                        const timestamp = parseInt(latestData[1]);
                        
                        // Only process recent data
                        if (Date.now() - timestamp < 60000) { // 1 minute
                            await this.detectAnomaly(metric, value, timestamp);
                        }
                    }
                }
            } catch (error) {
                console.error('Periodic detection error:', error);
                this.emit('error', error);
            }
        }, 10000); // Every 10 seconds
    }
    
    /**
     * Export models for persistence
     */
    async exportModels() {
        const models = {};
        for (const [metric, model] of this.models) {
            models[metric] = model;
        }
        return models;
    }
    
    /**
     * Import models
     */
    async importModels(models) {
        for (const [metric, model] of Object.entries(models)) {
            this.models.set(metric, model);
        }
    }
}

module.exports = AnomalyDetector;