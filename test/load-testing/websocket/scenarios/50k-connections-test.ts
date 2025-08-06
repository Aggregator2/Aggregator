import { WebSocketLoadTester } from '../WebSocketLoadTester';
import * as cluster from 'cluster';
import * as os from 'os';
import { performance } from 'perf_hooks';

interface WorkerMessage {
  type: 'metrics' | 'complete' | 'error';
  workerId: number;
  data: any;
}

class DistributedLoadTest {
  private workers: cluster.Worker[] = [];
  private metrics: Map<number, any> = new Map();
  private startTime: number = 0;
  private targetConnections: number = 50000;
  private wsUrl: string;
  private numWorkers: number;

  constructor(wsUrl: string, numWorkers?: number) {
    this.wsUrl = wsUrl;
    this.numWorkers = numWorkers || os.cpus().length;
  }

  async start(): Promise<void> {
    if (cluster.isPrimary) {
      await this.runPrimary();
    } else {
      await this.runWorker();
    }
  }

  private async runPrimary(): Promise<void> {
    console.log(`🚀 Starting 50,000 connection WebSocket load test`);
    console.log(`📊 Using ${this.numWorkers} worker processes`);
    console.log(`🎯 Target: ${this.targetConnections} total connections`);
    console.log(`🔗 URL: ${this.wsUrl}`);
    
    this.startTime = performance.now();
    
    // Calculate connections per worker
    const connectionsPerWorker = Math.ceil(this.targetConnections / this.numWorkers);
    
    // Fork workers
    for (let i = 0; i < this.numWorkers; i++) {
      const worker = cluster.fork({
        WORKER_ID: i,
        CONNECTIONS_TARGET: connectionsPerWorker,
        WS_URL: this.wsUrl,
      });
      
      this.workers.push(worker);
      
      // Handle worker messages
      worker.on('message', (msg: WorkerMessage) => {
        this.handleWorkerMessage(msg);
      });
      
      worker.on('error', (error) => {
        console.error(`Worker ${i} error:`, error);
      });
      
      worker.on('exit', (code, signal) => {
        if (code !== 0) {
          console.error(`Worker ${i} died with code ${code} and signal ${signal}`);
        }
      });
    }
    
    // Start monitoring
    this.startMonitoring();
    
    // Handle graceful shutdown
    process.on('SIGINT', () => this.shutdown());
    process.on('SIGTERM', () => this.shutdown());
  }

  private async runWorker(): Promise<void> {
    const workerId = parseInt(process.env.WORKER_ID || '0');
    const connectionsTarget = parseInt(process.env.CONNECTIONS_TARGET || '1000');
    const wsUrl = process.env.WS_URL || 'ws://localhost:8080';
    
    console.log(`Worker ${workerId}: Starting with target ${connectionsTarget} connections`);
    
    const tester = new WebSocketLoadTester({
      url: wsUrl,
      targetConnections: connectionsTarget,
      connectionsPerSecond: 500, // 500 connections/sec per worker
      messageRate: 10, // 10 messages/sec per connection
      testDuration: 0, // Run indefinitely
      reconnectOnError: true,
      messageGenerator: () => ({
        type: 'subscribe',
        channel: 'orderbook',
        pairs: ['ETH/USDT', 'BTC/USDT', 'SOL/USDT'],
        depth: 20,
        id: `${workerId}-${Date.now()}-${Math.random()}`,
        timestamp: Date.now(),
      }),
    });
    
    // Forward metrics to primary
    tester.on('metrics', (metrics) => {
      process.send!({
        type: 'metrics',
        workerId,
        data: metrics,
      });
    });
    
    tester.on('complete', (metrics) => {
      process.send!({
        type: 'complete',
        workerId,
        data: metrics,
      });
    });
    
    // Start memory leak detection
    await tester.detectMemoryLeaks(600); // 10 minutes
    
    // Start the test
    await tester.start();
    
    // Keep worker alive
    process.on('SIGINT', () => {
      tester.stop();
      process.exit(0);
    });
  }

  private handleWorkerMessage(msg: WorkerMessage): void {
    switch (msg.type) {
      case 'metrics':
        this.metrics.set(msg.workerId, msg.data);
        break;
      case 'error':
        console.error(`Worker ${msg.workerId} error:`, msg.data);
        break;
    }
  }

  private startMonitoring(): void {
    const monitorInterval = setInterval(() => {
      const aggregated = this.aggregateMetrics();
      this.displayMetrics(aggregated);
      
      // Check if target reached
      if (aggregated.totalConnections >= this.targetConnections) {
        console.log(`\n✅ Target reached! ${aggregated.totalConnections} connections established`);
      }
    }, 5000); // Update every 5 seconds
    
    // Clean up on exit
    process.on('exit', () => clearInterval(monitorInterval));
  }

