const EventEmitter = require('events');
const { performance } = require('perf_hooks');
const Redis = require('redis');
const { promisify } = require('util');

class MetricsCollector extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      redisUrl: config.redisUrl || process.env.REDIS_URL || 'redis://localhost:6379',
      retentionPeriod: config.retentionPeriod || 86400 * 7, // 7 days
      aggregationIntervals: config.aggregationIntervals || [60, 300, 900, 3600], // 1m, 5m, 15m, 1h
      ...config
    };

    this.redis = null;
    this.metrics = new Map();
    this.timers = new Map();
    this.counters = new Map();
    this.gauges = new Map();
    this.histograms = new Map();
  }

  async initialize() {
    // Initialize Redis connection
    this.redis = Redis.createClient({ url: this.config.redisUrl });
    
    this.redis.on('error', (err) => {
      console.error('Redis error:', err);
      this.emit('error', err);
    });

    await this.redis.connect();
    
    // Promisify Redis methods
    this.redisGet = promisify(this.redis.get).bind(this.redis);
    this.redisSet = promisify(this.redis.set).bind(this.redis);
    this.redisIncr = promisify(this.redis.incr).bind(this.redis);
    this.redisZadd = promisify(this.redis.zadd).bind(this.redis);
    
    console.log('✅ Metrics collector initialized');
  }

  // Timer metrics (for latency tracking)
  startTimer(name, labels = {}) {
    const key = this.getMetricKey(name, labels);
    this.timers.set(key, performance.now());
    return key;
  }

  endTimer(timerKey) {
    const startTime = this.timers.get(timerKey);
    if (!startTime) {
      console.warn(`Timer ${timerKey} not found`);
      return null;
    }

    const duration = performance.now() - startTime;
    this.timers.delete(timerKey);
    
    // Record in histogram
    this.recordHistogram(timerKey, duration);
    
    return duration;
  }

  // Counter metrics (for counting events)
  async incrementCounter(name, value = 1, labels = {}) {
    const key = this.getMetricKey(name, labels);
    
    // Update in-memory counter
    const current = this.counters.get(key) || 0;
    this.counters.set(key, current + value);
    
    // Update in Redis
    await this.redis.incrBy(`counter:${key}`, value);
    
    // Emit event for real-time updates
    this.emit('counter', { name, value: current + value, labels });
    
    return current + value;
  }

  // Gauge metrics (for current values)
  async setGauge(name, value, labels = {}) {
    const key = this.getMetricKey(name, labels);
    
    // Update in-memory gauge
    this.gauges.set(key, value);
    
    // Update in Redis with timestamp
    const timestamp = Date.now();
    await this.redis.zAdd(`gauge:${key}`, {
      score: timestamp,
      value: JSON.stringify({ value, timestamp })
    });
    
    // Cleanup old data
    const cutoff = timestamp - (this.config.retentionPeriod * 1000);
    await this.redis.zRemRangeByScore(`gauge:${key}`, 0, cutoff);
    
    // Emit event for real-time updates
    this.emit('gauge', { name, value, labels });
    
    return value;
  }

  // Histogram metrics (for distributions)
  async recordHistogram(name, value, labels = {}) {
    const key = this.getMetricKey(name, labels);
    
    // Update in-memory histogram
    if (!this.histograms.has(key)) {
      this.histograms.set(key, []);
    }
    this.histograms.get(key).push(value);
    
    // Keep only recent values in memory (last 1000)
    if (this.histograms.get(key).length > 1000) {
      this.histograms.get(key).shift();
    }
    
    // Store in Redis time series
    const timestamp = Date.now();
    await this.redis.zAdd(`histogram:${key}`, {
      score: timestamp,
      value: JSON.stringify({ value, timestamp })
    });
    
    // Calculate and store percentiles
    await this.updateHistogramStats(key);
    
    // Emit event for real-time updates
    this.emit('histogram', { name, value, labels });
  }

  // Calculate histogram statistics
  async updateHistogramStats(key) {
    const values = this.histograms.get(key) || [];
    if (values.length === 0) return;
    
    const sorted = [...values].sort((a, b) => a - b);
    const stats = {
      count: sorted.length,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
      p50: this.percentile(sorted, 0.5),
      p75: this.percentile(sorted, 0.75),
      p90: this.percentile(sorted, 0.9),
      p95: this.percentile(sorted, 0.95),
      p99: this.percentile(sorted, 0.99)
    };
    
    await this.redis.set(`histogram:${key}:stats`, JSON.stringify(stats), {
      EX: this.config.retentionPeriod
    });
    
    return stats;
  }

  // Helper to calculate percentile
  percentile(sortedArray, p) {
    const index = Math.ceil(sortedArray.length * p) - 1;
    return sortedArray[Math.max(0, index)];
  }

  // Get metric key with labels
  getMetricKey(name, labels = {}) {
    const labelStr = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${v}`)
      .join(',');
    
    return labelStr ? `${name}{${labelStr}}` : name;
  }

  // Get current metrics snapshot
  async getSnapshot() {
    const snapshot = {
      timestamp: Date.now(),
      counters: {},
      gauges: {},
      histograms: {}
    };
    
    // Get all counters
    for (const [key, value] of this.counters) {
      snapshot.counters[key] = value;
    }
    
    // Get all gauges
    for (const [key, value] of this.gauges) {
      snapshot.gauges[key] = value;
    }
    
    // Get histogram stats
    for (const [key, values] of this.histograms) {
      const stats = await this.updateHistogramStats(key);
      snapshot.histograms[key] = stats;
    }
    
    return snapshot;
  }

  // Get time series data for a metric
  async getTimeSeries(metricType, metricName, startTime, endTime, labels = {}) {
    const key = this.getMetricKey(metricName, labels);
    const redisKey = `${metricType}:${key}`;
    
    const data = await this.redis.zRangeByScore(
      redisKey,
      startTime,
      endTime,
      { WITHSCORES: true }
    );
    
    // Parse and format data
    const series = [];
    for (let i = 0; i < data.length; i += 2) {
      try {
        const value = JSON.parse(data[i]);
        series.push({
          timestamp: parseInt(data[i + 1]),
          value: value.value
        });
      } catch (e) {
        console.error('Failed to parse metric data:', e);
      }
    }
    
    return series;
  }

  // Aggregate metrics over time intervals
  async aggregateMetrics(metricType, metricName, interval, aggregationFn = 'avg') {
    const now = Date.now();
    const startTime = now - (interval * 1000);
    
    const timeSeries = await this.getTimeSeries(
      metricType,
      metricName,
      startTime,
      now
    );
    
    if (timeSeries.length === 0) return null;
    
    const values = timeSeries.map(point => point.value);
    
    switch (aggregationFn) {
      case 'sum':
        return values.reduce((a, b) => a + b, 0);
      case 'avg':
        return values.reduce((a, b) => a + b, 0) / values.length;
      case 'min':
        return Math.min(...values);
      case 'max':
        return Math.max(...values);
      case 'count':
        return values.length;
      default:
        throw new Error(`Unknown aggregation function: ${aggregationFn}`);
    }
  }

  // Clean up old metrics
  async cleanup() {
    const now = Date.now();
    const cutoff = now - (this.config.retentionPeriod * 1000);
    
    // Get all metric keys
    const keys = await this.redis.keys('*');
    
    for (const key of keys) {
      if (key.startsWith('gauge:') || key.startsWith('histogram:')) {
        await this.redis.zRemRangeByScore(key, 0, cutoff);
      }
    }
    
    console.log('✅ Metrics cleanup completed');
  }

  // Close connections
  async close() {
    if (this.redis) {
      await this.redis.quit();
    }
  }
}

// Singleton instance
let metricsCollector = null;

function getMetricsCollector(config) {
  if (!metricsCollector) {
    metricsCollector = new MetricsCollector(config);
  }
  return metricsCollector;
}

module.exports = {
  MetricsCollector,
  getMetricsCollector
};