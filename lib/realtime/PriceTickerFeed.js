const EventEmitter = require('events');
const { getSecureMetricsCollector } = require('../monitoring/secure-metrics-collector');

/**
 * Price Ticker Streaming Service
 * Provides real-time price updates with OHLCV data, technical indicators, and market statistics
 */
class PriceTickerFeed extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      updateInterval: config.updateInterval || 1000,      // 1 second updates
      candleIntervals: config.candleIntervals || ['1m', '5m', '15m', '1h', '1d'],
      enableTechnicalIndicators: config.enableTechnicalIndicators !== false,
      enableMarketStats: config.enableMarketStats !== false,
      priceChangePrecision: config.priceChangePrecision || 8,
      historyRetention: config.historyRetention || 86400000, // 24 hours
      ...config
    };
    
    this.metrics = getSecureMetricsCollector();
    this.webSocketManager = null;
    
    // Price data management
    this.currentPrices = new Map(); // symbol -> current price data
    this.priceHistory = new Map();  // symbol -> price history
    this.candleData = new Map();    // symbol -> Map(interval -> candle data)
    this.volumeData = new Map();    // symbol -> volume statistics
    
    // Subscription management
    this.subscriptions = new Map(); // subscriptionKey -> subscription details
    this.symbolSubscribers = new Map(); // symbol -> Set of subscription keys
    this.allTickerSubscribers = new Set(); // connections subscribed to all tickers
    
    // Technical indicators
    this.technicalIndicators = new Map(); // symbol -> indicator data
    this.indicatorCalculators = {
      sma: this.calculateSMA.bind(this),
      ema: this.calculateEMA.bind(this),
      rsi: this.calculateRSI.bind(this),
      macd: this.calculateMACD.bind(this),
      bollinger: this.calculateBollingerBands.bind(this)
    };
    
    // Market statistics
    this.marketStats = new Map(); // symbol -> market statistics
    this.globalMarketStats = {
      totalVolume24h: 0,
      totalValue24h: 0,
      activeSymbols: 0,
      priceChangeDistribution: { positive: 0, negative: 0, neutral: 0 }
    };
    
    // Performance tracking
    this.performanceStats = {
      tickersProcessed: 0,
      tickersSent: 0,
      subscriptionsActive: 0,
      candlesGenerated: 0,
      indicatorsCalculated: 0,
      avgUpdateLatency: 0,
      bytesTransferred: 0
    };
    
    // Price change tracking
    this.priceChangeThresholds = {
      minor: 0.01,    // 1%
      moderate: 0.05, // 5%
      major: 0.10     // 10%
    };
    
    this.startTickerProcessor();
    this.startCandleGenerator();
    this.startCleanupTask();
  }
  
  /**
   * Initialize with WebSocket manager
   */
  initialize(webSocketManager) {
    this.webSocketManager = webSocketManager;
    
    // Listen for subscription events
    this.webSocketManager.on('subscribed', (event) => {
      if (event.channel === 'ticker') {
        this.handleTickerSubscription(event);
      } else if (event.channel === 'all_tickers') {
        this.handleAllTickersSubscription(event);
      }
    });
    
    this.webSocketManager.on('unsubscribed', (event) => {
      if (event.channel === 'ticker' || event.channel === 'all_tickers') {
        this.handleUnsubscription(event);
      }
    });
    
    this.webSocketManager.on('disconnection', (event) => {
      this.handleDisconnection(event);
    });
  }
  
  /**
   * Update price data
   */
  updatePrice(symbol, priceData) {
    const startTime = Date.now();
    
    const normalizedData = this.normalizePriceData(symbol, priceData);
    const previousPrice = this.currentPrices.get(symbol);
    
    // Update current price
    this.currentPrices.set(symbol, normalizedData);
    
    // Add to price history
    this.addToPriceHistory(symbol, normalizedData);
    
    // Update volume data
    this.updateVolumeData(symbol, normalizedData);
    
    // Calculate technical indicators if enabled
    if (this.config.enableTechnicalIndicators) {
      this.updateTechnicalIndicators(symbol);
    }
    
    // Update market statistics if enabled
    if (this.config.enableMarketStats) {
      this.updateMarketStats(symbol, normalizedData, previousPrice);
    }
    
    // Queue for broadcast
    this.queueTickerUpdate(symbol, normalizedData, previousPrice);
    
    this.performanceStats.tickersProcessed++;
    this.performanceStats.avgUpdateLatency = this.updateAverage(
      this.performanceStats.avgUpdateLatency,
      Date.now() - startTime,
      this.performanceStats.tickersProcessed
    );
    
    this.emit('price_updated', { symbol, data: normalizedData, previous: previousPrice });
  }
  
  /**
   * Normalize price data
   */
  normalizePriceData(symbol, priceData) {
    const timestamp = priceData.timestamp || Date.now();
    const price = parseFloat(priceData.price).toFixed(this.config.priceChangePrecision);
    const volume = parseFloat(priceData.volume || 0);
    
    return {
      symbol: symbol,
      price: price,
      volume: volume.toString(),
      timestamp: timestamp,
      source: priceData.source || 'internal',
      metadata: priceData.metadata || {}
    };
  }
  
  /**
   * Add to price history
   */
  addToPriceHistory(symbol, priceData) {
    if (!this.priceHistory.has(symbol)) {
      this.priceHistory.set(symbol, []);
    }
    
    const history = this.priceHistory.get(symbol);
    history.push({
      price: priceData.price,
      volume: priceData.volume,
      timestamp: priceData.timestamp
    });
    
    // Maintain history size (keep last 10000 data points)
    if (history.length > 10000) {
      history.splice(0, history.length - 10000);
    }
  }
  
  /**
   * Update volume data
   */
  updateVolumeData(symbol, priceData) {
    if (!this.volumeData.has(symbol)) {
      this.volumeData.set(symbol, {
        volume24h: 0,
        volumeChange24h: 0,
        trades24h: 0,
        lastReset: Date.now()
      });
    }
    
    const volumeStats = this.volumeData.get(symbol);
    const volume = parseFloat(priceData.volume);
    
    // Reset daily stats if needed
    const now = Date.now();
    if (now - volumeStats.lastReset > 86400000) { // 24 hours
      volumeStats.volume24h = 0;
      volumeStats.trades24h = 0;
      volumeStats.lastReset = now;
    }
    
    volumeStats.volume24h += volume;
    volumeStats.trades24h++;
  }
  
  /**
   * Update technical indicators
   */
  updateTechnicalIndicators(symbol) {
    const history = this.priceHistory.get(symbol);
    if (!history || history.length < 20) return; // Need minimum data points
    
    if (!this.technicalIndicators.has(symbol)) {
      this.technicalIndicators.set(symbol, {});
    }
    
    const indicators = this.technicalIndicators.get(symbol);
    const prices = history.slice(-100).map(h => parseFloat(h.price)); // Last 100 prices
    
    // Calculate various indicators
    indicators.sma20 = this.calculateSMA(prices, 20);
    indicators.sma50 = this.calculateSMA(prices, 50);
    indicators.ema20 = this.calculateEMA(prices, 20);
    indicators.rsi14 = this.calculateRSI(prices, 14);
    indicators.macd = this.calculateMACD(prices);
    indicators.bollinger = this.calculateBollingerBands(prices, 20, 2);
    
    this.performanceStats.indicatorsCalculated++;
  }
  
  /**
   * Update market statistics
   */
  updateMarketStats(symbol, newData, previousData) {
    if (!this.marketStats.has(symbol)) {
      this.marketStats.set(symbol, {
        high24h: newData.price,
        low24h: newData.price,
        open24h: newData.price,
        close24h: newData.price,
        priceChange24h: 0,
        priceChangePercent24h: 0,
        lastUpdate: Date.now(),
        resetTime: Date.now() + 86400000 // 24 hours from now
      });
    }
    
    const stats = this.marketStats.get(symbol);
    const price = parseFloat(newData.price);
    const now = Date.now();
    
    // Reset daily stats if needed
    if (now > stats.resetTime) {
      stats.open24h = newData.price;
      stats.high24h = newData.price;
      stats.low24h = newData.price;
      stats.resetTime = now + 86400000;
    }
    
    // Update high/low
    if (price > parseFloat(stats.high24h)) {
      stats.high24h = newData.price;
    }
    if (price < parseFloat(stats.low24h)) {
      stats.low24h = newData.price;
    }
    
    // Update price change
    stats.close24h = newData.price;
    const openPrice = parseFloat(stats.open24h);
    stats.priceChange24h = price - openPrice;
    stats.priceChangePercent24h = openPrice > 0 ? (stats.priceChange24h / openPrice) * 100 : 0;
    stats.lastUpdate = now;
  }
  
  /**
   * Queue ticker update for broadcast
   */
  queueTickerUpdate(symbol, newData, previousData) {
    // Calculate price change
    let priceChange = 0;
    let priceChangePercent = 0;
    
    if (previousData) {
      const oldPrice = parseFloat(previousData.price);
      const newPrice = parseFloat(newData.price);
      priceChange = newPrice - oldPrice;
      priceChangePercent = oldPrice > 0 ? (priceChange / oldPrice) * 100 : 0;
    }
    
    // Create ticker message
    const tickerData = this.createTickerMessage(symbol, newData, priceChange, priceChangePercent);
    
    // Broadcast to symbol subscribers
    this.broadcastToSymbolSubscribers(symbol, tickerData);
    
    // Broadcast to all ticker subscribers
    this.broadcastToAllTickerSubscribers(tickerData);
  }
  
  /**
   * Create ticker message
   */
  createTickerMessage(symbol, priceData, priceChange, priceChangePercent) {
    const marketStats = this.marketStats.get(symbol);
    const volumeStats = this.volumeData.get(symbol);
    const indicators = this.technicalIndicators.get(symbol);
    
    const tickerData = {
      symbol: symbol,
      price: priceData.price,
      priceChange: priceChange.toFixed(this.config.priceChangePrecision),
      priceChangePercent: priceChangePercent.toFixed(2),
      timestamp: priceData.timestamp
    };
    
    // Add market stats if available
    if (marketStats) {
      tickerData.high24h = marketStats.high24h;
      tickerData.low24h = marketStats.low24h;
      tickerData.open24h = marketStats.open24h;
    }
    
    // Add volume stats if available
    if (volumeStats) {
      tickerData.volume24h = volumeStats.volume24h.toString();
      tickerData.trades24h = volumeStats.trades24h;
    }
    
    // Add technical indicators if available and enabled
    if (this.config.enableTechnicalIndicators && indicators) {
      tickerData.indicators = {
        sma20: indicators.sma20,
        rsi14: indicators.rsi14,
        trend: this.determineTrend(indicators)
      };
    }
    
    return tickerData;
  }
  
  /**
   * Determine price trend from indicators
   */
  determineTrend(indicators) {
    if (!indicators.sma20 || !indicators.sma50) return 'neutral';
    
    const price = parseFloat(indicators.sma20);
    const sma50 = parseFloat(indicators.sma50);
    
    if (price > sma50 * 1.02) return 'bullish';
    if (price < sma50 * 0.98) return 'bearish';
    return 'neutral';
  }
  
  /**
   * Broadcast to symbol subscribers
   */
  broadcastToSymbolSubscribers(symbol, tickerData) {
    const subscribers = this.symbolSubscribers.get(symbol);
    if (!subscribers || subscribers.size === 0) return;
    
    for (const subscriptionKey of subscribers) {
      const subscription = this.subscriptions.get(subscriptionKey);
      if (!subscription) continue;
      
      const message = {
        type: 'ticker_update',
        data: this.filterTickerDataForSubscription(tickerData, subscription)
      };
      
      this.webSocketManager.sendToConnection(subscription.connectionId, message);
    }
    
    this.performanceStats.tickersSent++;
  }
  
  /**
   * Broadcast to all ticker subscribers
   */
  broadcastToAllTickerSubscribers(tickerData) {
    if (this.allTickerSubscribers.size === 0) return;
    
    for (const connectionId of this.allTickerSubscribers) {
      const message = {
        type: 'all_tickers_update',
        data: [tickerData] // Array format for consistency
      };
      
      this.webSocketManager.sendToConnection(connectionId, message);
    }
  }
  
  /**
   * Filter ticker data based on subscription preferences
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
   * Handle ticker subscription
   */
  handleTickerSubscription(event) {
    const { connectionId, params } = event;
    const { 
      symbol,
      includeIndicators = this.config.enableTechnicalIndicators,
      includeVolume = true,
      includeMarketStats = this.config.enableMarketStats
    } = params;
    
    if (!symbol) {
      this.webSocketManager.sendToConnection(connectionId, {
        type: 'subscription_error',
        code: 'MISSING_SYMBOL',
        message: 'Symbol parameter required for ticker subscription'
      });
      return;
    }
    
    const subscriptionKey = `ticker:${connectionId}:${symbol}`;
    
    // Store subscription
    this.subscriptions.set(subscriptionKey, {
      connectionId: connectionId,
      channel: 'ticker',
      symbol: symbol,
      includeIndicators: includeIndicators,
      includeVolume: includeVolume,
      includeMarketStats: includeMarketStats,
      subscribedAt: Date.now()
    });
    
    // Track symbol subscribers
    if (!this.symbolSubscribers.has(symbol)) {
      this.symbolSubscribers.set(symbol, new Set());
    }
    this.symbolSubscribers.get(symbol).add(subscriptionKey);
    
    this.performanceStats.subscriptionsActive++;
    
    // Send current ticker data
    this.sendCurrentTicker(subscriptionKey);
    
    this.emit('ticker_subscription_added', { subscriptionKey, symbol, connectionId });
  }
  
  /**
   * Handle all tickers subscription
   */
  handleAllTickersSubscription(event) {
    const { connectionId } = event;
    
    this.allTickerSubscribers.add(connectionId);
    this.performanceStats.subscriptionsActive++;
    
    // Send current all tickers data
    this.sendAllTickers(connectionId);
    
    this.emit('all_tickers_subscription_added', { connectionId });
  }
  
  /**
   * Send current ticker data
   */
  sendCurrentTicker(subscriptionKey) {
    const subscription = this.subscriptions.get(subscriptionKey);
    if (!subscription) return;
    
    const currentPrice = this.currentPrices.get(subscription.symbol);
    if (!currentPrice) return;
    
    const tickerData = this.createTickerMessage(subscription.symbol, currentPrice, 0, 0);
    
    const message = {
      type: 'ticker_snapshot',
      data: this.filterTickerDataForSubscription(tickerData, subscription)
    };
    
    this.webSocketManager.sendToConnection(subscription.connectionId, message);
  }
  
  /**
   * Send all tickers data
   */
  sendAllTickers(connectionId) {
    const allTickers = [];
    
    for (const [symbol, priceData] of this.currentPrices) {
      const tickerData = this.createTickerMessage(symbol, priceData, 0, 0);
      allTickers.push(tickerData);
    }
    
    const message = {
      type: 'all_tickers_snapshot',
      data: allTickers,
      timestamp: Date.now()
    };
    
    this.webSocketManager.sendToConnection(connectionId, message);
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
    
    const subscriptionKey = `ticker:${connectionId}:${symbol}`;
    this.removeSubscription(subscriptionKey);
  }
  
  /**
   * Remove subscription
   */
  removeSubscription(subscriptionKey) {
    const subscription = this.subscriptions.get(subscriptionKey);
    if (!subscription) return;
    
    this.subscriptions.delete(subscriptionKey);
    
    // Remove from symbol subscribers
    const symbolSubs = this.symbolSubscribers.get(subscription.symbol);
    if (symbolSubs) {
      symbolSubs.delete(subscriptionKey);
      if (symbolSubs.size === 0) {
        this.symbolSubscribers.delete(subscription.symbol);
      }
    }
    
    this.performanceStats.subscriptionsActive--;
    
    this.emit('subscription_removed', { subscriptionKey, subscription });
  }
  
  /**
   * Handle connection disconnection
   */
  handleDisconnection(event) {
    const { connectionId } = event;
    
    // Remove all ticker subscriptions
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
   * Start ticker processor
   */
  startTickerProcessor() {
    setInterval(() => {
      this.updateGlobalMarketStats();
    }, this.config.updateInterval);
  }
  
  /**
   * Update global market statistics
   */
  updateGlobalMarketStats() {
    let totalVolume24h = 0;
    let totalValue24h = 0;
    let positiveChanges = 0;
    let negativeChanges = 0;
    let neutralChanges = 0;
    
    for (const [symbol, stats] of this.marketStats) {
      const volumeStats = this.volumeData.get(symbol);
      if (volumeStats) {
        totalVolume24h += volumeStats.volume24h;
        totalValue24h += volumeStats.volume24h * parseFloat(this.currentPrices.get(symbol)?.price || 0);
      }
      
      if (stats.priceChangePercent24h > 0.1) positiveChanges++;
      else if (stats.priceChangePercent24h < -0.1) negativeChanges++;
      else neutralChanges++;
    }
    
    this.globalMarketStats = {
      totalVolume24h: totalVolume24h,
      totalValue24h: totalValue24h,
      activeSymbols: this.currentPrices.size,
      priceChangeDistribution: {
        positive: positiveChanges,
        negative: negativeChanges,
        neutral: neutralChanges
      }
    };
  }
  
  /**
   * Start candle generator
   */
  startCandleGenerator() {
    // Generate candles for different intervals
    this.config.candleIntervals.forEach(interval => {
      const intervalMs = this.parseIntervalToMs(interval);
      
      setInterval(() => {
        this.generateCandles(interval);
      }, intervalMs);
    });
  }
  
  /**
   * Parse interval string to milliseconds
   */
  parseIntervalToMs(interval) {
    const unit = interval.slice(-1);
    const value = parseInt(interval.slice(0, -1));
    
    switch (unit) {
      case 'm': return value * 60 * 1000;
      case 'h': return value * 60 * 60 * 1000;
      case 'd': return value * 24 * 60 * 60 * 1000;
      default: return 60 * 1000; // Default to 1 minute
    }
  }
  
  /**
   * Generate candles for interval
   */
  generateCandles(interval) {
    for (const symbol of this.currentPrices.keys()) {
      this.generateCandleForSymbol(symbol, interval);
    }
  }
  
  /**
   * Generate candle for specific symbol and interval
   */
  generateCandleForSymbol(symbol, interval) {
    const history = this.priceHistory.get(symbol);
    if (!history || history.length === 0) return;
    
    if (!this.candleData.has(symbol)) {
      this.candleData.set(symbol, new Map());
    }
    
    const symbolCandles = this.candleData.get(symbol);
    if (!symbolCandles.has(interval)) {
      symbolCandles.set(interval, []);
    }
    
    const candles = symbolCandles.get(interval);
    const intervalMs = this.parseIntervalToMs(interval);
    const now = Date.now();
    const periodStart = Math.floor(now / intervalMs) * intervalMs;
    
    // Get prices for this period
    const periodPrices = history.filter(h => 
      h.timestamp >= periodStart && h.timestamp < periodStart + intervalMs
    );
    
    if (periodPrices.length === 0) return;
    
    // Calculate OHLCV
    const prices = periodPrices.map(p => parseFloat(p.price));
    const volumes = periodPrices.map(p => parseFloat(p.volume));
    
    const candle = {
      timestamp: periodStart,
      open: prices[0].toString(),
      high: Math.max(...prices).toString(),
      low: Math.min(...prices).toString(),
      close: prices[prices.length - 1].toString(),
      volume: volumes.reduce((sum, v) => sum + v, 0).toString(),
      trades: periodPrices.length
    };
    
    // Add to candles array
    candles.push(candle);
    
    // Maintain candle history (keep last 1000 candles)
    if (candles.length > 1000) {
      candles.splice(0, candles.length - 1000);
    }
    
    this.performanceStats.candlesGenerated++;
  }
  
  /**
   * Technical indicator calculations
   */
  calculateSMA(prices, period) {
    if (prices.length < period) return null;
    
    const sum = prices.slice(-period).reduce((a, b) => a + b, 0);
    return (sum / period).toFixed(this.config.priceChangePrecision);
  }
  
  calculateEMA(prices, period) {
    if (prices.length < period) return null;
    
    const multiplier = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
    
    for (let i = period; i < prices.length; i++) {
      ema = (prices[i] - ema) * multiplier + ema;
    }
    
    return ema.toFixed(this.config.priceChangePrecision);
  }
  
  calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return null;
    
    const gains = [];
    const losses = [];
    
    for (let i = 1; i < prices.length; i++) {
      const change = prices[i] - prices[i - 1];
      gains.push(change > 0 ? change : 0);
      losses.push(change < 0 ? Math.abs(change) : 0);
    }
    
    if (gains.length < period) return null;
    
    const avgGain = gains.slice(-period).reduce((a, b) => a + b, 0) / period;
    const avgLoss = losses.slice(-period).reduce((a, b) => a + b, 0) / period;
    
    if (avgLoss === 0) return 100;
    
    const rs = avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));
    
    return rsi.toFixed(2);
  }
  
  calculateMACD(prices, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
    const fastEMA = this.calculateEMA(prices, fastPeriod);
    const slowEMA = this.calculateEMA(prices, slowPeriod);
    
    if (!fastEMA || !slowEMA) return null;
    
    const macdLine = parseFloat(fastEMA) - parseFloat(slowEMA);
    
    return {
      macd: macdLine.toFixed(this.config.priceChangePrecision),
      signal: null, // Would need MACD history to calculate signal line
      histogram: null
    };
  }
  
  calculateBollingerBands(prices, period = 20, multiplier = 2) {
    const sma = this.calculateSMA(prices, period);
    if (!sma) return null;
    
    const recentPrices = prices.slice(-period);
    const variance = recentPrices.reduce((sum, price) => {
      return sum + Math.pow(price - parseFloat(sma), 2);
    }, 0) / period;
    
    const stdDev = Math.sqrt(variance);
    const smaFloat = parseFloat(sma);
    
    return {
      upper: (smaFloat + stdDev * multiplier).toFixed(this.config.priceChangePrecision),
      middle: sma,
      lower: (smaFloat - stdDev * multiplier).toFixed(this.config.priceChangePrecision)
    };
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
    for (const [symbol, history] of this.priceHistory) {
      const filteredHistory = history.filter(h => h.timestamp > cutoff);
      this.priceHistory.set(symbol, filteredHistory);
    }
    
    // Clean candle data
    for (const [symbol, intervals] of this.candleData) {
      for (const [interval, candles] of intervals) {
        const filteredCandles = candles.filter(c => c.timestamp > cutoff);
        intervals.set(interval, filteredCandles);
      }
    }
  }
  
  /**
   * Update running average
   */
  updateAverage(currentAvg, newValue, count) {
    return currentAvg + (newValue - currentAvg) / count;
  }
  
  /**
   * Get statistics
   */
  getStats() {
    return {
      ...this.performanceStats,
      subscriptionsActive: this.subscriptions.size + this.allTickerSubscribers.size,
      symbolsTracked: this.currentPrices.size,
      globalMarketStats: this.globalMarketStats
    };
  }
  
  /**
   * Get current ticker data
   */
  getCurrentTicker(symbol) {
    const priceData = this.currentPrices.get(symbol);
    if (!priceData) return null;
    
    return this.createTickerMessage(symbol, priceData, 0, 0);
  }
  
  /**
   * Get candle data
   */
  getCandleData(symbol, interval) {
    const symbolCandles = this.candleData.get(symbol);
    if (!symbolCandles) return [];
    
    return symbolCandles.get(interval) || [];
  }
  
  /**
   * Shutdown ticker feed
   */
  shutdown() {
    this.currentPrices.clear();
    this.priceHistory.clear();
    this.candleData.clear();
    this.volumeData.clear();
    this.subscriptions.clear();
    this.symbolSubscribers.clear();
    this.allTickerSubscribers.clear();
    this.technicalIndicators.clear();
    this.marketStats.clear();
    
    this.emit('shutdown');
  }
}

module.exports = PriceTickerFeed;