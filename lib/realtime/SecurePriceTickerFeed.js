const EventEmitter = require('events');
const crypto = require('crypto');
const { getSecureMetricsCollector } = require('../monitoring/secure-metrics-collector');

/**
 * Secure Price Ticker Streaming Service
 * Provides real-time price updates with enhanced security and validation
 */
class SecurePriceTickerFeed extends EventEmitter {
  constructor(config = {}) {
    super();
    
    // Validate configuration
    this.validateConfig(config);
    
    this.config = {
      updateInterval: Math.max(config.updateInterval || 1000, 100), // Min 100ms
      candleIntervals: this.validateCandleIntervals(config.candleIntervals || ['1m', '5m', '15m', '1h', '1d']),
      enableTechnicalIndicators: config.enableTechnicalIndicators !== false,
      enableMarketStats: config.enableMarketStats !== false,
      priceChangePrecision: Math.min(Math.max(config.priceChangePrecision || 8, 0), 18),
      historyRetention: Math.min(config.historyRetention || 86400000, 7 * 86400000), // Max 7 days
      maxPriceHistoryPoints: Math.min(config.maxPriceHistoryPoints || 10000, 100000),
      maxCandlesPerSymbol: Math.min(config.maxCandlesPerSymbol || 1000, 10000),
      maxSymbolsTracked: Math.min(config.maxSymbolsTracked || 1000, 10000),
      maxSubscriptionsPerUser: Math.min(config.maxSubscriptionsPerUser || 50, 500),
      encryptionKey: config.encryptionKey, // Required for secure operations
      enableDataSanitization: config.enableDataSanitization !== false,
      enableRateLimiting: config.enableRateLimiting !== false,
      ...config
    };
    
    this.metrics = getSecureMetricsCollector();
    this.webSocketManager = null;
    
    // Secure data management with bounded collections
    this.currentPrices = new LRUCache(this.config.maxSymbolsTracked);
    this.priceHistory = new LRUCache(this.config.maxSymbolsTracked);
    this.candleData = new LRUCache(this.config.maxSymbolsTracked);
    this.volumeData = new LRUCache(this.config.maxSymbolsTracked);
    
    // Subscription management with security controls
    this.subscriptions = new Map();
    this.symbolSubscribers = new LRUCache(this.config.maxSymbolsTracked);
    this.allTickerSubscribers = new Set();
    this.userSubscriptionCounts = new Map(); // userId -> count
    
    // Security controls
    this.securityConfig = {
      maxProcessingTimeMs: 1000,
      maxConcurrentUpdates: 100,
      enableInputValidation: true,
      enableOutputSanitization: true,
      maxPriceDeviation: 0.5, // 50% max price change
      maxVolumeDeviation: 10.0, // 1000% max volume change
      suspiciousActivityThreshold: 1000,
      enableCircuitBreaker: true,
      circuitBreakerThreshold: 0.1,
      hashAlgorithm: 'sha256'
    };
    
    // Technical indicators with bounds
    this.technicalIndicators = new LRUCache(this.config.maxSymbolsTracked);
    this.indicatorCalculators = {
      sma: this.calculateSecureSMA.bind(this),
      ema: this.calculateSecureEMA.bind(this),
      rsi: this.calculateSecureRSI.bind(this),
      macd: this.calculateSecureMACD.bind(this),
      bollinger: this.calculateSecureBollingerBands.bind(this)
    };
    
    // Market statistics with validation
    this.marketStats = new LRUCache(this.config.maxSymbolsTracked);
    this.globalMarketStats = {
      totalVolume24h: 0,
      totalValue24h: 0,
      activeSymbols: 0,
      priceChangeDistribution: { positive: 0, negative: 0, neutral: 0 },
      lastUpdate: Date.now()
    };
    
    // Performance and security tracking
    this.performanceStats = {
      tickersProcessed: 0,
      tickersSent: 0,
      subscriptionsActive: 0,
      candlesGenerated: 0,
      indicatorsCalculated: 0,
      avgUpdateLatency: 0,
      bytesTransferred: 0,
      securityViolations: 0,
      invalidDataFiltered: 0,
      circuitBreakerTrips: 0,
      suspiciousActivities: 0
    };
    
    // Circuit breaker state
    this.circuitBreaker = {
      state: 'closed', // closed, open, half-open
      failureCount: 0,
      lastFailureTime: 0,
      resetTimeout: 30000
    };
    
    // Active operations tracking
    this.activeOperations = new Set();
    
    // Input validation schemas
    this.validationSchemas = {
      priceData: {
        symbol: { type: 'string', pattern: /^[A-Z]{2,10}\/[A-Z]{2,10}$/, required: true },
        price: { type: 'number', min: 0, max: 1e12, required: true },
        volume: { type: 'number', min: 0, max: 1e12 },
        timestamp: { type: 'number', min: 0, required: true },
        source: { type: 'string', maxLength: 50 }
      },
      subscriptionParams: {
        symbol: { type: 'string', pattern: /^[A-Z]{2,10}\/[A-Z]{2,10}$/, maxLength: 20 },
        includeIndicators: { type: 'boolean' },
        includeVolume: { type: 'boolean' },
        includeMarketStats: { type: 'boolean' }
      }
    };
    
    // Price change thresholds for anomaly detection
    this.priceChangeThresholds = {
      minor: 0.01,    // 1%
      moderate: 0.05, // 5%
      major: 0.10,    // 10%
      suspicious: 0.50 // 50%
    };
    
    this.startSecureTickerProcessor();
    this.startSecureCandleGenerator();
    this.startSecurityMonitoring();
    this.startCleanupTask();
  }
  
