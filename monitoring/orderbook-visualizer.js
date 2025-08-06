const { getMetricsCollector } = require('./metrics-collector');

class OrderBookVisualizer {
  constructor(matchingEngine) {
    this.engine = matchingEngine;
    this.metrics = getMetricsCollector();
    this.updateInterval = 1000; // 1 second
    this.depthLevels = [0.1, 0.5, 1, 2, 5, 10]; // Percentage levels for depth analysis
    this.historicalData = new Map(); // Store historical snapshots
    this.maxHistorySize = 3600; // Keep 1 hour of second-by-second data
  }

  async start() {
    console.log('📊 Starting order book visualization...');
    
    this.interval = setInterval(() => {
      this.captureSnapshot();
    }, this.updateInterval);
    
    // Initial snapshot
    await this.captureSnapshot();
  }

  async captureSnapshot() {
    try {
      const pairs = this.engine.getSupportedPairs();
      const timestamp = Date.now();
      
      for (const pair of pairs) {
        const orderBook = this.engine.getOrderBook(pair);
        const snapshot = this.analyzeOrderBook(orderBook, pair);
        
        // Store snapshot
        this.storeSnapshot(pair, timestamp, snapshot);
        
        // Update metrics
        await this.updateMetrics(pair, snapshot);
        
        // Emit visualization data
        this.emitVisualizationUpdate(pair, snapshot);
      }
    } catch (error) {
      console.error('Order book visualization error:', error);
    }
  }

  analyzeOrderBook(orderBook, pair) {
    const bids = orderBook.bids || [];
    const asks = orderBook.asks || [];
    
    // Get best bid/ask
    const bestBid = bids[0]?.price || 0;
    const bestAsk = asks[0]?.price || 0;
    const midPrice = (bestBid + bestAsk) / 2;
    
    // Calculate depth at various levels
    const depthAnalysis = this.calculateDepthLevels(bids, asks, midPrice);
    
    // Calculate order book imbalance
    const imbalance = this.calculateImbalance(bids, asks);
    
    // Analyze price levels
    const priceLevels = this.analyzePriceLevels(bids, asks);
    
    // Calculate market pressure
    const pressure = this.calculateMarketPressure(bids, asks, midPrice);
    
    // Detect large orders
    const largeOrders = this.detectLargeOrders(bids, asks);
    
    return {
      timestamp: Date.now(),
      pair,
      bestBid,
      bestAsk,
      spread: bestAsk - bestBid,
      spreadPercent: bestBid > 0 ? ((bestAsk - bestBid) / bestBid) * 100 : 0,
      midPrice,
      depthAnalysis,
      imbalance,
      priceLevels,
      pressure,
      largeOrders,
      bidCount: bids.length,
      askCount: asks.length,
      totalBidVolume: bids.reduce((sum, bid) => sum + bid.volume, 0),
      totalAskVolume: asks.reduce((sum, ask) => sum + ask.volume, 0)
    };
  }

  calculateDepthLevels(bids, asks, midPrice) {
    const depth = {};
    
    for (const level of this.depthLevels) {
      const priceRange = midPrice * (level / 100);
      
      // Calculate bid depth
      const bidDepth = bids
        .filter(bid => midPrice - bid.price <= priceRange)
        .reduce((sum, bid) => sum + bid.volume, 0);
      
      // Calculate ask depth
      const askDepth = asks
        .filter(ask => ask.price - midPrice <= priceRange)
        .reduce((sum, ask) => sum + ask.volume, 0);
      
      depth[`${level}%`] = {
        bidVolume: bidDepth,
        askVolume: askDepth,
        totalVolume: bidDepth + askDepth,
        ratio: bidDepth / (askDepth || 1)
      };
    }
    
    return depth;
  }

  calculateImbalance(bids, asks) {
    // Order book imbalance at different depths
    const levels = [5, 10, 20, 50, 100]; // Number of orders to consider
    const imbalance = {};
    
    for (const level of levels) {
      const bidVolume = bids.slice(0, level).reduce((sum, bid) => sum + bid.volume, 0);
      const askVolume = asks.slice(0, level).reduce((sum, ask) => sum + ask.volume, 0);
      const totalVolume = bidVolume + askVolume;
      
      imbalance[`top${level}`] = {
        bidVolume,
        askVolume,
        imbalanceRatio: totalVolume > 0 ? (bidVolume - askVolume) / totalVolume : 0,
        bidDominance: totalVolume > 0 ? bidVolume / totalVolume : 0.5
      };
    }
    
    return imbalance;
  }

  analyzePriceLevels(bids, asks) {
    // Group orders by price level
    const bidLevels = this.groupByPriceLevel(bids);
    const askLevels = this.groupByPriceLevel(asks);
    
    // Find significant levels (high volume concentration)
    const significantBidLevels = this.findSignificantLevels(bidLevels);
    const significantAskLevels = this.findSignificantLevels(askLevels);
    
    return {
      bidLevels: bidLevels.length,
      askLevels: askLevels.length,
      significantBidLevels,
      significantAskLevels,
      bidConcentration: this.calculateConcentration(bidLevels),
      askConcentration: this.calculateConcentration(askLevels)
    };
  }

