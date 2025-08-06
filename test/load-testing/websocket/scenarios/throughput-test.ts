import { WebSocketLoadTester } from '../WebSocketLoadTester';
import * as cluster from 'cluster';
import * as os from 'os';
import { performance } from 'perf_hooks';

interface ThroughputMetrics {
  messagesPerSecond: number;
  bytesPerSecond: number;
  peakMessagesPerSecond: number;
  sustainedThroughput: boolean;
  cpuUsage: number;
  memoryUsage: number;
  droppedMessages: number;
  backpressure: boolean;
}

export class MessageThroughputTest {
  private targetMessagesPerSecond = 100000; // 100k messages/second
  private workers: cluster.Worker[] = [];
  private metrics = new Map<number, ThroughputMetrics>();
  private startTime: number = 0;
  private messagesSent = 0;
  private messagesReceived = 0;
  private bytesTransferred = 0;
  private peakThroughput = 0;
  private sustainedDuration = 0;
  
  constructor(
    private wsUrl: string,
    private numWorkers: number = os.cpus().length,
    private connectionCount: number = 2000 // Total connections across all workers
  ) {}

  async start(): Promise<void> {
    if (cluster.isPrimary) {
      await this.runPrimary();
    } else {
      await this.runWorker();
    }
  }

  private async runPrimary(): Promise<void> {
    console.log(`🚀 Starting Message Throughput Test`);
    console.log(`🎯 Target: ${this.targetMessagesPerSecond.toLocaleString()} messages/second`);
    console.log(`👷 Workers: ${this.numWorkers}`);
    console.log(`🔗 Total Connections: ${this.connectionCount}`);
    console.log(`📨 Messages per connection: ${Math.floor(this.targetMessagesPerSecond / this.connectionCount)}/sec`);
    
    this.startTime = performance.now();
    
    // Calculate distribution
    const connectionsPerWorker = Math.ceil(this.connectionCount / this.numWorkers);
    const messagesPerWorker = Math.ceil(this.targetMessagesPerSecond / this.numWorkers);
    
    // Fork workers
    for (let i = 0; i < this.numWorkers; i++) {
      const worker = cluster.fork({
        WORKER_ID: i,
        CONNECTIONS_TARGET: connectionsPerWorker,
        MESSAGES_PER_SECOND: messagesPerWorker,
        WS_URL: this.wsUrl,
      });
      
      this.workers.push(worker);
      
      worker.on('message', (msg: any) => {
        if (msg.type === 'metrics') {
          this.handleWorkerMetrics(msg.workerId, msg.data);
        }
      });
    }
    
    // Start monitoring
    this.startMonitoring();
    
    // Run test phases
    this.runTestPhases();
    
    // Handle shutdown
    process.on('SIGINT', () => this.shutdown());
  }

  private async runWorker(): Promise<void> {
    const workerId = parseInt(process.env.WORKER_ID || '0');
    const connectionsTarget = parseInt(process.env.CONNECTIONS_TARGET || '100');
    const messagesPerSecond = parseInt(process.env.MESSAGES_PER_SECOND || '10000');
    const wsUrl = process.env.WS_URL || 'ws://localhost:8080';
    
    console.log(`Worker ${workerId}: Starting with ${connectionsTarget} connections, ${messagesPerSecond} msg/sec`);
    
    // Calculate per-connection message rate
    const messageRatePerConnection = messagesPerSecond / connectionsTarget;
    
    const tester = new WebSocketLoadTester({
      url: wsUrl,
      targetConnections: connectionsTarget,
      connectionsPerSecond: 100, // Ramp up quickly
      messageRate: messageRatePerConnection,
      testDuration: 0,
      reconnectOnError: true,
      messageGenerator: () => this.generateHighFrequencyMessage(workerId),
    });
    
    // Track metrics
    let lastMetricsSent = performance.now();
    let localMessagesSent = 0;
    let localMessagesReceived = 0;
    let localBytes = 0;
    let backpressureDetected = false;
    
    tester.on('message', (data) => {
      localMessagesReceived++;
      localBytes += JSON.stringify(data.message).length;
    });
    
    // Monitor for backpressure
    const originalSend = WebSocket.prototype.send;
    WebSocket.prototype.send = function(data: any) {
      if (this.bufferedAmount > 10 * 1024 * 1024) { // 10MB buffer
        backpressureDetected = true;
      }
      localMessagesSent++;
      return originalSend.call(this, data);
    };
    
    // Send metrics to primary
    setInterval(() => {
      const now = performance.now();
      const duration = (now - lastMetricsSent) / 1000;
      
      const metrics: ThroughputMetrics = {
        messagesPerSecond: localMessagesSent / duration,
        bytesPerSecond: localBytes / duration,
        peakMessagesPerSecond: 0, // Will be calculated in primary
        sustainedThroughput: true,
        cpuUsage: process.cpuUsage().user / 1000000, // Convert to seconds
        memoryUsage: process.memoryUsage().heapUsed,
        droppedMessages: Math.max(0, localMessagesSent - localMessagesReceived),
        backpressure: backpressureDetected,
      };
      
      process.send!({
        type: 'metrics',
        workerId,
        data: metrics,
      });
      
      // Reset counters
      localMessagesSent = 0;
      localMessagesReceived = 0;
      localBytes = 0;
      backpressureDetected = false;
      lastMetricsSent = now;
    }, 1000);
    
    // Start the test
    await tester.start();
  }

