/**
 * API Performance Monitor
 * Tracks response times, throughput, and performance under load
 */

const { getMetricsCollector } = require('./metrics-collector');
const EventEmitter = require('events');

class APIPerformanceMonitor extends EventEmitter {
  constructor(config = {}) {
    super();
    this.metrics = getMetricsCollector();
    this.config = {
      // Performance thresholds
      thresholds: {
        responseTime: {
          excellent: 50,    // <50ms
          good: 200,        // <200ms
          acceptable: 500,  // <500ms
          poor: 1000        // <1000ms
        },
        throughput: {
          min: 100,         // requests per second
          target: 1000      // target RPS
        },
        errorRate: {
          warning: 0.01,    // 1%
          critical: 0.05    // 5%
        },
        concurrency: {
          low: 10,
          medium: 100,
          high: 500
        }
      },
      // Monitoring windows
      windows: {
        realtime: 1000,     // 1 second
        shortTerm: 60000,   // 1 minute
        longTerm: 3600000   // 1 hour
      },
      ...config
    };

    // Performance tracking
    this.performance = {
      requests: [],
      endpoints: new Map(),
      concurrentRequests: 0,
      peakConcurrency: 0,
      totalRequests: 0,
      totalErrors: 0
    };

    // Response time percentiles
    this.percentiles = {
      p50: 0,
      p75: 0,
      p90: 0,
      p95: 0,
      p99: 0,
      p999: 0
    };

    // Load testing metrics
    this.loadMetrics = {
      isUnderLoad: false,
      loadStartTime: null,
      sustainedLoad: false,
      degradationDetected: false
    };

    this.initialize();
  }

  initialize() {
    // Start periodic calculations
    this.startPeriodicCalculations();
    
    // Start load detection
    this.startLoadDetection();
    
    console.log('🚀 API Performance Monitor initialized');
  }

  /**
   * Track API request
   */
  trackRequest(requestData) {
    const {
      method,
      endpoint,
      startTime,
      endTime,
      statusCode,
      responseSize,
      userId,
      error
    } = requestData;

    const responseTime = endTime - startTime;
    const timestamp = Date.now();

    // Store request data
    const request = {
      method,
      endpoint,
      responseTime,
      statusCode,
      responseSize,
      userId,
      error: error || null,
      timestamp,
      concurrency: this.performance.concurrentRequests
    };

    this.performance.requests.push(request);
    this.performance.totalRequests++;

    if (error || statusCode >= 400) {
      this.performance.totalErrors++;
    }

    // Keep only last hour of data
    const oneHour = 3600000;
    this.performance.requests = this.performance.requests
      .filter(req => timestamp - req.timestamp < oneHour);

    // Update endpoint-specific metrics
    this.updateEndpointMetrics(endpoint, request);

    // Record metrics
    this.recordMetrics(request);

    // Check for performance issues
    this.checkPerformanceThresholds(request);

    return request;
  }

  /**
   * Track concurrent request start
   */
  requestStarted() {
    this.performance.concurrentRequests++;
    if (this.performance.concurrentRequests > this.performance.peakConcurrency) {
      this.performance.peakConcurrency = this.performance.concurrentRequests;
    }
  }

  /**
   * Track concurrent request end
   */
  requestEnded() {
    this.performance.concurrentRequests = Math.max(0, this.performance.concurrentRequests - 1);
  }

  /**
   * Update endpoint-specific metrics
   */
  updateEndpointMetrics(endpoint, request) {
    if (!this.performance.endpoints.has(endpoint)) {
      this.performance.endpoints.set(endpoint, {
        totalRequests: 0,
        totalErrors: 0,
        responseTimes: [],
        avgResponseTime: 0,
        errorRate: 0
      });
    }

    const endpointMetrics = this.performance.endpoints.get(endpoint);
    endpointMetrics.totalRequests++;
    
    if (request.error || request.statusCode >= 400) {
      endpointMetrics.totalErrors++;
    }
    
    endpointMetrics.responseTimes.push(request.responseTime);
    
    // Keep only last 1000 samples per endpoint
    if (endpointMetrics.responseTimes.length > 1000) {
      endpointMetrics.responseTimes = endpointMetrics.responseTimes.slice(-500);
    }
    
    // Calculate averages
    endpointMetrics.avgResponseTime = endpointMetrics.responseTimes.reduce((a, b) => a + b, 0) / 
                                      endpointMetrics.responseTimes.length;
    endpointMetrics.errorRate = endpointMetrics.totalErrors / endpointMetrics.totalRequests;
  }

