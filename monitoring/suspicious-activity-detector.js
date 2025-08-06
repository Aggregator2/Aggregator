const { getMetricsCollector } = require('./metrics-collector');
const EventEmitter = require('events');

class SuspiciousActivityDetector extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      alertThreshold: config.alertThreshold || 0.8, // Confidence threshold for alerts
      windowSize: config.windowSize || 300000, // 5 minute window
      maxAlertsPerHour: config.maxAlertsPerHour || 100, // Rate limiting
      ...config
    };
    
    this.metrics = getMetricsCollector();
    this.isDetecting = false;
    
    // Pattern detection
    this.patterns = {
      washTrading: new WashTradingDetector(),
      layering: new LayeringDetector(),
      spoofing: new SpoofingDetector(),
      frontRunning: new FrontRunningDetector(),
      marketManipulation: new MarketManipulationDetector(),
      unusualVolume: new UnusualVolumeDetector(),
      rapidOrderCancellation: new RapidCancellationDetector(),
      priceManipulation: new PriceManipulationDetector()
    };
    
    // Activity tracking
    this.userActivity = new Map(); // userId -> activity history
    this.ipActivity = new Map(); // IP -> activity history
    this.alerts = [];
    this.alertCounts = new Map(); // Type -> count (for rate limiting)
    
    // Machine learning models placeholder
    this.anomalyModels = {};
    
    // Blacklists and whitelists
    this.blacklist = new Set();
    this.whitelist = new Set();
  }

  async start(matchingEngine, orderBook) {
    if (this.isDetecting) return;
    
    console.log('🔍 Starting suspicious activity detection...');
    this.isDetecting = true;
    
    this.engine = matchingEngine;
    this.orderBook = orderBook;
    
    // Hook into events
    this.setupEventListeners();
    
    // Start periodic analysis
    this.startPeriodicAnalysis();
    
    // Load historical patterns
    await this.loadHistoricalPatterns();
    
    console.log('✅ Suspicious activity detection started');
  }

  setupEventListeners() {
    // Monitor order submissions
    this.engine.on('order:submitted', (order) => {
      this.trackActivity('order_submitted', order);
      this.analyzeOrderSubmission(order);
    });
    
    // Monitor order cancellations
    this.engine.on('order:cancelled', (order) => {
      this.trackActivity('order_cancelled', order);
      this.analyzeOrderCancellation(order);
    });
    
    // Monitor trades
    this.engine.on('order:matched', (match) => {
      this.trackActivity('order_matched', match);
      this.analyzeTradeExecution(match);
    });
    
    // Monitor order modifications
    this.engine.on('order:modified', (order) => {
      this.trackActivity('order_modified', order);
      this.analyzeOrderModification(order);
    });
  }

  trackActivity(type, data) {
    const userId = data.userId || data.makerUserId || 'unknown';
    const ip = data.ip || data.makerIp || 'unknown';
    const timestamp = Date.now();
    
    // Track by user
    if (!this.userActivity.has(userId)) {
      this.userActivity.set(userId, []);
    }
    const userHistory = this.userActivity.get(userId);
    userHistory.push({ type, data, timestamp });
    
    // Maintain window size
    const cutoff = timestamp - this.config.windowSize;
    const recentHistory = userHistory.filter(h => h.timestamp > cutoff);
    this.userActivity.set(userId, recentHistory);
    
    // Track by IP
    if (!this.ipActivity.has(ip)) {
      this.ipActivity.set(ip, []);
    }
    const ipHistory = this.ipActivity.get(ip);
    ipHistory.push({ type, data, timestamp });
    
    // Maintain window size for IP
    const recentIpHistory = ipHistory.filter(h => h.timestamp > cutoff);
    this.ipActivity.set(ip, recentIpHistory);
  }

  async analyzeOrderSubmission(order) {
    const suspiciousPatterns = [];
    
    // Check each pattern detector
    for (const [patternName, detector] of Object.entries(this.patterns)) {
      const result = await detector.analyzeOrder(order, this.userActivity.get(order.userId));
      
      if (result.suspicious) {
        suspiciousPatterns.push({
          pattern: patternName,
          confidence: result.confidence,
          details: result.details
        });
      }
    }
    
    // Check against ML models
    const anomalyScore = await this.checkAnomaly(order);
    if (anomalyScore > this.config.alertThreshold) {
      suspiciousPatterns.push({
        pattern: 'anomaly',
        confidence: anomalyScore,
        details: 'Order deviates from normal patterns'
      });
    }
    
    // Generate alert if suspicious
    if (suspiciousPatterns.length > 0) {
      await this.generateAlert('suspicious_order', order, suspiciousPatterns);
    }
  }

  async analyzeOrderCancellation(order) {
    const userId = order.userId;
    const userHistory = this.userActivity.get(userId) || [];
    
    // Check for rapid cancellation pattern
    const result = await this.patterns.rapidOrderCancellation.analyze(order, userHistory);
    
    if (result.suspicious) {
      await this.generateAlert('rapid_cancellation', order, [result]);
    }
  }

  async analyzeTradeExecution(match) {
    // Check for wash trading
    const washResult = await this.patterns.washTrading.analyzeTrade(match);
    
    if (washResult.suspicious) {
      await this.generateAlert('wash_trading', match, [washResult]);
    }
    
    // Check for front-running
    const frontRunResult = await this.patterns.frontRunning.analyzeTrade(match, this.orderBook);
    
    if (frontRunResult.suspicious) {
      await this.generateAlert('front_running', match, [frontRunResult]);
    }
  }

  async analyzeOrderModification(order) {
    const userHistory = this.userActivity.get(order.userId) || [];
    
    // Check for layering/spoofing through modifications
    const layeringResult = await this.patterns.layering.analyzeModification(order, userHistory);
    
    if (layeringResult.suspicious) {
      await this.generateAlert('layering', order, [layeringResult]);
    }
  }

  startPeriodicAnalysis() {
    // Analyze patterns every minute
    this.analysisInterval = setInterval(async () => {
      await this.performPeriodicAnalysis();
    }, 60000);
    
    // Clean up old data every hour
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldData();
    }, 3600000);
  }

  async performPeriodicAnalysis() {
    // Analyze market-wide patterns
    const marketPatterns = await this.analyzeMarketPatterns();
    
    // Check for coordinated activities
    const coordinatedActivities = await this.detectCoordinatedActivity();
    
    // Update metrics
    await this.updateDetectionMetrics();
  }

  async analyzeMarketPatterns() {
    const patterns = [];
    
    // Check for unusual volume spikes
    const volumeResult = await this.patterns.unusualVolume.analyzeMarket(this.orderBook);
    if (volumeResult.suspicious) {
      patterns.push(volumeResult);
    }
    
    // Check for price manipulation
    const priceResult = await this.patterns.priceManipulation.analyzeMarket(this.orderBook);
    if (priceResult.suspicious) {
      patterns.push(priceResult);
    }
    
    // Check for market manipulation
    const manipulationResult = await this.patterns.marketManipulation.analyzeMarket(this.orderBook);
    if (manipulationResult.suspicious) {
      patterns.push(manipulationResult);
    }
    
    return patterns;
  }

  async detectCoordinatedActivity() {
    const coordinated = [];
    
    // Look for similar patterns across multiple users
    const userPatterns = new Map();
    
    for (const [userId, history] of this.userActivity) {
      const pattern = this.extractActivityPattern(history);
      
      // Group users with similar patterns
      const patternKey = JSON.stringify(pattern);
      if (!userPatterns.has(patternKey)) {
        userPatterns.set(patternKey, []);
      }
      userPatterns.get(patternKey).push(userId);
    }
    
    // Flag groups with suspicious coordination
    for (const [pattern, users] of userPatterns) {
      if (users.length > 2) { // More than 2 users with same pattern
        coordinated.push({
          pattern: 'coordinated_activity',
          users,
          confidence: Math.min(0.5 + (users.length * 0.1), 0.95),
          details: `${users.length} users showing identical trading patterns`
        });
      }
    }
    
    return coordinated;
  }

  extractActivityPattern(history) {
    // Extract pattern features
    const pattern = {
      orderRate: history.filter(h => h.type === 'order_submitted').length,
      cancelRate: history.filter(h => h.type === 'order_cancelled').length,
      modifyRate: history.filter(h => h.type === 'order_modified').length,
      avgOrderSize: this.calculateAvgOrderSize(history),
      timeDistribution: this.calculateTimeDistribution(history)
    };
    
    return pattern;
  }

  calculateAvgOrderSize(history) {
    const orders = history.filter(h => h.type === 'order_submitted');
    if (orders.length === 0) return 0;
    
    const totalSize = orders.reduce((sum, h) => sum + (h.data.volume || 0), 0);
    return totalSize / orders.length;
  }

  calculateTimeDistribution(history) {
    if (history.length < 2) return 'uniform';
    
    const intervals = [];
    for (let i = 1; i < history.length; i++) {
      intervals.push(history[i].timestamp - history[i-1].timestamp);
    }
    
    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const variance = intervals.reduce((sum, i) => sum + Math.pow(i - avgInterval, 2), 0) / intervals.length;
    const stdDev = Math.sqrt(variance);
    
    // Classify distribution
    if (stdDev < avgInterval * 0.1) return 'regular'; // Very consistent timing
    if (stdDev > avgInterval * 0.5) return 'irregular'; // High variance
    return 'normal';
  }

  async checkAnomaly(order) {
    // Placeholder for ML-based anomaly detection
    // In production, this would use trained models
    
    // Simple heuristic-based anomaly score
    let score = 0;
    const userHistory = this.userActivity.get(order.userId) || [];
    
    // Check order size anomaly
    const avgSize = this.calculateAvgOrderSize(userHistory);
    if (avgSize > 0 && order.volume > avgSize * 10) {
      score += 0.3;
    }
    
    // Check timing anomaly
    const recentOrders = userHistory.filter(h => 
      h.type === 'order_submitted' && 
      h.timestamp > Date.now() - 60000
    );
    if (recentOrders.length > 20) { // More than 20 orders per minute
      score += 0.4;
    }
    
    // Check price deviation
    const marketPrice = this.orderBook.getMidPrice(order.pair);
    const priceDeviation = Math.abs(order.price - marketPrice) / marketPrice;
    if (priceDeviation > 0.05) { // 5% deviation
      score += 0.3;
    }
    
    return Math.min(score, 1);
  }

  async generateAlert(type, data, patterns) {
    // Rate limiting
    const hourAgo = Date.now() - 3600000;
    const recentAlerts = this.alertCounts.get(type) || 0;
    
    if (recentAlerts >= this.config.maxAlertsPerHour) {
      console.warn(`Rate limit exceeded for ${type} alerts`);
      return;
    }
    
    // Check if user is whitelisted
    const userId = data.userId || data.makerUserId;
    if (this.whitelist.has(userId)) {
      return;
    }
    
    // Calculate overall confidence
    const maxConfidence = Math.max(...patterns.map(p => p.confidence));
    
    // Create alert
    const alert = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type,
      severity: this.calculateSeverity(type, maxConfidence),
      confidence: maxConfidence,
      timestamp: Date.now(),
      userId,
      data,
      patterns,
      status: 'new'
    };
    
    // Store alert
    this.alerts.push(alert);
    if (this.alerts.length > 10000) {
      this.alerts.shift(); // Maintain size limit
    }
    
    // Update metrics
    await this.metrics.incrementCounter('suspicious_activity.alerts', 1, {
      type,
      severity: alert.severity
    });
    
    // Update rate limiting
    this.alertCounts.set(type, recentAlerts + 1);
    
    // Emit alert
    this.emit('alert', alert);
    
    // Auto-ban for high severity
    if (alert.severity === 'critical' && maxConfidence > 0.95) {
      await this.banUser(userId, `Automatic ban: ${type}`);
    }
  }

  calculateSeverity(type, confidence) {
    const severityMap = {
      wash_trading: 'high',
      front_running: 'critical',
      layering: 'high',
      spoofing: 'high',
      market_manipulation: 'critical',
      rapid_cancellation: 'medium',
      suspicious_order: 'low',
      coordinated_activity: 'high'
    };
    
    const baseSeverity = severityMap[type] || 'low';
    
    // Upgrade severity based on confidence
    if (confidence > 0.9 && baseSeverity === 'high') {
      return 'critical';
    }
    if (confidence > 0.9 && baseSeverity === 'medium') {
      return 'high';
    }
    if (confidence > 0.9 && baseSeverity === 'low') {
      return 'medium';
    }
    
    return baseSeverity;
  }

  async banUser(userId, reason) {
    this.blacklist.add(userId);
    
    await this.metrics.incrementCounter('suspicious_activity.bans', 1);
    
    this.emit('user_banned', {
      userId,
      reason,
      timestamp: Date.now()
    });
    
    console.log(`User ${userId} banned: ${reason}`);
  }

  async updateDetectionMetrics() {
    // Calculate detection statistics
    const stats = {
      totalAlerts: this.alerts.length,
      alertsByType: {},
      alertsBySeverity: {},
      detectionRate: 0
    };
    
    // Count by type and severity
    for (const alert of this.alerts) {
      stats.alertsByType[alert.type] = (stats.alertsByType[alert.type] || 0) + 1;
      stats.alertsBySeverity[alert.severity] = (stats.alertsBySeverity[alert.severity] || 0) + 1;
    }
    
    // Update metrics
    await this.metrics.setGauge('suspicious_activity.total_alerts', stats.totalAlerts);
    
    for (const [type, count] of Object.entries(stats.alertsByType)) {
      await this.metrics.setGauge(`suspicious_activity.alerts_by_type.${type}`, count);
    }
    
    for (const [severity, count] of Object.entries(stats.alertsBySeverity)) {
      await this.metrics.setGauge(`suspicious_activity.alerts_by_severity.${severity}`, count);
    }
  }

  cleanupOldData() {
    const cutoff = Date.now() - 86400000; // 24 hours
    
    // Clean user activity
    for (const [userId, history] of this.userActivity) {
      const recentHistory = history.filter(h => h.timestamp > cutoff);
      if (recentHistory.length === 0) {
        this.userActivity.delete(userId);
      } else {
        this.userActivity.set(userId, recentHistory);
      }
    }
    
    // Clean IP activity
    for (const [ip, history] of this.ipActivity) {
      const recentHistory = history.filter(h => h.timestamp > cutoff);
      if (recentHistory.length === 0) {
        this.ipActivity.delete(ip);
      } else {
        this.ipActivity.set(ip, recentHistory);
      }
    }
    
    // Clean old alerts
    this.alerts = this.alerts.filter(a => a.timestamp > cutoff);
    
    // Reset rate limiting counts
    this.alertCounts.clear();
  }

  async loadHistoricalPatterns() {
    // Load known patterns and blacklists
    // This would typically load from a database
    console.log('Loading historical suspicious patterns...');
  }

  getRecentAlerts(limit = 100) {
    return this.alerts
      .slice(-limit)
      .reverse()
      .map(a => ({
        id: a.id,
        type: a.type,
        severity: a.severity,
        confidence: a.confidence,
        timestamp: a.timestamp,
        userId: a.userId,
        patterns: a.patterns.map(p => ({
          pattern: p.pattern,
          confidence: p.confidence,
          details: p.details
        }))
      }));
  }

  isUserBanned(userId) {
    return this.blacklist.has(userId);
  }

  stop() {
    if (!this.isDetecting) return;
    
    console.log('🛑 Stopping suspicious activity detection...');
    
    clearInterval(this.analysisInterval);
    clearInterval(this.cleanupInterval);
    
    this.isDetecting = false;
    
    console.log('✅ Suspicious activity detection stopped');
  }
}