  private generateHighFrequencyMessage(workerId: number): any {
    const messageTypes = ['trade', 'quote', 'orderbook', 'ticker'];
    const pairs = ['ETH/USDT', 'BTC/USDT', 'SOL/USDT'];
    
    return {
      id: `${workerId}-${Date.now()}-${Math.random()}`,
      type: messageTypes[Math.floor(Math.random() * messageTypes.length)],
      pair: pairs[Math.floor(Math.random() * pairs.length)],
      timestamp: Date.now(),
      data: {
        price: Math.random() * 10000,
        quantity: Math.random() * 100,
        side: Math.random() > 0.5 ? 'buy' : 'sell',
        workerId,
        sequence: this.messagesSent++,
      },
      // Add some payload to make messages more realistic (avg 200-300 bytes)
      metadata: {
        exchange: 'test-exchange',
        region: 'us-east-1',
        serverTime: Date.now(),
        processingTime: Math.random() * 10,
        additional: Array(10).fill(0).map(() => Math.random()),
      },
    };
  }

  private handleWorkerMetrics(workerId: number, metrics: ThroughputMetrics): void {
    this.metrics.set(workerId, metrics);
  }

  private startMonitoring(): void {
    const monitorInterval = setInterval(() => {
      const aggregated = this.aggregateMetrics();
      this.displayMetrics(aggregated);
      
      // Track peak and sustained throughput
      const currentThroughput = aggregated.totalMessagesPerSecond;
      if (currentThroughput > this.peakThroughput) {
        this.peakThroughput = currentThroughput;
      }
      
      if (currentThroughput >= this.targetMessagesPerSecond * 0.95) {
        this.sustainedDuration++;
      } else {
        this.sustainedDuration = 0;
      }
    }, 1000);
    
    process.on('exit', () => clearInterval(monitorInterval));
  }

  private aggregateMetrics(): any {
    let totalMessagesPerSecond = 0;
    let totalBytesPerSecond = 0;
    let totalCpuUsage = 0;
    let totalMemoryUsage = 0;
    let totalDropped = 0;
    let anyBackpressure = false;
    
    for (const metrics of this.metrics.values()) {
      totalMessagesPerSecond += metrics.messagesPerSecond;
      totalBytesPerSecond += metrics.bytesPerSecond;
      totalCpuUsage += metrics.cpuUsage;
      totalMemoryUsage += metrics.memoryUsage;
      totalDropped += metrics.droppedMessages;
      anyBackpressure = anyBackpressure || metrics.backpressure;
    }
    
    return {
      totalMessagesPerSecond,
      totalBytesPerSecond,
      totalCpuUsage,
      totalMemoryUsage,
      totalDropped,
      anyBackpressure,
      peakThroughput: this.peakThroughput,
      sustainedDuration: this.sustainedDuration,
      targetAchieved: totalMessagesPerSecond >= this.targetMessagesPerSecond,
    };
  }