  /**
   * Record metrics to metrics collector
   */
  async recordMetrics(request) {
    const { method, endpoint, responseTime, statusCode, responseSize } = request;

    // Record response time histogram
    await this.metrics.recordHistogram('api.response_time', responseTime, {
      method,
      endpoint,
      status_code: statusCode.toString()
    });

    // Record request counter
    await this.metrics.incrementCounter('api.requests', 1, {
      method,
      endpoint,
      status_code: statusCode.toString(),
      status_class: this.getStatusClass(statusCode)
    });

    // Record response size
    if (responseSize) {
      await this.metrics.recordHistogram('api.response_size', responseSize, {
        method,
        endpoint
      });
    }

    // Record concurrent requests gauge
    await this.metrics.setGauge('api.concurrent_requests', this.performance.concurrentRequests);
    await this.metrics.setGauge('api.peak_concurrency', this.performance.peakConcurrency);

    // Record error if applicable
    if (request.error || statusCode >= 400) {
      await this.metrics.incrementCounter('api.errors', 1, {
        method,
        endpoint,
        status_code: statusCode.toString(),
        error_type: request.error?.type || 'http_error'
      });
    }
  }

  /**
   * Check performance against thresholds
   */
  checkPerformanceThresholds(request) {
    const { responseTime, endpoint, statusCode } = request;

    // Check response time thresholds
    if (responseTime > this.config.thresholds.responseTime.poor) {
      this.emit('alert', {
        type: 'slow_response',
        severity: 'high',
        endpoint,
        responseTime,
        threshold: this.config.thresholds.responseTime.poor,
        message: `Slow API response: ${responseTime}ms for ${endpoint}`
      });
    } else if (responseTime > this.config.thresholds.responseTime.acceptable) {
      this.emit('alert', {
        type: 'degraded_response',
        severity: 'medium',
        endpoint,
        responseTime,
        threshold: this.config.thresholds.responseTime.acceptable,
        message: `Degraded API response: ${responseTime}ms for ${endpoint}`
      });
    }

    // Check if under high load
    if (this.performance.concurrentRequests > this.config.thresholds.concurrency.high) {
      if (!this.loadMetrics.isUnderLoad) {
        this.loadMetrics.isUnderLoad = true;
        this.loadMetrics.loadStartTime = Date.now();
        
        this.emit('alert', {
          type: 'high_load_detected',
          severity: 'high',
          concurrentRequests: this.performance.concurrentRequests,
          threshold: this.config.thresholds.concurrency.high,
          message: `High load detected: ${this.performance.concurrentRequests} concurrent requests`
        });
      }
    }
  }

  /**
   * Start periodic calculations
   */
  startPeriodicCalculations() {
    // Calculate percentiles every 5 seconds
    this.percentileInterval = setInterval(() => {
      this.calculatePercentiles();
    }, 5000);

    // Calculate throughput every second
    this.throughputInterval = setInterval(() => {
      this.calculateThroughput();
    }, 1000);

    // Calculate error rates every minute
    this.errorRateInterval = setInterval(() => {
      this.calculateErrorRates();
    }, 60000);
  }

  /**
   * Calculate response time percentiles
   */
  calculatePercentiles() {
    const recentRequests = this.performance.requests
      .filter(req => Date.now() - req.timestamp < this.config.windows.shortTerm);

    if (recentRequests.length === 0) return;

    const responseTimes = recentRequests
      .map(req => req.responseTime)
      .sort((a, b) => a - b);

    this.percentiles.p50 = this.getPercentile(responseTimes, 0.5);
    this.percentiles.p75 = this.getPercentile(responseTimes, 0.75);
    this.percentiles.p90 = this.getPercentile(responseTimes, 0.9);
    this.percentiles.p95 = this.getPercentile(responseTimes, 0.95);
    this.percentiles.p99 = this.getPercentile(responseTimes, 0.99);
    this.percentiles.p999 = this.getPercentile(responseTimes, 0.999);

    // Record percentiles
    this.metrics.setGauge('api.response_time.p50', this.percentiles.p50);
    this.metrics.setGauge('api.response_time.p75', this.percentiles.p75);
    this.metrics.setGauge('api.response_time.p90', this.percentiles.p90);
    this.metrics.setGauge('api.response_time.p95', this.percentiles.p95);
    this.metrics.setGauge('api.response_time.p99', this.percentiles.p99);
    this.metrics.setGauge('api.response_time.p999', this.percentiles.p999);
  }