  groupByPriceLevel(orders) {
    const levels = new Map();
    
    for (const order of orders) {
      const price = order.price;
      if (!levels.has(price)) {
        levels.set(price, { price, volume: 0, count: 0 });
      }
      const level = levels.get(price);
      level.volume += order.volume;
      level.count += 1;
    }
    
    return Array.from(levels.values()).sort((a, b) => b.volume - a.volume);
  }

  findSignificantLevels(priceLevels, threshold = 0.1) {
    if (priceLevels.length === 0) return [];
    
    const totalVolume = priceLevels.reduce((sum, level) => sum + level.volume, 0);
    const avgVolume = totalVolume / priceLevels.length;
    const significantVolume = avgVolume * 3; // 3x average is significant
    
    return priceLevels
      .filter(level => level.volume >= significantVolume)
      .slice(0, 5) // Top 5 significant levels
      .map(level => ({
        price: level.price,
        volume: level.volume,
        percentOfTotal: (level.volume / totalVolume) * 100
      }));
  }

  calculateConcentration(priceLevels) {
    if (priceLevels.length === 0) return 0;
    
    const totalVolume = priceLevels.reduce((sum, level) => sum + level.volume, 0);
    const top5Volume = priceLevels.slice(0, 5).reduce((sum, level) => sum + level.volume, 0);
    
    return totalVolume > 0 ? (top5Volume / totalVolume) * 100 : 0;
  }

  calculateMarketPressure(bids, asks, midPrice) {
    // Calculate buy/sell pressure based on order placement
    const nearRangePercent = 0.5; // 0.5% from mid price
    const nearRange = midPrice * (nearRangePercent / 100);
    
    // Near orders (aggressive)
    const nearBids = bids.filter(bid => midPrice - bid.price <= nearRange);
    const nearAsks = asks.filter(ask => ask.price - midPrice <= nearRange);
    
    const nearBidVolume = nearBids.reduce((sum, bid) => sum + bid.volume, 0);
    const nearAskVolume = nearAsks.reduce((sum, ask) => sum + ask.volume, 0);
    
    // Calculate pressure score (-100 to 100)
    const totalNearVolume = nearBidVolume + nearAskVolume;
    const pressureScore = totalNearVolume > 0
      ? ((nearBidVolume - nearAskVolume) / totalNearVolume) * 100
      : 0;
    
    return {
      buyPressure: nearBidVolume,
      sellPressure: nearAskVolume,
      pressureScore,
      pressureDirection: pressureScore > 10 ? 'bullish' : pressureScore < -10 ? 'bearish' : 'neutral'
    };
  }

  detectLargeOrders(bids, asks) {
    const allOrders = [...bids.map(b => ({ ...b, side: 'bid' })), 
                       ...asks.map(a => ({ ...a, side: 'ask' }))];
    
    if (allOrders.length === 0) return [];
    
    // Calculate volume statistics
    const volumes = allOrders.map(o => o.volume).sort((a, b) => a - b);
    const p75 = volumes[Math.floor(volumes.length * 0.75)];
    const p95 = volumes[Math.floor(volumes.length * 0.95)];
    
    // Large orders are > 95th percentile
    const largeOrders = allOrders
      .filter(order => order.volume >= p95)
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 10) // Top 10 large orders
      .map(order => ({
        side: order.side,
        price: order.price,
        volume: order.volume,
        percentile: order.volume >= p95 ? 95 : 75,
        distanceFromMid: order.side === 'bid' 
          ? ((order.price - bids[0]?.price) / bids[0]?.price) * 100
          : ((asks[0]?.price - order.price) / asks[0]?.price) * 100
      }));
    
