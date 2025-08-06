const { getMetricsCollector } = require('./metrics-collector');
const { performance } = require('perf_hooks');
const os = require('os');

class PerformanceBenchmark {
  constructor(config = {}) {
    this.config = {
      warmupRuns: config.warmupRuns || 100,
      benchmarkRuns: config.benchmarkRuns || 1000,
      sampleSize: config.sampleSize || 100,
      reportInterval: config.reportInterval || 300000, // 5 minutes
      ...config
    };
    
    this.metrics = getMetricsCollector();
    this.results = new Map();
    this.baselines = new Map();
    this.systemInfo = this.collectSystemInfo();
  }

  collectSystemInfo() {
    return {
      platform: os.platform(),
      arch: os.arch(),
      cpus: os.cpus().length,
      cpuModel: os.cpus()[0]?.model || 'unknown',
      totalMemory: os.totalmem(),
      nodeVersion: process.version
    };
  }

  async runBenchmark(name, testFunction, options = {}) {
    console.log(`🏃 Running benchmark: ${name}`);
    
    const config = {
      ...this.config,
      ...options
    };
    
    // Warmup phase
    console.log(`Warming up (${config.warmupRuns} runs)...`);
    for (let i = 0; i < config.warmupRuns; i++) {
      await testFunction();
    }
    
    // Benchmark phase
    console.log(`Benchmarking (${config.benchmarkRuns} runs)...`);
    const measurements = [];
    const memoryUsage = [];
    
    for (let i = 0; i < config.benchmarkRuns; i++) {
      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }
      
      const startMemory = process.memoryUsage();
      const startTime = performance.now();
      
      await testFunction();
      
      const endTime = performance.now();
      const endMemory = process.memoryUsage();
      
      measurements.push(endTime - startTime);
      memoryUsage.push({
        heapUsed: endMemory.heapUsed - startMemory.heapUsed,
        external: endMemory.external - startMemory.external
      });
      
      // Progress indicator
      if ((i + 1) % 100 === 0) {
        process.stdout.write(`\r${i + 1}/${config.benchmarkRuns}`);
      }
    }
    
    console.log('\n✅ Benchmark complete');
    
    // Calculate statistics
    const stats = this.calculateStatistics(measurements, memoryUsage);
    
    // Store results
    this.results.set(name, {
      timestamp: Date.now(),
      stats,
      config,
      systemInfo: this.systemInfo
    });
    
    // Record metrics
    await this.recordBenchmarkMetrics(name, stats);
    
    // Compare with baseline
    const comparison = this.compareWithBaseline(name, stats);
    