  /**
   * Calculate throughput metrics
   */
  calculateThroughput() {
    const now = Date.now();
    
    // Calculate requests per second (last 10 seconds)
    const recentRequests = this.performance.requests
      .filter(req => now - req.timestamp < 10000);
    const rps = recentRequests.length / 10;

    // Calculate requests per minute
    const lastMinuteRequests = this.performance.requests
      .filter(req => now - req.timestamp < 60000);
    const rpm = lastMinuteRequests.length;

    // Record throughput metrics
    this.metrics.setGauge('api.throughput.rps', rps);
    this.metrics.setGauge('api.throughput.rpm', rpm);

    // Check throughput thresholds
    if (rps < this.config.thresholds.throughput.min && this.loadMetrics.isUnderLoad) {
      this.emit('alert', {
        type: 'low_throughput_under_load',
        severity: 'critical',
        currentRPS: rps,
        threshold: this.config.thresholds.throughput.min,
        message: `Low throughput under load: ${rps.toFixed(2)} RPS`
      });
    }
  }

  /**
   * Calculate error rates
   */
  calculateErrorRates() {
    const recentRequests = this.performance.requests
      .filter(req => Date.now() - req.timestamp < this.config.windows.shortTerm);

    if (recentRequests.length === 0) return;

    const errors = recentRequests.filter(req => req.error || req.statusCode >= 400);
    const errorRate = errors.length / recentRequests.length;

    // Record error rate
    this.metrics.setGauge('api.error_rate', errorRate);

    // Check error rate thresholds
    if (errorRate > this.config.thresholds.errorRate.critical) {
      this.emit('alert', {
        type: 'high_error_rate',
        severity: 'critical',
        errorRate: errorRate * 100,
        threshold: this.config.thresholds.errorRate.critical * 100,
        message: `Critical error rate: ${(errorRate * 100).toFixed(2)}%`
      });
    } else if (errorRate > this.config.thresholds.errorRate.warning) {
      this.emit('alert', {
        type: 'elevated_error_rate',
        severity: 'warning',
        errorRate: errorRate * 100,
        threshold: this.config.thresholds.errorRate.warning * 100,
        message: `Elevated error rate: ${(errorRate * 100).toFixed(2)}%`
      });
    }
  }

  /**
   * Start load detection
   */
  startLoadDetection() {
    this.loadDetectionInterval = setInterval(() => {
      const now = Date.now();
      
      // Check if still under load
      if (this.loadMetrics.isUnderLoad) {
        if (this.performance.concurrentRequests < this.config.thresholds.concurrency.medium) {
          this.loadMetrics.isUnderLoad = false;
          const loadDuration = now - this.loadMetrics.loadStartTime;
          
          this.emit('alert', {
            type: 'load_normalized',
            severity: 'info',
            duration: loadDuration,
            message: `Load normalized after ${(loadDuration / 1000).toFixed(1)} seconds`
          });
        } else if (now - this.loadMetrics.loadStartTime > 300000) { // 5 minutes
          if (!this.loadMetrics.sustainedLoad) {
            this.loadMetrics.sustainedLoad = true;
            
            this.emit('alert', {
              type: 'sustained_high_load',
              severity: 'critical',
              duration: 300000,
              concurrentRequests: this.performance.concurrentRequests,
              message: 'Sustained high load detected for over 5 minutes'
            });
          }
        }
      }
      
      // Check for performance degradation under load
      if (this.loadMetrics.isUnderLoad && this.percentiles.p95 > this.config.thresholds.responseTime.acceptable) {
        if (!this.loadMetrics.degradationDetected) {
          this.loadMetrics.degradationDetected = true;
          
          this.emit('alert', {
            type: 'performance_degradation',
            severity: 'high',
            p95ResponseTime: this.percentiles.p95,
            concurrentRequests: this.performance.concurrentRequests,
            message: `Performance degradation under load: P95 ${this.percentiles.p95}ms`
          });
        }
      } else {
        this.loadMetrics.degradationDetected = false;
      }
    }, 10000); // Check every 10 seconds
  }

