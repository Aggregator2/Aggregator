const { StatsD } = require('node-statsd');
const { performance } = require('perf_hooks');
const EventEmitter = require('events');

/**
 * Performance monitoring for order book operations
 * Tracks metrics, identifies bottlenecks, and provides optimization insights
 */
class PerformanceMonitor extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      statsdHost: config.statsdHost || 'localhost',
      statsdPort: config.statsdPort || 8125,
      statsdPrefix: config.statsdPrefix || 'orderbook',
      metricsInterval: config.metricsInterval || 5000, // 5 seconds
      alertThresholds: {
        orderProcessingTime: 100, // ms
        batchProcessingTime: 500, // ms
        wsLatency: 50, // ms
        redisLatency: 20, // ms
        memoryUsage: 0.8, // 80% of available memory
        cpuUsage: 0.7, // 70% CPU
        ...config.alertThresholds
      },
      ...config
    };
    
    // StatsD client
    this.statsd = new StatsD({
      host: this.config.statsdHost,
      port: this.config.statsdPort,
      prefix: this.config.statsdPrefix + '.',
      cacheDns: true
    });
    
    // Metrics storage
    this.metrics = {
      orders: {
        processed: 0,
        failed: 0,
        processingTimes: [],
        throughput: 0
      },
      batches: {
        processed: 0,
        size: [],
        processingTimes: [],
        throughput: 0
      },
      websocket: {
        connections: 0,
        messages: 0,
        latencies: [],
        errors: 0
      },
      redis: {
        operations: 0,
        latencies: [],
        errors: 0,
        memoryUsage: 0
      },
      system: {
        memoryUsage: 0,
        cpuUsage: 0,
        eventLoopLag: 0
      },
      orderBook: {
        depth: {},
        spread: {},
        orders: {}
      }
    };
    
    // Performance marks
    this.marks = new Map();
    
    // Start monitoring
    this.startMonitoring();
  }

  /**
   * Start performance measurement
   */
  startMeasure(name) {
    const mark = `${name}_${Date.now()}_${Math.random()}`;
    this.marks.set(mark, performance.now());
    return mark;
  }

  /**
   * End performance measurement
   */
  endMeasure(mark, metricName) {
    const startTime = this.marks.get(mark);
    if (!startTime) return;
    
    const duration = performance.now() - startTime;
    this.marks.delete(mark);
    
    // Send to StatsD
    this.statsd.timing(metricName, duration);
    
    // Check threshold
    this.checkThreshold(metricName, duration);
    
    return duration;
  }

  /**
   * Track order processing
   */
  trackOrderProcessing(orderId, side, price, amount, processingTime) {
    this.metrics.orders.processed++;
    this.metrics.orders.processingTimes.push(processingTime);
    
    // Keep only last 1000 measurements
    if (this.metrics.orders.processingTimes.length > 1000) {
      this.metrics.orders.processingTimes.shift();
    }
    
    this.statsd.increment('orders.processed');
    this.statsd.timing('orders.processing_time', processingTime);
    this.statsd.gauge('orders.amount', amount);
    
    // Track by side
    this.statsd.increment(`orders.${side}`);
  }

  /**
   * Track batch processing
   */
  trackBatchProcessing(pair, batchSize, processingTime) {
    this.metrics.batches.processed++;
    this.metrics.batches.size.push(batchSize);
    this.metrics.batches.processingTimes.push(processingTime);
    
    // Calculate per-order time
    const perOrderTime = processingTime / batchSize;
    
    this.statsd.increment('batches.processed');
    this.statsd.timing('batches.processing_time', processingTime);
    this.statsd.gauge('batches.size', batchSize);
    this.statsd.timing('batches.per_order_time', perOrderTime);
    
    // Track by pair
    this.statsd.increment(`batches.pair.${pair}`);
  }

  /**
   * Track WebSocket metrics
   */
  trackWebSocketConnection(action) {
    if (action === 'connect') {
      this.metrics.websocket.connections++;
      this.statsd.increment('websocket.connections');
      this.statsd.gauge('websocket.active', this.metrics.websocket.connections);
    } else if (action === 'disconnect') {
      this.metrics.websocket.connections--;
      this.statsd.decrement('websocket.connections');
      this.statsd.gauge('websocket.active', this.metrics.websocket.connections);
    }
  }

  trackWebSocketMessage(direction, size, latency) {
    this.metrics.websocket.messages++;
    this.metrics.websocket.latencies.push(latency);
    
    this.statsd.increment(`websocket.messages.${direction}`);
    this.statsd.gauge('websocket.message_size', size);
    this.statsd.timing('websocket.latency', latency);
  }

  /**
   * Track Redis operations
   */
  trackRedisOperation(operation, duration) {
    this.metrics.redis.operations++;
    this.metrics.redis.latencies.push(duration);
    
    this.statsd.increment(`redis.operations.${operation}`);
    this.statsd.timing(`redis.latency.${operation}`, duration);
  }

  /**
   * Track order book state
   */
  trackOrderBookState(pair, stats) {
    const { bidLevels, askLevels, totalOrders, spread, bestBid, bestAsk } = stats;
    
    this.metrics.orderBook[pair] = {
      bidLevels,
      askLevels,
      totalOrders,
      spread,
      bestBid,
      bestAsk,
      timestamp: Date.now()
    };
    
    this.statsd.gauge(`orderbook.${pair}.bid_levels`, bidLevels);
    this.statsd.gauge(`orderbook.${pair}.ask_levels`, askLevels);
    this.statsd.gauge(`orderbook.${pair}.total_orders`, totalOrders);
    this.statsd.gauge(`orderbook.${pair}.spread`, spread || 0);
  }

  /**
   * Track system metrics
   */
  async trackSystemMetrics() {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    // Memory metrics
    this.metrics.system.memoryUsage = memUsage.heapUsed / memUsage.heapTotal;
    this.statsd.gauge('system.memory.heap_used', memUsage.heapUsed);
    this.statsd.gauge('system.memory.heap_total', memUsage.heapTotal);
    this.statsd.gauge('system.memory.rss', memUsage.rss);
    this.statsd.gauge('system.memory.external', memUsage.external);
    
    // CPU metrics
    this.statsd.gauge('system.cpu.user', cpuUsage.user);
    this.statsd.gauge('system.cpu.system', cpuUsage.system);
    
    // Event loop lag
    const lagMark = this.startMeasure('eventloop');
    setImmediate(() => {
      const lag = this.endMeasure(lagMark, 'system.eventloop_lag');
      this.metrics.system.eventLoopLag = lag;
    });
    
    // Check system thresholds
    if (this.metrics.system.memoryUsage > this.config.alertThresholds.memoryUsage) {
      this.emit('alert', {
        type: 'memory_high',
        value: this.metrics.system.memoryUsage,
        threshold: this.config.alertThresholds.memoryUsage
      });
    }
  }

  /**
   * Calculate throughput metrics
   */
  calculateThroughput() {
    const interval = this.config.metricsInterval / 1000; // Convert to seconds
    
    // Order throughput
    this.metrics.orders.throughput = this.metrics.orders.processed / interval;
    this.statsd.gauge('orders.throughput', this.metrics.orders.throughput);
    
    // Batch throughput
    this.metrics.batches.throughput = this.metrics.batches.processed / interval;
    this.statsd.gauge('batches.throughput', this.metrics.batches.throughput);
    
    // Message throughput
    const messageThroughput = this.metrics.websocket.messages / interval;
    this.statsd.gauge('websocket.throughput', messageThroughput);
    
    // Reset counters
    this.metrics.orders.processed = 0;
    this.metrics.batches.processed = 0;
    this.metrics.websocket.messages = 0;
  }

  /**
   * Calculate percentiles
   */
  calculatePercentiles(values, percentiles = [50, 90, 95, 99]) {
    if (values.length === 0) return {};
    
    const sorted = values.slice().sort((a, b) => a - b);
    const result = {};
    
    for (const p of percentiles) {
      const index = Math.ceil((p / 100) * sorted.length) - 1;
      result[`p${p}`] = sorted[Math.max(0, index)];
    }
    
    return result;
  }

  /**
   * Generate performance report
   */
  generateReport() {
    const report = {
      timestamp: Date.now(),
      uptime: process.uptime(),
      metrics: {
        orders: {
          total: this.metrics.orders.processed,
          failed: this.metrics.orders.failed,
          throughput: this.metrics.orders.throughput,
          processingTime: this.calculatePercentiles(this.metrics.orders.processingTimes)
        },
        batches: {
          total: this.metrics.batches.processed,
          avgSize: this.metrics.batches.size.reduce((a, b) => a + b, 0) / this.metrics.batches.size.length || 0,
          throughput: this.metrics.batches.throughput,
          processingTime: this.calculatePercentiles(this.metrics.batches.processingTimes)
        },
        websocket: {
          activeConnections: this.metrics.websocket.connections,
          totalMessages: this.metrics.websocket.messages,
          errors: this.metrics.websocket.errors,
          latency: this.calculatePercentiles(this.metrics.websocket.latencies)
        },
        redis: {
          operations: this.metrics.redis.operations,
          errors: this.metrics.redis.errors,
          latency: this.calculatePercentiles(this.metrics.redis.latencies)
        },
        system: {
          memory: {
            usage: this.metrics.system.memoryUsage,
            heapUsed: process.memoryUsage().heapUsed,
            heapTotal: process.memoryUsage().heapTotal
          },
          eventLoopLag: this.metrics.system.eventLoopLag
        },
        orderBook: this.metrics.orderBook
      },
      recommendations: this.generateRecommendations()
    };
    
    return report;
  }

  /**
   * Generate optimization recommendations
   */
  generateRecommendations() {
    const recommendations = [];
    
    // Check order processing times
    const orderP95 = this.calculatePercentiles(this.metrics.orders.processingTimes).p95;
    if (orderP95 > this.config.alertThresholds.orderProcessingTime) {
      recommendations.push({
        type: 'performance',
        severity: 'warning',
        message: `Order processing P95 (${orderP95.toFixed(2)}ms) exceeds threshold`,
        suggestion: 'Consider increasing batch size or optimizing order validation'
      });
    }
    
    // Check batch sizes
    const avgBatchSize = this.metrics.batches.size.reduce((a, b) => a + b, 0) / this.metrics.batches.size.length || 0;
    if (avgBatchSize < 10) {
      recommendations.push({
        type: 'efficiency',
        severity: 'info',
        message: `Low average batch size (${avgBatchSize.toFixed(1)})`,
        suggestion: 'Consider increasing batch interval to accumulate more orders'
      });
    }
    
    // Check WebSocket latency
    const wsP95 = this.calculatePercentiles(this.metrics.websocket.latencies).p95;
    if (wsP95 > this.config.alertThresholds.wsLatency) {
      recommendations.push({
        type: 'latency',
        severity: 'warning',
        message: `WebSocket latency P95 (${wsP95.toFixed(2)}ms) exceeds threshold`,
        suggestion: 'Consider enabling compression or reducing message size'
      });
    }
    
    // Check memory usage
    if (this.metrics.system.memoryUsage > 0.7) {
      recommendations.push({
        type: 'memory',
        severity: 'warning',
        message: `High memory usage (${(this.metrics.system.memoryUsage * 100).toFixed(1)}%)`,
        suggestion: 'Consider implementing more aggressive cleanup or increasing heap size'
      });
    }
    
    return recommendations;
  }

  /**
   * Check thresholds and emit alerts
   */
  checkThreshold(metric, value) {
    const thresholdMap = {
      'orders.processing_time': 'orderProcessingTime',
      'batches.processing_time': 'batchProcessingTime',
      'websocket.latency': 'wsLatency',
      'redis.latency': 'redisLatency'
    };
    
    const thresholdKey = thresholdMap[metric];
    if (thresholdKey && value > this.config.alertThresholds[thresholdKey]) {
      this.emit('threshold_exceeded', {
        metric,
        value,
        threshold: this.config.alertThresholds[thresholdKey],
        timestamp: Date.now()
      });
    }
  }

  /**
   * Start monitoring loops
   */
  startMonitoring() {
    // System metrics every 5 seconds
    setInterval(() => {
      this.trackSystemMetrics();
    }, 5000);
    
    // Calculate throughput
    setInterval(() => {
      this.calculateThroughput();
    }, this.config.metricsInterval);
    
    // Generate reports every minute
    setInterval(() => {
      const report = this.generateReport();
      this.emit('report', report);
      
      // Log recommendations
      if (report.recommendations.length > 0) {
        console.log('Performance Recommendations:');
        report.recommendations.forEach(rec => {
          console.log(`[${rec.severity.toUpperCase()}] ${rec.message}`);
          console.log(`  → ${rec.suggestion}`);
        });
      }
    }, 60000);
  }

  /**
   * Export metrics for external monitoring
   */
  exportMetrics() {
    return {
      timestamp: Date.now(),
      ...this.metrics
    };
  }

  /**
   * Reset metrics
   */
  resetMetrics() {
    this.metrics.orders.processingTimes = [];
    this.metrics.batches.size = [];
    this.metrics.batches.processingTimes = [];
    this.metrics.websocket.latencies = [];
    this.metrics.redis.latencies = [];
  }

  /**
   * Shutdown monitoring
   */
  shutdown() {
    this.statsd.close();
    this.removeAllListeners();
  }
}

module.exports = PerformanceMonitor;