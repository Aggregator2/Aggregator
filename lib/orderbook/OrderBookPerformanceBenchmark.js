/**
 * Order Book Performance Benchmark Suite
 * Tests and measures performance of Redis-based order book operations
 */

const { performance } = require('perf_hooks');
const OptimizedRedisOrderBook = require('./OptimizedRedisOrderBook');
const RedisConfigurationHelper = require('./RedisConfigurationHelper');

class OrderBookPerformanceBenchmark {
  constructor(config = {}) {
    this.config = {
      testDuration: config.testDuration || 60000, // 1 minute
      concurrentUsers: config.concurrentUsers || 100,
      ordersPerUser: config.ordersPerUser || 100,
      tradingPairs: config.tradingPairs || ['ETH-USDC', 'BTC-USDC', 'SOL-USDC'],
      priceRange: config.priceRange || { min: 0.9, max: 1.1 }, // ±10% from mid price
      orderSizeRange: config.orderSizeRange || { min: 0.1, max: 10 },
      ...config
    };
    
    this.results = {
      operations: {
        placeOrder: { count: 0, totalTime: 0, errors: 0 },
        cancelOrder: { count: 0, totalTime: 0, errors: 0 },
        getOrderBook: { count: 0, totalTime: 0, errors: 0 },
        matching: { count: 0, totalTime: 0, errors: 0 }
      },
      latencies: {
        placeOrder: [],
        cancelOrder: [],
        getOrderBook: [],
        matching: []
      },
      throughput: {
        ordersPerSecond: 0,
        matchesPerSecond: 0,
        operationsPerSecond: 0
      },
      pipelineMetrics: {
        flushes: 0,
        avgBatchSize: 0,
        totalOperations: 0
      },
      circuitBreakerMetrics: {
        trips: 0,
        successes: 0,
        failures: 0,
        fallbacks: 0
      }
    };
    
    this.orderBook = null;
    this.orders = new Map();
    this.startTime = null;
    this.endTime = null;
  }

  /**
   * Initialize benchmark environment
   */
  async initialize() {
    console.log('🚀 Initializing performance benchmark...\n');
    
    // Get optimized configuration
    const deploymentType = process.env.BENCHMARK_ENV || 'development';
    const config = RedisConfigurationHelper.getOptimizedConfig(deploymentType);
    
    // Create order book instance
    this.orderBook = new OptimizedRedisOrderBook(config);
    
    // Initialize trading pairs
    for (const pair of this.config.tradingPairs) {
      await this.orderBook.initializePair(pair, {
        baseAsset: pair.split('-')[0],
        quoteAsset: pair.split('-')[1],
        minPrice: 0.00001,
        maxPrice: 1000000,
        minAmount: 0.00001
      });
    }
    
    // Setup event listeners
    this.setupEventListeners();
    
    // Warm up connection pool
    await this.warmupConnections();
    
    console.log('✅ Benchmark environment ready\n');
  }

  /**
   * Setup event listeners for metrics collection
   */
  setupEventListeners() {
    this.orderBook.on('pipeline:flushed', (data) => {
      this.results.pipelineMetrics.flushes++;
      this.results.pipelineMetrics.totalOperations += data.operations;
    });
    
    this.orderBook.on('circuitBreaker:open', () => {
      this.results.circuitBreakerMetrics.trips++;
    });
    
    this.orderBook.on('batch:processed', (data) => {
      this.results.operations.matching.count += data.results.filter(r => r.success).length;
    });
  }

  /**
   * Warm up Redis connections
   */
  async warmupConnections() {
    console.log('🔥 Warming up connections...');
    
    const warmupOps = 100;
    const promises = [];
    
    for (let i = 0; i < warmupOps; i++) {
      promises.push(
        this.orderBook.getOrderBook(this.config.tradingPairs[0], 1)
      );
    }
    
    await Promise.all(promises);
    console.log('✅ Connections warmed up\n');
  }

