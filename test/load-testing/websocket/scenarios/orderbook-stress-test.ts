import { WebSocketLoadTester } from '../WebSocketLoadTester';
import { performance } from 'perf_hooks';

interface OrderBookUpdate {
  type: 'orderbook_update';
  pair: string;
  bids: Array<[number, number]>; // [price, quantity]
  asks: Array<[number, number]>;
  sequence: number;
  timestamp: number;
}

interface OrderBookSubscription {
  type: 'subscribe' | 'unsubscribe';
  channel: 'orderbook';
  pairs: string[];
  depth?: number;
  throttle?: number; // ms between updates
  aggregation?: number; // price aggregation level
}

export class OrderBookStressTest {
  private tester: WebSocketLoadTester;
  private pairs = [
    'ETH/USDT', 'BTC/USDT', 'SOL/USDT', 'MATIC/USDT', 'AVAX/USDT',
    'DOT/USDT', 'LINK/USDT', 'UNI/USDT', 'ATOM/USDT', 'LTC/USDT',
    'ADA/USDT', 'XRP/USDT', 'DOGE/USDT', 'SHIB/USDT', 'APT/USDT',
  ];
  private updateStats = new Map<string, {
    updates: number;
    bytes: number;
    lastSequence: number;
    gaps: number;
    latencies: number[];
  }>();
  private startTime: number = 0;

  constructor(private wsUrl: string) {
    this.tester = new WebSocketLoadTester({
      url: wsUrl,
      targetConnections: 1000, // 1000 connections subscribing to order books
      connectionsPerSecond: 100,
      messageRate: 0, // We'll send custom messages
      testDuration: 0,
      reconnectOnError: true,
    });
    
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    let connectionCount = 0;
    
    this.tester.on('connected', (connectionId: string) => {
      connectionCount++;
      
      // Each connection subscribes to different pairs
      const pairsPerConnection = 5;
      const startIdx = (connectionCount % (this.pairs.length / pairsPerConnection)) * pairsPerConnection;
      const subscribePairs = this.pairs.slice(startIdx, startIdx + pairsPerConnection);
      
      // Send subscription message
      const subscription: OrderBookSubscription = {
        type: 'subscribe',
        channel: 'orderbook',
        pairs: subscribePairs,
        depth: 50, // Top 50 levels
        throttle: 100, // Update every 100ms max
        aggregation: 0.01, // Price aggregation
      };
      
      this.sendMessage(connectionId, subscription);
      
      // Periodically change subscriptions to stress the system
      setInterval(() => {
        const random = Math.random();
        if (random < 0.1) {
          // 10% chance to unsubscribe and resubscribe
          this.sendMessage(connectionId, {
            type: 'unsubscribe',
            channel: 'orderbook',
            pairs: subscribePairs,
          });
          
          setTimeout(() => {
            this.sendMessage(connectionId, subscription);
          }, 1000);
        } else if (random < 0.2) {
          // 10% chance to change depth
          subscription.depth = Math.floor(Math.random() * 100) + 10;
          this.sendMessage(connectionId, subscription);
        }
      }, 30000); // Every 30 seconds
    });
    
    this.tester.on('message', ({ connectionId, message }) => {
      this.handleOrderBookUpdate(message);
    });
    
    this.tester.on('metrics', (metrics) => {
      this.displayMetrics(metrics);
    });
  }

  private sendMessage(connectionId: string, message: any): void {
    const ws = (this.tester as any).connections.get(connectionId);
    if (ws && ws.readyState === 1) { // OPEN
      ws.send(JSON.stringify({
        ...message,
        id: `${connectionId}-${Date.now()}`,
        timestamp: Date.now(),
      }));
    }
  }

