import { MatchingEngine } from '../../src/services/matchingEngine/MatchingEngine';
import { FinalSettlementEngine } from '../../src/services/settlement/FinalSettlementEngine';
import { ethers } from 'ethers';
import {
  OrderType,
  OrderSide,
  OrderStatus,
  MatchingEngineConfig,
} from '../../src/services/matchingEngine/types';

interface PerformanceMetrics {
  orderSubmissionLatency: number[];
  matchingLatency: number[];
  settlementLatency: number[];
  throughput: {
    ordersPerSecond: number;
    tradesPerSecond: number;
    settlementsPerSecond: number;
  };
  errorRate: number;
  memoryUsage: {
    peak: number;
    average: number;
  };
}

export class TradingSystemStressTest {
  private matchingEngine: MatchingEngine;
  private settlementEngine: FinalSettlementEngine;
  private metrics: PerformanceMetrics;

  constructor() {
    const config: MatchingEngineConfig = {
      maxOrderBookDepth: 10000,
      minOrderSize: { 'ETH/USDC': 0.0001 },
      maxOrderSize: { 'ETH/USDC': 10000 },
      tickSize: { 'ETH/USDC': 0.01 },
      makerFeeRate: 0.001,
      takerFeeRate: 0.002,
      enableStopOrders: true,
      enableIcebergOrders: true,
    };

    this.matchingEngine = new MatchingEngine(config);
    this.matchingEngine.initializePair('ETH/USDC');

    const provider = new ethers.JsonRpcProvider('http://localhost:8545');
    const privateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
    
    this.settlementEngine = new FinalSettlementEngine(
      provider,
      privateKey,
      '0x5FbDB2315678afecb367f032d93F642f64180aa3',
      300000 // 5 minute epochs
    );

    this.metrics = {
      orderSubmissionLatency: [],
      matchingLatency: [],
      settlementLatency: [],
      throughput: {
        ordersPerSecond: 0,
        tradesPerSecond: 0,
        settlementsPerSecond: 0,
      },
      errorRate: 0,
      memoryUsage: {
        peak: 0,
        average: 0,
      },
    };

    this.setupEventListeners();
  }

  private setupEventListeners() {
    this.matchingEngine.on('orderSubmitted', (order) => {
      // Track order metrics
    });

    this.matchingEngine.on('trade', (trade) => {
      this.settlementEngine.addTrade(trade);
    });

    this.settlementEngine.on('epochFinalized', (epoch) => {
      // Track settlement metrics
    });
  }