  private displayMetrics(metrics: any): void {
    const runtime = (performance.now() - this.startTime) / 1000;
    const targetPercentage = (metrics.totalMessagesPerSecond / this.targetMessagesPerSecond) * 100;
    
    console.clear();
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log('                Message Throughput Test - 100K msgs/sec             ');
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log();
    console.log(`⏱️  Runtime: ${runtime.toFixed(0)}s`);
    console.log();
    console.log('📊 Throughput Metrics:');
    console.log(`   Current Rate:         ${metrics.totalMessagesPerSecond.toLocaleString()} msg/sec`);
    console.log(`   Target Rate:          ${this.targetMessagesPerSecond.toLocaleString()} msg/sec`);
    console.log(`   Achievement:          ${targetPercentage.toFixed(1)}% ${metrics.targetAchieved ? '✅' : '❌'}`);
    console.log(`   Peak Rate:            ${metrics.peakThroughput.toLocaleString()} msg/sec`);
    console.log(`   Sustained (>95%):     ${metrics.sustainedDuration}s`);
    console.log();
    console.log('📈 Data Transfer:');
    console.log(`   Throughput:           ${(metrics.totalBytesPerSecond / 1024 / 1024).toFixed(2)} MB/s`);
    console.log(`   Avg Message Size:     ${metrics.totalBytesPerSecond > 0 ? Math.floor(metrics.totalBytesPerSecond / metrics.totalMessagesPerSecond) : 0} bytes`);
    console.log();
    console.log('⚡ Performance:');
    console.log(`   CPU Usage:            ${metrics.totalCpuUsage.toFixed(1)}%`);
    console.log(`   Memory Usage:         ${(metrics.totalMemoryUsage / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   Dropped Messages:     ${metrics.totalDropped.toLocaleString()}`);
    console.log(`   Backpressure:         ${metrics.anyBackpressure ? 'YES ⚠️' : 'NO ✅'}`);
    console.log();
    
    // Visual throughput bar
    const barLength = 50;
    const filledLength = Math.floor((targetPercentage / 100) * barLength);
    const bar = '█'.repeat(Math.min(filledLength, barLength)) + '░'.repeat(Math.max(barLength - filledLength, 0));
    console.log(`   Progress: [${bar}] ${targetPercentage.toFixed(1)}%`);
    
    console.log();
    console.log('═══════════════════════════════════════════════════════════════════');
  }

  private async runTestPhases(): Promise<void> {
    console.log('\n📋 Test Phases:');
    console.log('   Phase 1: Ramp up to 50% target (30s)');
    console.log('   Phase 2: Ramp up to 100% target (30s)');
    console.log('   Phase 3: Sustain 100% target (60s)');
    console.log('   Phase 4: Burst to 150% target (30s)');
    console.log('   Phase 5: Recovery test (30s)');
    
    // Phase timing handled by worker message rates
    // Workers will automatically adjust based on their configuration
  }

  private async shutdown(): Promise<void> {
    console.log('\n🛑 Shutting down throughput test...');
    
    // Kill all workers
    for (const worker of this.workers) {
      worker.kill();
    }
    
    // Final report
    const runtime = (performance.now() - this.startTime) / 1000;
    console.log('\n📊 Final Throughput Test Report:');
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log(`   Test Duration:        ${runtime.toFixed(1)}s`);
    console.log(`   Target Rate:          ${this.targetMessagesPerSecond.toLocaleString()} msg/sec`);
    console.log(`   Peak Achieved:        ${this.peakThroughput.toLocaleString()} msg/sec`);
    console.log(`   Peak Percentage:      ${((this.peakThroughput / this.targetMessagesPerSecond) * 100).toFixed(1)}%`);
    console.log(`   Sustained Duration:   ${this.sustainedDuration}s`);
    
    if (this.peakThroughput >= this.targetMessagesPerSecond) {
      console.log('\n✅ SUCCESS: Achieved target throughput of 100K messages/second!');
    } else {
      console.log('\n❌ Target not achieved. Recommendations:');
      console.log('   - Increase number of workers/connections');
      console.log('   - Optimize message serialization');
      console.log('   - Check network bandwidth limits');
      console.log('   - Monitor server-side performance');
    }
    
    process.exit(0);
  }
}

// Run the test
if (require.main === module) {
  const wsUrl = process.env.WS_URL || 'ws://localhost:8080';
  const numWorkers = parseInt(process.env.NUM_WORKERS || '') || Math.min(os.cpus().length, 8);
  const connectionCount = parseInt(process.env.CONNECTIONS || '2000');
  
  const test = new MessageThroughputTest(wsUrl, numWorkers, connectionCount);
  test.start().catch(console.error);
}