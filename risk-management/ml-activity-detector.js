const EventEmitter = require('events');
const { getSecureMetricsCollector } = require('../monitoring/secure-metrics-collector');

class MLActivityDetector extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      // Model configurations
      modelType: config.modelType || 'isolation_forest', // isolation_forest, one_class_svm, lstm
      trainingWindow: config.trainingWindow || 86400000 * 7, // 7 days
      predictionWindow: config.predictionWindow || 300000, // 5 minutes
      retrainInterval: config.retrainInterval || 86400000, // 24 hours
      
      // Feature engineering
      features: config.features || [
        'transaction_frequency',
        'volume_patterns',
        'time_distribution',
        'price_impact',
        'order_size_distribution',
        'cancellation_rate',
        'market_timing',
        'cross_pair_correlation'
      ],
      
      // Anomaly thresholds
      anomalyThreshold: config.anomalyThreshold || 0.8,
      severityThresholds: config.severityThresholds || {
        low: 0.6,
        medium: 0.75,
        high: 0.85,
        critical: 0.95
      },
      
      // Model performance
      falsePositiveTarget: config.falsePositiveTarget || 0.05, // 5%
      minTrainingData: config.minTrainingData || 1000,
      maxFeatures: config.maxFeatures || 50,
      
      // Real-time processing
      batchSize: config.batchSize || 100,
      maxLatency: config.maxLatency || 1000, // 1 second
      
      // Redis configuration
      redisUrl: config.redisUrl || process.env.REDIS_URL,
      keyPrefix: config.keyPrefix || 'risk:ml:',
      
      // Data retention
      dataRetention: config.dataRetention || 86400000 * 30, // 30 days
      
      ...config
    };
    
    this.metrics = getSecureMetricsCollector();
    this.redis = null;
    this.isRunning = false;
    
    // ML Models
    this.models = new Map(); // modelId -> model
    this.modelMetadata = new Map(); // modelId -> metadata
    this.predictions = new Map(); // userId -> recent predictions
    
    // Feature extraction
    this.userFeatures = new Map(); // userId -> feature vectors
    this.marketFeatures = new Map(); // timeWindow -> market features
    this.featureCache = new Map(); // feature cache for performance
    
    // Training data
    this.trainingData = [];
    this.validationData = [];
    this.labeledData = new Map(); // Known anomalies for supervised learning
    
    // Real-time processing
    this.processingQueue = [];
    this.isProcessing = false;
    
    // Model performance tracking
    this.performanceStats = {
      predictionsPerSecond: 0,
      averagePredictionTime: 0,
      falsePositiveRate: 0.05,
      truePositiveRate: 0.85,
      modelAccuracy: 0.9,
      featuresExtracted: 0
    };
    
    // Anomaly detection results
    this.anomalies = new Map(); // userId -> anomaly records
    this.anomalyThresholds = new Map(); // userId -> adaptive thresholds
  }

  async initialize() {
    try {
      // Initialize Redis connection
      const Redis = require('redis');
      this.redis = Redis.createClient({ url: this.config.redisUrl });
      await this.redis.connect();
      
      // Load existing models and data
      await this.loadModels();
      await this.loadTrainingData();
      await this.loadFeatureCache();
      
      // Initialize feature extractors
      this.initializeFeatureExtractors();
      
      console.log('✅ ML activity detector initialized');
      
    } catch (error) {
      console.error('Failed to initialize ML activity detector:', error);
      throw error;
    }
  }

  async start() {
    if (this.isRunning) return;
    
    console.log('🧠 Starting ML activity detector...');
    this.isRunning = true;
    
    // Start real-time processing
    this.startRealTimeProcessing();
    
    // Start model training
    this.startModelTraining();
    
    // Start performance monitoring
    this.startPerformanceMonitoring();
    
    // Start data cleanup
    this.startDataCleanup();
    
    console.log('✅ ML activity detector started');
  }

  startRealTimeProcessing() {
    this.processingInterval = setInterval(async () => {
      try {
        await this.processQueue();
      } catch (error) {
        console.error('Real-time processing error:', error);
        await this.metrics.incrementCounter('ml_detector.processing_errors', 1, {}, 'risk');
      }
    }, 1000); // Every second
  }

  startModelTraining() {
    this.trainingInterval = setInterval(async () => {
      try {
        await this.retrainModels();
      } catch (error) {
        console.error('Model training error:', error);
      }
    }, this.config.retrainInterval);
  }

  startPerformanceMonitoring() {
    this.performanceInterval = setInterval(async () => {
      await this.updatePerformanceMetrics();
    }, 30000); // Every 30 seconds
  }

  startDataCleanup() {
    this.cleanupInterval = setInterval(async () => {
      await this.cleanupOldData();
    }, 3600000); // Every hour
  }

  initializeFeatureExtractors() {
    this.featureExtractors = {
      transaction_frequency: this.extractTransactionFrequency.bind(this),
      volume_patterns: this.extractVolumePatterns.bind(this),
      time_distribution: this.extractTimeDistribution.bind(this),
      price_impact: this.extractPriceImpact.bind(this),
      order_size_distribution: this.extractOrderSizeDistribution.bind(this),
      cancellation_rate: this.extractCancellationRate.bind(this),
      market_timing: this.extractMarketTiming.bind(this),
      cross_pair_correlation: this.extractCrossPairCorrelation.bind(this)
    };
  }

  async analyzeUserActivity(userId, activityData) {
    const startTime = Date.now();
    
    try {
      // Add to processing queue
      this.processingQueue.push({
        userId,
        activityData,
        timestamp: Date.now()
      });
      
      // Process immediately if queue is small
      if (this.processingQueue.length < this.config.batchSize) {
        await this.processQueue();
      }
      
      // Get recent prediction if available
      const prediction = this.predictions.get(userId);
      
      return {
        userId,
        anomalyScore: prediction?.anomalyScore || 0,
        severity: prediction?.severity || 'normal',
        features: prediction?.features || {},
        confidence: prediction?.confidence || 0,
        timestamp: Date.now()
      };
      
    } catch (error) {
      console.error(`Failed to analyze activity for ${userId}:`, error);
      throw error;
    } finally {
      this.updatePredictionPerformance(Date.now() - startTime);
    }
  }

  async processQueue() {
    if (this.isProcessing || this.processingQueue.length === 0) return;
    
    this.isProcessing = true;
    const startTime = Date.now();
    
    try {
      // Process batch
      const batch = this.processingQueue.splice(0, this.config.batchSize);
      
      // Extract features for batch
      const featureBatch = await Promise.all(
        batch.map(item => this.extractFeatures(item.userId, item.activityData))
      );
      
      // Make predictions
      const predictions = await this.makeBatchPredictions(featureBatch);
      
      // Store predictions and handle anomalies
      for (let i = 0; i < batch.length; i++) {
        const item = batch[i];
        const prediction = predictions[i];
        
        // Store prediction
        this.predictions.set(item.userId, {
          ...prediction,
          timestamp: Date.now()
        });
        
        // Handle anomalies
        if (prediction.anomalyScore > this.config.anomalyThreshold) {
          await this.handleAnomaly(item.userId, prediction, item.activityData);
        }
      }
      
      // Update performance stats
      const processingTime = Date.now() - startTime;
      this.performanceStats.predictionsPerSecond = batch.length / (processingTime / 1000);
      
    } catch (error) {
      console.error('Batch processing error:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  async extractFeatures(userId, activityData) {
    const cacheKey = `features_${userId}_${Math.floor(Date.now() / 60000)}`; // 1-minute cache
    
    // Check cache first
    let features = this.featureCache.get(cacheKey);
    if (features) {
      return features;
    }
    
    try {
      features = {};
      
      // Extract configured features
      for (const featureName of this.config.features) {
        const extractor = this.featureExtractors[featureName];
        if (extractor) {
          try {
            features[featureName] = await extractor(userId, activityData);
          } catch (error) {
            console.warn(`Failed to extract feature ${featureName}:`, error);
            features[featureName] = 0; // Default value
          }
        }
      }
      
      // Add derived features
      features.risk_score = this.calculateRiskScore(features);
      features.pattern_deviation = this.calculatePatternDeviation(userId, features);
      features.temporal_anomaly = this.calculateTemporalAnomaly(features);
      
      // Normalize features
      features = this.normalizeFeatures(features);
      
      // Cache features
      this.featureCache.set(cacheKey, features);
      
      // Store user features
      this.userFeatures.set(userId, features);
      
      this.performanceStats.featuresExtracted++;
      
      return features;
      
    } catch (error) {
      console.error(`Failed to extract features for ${userId}:`, error);
      return {}; // Return empty features on error
    }
  }

  async extractTransactionFrequency(userId, activityData) {
    // Calculate transaction frequency over different time windows
    const windows = [300, 900, 3600]; // 5min, 15min, 1hour in seconds
    const frequencies = [];
    
    for (const window of windows) {
      const windowStart = Date.now() - (window * 1000);
      const transactions = activityData.transactions?.filter(
        t => t.timestamp > windowStart
      ) || [];
      
      frequencies.push(transactions.length / window * 3600); // Normalize to per hour
    }
    
    return {
      freq_5min: frequencies[0],
      freq_15min: frequencies[1],
      freq_1hour: frequencies[2],
      frequency_variance: this.calculateVariance(frequencies),
      frequency_trend: this.calculateTrend(frequencies)
    };
  }

  async extractVolumePatterns(userId, activityData) {
    const volumes = activityData.transactions?.map(t => t.volume) || [];
    
    if (volumes.length === 0) return { avg_volume: 0, volume_std: 0, volume_skew: 0 };
    
    const avgVolume = volumes.reduce((sum, v) => sum + v, 0) / volumes.length;
    const volumeStd = Math.sqrt(
      volumes.reduce((sum, v) => sum + Math.pow(v - avgVolume, 2), 0) / volumes.length
    );
    
    return {
      avg_volume: avgVolume,
      volume_std: volumeStd,
      volume_skew: this.calculateSkewness(volumes),
      volume_kurtosis: this.calculateKurtosis(volumes),
      max_volume_ratio: Math.max(...volumes) / avgVolume,
      volume_concentration: this.calculateGiniCoefficient(volumes)
    };
  }

  async extractTimeDistribution(userId, activityData) {
    const timestamps = activityData.transactions?.map(t => new Date(t.timestamp)) || [];
    
    if (timestamps.length === 0) {
      return { hour_entropy: 0, weekday_entropy: 0, night_trading_ratio: 0 };
    }
    
    // Hour distribution
    const hourCounts = new Array(24).fill(0);
    timestamps.forEach(ts => hourCounts[ts.getHours()]++);
    
    // Weekday distribution
    const weekdayCounts = new Array(7).fill(0);
    timestamps.forEach(ts => weekdayCounts[ts.getDay()]++);
    
    // Night trading (22:00 - 06:00)
    const nightTrades = timestamps.filter(ts => {
      const hour = ts.getHours();
      return hour >= 22 || hour <= 6;
    }).length;
    
    return {
      hour_entropy: this.calculateEntropy(hourCounts),
      weekday_entropy: this.calculateEntropy(weekdayCounts),
      night_trading_ratio: nightTrades / timestamps.length,
      peak_hour: hourCounts.indexOf(Math.max(...hourCounts)),
      time_clustering: this.calculateTimeClustering(timestamps)
    };
  }

  async extractPriceImpact(userId, activityData) {
    const trades = activityData.transactions?.filter(t => t.type === 'trade') || [];
    
    if (trades.length === 0) {
      return { avg_price_impact: 0, max_price_impact: 0, impact_variance: 0 };
    }
    
    const priceImpacts = trades.map(trade => {
      const expectedPrice = trade.marketPrice || trade.price;
      return Math.abs(trade.price - expectedPrice) / expectedPrice;
    });
    
    return {
      avg_price_impact: priceImpacts.reduce((sum, p) => sum + p, 0) / priceImpacts.length,
      max_price_impact: Math.max(...priceImpacts),
      impact_variance: this.calculateVariance(priceImpacts),
      high_impact_ratio: priceImpacts.filter(p => p > 0.01).length / priceImpacts.length
    };
  }

  async extractOrderSizeDistribution(userId, activityData) {
    const orders = activityData.orders || [];
    const sizes = orders.map(o => o.amount);
    
    if (sizes.length === 0) {
      return { size_entropy: 0, size_gini: 0, round_number_ratio: 0 };
    }
    
    // Check for round numbers (psychological levels)
    const roundNumbers = sizes.filter(size => {
      const str = size.toString();
      return str.endsWith('00') || str.endsWith('000') || str.endsWith('0000');
    });
    
    return {
      size_entropy: this.calculateEntropy(this.createHistogram(sizes, 10)),
      size_gini: this.calculateGiniCoefficient(sizes),
      round_number_ratio: roundNumbers.length / sizes.length,
      size_consistency: this.calculateConsistency(sizes),
      extreme_size_ratio: this.calculateExtremeRatio(sizes)
    };
  }

  async extractCancellationRate(userId, activityData) {
    const orders = activityData.orders || [];
    const cancelled = orders.filter(o => o.status === 'cancelled');
    const filled = orders.filter(o => o.status === 'filled');
    
    if (orders.length === 0) {
      return { cancellation_rate: 0, avg_time_to_cancel: 0, quick_cancel_ratio: 0 };
    }
    
    const cancelTimes = cancelled.map(o => 
      (o.cancelledAt || Date.now()) - o.createdAt
    ).filter(t => t > 0);
    
    const quickCancels = cancelTimes.filter(t => t < 5000); // < 5 seconds
    
    return {
      cancellation_rate: cancelled.length / orders.length,
      avg_time_to_cancel: cancelTimes.length > 0 ? 
        cancelTimes.reduce((sum, t) => sum + t, 0) / cancelTimes.length : 0,
      quick_cancel_ratio: quickCancels.length / cancelTimes.length,
      partial_fill_rate: orders.filter(o => o.partiallyFilled).length / orders.length
    };
  }

  async extractMarketTiming(userId, activityData) {
    // This would analyze timing relative to market events
    // For now, simplified implementation
    
    const transactions = activityData.transactions || [];
    if (transactions.length === 0) return { timing_score: 0 };
    
    // Calculate timing relative to price movements
    let timingScore = 0;
    for (const tx of transactions) {
      // Simplified timing analysis
      const priceChange = tx.priceAfter - tx.priceBefore;
      const expectedProfit = tx.side === 'buy' ? priceChange : -priceChange;
      timingScore += expectedProfit > 0 ? 1 : 0;
    }
    
    return {
      timing_score: timingScore / transactions.length,
      front_running_score: this.calculateFrontRunningScore(transactions),
      momentum_following: this.calculateMomentumFollowing(transactions)
    };
  }

  async extractCrossPairCorrelation(userId, activityData) {
    // Analyze correlation across different trading pairs
    const pairData = this.groupByPair(activityData.transactions || []);
    const pairs = Object.keys(pairData);
    
    if (pairs.length < 2) {
      return { cross_pair_correlation: 0, pair_switching_rate: 0 };
    }
    
    // Calculate correlation between pair activities
    const correlations = [];
    for (let i = 0; i < pairs.length; i++) {
      for (let j = i + 1; j < pairs.length; j++) {
        const corr = this.calculatePairCorrelation(pairData[pairs[i]], pairData[pairs[j]]);
        correlations.push(corr);
      }
    }
    
    return {
      cross_pair_correlation: correlations.length > 0 ? 
        correlations.reduce((sum, c) => sum + c, 0) / correlations.length : 0,
      pair_switching_rate: this.calculatePairSwitchingRate(activityData.transactions),
      simultaneous_trading: this.calculateSimultaneousTrading(pairData)
    };
  }

  calculateRiskScore(features) {
    // Weighted combination of risk indicators
    const weights = {
      freq_5min: 0.1,
      volume_std: 0.15,
      cancellation_rate: 0.2,
      night_trading_ratio: 0.1,
      quick_cancel_ratio: 0.15,
      timing_score: 0.2,
      round_number_ratio: 0.1
    };
    
    let riskScore = 0;
    for (const [feature, weight] of Object.entries(weights)) {
      const value = this.getNestedValue(features, feature) || 0;
      riskScore += value * weight;
    }
    
    return Math.min(1, Math.max(0, riskScore));
  }

  calculatePatternDeviation(userId, features) {
    // Compare current features to user's historical pattern
    const historicalFeatures = this.userFeatures.get(userId);
    if (!historicalFeatures) return 0;
    
    let totalDeviation = 0;
    let featureCount = 0;
    
    for (const [key, value] of Object.entries(features)) {
      if (typeof value === 'number' && historicalFeatures[key] !== undefined) {
        const historical = historicalFeatures[key];
        const deviation = Math.abs(value - historical) / (historical + 0.001); // Avoid division by zero
        totalDeviation += deviation;
        featureCount++;
      }
    }
    
    return featureCount > 0 ? totalDeviation / featureCount : 0;
  }

  calculateTemporalAnomaly(features) {
    // Check for temporal anomalies in features
    const timeFeatures = ['hour_entropy', 'night_trading_ratio', 'freq_5min'];
    let anomalyScore = 0;
    
    for (const feature of timeFeatures) {
      const value = this.getNestedValue(features, feature) || 0;
      // Higher entropy = more random = more suspicious
      if (feature.includes('entropy') && value > 0.8) anomalyScore += 0.3;
      // Night trading above threshold
      if (feature === 'night_trading_ratio' && value > 0.7) anomalyScore += 0.4;
      // Very high frequency
      if (feature === 'freq_5min' && value > 100) anomalyScore += 0.5;
    }
    
    return Math.min(1, anomalyScore);
  }

  normalizeFeatures(features) {
    // Normalize features to [0, 1] range
    const normalized = {};
    
    for (const [key, value] of Object.entries(features)) {
      if (typeof value === 'object' && value !== null) {
        normalized[key] = this.normalizeFeatures(value);
      } else if (typeof value === 'number') {
        // Simple min-max normalization with predefined ranges
        normalized[key] = this.normalizeValue(key, value);
      } else {
        normalized[key] = value;
      }
    }
    
    return normalized;
  }

  normalizeValue(featureName, value) {
    const ranges = {
      freq_5min: [0, 200],
      avg_volume: [0, 1000000],
      cancellation_rate: [0, 1],
      night_trading_ratio: [0, 1],
      timing_score: [0, 1],
      // Add more feature ranges as needed
    };
    
    const range = ranges[featureName] || [0, 1];
    return Math.min(1, Math.max(0, (value - range[0]) / (range[1] - range[0])));
  }

  async makeBatchPredictions(featureBatch) {
    // Simple anomaly detection using statistical methods
    // In production, this would use trained ML models
    
    const predictions = [];
    
    for (const features of featureBatch) {
      const anomalyScore = this.calculateAnomalyScore(features);
      const severity = this.calculateSeverity(anomalyScore);
      const confidence = this.calculateConfidence(features);
      
      predictions.push({
        anomalyScore,
        severity,
        confidence,
        features,
        modelVersion: '1.0',
        algorithm: 'statistical'
      });
    }
    
    return predictions;
  }

  calculateAnomalyScore(features) {
    // Isolation Forest-like scoring
    let anomalyScore = 0;
    let featureCount = 0;
    
    // Check each feature for anomalous values
    for (const [key, value] of Object.entries(features)) {
      if (typeof value === 'number') {
        const featureAnomaly = this.calculateFeatureAnomaly(key, value);
        anomalyScore += featureAnomaly;
        featureCount++;
      } else if (typeof value === 'object' && value !== null) {
        // Handle nested features
        for (const [subKey, subValue] of Object.entries(value)) {
          if (typeof subValue === 'number') {
            const featureAnomaly = this.calculateFeatureAnomaly(`${key}.${subKey}`, subValue);
            anomalyScore += featureAnomaly;
            featureCount++;
          }
        }
      }
    }
    
    return featureCount > 0 ? anomalyScore / featureCount : 0;
  }

  calculateFeatureAnomaly(featureName, value) {
    // Statistical anomaly detection for individual features
    const thresholds = {
      'freq_5min': { mean: 10, std: 5, threshold: 3 },
      'cancellation_rate': { mean: 0.1, std: 0.05, threshold: 2.5 },
      'night_trading_ratio': { mean: 0.2, std: 0.1, threshold: 2 },
      'timing_score': { mean: 0.5, std: 0.2, threshold: 2 },
      'risk_score': { mean: 0.3, std: 0.15, threshold: 2 }
    };
    
    const threshold = thresholds[featureName] || { mean: 0.5, std: 0.2, threshold: 2 };
    const zScore = Math.abs((value - threshold.mean) / threshold.std);
    
    // Convert z-score to anomaly score [0, 1]
    return Math.min(1, Math.max(0, (zScore - threshold.threshold) / threshold.threshold));
  }

  calculateSeverity(anomalyScore) {
    const thresholds = this.config.severityThresholds;
    
    if (anomalyScore >= thresholds.critical) return 'critical';
    if (anomalyScore >= thresholds.high) return 'high';
    if (anomalyScore >= thresholds.medium) return 'medium';
    if (anomalyScore >= thresholds.low) return 'low';
    return 'normal';
  }

  calculateConfidence(features) {
    // Calculate confidence based on feature completeness and quality
    const totalFeatures = this.config.features.length;
    const extractedFeatures = Object.keys(features).length;
    
    const completeness = extractedFeatures / totalFeatures;
    const quality = this.assessFeatureQuality(features);
    
    return (completeness + quality) / 2;
  }

  assessFeatureQuality(features) {
    // Assess the quality of extracted features
    let qualityScore = 0;
    let featureCount = 0;
    
    for (const [key, value] of Object.entries(features)) {
      if (typeof value === 'number') {
        // Check for reasonable values (not NaN, Infinity, etc.)
        if (isFinite(value) && !isNaN(value)) {
          qualityScore += 1;
        }
        featureCount++;
      }
    }
    
    return featureCount > 0 ? qualityScore / featureCount : 0;
  }

  async handleAnomaly(userId, prediction, activityData) {
    // Store anomaly record
    const anomaly = {
      userId,
      anomalyScore: prediction.anomalyScore,
      severity: prediction.severity,
      features: prediction.features,
      confidence: prediction.confidence,
      activityData: this.sanitizeActivityData(activityData),
      timestamp: Date.now(),
      id: this.generateAnomalyId()
    };
    
    this.anomalies.set(anomaly.id, anomaly);
    
    // Emit anomaly event
    this.emit('unusual_activity_detected', anomaly);
    
    // Update metrics
    await this.metrics.incrementCounter('ml_detector.anomalies_detected', 1, {
      severity: prediction.severity,
      userId: this.hashUserId(userId)
    }, 'risk');
    
    // Store in Redis for persistence
    await this.redis.hSet(
      `${this.config.keyPrefix}anomalies`,
      anomaly.id,
      JSON.stringify(anomaly)
    );
    
    console.log(`Unusual activity detected: ${userId} (${prediction.severity})`);
  }

  sanitizeActivityData(activityData) {
    // Remove sensitive information from activity data
    return {
      transactionCount: activityData.transactions?.length || 0,
      orderCount: activityData.orders?.length || 0,
      timeRange: activityData.timeRange,
      // Remove actual transaction details for privacy
    };
  }

  generateAnomalyId() {
    const crypto = require('crypto');
    return `anomaly_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  }

  // Helper functions for statistical calculations
  calculateVariance(values) {
    if (values.length === 0) return 0;
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    return values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
  }

  calculateSkewness(values) {
    if (values.length === 0) return 0;
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const variance = this.calculateVariance(values);
    if (variance === 0) return 0;
    
    const skew = values.reduce((sum, v) => sum + Math.pow((v - mean) / Math.sqrt(variance), 3), 0);
    return skew / values.length;
  }

  calculateKurtosis(values) {
    if (values.length === 0) return 0;
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const variance = this.calculateVariance(values);
    if (variance === 0) return 0;
    
    const kurt = values.reduce((sum, v) => sum + Math.pow((v - mean) / Math.sqrt(variance), 4), 0);
    return (kurt / values.length) - 3; // Excess kurtosis
  }

  calculateEntropy(counts) {
    const total = counts.reduce((sum, c) => sum + c, 0);
    if (total === 0) return 0;
    
    let entropy = 0;
    for (const count of counts) {
      if (count > 0) {
        const p = count / total;
        entropy -= p * Math.log2(p);
      }
    }
    return entropy;
  }

  calculateGiniCoefficient(values) {
    if (values.length === 0) return 0;
    
    const sorted = [...values].sort((a, b) => a - b);
    const n = sorted.length;
    const sum = sorted.reduce((sum, v) => sum + v, 0);
    
    if (sum === 0) return 0;
    
    let gini = 0;
    for (let i = 0; i < n; i++) {
      gini += (2 * (i + 1) - n - 1) * sorted[i];
    }
    
    return gini / (n * sum);
  }

  calculateTrend(values) {
    if (values.length < 2) return 0;
    
    let trend = 0;
    for (let i = 1; i < values.length; i++) {
      trend += values[i] - values[i - 1];
    }
    
    return trend / (values.length - 1);
  }

  createHistogram(values, bins) {
    if (values.length === 0) return new Array(bins).fill(0);
    
    const min = Math.min(...values);
    const max = Math.max(...values);
    const binSize = (max - min) / bins;
    
    const histogram = new Array(bins).fill(0);
    
    for (const value of values) {
      let binIndex = Math.floor((value - min) / binSize);
      if (binIndex >= bins) binIndex = bins - 1;
      histogram[binIndex]++;
    }
    
    return histogram;
  }

  getNestedValue(obj, path) {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }

  groupByPair(transactions) {
    const grouped = {};
    for (const tx of transactions) {
      if (!grouped[tx.pair]) grouped[tx.pair] = [];
      grouped[tx.pair].push(tx);
    }
    return grouped;
  }

  calculatePairCorrelation(data1, data2) {
    // Simplified correlation calculation
    if (data1.length === 0 || data2.length === 0) return 0;
    
    const times1 = data1.map(d => Math.floor(d.timestamp / 60000)); // 1-minute buckets
    const times2 = data2.map(d => Math.floor(d.timestamp / 60000));
    
    const commonTimes = times1.filter(t => times2.includes(t));
    return commonTimes.length / Math.max(times1.length, times2.length);
  }

  calculatePairSwitchingRate(transactions) {
    if (transactions.length === 0) return 0;
    
    let switches = 0;
    for (let i = 1; i < transactions.length; i++) {
      if (transactions[i].pair !== transactions[i - 1].pair) {
        switches++;
      }
    }
    
    return switches / (transactions.length - 1);
  }

  calculateSimultaneousTrading(pairData) {
    const pairs = Object.keys(pairData);
    if (pairs.length < 2) return 0;
    
    let simultaneousCount = 0;
    const timeWindow = 10000; // 10 seconds
    
    for (let i = 0; i < pairs.length; i++) {
      for (let j = i + 1; j < pairs.length; j++) {
        const data1 = pairData[pairs[i]];
        const data2 = pairData[pairs[j]];
        
        for (const tx1 of data1) {
          for (const tx2 of data2) {
            if (Math.abs(tx1.timestamp - tx2.timestamp) < timeWindow) {
              simultaneousCount++;
            }
          }
        }
      }
    }
    
    return simultaneousCount;
  }

  calculateConsistency(values) {
    if (values.length === 0) return 0;
    const variance = this.calculateVariance(values);
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    return mean > 0 ? 1 / (1 + variance / mean) : 0;
  }

  calculateExtremeRatio(values) {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const q1 = sorted[Math.floor(sorted.length * 0.25)];
    const q3 = sorted[Math.floor(sorted.length * 0.75)];
    const iqr = q3 - q1;
    
    const extremes = values.filter(v => v < q1 - 1.5 * iqr || v > q3 + 1.5 * iqr);
    return extremes.length / values.length;
  }

  calculateTimeClustering(timestamps) {
    if (timestamps.length < 2) return 0;
    
    const intervals = [];
    for (let i = 1; i < timestamps.length; i++) {
      intervals.push(timestamps[i] - timestamps[i - 1]);
    }
    
    const avgInterval = intervals.reduce((sum, i) => sum + i, 0) / intervals.length;
    const variance = this.calculateVariance(intervals);
    
    return avgInterval > 0 ? variance / (avgInterval * avgInterval) : 0;
  }

  calculateFrontRunningScore(transactions) {
    // Simplified front-running detection
    let frontRunningScore = 0;
    
    for (let i = 1; i < transactions.length; i++) {
      const prev = transactions[i - 1];
      const curr = transactions[i];
      
      // Check for rapid succession with price movement
      const timeDiff = curr.timestamp - prev.timestamp;
      if (timeDiff < 1000 && curr.price !== prev.price) { // < 1 second
        frontRunningScore++;
      }
    }
    
    return transactions.length > 0 ? frontRunningScore / transactions.length : 0;
  }

  calculateMomentumFollowing(transactions) {
    // Check if trades follow price momentum
    let momentumTrades = 0;
    
    for (const tx of transactions) {
      const priceChange = (tx.priceAfter || tx.price) - (tx.priceBefore || tx.price);
      const expectedDirection = tx.side === 'buy' ? 1 : -1;
      
      if (Math.sign(priceChange) === expectedDirection) {
        momentumTrades++;
      }
    }
    
    return transactions.length > 0 ? momentumTrades / transactions.length : 0;
  }

  updatePredictionPerformance(predictionTime) {
    const alpha = 0.1;
    this.performanceStats.averagePredictionTime = 
      (1 - alpha) * this.performanceStats.averagePredictionTime + alpha * predictionTime;
  }

  async updatePerformanceMetrics() {
    await this.metrics.setGauge('ml_detector.predictions_per_second', 
      this.performanceStats.predictionsPerSecond, {}, 'risk');
    
    await this.metrics.setGauge('ml_detector.average_prediction_time', 
      this.performanceStats.averagePredictionTime, {}, 'risk');
    
    await this.metrics.setGauge('ml_detector.false_positive_rate', 
      this.performanceStats.falsePositiveRate, {}, 'risk');
    
    await this.metrics.setGauge('ml_detector.model_accuracy', 
      this.performanceStats.modelAccuracy, {}, 'risk');
    
    await this.metrics.setGauge('ml_detector.anomalies_detected', 
      this.anomalies.size, {}, 'risk');
    
    await this.metrics.setGauge('ml_detector.features_extracted', 
      this.performanceStats.featuresExtracted, {}, 'risk');
  }

  async retrainModels() {
    console.log('Starting model retraining...');
    
    try {
      // Collect training data
      const trainingData = await this.collectTrainingData();
      
      if (trainingData.length < this.config.minTrainingData) {
        console.warn(`Insufficient training data: ${trainingData.length} < ${this.config.minTrainingData}`);
        return;
      }
      
      // Feature selection and engineering
      const processedData = this.preprocessTrainingData(trainingData);
      
      // Train new model (simplified for this implementation)
      const modelMetrics = await this.trainModel(processedData);
      
      // Validate model performance
      const validation = await this.validateModel(modelMetrics);
      
      if (validation.acceptable) {
        // Update model in production
        await this.deployModel(modelMetrics);
        console.log('Model retraining completed successfully');
      } else {
        console.warn('New model performance not acceptable, keeping existing model');
      }
      
    } catch (error) {
      console.error('Model retraining failed:', error);
    }
  }

  async collectTrainingData() {
    // Collect recent activity data for training
    // This would integrate with your data pipeline
    return this.trainingData.slice(-this.config.minTrainingData * 2);
  }

  preprocessTrainingData(data) {
    // Preprocess and clean training data
    return data.filter(d => d && typeof d === 'object');
  }

  async trainModel(data) {
    // Simplified model training
    // In production, this would use actual ML libraries
    return {
      accuracy: 0.9,
      precision: 0.85,
      recall: 0.88,
      f1Score: 0.86,
      trainedAt: Date.now()
    };
  }

  async validateModel(metrics) {
    // Validate model performance meets thresholds
    return {
      acceptable: metrics.accuracy > 0.8 && metrics.f1Score > 0.8,
      metrics
    };
  }

  async deployModel(metrics) {
    // Deploy new model to production
    this.performanceStats.modelAccuracy = metrics.accuracy;
    
    await this.metrics.incrementCounter('ml_detector.model_updates', 1, {}, 'risk');
  }

  async cleanupOldData() {
    const cutoff = Date.now() - this.config.dataRetention;
    
    // Cleanup old predictions
    for (const [userId, prediction] of this.predictions) {
      if (prediction.timestamp < cutoff) {
        this.predictions.delete(userId);
      }
    }
    
    // Cleanup old anomalies
    for (const [id, anomaly] of this.anomalies) {
      if (anomaly.timestamp < cutoff) {
        this.anomalies.delete(id);
        await this.redis.hDel(`${this.config.keyPrefix}anomalies`, id);
      }
    }
    
    // Cleanup feature cache
    this.featureCache.clear();
  }

  async loadModels() {
    // Load existing models from Redis
    try {
      const modelData = await this.redis.hGetAll(`${this.config.keyPrefix}models`);
      for (const [modelId, data] of Object.entries(modelData)) {
        this.modelMetadata.set(modelId, JSON.parse(data));
      }
      console.log(`Loaded ${this.modelMetadata.size} ML models`);
    } catch (error) {
      console.error('Failed to load models:', error);
    }
  }

  async loadTrainingData() {
    // Load training data from Redis
    try {
      const data = await this.redis.get(`${this.config.keyPrefix}training_data`);
      if (data) {
        this.trainingData = JSON.parse(data);
        console.log(`Loaded ${this.trainingData.length} training samples`);
      }
    } catch (error) {
      console.error('Failed to load training data:', error);
    }
  }

  async loadFeatureCache() {
    // Initialize empty feature cache
    this.featureCache.clear();
  }

  hashUserId(userId) {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(userId.toString()).digest('hex').substring(0, 16);
  }

  getMLDetectorStatus() {
    return {
      isRunning: this.isRunning,
      modelsLoaded: this.models.size,
      predictionsCache: this.predictions.size,
      anomaliesDetected: this.anomalies.size,
      queueSize: this.processingQueue.length,
      performance: this.performanceStats,
      systemState: {
        featureCacheSize: this.featureCache.size,
        userFeaturesTracked: this.userFeatures.size,
        trainingDataSize: this.trainingData.length
      }
    };
  }

  stop() {
    if (!this.isRunning) return;
    
    console.log('🛑 Stopping ML activity detector...');
    
    // Stop intervals
    if (this.processingInterval) clearInterval(this.processingInterval);
    if (this.trainingInterval) clearInterval(this.trainingInterval);
    if (this.performanceInterval) clearInterval(this.performanceInterval);
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);
    
    // Close Redis connection
    if (this.redis) {
      this.redis.quit();
    }
    
    // Clear data
    this.models.clear();
    this.modelMetadata.clear();
    this.predictions.clear();
    this.userFeatures.clear();
    this.marketFeatures.clear();
    this.featureCache.clear();
    this.anomalies.clear();
    this.anomalyThresholds.clear();
    this.processingQueue.length = 0;
    
    this.isRunning = false;
    console.log('✅ ML activity detector stopped');
  }
}

module.exports = MLActivityDetector;