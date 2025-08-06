const { getMetricsCollector } = require('./metrics-collector');
const EventEmitter = require('events');

class MatchingEngineMonitor extends EventEmitter {
  constructor(matchingEngine) {
    super();
    this.engine = matchingEngine;
    this.metrics = getMetricsCollector();
    this.isMonitoring = false;
    
    // Performance thresholds
    this.thresholds = {
      matchingLatency: 10, // ms - Target <10ms for high-frequency trading
      criticalLatency: 15, // ms - Alert threshold
      orderProcessingRate: 10000, // orders per second - Increased for HFT
      orderBookDepth: 100000, // max orders in book
      memoryUsage: 1024 * 1024 * 1024, // 1GB
      cpuUsage: 80 // percent
    };
    
    // Monitoring intervals
    this.intervals = {
      realtime: 1000, // 1 second
      aggregated: 60000 // 1 minute
    };
    
    this.stats = {
      ordersProcessed: 0,
      ordersMatched: 0,
      ordersCancelled: 0,
      totalVolume: 0,
      lastReset: Date.now(),
      latencyBreaches: 0,
      criticalLatencyBreaches: 0,
      subMillisecondMatches: 0
    };

    // High-precision latency tracking
    this.latencyStats = {
      current: [],
      p50: 0,
      p95: 0,
      p99: 0,
      p999: 0,
      lastCalculated: Date.now()
    };
  }

  async start() {
    if (this.isMonitoring) return;
    
    console.log('🚀 Starting matching engine monitoring...');
    this.isMonitoring = true;
    
    // Hook into matching engine events
    this.setupEngineHooks();
    
    // Start monitoring loops
    this.startRealtimeMonitoring();
    this.startAggregatedMonitoring();
    
    // Start performance monitoring
    this.startPerformanceMonitoring();
    
    console.log('✅ Matching engine monitoring started');
  }

  setupEngineHooks() {
    // Monitor order submissions with high-precision timing
    this.engine.on('order:submitted', async (order) => {
      const startTime = process.hrtime.bigint();
      const timer = this.metrics.startTimer('matching_engine.order_processing_time', {
        orderType: order.type,
        side: order.side
      });
      
      this.stats.ordersProcessed++;
      
      await this.metrics.incrementCounter('matching_engine.orders_submitted', 1, {
        orderType: order.type,
        side: order.side,
        pair: order.pair
      });
      
      // Store high-precision timer reference
      order._metricsTimer = timer;
      order._startTime = startTime;
    });

    // Monitor order matches with high-precision latency tracking
    this.engine.on('order:matched', async (match) => {
      const matchTime = process.hrtime.bigint();
      this.stats.ordersMatched++;
      this.stats.totalVolume += parseFloat(match.volume);
      
      // Calculate high-precision latencies
      if (match.makerOrder._startTime) {
        const latencyNs = matchTime - match.makerOrder._startTime;
        const latencyMs = Number(latencyNs) / 1000000;
        this.trackLatency(latencyMs, 'maker');
        
        // Track sub-millisecond performance
        if (latencyMs < 1) {
          this.stats.subMillisecondMatches++;
        }
        
        // Check latency thresholds
        if (latencyMs > this.thresholds.matchingLatency) {
          this.stats.latencyBreaches++;
          if (latencyMs > this.thresholds.criticalLatency) {
            this.stats.criticalLatencyBreaches++;
            this.emit('alert', {
              type: 'critical_matching_latency',
              severity: 'critical',
              message: `Critical matching latency: ${latencyMs.toFixed(3)}ms (threshold: ${this.thresholds.criticalLatency}ms)`,
              value: latencyMs,
              orderId: match.makerOrder.id,
              pair: match.pair
            });
          }
        }
      }
      
      if (match.takerOrder._startTime) {
        const latencyNs = matchTime - match.takerOrder._startTime;
        const latencyMs = Number(latencyNs) / 1000000;
        this.trackLatency(latencyMs, 'taker');
      }
      
      await this.metrics.incrementCounter('matching_engine.orders_matched', 1, {
        pair: match.pair
      });
      
      await this.metrics.incrementCounter('matching_engine.volume_matched', match.volume, {
        pair: match.pair,
        currency: match.currency
      });
      
      // Record spread at time of match
      const spread = match.askPrice - match.bidPrice;
      await this.metrics.recordHistogram('matching_engine.spread', spread, {
        pair: match.pair
      });
      
      // End processing timer if exists
      if (match.makerOrder._metricsTimer) {
        this.metrics.endTimer(match.makerOrder._metricsTimer);
      }
      if (match.takerOrder._metricsTimer) {
        this.metrics.endTimer(match.takerOrder._metricsTimer);
      }
    });

    // Monitor order cancellations
    this.engine.on('order:cancelled', async (order) => {
      this.stats.ordersCancelled++;
      
      await this.metrics.incrementCounter('matching_engine.orders_cancelled', 1, {
        orderType: order.type,
        reason: order.cancelReason || 'user_requested'
      });
    });

    // Monitor order book updates
    this.engine.on('orderbook:updated', async (update) => {
      await this.metrics.setGauge('matching_engine.orderbook_depth', update.depth, {
        pair: update.pair,
        side: update.side
      });
      
      // Track best bid/ask
      if (update.bestBid) {
        await this.metrics.setGauge('matching_engine.best_bid', update.bestBid, {
          pair: update.pair
        });
      }
      if (update.bestAsk) {
        await this.metrics.setGauge('matching_engine.best_ask', update.bestAsk, {
          pair: update.pair
        });
      }
    });

    // Monitor errors
    this.engine.on('error', async (error) => {
      await this.metrics.incrementCounter('matching_engine.errors', 1, {
        errorType: error.type || 'unknown',
        severity: error.severity || 'error'
      });
      
      this.emit('alert', {
        type: 'matching_engine_error',
        severity: 'high',
        message: error.message,
        timestamp: Date.now()
      });
    });
  }