  private handleOrderBookUpdate(message: any): void {
    if (message.type === 'orderbook_update') {
      const update = message as OrderBookUpdate;
      
      if (!this.updateStats.has(update.pair)) {
        this.updateStats.set(update.pair, {
          updates: 0,
          bytes: 0,
          lastSequence: update.sequence,
          gaps: 0,
          latencies: [],
        });
      }
      
      const stats = this.updateStats.get(update.pair)!;
      stats.updates++;
      stats.bytes += JSON.stringify(message).length;
      
      // Check for sequence gaps
      if (update.sequence !== stats.lastSequence + 1 && stats.lastSequence > 0) {
        stats.gaps++;
        console.warn(`Sequence gap detected for ${update.pair}: expected ${stats.lastSequence + 1}, got ${update.sequence}`);
      }
      stats.lastSequence = update.sequence;
      
      // Calculate latency
      const latency = Date.now() - update.timestamp;
      stats.latencies.push(latency);
      
      // Keep only last 1000 latencies to prevent memory issues
      if (stats.latencies.length > 1000) {
        stats.latencies = stats.latencies.slice(-1000);
      }
    }
  }

  private displayMetrics(metrics: any): void {
    const runtime = (performance.now() - this.startTime) / 1000;
    
    console.clear();
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log('                    Order Book Stress Test                          ');
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log();
    console.log(`⏱️  Runtime: ${runtime.toFixed(0)}s`);
    console.log(`🔗 Active Connections: ${metrics.activeConnections}`);
    console.log(`📊 Total Updates Received: ${metrics.totalMessagesReceived.toLocaleString()}`);
    console.log(`📈 Updates/Second: ${(metrics.totalMessagesReceived / runtime).toFixed(0)}`);
    console.log(`📦 Total Data: ${(metrics.totalBytes / 1024 / 1024).toFixed(2)} MB`);
    console.log(`🚀 Throughput: ${(metrics.totalBytes / runtime / 1024 / 1024).toFixed(2)} MB/s`);
    console.log();
    console.log('📚 Order Book Statistics:');
    console.log('─────────────────────────────────────────────────────────────────');
    console.log('Pair          Updates    Rate/s   Avg Latency   P99 Latency   Gaps');
    console.log('─────────────────────────────────────────────────────────────────');
    
    const sortedPairs = Array.from(this.updateStats.entries())
      .sort((a, b) => b[1].updates - a[1].updates)
      .slice(0, 10);
    
    for (const [pair, stats] of sortedPairs) {
      const rate = stats.updates / runtime;
      const avgLatency = stats.latencies.length > 0
        ? stats.latencies.reduce((a, b) => a + b, 0) / stats.latencies.length
        : 0;
      const p99Latency = stats.latencies.length > 0
        ? stats.latencies.sort((a, b) => a - b)[Math.floor(stats.latencies.length * 0.99)] || 0
        : 0;
      
      console.log(
        `${pair.padEnd(12)} ${stats.updates.toString().padStart(8)} ${rate.toFixed(1).padStart(8)} ` +
        `${avgLatency.toFixed(1).padStart(11)}ms ${p99Latency.toFixed(1).padStart(11)}ms ${stats.gaps.toString().padStart(6)}`
      );
    }
    
    console.log();
    console.log('💾 Memory Usage:');
    console.log(`   RSS: ${(metrics.memoryUsage.rss / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   Heap: ${(metrics.memoryUsage.heapUsed / 1024 / 1024).toFixed(2)} MB / ${(metrics.memoryUsage.heapTotal / 1024 / 1024).toFixed(2)} MB`);
    
    if (metrics.errors.size > 0) {
      console.log();
      console.log('❌ Errors:');
      let errorCount = 0;
      for (const [error, count] of metrics.errors) {
        if (errorCount++ < 5) {
          console.log(`   ${error}: ${count}`);
        }
      }
      if (metrics.errors.size > 5) {
        console.log(`   ... and ${metrics.errors.size - 5} more error types`);
      }
    }
  }