// Pattern Detectors
class WashTradingDetector {
  async analyzeTrade(match) {
    // Check if buyer and seller are related
    const suspicious = match.makerUserId === match.takerUserId ||
                      match.makerIp === match.takerIp;
    
    return {
      suspicious,
      confidence: suspicious ? 0.95 : 0,
      details: suspicious ? 'Same user/IP on both sides of trade' : null
    };
  }
}

class LayeringDetector {
  async analyzeOrder(order, userHistory) {
    if (!userHistory) return { suspicious: false };
    
    // Look for multiple orders at different price levels
    const recentOrders = userHistory
      .filter(h => h.type === 'order_submitted' && h.timestamp > Date.now() - 60000)
      .map(h => h.data);
    
    if (recentOrders.length < 5) return { suspicious: false };
    
    // Check for layering pattern
    const sameSide = recentOrders.filter(o => o.side === order.side);
    const differentPrices = new Set(sameSide.map(o => o.price)).size;
    
    const suspicious = sameSide.length > 5 && differentPrices > 3;
    
    return {
      suspicious,
      confidence: suspicious ? 0.7 + (sameSide.length * 0.02) : 0,
      details: suspicious ? `${sameSide.length} orders at ${differentPrices} price levels` : null
    };
  }
  
  async analyzeModification(order, userHistory) {
    // Similar logic for modifications
    return this.analyzeOrder(order, userHistory);
  }
}