  /**
   * Get performance report
   */
  getPerformanceReport() {
    const now = Date.now();
    const lastMinuteRequests = this.performance.requests
      .filter(req => now - req.timestamp < 60000);
    const lastHourRequests = this.performance.requests;

    // Calculate statistics
    const calculateStats = (requests) => {
      if (requests.length === 0) {
        return {
          count: 0,
          avgResponseTime: 0,
          errorRate: 0,
          throughput: 0
        };
      }

      const errors = requests.filter(req => req.error || req.statusCode >= 400);
      const responseTimes = requests.map(req => req.responseTime);
      
      return {
        count: requests.length,
        avgResponseTime: responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length,
        errorRate: errors.length / requests.length,
        throughput: requests.length / ((now - requests[0].timestamp) / 1000)
      };
    };

    const lastMinuteStats = calculateStats(lastMinuteRequests);
    const lastHourStats = calculateStats(lastHourRequests);

    // Get endpoint statistics
    const endpointStats = Array.from(this.performance.endpoints.entries())
      .map(([endpoint, metrics]) => ({
        endpoint,
        ...metrics
      }))
      .sort((a, b) => b.totalRequests - a.totalRequests)
      .slice(0, 10); // Top 10 endpoints

    return {
      summary: {
        totalRequests: this.performance.totalRequests,
        totalErrors: this.performance.totalErrors,
        overallErrorRate: this.performance.totalRequests > 0 ? 
          this.performance.totalErrors / this.performance.totalRequests : 0,
        currentConcurrency: this.performance.concurrentRequests,
        peakConcurrency: this.performance.peakConcurrency
      },
      percentiles: this.percentiles,
      lastMinute: lastMinuteStats,
      lastHour: lastHourStats,
      loadStatus: {
        isUnderLoad: this.loadMetrics.isUnderLoad,
        sustainedLoad: this.loadMetrics.sustainedLoad,
        degradationDetected: this.loadMetrics.degradationDetected,
        loadDuration: this.loadMetrics.isUnderLoad ? 
          now - this.loadMetrics.loadStartTime : 0
      },
      topEndpoints: endpointStats,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Get load test metrics
   */
  getLoadTestMetrics() {
    const report = this.getPerformanceReport();
    
    return {
      throughput: {
        current: report.lastMinute.throughput,
        peak: this.performance.peakConcurrency,
        sustained: report.lastHour.throughput
      },
      latency: {
        p50: this.percentiles.p50,
        p95: this.percentiles.p95,
        p99: this.percentiles.p99,
        average: report.lastMinute.avgResponseTime
      },
      errors: {
        rate: report.lastMinute.errorRate * 100,
        total: report.summary.totalErrors
      },
      concurrency: {
        current: report.summary.currentConcurrency,
        peak: report.summary.peakConcurrency
      },
      degradation: {
        detected: report.loadStatus.degradationDetected,
        sustainedLoad: report.loadStatus.sustainedLoad
      }
    };
  }

  /**
   * Utility functions
   */
  getPercentile(sortedArray, percentile) {
    if (sortedArray.length === 0) return 0;
    const index = Math.ceil(sortedArray.length * percentile) - 1;
    return sortedArray[Math.max(0, Math.min(index, sortedArray.length - 1))];
  }

  getStatusClass(statusCode) {
    if (statusCode < 200) return '1xx';
    if (statusCode < 300) return '2xx';
    if (statusCode < 400) return '3xx';
    if (statusCode < 500) return '4xx';
    return '5xx';
  }

  /**
   * Cleanup
   */
  stop() {
    clearInterval(this.percentileInterval);
    clearInterval(this.throughputInterval);
    clearInterval(this.errorRateInterval);
    clearInterval(this.loadDetectionInterval);
    
    console.log('🛑 API Performance Monitor stopped');
  }
}

module.exports = APIPerformanceMonitor;