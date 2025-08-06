import { RedisMatchingEngine } from '../../src/services/matchingEngine/RedisMatchingEngine';
import { DatabaseMatchingEngine } from '../../src/services/matchingEngine/DatabaseMatchingEngine';
import {
  Order,
  OrderSide,
  OrderType,
  TimeInForce,
  MatchingEngineConfig,
} from '../../src/services/matchingEngine/types';
import { performance } from 'perf_hooks';
import { logger } from '../../src/utils/logger';

interface BenchmarkResult {
  engine: string;
  totalOrders: number;
  totalTime: number;
  ordersPerSecond: number;
  avgLatency: number;
  p95Latency: number;
  p99Latency: number;
  successRate: number;
  trades: number;
}

class OrderBookBenchmark {
  private config: MatchingEngineConfig = {
    tickSize: {
      'ETH/USDT': 0.01,
      'BTC/USDT': 0.01,
      'SOL/USDT': 0.001,
    },
    minOrderSize: {
      'ETH/USDT': 0.001,
      'BTC/USDT': 0.00001,
      'SOL/USDT': 0.01,
    },
    maxOrderSize: {
      'ETH/USDT': 10000,
      'BTC/USDT': 1000,
      'SOL/USDT': 100000,
    },
    takerFeeRate: 0.001,
    makerFeeRate: 0.0005,
  };

  private pairs = ['ETH/USDT', 'BTC/USDT', 'SOL/USDT'];
  private basePrices = {
    'ETH/USDT': 2000,
    'BTC/USDT': 45000,
    'SOL/USDT': 100,
  };

  async benchmarkEngine(
    engineType: 'redis' | 'database',
    orderCount: number,
    concurrency: number
  ): Promise<BenchmarkResult> {
    let engine: RedisMatchingEngine | DatabaseMatchingEngine;
    
    if (engineType === 'redis') {
      engine = new RedisMatchingEngine(this.config);
    } else {
      engine = new DatabaseMatchingEngine(this.config);
    }

    console.log(`\n🚀 Starting ${engineType} engine benchmark...`);
    console.log(`Orders: ${orderCount}, Concurrency: ${concurrency}`);

    try {
      await engine.initialize();
      
      const startTime = performance.now();
      const latencies: number[] = [];
      let successCount = 0;
      let tradeCount = 0;
      
      // Create order batches
      const batchSize = Math.ceil(orderCount / concurrency);
      const batches: Order[][] = [];
      
      for (let i = 0; i < concurrency; i++) {
        const batch: Order[] = [];
        for (let j = 0; j < batchSize && (i * batchSize + j) < orderCount; j++) {
          batch.push(this.generateRandomOrder());
        }
        batches.push(batch);
      }
      
      // Process batches concurrently
      const batchPromises = batches.map(async (batch, batchIndex) => {
        const results = [];
        for (const order of batch) {
          const orderStart = performance.now();
          
          try {
            const result = await engine.submitOrder(order);
            const orderEnd = performance.now();
            const latency = orderEnd - orderStart;
            
            latencies.push(latency);
            successCount++;
            tradeCount += result.trades.length;
            
            results.push({ success: true, latency, trades: result.trades.length });
          } catch (error) {
            const orderEnd = performance.now();
            const latency = orderEnd - orderStart;
            latencies.push(latency);
            
            results.push({ success: false, latency, error });
          }
        }
        
        return results;
      });
      
      await Promise.all(batchPromises);
      
      const endTime = performance.now();
      const totalTime = endTime - startTime;
      
      // Calculate statistics
      latencies.sort((a, b) => a - b);
      const avgLatency = latencies.reduce((sum, lat) => sum + lat, 0) / latencies.length;
      const p95Index = Math.floor(latencies.length * 0.95);
      const p99Index = Math.floor(latencies.length * 0.99);
      
      const result: BenchmarkResult = {
        engine: engineType,
        totalOrders: orderCount,
        totalTime: totalTime / 1000, // Convert to seconds
        ordersPerSecond: orderCount / (totalTime / 1000),
        avgLatency,
        p95Latency: latencies[p95Index] || 0,
        p99Latency: latencies[p99Index] || 0,
        successRate: (successCount / orderCount) * 100,
        trades: tradeCount,
      };
      
      return result;
    } finally {
      await engine.shutdown();
    }
  }

