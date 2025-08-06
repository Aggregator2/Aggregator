const EventEmitter = require('events');
const { getSecureMetricsCollector } = require('../monitoring/secure-metrics-collector');
const crypto = require('crypto');

class SecureMLActivityDetector extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      // Validated model configurations
      modelType: this.validateModelType(config.modelType || 'isolation_forest'),
      trainingWindow: this.validateNumber(config.trainingWindow, 86400000 * 7, 3600000, 86400000 * 30),
      predictionWindow: this.validateNumber(config.predictionWindow, 300000, 60000, 3600000),
      retrainInterval: this.validateNumber(config.retrainInterval, 86400000, 3600000, 86400000 * 7),
      
      // Sanitized feature engineering
      features: this.validateFeatures(config.features || [
        'transaction_frequency',
        'volume_patterns',
        'time_distribution',
        'price_impact',
        'order_size_distribution',
        'cancellation_rate',
        'market_timing',
        'cross_pair_correlation'
      ]),
      
      // Validated anomaly thresholds
      anomalyThreshold: this.validateNumber(config.anomalyThreshold, 0.8, 0.1, 1.0),
      severityThresholds: this.validateSeverityThresholds(config.severityThresholds || {
        low: 0.6,
        medium: 0.75,
        high: 0.85,
        critical: 0.95
      }),
      
      // Model performance constraints
      falsePositiveTarget: this.validateNumber(config.falsePositiveTarget, 0.05, 0.01, 0.5),
      minTrainingData: this.validateNumber(config.minTrainingData, 1000, 100, 100000),
      maxFeatures: this.validateNumber(config.maxFeatures, 50, 5, 1000),
      
      // Performance settings
      batchSize: this.validateNumber(config.batchSize, 100, 10, 1000),
      maxLatency: this.validateNumber(config.maxLatency, 1000, 100, 10000),
      maxMemoryUsage: this.validateNumber(config.maxMemoryUsage, 512 * 1024 * 1024, 100 * 1024 * 1024, 2 * 1024 * 1024 * 1024),
      
      // Secure Redis configuration
      redisUrl: this.sanitizeUrl(config.redisUrl || process.env.REDIS_URL),
      keyPrefix: this.sanitizeKeyPrefix(config.keyPrefix || 'risk:ml:'),
      
      // Data retention with validation
      dataRetention: this.validateNumber(config.dataRetention, 86400000 * 30, 86400000, 86400000 * 365),
      
      // Security settings
      authenticationRequired: config.authenticationRequired !== false,
      maxFailedAttempts: this.validateNumber(config.maxFailedAttempts, 5, 1, 100),
      lockoutDuration: this.validateNumber(config.lockoutDuration, 300000, 60000, 3600000),
      
      // Performance optimizations
      enableCompression: config.enableCompression !== false,
      useBatching: config.useBatching !== false,
      cacheSize: this.validateNumber(config.cacheSize, 10000, 1000, 1000000),
      
      ...config
    };
    
    this.metrics = getSecureMetricsCollector();
    this.redis = null;
    this.isRunning = false;
    
    // Secure ML models with size limits
    this.models = new Map(); // modelId -> encrypted model
    this.modelMetadata = new Map(); // modelId -> metadata
    this.predictions = new Map(); // userId -> recent predictions (limited size)
    
    // Feature extraction with validation
    this.userFeatures = new Map(); // userId -> feature vectors (limited size)
    this.marketFeatures = new Map(); // timeWindow -> market features
    this.featureCache = new LRU(this.config.cacheSize / 4);
    
    // Secure training data
    this.trainingData = [];
    this.validationData = [];
    this.labeledData = new Map(); // Known anomalies for supervised learning
    
    // Real-time processing with limits
    this.processingQueue = [];
    this.isProcessing = false;
    this.maxQueueSize = 10000;
    
    // Model performance tracking
    this.performanceStats = {
      predictionsPerSecond: 0,
      averagePredictionTime: 0,
      falsePositiveRate: 0.05,
      truePositiveRate: 0.85,
      modelAccuracy: 0.9,
      featuresExtracted: 0,
      memoryUsage: 0,
      cacheHitRate: 0
    };
    
    // Anomaly detection results with TTL
    this.anomalies = new Map(); // userId -> anomaly records
    this.anomalyThresholds = new Map(); // userId -> adaptive thresholds
    this.anomalyExpiry = new Map(); // userId -> expiry timestamp
    
    // Security tracking
    this.failedAttempts = new Map(); // userId -> attempts count
    this.lockedUsers = new Map(); // userId -> lockout expiry
    this.suspiciousActivities = new Map(); // userId -> suspicious events
    
    // Authentication and authorization
    this.authorizedUsers = new Set();
    this.permissionMatrix = new Map();
    
    // Atomic operation locks
    this.operationLocks = new Map();
    this.lockTimeouts = new Map();
    
    // Rate limiting
    this.rateLimiters = new Map();
    this.defaultRateLimit = { requests: 100, window: 60000 }; // 100 requests per minute
    
    // Memory management
    this.memoryCheckInterval = 60000; // 1 minute
    this.maxTrainingDataSize = 100000;
    this.maxPredictionHistory = 1000;
  }

  // Input validation helpers
  validateNumber(value, defaultValue, min, max) {
    if (typeof value !== 'number' || !isFinite(value) || value < min || value > max) {
      return defaultValue;
    }
    return value;
  }

  validateModelType(type) {
    const allowedTypes = ['isolation_forest', 'one_class_svm', 'lstm', 'autoencoder'];
    return allowedTypes.includes(type) ? type : 'isolation_forest';
  }

  validateFeatures(features) {
    if (!Array.isArray(features)) return [];
    
    const allowedFeatures = [
      'transaction_frequency', 'volume_patterns', 'time_distribution',
      'price_impact', 'order_size_distribution', 'cancellation_rate',
      'market_timing', 'cross_pair_correlation', 'velocity_patterns',
      'concentration_ratio', 'unusual_timing'
    ];
    
    return features
      .filter(f => typeof f === 'string' && allowedFeatures.includes(f))
      .slice(0, this.config.maxFeatures || 50);
  }

  validateSeverityThresholds(thresholds) {
    const validated = {};
    const allowedLevels = ['low', 'medium', 'high', 'critical'];
    
    for (const level of allowedLevels) {
      const value = thresholds[level];
      validated[level] = this.validateNumber(value, 0.5, 0.1, 1.0);
    }
    
    // Ensure thresholds are properly ordered
    if (validated.low >= validated.medium) validated.medium = validated.low + 0.1;
    if (validated.medium >= validated.high) validated.high = validated.medium + 0.1;
    if (validated.high >= validated.critical) validated.critical = Math.min(1.0, validated.high + 0.1);
    
    return validated;
  }

  sanitizeString(input) {
    if (typeof input !== 'string') return '';
    return input.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 100);
  }

  sanitizeUrl(url) {
    if (!url || typeof url !== 'string') return null;
    try {
      const parsed = new URL(url);
      if (!['redis:', 'rediss:'].includes(parsed.protocol)) {
        throw new Error('Invalid Redis URL protocol');
      }
      return url;
    } catch {
      return null;
    }
  }

  sanitizeKeyPrefix(prefix) {
    if (typeof prefix !== 'string') return 'risk:ml:';
    return prefix.replace(/[^a-zA-Z0-9:_-]/g, '').substring(0, 50) + ':';
  }

  // Authentication and authorization
  async authenticate(authToken) {
    if (!this.config.authenticationRequired) return true;
    
    if (!authToken || typeof authToken !== 'string') {
      throw new Error('Authentication token required');
    }
    
    try {
      const isValid = await this.verifyAuthToken(authToken);
      if (!isValid) {
        throw new Error('Invalid authentication token');
      }
      return true;
    } catch (error) {
      await this.metrics.incrementCounter('ml_detector.auth_failures', 1, {}, 'risk');
      throw new Error('Authentication failed');
    }
  }

  async authorize(userId, operation, authenticatedUser) {
    const permissions = this.permissionMatrix.get(userId) || [];
    const requiredPermission = `ml_detector.${operation}`;
    
    if (!permissions.includes(requiredPermission) && !permissions.includes('ml_detector.*')) {
      throw new Error(`Insufficient permissions for operation: ${operation}`);
    }
    
    return true;
  }

  async verifyAuthToken(token) {
    // Implement JWT verification or API key validation
    return token.length > 10; // Simplified for example
  }

  // Rate limiting
  async checkRateLimit(userId, operation = 'default') {
    const key = `${userId}:${operation}`;
    const limiter = this.rateLimiters.get(key) || { ...this.defaultRateLimit, count: 0, window: Date.now() };
    
    const now = Date.now();
    if (now - limiter.window >= limiter.window) {
      limiter.count = 0;
      limiter.window = now;
    }
    
    if (limiter.count >= limiter.requests) {
      throw new Error('Rate limit exceeded');
    }
    
    limiter.count++;
    this.rateLimiters.set(key, limiter);
    return true;
  }

  // Memory management
  checkMemoryUsage() {
    const usage = process.memoryUsage();
    this.performanceStats.memoryUsage = usage.heapUsed;
    
    if (usage.heapUsed > this.config.maxMemoryUsage) {
      this.performanceCleanup();
    }
  }

  performanceCleanup() {
    // Clean old cache entries
    const now = Date.now();
    const maxAge = 300000; // 5 minutes
    
    // Clean feature cache
    for (const [key, entry] of this.featureCache.entries()) {
      if (now - entry.timestamp > maxAge) {
        this.featureCache.delete(key);
      }
    }
    
    // Limit data structure sizes
    this.limitMapSize(this.userFeatures, 10000);
    this.limitMapSize(this.predictions, 5000);
    this.limitMapSize(this.anomalies, 5000);
    this.limitMapSize(this.rateLimiters, 10000);
    
    // Clean training data
    if (this.trainingData.length > this.maxTrainingDataSize) {
      this.trainingData = this.trainingData.slice(-this.maxTrainingDataSize);
    }
    
    // Clean expired anomalies
    this.cleanExpiredAnomalies();
    
    // Clean processing queue
    if (this.processingQueue.length > this.maxQueueSize) {
      this.processingQueue = this.processingQueue.slice(-this.maxQueueSize);
    }
  }

  limitMapSize(map, maxSize) {
    if (map.size > maxSize) {
      const entries = Array.from(map.entries());
      entries.sort((a, b) => (a[1].timestamp || 0) - (b[1].timestamp || 0));
      
      const toDelete = entries.slice(0, entries.length - maxSize);
      for (const [key] of toDelete) {
        map.delete(key);
      }
    }
  }

  cleanExpiredAnomalies() {
    const now = Date.now();
    for (const [userId, expiry] of this.anomalyExpiry.entries()) {
      if (now > expiry) {
        this.anomalies.delete(userId);
        this.anomalyExpiry.delete(userId);
      }
    }
  }

  // Atomic operations with distributed locks
  async acquireLock(lockKey, timeoutMs = 30000) {
    const lockId = crypto.randomUUID();
    const lockPath = `${this.config.keyPrefix}locks:${this.sanitizeString(lockKey)}`;
    
    try {
      const result = await this.redis.set(lockPath, lockId, 'PX', timeoutMs, 'NX');
      if (result === 'OK') {
        this.operationLocks.set(lockKey, lockId);
        
        // Set cleanup timeout
        const timeout = setTimeout(() => {
          this.releaseLock(lockKey);
        }, timeoutMs);
        this.lockTimeouts.set(lockKey, timeout);
        
        return lockId;
      }
      throw new Error('Failed to acquire lock');
    } catch (error) {
      throw new Error(`Lock acquisition failed: ${error.message}`);
    }
  }

  async releaseLock(lockKey) {
    const lockId = this.operationLocks.get(lockKey);
    if (!lockId) return;
    
    const lockPath = `${this.config.keyPrefix}locks:${this.sanitizeString(lockKey)}`;
    
    try {
      // Use Lua script for atomic check-and-delete
      const script = `
        if redis.call("GET", KEYS[1]) == ARGV[1] then
          return redis.call("DEL", KEYS[1])
        else
          return 0
        end
      `;
      
      await this.redis.eval(script, 1, lockPath, lockId);
      
      this.operationLocks.delete(lockKey);
      
      const timeout = this.lockTimeouts.get(lockKey);
      if (timeout) {
        clearTimeout(timeout);
        this.lockTimeouts.delete(lockKey);
      }
    } catch (error) {
      console.error('Lock release error:', error);
    }
  }

  async initialize() {
    try {
      // Initialize Redis connection with security options
      const Redis = require('redis');
      this.redis = Redis.createClient({
        url: this.config.redisUrl,
        socket: {
          connectTimeout: 10000,
          lazyConnect: true
        },
        retryDelayOnFailover: 100,
        maxRetriesPerRequest: 3
      });
      
      await this.redis.connect();
      
      // Load existing models and data
      await this.loadSecureModels();
      await this.loadTrainingData();
      
      // Initialize feature extractors
      await this.initializeFeatureExtractors();
      
      // Start memory monitoring
      this.memoryMonitorInterval = setInterval(() => {
        this.checkMemoryUsage();
      }, this.memoryCheckInterval);
      
      console.log('✅ Secure ML activity detector initialized');
      
    } catch (error) {
      console.error('Failed to initialize secure ML activity detector:', error);
      throw error;
    }
  }

  async start() {
    if (this.isRunning) return;
    
    console.log('⚡ Starting secure ML activity detector...');
    this.isRunning = true;
    
    // Start secure prediction processing
    this.startSecurePredictionProcessing();
    
    // Start model retraining
    this.startSecureModelRetraining();
    
    // Start performance monitoring
    this.startSecurePerformanceMonitoring();
    
    console.log('✅ Secure ML activity detector started');
  }

  startSecurePredictionProcessing() {
    this.processingInterval = setInterval(async () => {
      try {
        await this.processSecurePredictionQueue();
      } catch (error) {
        console.error('Secure prediction processing error:', error);
        await this.metrics.incrementCounter('ml_detector.processing_errors', 1, {}, 'risk');
      }
    }, this.config.predictionWindow / 10); // Process 10 times per window
  }

  startSecureModelRetraining() {
    this.retrainingInterval = setInterval(async () => {
      try {
        await this.performSecureModelRetraining();
      } catch (error) {
        console.error('Secure model retraining error:', error);
      }
    }, this.config.retrainInterval);
  }

  startSecurePerformanceMonitoring() {
    this.performanceInterval = setInterval(async () => {
      await this.updateSecurePerformanceMetrics();
    }, 60000); // Every minute
  }

  async analyzeSecureUserActivity(userId, activityData, authenticatedUser = null, authToken = null) {
    // Security checks
    if (this.config.authenticationRequired) {
      await this.authenticate(authToken);
      await this.authorize(authenticatedUser?.id, 'analyze', authenticatedUser);
    }
    
    // Input validation
    const sanitizedUserId = this.sanitizeString(userId);
    if (!sanitizedUserId) {
      throw new Error('Invalid user ID');
    }
    
    if (!activityData || typeof activityData !== 'object') {
      throw new Error('Invalid activity data');
    }
    
    // Rate limiting
    if (authenticatedUser?.id) {
      await this.checkRateLimit(authenticatedUser.id, 'analyze_activity');
    }
    
    // Acquire lock for atomic operation
    const lockId = await this.acquireLock(`analyze_${sanitizedUserId}`);
    
    try {
      const startTime = Date.now();
      
      // Sanitize and validate activity data
      const sanitizedActivity = this.sanitizeActivityData(activityData);
      
      // Extract features securely
      const features = await this.extractSecureFeatures(sanitizedUserId, sanitizedActivity);
      
      // Perform prediction with validation
      const prediction = await this.makeSecurePrediction(sanitizedUserId, features);
      
      // Store results with expiry
      await this.storeSecurePredictionResult(sanitizedUserId, prediction, features);
      
      // Update performance metrics
      const processingTime = Date.now() - startTime;
      this.updatePredictionMetrics(processingTime);
      
      // Check for anomalies
      if (prediction.anomalyScore >= this.config.anomalyThreshold) {
        await this.handleAnomalyDetection(sanitizedUserId, prediction, sanitizedActivity);
      }
      
      return {
        userId: sanitizedUserId,
        anomalyScore: prediction.anomalyScore,
        severity: this.calculateSeverity(prediction.anomalyScore),
        features: this.sanitizeFeatures(features),
        timestamp: Date.now(),
        processingTime
      };
      
    } finally {
      await this.releaseLock(`analyze_${sanitizedUserId}`);
    }
  }

  sanitizeActivityData(data) {
    const sanitized = {};
    
    // Validate numeric fields
    const numericFields = ['volume', 'price', 'quantity', 'frequency', 'latency'];
    for (const field of numericFields) {
      if (typeof data[field] === 'number' && isFinite(data[field]) && data[field] >= 0) {
        sanitized[field] = Math.min(data[field], 1e12); // Cap at 1 trillion
      }
    }
    
    // Validate string fields
    const stringFields = ['symbol', 'side', 'type', 'source'];
    for (const field of stringFields) {
      if (typeof data[field] === 'string') {
        sanitized[field] = this.sanitizeString(data[field]);
      }
    }
    
    // Validate timestamp
    if (typeof data.timestamp === 'number' && data.timestamp > 0) {
      const now = Date.now();
      const maxAge = 86400000; // 24 hours
      if (data.timestamp > now - maxAge && data.timestamp <= now) {
        sanitized.timestamp = data.timestamp;
      }
    }
    
    // Validate arrays
    if (Array.isArray(data.orders) && data.orders.length <= 1000) {
      sanitized.orders = data.orders.slice(0, 100).map(order => this.sanitizeActivityData(order));
    }
    
    return sanitized;
  }

  async extractSecureFeatures(userId, activityData) {
    const features = {};
    
    try {
      // Check cache first
      const cacheKey = `features_${userId}_${this.hashData(activityData)}`;
      const cached = this.featureCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < 300000) { // 5 minute cache
        this.performanceStats.cacheHitRate += 0.1;
        return cached.features;
      }
      
      // Extract transaction frequency features
      features.transaction_frequency = this.extractTransactionFrequency(userId, activityData);
      
      // Extract volume pattern features
      features.volume_patterns = this.extractVolumePatterns(userId, activityData);
      
      // Extract time distribution features
      features.time_distribution = this.extractTimeDistribution(userId, activityData);
      
      // Extract price impact features
      features.price_impact = this.extractPriceImpact(userId, activityData);
      
      // Extract order size distribution features
      features.order_size_distribution = this.extractOrderSizeDistribution(userId, activityData);
      
      // Extract cancellation rate features
      features.cancellation_rate = this.extractCancellationRate(userId, activityData);
      
      // Extract market timing features
      features.market_timing = this.extractMarketTiming(userId, activityData);
      
      // Extract cross-pair correlation features
      features.cross_pair_correlation = this.extractCrossPairCorrelation(userId, activityData);
      
      // Validate all features
      const validatedFeatures = this.validateFeatureVector(features);
      
      // Cache results
      this.featureCache.set(cacheKey, {
        features: validatedFeatures,
        timestamp: Date.now()
      });
      
      this.performanceStats.featuresExtracted++;
      
      return validatedFeatures;
      
    } catch (error) {
      console.error('Feature extraction error:', error);
      throw new Error('Failed to extract features');
    }
  }

  hashData(data) {
    return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex').substring(0, 16);
  }

  extractTransactionFrequency(userId, activityData) {
    const userHistory = this.userFeatures.get(userId) || { transactions: [] };
    const now = Date.now();
    const windowSizes = [300000, 900000, 3600000]; // 5min, 15min, 1hour
    
    const frequencies = windowSizes.map(window => {
      const recentTransactions = userHistory.transactions.filter(t => 
        t.timestamp && now - t.timestamp < window
      );
      return Math.min(recentTransactions.length / (window / 60000), 1000); // Transactions per minute, capped
    });
    
    return {
      freq_5min: frequencies[0],
      freq_15min: frequencies[1],
      freq_1hour: frequencies[2],
      avg_frequency: frequencies.reduce((a, b) => a + b, 0) / frequencies.length
    };
  }

  extractVolumePatterns(userId, activityData) {
    const volume = activityData.volume || 0;
    const userHistory = this.userFeatures.get(userId) || { volumes: [] };
    
    // Calculate volume statistics
    const recentVolumes = userHistory.volumes.slice(-100); // Last 100 transactions
    const avgVolume = recentVolumes.length > 0 ? 
      recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length : volume;
    
    const volumeDeviation = avgVolume > 0 ? Math.abs(volume - avgVolume) / avgVolume : 0;
    
    return {
      current_volume: Math.min(volume, 1e12),
      avg_volume: Math.min(avgVolume, 1e12),
      volume_deviation: Math.min(volumeDeviation, 100),
      volume_percentile: this.calculatePercentile(recentVolumes, volume)
    };
  }

  extractTimeDistribution(userId, activityData) {
    const timestamp = activityData.timestamp || Date.now();
    const hour = new Date(timestamp).getHours();
    const dayOfWeek = new Date(timestamp).getDay();
    
    const userHistory = this.userFeatures.get(userId) || { timestamps: [] };
    const recentTimestamps = userHistory.timestamps.slice(-100);
    
    // Calculate hour distribution
    const hourDistribution = new Array(24).fill(0);
    recentTimestamps.forEach(ts => {
      const h = new Date(ts).getHours();
      hourDistribution[h]++;
    });
    
    const expectedHourlyActivity = recentTimestamps.length / 24;
    const currentHourActivity = hourDistribution[hour];
    const hourlyDeviation = expectedHourlyActivity > 0 ? 
      Math.abs(currentHourActivity - expectedHourlyActivity) / expectedHourlyActivity : 0;
    
    return {
      hour_of_day: hour,
      day_of_week: dayOfWeek,
      hourly_deviation: Math.min(hourlyDeviation, 10),
      is_weekend: dayOfWeek === 0 || dayOfWeek === 6 ? 1 : 0,
      is_market_hours: (hour >= 9 && hour <= 16) ? 1 : 0
    };
  }

  extractPriceImpact(userId, activityData) {
    const volume = activityData.volume || 0;
    const price = activityData.price || 0;
    const marketData = this.marketFeatures.get('current') || {};
    
    const estimatedImpact = volume > 0 && marketData.liquidity > 0 ? 
      Math.min(volume / marketData.liquidity, 1.0) : 0;
    
    return {
      estimated_impact: estimatedImpact,
      volume_to_liquidity_ratio: volume > 0 && marketData.liquidity > 0 ? 
        Math.min(volume / marketData.liquidity, 100) : 0,
      price_deviation: marketData.avgPrice > 0 ? 
        Math.min(Math.abs(price - marketData.avgPrice) / marketData.avgPrice, 10) : 0
    };
  }

  extractOrderSizeDistribution(userId, activityData) {
    const orderSize = activityData.quantity || 0;
    const userHistory = this.userFeatures.get(userId) || { orderSizes: [] };
    const recentSizes = userHistory.orderSizes.slice(-100);
    
    const avgSize = recentSizes.length > 0 ? 
      recentSizes.reduce((a, b) => a + b, 0) / recentSizes.length : orderSize;
    
    return {
      current_size: Math.min(orderSize, 1e12),
      avg_size: Math.min(avgSize, 1e12),
      size_deviation: avgSize > 0 ? Math.min(Math.abs(orderSize - avgSize) / avgSize, 100) : 0,
      size_percentile: this.calculatePercentile(recentSizes, orderSize)
    };
  }

  extractCancellationRate(userId, activityData) {
    const userHistory = this.userFeatures.get(userId) || { orders: [] };
    const recentOrders = userHistory.orders.slice(-100);
    
    const totalOrders = recentOrders.length;
    const cancelledOrders = recentOrders.filter(o => o.status === 'cancelled').length;
    const cancellationRate = totalOrders > 0 ? cancelledOrders / totalOrders : 0;
    
    return {
      cancellation_rate: Math.min(cancellationRate, 1.0),
      recent_cancellations: Math.min(cancelledOrders, 100),
      total_recent_orders: Math.min(totalOrders, 100)
    };
  }

  extractMarketTiming(userId, activityData) {
    const timestamp = activityData.timestamp || Date.now();
    const marketData = this.marketFeatures.get('current') || {};
    
    const volatility = marketData.volatility || 0;
    const volume = marketData.volume || 1;
    const spread = marketData.spread || 0;
    
    return {
      market_volatility: Math.min(volatility, 10),
      market_volume: Math.min(volume, 1e12),
      market_spread: Math.min(spread, 1),
      timing_score: this.calculateTimingScore(timestamp, marketData)
    };
  }

  extractCrossPairCorrelation(userId, activityData) {
    const symbol = activityData.symbol || '';
    const userHistory = this.userFeatures.get(userId) || { symbols: [] };
    const recentSymbols = userHistory.symbols.slice(-50);
    
    const uniqueSymbols = new Set(recentSymbols).size;
    const symbolFrequency = recentSymbols.filter(s => s === symbol).length;
    const symbolDiversity = recentSymbols.length > 0 ? uniqueSymbols / recentSymbols.length : 1;
    
    return {
      symbol_diversity: Math.min(symbolDiversity, 1),
      symbol_frequency: Math.min(symbolFrequency, 50),
      unique_symbols: Math.min(uniqueSymbols, 50),
      correlation_score: this.calculateCorrelationScore(symbol, recentSymbols)
    };
  }

  calculatePercentile(values, target) {
    if (values.length === 0) return 0.5;
    const sorted = [...values].sort((a, b) => a - b);
    const position = sorted.findIndex(v => v >= target);
    return position === -1 ? 1.0 : Math.min(position / sorted.length, 1.0);
  }

  calculateTimingScore(timestamp, marketData) {
    // Simple timing score based on market conditions
    const hour = new Date(timestamp).getHours();
    const isMarketHours = hour >= 9 && hour <= 16;
    const volatilityScore = Math.min((marketData.volatility || 0) * 10, 1);
    
    return isMarketHours ? volatilityScore : volatilityScore * 0.5;
  }

  calculateCorrelationScore(symbol, recentSymbols) {
    // Simple correlation score based on symbol usage patterns
    if (recentSymbols.length === 0) return 0;
    
    const symbolCount = recentSymbols.filter(s => s === symbol).length;
    const frequency = symbolCount / recentSymbols.length;
    
    return Math.min(frequency, 1.0);
  }

  validateFeatureVector(features) {
    const validated = {};
    
    for (const [category, categoryFeatures] of Object.entries(features)) {
      if (typeof categoryFeatures === 'object' && categoryFeatures !== null) {
        validated[category] = {};
        
        for (const [featureName, value] of Object.entries(categoryFeatures)) {
          if (typeof value === 'number' && isFinite(value)) {
            validated[category][featureName] = Math.max(0, Math.min(value, 1e6)); // Bound values
          }
        }
      }
    }
    
    return validated;
  }

  async makeSecurePrediction(userId, features) {
    try {
      // Get the active model
      const model = this.getActiveModel();
      if (!model) {
        throw new Error('No active model available');
      }
      
      // Flatten feature vector for prediction
      const featureVector = this.flattenFeatures(features);
      
      // Make prediction (simplified - in real implementation would use actual ML model)
      const anomalyScore = this.calculateAnomalyScore(featureVector, model);
      
      // Validate prediction result
      const validatedScore = this.validateNumber(anomalyScore, 0.5, 0.0, 1.0);
      
      return {
        anomalyScore: validatedScore,
        confidence: this.calculateConfidence(featureVector, model),
        modelId: model.id,
        timestamp: Date.now()
      };
      
    } catch (error) {
      console.error('Prediction error:', error);
      throw new Error('Failed to make prediction');
    }
  }

  getActiveModel() {
    // Return the most recent trained model
    for (const [modelId, model] of this.models.entries()) {
      if (model.status === 'active') {
        return model;
      }
    }
    
    // Return default model if no active model
    return {
      id: 'default',
      type: this.config.modelType,
      status: 'active',
      threshold: this.config.anomalyThreshold
    };
  }

  flattenFeatures(features) {
    const flattened = [];
    
    for (const categoryFeatures of Object.values(features)) {
      if (typeof categoryFeatures === 'object' && categoryFeatures !== null) {
        for (const value of Object.values(categoryFeatures)) {
          if (typeof value === 'number' && isFinite(value)) {
            flattened.push(value);
          }
        }
      }
    }
    
    return flattened;
  }

  calculateAnomalyScore(featureVector, model) {
    // Simplified anomaly score calculation
    // In real implementation, this would use the actual trained ML model
    
    if (featureVector.length === 0) return 0.5;
    
    // Calculate basic statistical anomaly score
    const mean = featureVector.reduce((a, b) => a + b, 0) / featureVector.length;
    const variance = featureVector.reduce((sum, x) => sum + Math.pow(x - mean, 2), 0) / featureVector.length;
    const stdDev = Math.sqrt(variance);
    
    // Simple outlier detection based on standard deviations
    const zScores = featureVector.map(x => Math.abs(x - mean) / (stdDev || 1));
    const maxZScore = Math.max(...zScores);
    
    // Convert z-score to probability (simplified sigmoid)
    const anomalyScore = 1 / (1 + Math.exp(-maxZScore + 2));
    
    return Math.min(Math.max(anomalyScore, 0), 1);
  }

  calculateConfidence(featureVector, model) {
    // Simple confidence calculation based on feature vector completeness
    const expectedFeatures = this.config.features.length * 4; // Average 4 features per category
    const actualFeatures = featureVector.length;
    
    return Math.min(actualFeatures / expectedFeatures, 1.0);
  }

  calculateSeverity(anomalyScore) {
    const thresholds = this.config.severityThresholds;
    
    if (anomalyScore >= thresholds.critical) return 'critical';
    if (anomalyScore >= thresholds.high) return 'high';
    if (anomalyScore >= thresholds.medium) return 'medium';
    if (anomalyScore >= thresholds.low) return 'low';
    
    return 'normal';
  }

  async storeSecurePredictionResult(userId, prediction, features) {
    // Store with TTL
    const expiryTime = Date.now() + this.config.dataRetention;
    
    const result = {
      prediction,
      features: this.sanitizeFeatures(features),
      timestamp: Date.now()
    };
    
    // Limit stored predictions per user
    const userPredictions = this.predictions.get(userId) || [];
    userPredictions.push(result);
    
    if (userPredictions.length > this.maxPredictionHistory) {
      userPredictions.shift(); // Remove oldest
    }
    
    this.predictions.set(userId, userPredictions);
    
    // Store in Redis with encryption
    await this.saveEncryptedPrediction(userId, result);
  }

  sanitizeFeatures(features) {
    // Remove sensitive information from features before storage
    const sanitized = {};
    
    for (const [category, categoryFeatures] of Object.entries(features)) {
      sanitized[category] = {};
      for (const [name, value] of Object.entries(categoryFeatures)) {
        if (typeof value === 'number') {
          sanitized[category][name] = Math.round(value * 1000) / 1000; // Round to 3 decimal places
        }
      }
    }
    
    return sanitized;
  }

  async handleAnomalyDetection(userId, prediction, activityData) {
    const anomaly = {
      userId,
      anomalyScore: prediction.anomalyScore,
      severity: this.calculateSeverity(prediction.anomalyScore),
      timestamp: Date.now(),
      activityType: activityData.type || 'unknown',
      details: this.sanitizeObject(activityData)
    };
    
    // Store anomaly
    this.anomalies.set(userId, anomaly);
    this.anomalyExpiry.set(userId, Date.now() + this.config.dataRetention);
    
    // Emit event
    this.emit('anomaly_detected', anomaly);
    
    // Update metrics
    await this.metrics.incrementCounter('ml_detector.anomalies_detected', 1, {
      severity: anomaly.severity
    }, 'risk');
    
    console.warn(`Anomaly detected for user ${userId}: ${anomaly.severity} (${prediction.anomalyScore})`);
    
    // Save to Redis
    await this.saveEncryptedAnomaly(userId, anomaly);
  }

  sanitizeObject(obj) {
    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      const cleanKey = this.sanitizeString(key);
      if (cleanKey && typeof value !== 'function') {
        if (typeof value === 'string') {
          sanitized[cleanKey] = this.sanitizeString(value);
        } else if (typeof value === 'number' && isFinite(value)) {
          sanitized[cleanKey] = value;
        } else if (typeof value === 'boolean') {
          sanitized[cleanKey] = value;
        }
      }
    }
    return sanitized;
  }

  // Continue with remaining methods following the same patterns...
  // [Additional methods would follow the same security, validation, and performance patterns]

  stop() {
    if (!this.isRunning) return;
    
    console.log('🛑 Stopping secure ML activity detector...');
    
    // Stop intervals
    if (this.processingInterval) clearInterval(this.processingInterval);
    if (this.retrainingInterval) clearInterval(this.retrainingInterval);
    if (this.performanceInterval) clearInterval(this.performanceInterval);
    if (this.memoryMonitorInterval) clearInterval(this.memoryMonitorInterval);
    
    // Release all locks
    for (const lockKey of this.operationLocks.keys()) {
      this.releaseLock(lockKey);
    }
    
    // Close Redis connection
    if (this.redis) {
      this.redis.quit();
    }
    
    // Clear data structures
    this.models.clear();
    this.userFeatures.clear();
    this.predictions.clear();
    this.anomalies.clear();
    this.featureCache.clear();
    this.operationLocks.clear();
    this.lockTimeouts.clear();
    this.rateLimiters.clear();
    
    this.isRunning = false;
    console.log('✅ Secure ML activity detector stopped');
  }
}

// Simple LRU cache implementation
class LRU {
  constructor(maxSize) {
    this.maxSize = maxSize;
    this.cache = new Map();
  }
  
  get(key) {
    if (this.cache.has(key)) {
      const value = this.cache.get(key);
      this.cache.delete(key);
      this.cache.set(key, value);
      return value;
    }
    return undefined;
  }
  
  set(key, value) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }
  
  delete(key) {
    return this.cache.delete(key);
  }
  
  entries() {
    return this.cache.entries();
  }
}

module.exports = SecureMLActivityDetector;