  /**
   * Run the complete benchmark suite
   */
  async runBenchmark() {
    console.log('📊 Starting performance benchmark...\n');
    console.log('Configuration:');
    console.log(`  - Test Duration: ${this.config.testDuration / 1000}s`);
    console.log(`  - Concurrent Users: ${this.config.concurrentUsers}`);
    console.log(`  - Orders per User: ${this.config.ordersPerUser}`);
    console.log(`  - Trading Pairs: ${this.config.tradingPairs.join(', ')}`);
    console.log('\n');
    
    this.startTime = Date.now();
    
    try {
      // Run different test scenarios
      await this.runLoadTest();
      await this.runLatencyTest();
      await this.runThroughputTest();
      await this.runStressTest();
      
      this.endTime = Date.now();
      
      // Generate report
      return this.generateReport();
      
    } catch (error) {
      console.error('❌ Benchmark failed:', error);
      throw error;
    }
  }

  /**
   * Run load test with concurrent users
   */
  async runLoadTest() {
    console.log('🏃 Running load test...');
    
    const users = [];
    
    // Create concurrent users
    for (let i = 0; i < this.config.concurrentUsers; i++) {
      users.push(this.simulateUser(`user_${i}`));
    }
    
    // Wait for all users to complete
    await Promise.all(users);
    
    console.log('✅ Load test completed\n');
  }

  /**
   * Simulate a single user placing orders
   */
  async simulateUser(userId) {
    const operations = [];
    
    for (let i = 0; i < this.config.ordersPerUser; i++) {
      const pair = this.getRandomPair();
      const side = Math.random() > 0.5 ? 'buy' : 'sell';
      const basePrice = 1000; // Base price for calculations
      
      const order = {
        id: `${userId}_order_${i}_${Date.now()}`,
        userId,
        pair,
        side,
        price: this.getRandomPrice(basePrice),
        amount: this.getRandomAmount()
      };
      
      // Place order
      operations.push(this.measureOperation('placeOrder', async () => {
        await this.orderBook.placeOrder(order);
        this.orders.set(order.id, order);
      }));
      
      // Randomly cancel some orders
      if (Math.random() > 0.7 && this.orders.size > 0) {
        const orderToCancel = this.getRandomOrder();
        if (orderToCancel) {
          operations.push(this.measureOperation('cancelOrder', async () => {
            await this.orderBook.cancelOrder(orderToCancel.id, orderToCancel.pair);
            this.orders.delete(orderToCancel.id);
          }));
        }
      }
      
      // Get order book periodically
      if (i % 10 === 0) {
        operations.push(this.measureOperation('getOrderBook', async () => {
          await this.orderBook.getOrderBook(pair, 20);
        }));
      }
    }
    
    await Promise.all(operations);
  }

  /**
   * Run latency test for different operations
   */
  async runLatencyTest() {
    console.log('⏱️ Running latency test...');
    
    const operations = [
      // Single order placement
      { name: 'Single Order', count: 100, fn: async () => {
        const order = this.generateRandomOrder();
        await this.orderBook.placeOrder(order);
      }},
      
      // Batch order placement
      { name: 'Batch Orders (10)', count: 50, fn: async () => {
        const orders = Array(10).fill(null).map(() => ({
          type: 'add',
          ...this.generateRandomOrder()
        }));
        await this.orderBook.batchProcess(this.getRandomPair(), orders);
      }},
      
      // Order book retrieval
      { name: 'Get Order Book', count: 100, fn: async () => {
        await this.orderBook.getOrderBook(this.getRandomPair(), 50);
      }},
      
      // Matching execution
      { name: 'Execute Matching', count: 50, fn: async () => {
        await this.orderBook.executeMatching(this.getRandomPair(), 100);
      }}
    ];
    
    for (const op of operations) {
      const latencies = [];
      
      for (let i = 0; i < op.count; i++) {
        const start = performance.now();
        await op.fn();
        const latency = performance.now() - start;
        latencies.push(latency);
      }
      
      // Calculate statistics
      latencies.sort((a, b) => a - b);
      const stats = {
        min: latencies[0],
        max: latencies[latencies.length - 1],
        avg: latencies.reduce((a, b) => a + b) / latencies.length,
        p50: latencies[Math.floor(latencies.length * 0.5)],
        p95: latencies[Math.floor(latencies.length * 0.95)],
        p99: latencies[Math.floor(latencies.length * 0.99)]
      };
      
      console.log(`  ${op.name}:`);
      console.log(`    Min: ${stats.min.toFixed(2)}ms`);
      console.log(`    Avg: ${stats.avg.toFixed(2)}ms`);
      console.log(`    P50: ${stats.p50.toFixed(2)}ms`);
      console.log(`    P95: ${stats.p95.toFixed(2)}ms`);
      console.log(`    P99: ${stats.p99.toFixed(2)}ms`);
      console.log(`    Max: ${stats.max.toFixed(2)}ms\n`);
    }
    
    console.log('✅ Latency test completed\n');
  }