class SpoofingDetector {
  async analyzeOrder(order, userHistory) {
    if (!userHistory) return { suspicious: false };
    
    // Look for large orders that get cancelled quickly
    const recentLargeOrders = userHistory
      .filter(h => h.type === 'order_submitted' && 
                  h.data.volume > order.volume * 5 &&
                  h.timestamp > Date.now() - 300000);
    
    const cancelledQuickly = recentLargeOrders.filter(o => {
      const cancellation = userHistory.find(h => 
        h.type === 'order_cancelled' && 
        h.data.orderId === o.data.orderId &&
        h.timestamp - o.timestamp < 30000 // Cancelled within 30 seconds
      );
      return cancellation !== undefined;
    });
    
    const suspicious = cancelledQuickly.length > 2;
    
    return {
      suspicious,
      confidence: suspicious ? 0.8 : 0,
      details: suspicious ? `${cancelledQuickly.length} large orders cancelled quickly` : null
    };
  }
}

class FrontRunningDetector {
  async analyzeTrade(match, orderBook) {
    // Check for orders placed just before large trades
    const timeDiff = match.takerTimestamp - match.makerTimestamp;
    const priceDiff = Math.abs(match.price - orderBook.getMidPrice(match.pair));
    
    // Suspicious if order was placed very recently and at favorable price
    const suspicious = timeDiff < 1000 && priceDiff > orderBook.getSpread(match.pair);
    
    return {
      suspicious,
      confidence: suspicious ? 0.6 : 0,
      details: suspicious ? `Order placed ${timeDiff}ms before trade` : null
    };
  }
}