  async start(): Promise<void> {
    console.log('🚀 Starting Order Book Stress Test');
    console.log(`📊 Subscribing to ${this.pairs.length} trading pairs`);
    console.log(`🎯 Target: 1000 concurrent connections`);
    console.log(`📈 Each connection subscribes to 5 pairs with 50-level depth`);
    
    this.startTime = performance.now();
    
    // Start memory leak detection
    await this.tester.detectMemoryLeaks(300); // 5 minutes
    
    // Start the test
    await this.tester.start();
    
    // Run intensive test scenarios
    this.runStressScenarios();
  }

  private async runStressScenarios(): Promise<void> {
    // Scenario 1: Burst subscriptions
    setTimeout(() => {
      console.log('\n🔥 Scenario 1: Burst subscription test (500 new subscriptions)');
      for (let i = 0; i < 500; i++) {
        const randomPairs = this.getRandomPairs(Math.floor(Math.random() * 10) + 1);
        const subscription: OrderBookSubscription = {
          type: 'subscribe',
          channel: 'orderbook',
          pairs: randomPairs,
          depth: 100,
        };
        
        // Send to random connection
        const connections = Array.from((this.tester as any).connections.keys());
        if (connections.length > 0) {
          const randomConnection = connections[Math.floor(Math.random() * connections.length)];
          this.sendMessage(randomConnection, subscription);
        }
      }
    }, 30000); // After 30 seconds
    
    // Scenario 2: Rapid subscribe/unsubscribe
    setTimeout(() => {
      console.log('\n🔥 Scenario 2: Rapid subscribe/unsubscribe test');
      const interval = setInterval(() => {
        const connections = Array.from((this.tester as any).connections.keys());
        const randomConnection = connections[Math.floor(Math.random() * connections.length)];
        const randomPairs = this.getRandomPairs(3);
        
        // Unsubscribe
        this.sendMessage(randomConnection, {
          type: 'unsubscribe',
          channel: 'orderbook',
          pairs: randomPairs,
        });
        
        // Immediately resubscribe
        this.sendMessage(randomConnection, {
          type: 'subscribe',
          channel: 'orderbook',
          pairs: randomPairs,
          depth: Math.floor(Math.random() * 100) + 10,
        });
      }, 100); // Every 100ms
      
      // Stop after 30 seconds
      setTimeout(() => clearInterval(interval), 30000);
    }, 60000); // After 1 minute
    
    // Scenario 3: Deep order book requests
    setTimeout(() => {
      console.log('\n🔥 Scenario 3: Deep order book test (1000 levels)');
      const connections = Array.from((this.tester as any).connections.keys()).slice(0, 100);
      
      for (const connectionId of connections) {
        this.sendMessage(connectionId, {
          type: 'subscribe',
          channel: 'orderbook',
          pairs: this.getRandomPairs(1),
          depth: 1000, // Very deep order book
        });
      }
    }, 90000); // After 1.5 minutes
  }

  private getRandomPairs(count: number): string[] {
    const shuffled = [...this.pairs].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
  }

  stop(): void {
    console.log('\n🛑 Stopping Order Book Stress Test');
    this.tester.stop();
    
    // Display final statistics
    console.log('\n📊 Final Order Book Statistics:');
    let totalUpdates = 0;
    let totalBytes = 0;
    let totalGaps = 0;
    
    for (const [pair, stats] of this.updateStats) {
      totalUpdates += stats.updates;
      totalBytes += stats.bytes;
      totalGaps += stats.gaps;
    }
    
    console.log(`Total Order Book Updates: ${totalUpdates.toLocaleString()}`);
    console.log(`Total Data Processed: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Total Sequence Gaps: ${totalGaps}`);
    console.log(`Unique Pairs Tracked: ${this.updateStats.size}`);
  }
}

// Run the test
if (require.main === module) {
  const wsUrl = process.env.WS_URL || 'ws://localhost:8080';
  const test = new OrderBookStressTest(wsUrl);
  
  test.start().catch(console.error);
  
  // Handle graceful shutdown
  process.on('SIGINT', () => {
    test.stop();
    setTimeout(() => process.exit(0), 2000);
  });
}