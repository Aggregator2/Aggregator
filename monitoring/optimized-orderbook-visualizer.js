const { getSecureMetricsCollector } = require('./secure-metrics-collector');
const LRU = require('lru-cache');

class OptimizedOrderBookVisualizer {
  constructor(matchingEngine, config = {}) {
    this.engine = matchingEngine;
    this.metrics = getSecureMetricsCollector();
    
    // Performance optimizations
    this.config = {
      updateInterval: config.updateInterval || 1000,
      maxHistorySize: config.maxHistorySize || 3600, // 1 hour
      maxPairs: config.maxPairs || 50,
      batchSize: config.batchSize || 10,
      cacheSize: config.cacheSize || 1000,
      enableSampling: config.enableSampling !== false,
      sampleRate: config.sampleRate || 0.1, // 10% sampling for high-frequency data
      ...config
    };
    
    // Caching layer
    this.cache = new LRU({
      max: this.config.cacheSize,
      ttl: 30000 // 30 seconds
    });
    
    // Circular buffers for memory efficiency
    this.historicalData = new Map();
    this.depthLevels = [0.1, 0.5, 1, 2, 5, 10];
    
    // Performance monitoring
    this.performanceStats = {
      snapshotsProcessed: 0,
      averageProcessingTime: 0,
      memoryUsage: 0,
      cacheHitRate: 0,
      lastUpdate: Date.now()
    };
    
    // Batch processing
    this.updateQueue = [];
    this.isProcessing = false;
    
    // WebSocket connections for real-time updates
    this.wsConnections = new Set();
    
    // Rate limiting
    this.rateLimiter = new Map();
  }

  async start() {
    console.log('📊 Starting optimized order book visualization...');
    
    this.interval = setInterval(() => {
      this.processBatchUpdates();
    }, this.config.updateInterval);
    
    // Start performance monitoring
    this.startPerformanceMonitoring();
    
    // Initial snapshot
    await this.captureSnapshot();
    
    console.log('✅ Optimized order book visualization started');
  }

  startPerformanceMonitoring() {
    setInterval(() => {
      this.updatePerformanceStats();
      this.cleanupOldData();
    }, 60000); // Every minute
  }

  updatePerformanceStats() {
    const memUsage = process.memoryUsage();
    this.performanceStats.memoryUsage = memUsage.heapUsed;
    
    // Calculate cache hit rate
    const cacheStats = this.cache.calculatedSize || 0;
    this.performanceStats.cacheHitRate = cacheStats > 0 ? 
      (this.cache.size / cacheStats) : 0;
    
    this.performanceStats.lastUpdate = Date.now();
  }

  cleanupOldData() {
    const cutoff = Date.now() - (this.config.maxHistorySize * 1000);
    
    for (const [pair, history] of this.historicalData) {
      if (history.length > 0) {
        // Remove old entries efficiently
        const firstValidIndex = history.findIndex(h => h.timestamp > cutoff);
        if (firstValidIndex > 0) {
          history.splice(0, firstValidIndex);
        }
        
        // Limit total size
        if (history.length > this.config.maxHistorySize) {
          history.splice(0, history.length - this.config.maxHistorySize);
        }
      }
    }
    
    // Clear rate limiters
    const rateCutoff = Date.now() - 60000;
    for (const [key, timestamp] of this.rateLimiter) {
      if (timestamp < rateCutoff) {
        this.rateLimiter.delete(key);
      }
    }
  }

