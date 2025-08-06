const EventEmitter = require('events');
const AnomalyDetector = require('./AnomalyDetector');

/**
 * Predictive Alerting Framework
 * Predicts and prevents issues before they occur using trend analysis and ML
 */
class PredictiveAlerting extends EventEmitter {
    constructor(config) {
        super();
        
        this.config = {
            predictionWindow: config.predictionWindow || 3600000, // 1 hour ahead
            checkInterval: config.checkInterval || 60000, // 1 minute
            ...config
        };
        
        this.anomalyDetector = new AnomalyDetector(config);
        this.predictions = new Map();
        this.thresholds = new Map();
        
        // Prediction models
        this.predictors = {
            linear: this.linearPredictor.bind(this),
            exponential: this.exponentialPredictor.bind(this),
            polynomial: this.polynomialPredictor.bind(this),
            arima: this.arimaPredictor.bind(this),
            neural: this.neuralPredictor.bind(this)
        };
        
        // Resource exhaustion predictors
        this.resourcePredictors = {
            memory: this.predictMemoryExhaustion.bind(this),
            disk: this.predictDiskExhaustion.bind(this),
            connections: this.predictConnectionExhaustion.bind(this),
            rateLimit: this.predictRateLimitBreach.bind(this)
        };
        
        this.startPredictiveMonitoring();
    }
    
    /**
     * Set prediction threshold for a metric
     */
    setPredictionThreshold(metric, threshold) {
        this.thresholds.set(metric, {
            critical: threshold.critical,
            warning: threshold.warning || threshold.critical * 0.8,
            info: threshold.info || threshold.critical * 0.6,
            predictor: threshold.predictor || 'linear'
        });
    }
    
    /**
     * Predict future metric values
     */
    async predictMetric(metricName, timeAhead = this.config.predictionWindow) {
        try {
            // Get historical data
            const history = await this.anomalyDetector.getHistoricalData(metricName, 24);
            
            if (history.length < 10) {
                return {
                    metric: metricName,
                    prediction: null,
                    confidence: 0,
                    reason: 'Insufficient historical data'
                };
            }
            
            // Get threshold configuration
            const threshold = this.thresholds.get(metricName) || {
                predictor: 'linear'
            };
            
            // Run predictor
            const predictor = this.predictors[threshold.predictor];
            const prediction = await predictor(history, timeAhead);
            
            // Check for potential issues
            const issues = this.checkPredictedIssues(metricName, prediction, threshold);
            
            // Store prediction
            this.predictions.set(metricName, {
                timestamp: Date.now(),
                prediction,
                issues
            });
            
            // Emit alerts for predicted issues
            if (issues.length > 0) {
                this.emit('predictiveAlert', {
                    metric: metricName,
                    prediction,
                    issues,
                    timeToIssue: this.calculateTimeToIssue(prediction, threshold)
                });
            }
            
            return prediction;
            
        } catch (error) {
            console.error(`Prediction error for ${metricName}:`, error);
            this.emit('error', { metric: metricName, error });
            return null;
        }
    }
    
    /**
     * Linear trend predictor
     */
    async linearPredictor(history, timeAhead) {
        const n = history.length;
        const x = history.map((_, i) => i);
        const y = history.map(d => d.value);
        
        // Calculate linear regression
        const sumX = x.reduce((a, b) => a + b, 0);
        const sumY = y.reduce((a, b) => a + b, 0);
        const sumXY = x.reduce((acc, xi, i) => acc + xi * y[i], 0);
        const sumX2 = x.reduce((acc, xi) => acc + xi * xi, 0);
        
        const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
        const intercept = (sumY - slope * sumX) / n;
        
        // Calculate R-squared for confidence
        const yMean = sumY / n;
        const ssTotal = y.reduce((acc, yi) => acc + Math.pow(yi - yMean, 2), 0);
        const ssResidual = y.reduce((acc, yi, i) => 
            acc + Math.pow(yi - (slope * i + intercept), 2), 0);
        const rSquared = 1 - (ssResidual / ssTotal);
        
        // Time intervals
        const avgInterval = (history[n-1].timestamp - history[0].timestamp) / (n - 1);
        const futureSteps = Math.ceil(timeAhead / avgInterval);
        
        // Predict future values
        const predictions = [];
        const lastTimestamp = history[n-1].timestamp;
        
        for (let i = 1; i <= futureSteps; i++) {
            const futureX = n - 1 + i;
            const predictedValue = slope * futureX + intercept;
            const timestamp = lastTimestamp + (i * avgInterval);
            
            predictions.push({
                timestamp,
                value: predictedValue,
                confidence: rSquared * Math.exp(-i * 0.01) // Decay confidence over time
            });
        }
        
        return {
            algorithm: 'linear',
            slope,
            intercept,
            rSquared,
            predictions,
            currentTrend: slope > 0 ? 'increasing' : 'decreasing',
            trendStrength: Math.abs(slope),
            confidence: rSquared
        };
    }
    