class MarketManipulationDetector {
  async analyzeMarket(orderBook) {
    // Check for attempts to move market price
    const pairs = orderBook.getPairs();
    const suspicious = [];
    
    for (const pair of pairs) {
      const depth = orderBook.getDepth(pair);
      const midPrice = orderBook.getMidPrice(pair);
      
      // Check for walls (large orders blocking price movement)
      const bidWall = depth.bids.find(b => b.volume > depth.totalBidVolume * 0.3);
      const askWall = depth.asks.find(a => a.volume > depth.totalAskVolume * 0.3);
      
      if (bidWall || askWall) {
        suspicious.push({
          pair,
          type: 'wall',
          side: bidWall ? 'bid' : 'ask',
          volume: bidWall ? bidWall.volume : askWall.volume
        });
      }
    }
    
    return {
      suspicious: suspicious.length > 0,
      confidence: suspicious.length > 0 ? 0.7 : 0,
      details: suspicious
    };
  }
}

class UnusualVolumeDetector {
  constructor() {
    this.volumeHistory = new Map();
  }
  
  async analyzeMarket(orderBook) {
    const pairs = orderBook.getPairs();
    const unusual = [];
    
    for (const pair of pairs) {
      const currentVolume = orderBook.get24hVolume(pair);
      
      if (!this.volumeHistory.has(pair)) {
        this.volumeHistory.set(pair, []);
      }
      
      const history = this.volumeHistory.get(pair);
      history.push(currentVolume);
      
      if (history.length > 30) {
        history.shift();
      }
      
      if (history.length >= 7) {
        const avg = history.slice(0, -1).reduce((a, b) => a + b, 0) / (history.length - 1);
        const stdDev = Math.sqrt(
          history.slice(0, -1).reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / (history.length - 1)
        );
        
        // Check if current volume is unusual (> 3 standard deviations)
        if (Math.abs(currentVolume - avg) > 3 * stdDev) {
          unusual.push({
            pair,
            currentVolume,
            averageVolume: avg,
            deviation: (currentVolume - avg) / stdDev
          });
        }
      }
    }
    
    return {
      suspicious: unusual.length > 0,
      confidence: unusual.length > 0 ? 0.6 : 0,
      details: unusual
    };
  }
}

