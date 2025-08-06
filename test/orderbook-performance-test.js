const OrderBookManager = require('../lib/orderbook/OrderBookManager');
const { performance } = require('perf_hooks');

/**
 * Performance test for order book system
 * Tests throughput, latency, and scalability
 */
class OrderBookPerformanceTest {
  constructor() {
    this.manager = null;
    this.results = {
      orders: [],
      batches: [],
      snapshots: [],
      errors: 0
    };
  }

  async setup() {
    console.log('Setting up Order Book Manager for performance testing...');
    
    this.manager = new OrderBookManager({
      pairs: ['BTC-USD', 'ETH-USD'],
      redis: {
        host: 'localhost',
        port: 6379,
        enableOfflineQueue: false
      },
      websocket: {
        port: 8081,
        jwtSecret: 'test-secret'
      },
      performance: {
        alertThresholds: {
          orderProcessingTime: 100,
          batchProcessingTime: 500
        }
      }
    });

    await this.manager.initialize();
    console.log('Setup complete');
  }

  /**
   * Test single order processing performance
   */
  async testSingleOrderPerformance(iterations = 1000) {
    console.log(`\nTesting single order performance (${iterations} orders)...`);
    
    const results = [];
    
    for (let i = 0; i < iterations; i++) {
      const order = this.generateRandomOrder('BTC-USD');
      const start = performance.now();
      
      try {
        await this.manager.submitOrder(order);
        const duration = performance.now() - start;
        results.push(duration);
      } catch (error) {
        this.results.errors++;
      }
      
      // Progress indicator
      if ((i + 1) % 100 === 0) {
        process.stdout.write(`\r${i + 1}/${iterations} orders processed`);
      }
    }
    
    console.log('\n');
    this.analyzeResults('Single Order Processing', results);
  }

  /**
   * Test batch processing performance
   */
  async testBatchPerformance(batchSize = 100, batches = 50) {
    console.log(`\nTesting batch performance (${batches} batches of ${batchSize} orders)...`);
    
    const results = [];
    
    for (let i = 0; i < batches; i++) {
      const orders = [];
      for (let j = 0; j < batchSize; j++) {
        orders.push(this.generateRandomOrder('ETH-USD'));
      }
      
      const start = performance.now();
      
      // Submit orders concurrently
      try {
        await Promise.all(orders.map(order => 
          this.manager.orderBook.addOrder(order)
        ));
        
        // Wait for batch processing
        await new Promise(resolve => setTimeout(resolve, 150));
        
        const duration = performance.now() - start;
        results.push({
          duration,
          throughput: (batchSize / duration) * 1000 // orders per second
        });
      } catch (error) {
        this.results.errors++;
      }
      
      process.stdout.write(`\r${i + 1}/${batches} batches processed`);
    }
    
    console.log('\n');
    this.analyzeBatchResults('Batch Processing', results);
  }

  /**
   * Test order book snapshot performance
   */
  async testSnapshotPerformance(iterations = 100) {
    console.log(`\nTesting snapshot performance (${iterations} snapshots)...`);
    
    // First, populate order book
    console.log('Populating order book...');
    for (let i = 0; i < 1000; i++) {
      await this.manager.submitOrder(this.generateRandomOrder('BTC-USD'));
    }
    
    const results = [];
    
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      
      try {
        await this.manager.getOrderBook('BTC-USD', 50);
        const duration = performance.now() - start;
        results.push(duration);
      } catch (error) {
        this.results.errors++;
      }
    }
    