    /**
     * Exponential trend predictor
     */
    async exponentialPredictor(history, timeAhead) {
        const n = history.length;
        const y = history.map(d => d.value);
        
        // Transform to log space for linear regression
        const logY = y.map(v => Math.log(Math.max(0.001, v)));
        const x = history.map((_, i) => i);
        
        // Linear regression in log space
        const sumX = x.reduce((a, b) => a + b, 0);
        const sumLogY = logY.reduce((a, b) => a + b, 0);
        const sumXLogY = x.reduce((acc, xi, i) => acc + xi * logY[i], 0);
        const sumX2 = x.reduce((acc, xi) => acc + xi * xi, 0);
        
        const b = (n * sumXLogY - sumX * sumLogY) / (n * sumX2 - sumX * sumX);
        const logA = (sumLogY - b * sumX) / n;
        const a = Math.exp(logA);
        
        // Calculate R-squared
        const logYMean = sumLogY / n;
        const ssTotal = logY.reduce((acc, yi) => acc + Math.pow(yi - logYMean, 2), 0);
        const ssResidual = logY.reduce((acc, yi, i) => 
            acc + Math.pow(yi - (logA + b * i), 2), 0);
        const rSquared = 1 - (ssResidual / ssTotal);
        
        // Predict future values
        const avgInterval = (history[n-1].timestamp - history[0].timestamp) / (n - 1);
        const futureSteps = Math.ceil(timeAhead / avgInterval);
        const predictions = [];
        const lastTimestamp = history[n-1].timestamp;
        
        for (let i = 1; i <= futureSteps; i++) {
            const futureX = n - 1 + i;
            const predictedValue = a * Math.exp(b * futureX);
            const timestamp = lastTimestamp + (i * avgInterval);
            
            predictions.push({
                timestamp,
                value: predictedValue,
                confidence: rSquared * Math.exp(-i * 0.02)
            });
        }
        
        return {
            algorithm: 'exponential',
            a,
            b,
            rSquared,
            predictions,
            growthRate: b,
            doublingTime: b > 0 ? Math.log(2) / b : null,
            confidence: rSquared
        };
    }
    
    /**
     * Polynomial trend predictor
     */
    async polynomialPredictor(history, timeAhead, degree = 2) {
        const n = history.length;
        const x = history.map((_, i) => i);
        const y = history.map(d => d.value);
        
        // Build Vandermonde matrix
        const X = [];
        for (let i = 0; i < n; i++) {
            const row = [];
            for (let j = 0; j <= degree; j++) {
                row.push(Math.pow(x[i], j));
            }
            X.push(row);
        }
        
        // Solve using least squares (simplified)
        const coefficients = this.leastSquares(X, y);
        
        // Calculate R-squared
        const yMean = y.reduce((a, b) => a + b, 0) / n;
        const ssTotal = y.reduce((acc, yi) => acc + Math.pow(yi - yMean, 2), 0);
        const ssResidual = y.reduce((acc, yi, i) => {
            const predicted = coefficients.reduce((sum, coef, j) => 
                sum + coef * Math.pow(i, j), 0);
            return acc + Math.pow(yi - predicted, 2);
        }, 0);
        const rSquared = 1 - (ssResidual / ssTotal);
        
        // Predict future values
        const avgInterval = (history[n-1].timestamp - history[0].timestamp) / (n - 1);
        const futureSteps = Math.ceil(timeAhead / avgInterval);
        const predictions = [];
        const lastTimestamp = history[n-1].timestamp;
        
        for (let i = 1; i <= futureSteps; i++) {
            const futureX = n - 1 + i;
            const predictedValue = coefficients.reduce((sum, coef, j) => 
                sum + coef * Math.pow(futureX, j), 0);
            const timestamp = lastTimestamp + (i * avgInterval);
            
            predictions.push({
                timestamp,
                value: predictedValue,
                confidence: rSquared * Math.exp(-i * 0.03)
            });
        }
        
        // Detect inflection points
        const inflectionPoints = this.findInflectionPoints(coefficients, 0, n + futureSteps);
        
        return {
            algorithm: 'polynomial',
            degree,
            coefficients,
            rSquared,
            predictions,
            inflectionPoints,
            confidence: rSquared
        };
    }
    