  /**
   * Run throughput test
   */
  async runThroughputTest() {
    console.log('📈 Running throughput test...');
    
    const duration = 10000; // 10 seconds
    const startTime = Date.now();
    let operations = 0;
    let matches = 0;
    
    // Generate continuous load
    const workers = Array(10).fill(null).map(async () => {
      while (Date.now() - startTime < duration) {
        const pair = this.getRandomPair();
        
        // Place buy and sell orders to create matches
        const buyOrder = {
          ...this.generateRandomOrder(),
          side: 'buy',
          pair
        };
        const sellOrder = {
          ...this.generateRandomOrder(),
          side: 'sell',
          pair,
          price: buyOrder.price // Same price for guaranteed match
        };
        
        await this.orderBook.placeOrder(buyOrder);
        await this.orderBook.placeOrder(sellOrder);
        operations += 2;
        
        // Execute matching
        const result = await this.orderBook.executeMatching(pair);
        matches += result.count;
        operations++;
      }
    });
    
    await Promise.all(workers);
    
    const actualDuration = (Date.now() - startTime) / 1000;
    const opsPerSecond = operations / actualDuration;
    const matchesPerSecond = matches / actualDuration;
    
    console.log(`  Operations/second: ${opsPerSecond.toFixed(2)}`);
    console.log(`  Matches/second: ${matchesPerSecond.toFixed(2)}`);
    console.log(`  Total operations: ${operations}`);
    console.log(`  Total matches: ${matches}`);
    
    this.results.throughput.operationsPerSecond = opsPerSecond;
    this.results.throughput.matchesPerSecond = matchesPerSecond;
    
    console.log('✅ Throughput test completed\n');
  }

  /**
   * Run stress test with extreme load
   */
  async runStressTest() {
    console.log('💥 Running stress test...');
    
    const stressDuration = 5000; // 5 seconds
    const startTime = Date.now();
    let completed = 0;
    let errors = 0;
    
    // Generate extreme load
    const promises = [];
    
    while (Date.now() - startTime < stressDuration) {
      promises.push(
        this.orderBook.placeOrder(this.generateRandomOrder())
          .then(() => completed++)
          .catch(() => errors++)
      );
      
      // Don't await, fire as fast as possible
      if (promises.length > 10000) {
        await Promise.all(promises);
        promises.length = 0;
      }
    }
    
    // Wait for remaining operations
    await Promise.all(promises);
    
    console.log(`  Completed: ${completed}`);
    console.log(`  Errors: ${errors}`);
    console.log(`  Error rate: ${((errors / (completed + errors)) * 100).toFixed(2)}%`);
    
    console.log('✅ Stress test completed\n');
  }

  /**
   * Measure operation performance
   */
  async measureOperation(type, operation) {
    const start = performance.now();
    
    try {
      await operation();
      const latency = performance.now() - start;
      
      this.results.operations[type].count++;
      this.results.operations[type].totalTime += latency;
      this.results.latencies[type].push(latency);
      
      // Keep only last 1000 latencies for memory efficiency
      if (this.results.latencies[type].length > 1000) {
        this.results.latencies[type] = this.results.latencies[type].slice(-1000);
      }
      
    } catch (error) {
      this.results.operations[type].errors++;
      throw error;
    }
  }