  startRealtimeMonitoring() {
    this.realtimeInterval = setInterval(async () => {
      try {
        // Calculate rates
        const timeElapsed = (Date.now() - this.stats.lastReset) / 1000;
        const orderRate = this.stats.ordersProcessed / timeElapsed;
        const matchRate = this.stats.ordersMatched / timeElapsed;
        
        // Update gauges
        await this.metrics.setGauge('matching_engine.order_rate', orderRate);
        await this.metrics.setGauge('matching_engine.match_rate', matchRate);
        await this.metrics.setGauge('matching_engine.active_orders', this.engine.getActiveOrderCount());
        
        // Update latency percentiles
        this.updateLatencyPercentiles();
        await this.metrics.setGauge('matching_engine.latency_p50', this.latencyStats.p50);
        await this.metrics.setGauge('matching_engine.latency_p95', this.latencyStats.p95);
        await this.metrics.setGauge('matching_engine.latency_p99', this.latencyStats.p99);
        await this.metrics.setGauge('matching_engine.latency_p999', this.latencyStats.p999);
        
        // Update latency breach rates
        const latencyBreachRate = this.stats.ordersMatched > 0 ? 
          (this.stats.latencyBreaches / this.stats.ordersMatched) * 100 : 0;
        const criticalBreachRate = this.stats.ordersMatched > 0 ? 
          (this.stats.criticalLatencyBreaches / this.stats.ordersMatched) * 100 : 0;
        const subMsRate = this.stats.ordersMatched > 0 ? 
          (this.stats.subMillisecondMatches / this.stats.ordersMatched) * 100 : 0;
          
        await this.metrics.setGauge('matching_engine.latency_breach_rate', latencyBreachRate);
        await this.metrics.setGauge('matching_engine.critical_breach_rate', criticalBreachRate);
        await this.metrics.setGauge('matching_engine.sub_millisecond_rate', subMsRate);
        
        // Check thresholds
        if (orderRate < this.thresholds.orderProcessingRate * 0.1) {
          this.emit('alert', {
            type: 'low_order_rate',
            severity: 'warning',
            message: `Order processing rate low: ${orderRate.toFixed(2)} orders/sec`,
            value: orderRate
          });
        }
        
        // Alert on high latency breach rates
        if (latencyBreachRate > 5) { // More than 5% of orders breaching <10ms target
          this.emit('alert', {
            type: 'high_latency_breach_rate',
            severity: 'high',
            message: `High latency breach rate: ${latencyBreachRate.toFixed(2)}% of orders > ${this.thresholds.matchingLatency}ms`,
            value: latencyBreachRate
          });
        }
        
        if (this.latencyStats.p99 > this.thresholds.matchingLatency) {
          this.emit('alert', {
            type: 'p99_latency_breach',
            severity: 'high',
            message: `P99 latency exceeds target: ${this.latencyStats.p99.toFixed(3)}ms > ${this.thresholds.matchingLatency}ms`,
            value: this.latencyStats.p99
          });
        }
        
        // Reset stats every minute
        if (Date.now() - this.stats.lastReset > 60000) {
          this.stats = {
            ordersProcessed: 0,
            ordersMatched: 0,
            ordersCancelled: 0,
            totalVolume: 0,
            lastReset: Date.now(),
            latencyBreaches: 0,
            criticalLatencyBreaches: 0,
            subMillisecondMatches: 0
          };
        }
        
      } catch (error) {
        console.error('Realtime monitoring error:', error);
      }
    }, this.intervals.realtime);
  }