    /**
     * ARIMA predictor (simplified)
     */
    async arimaPredictor(history, timeAhead) {
        const values = history.map(d => d.value);
        
        // Simple ARIMA(1,1,1) implementation
        // Difference the series
        const differences = [];
        for (let i = 1; i < values.length; i++) {
            differences.push(values[i] - values[i-1]);
        }
        
        // Calculate AR and MA coefficients (simplified)
        const mean = differences.reduce((a, b) => a + b, 0) / differences.length;
        const ar1 = 0.7; // Simplified AR coefficient
        const ma1 = 0.3; // Simplified MA coefficient
        
        // Predict differences
        const avgInterval = (history[history.length-1].timestamp - history[0].timestamp) / (history.length - 1);
        const futureSteps = Math.ceil(timeAhead / avgInterval);
        const predictions = [];
        
        let lastValue = values[values.length - 1];
        let lastDiff = differences[differences.length - 1];
        let lastError = 0;
        const lastTimestamp = history[history.length - 1].timestamp;
        
        for (let i = 1; i <= futureSteps; i++) {
            // ARIMA prediction
            const predictedDiff = mean + ar1 * (lastDiff - mean) + ma1 * lastError;
            const predictedValue = lastValue + predictedDiff;
            const timestamp = lastTimestamp + (i * avgInterval);
            
            predictions.push({
                timestamp,
                value: predictedValue,
                confidence: 0.8 * Math.exp(-i * 0.05)
            });
            
            lastValue = predictedValue;
            lastDiff = predictedDiff;
            lastError = Math.random() * 0.1 - 0.05; // Simplified error
        }
        
        return {
            algorithm: 'arima',
            model: 'ARIMA(1,1,1)',
            predictions,
            confidence: 0.8
        };
    }
    
    /**
     * Neural network predictor (simplified)
     */
    async neuralPredictor(history, timeAhead) {
        const windowSize = 5;
        const values = history.map(d => d.value);
        
        // Normalize data
        const min = Math.min(...values);
        const max = Math.max(...values);
        const normalized = values.map(v => (v - min) / (max - min));
        
        // Create sequences
        const sequences = [];
        for (let i = windowSize; i < normalized.length; i++) {
            sequences.push({
                input: normalized.slice(i - windowSize, i),
                output: normalized[i]
            });
        }
        
        // Simplified neural network weights (would be trained in practice)
        const weights = [0.2, 0.2, 0.2, 0.2, 0.2];
        
        // Predict
        const avgInterval = (history[history.length-1].timestamp - history[0].timestamp) / (history.length - 1);
        const futureSteps = Math.ceil(timeAhead / avgInterval);
        const predictions = [];
        const lastTimestamp = history[history.length - 1].timestamp;
        
        let inputWindow = normalized.slice(-windowSize);
        
        for (let i = 1; i <= futureSteps; i++) {
            // Simple weighted sum
            const normalizedPrediction = inputWindow.reduce((sum, val, idx) => 
                sum + val * weights[idx], 0);
            
            const predictedValue = normalizedPrediction * (max - min) + min;
            const timestamp = lastTimestamp + (i * avgInterval);
            
            predictions.push({
                timestamp,
                value: predictedValue,
                confidence: 0.75 * Math.exp(-i * 0.04)
            });
            
            // Update window
            inputWindow = [...inputWindow.slice(1), normalizedPrediction];
        }
        
        return {
            algorithm: 'neural',
            architecture: 'simple_feedforward',
            windowSize,
            predictions,
            confidence: 0.75
        };
    }
    