  async runStressTest(config: {
    duration: number; // seconds
    ordersPerSecond: number;
    userCount: number;
    orderDistribution: {
      market: number; // percentage
      limit: number;
      stop: number;
    };
  }) {
    console.log('Starting stress test with config:', config);
    
    const startTime = Date.now();
    const endTime = startTime + config.duration * 1000;
    
    let totalOrders = 0;
    let totalErrors = 0;
    let totalTrades = 0;

    // Pre-populate order book with liquidity
    await this.seedOrderBook(config.userCount);

    // Main test loop
    while (Date.now() < endTime) {
      const batchStart = Date.now();
      const batchPromises = [];

      // Submit batch of orders
      for (let i = 0; i < config.ordersPerSecond; i++) {
        const orderPromise = this.submitRandomOrder(config, i % config.userCount);
        batchPromises.push(orderPromise);
      }

      // Wait for batch completion
      const results = await Promise.allSettled(batchPromises);
      
      // Track metrics
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          totalOrders++;
          const order = result.value;
          
          if (order.trades && order.trades.length > 0) {
            totalTrades += order.trades.length;
          }
        } else {
          totalErrors++;
        }
      });

      // Memory snapshot
      if (global.gc) {
        global.gc();
      }
      const memUsage = process.memoryUsage();
      this.metrics.memoryUsage.peak = Math.max(
        this.metrics.memoryUsage.peak,
        memUsage.heapUsed
      );

      // Ensure consistent rate
      const batchDuration = Date.now() - batchStart;
      const targetDuration = 1000; // 1 second batches
      if (batchDuration < targetDuration) {
        await new Promise(resolve => setTimeout(resolve, targetDuration - batchDuration));
      }

      // Progress update
      const elapsed = (Date.now() - startTime) / 1000;
      console.log(`Progress: ${elapsed.toFixed(1)}s, Orders: ${totalOrders}, Trades: ${totalTrades}, Errors: ${totalErrors}`);
    }

    // Calculate final metrics
    const totalDuration = (Date.now() - startTime) / 1000;
    this.metrics.throughput.ordersPerSecond = totalOrders / totalDuration;
    this.metrics.throughput.tradesPerSecond = totalTrades / totalDuration;
    this.metrics.errorRate = totalErrors / (totalOrders + totalErrors);

    return this.generateReport(totalOrders, totalTrades, totalErrors, totalDuration);
  }

  private async seedOrderBook(userCount: number) {
    console.log('Seeding order book with initial liquidity...');
    
    const basePrice = 2000;
    const spread = 0.1; // 0.1% spread
    
    // Create ladder of orders on both sides
    for (let i = 0; i < 100; i++) {
      // Sell orders
      await this.matchingEngine.submitOrder({
        userId: `marketMaker${i % 10}`,
        pair: 'ETH/USDC',
        side: OrderSide.SELL,
        type: OrderType.LIMIT,
        price: basePrice * (1 + spread/100 + i * 0.001),
        quantity: Math.random() * 10 + 1,
      });

      // Buy orders
      await this.matchingEngine.submitOrder({
        userId: `marketMaker${i % 10}`,
        pair: 'ETH/USDC',
        side: OrderSide.BUY,
        type: OrderType.LIMIT,
        price: basePrice * (1 - spread/100 - i * 0.001),
        quantity: Math.random() * 10 + 1,
      });
    }

    console.log('Order book seeded successfully');
  }

  private async submitRandomOrder(config: any, userIndex: number) {
    const orderTypeRoll = Math.random() * 100;
    let orderType: OrderType;
    
    if (orderTypeRoll < config.orderDistribution.market) {
      orderType = OrderType.MARKET;
    } else if (orderTypeRoll < config.orderDistribution.market + config.orderDistribution.limit) {
      orderType = OrderType.LIMIT;
    } else {
      orderType = OrderType.STOP_LIMIT;
    }

    const side = Math.random() > 0.5 ? OrderSide.BUY : OrderSide.SELL;
    const basePrice = 2000;
    const priceDeviation = (Math.random() - 0.5) * 0.02; // ±1% from base
    
    const order = {
      userId: `user${userIndex}`,
      pair: 'ETH/USDC',
      side,
      type: orderType,
      price: orderType === OrderType.MARKET ? undefined : basePrice * (1 + priceDeviation),
      stopPrice: orderType === OrderType.STOP_LIMIT ? basePrice * (1 + priceDeviation * 0.5) : undefined,
      quantity: Math.random() * 5 + 0.1,
    };

    const startTime = process.hrtime.bigint();
    const result = await this.matchingEngine.submitOrder(order);
    const endTime = process.hrtime.bigint();
    
    const latencyMs = Number(endTime - startTime) / 1_000_000;
    this.metrics.orderSubmissionLatency.push(latencyMs);

    return result;
  }

  private generateReport(totalOrders: number, totalTrades: number, totalErrors: number, duration: number) {
    const report = {
      summary: {
        totalOrders,
        totalTrades,
        totalErrors,
        duration: `${duration.toFixed(2)} seconds`,
        successRate: `${((1 - this.metrics.errorRate) * 100).toFixed(2)}%`,
      },
      throughput: {
        ordersPerSecond: this.metrics.throughput.ordersPerSecond.toFixed(2),
        tradesPerSecond: this.metrics.throughput.tradesPerSecond.toFixed(2),
        averageOrdersPerTrade: (totalOrders / totalTrades).toFixed(2),
      },
      latency: {
        orderSubmission: {
          p50: this.calculatePercentile(this.metrics.orderSubmissionLatency, 50),
          p95: this.calculatePercentile(this.metrics.orderSubmissionLatency, 95),
          p99: this.calculatePercentile(this.metrics.orderSubmissionLatency, 99),
          max: Math.max(...this.metrics.orderSubmissionLatency),
        },
      },
      memory: {
        peakMB: (this.metrics.memoryUsage.peak / 1024 / 1024).toFixed(2),
        currentMB: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2),
      },
      orderBook: {
        depth: this.matchingEngine.getOrderBook('ETH/USDC', 1000),
        totalActiveOrders: this.matchingEngine.getUserOrders('').filter(
          o => o.status === OrderStatus.OPEN || o.status === OrderStatus.PARTIALLY_FILLED
        ).length,
      },
    };

    return report;
  }

  private calculatePercentile(arr: number[], percentile: number): number {
    if (arr.length === 0) return 0;
    
    const sorted = arr.slice().sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[index];
  }

  async runScalabilityTest() {
    console.log('Running scalability test...');
    
    const scenarios = [
      { ordersPerSecond: 100, duration: 60 },
      { ordersPerSecond: 500, duration: 60 },
      { ordersPerSecond: 1000, duration: 60 },
      { ordersPerSecond: 5000, duration: 30 },
      { ordersPerSecond: 10000, duration: 10 },
    ];

    const results = [];

    for (const scenario of scenarios) {
      console.log(`\nTesting ${scenario.ordersPerSecond} orders/second...`);
      
      // Reset engine state
      this.matchingEngine.clear();
      this.metrics = {
        orderSubmissionLatency: [],
        matchingLatency: [],
        settlementLatency: [],
        throughput: {
          ordersPerSecond: 0,
          tradesPerSecond: 0,
          settlementsPerSecond: 0,
        },
        errorRate: 0,
        memoryUsage: {
          peak: 0,
          average: 0,
        },
      };

      const result = await this.runStressTest({
        duration: scenario.duration,
        ordersPerSecond: scenario.ordersPerSecond,
        userCount: 1000,
        orderDistribution: {
          market: 20,
          limit: 75,
          stop: 5,
        },
      });

      results.push({
        targetOPS: scenario.ordersPerSecond,
        actualOPS: result.throughput.ordersPerSecond,
        ...result,
      });

      // Cool down period
      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    return results;
  }

  async runLongevityTest(hours: number = 24) {
    console.log(`Starting ${hours}-hour longevity test...`);
    
    const checkpoints = [];
    const checkInterval = 3600000; // 1 hour
    let lastCheckpoint = Date.now();

    const testConfig = {
      duration: hours * 3600,
      ordersPerSecond: 100,
      userCount: 10000,
      orderDistribution: {
        market: 15,
        limit: 80,
        stop: 5,
      },
    };

    // Run with periodic checkpoints
    const startTime = Date.now();
    const endTime = startTime + testConfig.duration * 1000;

    while (Date.now() < endTime) {
      const batchDuration = Math.min(300, (endTime - Date.now()) / 1000); // 5 min batches
      
      await this.runStressTest({
        ...testConfig,
        duration: batchDuration,
      });

      // Checkpoint
      if (Date.now() - lastCheckpoint >= checkInterval) {
        const checkpoint = {
          elapsed: (Date.now() - startTime) / 1000 / 3600, // hours
          memoryMB: process.memoryUsage().heapUsed / 1024 / 1024,
          activeOrders: this.matchingEngine.getUserOrders('').filter(
            o => o.status === OrderStatus.OPEN
          ).length,
          errorRate: this.metrics.errorRate,
        };
        
        checkpoints.push(checkpoint);
        lastCheckpoint = Date.now();
        
        console.log(`Checkpoint at ${checkpoint.elapsed.toFixed(1)} hours:`, checkpoint);
      }
    }

    return {
      duration: `${hours} hours`,
      checkpoints,
      finalState: {
        memoryMB: process.memoryUsage().heapUsed / 1024 / 1024,
        totalOrders: this.matchingEngine.getUserOrders('').length,
        errorRate: this.metrics.errorRate,
      },
    };
  }
}

// Run tests if called directly
if (require.main === module) {
  const test = new TradingSystemStressTest();
  
  (async () => {
    console.log('Starting comprehensive stress tests...\n');
    
    // Basic stress test
    console.log('1. Basic Stress Test (1000 orders/sec for 60 seconds)');
    const basicResult = await test.runStressTest({
      duration: 60,
      ordersPerSecond: 1000,
      userCount: 100,
      orderDistribution: {
        market: 20,
        limit: 75,
        stop: 5,
      },
    });
    console.log('Basic test result:', JSON.stringify(basicResult, null, 2));
    
    // Scalability test
    console.log('\n2. Scalability Test');
    const scalabilityResults = await test.runScalabilityTest();
    console.log('Scalability results:', JSON.stringify(scalabilityResults, null, 2));
    
    // Optional: Longevity test (commented out due to duration)
    // console.log('\n3. Longevity Test (24 hours)');
    // const longevityResult = await test.runLongevityTest(24);
    // console.log('Longevity result:', JSON.stringify(longevityResult, null, 2));
  })().catch(console.error);
}