  startAggregatedMonitoring() {
    this.aggregatedInterval = setInterval(async () => {
      try {
        // Get order book snapshots for all pairs
        const pairs = this.engine.getSupportedPairs();
        
        for (const pair of pairs) {
          const orderBook = this.engine.getOrderBook(pair);
          
          // Calculate market metrics
          const metrics = this.calculateMarketMetrics(orderBook);
          
          // Store metrics
          await this.metrics.setGauge('matching_engine.bid_ask_spread', metrics.spread, { pair });
          await this.metrics.setGauge('matching_engine.market_depth', metrics.depth, { pair });
          await this.metrics.setGauge('matching_engine.liquidity_imbalance', metrics.imbalance, { pair });
          await this.metrics.recordHistogram('matching_engine.order_sizes', metrics.avgOrderSize, { pair });
        }
        
        // Calculate engine efficiency
        const efficiency = await this.calculateEngineEfficiency();
        await this.metrics.setGauge('matching_engine.efficiency', efficiency);
        
      } catch (error) {
        console.error('Aggregated monitoring error:', error);
      }
    }, this.intervals.aggregated);
  }

  startPerformanceMonitoring() {
    this.performanceInterval = setInterval(async () => {
      try {
        // Monitor process metrics
        const usage = process.cpuUsage();
        const memUsage = process.memoryUsage();
        
        // Calculate CPU percentage
        const cpuPercent = (usage.user + usage.system) / 1000000 * 100;
        
        await this.metrics.setGauge('matching_engine.cpu_usage', cpuPercent);
        await this.metrics.setGauge('matching_engine.memory_usage', memUsage.heapUsed);
        await this.metrics.setGauge('matching_engine.memory_total', memUsage.heapTotal);
        
        // Check performance thresholds
        if (cpuPercent > this.thresholds.cpuUsage) {
          this.emit('alert', {
            type: 'high_cpu_usage',
            severity: 'warning',
            message: `High CPU usage: ${cpuPercent.toFixed(2)}%`,
            value: cpuPercent
          });
        }
        
        if (memUsage.heapUsed > this.thresholds.memoryUsage) {
          this.emit('alert', {
            type: 'high_memory_usage',
            severity: 'warning',
            message: `High memory usage: ${(memUsage.heapUsed / 1024 / 1024).toFixed(2)}MB`,
            value: memUsage.heapUsed
          });
        }
        
        // Monitor event loop lag
        const lagStart = Date.now();
        setImmediate(() => {
          const lag = Date.now() - lagStart;
          this.metrics.recordHistogram('matching_engine.event_loop_lag', lag);
          
          if (lag > 100) {
            this.emit('alert', {
              type: 'high_event_loop_lag',
              severity: 'high',
              message: `High event loop lag: ${lag}ms`,
              value: lag
            });
          }
        });
        
      } catch (error) {
        console.error('Performance monitoring error:', error);
      }
    }, 5000); // Every 5 seconds
  }

  calculateMarketMetrics(orderBook) {
    const bids = orderBook.bids || [];
    const asks = orderBook.asks || [];
    
    // Calculate spread
    const bestBid = bids[0]?.price || 0;
    const bestAsk = asks[0]?.price || 0;
    const spread = bestAsk - bestBid;
    const spreadPercent = bestBid > 0 ? (spread / bestBid) * 100 : 0;
    
    // Calculate depth (total volume within 1% of best prices)
    const bidDepth = this.calculateDepthVolume(bids, bestBid, 0.01);
    const askDepth = this.calculateDepthVolume(asks, bestAsk, 0.01);
    const totalDepth = bidDepth + askDepth;
    
    // Calculate liquidity imbalance
    const imbalance = totalDepth > 0 ? (bidDepth - askDepth) / totalDepth : 0;
    
    // Calculate average order size
    const allOrders = [...bids, ...asks];
    const avgOrderSize = allOrders.length > 0
      ? allOrders.reduce((sum, order) => sum + order.volume, 0) / allOrders.length
      : 0;
    
    return {
      spread,
      spreadPercent,
      depth: totalDepth,
      bidDepth,
      askDepth,
      imbalance,
      avgOrderSize,
      orderCount: allOrders.length
    };
  }