    /**
     * Predict memory exhaustion
     */
    async predictMemoryExhaustion(memoryData, totalMemory) {
        const prediction = await this.linearPredictor(memoryData, this.config.predictionWindow);
        
        if (!prediction || prediction.predictions.length === 0) {
            return null;
        }
        
        // Find when memory will be exhausted
        for (const point of prediction.predictions) {
            if (point.value >= totalMemory * 0.95) {
                return {
                    type: 'memory_exhaustion',
                    timeToExhaustion: point.timestamp - Date.now(),
                    predictedUsage: point.value,
                    totalMemory,
                    confidence: point.confidence,
                    severity: 'critical',
                    recommendation: 'Increase memory allocation or optimize memory usage'
                };
            }
        }
        
        // Check if trending towards exhaustion
        if (prediction.slope > 0) {
            const timeToExhaustion = ((totalMemory * 0.95) - memoryData[memoryData.length-1].value) / prediction.slope;
            const avgInterval = (memoryData[memoryData.length-1].timestamp - memoryData[0].timestamp) / (memoryData.length - 1);
            
            return {
                type: 'memory_trend',
                timeToExhaustion: timeToExhaustion * avgInterval,
                currentUsage: memoryData[memoryData.length-1].value,
                totalMemory,
                growthRate: prediction.slope,
                confidence: prediction.confidence,
                severity: timeToExhaustion * avgInterval < 3600000 ? 'high' : 'medium',
                recommendation: 'Monitor memory usage trend'
            };
        }
        
        return null;
    }
    
    /**
     * Predict disk space exhaustion
     */
    async predictDiskExhaustion(diskData, totalSpace) {
        const prediction = await this.exponentialPredictor(diskData, this.config.predictionWindow * 24); // 24 hours
        
        if (!prediction || prediction.predictions.length === 0) {
            return null;
        }
        
        for (const point of prediction.predictions) {
            if (point.value >= totalSpace * 0.95) {
                return {
                    type: 'disk_exhaustion',
                    timeToExhaustion: point.timestamp - Date.now(),
                    predictedUsage: point.value,
                    totalSpace,
                    confidence: point.confidence,
                    severity: 'critical',
                    recommendation: 'Clean up disk space or increase storage'
                };
            }
        }
        
        return null;
    }
    
    /**
     * Predict connection pool exhaustion
     */
    async predictConnectionExhaustion(connectionData, maxConnections) {
        const prediction = await this.polynomialPredictor(connectionData, this.config.predictionWindow);
        
        if (!prediction || prediction.predictions.length === 0) {
            return null;
        }
        
        for (const point of prediction.predictions) {
            if (point.value >= maxConnections * 0.9) {
                return {
                    type: 'connection_exhaustion',
                    timeToExhaustion: point.timestamp - Date.now(),
                    predictedConnections: Math.floor(point.value),
                    maxConnections,
                    confidence: point.confidence,
                    severity: 'high',
                    recommendation: 'Increase connection pool size or optimize connection usage'
                };
            }
        }
        
        return null;
    }
    
    /**
     * Predict rate limit breach
     */
    async predictRateLimitBreach(requestData, rateLimit) {
        const prediction = await this.linearPredictor(requestData, 300000); // 5 minutes
        
        if (!prediction || prediction.predictions.length === 0) {
            return null;
        }
        
        // Calculate request rate
        const currentRate = prediction.slope * 60000; // Requests per minute
        
        if (currentRate > rateLimit * 0.8) {
            return {
                type: 'rate_limit_warning',
                currentRate: Math.floor(currentRate),
                rateLimit,
                utilizationPercent: (currentRate / rateLimit) * 100,
                confidence: prediction.confidence,
                severity: currentRate > rateLimit * 0.9 ? 'high' : 'medium',
                recommendation: 'Implement rate limiting or request throttling'
            };
        }
        
        return null;
    }
    
    /**
     * Check for predicted issues
     */
    checkPredictedIssues(metricName, prediction, threshold) {
        const issues = [];
        
        if (!prediction || !prediction.predictions) {
            return issues;
        }
        
        for (const point of prediction.predictions) {
            if (threshold.critical && point.value >= threshold.critical) {
                issues.push({
                    level: 'critical',
                    predictedTime: point.timestamp,
                    predictedValue: point.value,
                    threshold: threshold.critical,
                    confidence: point.confidence
                });
            } else if (threshold.warning && point.value >= threshold.warning) {
                issues.push({
                    level: 'warning',
                    predictedTime: point.timestamp,
                    predictedValue: point.value,
                    threshold: threshold.warning,
                    confidence: point.confidence
                });
            }
        }
        
        return issues;
    }
    