  /**
   * Validate configuration for security
   */
  validateConfig(config) {
    const requiredFields = ['encryptionKey'];
    const missingFields = requiredFields.filter(field => !config[field]);
    if (missingFields.length > 0) {
      throw new SecurityError(`Missing required configuration: ${missingFields.join(', ')}`);
    }
  }
  
  /**
   * Validate candle intervals
   */
  validateCandleIntervals(intervals) {
    const allowedIntervals = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'];
    return intervals.filter(interval => allowedIntervals.includes(interval)).slice(0, 10);
  }
  
  /**
   * Initialize with WebSocket manager
   */
  initialize(webSocketManager) {
    this.webSocketManager = webSocketManager;
    
    this.webSocketManager.on('subscribed', (event) => {
      try {
        if (event.channel === 'ticker') {
          this.handleSecureTickerSubscription(event);
        } else if (event.channel === 'all_tickers') {
          this.handleSecureAllTickersSubscription(event);
        }
      } catch (error) {
        this.handleSecurityViolation('subscription_error', error, event);
      }
    });
    
    this.webSocketManager.on('unsubscribed', (event) => {
      this.handleUnsubscription(event);
    });
    
    this.webSocketManager.on('disconnection', (event) => {
      this.handleDisconnection(event);
    });
  }
  
  /**
   * Secure price update with comprehensive validation
   */
  updatePrice(symbol, priceData) {
    const operationId = crypto.randomBytes(8).toString('hex');
    
    try {
      // Check circuit breaker
      if (this.circuitBreaker.state === 'open') {
        throw new SecurityError('Circuit breaker is open');
      }
      
      // Check concurrent operations
      if (this.activeOperations.size >= this.securityConfig.maxConcurrentUpdates) {
        throw new SecurityError('Maximum concurrent operations exceeded');
      }
      
      this.activeOperations.add(operationId);
      const startTime = Date.now();
      
      // Validate and sanitize input
      const sanitizedData = this.validateAndSanitizePriceData(symbol, priceData);
      
      // Anomaly detection
      this.detectPriceAnomalies(symbol, sanitizedData);
      
      const previousPrice = this.currentPrices.get(symbol);
      
      // Update current price securely
      this.secureUpdateCurrentPrice(symbol, sanitizedData);
      
      // Add to price history with bounds checking
      this.secureAddToPriceHistory(symbol, sanitizedData);
      
      // Update volume data with validation
      this.secureUpdateVolumeData(symbol, sanitizedData);
      
      // Calculate technical indicators if enabled
      if (this.config.enableTechnicalIndicators) {
        this.secureUpdateTechnicalIndicators(symbol);
      }
      
      // Update market statistics if enabled
      if (this.config.enableMarketStats) {
        this.secureUpdateMarketStats(symbol, sanitizedData, previousPrice);
      }
      
      // Queue for secure broadcast
      this.queueSecureTickerUpdate(symbol, sanitizedData, previousPrice);
      
      this.performanceStats.tickersProcessed++;
      this.performanceStats.avgUpdateLatency = this.updateAverage(
        this.performanceStats.avgUpdateLatency,
        Date.now() - startTime,
        this.performanceStats.tickersProcessed
      );
      
      // Reset circuit breaker on success
      if (this.circuitBreaker.state === 'half-open') {
        this.circuitBreaker.state = 'closed';
        this.circuitBreaker.failureCount = 0;
      }
      
      this.emit('price_updated', { 
        symbol, 
        timestamp: sanitizedData.timestamp,
        operationId: operationId 
      });
      
    } catch (error) {
      this.handlePriceUpdateError(error, symbol, priceData, operationId);
      throw error;
    } finally {
      this.activeOperations.delete(operationId);
    }
  }
  
  /**
   * Validate and sanitize price data
   */
  validateAndSanitizePriceData(symbol, priceData) {
    // Validate symbol
    if (!this.validateField(symbol, this.validationSchemas.priceData.symbol)) {
      throw new SecurityError('Invalid symbol format');
    }
    
    // Validate price data fields
    for (const [field, schema] of Object.entries(this.validationSchemas.priceData)) {
      if (field === 'symbol') continue; // Already validated
      
      if (!this.validateField(priceData[field], schema)) {
        if (schema.required) {
          throw new SecurityError(`Invalid ${field} in price data`);
        }
      }
    }
    
    // Sanitize and normalize
    const sanitized = {
      symbol: this.sanitizeString(symbol).toUpperCase(),
      price: this.sanitizeNumber(priceData.price),
      volume: this.sanitizeNumber(priceData.volume || 0),
      timestamp: this.validateTimestamp(priceData.timestamp),
      source: this.sanitizeString(priceData.source || 'internal'),
      metadata: this.sanitizeMetadata(priceData.metadata || {})
    };
    
    // Business rule validation
    this.validatePriceBusinessRules(sanitized);
    
    return sanitized;
  }
  
  /**
   * Validate field against schema
   */
  validateField(value, schema) {
    if (schema.required && (value === undefined || value === null)) {
      return false;
    }
    
    if (value === undefined || value === null) {
      return !schema.required;
    }
    
    if (schema.type && typeof value !== schema.type) {
      return false;
    }
    
    if (schema.maxLength && value.length > schema.maxLength) {
      return false;
    }
    
    if (schema.pattern && !schema.pattern.test(value)) {
      return false;
    }
    
    if (schema.min !== undefined && value < schema.min) {
      return false;
    }
    
    if (schema.max !== undefined && value > schema.max) {
      return false;
    }
    
    return true;
  }
  