  private aggregateMetrics(): any {
    const aggregated = {
      totalConnections: 0,
      activeConnections: 0,
      failedConnections: 0,
      totalMessagesSent: 0,
      totalMessagesReceived: 0,
      totalBytes: 0,
      averageLatency: 0,
      p95Latency: 0,
      p99Latency: 0,
      messagesPerSecond: 0,
      bytesPerSecond: 0,
      errors: new Map<string, number>(),
      memoryUsage: {
        rss: 0,
        heapUsed: 0,
        heapTotal: 0,
      },
    };
    
    const latencies: number[] = [];
    
    for (const metrics of this.metrics.values()) {
      aggregated.totalConnections += metrics.totalConnections || 0;
      aggregated.activeConnections += metrics.activeConnections || 0;
      aggregated.failedConnections += metrics.failedConnections || 0;
      aggregated.totalMessagesSent += metrics.totalMessagesSent || 0;
      aggregated.totalMessagesReceived += metrics.totalMessagesReceived || 0;
      aggregated.totalBytes += metrics.totalBytes || 0;
      aggregated.messagesPerSecond += metrics.messagesPerSecond || 0;
      
      if (metrics.messageLatencies) {
        latencies.push(...metrics.messageLatencies);
      }
      
      // Aggregate errors
      if (metrics.errors) {
        for (const [error, count] of metrics.errors) {
          aggregated.errors.set(error, (aggregated.errors.get(error) || 0) + count);
        }
      }
      
      // Sum memory usage
      if (metrics.memoryUsage) {
        aggregated.memoryUsage.rss += metrics.memoryUsage.rss;
        aggregated.memoryUsage.heapUsed += metrics.memoryUsage.heapUsed;
        aggregated.memoryUsage.heapTotal += metrics.memoryUsage.heapTotal;
      }
    }
    
    // Calculate latency percentiles
    if (latencies.length > 0) {
      latencies.sort((a, b) => a - b);
      const p95Index = Math.floor(latencies.length * 0.95);
      const p99Index = Math.floor(latencies.length * 0.99);
      
      aggregated.averageLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      aggregated.p95Latency = latencies[p95Index] || 0;
      aggregated.p99Latency = latencies[p99Index] || 0;
    }
    
    // Calculate bytes per second
    const duration = (performance.now() - this.startTime) / 1000;
    aggregated.bytesPerSecond = aggregated.totalBytes / duration;
    
    return aggregated;
  }

  private displayMetrics(metrics: any): void {
    console.clear();
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log('                    WebSocket Load Test - 50K Connections           ');
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log();
    console.log(`⏱️  Duration: ${Math.floor((performance.now() - this.startTime) / 1000)}s`);
    console.log();
    console.log('📊 Connection Statistics:');
    console.log(`   Total Connections:    ${metrics.totalConnections.toLocaleString()}`);
    console.log(`   Active Connections:   ${metrics.activeConnections.toLocaleString()}`);
    console.log(`   Failed Connections:   ${metrics.failedConnections.toLocaleString()}`);
    console.log(`   Success Rate:         ${((metrics.activeConnections / metrics.totalConnections) * 100).toFixed(2)}%`);
    console.log();
    console.log('📨 Message Statistics:');
    console.log(`   Messages Sent:        ${metrics.totalMessagesSent.toLocaleString()}`);
    console.log(`   Messages Received:    ${metrics.totalMessagesReceived.toLocaleString()}`);
    console.log(`   Messages/Second:      ${metrics.messagesPerSecond.toFixed(0)}`);
    console.log(`   Total Data:           ${(metrics.totalBytes / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   Throughput:           ${(metrics.bytesPerSecond / 1024 / 1024).toFixed(2)} MB/s`);
    console.log();
    console.log('⚡ Latency Statistics:');
    console.log(`   Average Latency:      ${metrics.averageLatency.toFixed(2)}ms`);
    console.log(`   P95 Latency:          ${metrics.p95Latency.toFixed(2)}ms`);
    console.log(`   P99 Latency:          ${metrics.p99Latency.toFixed(2)}ms`);
    console.log();
    console.log('💾 Memory Usage:');
    console.log(`   RSS:                  ${(metrics.memoryUsage.rss / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   Heap Used:            ${(metrics.memoryUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   Heap Total:           ${(metrics.memoryUsage.heapTotal / 1024 / 1024).toFixed(2)} MB`);
    
    if (metrics.errors.size > 0) {
      console.log();
      console.log('❌ Errors:');
      for (const [error, count] of metrics.errors) {
        console.log(`   ${error}: ${count}`);
      }
    }
    
    console.log();
    console.log('═══════════════════════════════════════════════════════════════════');
  }

  private async shutdown(): Promise<void> {
    console.log('\n🛑 Shutting down load test...');
    
    // Signal all workers to stop
    for (const worker of this.workers) {
      worker.kill('SIGTERM');
    }
    
    // Wait for workers to exit
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Display final metrics
    const finalMetrics = this.aggregateMetrics();
    console.log('\n📊 Final Test Results:');
    this.displayMetrics(finalMetrics);
    
    process.exit(0);
  }
}

// Run the test
if (require.main === module) {
  const wsUrl = process.env.WS_URL || 'ws://localhost:8080';
  const numWorkers = parseInt(process.env.NUM_WORKERS || '') || os.cpus().length;
  
  const test = new DistributedLoadTest(wsUrl, numWorkers);
  test.start().catch(console.error);
}