  calculateDepthVolume(orders, referencePrice, percentRange) {
    const threshold = referencePrice * percentRange;
    return orders
      .filter(order => Math.abs(order.price - referencePrice) <= threshold)
      .reduce((sum, order) => sum + order.volume, 0);
  }

  async calculateEngineEfficiency() {
    // Get recent metrics
    const processingTimes = await this.metrics.getTimeSeries(
      'histogram',
      'matching_engine.order_processing_time',
      Date.now() - 300000, // Last 5 minutes
      Date.now()
    );
    
    if (processingTimes.length === 0) return 100;
    
    // Calculate percentage of orders processed within threshold
    const withinThreshold = processingTimes.filter(
      point => point.value <= this.thresholds.matchingLatency
    ).length;
    
    return (withinThreshold / processingTimes.length) * 100;
  }

  async getRealtimeMetrics() {
    const snapshot = await this.metrics.getSnapshot();
    
    return {
      timestamp: Date.now(),
      orderRate: snapshot.gauges['matching_engine.order_rate'] || 0,
      matchRate: snapshot.gauges['matching_engine.match_rate'] || 0,
      activeOrders: snapshot.gauges['matching_engine.active_orders'] || 0,
      cpuUsage: snapshot.gauges['matching_engine.cpu_usage'] || 0,
      memoryUsage: snapshot.gauges['matching_engine.memory_usage'] || 0,
      efficiency: snapshot.gauges['matching_engine.efficiency'] || 100,
      recentAlerts: this.getRecentAlerts()
    };
  }

  getRecentAlerts() {
    // This would be implemented to return recent alerts
    // For now, return empty array
    return [];
  }

  stop() {
    if (!this.isMonitoring) return;
    
    console.log('🛑 Stopping matching engine monitoring...');
    
    clearInterval(this.realtimeInterval);
    clearInterval(this.aggregatedInterval);
    clearInterval(this.performanceInterval);
    
    this.isMonitoring = false;
    
    console.log('✅ Matching engine monitoring stopped');
  }

  trackLatency(latencyMs, orderType) {
    // Store latency sample with timestamp
    this.latencyStats.current.push({
      latency: latencyMs,
      timestamp: Date.now(),
      type: orderType
    });
    
    // Keep only last 10,000 samples for memory efficiency
    if (this.latencyStats.current.length > 10000) {
      this.latencyStats.current = this.latencyStats.current.slice(-5000);
    }
  }

  updateLatencyPercentiles() {
    const now = Date.now();
    
    // Only recalculate percentiles every 5 seconds to reduce CPU overhead
    if (now - this.latencyStats.lastCalculated < 5000) {
      return;
    }
    
    // Filter to recent samples (last 60 seconds)
    const recentSamples = this.latencyStats.current
      .filter(sample => now - sample.timestamp < 60000)
      .map(sample => sample.latency)
      .sort((a, b) => a - b);
    
    if (recentSamples.length === 0) {
      return;
    }
    
    // Calculate percentiles
    this.latencyStats.p50 = this.calculatePercentile(recentSamples, 0.5);
    this.latencyStats.p95 = this.calculatePercentile(recentSamples, 0.95);
    this.latencyStats.p99 = this.calculatePercentile(recentSamples, 0.99);
    this.latencyStats.p999 = this.calculatePercentile(recentSamples, 0.999);
    this.latencyStats.lastCalculated = now;
  }

  calculatePercentile(sortedArray, percentile) {
    if (sortedArray.length === 0) return 0;
    
    const index = Math.ceil(sortedArray.length * percentile) - 1;
    return sortedArray[Math.max(0, Math.min(index, sortedArray.length - 1))];
  }

  getLatencyMetrics() {
    return {
      current: {
        p50: this.latencyStats.p50,
        p95: this.latencyStats.p95,
        p99: this.latencyStats.p99,
        p999: this.latencyStats.p999
      },
      thresholds: {
        target: this.thresholds.matchingLatency,
        critical: this.thresholds.criticalLatency
      },
      breaches: {
        total: this.stats.latencyBreaches,
        critical: this.stats.criticalLatencyBreaches,
        rate: this.stats.ordersMatched > 0 ? 
          (this.stats.latencyBreaches / this.stats.ordersMatched) * 100 : 0
      },
      performance: {
        subMillisecondMatches: this.stats.subMillisecondMatches,
        subMillisecondRate: this.stats.ordersMatched > 0 ? 
          (this.stats.subMillisecondMatches / this.stats.ordersMatched) * 100 : 0
      }
    };
  }
}

module.exports = MatchingEngineMonitor;