  /**
   * Sanitize string input
   */
  sanitizeString(str) {
    if (typeof str !== 'string') return '';
    
    return str
      .replace(/[<>\"'&]/g, '')
      .replace(/\${.*?}/g, '')
      .replace(/javascript:/gi, '')
      .trim();
  }
  
  /**
   * Sanitize numeric input
   */
  sanitizeNumber(num) {
    if (typeof num === 'string') {
      num = parseFloat(num);
    }
    
    if (isNaN(num) || !isFinite(num) || num < 0) {
      return 0;
    }
    
    // Limit precision to prevent floating point issues
    return Math.round(num * 1e8) / 1e8;
  }
  
  /**
   * Validate timestamp
   */
  validateTimestamp(timestamp) {
    const ts = parseInt(timestamp);
    const now = Date.now();
    
    // Allow timestamps within reasonable range (24 hours past to 1 hour future)
    if (isNaN(ts) || ts < now - 86400000 || ts > now + 3600000) {
      return now;
    }
    
    return ts;
  }
  
  /**
   * Sanitize metadata object
   */
  sanitizeMetadata(metadata) {
    const sanitized = {};
    const maxFields = 5;
    let fieldCount = 0;
    
    for (const [key, value] of Object.entries(metadata)) {
      if (fieldCount >= maxFields) break;
      
      const cleanKey = this.sanitizeString(key);
      if (cleanKey.length > 0 && cleanKey.length <= 20) {
        if (typeof value === 'string') {
          sanitized[cleanKey] = this.sanitizeString(value);
        } else if (typeof value === 'number' && isFinite(value)) {
          sanitized[cleanKey] = value;
        }
        fieldCount++;
      }
    }
    
    return sanitized;
  }
  
  /**
   * Validate price business rules
   */
  validatePriceBusinessRules(priceData) {
    const price = priceData.price;
    const volume = priceData.volume;
    
    if (price <= 0 || price > 1e9) {
      throw new SecurityError('Price outside acceptable bounds');
    }
    
    if (volume < 0 || volume > 1e12) {
      throw new SecurityError('Volume outside acceptable bounds');
    }
  }
  
  /**
   * Detect price anomalies
   */
  detectPriceAnomalies(symbol, newData) {
    const previousPrice = this.currentPrices.get(symbol);
    if (!previousPrice) return; // No baseline for comparison
    
    const oldPrice = previousPrice.price;
    const newPrice = newData.price;
    const priceChange = Math.abs((newPrice - oldPrice) / oldPrice);
    
    // Check for suspicious price movements
    if (priceChange > this.priceChangeThresholds.suspicious) {
      this.performanceStats.suspiciousActivities++;
      this.emit('suspicious_price_movement', {
        symbol: symbol,
        oldPrice: oldPrice,
        newPrice: newPrice,
        changePercent: priceChange * 100,
        timestamp: Date.now()
      });
      
      // Could reject the update or flag for manual review
      if (priceChange > this.securityConfig.maxPriceDeviation) {
        throw new SecurityError('Price change exceeds maximum allowed deviation');
      }
    }
    
    // Check volume anomalies
    const oldVolume = previousPrice.volume || 0;
    const newVolume = newData.volume;
    if (oldVolume > 0) {
      const volumeChange = Math.abs((newVolume - oldVolume) / oldVolume);
      if (volumeChange > this.securityConfig.maxVolumeDeviation) {
        this.performanceStats.suspiciousActivities++;
        this.emit('suspicious_volume_movement', {
          symbol: symbol,
          oldVolume: oldVolume,
          newVolume: newVolume,
          changeMultiple: volumeChange,
          timestamp: Date.now()
        });
      }
    }
  }
  
  /**
   * Secure update current price
   */
  secureUpdateCurrentPrice(symbol, priceData) {
    // Check symbol limits
    if (!this.currentPrices.has(symbol) && this.currentPrices.size >= this.config.maxSymbolsTracked) {
      throw new SecurityError('Maximum symbols tracked limit exceeded');
    }
    
    this.currentPrices.set(symbol, priceData);
  }
  
  /**
   * Secure add to price history
   */
  secureAddToPriceHistory(symbol, priceData) {
    let history = this.priceHistory.get(symbol);
    if (!history) {
      history = [];
      this.priceHistory.set(symbol, history);
    }
    
    history.push({
      price: priceData.price,
      volume: priceData.volume,
      timestamp: priceData.timestamp
    });
    
    // Maintain bounded size
    if (history.length > this.config.maxPriceHistoryPoints) {
      const removeCount = Math.floor(this.config.maxPriceHistoryPoints * 0.1);
      history.splice(0, removeCount);
    }
  }
  
  /**
   * Secure update volume data
   */
  secureUpdateVolumeData(symbol, priceData) {
    let volumeStats = this.volumeData.get(symbol);
    if (!volumeStats) {
      volumeStats = {
        volume24h: 0,
        volumeChange24h: 0,
        trades24h: 0,
        lastReset: Date.now()
      };
      this.volumeData.set(symbol, volumeStats);
    }
    
    const volume = priceData.volume;
    const now = Date.now();
    
    // Reset daily stats if needed
    if (now - volumeStats.lastReset > 86400000) {
      volumeStats.volume24h = 0;
      volumeStats.trades24h = 0;
      volumeStats.lastReset = now;
    }
    
    volumeStats.volume24h += volume;
    volumeStats.trades24h++;
  }
  
  /**
   * Secure update technical indicators
   */
  secureUpdateTechnicalIndicators(symbol) {
    try {
      const history = this.priceHistory.get(symbol);
      if (!history || history.length < 20) return;
      
      let indicators = this.technicalIndicators.get(symbol);
      if (!indicators) {
        indicators = {};
        this.technicalIndicators.set(symbol, indicators);
      }
      
      // Limit history size for calculation
      const maxCalcPoints = Math.min(history.length, 200);
      const prices = history.slice(-maxCalcPoints).map(h => h.price);
      
      // Calculate indicators with timeout protection
      const calculationTimeout = 1000; // 1 second max
      
      indicators.sma20 = this.calculateWithTimeout(() => 
        this.calculateSecureSMA(prices, 20), calculationTimeout);
      indicators.sma50 = this.calculateWithTimeout(() => 
        this.calculateSecureSMA(prices, 50), calculationTimeout);
      indicators.ema20 = this.calculateWithTimeout(() => 
        this.calculateSecureEMA(prices, 20), calculationTimeout);
      indicators.rsi14 = this.calculateWithTimeout(() => 
        this.calculateSecureRSI(prices, 14), calculationTimeout);
      indicators.macd = this.calculateWithTimeout(() => 
        this.calculateSecureMACD(prices), calculationTimeout);
      indicators.bollinger = this.calculateWithTimeout(() => 
        this.calculateSecureBollingerBands(prices, 20, 2), calculationTimeout);
      
      this.performanceStats.indicatorsCalculated++;
      
    } catch (error) {
      this.handleSecurityViolation('indicator_calculation_error', error, { symbol });
    }
  }
  
  /**
   * Calculate with timeout protection
   */
  calculateWithTimeout(calculationFunc, timeout) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Calculation timeout'));
      }, timeout);
      