    /**
     * Calculate time until issue occurs
     */
    calculateTimeToIssue(prediction, threshold) {
        if (!prediction || !prediction.predictions || !threshold.critical) {
            return null;
        }
        
        const currentTime = Date.now();
        
        for (const point of prediction.predictions) {
            if (point.value >= threshold.critical) {
                return {
                    milliseconds: point.timestamp - currentTime,
                    human: this.humanizeTime(point.timestamp - currentTime)
                };
            }
        }
        
        return null;
    }
    
    /**
     * Humanize time duration
     */
    humanizeTime(milliseconds) {
        const seconds = Math.floor(milliseconds / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        
        if (days > 0) return `${days} day${days > 1 ? 's' : ''}`;
        if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''}`;
        if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''}`;
        return `${seconds} second${seconds > 1 ? 's' : ''}`;
    }
    
    /**
     * Least squares solver (simplified)
     */
    leastSquares(X, y) {
        // Simplified implementation - would use proper linear algebra library
        const n = X.length;
        const m = X[0].length;
        const coefficients = new Array(m).fill(0);
        
        // Simple gradient descent
        const learningRate = 0.01;
        const iterations = 1000;
        
        for (let iter = 0; iter < iterations; iter++) {
            const gradients = new Array(m).fill(0);
            
            for (let i = 0; i < n; i++) {
                const prediction = X[i].reduce((sum, xij, j) => 
                    sum + xij * coefficients[j], 0);
                const error = prediction - y[i];
                
                for (let j = 0; j < m; j++) {
                    gradients[j] += error * X[i][j];
                }
            }
            
            for (let j = 0; j < m; j++) {
                coefficients[j] -= learningRate * gradients[j] / n;
            }
        }
        
        return coefficients;
    }
    
    /**
     * Find inflection points in polynomial
     */
    findInflectionPoints(coefficients, start, end) {
        if (coefficients.length < 3) return [];
        
        // Second derivative coefficients
        const secondDerivCoeffs = [];
        for (let i = 2; i < coefficients.length; i++) {
            secondDerivCoeffs.push(i * (i - 1) * coefficients[i]);
        }
        
        // Find where second derivative changes sign
        const points = [];
        const step = (end - start) / 100;
        
        for (let x = start; x < end; x += step) {
            const val = secondDerivCoeffs.reduce((sum, coef, i) => 
                sum + coef * Math.pow(x, i), 0);
            
            if (points.length > 0) {
                const lastVal = secondDerivCoeffs.reduce((sum, coef, i) => 
                    sum + coef * Math.pow(x - step, i), 0);
                
                if (val * lastVal < 0) {
                    points.push(x - step / 2);
                }
            }
        }
        
        return points;
    }
    
    /**
     * Start predictive monitoring
     */
    startPredictiveMonitoring() {
        setInterval(async () => {
            try {
                // Get all metrics with thresholds
                for (const [metric, threshold] of this.thresholds) {
                    await this.predictMetric(metric);
                }
                
                // Check resource exhaustion
                await this.checkResourceExhaustion();
                
            } catch (error) {
                console.error('Predictive monitoring error:', error);
                this.emit('error', error);
            }
        }, this.config.checkInterval);
    }
    
    /**
     * Check for resource exhaustion
     */
    async checkResourceExhaustion() {
        // Memory check
        const memoryData = await this.anomalyDetector.getHistoricalData('system.memory.used', 1);
        if (memoryData.length > 10) {
            const memoryPrediction = await this.predictMemoryExhaustion(
                memoryData,
                16 * 1024 * 1024 * 1024 // 16GB example
            );
            
            if (memoryPrediction) {
                this.emit('resourceExhaustionPredicted', memoryPrediction);
            }
        }
        
        // Disk check
        const diskData = await this.anomalyDetector.getHistoricalData('system.disk.used', 24);
        if (diskData.length > 10) {
            const diskPrediction = await this.predictDiskExhaustion(
                diskData,
                1000 * 1024 * 1024 * 1024 // 1TB example
            );
            
            if (diskPrediction) {
                this.emit('resourceExhaustionPredicted', diskPrediction);
            }
        }
    }
}

module.exports = PredictiveAlerting;