  async processBatchUpdates() {
    if (this.isProcessing || this.updateQueue.length === 0) return;
    
    this.isProcessing = true;
    const startTime = Date.now();
    
    try {
      const pairs = this.engine.getSupportedPairs();
      const batchPromises = [];
      
      // Process pairs in batches
      for (let i = 0; i < pairs.length; i += this.config.batchSize) {
        const batch = pairs.slice(i, i + this.config.batchSize);
        batchPromises.push(this.processPairBatch(batch));
      }
      
      await Promise.all(batchPromises);
      
      // Update performance stats
      const processingTime = Date.now() - startTime;
      this.updateAverageProcessingTime(processingTime);
      this.performanceStats.snapshotsProcessed++;
      
    } catch (error) {
      console.error('Batch processing error:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  async processPairBatch(pairs) {
    const promises = pairs.map(pair => this.processPairUpdate(pair));
    await Promise.all(promises);
  }

  async processPairUpdate(pair) {
    try {
      // Check cache first
      const cacheKey = `orderbook:${pair}:${Math.floor(Date.now() / 1000)}`;
      let snapshot = this.cache.get(cacheKey);
      
      if (!snapshot) {
        const orderBook = this.engine.getOrderBook(pair);
        snapshot = this.analyzeOrderBook(orderBook, pair);
        this.cache.set(cacheKey, snapshot);
      }
      
      // Store snapshot efficiently
      this.storeSnapshotOptimized(pair, snapshot);
      
      // Update metrics with sampling
      if (this.shouldSample()) {
        await this.updateMetricsOptimized(pair, snapshot);
      }
      
      // Emit visualization data to WebSocket connections
      this.emitToWebSockets(pair, snapshot);
      
    } catch (error) {
      console.error(`Error processing pair ${pair}:`, error);
    }
  }

  shouldSample() {
    if (!this.config.enableSampling) return true;
    return Math.random() < this.config.sampleRate;
  }

  analyzeOrderBook(orderBook, pair) {
    const bids = orderBook.bids || [];
    const asks = orderBook.asks || [];
    
    // Use efficient calculations
    const bestBid = bids[0]?.price || 0;
    const bestAsk = asks[0]?.price || 0;
    const midPrice = (bestBid + bestAsk) / 2;
    
    // Pre-calculate commonly used values
    const totalBidVolume = this.calculateTotalVolume(bids);
    const totalAskVolume = this.calculateTotalVolume(asks);
    
    return {
      timestamp: Date.now(),
      pair,
      bestBid,
      bestAsk,
      spread: bestAsk - bestBid,
      spreadPercent: bestBid > 0 ? ((bestAsk - bestBid) / bestBid) * 100 : 0,
      midPrice,
      bidCount: bids.length,
      askCount: asks.length,
      totalBidVolume,
      totalAskVolume,
      // Optimize: Calculate expensive metrics less frequently
      depthAnalysis: this.shouldCalculateDepth() ? 
        this.calculateDepthLevels(bids, asks, midPrice) : null,
      imbalance: this.calculateImbalanceOptimized(bids, asks),
      pressure: this.calculateMarketPressureOptimized(bids, asks, midPrice)
    };
  }

  shouldCalculateDepth() {
    // Calculate depth analysis less frequently for performance
    return this.performanceStats.snapshotsProcessed % 10 === 0;
  }

  calculateTotalVolume(orders) {
    let total = 0;
    for (let i = 0; i < orders.length; i++) {
      total += orders[i].volume;
    }
    return total;
  }

  calculateDepthLevels(bids, asks, midPrice) {
    const depth = {};
    
    for (const level of this.depthLevels) {
      const priceRange = midPrice * (level / 100);
      
      let bidDepth = 0;
      let askDepth = 0;
      
      // Optimized loops with early termination
      for (let i = 0; i < bids.length; i++) {
        if (midPrice - bids[i].price > priceRange) break;
        bidDepth += bids[i].volume;
      }
      
      for (let i = 0; i < asks.length; i++) {
        if (asks[i].price - midPrice > priceRange) break;
        askDepth += asks[i].volume;
      }
      
      depth[`${level}%`] = {
        bidVolume: bidDepth,
        askVolume: askDepth,
        totalVolume: bidDepth + askDepth,
        ratio: askDepth > 0 ? bidDepth / askDepth : bidDepth
      };
    }
    
    return depth;
  }

  calculateImbalanceOptimized(bids, asks) {
    const levels = [5, 10, 20]; // Reduced levels for performance
    const imbalance = {};
    
    for (const level of levels) {
      const maxBids = Math.min(level, bids.length);
      const maxAsks = Math.min(level, asks.length);
      
      let bidVolume = 0;
      let askVolume = 0;
      
      for (let i = 0; i < maxBids; i++) {
        bidVolume += bids[i].volume;
      }
      
      for (let i = 0; i < maxAsks; i++) {
        askVolume += asks[i].volume;
      }
      
      const totalVolume = bidVolume + askVolume;
      
      imbalance[`top${level}`] = {
        imbalanceRatio: totalVolume > 0 ? (bidVolume - askVolume) / totalVolume : 0,
        bidDominance: totalVolume > 0 ? bidVolume / totalVolume : 0.5
      };
    }
    
    return imbalance;
  }

  calculateMarketPressureOptimized(bids, asks, midPrice) {
    const nearRangePercent = 0.5;
    const nearRange = midPrice * (nearRangePercent / 100);
    
    let nearBidVolume = 0;
    let nearAskVolume = 0;
    
    // Optimized iteration with early exit
    for (let i = 0; i < bids.length && (midPrice - bids[i].price) <= nearRange; i++) {
      nearBidVolume += bids[i].volume;
    }
    
    for (let i = 0; i < asks.length && (asks[i].price - midPrice) <= nearRange; i++) {
      nearAskVolume += asks[i].volume;
    }
    
    const totalNearVolume = nearBidVolume + nearAskVolume;
    const pressureScore = totalNearVolume > 0
      ? ((nearBidVolume - nearAskVolume) / totalNearVolume) * 100
      : 0;
    
    return {
      buyPressure: nearBidVolume,
      sellPressure: nearAskVolume,
      pressureScore
    };
  }

  storeSnapshotOptimized(pair, snapshot) {
    if (!this.historicalData.has(pair)) {
      this.historicalData.set(pair, []);
    }
    
    const history = this.historicalData.get(pair);
    
    // Use circular buffer approach
    if (history.length >= this.config.maxHistorySize) {
      history.shift(); // Remove oldest
    }
    
    // Store only essential data to save memory
    history.push({
      timestamp: snapshot.timestamp,
      midPrice: snapshot.midPrice,
      spread: snapshot.spreadPercent,
      bidVolume: snapshot.totalBidVolume,
      askVolume: snapshot.totalAskVolume,
      pressure: snapshot.pressure?.pressureScore || 0
    });
  }

  async updateMetricsOptimized(pair, snapshot) {
    try {
      // Batch metric updates for efficiency
      const metricsUpdates = [
        ['orderbook.spread', snapshot.spread, { pair }],
        ['orderbook.spread_percent', snapshot.spreadPercent, { pair }],
        ['orderbook.mid_price', snapshot.midPrice, { pair }],
        ['orderbook.total_bid_volume', snapshot.totalBidVolume, { pair }],
        ['orderbook.total_ask_volume', snapshot.totalAskVolume, { pair }]
      ];
      
      // Update metrics in parallel
      const promises = metricsUpdates.map(([name, value, labels]) =>
        this.metrics.setGauge(name, value, labels, 'orderbook')
      );
      
      await Promise.all(promises);
      
      // Update pressure metrics
      if (snapshot.pressure) {
        await this.metrics.setGauge(
          'orderbook.pressure_score', 
          snapshot.pressure.pressureScore, 
          { pair },
          'orderbook'
        );
      }
      
    } catch (error) {
      console.error('Failed to update metrics:', error);
    }
  }

  emitToWebSockets(pair, snapshot) {
    if (this.wsConnections.size === 0) return;
    
    const update = {
      type: 'orderbook_update',
      pair,
      timestamp: snapshot.timestamp,
      data: {
        spread: snapshot.spread,
        midPrice: snapshot.midPrice,
        bidVolume: snapshot.totalBidVolume,
        askVolume: snapshot.totalAskVolume,
        pressure: snapshot.pressure?.pressureScore || 0
      }
    };
    
    // Broadcast to all connected WebSocket clients
    for (const ws of this.wsConnections) {
      try {
        if (ws.readyState === 1) { // WebSocket.OPEN
          ws.send(JSON.stringify(update));
        } else {
          this.wsConnections.delete(ws);
        }
      } catch (error) {
        console.error('WebSocket send error:', error);
        this.wsConnections.delete(ws);
      }
    }
  }

  addWebSocketConnection(ws) {
    this.wsConnections.add(ws);
    
    ws.on('close', () => {
      this.wsConnections.delete(ws);
    });
    
    // Send initial data
    this.sendInitialData(ws);
  }

  sendInitialData(ws) {
    try {
      const pairs = this.engine.getSupportedPairs();
      const initialData = {};
      
      for (const pair of pairs) {
        const history = this.historicalData.get(pair);
        if (history && history.length > 0) {
          initialData[pair] = history.slice(-100); // Last 100 data points
        }
      }
      
      ws.send(JSON.stringify({
        type: 'initial_data',
        data: initialData
      }));
    } catch (error) {
      console.error('Failed to send initial data:', error);
    }
  }

  updateAverageProcessingTime(newTime) {
    const alpha = 0.1; // Exponential moving average factor
    this.performanceStats.averageProcessingTime = 
      (1 - alpha) * this.performanceStats.averageProcessingTime + alpha * newTime;
  }

  // Optimized visualization data retrieval
  getVisualizationData(pair, timeRange = 300000) {
    const cacheKey = `viz:${pair}:${timeRange}`;
    let cached = this.cache.get(cacheKey);
    
    if (cached) {
      return cached;
    }
    
    const history = this.historicalData.get(pair) || [];
    const startTime = Date.now() - timeRange;
    
    // Use binary search for efficient filtering
    const startIndex = this.binarySearchByTimestamp(history, startTime);
    const relevantHistory = history.slice(startIndex);
    
    if (relevantHistory.length === 0) {
      return null;
    }
    
    const result = {
      current: relevantHistory[relevantHistory.length - 1],
      history: relevantHistory,
      statistics: this.calculateStatisticsOptimized(relevantHistory),
      performance: {
        processingTime: this.performanceStats.averageProcessingTime,
        cacheHitRate: this.performanceStats.cacheHitRate,
        memoryUsage: this.performanceStats.memoryUsage
      }
    };
    
    // Cache the result
    this.cache.set(cacheKey, result);
    
    return result;
  }

  binarySearchByTimestamp(array, timestamp) {
    let left = 0;
    let right = array.length - 1;
    
    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      if (array[mid].timestamp < timestamp) {
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }
    
    return left;
  }

  calculateStatisticsOptimized(history) {
    if (history.length === 0) return {};
    
    let totalSpread = 0;
    let totalPressure = 0;
    let minSpread = Infinity;
    let maxSpread = -Infinity;
    
    for (const point of history) {
      totalSpread += point.spread;
      totalPressure += point.pressure;
      minSpread = Math.min(minSpread, point.spread);
      maxSpread = Math.max(maxSpread, point.spread);
    }
    
    const avgSpread = totalSpread / history.length;
    const avgPressure = totalPressure / history.length;
    
    return {
      avgSpread,
      minSpread,
      maxSpread,
      avgPressure,
      trendDirection: this.calculateTrendOptimized(history)
    };
  }

  calculateTrendOptimized(history) {
    if (history.length < 10) return 'neutral';
    
    const quarter = Math.floor(history.length / 4);
    const firstQuarter = history.slice(0, quarter);
    const lastQuarter = history.slice(-quarter);
    
    const avgFirst = firstQuarter.reduce((sum, h) => sum + h.midPrice, 0) / firstQuarter.length;
    const avgLast = lastQuarter.reduce((sum, h) => sum + h.midPrice, 0) / lastQuarter.length;
    
    const changePercent = ((avgLast - avgFirst) / avgFirst) * 100;
    
    if (changePercent > 0.1) return 'bullish';
    if (changePercent < -0.1) return 'bearish';
    return 'neutral';
  }

  getPerformanceStats() {
    return {
      ...this.performanceStats,
      cacheSize: this.cache.size,
      historicalDataSize: this.historicalData.size,
      wsConnections: this.wsConnections.size,
      rateLimiterSize: this.rateLimiter.size
    };
  }

  // Graceful shutdown
  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    
    // Close WebSocket connections
    for (const ws of this.wsConnections) {
      try {
        ws.close();
      } catch (error) {
        console.error('Error closing WebSocket:', error);
      }
    }
    
    // Clear cache and data
    this.cache.clear();
    this.historicalData.clear();
    this.wsConnections.clear();
    this.rateLimiter.clear();
    
    console.log('📊 Optimized order book visualization stopped');
  }
}

module.exports = OptimizedOrderBookVisualizer;