      try {
        const result = calculationFunc();
        clearTimeout(timer);
        resolve(result);
      } catch (error) {
        clearTimeout(timer);
        reject(error);
      }
    }).catch(() => null); // Return null on error/timeout
  }
  
  /**
   * Handle secure ticker subscription
   */
  handleSecureTickerSubscription(event) {
    const { connectionId, params } = event;
    
    // Get connection for authorization
    const connection = this.webSocketManager.connections?.get(connectionId);
    if (!connection || !connection.authenticated) {
      throw new SecurityError('Unauthenticated connection');
    }
    
    // Validate subscription parameters
    this.validateSubscriptionParams(params);
    
    const { 
      symbol,
      includeIndicators = false,
      includeVolume = true,
      includeMarketStats = false
    } = params;
    
    if (!symbol) {
      throw new SecurityError('Symbol parameter required');
    }
    
    // Check user subscription limits
    this.checkUserSubscriptionLimits(connection.userId);
    
    // Validate symbol format
    if (!this.validateField(symbol, this.validationSchemas.subscriptionParams.symbol)) {
      throw new SecurityError('Invalid symbol format');
    }
    
    const subscriptionKey = this.generateSecureSubscriptionKey(connectionId, symbol);
    
    // Store subscription with security metadata
    this.subscriptions.set(subscriptionKey, {
      connectionId: connectionId,
      userId: connection.userId,
      channel: 'ticker',
      symbol: symbol,
      includeIndicators: Boolean(includeIndicators),
      includeVolume: Boolean(includeVolume),
      includeMarketStats: Boolean(includeMarketStats),
      subscribedAt: Date.now(),
      accessCount: 0,
      permissions: connection.metadata?.permissions || []
    });
    
    // Track symbol subscribers
    this.addSymbolSubscriber(symbol, subscriptionKey);
    
    // Update user subscription count
    const currentCount = this.userSubscriptionCounts.get(connection.userId) || 0;
    this.userSubscriptionCounts.set(connection.userId, currentCount + 1);
    
    this.performanceStats.subscriptionsActive++;
    
    // Send current ticker data
    this.sendSecureCurrentTicker(subscriptionKey);
    
    this.emit('ticker_subscription_added', { 
      subscriptionKey, 
      symbol, 
      connectionId,
      userId: connection.userId 
    });
  }
  
  /**
   * Check user subscription limits
   */
  checkUserSubscriptionLimits(userId) {
    const currentCount = this.userSubscriptionCounts.get(userId) || 0;
    if (currentCount >= this.config.maxSubscriptionsPerUser) {
      throw new SecurityError('Maximum subscriptions per user exceeded');
    }
  }
  
  /**
   * Validate subscription parameters
   */
  validateSubscriptionParams(params) {
    for (const [field, schema] of Object.entries(this.validationSchemas.subscriptionParams)) {
      if (params[field] && !this.validateField(params[field], schema)) {
        throw new SecurityError(`Invalid ${field} in subscription parameters`);
      }
    }
  }
  
  /**
   * Add symbol subscriber with bounds checking
   */
  addSymbolSubscriber(symbol, subscriptionKey) {
    let subscribers = this.symbolSubscribers.get(symbol);
    if (!subscribers) {
      subscribers = new Set();
      this.symbolSubscribers.set(symbol, subscribers);
    }
    
    subscribers.add(subscriptionKey);
  }
  
  /**
   * Send secure current ticker
   */
  sendSecureCurrentTicker(subscriptionKey) {
    const subscription = this.subscriptions.get(subscriptionKey);
    if (!subscription) return;
    
    const currentPrice = this.currentPrices.get(subscription.symbol);
    if (!currentPrice) return;
    
    try {
      const tickerData = this.createSecureTickerMessage(subscription.symbol, currentPrice, 0, 0);
      const filteredData = this.filterTickerDataForSubscription(tickerData, subscription);
      
      const message = {
        type: 'ticker_snapshot',
        data: filteredData,
        timestamp: Date.now()
      };
      
      this.webSocketManager.sendToConnection(subscription.connectionId, message);
      subscription.accessCount++;
      
    } catch (error) {
      this.handleSecurityViolation('ticker_send_error', error, { subscriptionKey });
    }
  }
  
  /**
   * Create secure ticker message with sanitization
   */
  createSecureTickerMessage(symbol, priceData, priceChange, priceChangePercent) {
    const marketStats = this.marketStats.get(symbol);
    const volumeStats = this.volumeData.get(symbol);
    const indicators = this.technicalIndicators.get(symbol);
    
    // Base ticker data with sanitized values
    const tickerData = {
      symbol: symbol,
      price: this.sanitizeNumber(priceData.price).toFixed(this.config.priceChangePrecision),
      priceChange: this.sanitizeNumber(priceChange).toFixed(this.config.priceChangePrecision),
      priceChangePercent: this.sanitizeNumber(priceChangePercent).toFixed(2),
      timestamp: priceData.timestamp
    };
    
    // Add market stats if available
    if (marketStats) {
      tickerData.high24h = this.sanitizeNumber(marketStats.high24h).toFixed(this.config.priceChangePrecision);
      tickerData.low24h = this.sanitizeNumber(marketStats.low24h).toFixed(this.config.priceChangePrecision);
      tickerData.open24h = this.sanitizeNumber(marketStats.open24h).toFixed(this.config.priceChangePrecision);
    }
    
    // Add volume stats if available
    if (volumeStats) {
      tickerData.volume24h = this.sanitizeNumber(volumeStats.volume24h).toString();
      tickerData.trades24h = Math.max(0, Math.floor(volumeStats.trades24h));
    }
    
    // Add technical indicators if available
    if (indicators) {
      tickerData.indicators = this.sanitizeIndicators(indicators);
    }
    
    return tickerData;
  }
  
  /**
   * Sanitize technical indicators
   */
  sanitizeIndicators(indicators) {
    const sanitized = {};
    
    // Only include safe, calculated indicators
    const allowedFields = ['sma20', 'sma50', 'ema20', 'rsi14'];
    
    for (const field of allowedFields) {
      if (indicators[field] !== null && indicators[field] !== undefined) {
        const value = this.sanitizeNumber(indicators[field]);
        if (isFinite(value)) {
          sanitized[field] = value.toFixed(this.config.priceChangePrecision);
        }
      }
    }
    
    // Add trend determination
    if (indicators.sma20 && indicators.sma50) {
      sanitized.trend = this.determineSecureTrend(indicators);
    }
    
    return sanitized;
  }
  
  /**
   * Determine trend securely
   */
  determineSecureTrend(indicators) {
    try {
      const sma20 = this.sanitizeNumber(indicators.sma20);
      const sma50 = this.sanitizeNumber(indicators.sma50);
      
      if (!isFinite(sma20) || !isFinite(sma50) || sma50 === 0) {
        return 'neutral';
      }
      
      const ratio = sma20 / sma50;
      
      if (ratio > 1.02) return 'bullish';
      if (ratio < 0.98) return 'bearish';
      return 'neutral';
      
    } catch (error) {
      return 'neutral';
    }
  }
  
  /**
   * Filter ticker data for subscription
   */
  filterTickerDataForSubscription(tickerData, subscription) {
    const filtered = { ...tickerData };
    
    // Remove indicators if not requested
    if (!subscription.includeIndicators) {
      delete filtered.indicators;
    }
    
    // Remove volume data if not requested
    if (!subscription.includeVolume) {
      delete filtered.volume24h;
      delete filtered.trades24h;
    }
    
    // Remove market stats if not requested
    if (!subscription.includeMarketStats) {
      delete filtered.high24h;
      delete filtered.low24h;
      delete filtered.open24h;
    }
    
    return filtered;
  }
  
  /**
   * Secure technical indicator calculations
   */
  calculateSecureSMA(prices, period) {
    if (!Array.isArray(prices) || prices.length < period || period <= 0) {
      return null;
    }
    
    const validPrices = prices.slice(-period).filter(p => isFinite(p) && p > 0);
    if (validPrices.length < period) return null;
    
    const sum = validPrices.reduce((a, b) => a + b, 0);
    return sum / validPrices.length;
  }
  
  calculateSecureEMA(prices, period) {
    if (!Array.isArray(prices) || prices.length < period || period <= 0) {
      return null;
    }
    
    const validPrices = prices.filter(p => isFinite(p) && p > 0);
    if (validPrices.length < period) return null;
    
    const multiplier = 2 / (period + 1);
    let ema = validPrices.slice(0, period).reduce((a, b) => a + b, 0) / period;
    
    for (let i = period; i < validPrices.length; i++) {
      ema = (validPrices[i] - ema) * multiplier + ema;
    }
    
    return ema;
  }
  
  calculateSecureRSI(prices, period = 14) {
    if (!Array.isArray(prices) || prices.length < period + 1 || period <= 0) {
      return null;
    }
    
    const validPrices = prices.filter(p => isFinite(p) && p > 0);
    if (validPrices.length < period + 1) return null;
    
    const gains = [];
    const losses = [];
    
    for (let i = 1; i < validPrices.length; i++) {
      const change = validPrices[i] - validPrices[i - 1];
      gains.push(change > 0 ? change : 0);
      losses.push(change < 0 ? Math.abs(change) : 0);
    }
    
    if (gains.length < period) return null;
    
    const avgGain = gains.slice(-period).reduce((a, b) => a + b, 0) / period;
    const avgLoss = losses.slice(-period).reduce((a, b) => a + b, 0) / period;
    
    if (avgLoss === 0) return 100;
    
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }
  
  calculateSecureMACD(prices, fastPeriod = 12, slowPeriod = 26) {
    const fastEMA = this.calculateSecureEMA(prices, fastPeriod);
    const slowEMA = this.calculateSecureEMA(prices, slowPeriod);
    
    if (!fastEMA || !slowEMA || !isFinite(fastEMA) || !isFinite(slowEMA)) {
      return null;
    }
    
    return {
      macd: fastEMA - slowEMA,
      signal: null,
      histogram: null
    };
  }
  
  calculateSecureBollingerBands(prices, period = 20, multiplier = 2) {
    const sma = this.calculateSecureSMA(prices, period);
    if (!sma || !isFinite(sma)) return null;
    
    const validPrices = prices.slice(-period).filter(p => isFinite(p) && p > 0);
    if (validPrices.length < period) return null;
    
    const variance = validPrices.reduce((sum, price) => {
      return sum + Math.pow(price - sma, 2);
    }, 0) / period;
    
    const stdDev = Math.sqrt(variance);
    
    return {
      upper: sma + stdDev * multiplier,
      middle: sma,
      lower: sma - stdDev * multiplier
    };
  }
  
  /**
   * Generate secure subscription key
   */
  generateSecureSubscriptionKey(...parts) {
    const data = parts.join(':') + ':' + Date.now() + ':' + crypto.randomBytes(8).toString('hex');
    return crypto.createHmac('sha256', this.config.encryptionKey)
      .update(data)
      .digest('hex')
      .substring(0, 32);
  }
  
  /**
   * Handle security violations
   */
  handleSecurityViolation(type, error, context) {
    this.performanceStats.securityViolations++;
    
    this.emit('security_violation', {
      type: type,
      error: error.message,
      context: context,
      timestamp: Date.now()
    });
  }
  
  /**
   * Handle price update errors
   */
  handlePriceUpdateError(error, symbol, priceData, operationId) {
    this.circuitBreaker.failureCount++;
    this.circuitBreaker.lastFailureTime = Date.now();
    
    if (this.circuitBreaker.failureCount >= this.securityConfig.circuitBreakerThreshold * 10) {
      this.circuitBreaker.state = 'open';
      this.performanceStats.circuitBreakerTrips++;
    }
    
    this.handleSecurityViolation('price_update_error', error, {
      symbol: symbol,
      operationId: operationId
    });
  }
  
  /**
   * Start security monitoring
   */
  startSecurityMonitoring() {
    setInterval(() => {
      this.performSecurityChecks();
    }, 60000); // Every minute
  }
  
  /**
   * Perform security checks
   */
  performSecurityChecks() {
    // Circuit breaker reset check
    if (this.circuitBreaker.state === 'open') {
      const timeSinceFailure = Date.now() - this.circuitBreaker.lastFailureTime;
      if (timeSinceFailure > this.circuitBreaker.resetTimeout) {
        this.circuitBreaker.state = 'half-open';
      }
    }
    
    // Memory usage check
    this.checkMemoryUsage();
    
    // Clean up stale data
    this.cleanupStaleSubscriptions();
  }
  
  /**
   * Check memory usage
   */
  checkMemoryUsage() {
    const used = process.memoryUsage();
    const usedMB = used.heapUsed / 1024 / 1024;
    
    if (usedMB > 500) { // 500MB threshold
      this.emit('high_memory_usage', { usedMB });
    }
  }
  
  /**
   * Clean up stale subscriptions
   */
  cleanupStaleSubscriptions() {
    const now = Date.now();
    const staleThreshold = 24 * 60 * 60 * 1000; // 24 hours
    
    for (const [subscriptionKey, subscription] of this.subscriptions) {
      if ((now - subscription.subscribedAt) > staleThreshold && subscription.accessCount === 0) {
        this.removeSubscription(subscriptionKey);
      }
    }
  }
  
  /**
   * Queue secure ticker update
   */
  queueSecureTickerUpdate(symbol, newData, previousData) {
    try {
      // Calculate price change safely
      let priceChange = 0;
      let priceChangePercent = 0;
      
      if (previousData) {
        const oldPrice = this.sanitizeNumber(previousData.price);
        const newPrice = this.sanitizeNumber(newData.price);
        
        if (oldPrice > 0) {
          priceChange = newPrice - oldPrice;
          priceChangePercent = (priceChange / oldPrice) * 100;
        }
      }
      
      // Create secure ticker message
      const tickerData = this.createSecureTickerMessage(symbol, newData, priceChange, priceChangePercent);
      
      // Broadcast to subscribers
      this.broadcastSecureToSymbolSubscribers(symbol, tickerData);
      this.broadcastSecureToAllTickerSubscribers(tickerData);
      
    } catch (error) {
      this.handleSecurityViolation('ticker_queue_error', error, { symbol });
    }
  }
  
  /**
   * Broadcast securely to symbol subscribers
   */
  broadcastSecureToSymbolSubscribers(symbol, tickerData) {
    const subscribers = this.symbolSubscribers.get(symbol);
    if (!subscribers || subscribers.size === 0) return;
    
    for (const subscriptionKey of subscribers) {
      try {
        const subscription = this.subscriptions.get(subscriptionKey);
        if (!subscription) continue;
        
        const filteredData = this.filterTickerDataForSubscription(tickerData, subscription);
        
        const message = {
          type: 'ticker_update',
          data: filteredData,
          timestamp: Date.now()
        };
        
        this.webSocketManager.sendToConnection(subscription.connectionId, message);
        subscription.accessCount++;
        
      } catch (error) {
        this.handleSecurityViolation('broadcast_error', error, { subscriptionKey });
      }
    }
    
    this.performanceStats.tickersSent++;
  }
  
  /**
   * Broadcast securely to all ticker subscribers
   */
  broadcastSecureToAllTickerSubscribers(tickerData) {
    if (this.allTickerSubscribers.size === 0) return;
    
    for (const connectionId of this.allTickerSubscribers) {
      try {
        const message = {
          type: 'all_tickers_update',
          data: [tickerData],
          timestamp: Date.now()
        };
        
        this.webSocketManager.sendToConnection(connectionId, message);
        
      } catch (error) {
        this.handleSecurityViolation('all_tickers_broadcast_error', error, { connectionId });
      }
    }
  }
  
  /**
   * Start secure ticker processor
   */
  startSecureTickerProcessor() {
    setInterval(() => {
      try {
        this.updateSecureGlobalMarketStats();
      } catch (error) {
        this.handleSecurityViolation('ticker_processor_error', error);
      }
    }, this.config.updateInterval);
  }
  
  /**
   * Update global market statistics securely
   */
  updateSecureGlobalMarketStats() {
    let totalVolume24h = 0;
    let totalValue24h = 0;
    let positiveChanges = 0;
    let negativeChanges = 0;
    let neutralChanges = 0;
    
    for (const [symbol, stats] of this.marketStats.cache) {
      if (!stats) continue;
      
      const volumeStats = this.volumeData.get(symbol);
      const currentPrice = this.currentPrices.get(symbol);
      
      if (volumeStats && currentPrice) {
        const volume = this.sanitizeNumber(volumeStats.volume24h);
        const price = this.sanitizeNumber(currentPrice.price);
        
        totalVolume24h += volume;
        totalValue24h += volume * price;
      }
      
      const changePercent = this.sanitizeNumber(stats.priceChangePercent24h || 0);
      if (changePercent > 0.1) positiveChanges++;
      else if (changePercent < -0.1) negativeChanges++;
      else neutralChanges++;
    }
    
    this.globalMarketStats = {
      totalVolume24h: this.sanitizeNumber(totalVolume24h),
      totalValue24h: this.sanitizeNumber(totalValue24h),
      activeSymbols: this.currentPrices.size,
      priceChangeDistribution: {
        positive: positiveChanges,
        negative: negativeChanges,
        neutral: neutralChanges
      },
      lastUpdate: Date.now()
    };
  }
  
  /**
   * Start secure candle generator
   */
  startSecureCandleGenerator() {
    this.config.candleIntervals.forEach(interval => {
      const intervalMs = this.parseIntervalToMs(interval);
      
      setInterval(() => {
        try {
          this.generateSecureCandles(interval);
        } catch (error) {
          this.handleSecurityViolation('candle_generator_error', error, { interval });
        }
      }, intervalMs);
    });
  }
  
  /**
   * Parse interval to milliseconds
   */
  parseIntervalToMs(interval) {
    const unit = interval.slice(-1);
    const value = parseInt(interval.slice(0, -1));
    
    if (isNaN(value) || value <= 0) return 60000; // Default 1 minute
    
    switch (unit) {
      case 'm': return Math.min(value * 60 * 1000, 60 * 60 * 1000); // Max 1 hour
      case 'h': return Math.min(value * 60 * 60 * 1000, 24 * 60 * 60 * 1000); // Max 24 hours
      case 'd': return Math.min(value * 24 * 60 * 60 * 1000, 7 * 24 * 60 * 60 * 1000); // Max 7 days
      default: return 60 * 1000;
    }
  }
  
  /**
   * Generate secure candles
   */
  generateSecureCandles(interval) {
    for (const symbol of this.currentPrices.cache.keys()) {
      this.generateSecureCandleForSymbol(symbol, interval);
    }
  }
  
  /**
   * Generate secure candle for symbol
   */
  generateSecureCandleForSymbol(symbol, interval) {
    const history = this.priceHistory.get(symbol);
    if (!history || history.length === 0) return;
    
    let symbolCandles = this.candleData.get(symbol);
    if (!symbolCandles) {
      symbolCandles = new Map();
      this.candleData.set(symbol, symbolCandles);
    }
    
    let candles = symbolCandles.get(interval);
    if (!candles) {
      candles = [];
      symbolCandles.set(interval, candles);
    }
    
    const intervalMs = this.parseIntervalToMs(interval);
    const now = Date.now();
    const periodStart = Math.floor(now / intervalMs) * intervalMs;
    
    // Get prices for this period
    const periodPrices = history.filter(h => 
      h.timestamp >= periodStart && h.timestamp < periodStart + intervalMs
    );
    
    if (periodPrices.length === 0) return;
    
    // Calculate OHLCV securely
    const prices = periodPrices.map(p => this.sanitizeNumber(p.price)).filter(p => p > 0);
    const volumes = periodPrices.map(p => this.sanitizeNumber(p.volume)).filter(v => v >= 0);
    
    if (prices.length === 0) return;
    
    const candle = {
      timestamp: periodStart,
      open: prices[0].toFixed(this.config.priceChangePrecision),
      high: Math.max(...prices).toFixed(this.config.priceChangePrecision),
      low: Math.min(...prices).toFixed(this.config.priceChangePrecision),
      close: prices[prices.length - 1].toFixed(this.config.priceChangePrecision),
      volume: volumes.reduce((sum, v) => sum + v, 0).toString(),
      trades: Math.max(0, periodPrices.length)
    };
    
    candles.push(candle);
    
    // Maintain bounded size
    if (candles.length > this.config.maxCandlesPerSymbol) {
      const removeCount = Math.floor(this.config.maxCandlesPerSymbol * 0.1);
      candles.splice(0, removeCount);
    }
    
    this.performanceStats.candlesGenerated++;
  }
  
  /**
   * Update running average
   */
  updateAverage(currentAvg, newValue, count) {
    return currentAvg + (newValue - currentAvg) / count;
  }
  
  /**
   * Remove subscription
   */
  removeSubscription(subscriptionKey) {
    const subscription = this.subscriptions.get(subscriptionKey);
    if (!subscription) return;
    
    this.subscriptions.delete(subscriptionKey);
    
    // Remove from symbol subscribers
    if (subscription.symbol) {
      const symbolSubs = this.symbolSubscribers.get(subscription.symbol);
      if (symbolSubs) {
        symbolSubs.delete(subscriptionKey);
        if (symbolSubs.size === 0) {
          this.symbolSubscribers.delete(subscription.symbol);
        }
      }
    }
    
    // Update user subscription count
    if (subscription.userId) {
      const currentCount = this.userSubscriptionCounts.get(subscription.userId) || 0;
      this.userSubscriptionCounts.set(subscription.userId, Math.max(0, currentCount - 1));
    }
    
    this.performanceStats.subscriptionsActive--;
  }
  
  /**
   * Handle unsubscription
   */
  handleUnsubscription(event) {
    const { connectionId, params } = event;
    
    if (event.channel === 'all_tickers') {
      this.allTickerSubscribers.delete(connectionId);
      this.performanceStats.subscriptionsActive--;
      return;
    }
    
    // Handle ticker unsubscription
    const { symbol } = params;
    if (!symbol) return;
    
    // Find matching subscription
    for (const [subscriptionKey, subscription] of this.subscriptions) {
      if (subscription.connectionId === connectionId && subscription.symbol === symbol) {
        this.removeSubscription(subscriptionKey);
        break;
      }
    }
  }
  
  /**
   * Handle disconnection
   */
  handleDisconnection(event) {
    const { connectionId } = event;
    
    // Remove all subscriptions for this connection
    const subscriptionsToRemove = [];
    for (const [subscriptionKey, subscription] of this.subscriptions) {
      if (subscription.connectionId === connectionId) {
        subscriptionsToRemove.push(subscriptionKey);
      }
    }
    
    subscriptionsToRemove.forEach(subscriptionKey => {
      this.removeSubscription(subscriptionKey);
    });
    
    // Remove from all tickers subscribers
    if (this.allTickerSubscribers.has(connectionId)) {
      this.allTickerSubscribers.delete(connectionId);
      this.performanceStats.subscriptionsActive--;
    }
  }
  
  /**
   * Start cleanup task
   */
  startCleanupTask() {
    setInterval(() => {
      this.cleanupOldData();
    }, 3600000); // Every hour
  }
  
  /**
   * Clean up old data
   */
  cleanupOldData() {
    const cutoff = Date.now() - this.config.historyRetention;
    
    // Clean price history
    for (const [symbol, history] of this.priceHistory.cache) {
      if (history) {
        const filteredHistory = history.filter(h => h.timestamp > cutoff);
        this.priceHistory.set(symbol, filteredHistory);
      }
    }
    
    // Clean candle data
    for (const [symbol, intervals] of this.candleData.cache) {
      if (intervals) {
        for (const [interval, candles] of intervals) {
          const filteredCandles = candles.filter(c => c.timestamp > cutoff);
          intervals.set(interval, filteredCandles);
        }
      }
    }
  }
  
  /**
   * Get comprehensive stats
   */
  getStats() {
    return {
      ...this.performanceStats,
      subscriptionsActive: this.subscriptions.size + this.allTickerSubscribers.size,
      symbolsTracked: this.currentPrices.size,
      globalMarketStats: this.globalMarketStats,
      circuitBreakerState: this.circuitBreaker.state,
      activeOperations: this.activeOperations.size
    };
  }
  
  /**
   * Shutdown with secure cleanup
   */
  shutdown() {
    // Clear all data structures
    this.currentPrices.clear();
    this.priceHistory.clear();
    this.candleData.clear();
    this.volumeData.clear();
    this.subscriptions.clear();
    this.symbolSubscribers.clear();
    this.allTickerSubscribers.clear();
    this.technicalIndicators.clear();
    this.marketStats.clear();
    this.userSubscriptionCounts.clear();
    this.activeOperations.clear();
    
    this.emit('shutdown');
  }
}

/**
 * LRU Cache implementation
 */
class LRUCache {
  constructor(maxSize = 1000) {
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
  
  has(key) {
    return this.cache.has(key);
  }
  
  get size() {
    return this.cache.size;
  }
  
  clear() {
    this.cache.clear();
  }
}

/**
 * Security Error class
 */
class SecurityError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SecurityError';
  }
}

module.exports = SecurePriceTickerFeed;