  private generateRandomOrder(): Partial<Order> {
    const pair = this.pairs[Math.floor(Math.random() * this.pairs.length)];
    const side = Math.random() > 0.5 ? OrderSide.BUY : OrderSide.SELL;
    const type = Math.random() > 0.2 ? OrderType.LIMIT : OrderType.MARKET;
    const basePrice = this.basePrices[pair];
    
    // Generate price around base price with ±5% variation
    const priceVariation = 0.05;
    const price = type === OrderType.LIMIT 
      ? basePrice * (1 + (Math.random() - 0.5) * priceVariation)
      : 0;
    
    // Round to tick size
    const tickSize = this.config.tickSize[pair];
    const roundedPrice = Math.round(price / tickSize) * tickSize;
    
    return {
      userId: `user-${Math.floor(Math.random() * 1000)}`,
      pair,
      side,
      type,
      price: roundedPrice,
      quantity: Math.random() * 10 + 0.1,
      timeInForce: TimeInForce.GTC,
      clientOrderId: `bench-${Date.now()}-${Math.random()}`,
    };
  }

  async runFullBenchmark(): Promise<void> {
    console.log('🔥 High-Frequency Trading Order Book Benchmark\n');
    
    const testCases = [
      { orders: 1000, concurrency: 10 },
      { orders: 5000, concurrency: 50 },
      { orders: 10000, concurrency: 100 },
      { orders: 20000, concurrency: 200 },
    ];
    
    const results: BenchmarkResult[] = [];
    
    // Warm up
    console.log('Warming up...');
    await this.benchmarkEngine('redis', 100, 10);
    
    for (const testCase of testCases) {
      console.log(`\n📊 Test Case: ${testCase.orders} orders, ${testCase.concurrency} concurrent`);
      
      // Redis benchmark
      const redisResult = await this.benchmarkEngine('redis', testCase.orders, testCase.concurrency);
      results.push(redisResult);
      this.printResult(redisResult);
      
      // Small delay between tests
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Database benchmark (for comparison, only for smaller tests)
      if (testCase.orders <= 5000) {
        const dbResult = await this.benchmarkEngine('database', testCase.orders, testCase.concurrency);
        results.push(dbResult);
        this.printResult(dbResult);
      }
    }
    
    this.printSummary(results);
  }

  private printResult(result: BenchmarkResult): void {
    console.log(`
╔═══════════════════════════════════════════╗
║ ${result.engine.toUpperCase()} Engine Results              ║
╠═══════════════════════════════════════════╣
║ Total Orders:     ${result.totalOrders.toString().padEnd(23)} ║
║ Total Time:       ${result.totalTime.toFixed(2)}s${' '.repeat(20 - result.totalTime.toFixed(2).length)} ║
║ Orders/Second:    ${result.ordersPerSecond.toFixed(0).padEnd(23)} ║
║ Avg Latency:      ${result.avgLatency.toFixed(2)}ms${' '.repeat(19 - result.avgLatency.toFixed(2).length)} ║
║ P95 Latency:      ${result.p95Latency.toFixed(2)}ms${' '.repeat(19 - result.p95Latency.toFixed(2).length)} ║
║ P99 Latency:      ${result.p99Latency.toFixed(2)}ms${' '.repeat(19 - result.p99Latency.toFixed(2).length)} ║
║ Success Rate:     ${result.successRate.toFixed(1)}%${' '.repeat(20 - result.successRate.toFixed(1).length)} ║
║ Trades Executed:  ${result.trades.toString().padEnd(23)} ║
╚═══════════════════════════════════════════╝`);
  }

  private printSummary(results: BenchmarkResult[]): void {
    console.log('\n\n📈 BENCHMARK SUMMARY\n');
    console.log('Engine\tOrders\tOps/Sec\tAvg(ms)\tP95(ms)\tP99(ms)\tTrades');
    console.log('═══════════════════════════════════════════════════════════════');
    
    for (const result of results) {
      console.log(
        `${result.engine}\t${result.totalOrders}\t${result.ordersPerSecond.toFixed(0)}\t` +
        `${result.avgLatency.toFixed(2)}\t${result.p95Latency.toFixed(2)}\t` +
        `${result.p99Latency.toFixed(2)}\t${result.trades}`
      );
    }
    
    // Find best performer
    const redisResults = results.filter(r => r.engine === 'redis');
    const bestRedis = redisResults.reduce((best, current) => 
      current.ordersPerSecond > best.ordersPerSecond ? current : best
    );
    
    console.log(`\n🏆 Best Redis Performance: ${bestRedis.ordersPerSecond.toFixed(0)} orders/second`);
    
    if (bestRedis.ordersPerSecond >= 10000) {
      console.log('✅ Target of 10,000+ orders/second ACHIEVED!');
    } else {
      console.log(`⚠️  Current max: ${bestRedis.ordersPerSecond.toFixed(0)} orders/second`);
      console.log('   Consider: More Redis nodes, connection pooling, or hardware upgrade');
    }
  }
}

// Run benchmark
if (require.main === module) {
  const benchmark = new OrderBookBenchmark();
  
  benchmark.runFullBenchmark()
    .then(() => {
      console.log('\n✅ Benchmark completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Benchmark failed:', error);
      process.exit(1);
    });
}