    return largeOrders;
  }

  storeSnapshot(pair, timestamp, snapshot) {
    if (!this.historicalData.has(pair)) {
      this.historicalData.set(pair, []);
    }
    
    const history = this.historicalData.get(pair);
    history.push({ timestamp, ...snapshot });
    
    // Maintain size limit
    if (history.length > this.maxHistorySize) {
      history.shift();
    }
  }

  async updateMetrics(pair, snapshot) {
    // Update order book metrics
    await this.metrics.setGauge('orderbook.spread', snapshot.spread, { pair });
    await this.metrics.setGauge('orderbook.spread_percent', snapshot.spreadPercent, { pair });
    await this.metrics.setGauge('orderbook.mid_price', snapshot.midPrice, { pair });
    await this.metrics.setGauge('orderbook.bid_count', snapshot.bidCount, { pair });
    await this.metrics.setGauge('orderbook.ask_count', snapshot.askCount, { pair });
    await this.metrics.setGauge('orderbook.total_bid_volume', snapshot.totalBidVolume, { pair });
    await this.metrics.setGauge('orderbook.total_ask_volume', snapshot.totalAskVolume, { pair });
    
    // Update depth metrics
    for (const [level, data] of Object.entries(snapshot.depthAnalysis)) {
      await this.metrics.setGauge(`orderbook.depth.${level}.total`, data.totalVolume, { pair });
      await this.metrics.setGauge(`orderbook.depth.${level}.ratio`, data.ratio, { pair });
    }
    
    // Update pressure metrics
    await this.metrics.setGauge('orderbook.pressure_score', snapshot.pressure.pressureScore, { pair });
    
    // Record large order count
    await this.metrics.recordHistogram('orderbook.large_orders_count', snapshot.largeOrders.length, { pair });
  }

  emitVisualizationUpdate(pair, snapshot) {
    // This would emit to WebSocket for real-time visualization
    // For now, we'll just return the data structure
    const visualizationData = {
      pair,
      timestamp: snapshot.timestamp,
      orderBook: {
        bids: this.prepareOrdersForVisualization(snapshot.bidLevels || []),
        asks: this.prepareOrdersForVisualization(snapshot.askLevels || [])
      },
      depth: snapshot.depthAnalysis,
      heatmap: this.generateHeatmapData(pair),
      pressure: snapshot.pressure,
      alerts: this.checkForAlerts(snapshot)
    };
    
    return visualizationData;
  }

  prepareOrdersForVisualization(orders) {
    // Aggregate orders by price for cleaner visualization
    return orders.slice(0, 50).map(order => ({
      price: order.price,
      volume: order.volume,
      total: order.total || order.volume
    }));
  }

  generateHeatmapData(pair) {
    const history = this.historicalData.get(pair) || [];
    if (history.length < 2) return [];
    
    // Generate heatmap data for last 30 minutes
    const thirtyMinutesAgo = Date.now() - (30 * 60 * 1000);
    const recentHistory = history.filter(h => h.timestamp >= thirtyMinutesAgo);
    
    // Sample every minute for heatmap
    const heatmapData = [];
    const sampleInterval = 60000; // 1 minute
    
    for (let i = 0; i < recentHistory.length; i += 60) {
      const snapshot = recentHistory[i];
      heatmapData.push({
        timestamp: snapshot.timestamp,
        spread: snapshot.spreadPercent,
        volumeRatio: snapshot.totalBidVolume / (snapshot.totalAskVolume || 1),
        pressure: snapshot.pressure.pressureScore
      });
    }
    
    return heatmapData;
  }

  checkForAlerts(snapshot) {
    const alerts = [];
    
    // Check for abnormal spread
    if (snapshot.spreadPercent > 1) {
      alerts.push({
        type: 'high_spread',
        severity: 'warning',
        message: `High spread detected: ${snapshot.spreadPercent.toFixed(2)}%`
      });
    }
    
    // Check for extreme imbalance
    const topImbalance = snapshot.imbalance?.top10?.imbalanceRatio || 0;
    if (Math.abs(topImbalance) > 0.8) {
      alerts.push({
        type: 'extreme_imbalance',
        severity: 'warning',
        message: `Extreme order book imbalance: ${(topImbalance * 100).toFixed(0)}%`
      });
    }
    
    // Check for large orders near market
    const nearMarketLargeOrders = snapshot.largeOrders.filter(o => o.distanceFromMid < 0.5);
    if (nearMarketLargeOrders.length > 0) {
      alerts.push({
        type: 'large_orders_near_market',
        severity: 'info',
        message: `${nearMarketLargeOrders.length} large orders near market price`
      });
    }
    
    return alerts;
  }

  getVisualizationData(pair, timeRange = 300000) { // Default 5 minutes
    const history = this.historicalData.get(pair) || [];
    const startTime = Date.now() - timeRange;
    const relevantHistory = history.filter(h => h.timestamp >= startTime);
    
    if (relevantHistory.length === 0) return null;
    
    const latestSnapshot = relevantHistory[relevantHistory.length - 1];
    
    return {
      current: latestSnapshot,
      history: relevantHistory.map(h => ({
        timestamp: h.timestamp,
        spread: h.spread,
        midPrice: h.midPrice,
        bidVolume: h.totalBidVolume,
        askVolume: h.totalAskVolume,
        pressure: h.pressure.pressureScore
      })),
      statistics: this.calculateStatistics(relevantHistory)
    };
  }

  calculateStatistics(history) {
    if (history.length === 0) return {};
    
    const spreads = history.map(h => h.spreadPercent);
    const pressures = history.map(h => h.pressure.pressureScore);
    
    return {
      avgSpread: spreads.reduce((a, b) => a + b, 0) / spreads.length,
      minSpread: Math.min(...spreads),
      maxSpread: Math.max(...spreads),
      avgPressure: pressures.reduce((a, b) => a + b, 0) / pressures.length,
      trendDirection: this.calculateTrend(history.map(h => h.midPrice))
    };
  }

  calculateTrend(prices) {
    if (prices.length < 2) return 'neutral';
    
    const firstHalf = prices.slice(0, Math.floor(prices.length / 2));
    const secondHalf = prices.slice(Math.floor(prices.length / 2));
    
    const avgFirst = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const avgSecond = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
    
    const changePercent = ((avgSecond - avgFirst) / avgFirst) * 100;
    
    if (changePercent > 0.1) return 'bullish';
    if (changePercent < -0.1) return 'bearish';
    return 'neutral';
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    console.log('📊 Order book visualization stopped');
  }
}

module.exports = OrderBookVisualizer;