  /**
   * Generate performance report
   */
  generateReport() {
    const duration = (this.endTime - this.startTime) / 1000;
    
    // Calculate statistics for each operation type
    const operationStats = {};
    
    for (const [type, data] of Object.entries(this.results.operations)) {
      const latencies = this.results.latencies[type];
      if (latencies.length > 0) {
        latencies.sort((a, b) => a - b);
        operationStats[type] = {
          count: data.count,
          errors: data.errors,
          errorRate: (data.errors / (data.count + data.errors)) * 100,
          avgLatency: data.totalTime / data.count,
          minLatency: latencies[0],
          maxLatency: latencies[latencies.length - 1],
          p50: latencies[Math.floor(latencies.length * 0.5)],
          p95: latencies[Math.floor(latencies.length * 0.95)],
          p99: latencies[Math.floor(latencies.length * 0.99)],
          throughput: data.count / duration
        };
      }
    }
    
    // Get order book metrics
    const metrics = this.orderBook.metrics;
    
    return {
      summary: {
        duration: `${duration.toFixed(2)}s`,
        totalOperations: Object.values(this.results.operations).reduce((sum, op) => sum + op.count, 0),
        totalErrors: Object.values(this.results.operations).reduce((sum, op) => sum + op.errors, 0),
        overallThroughput: this.results.throughput.operationsPerSecond
      },
      operations: operationStats,
      throughput: this.results.throughput,
      pipeline: {
        flushes: metrics.pipelineFlushes,
        avgBatchSize: metrics.avgBatchSize,
        totalOperations: metrics.pipelineOperations
      },
      circuitBreaker: this.results.circuitBreakerMetrics,
      recommendations: this.generateRecommendations(operationStats)
    };
  }

  /**
   * Generate performance recommendations
   */
  generateRecommendations(stats) {
    const recommendations = [];
    
    // Check latency
    if (stats.placeOrder?.p95 > 50) {
      recommendations.push({
        type: 'latency',
        severity: 'high',
        message: 'Order placement P95 latency exceeds 50ms. Consider increasing pipeline batch size.'
      });
    }
    
    // Check error rates
    for (const [op, data] of Object.entries(stats)) {
      if (data.errorRate > 1) {
        recommendations.push({
          type: 'reliability',
          severity: 'critical',
          message: `${op} error rate is ${data.errorRate.toFixed(2)}%. Check circuit breaker configuration.`
        });
      }
    }
    
    // Check throughput
    if (this.results.throughput.operationsPerSecond < 1000) {
      recommendations.push({
        type: 'throughput',
        severity: 'medium',
        message: 'Throughput below 1000 ops/sec. Consider enabling Redis Cluster for scaling.'
      });
    }
    
    return recommendations;
  }

  /**
   * Utility methods
   */
  getRandomPair() {
    return this.config.tradingPairs[Math.floor(Math.random() * this.config.tradingPairs.length)];
  }
  
  getRandomPrice(basePrice) {
    const { min, max } = this.config.priceRange;
    return basePrice * (min + Math.random() * (max - min));
  }
  
  getRandomAmount() {
    const { min, max } = this.config.orderSizeRange;
    return min + Math.random() * (max - min);
  }
  
  generateRandomOrder() {
    return {
      id: `order_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      userId: `user_${Math.floor(Math.random() * this.config.concurrentUsers)}`,
      pair: this.getRandomPair(),
      side: Math.random() > 0.5 ? 'buy' : 'sell',
      price: this.getRandomPrice(1000),
      amount: this.getRandomAmount()
    };
  }
  
  getRandomOrder() {
    const orderArray = Array.from(this.orders.values());
    return orderArray[Math.floor(Math.random() * orderArray.length)];
  }

  /**
   * Cleanup after benchmark
   */
  async cleanup() {
    console.log('🧹 Cleaning up...');
    
    await this.orderBook.shutdown();
    
    console.log('✅ Cleanup completed');
  }
}

// Run benchmark if executed directly
if (require.main === module) {
  const benchmark = new OrderBookPerformanceBenchmark({
    testDuration: 30000, // 30 seconds
    concurrentUsers: 50,
    ordersPerUser: 100,
    tradingPairs: ['ETH-USDC', 'BTC-USDC']
  });
  
  benchmark.initialize()
    .then(() => benchmark.runBenchmark())
    .then(report => {
      console.log('\n📊 PERFORMANCE REPORT\n');
      console.log(JSON.stringify(report, null, 2));
      return benchmark.cleanup();
    })
    .catch(error => {
      console.error('Benchmark failed:', error);
      process.exit(1);
    });
}

module.exports = OrderBookPerformanceBenchmark;