    this.analyzeResults('Snapshot Generation', results);
  }

  /**
   * Test concurrent operations
   */
  async testConcurrentOperations(concurrency = 10, duration = 30000) {
    console.log(`\nTesting concurrent operations (${concurrency} concurrent clients for ${duration/1000}s)...`);
    
    const startTime = Date.now();
    const operations = [];
    let totalOperations = 0;
    
    // Create concurrent clients
    const clients = Array(concurrency).fill(null).map((_, index) => ({
      id: index,
      operations: 0,
      errors: 0
    }));
    
    // Run concurrent operations
    const clientPromises = clients.map(async (client) => {
      while (Date.now() - startTime < duration) {
        const operation = Math.random();
        
        try {
          if (operation < 0.7) {
            // 70% add orders
            await this.manager.submitOrder(this.generateRandomOrder('BTC-USD'));
          } else if (operation < 0.9) {
            // 20% get snapshots
            await this.manager.getOrderBook('BTC-USD', 20);
          } else {
            // 10% cancel orders (mock)
            await this.manager.orderBook.cancelOrder(
              `order-${Math.random()}`,
              'BTC-USD'
            );
          }
          
          client.operations++;
          totalOperations++;
        } catch (error) {
          client.errors++;
        }
        
        // Small delay to prevent overwhelming
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    });
    
    await Promise.all(clientPromises);
    
    const totalDuration = Date.now() - startTime;
    const throughput = (totalOperations / totalDuration) * 1000;
    
    console.log('\nConcurrent Operations Results:');
    console.log(`Total operations: ${totalOperations}`);
    console.log(`Duration: ${(totalDuration / 1000).toFixed(2)}s`);
    console.log(`Throughput: ${throughput.toFixed(2)} ops/sec`);
    console.log(`Errors: ${clients.reduce((sum, c) => sum + c.errors, 0)}`);
    
    // Show per-client stats
    console.log('\nPer-client statistics:');
    clients.forEach(client => {
      console.log(`Client ${client.id}: ${client.operations} ops, ${client.errors} errors`);
    });
  }

  /**
   * Test memory usage under load
   */
  async testMemoryUsage(orderCount = 100000) {
    console.log(`\nTesting memory usage with ${orderCount} orders...`);
    
    const initialMemory = process.memoryUsage();
    console.log('Initial memory:', this.formatMemory(initialMemory));
    
    // Add orders in batches
    const batchSize = 1000;
    const batches = Math.ceil(orderCount / batchSize);
    
    for (let i = 0; i < batches; i++) {
      const orders = [];
      for (let j = 0; j < batchSize && (i * batchSize + j) < orderCount; j++) {
        orders.push(this.generateRandomOrder('BTC-USD'));
      }
      
      await Promise.all(orders.map(order => 
        this.manager.orderBook.addOrder(order)
      ));
      
      process.stdout.write(`\r${Math.min((i + 1) * batchSize, orderCount)}/${orderCount} orders added`);
    }
    
    console.log('\n');
    
    const finalMemory = process.memoryUsage();
    console.log('Final memory:', this.formatMemory(finalMemory));
    console.log('Memory increase:', this.formatMemory({
      rss: finalMemory.rss - initialMemory.rss,
      heapTotal: finalMemory.heapTotal - initialMemory.heapTotal,
      heapUsed: finalMemory.heapUsed - initialMemory.heapUsed,
      external: finalMemory.external - initialMemory.external
    }));
    
    // Test cleanup
    console.log('\nTesting cleanup...');
    const cleaned = await this.manager.orderBook.cleanupFilledOrders('BTC-USD', 0);
    console.log(`Cleaned ${cleaned} orders`);
    
    // Force garbage collection if available
    if (global.gc) {
      global.gc();
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const afterGC = process.memoryUsage();
      console.log('Memory after GC:', this.formatMemory(afterGC));
    }
  }

  /**
   * Run all performance tests
   */
  async runAllTests() {
    console.log('Starting Order Book Performance Tests');
    console.log('=====================================');
    
    await this.setup();
    
    await this.testSingleOrderPerformance(1000);
    await this.testBatchPerformance(100, 50);
    await this.testSnapshotPerformance(100);
    await this.testConcurrentOperations(10, 30000);
    await this.testMemoryUsage(50000);
    
    console.log('\n\nPerformance Test Summary');
    console.log('========================');
    console.log(`Total errors: ${this.results.errors}`);
    
    // Get final statistics
    const stats = await this.manager.getStatistics();
    console.log('\nFinal System Statistics:');
    console.log(JSON.stringify(stats, null, 2));
  }

  // Helper methods

  generateRandomOrder(pair) {
    const side = Math.random() > 0.5 ? 'buy' : 'sell';
    const basePrice = pair === 'BTC-USD' ? 50000 : 3000;
    const priceVariation = basePrice * 0.1;
    
    return {
      id: `order-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      userId: `user-${Math.floor(Math.random() * 100)}`,
      pair,
      side,
      type: 'limit',
      price: basePrice + (Math.random() - 0.5) * priceVariation,
      amount: Math.random() * 10
    };
  }

  analyzeResults(testName, results) {
    if (results.length === 0) return;
    
    const sorted = results.sort((a, b) => a - b);
    const avg = results.reduce((a, b) => a + b, 0) / results.length;
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const p50 = sorted[Math.floor(results.length * 0.5)];
    const p95 = sorted[Math.floor(results.length * 0.95)];
    const p99 = sorted[Math.floor(results.length * 0.99)];
    
    console.log(`${testName} Results:`);
    console.log(`  Average: ${avg.toFixed(2)}ms`);
    console.log(`  Min: ${min.toFixed(2)}ms`);
    console.log(`  Max: ${max.toFixed(2)}ms`);
    console.log(`  P50: ${p50.toFixed(2)}ms`);
    console.log(`  P95: ${p95.toFixed(2)}ms`);
    console.log(`  P99: ${p99.toFixed(2)}ms`);
    console.log(`  Throughput: ${(1000 / avg).toFixed(2)} ops/sec`);
  }

  analyzeBatchResults(testName, results) {
    if (results.length === 0) return;
    
    const durations = results.map(r => r.duration);
    const throughputs = results.map(r => r.throughput);
    
    console.log(`${testName} Results:`);
    console.log(`  Avg Duration: ${(durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(2)}ms`);
    console.log(`  Avg Throughput: ${(throughputs.reduce((a, b) => a + b, 0) / throughputs.length).toFixed(2)} orders/sec`);
    console.log(`  Max Throughput: ${Math.max(...throughputs).toFixed(2)} orders/sec`);
  }

  formatMemory(mem) {
    return {
      rss: `${(mem.rss / 1024 / 1024).toFixed(2)} MB`,
      heapTotal: `${(mem.heapTotal / 1024 / 1024).toFixed(2)} MB`,
      heapUsed: `${(mem.heapUsed / 1024 / 1024).toFixed(2)} MB`,
      external: `${(mem.external / 1024 / 1024).toFixed(2)} MB`
    };
  }

  async cleanup() {
    if (this.manager) {
      await this.manager.shutdown();
    }
  }
}

// Run tests if executed directly
if (require.main === module) {
  const test = new OrderBookPerformanceTest();
  
  test.runAllTests()
    .then(() => {
      console.log('\nAll tests completed');
      return test.cleanup();
    })
    .catch(error => {
      console.error('Test failed:', error);
      return test.cleanup();
    })
    .then(() => {
      process.exit(0);
    });
}

module.exports = OrderBookPerformanceTest;