class RapidCancellationDetector {
  async analyze(order, userHistory) {
    if (!userHistory) return { suspicious: false };
    
    const recentCancellations = userHistory
      .filter(h => h.type === 'order_cancelled' && h.timestamp > Date.now() - 60000)
      .length;
    
    const suspicious = recentCancellations > 10;
    
    return {
      suspicious,
      confidence: suspicious ? 0.5 + (recentCancellations * 0.03) : 0,
      details: suspicious ? `${recentCancellations} cancellations in last minute` : null
    };
  }
}

class PriceManipulationDetector {
  async analyzeMarket(orderBook) {
    const pairs = orderBook.getPairs();
    const manipulations = [];
    
    for (const pair of pairs) {
      const spread = orderBook.getSpread(pair);
      const midPrice = orderBook.getMidPrice(pair);
      const spreadPercent = (spread / midPrice) * 100;
      
      // Check for abnormal spreads
      if (spreadPercent > 2) { // 2% spread is unusual
        manipulations.push({
          pair,
          spreadPercent,
          type: 'wide_spread'
        });
      }
      
      // Check for rapid price movements
      const priceHistory = orderBook.getPriceHistory(pair, 300000); // 5 minutes
      if (priceHistory.length > 2) {
        const priceChange = (priceHistory[priceHistory.length - 1] - priceHistory[0]) / priceHistory[0];
        if (Math.abs(priceChange) > 0.05) { // 5% change in 5 minutes
          manipulations.push({
            pair,
            priceChange: priceChange * 100,
            type: 'rapid_movement'
          });
        }
      }
    }
    
    return {
      suspicious: manipulations.length > 0,
      confidence: manipulations.length > 0 ? 0.7 : 0,
      details: manipulations
    };
  }
}

module.exports = SuspiciousActivityDetector;