    return {
      name,
      stats,
      comparison,
      summary: this.generateSummary(stats)
    };
  }

  calculateStatistics(measurements, memoryUsage) {
    const sorted = [...measurements].sort((a, b) => a - b);
    const n = sorted.length;
    
    // Time statistics
    const timeStats = {
      min: sorted[0],
      max: sorted[n - 1],
      mean: sorted.reduce((a, b) => a + b, 0) / n,
      median: sorted[Math.floor(n / 2)],
      p75: sorted[Math.floor(n * 0.75)],
      p90: sorted[Math.floor(n * 0.90)],
      p95: sorted[Math.floor(n * 0.95)],
      p99: sorted[Math.floor(n * 0.99)],
      stdDev: this.calculateStdDev(sorted)
    };
    
    // Memory statistics
    const heapUsages = memoryUsage.map(m => m.heapUsed);
    const memStats = {
      avgHeapUsed: heapUsages.reduce((a, b) => a + b, 0) / heapUsages.length,
      maxHeapUsed: Math.max(...heapUsages),
      minHeapUsed: Math.min(...heapUsages)
    };
    
    // Operations per second
    const opsPerSec = 1000 / timeStats.mean;
    
    return {
      time: timeStats,
      memory: memStats,
      throughput: {
        opsPerSecond: opsPerSec,
        opsPerMinute: opsPerSec * 60,
        opsPerHour: opsPerSec * 3600
      }
    };
  }

  calculateStdDev(values) {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    return Math.sqrt(variance);
  }

  async recordBenchmarkMetrics(name, stats) {
    // Record time metrics
    await this.metrics.recordHistogram(`benchmark.${name}.time`, stats.time.mean);
    await this.metrics.setGauge(`benchmark.${name}.p95`, stats.time.p95);
    await this.metrics.setGauge(`benchmark.${name}.p99`, stats.time.p99);
    
    // Record throughput
    await this.metrics.setGauge(`benchmark.${name}.ops_per_second`, stats.throughput.opsPerSecond);
    
    // Record memory metrics
    await this.metrics.setGauge(`benchmark.${name}.memory_avg`, stats.memory.avgHeapUsed);
  }

  compareWithBaseline(name, currentStats) {
    const baseline = this.baselines.get(name);
    if (!baseline) {
      return { status: 'no_baseline' };
    }
    
    const comparison = {
      status: 'compared',
      time: {
        mean: this.calculateChange(baseline.time.mean, currentStats.time.mean),
        p95: this.calculateChange(baseline.time.p95, currentStats.time.p95),
        p99: this.calculateChange(baseline.time.p99, currentStats.time.p99)
      },
      throughput: {
        opsPerSecond: this.calculateChange(
          baseline.throughput.opsPerSecond,
          currentStats.throughput.opsPerSecond
        )
      },
      memory: {
        avgHeapUsed: this.calculateChange(
          baseline.memory.avgHeapUsed,
          currentStats.memory.avgHeapUsed
        )
      }
    };
    
    // Determine if regression
    comparison.regression = comparison.time.mean.percent > 10 || // 10% slower
                           comparison.throughput.opsPerSecond.percent < -10; // 10% less throughput
    
    return comparison;
  }

  calculateChange(baseline, current) {
    const diff = current - baseline;
    const percent = (diff / baseline) * 100;
    
    return {
      baseline,
      current,
      diff,
      percent,
      improved: current < baseline // For time metrics, lower is better
    };
  }

  generateSummary(stats) {
    return `Mean: ${stats.time.mean.toFixed(2)}ms | ` +
           `P95: ${stats.time.p95.toFixed(2)}ms | ` +
           `P99: ${stats.time.p99.toFixed(2)}ms | ` +
           `Throughput: ${stats.throughput.opsPerSecond.toFixed(0)} ops/sec | ` +
           `Memory: ${(stats.memory.avgHeapUsed / 1024 / 1024).toFixed(2)}MB`;
  }

  setBaseline(name, stats = null) {
    if (stats) {
      this.baselines.set(name, stats);
    } else {
      // Use current results as baseline
      const current = this.results.get(name);
      if (current) {
        this.baselines.set(name, current.stats);
      }
    }
  }

  // Specific benchmarks for matching engine
  async benchmarkOrderMatching(matchingEngine, options = {}) {
    const orders = this.generateTestOrders(options.orderCount || 1000);
    let orderIndex = 0;
    
    return await this.runBenchmark('order_matching', async () => {
      const order = orders[orderIndex % orders.length];
      await matchingEngine.submitOrder(order);
      orderIndex++;
    }, options);
  }

  async benchmarkOrderBookOperations(orderBook, options = {}) {
    const benchmarks = {};
    
    // Benchmark insertions
    benchmarks.insertion = await this.runBenchmark('orderbook_insertion', async () => {
      const order = this.generateRandomOrder();
      orderBook.addOrder(order);
    }, { ...options, benchmarkRuns: options.benchmarkRuns || 10000 });
    
    // Benchmark lookups
    benchmarks.lookup = await this.runBenchmark('orderbook_lookup', async () => {
      orderBook.getBestBid('ETH/USDT');
      orderBook.getBestAsk('ETH/USDT');
    }, { ...options, benchmarkRuns: options.benchmarkRuns || 100000 });
    
    // Benchmark depth calculation
    benchmarks.depth = await this.runBenchmark('orderbook_depth', async () => {
      orderBook.getDepth('ETH/USDT', 10);
    }, { ...options, benchmarkRuns: options.benchmarkRuns || 10000 });
    
    return benchmarks;
  }

  async benchmarkSettlement(settlementEngine, options = {}) {
    const trades = this.generateTestTrades(options.tradeCount || 100);
    
    return await this.runBenchmark('settlement_batch', async () => {
      await settlementEngine.settleBatch(trades);
    }, { ...options, benchmarkRuns: options.benchmarkRuns || 100 });
  }

  async benchmarkConcurrency(matchingEngine, options = {}) {
    const concurrencyLevels = options.levels || [1, 10, 50, 100, 500];
    const results = {};
    
    for (const level of concurrencyLevels) {
      console.log(`\nTesting concurrency level: ${level}`);
      
      results[`concurrent_${level}`] = await this.runBenchmark(
        `concurrent_orders_${level}`,
        async () => {
          const promises = [];
          for (let i = 0; i < level; i++) {
            const order = this.generateRandomOrder();
            promises.push(matchingEngine.submitOrder(order));
          }
          await Promise.all(promises);
        },
        { ...options, benchmarkRuns: Math.floor(1000 / level) }
      );
    }
    
    return results;
  }

  // Stress testing
  async stressTest(target, options = {}) {
    const duration = options.duration || 60000; // 1 minute default
    const rampUpTime = options.rampUpTime || 10000; // 10 seconds
    const maxLoad = options.maxLoad || 10000; // Max operations per second
    
    console.log(`🔥 Starting stress test for ${duration}ms...`);
    
    const startTime = Date.now();
    const results = {
      totalOperations: 0,
      successfulOperations: 0,
      failedOperations: 0,
      errors: [],
      latencies: [],
      throughput: []
    };
    
    let currentLoad = 100; // Start with 100 ops/sec
    
    const stressInterval = setInterval(async () => {
      const elapsed = Date.now() - startTime;
      
      // Ramp up load
      if (elapsed < rampUpTime) {
        currentLoad = Math.floor((elapsed / rampUpTime) * maxLoad);
      } else {
        currentLoad = maxLoad;
      }
      
      // Execute operations
      const batchStart = performance.now();
      const promises = [];
      
      for (let i = 0; i < currentLoad / 10; i++) { // Divide by 10 for 100ms intervals
        promises.push(
          target().then(() => {
            results.successfulOperations++;
          }).catch(error => {
            results.failedOperations++;
            results.errors.push({
              timestamp: Date.now(),
              error: error.message
            });
          })
        );
      }
      
      await Promise.all(promises);
      const batchEnd = performance.now();
      
      results.totalOperations += promises.length;
      results.latencies.push(batchEnd - batchStart);
      results.throughput.push({
        timestamp: Date.now(),
        opsPerSecond: (promises.length / ((batchEnd - batchStart) / 1000))
      });
      
    }, 100); // Run every 100ms
    
    // Stop after duration
    setTimeout(() => {
      clearInterval(stressInterval);
      console.log('\n✅ Stress test complete');
      
      // Calculate summary
      const summary = {
        duration: Date.now() - startTime,
        totalOperations: results.totalOperations,
        successRate: results.successfulOperations / results.totalOperations,
        avgLatency: results.latencies.reduce((a, b) => a + b, 0) / results.latencies.length,
        maxThroughput: Math.max(...results.throughput.map(t => t.opsPerSecond)),
        errors: results.errors.length
      };
      
      results.summary = summary;
      
      // Record stress test metrics
      this.recordStressTestMetrics(results);
      
    }, duration);
    
    return new Promise(resolve => {
      setTimeout(() => resolve(results), duration + 1000);
    });
  }

  async recordStressTestMetrics(results) {
    await this.metrics.setGauge('stress_test.total_operations', results.totalOperations);
    await this.metrics.setGauge('stress_test.success_rate', results.summary.successRate);
    await this.metrics.setGauge('stress_test.avg_latency', results.summary.avgLatency);
    await this.metrics.setGauge('stress_test.max_throughput', results.summary.maxThroughput);
    await this.metrics.setGauge('stress_test.error_count', results.errors.length);
  }

  // Helper methods for generating test data
  generateTestOrders(count) {
    const orders = [];
    const pairs = ['ETH/USDT', 'BTC/USDT', 'SOL/USDT'];
    
    for (let i = 0; i < count; i++) {
      orders.push({
        id: `test-order-${i}`,
        userId: `user-${Math.floor(Math.random() * 100)}`,
        pair: pairs[Math.floor(Math.random() * pairs.length)],
        side: Math.random() > 0.5 ? 'buy' : 'sell',
        type: Math.random() > 0.8 ? 'market' : 'limit',
        price: 1000 + Math.random() * 100,
        volume: Math.random() * 10,
        timestamp: Date.now()
      });
    }
    
    return orders;
  }

  generateRandomOrder() {
    return this.generateTestOrders(1)[0];
  }

  generateTestTrades(count) {
    const trades = [];
    
    for (let i = 0; i < count; i++) {
      trades.push({
        id: `trade-${i}`,
        buyOrderId: `buy-${i}`,
        sellOrderId: `sell-${i}`,
        pair: 'ETH/USDT',
        price: 1000 + Math.random() * 100,
        volume: Math.random() * 10,
        timestamp: Date.now()
      });
    }
    
    return trades;
  }

  // Report generation
  generateReport() {
    const report = {
      timestamp: Date.now(),
      systemInfo: this.systemInfo,
      benchmarks: {},
      comparisons: {}
    };
    
    for (const [name, result] of this.results) {
      report.benchmarks[name] = {
        stats: result.stats,
        summary: this.generateSummary(result.stats)
      };
      
      const comparison = this.compareWithBaseline(name, result.stats);
      if (comparison.status === 'compared') {
        report.comparisons[name] = comparison;
      }
    }
    
    return report;
  }

  // Performance monitoring
  startContinuousMonitoring(tests, interval = 300000) { // 5 minutes default
    console.log('📊 Starting continuous performance monitoring...');
    
    this.monitoringInterval = setInterval(async () => {
      console.log('\n🔄 Running performance tests...');
      
      for (const test of tests) {
        try {
          const result = await test();
          
          // Check for regressions
          if (result.comparison && result.comparison.regression) {
            console.warn(`⚠️  Performance regression detected in ${result.name}`);
            this.metrics.emit('performance_regression', {
              test: result.name,
              comparison: result.comparison
            });
          }
        } catch (error) {
          console.error(`Failed to run test: ${error.message}`);
        }
      }
      
      // Generate and save report
      const report = this.generateReport();
      await this.metrics.setGauge('performance.last_run', Date.now());
      
    }, interval);
  }

  stopMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      console.log('📊 Performance monitoring stopped');
    }
  }
}

module.exports = PerformanceBenchmark;