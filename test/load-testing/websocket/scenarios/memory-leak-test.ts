import { WebSocketLoadTester } from '../WebSocketLoadTester';
import { performance } from 'perf_hooks';
import * as v8 from 'v8';
import * as fs from 'fs';
import * as path from 'path';

interface MemorySnapshot {
  timestamp: number;
  heapUsed: number;
  heapTotal: number;
  rss: number;
  external: number;
  arrayBuffers: number;
  gcCount: number;
  heapSnapshot?: any;
}

interface LeakDetectionResult {
  hasLeak: boolean;
  leakRate: number; // MB per minute
  suspectedLeaks: string[];
  memoryTrend: 'stable' | 'growing' | 'critical';
  recommendations: string[];
}

export class MemoryLeakDetectionTest {
  private snapshots: MemorySnapshot[] = [];
  private gcCount: number = 0;
  private startTime: number = 0;
  private heapSnapshotInterval?: NodeJS.Timeout;
  private reportDir: string;
  private tester?: WebSocketLoadTester;
  
  // Thresholds
  private readonly LEAK_THRESHOLD_MB_PER_MIN = 10;
  private readonly CRITICAL_HEAP_USAGE = 0.85; // 85% of max heap
  private readonly SNAPSHOT_INTERVAL = 60000; // 1 minute
  private readonly MONITORING_INTERVAL = 5000; // 5 seconds

  constructor(
    private wsUrl: string,
    private testDuration: number = 600 // 10 minutes default
  ) {
    this.reportDir = path.join(process.cwd(), 'memory-leak-reports', new Date().toISOString().replace(/:/g, '-'));
    fs.mkdirSync(this.reportDir, { recursive: true });
  }

  async start(): Promise<void> {
    console.log('🔍 Starting Memory Leak Detection Test');
    console.log(`⏱️  Duration: ${this.testDuration}s`);
    console.log(`📁 Reports: ${this.reportDir}`);
    
    this.startTime = performance.now();
    
    // Enable GC tracking
    this.enableGCTracking();
    
    // Take initial snapshot
    this.takeMemorySnapshot('initial');
    
    // Start WebSocket load test
    await this.startLoadTest();
    
    // Start monitoring
    this.startMemoryMonitoring();
    
    // Schedule heap snapshots
    this.scheduleHeapSnapshots();
    
    // Run for specified duration
    setTimeout(() => {
      this.stop();
    }, this.testDuration * 1000);
  }

  private async startLoadTest(): Promise<void> {
    this.tester = new WebSocketLoadTester({
      url: this.wsUrl,
      targetConnections: 500,
      connectionsPerSecond: 50,
      messageRate: 20, // 20 messages/sec per connection
      testDuration: 0,
      reconnectOnError: true,
      messageGenerator: () => this.generateLeakyMessage(),
    });
    
    // Intentionally create potential memory leaks for testing
    const messageCache = new Map<string, any>();
    const eventHandlers: Function[] = [];
    
    this.tester.on('message', ({ connectionId, message }) => {
      // Potential leak 1: Unbounded cache
      messageCache.set(`${connectionId}-${Date.now()}`, message);
      
      // Potential leak 2: Accumulating event handlers
      const handler = () => console.log(message);
      eventHandlers.push(handler);
      
      // Potential leak 3: Circular references
      message.self = message;
      message.largeData = Buffer.alloc(1024); // 1KB buffer
    });
    
    // Simulate common memory leak patterns
    this.simulateMemoryLeaks();
    
    await this.tester.start();
  }

  private generateLeakyMessage(): any {
    return {
      id: `msg-${Date.now()}-${Math.random()}`,
      type: 'data',
      timestamp: Date.now(),
      // Large payload that might not be cleaned up
      payload: {
        data: new Array(100).fill(0).map(() => ({
          id: Math.random(),
          buffer: Buffer.alloc(100), // 100 bytes per item
          nested: {
            deep: {
              data: 'x'.repeat(100),
            },
          },
        })),
        metadata: {
          sequence: Math.floor(Math.random() * 1000000),
          checksum: 'x'.repeat(1000),
        },
      },
    };
  }

  private simulateMemoryLeaks(): void {
    // Leak pattern 1: Global variable pollution
    (global as any).leakyData = [];
    setInterval(() => {
      (global as any).leakyData.push({
        timestamp: Date.now(),
        data: Buffer.alloc(1024), // 1KB
      });
    }, 100);
    
    // Leak pattern 2: Forgotten timers
    const timers: NodeJS.Timeout[] = [];
    setInterval(() => {
      const timer = setInterval(() => {
        // Do nothing, but timer reference is kept
      }, 1000);
      timers.push(timer);
    }, 1000);
    
    // Leak pattern 3: Event emitter leak
    const EventEmitter = require('events');
    const emitter = new EventEmitter();
    setInterval(() => {
      emitter.on('data', () => {
        // Handler that's never removed
      });
    }, 100);
    
    // Leak pattern 4: Closure leak
    const createClosure = () => {
      const largeData = Buffer.alloc(10240); // 10KB
      return () => largeData.length;
    };
    
    const closures: Function[] = [];
    setInterval(() => {
      closures.push(createClosure());
    }, 100);
  }

  private enableGCTracking(): void {
    // Track GC events
    const originalGC = global.gc;
    if (originalGC) {
      global.gc = () => {
        this.gcCount++;
        originalGC();
      };
    }
    
    // Force periodic GC for testing
    setInterval(() => {
      if (global.gc) {
        global.gc();
      }
    }, 30000); // Every 30 seconds
  }

  private takeMemorySnapshot(label: string): void {
    const memoryUsage = process.memoryUsage();
    
    const snapshot: MemorySnapshot = {
      timestamp: Date.now(),
      heapUsed: memoryUsage.heapUsed,
      heapTotal: memoryUsage.heapTotal,
      rss: memoryUsage.rss,
      external: memoryUsage.external,
      arrayBuffers: memoryUsage.arrayBuffers || 0,
      gcCount: this.gcCount,
    };
    
    this.snapshots.push(snapshot);
    
    // Save detailed report
    this.saveSnapshotReport(snapshot, label);
  }

  private scheduleHeapSnapshots(): void {
    let snapshotCount = 0;
    
    this.heapSnapshotInterval = setInterval(() => {
      snapshotCount++;
      const label = `snapshot-${snapshotCount}`;
      
      console.log(`📸 Taking heap snapshot ${snapshotCount}...`);
      
      // Take V8 heap snapshot
      const heapSnapshot = v8.writeHeapSnapshot(
        path.join(this.reportDir, `heap-${label}.heapsnapshot`)
      );
      
      this.takeMemorySnapshot(label);
      
      // Analyze for leaks
      const leakResult = this.analyzeForLeaks();
      if (leakResult.hasLeak) {
        console.warn('⚠️  Potential memory leak detected!');
        this.displayLeakWarning(leakResult);
      }
    }, this.SNAPSHOT_INTERVAL);
  }

  private startMemoryMonitoring(): void {
    const monitorInterval = setInterval(() => {
      const current = process.memoryUsage();
      const runtime = (performance.now() - this.startTime) / 1000;
      
      console.clear();
      console.log('═══════════════════════════════════════════════════════════════════');
      console.log('                    Memory Leak Detection Test                      ');
      console.log('═══════════════════════════════════════════════════════════════════');
      console.log();
      console.log(`⏱️  Runtime: ${runtime.toFixed(0)}s / ${this.testDuration}s`);
      console.log();
      console.log('💾 Current Memory Usage:');
      console.log(`   Heap Used:       ${(current.heapUsed / 1024 / 1024).toFixed(2)} MB`);
      console.log(`   Heap Total:      ${(current.heapTotal / 1024 / 1024).toFixed(2)} MB`);
      console.log(`   RSS:             ${(current.rss / 1024 / 1024).toFixed(2)} MB`);
      console.log(`   External:        ${(current.external / 1024 / 1024).toFixed(2)} MB`);
      console.log(`   Array Buffers:   ${(current.arrayBuffers / 1024 / 1024).toFixed(2)} MB`);
      console.log();
      
      // Memory growth analysis
      if (this.snapshots.length >= 2) {
        const firstSnapshot = this.snapshots[0];
        const growth = current.heapUsed - firstSnapshot.heapUsed;
        const growthRate = (growth / runtime) * 60 / 1024 / 1024; // MB per minute
        
        console.log('📈 Memory Growth:');
        console.log(`   Total Growth:    ${(growth / 1024 / 1024).toFixed(2)} MB`);
        console.log(`   Growth Rate:     ${growthRate.toFixed(2)} MB/min`);
        console.log(`   GC Count:        ${this.gcCount}`);
        console.log();
        
        // Trend visualization
        const trend = this.getMemoryTrend();
        console.log(`   Memory Trend:    ${trend.icon} ${trend.status}`);
        
        // Mini chart
        this.displayMemoryChart();
      }
      
      // Active connections
      if (this.tester) {
        const metrics = this.tester.getMetrics();
        console.log();
        console.log('🔗 WebSocket Load:');
        console.log(`   Active Connections: ${metrics.activeConnections}`);
        console.log(`   Messages/sec:       ${metrics.messagesPerSecond.toFixed(0)}`);
        console.log(`   Data Rate:          ${(metrics.messagesPerSecond * 300 / 1024 / 1024).toFixed(2)} MB/s`);
      }
      
      console.log();
      console.log('═══════════════════════════════════════════════════════════════════');
    }, this.MONITORING_INTERVAL);
    
    // Clean up on exit
    process.on('exit', () => clearInterval(monitorInterval));
  }

  private analyzeForLeaks(): LeakDetectionResult {
    if (this.snapshots.length < 2) {
      return {
        hasLeak: false,
        leakRate: 0,
        suspectedLeaks: [],
        memoryTrend: 'stable',
        recommendations: [],
      };
    }
    
    // Calculate leak rate
    const firstSnapshot = this.snapshots[0];
    const lastSnapshot = this.snapshots[this.snapshots.length - 1];
    const timeDiffMinutes = (lastSnapshot.timestamp - firstSnapshot.timestamp) / 60000;
    const heapGrowthMB = (lastSnapshot.heapUsed - firstSnapshot.heapUsed) / 1024 / 1024;
    const leakRate = heapGrowthMB / timeDiffMinutes;
    
    // Analyze trend
    const recentSnapshots = this.snapshots.slice(-5);
    const recentGrowth = recentSnapshots.every((s, i) => 
      i === 0 || s.heapUsed > recentSnapshots[i - 1].heapUsed
    );
    
    const hasLeak = leakRate > this.LEAK_THRESHOLD_MB_PER_MIN || recentGrowth;
    
    // Determine trend
    let memoryTrend: 'stable' | 'growing' | 'critical' = 'stable';
    if (leakRate > this.LEAK_THRESHOLD_MB_PER_MIN * 2) {
      memoryTrend = 'critical';
    } else if (leakRate > this.LEAK_THRESHOLD_MB_PER_MIN) {
      memoryTrend = 'growing';
    }
    
    // Suspected leak sources
    const suspectedLeaks: string[] = [];
    if ((global as any).leakyData?.length > 1000) {
      suspectedLeaks.push('Global variable accumulation detected');
    }
    if (lastSnapshot.external > firstSnapshot.external * 2) {
      suspectedLeaks.push('External memory growth (Buffers/ArrayBuffers)');
    }
    if (lastSnapshot.arrayBuffers > 100 * 1024 * 1024) {
      suspectedLeaks.push('Excessive ArrayBuffer usage');
    }
    
    // Recommendations
    const recommendations: string[] = [];
    if (hasLeak) {
      recommendations.push('Review event listener cleanup');
      recommendations.push('Check for unbounded data structures');
      recommendations.push('Verify WebSocket message handling');
      recommendations.push('Analyze heap snapshots in Chrome DevTools');
    }
    
    return {
      hasLeak,
      leakRate,
      suspectedLeaks,
      memoryTrend,
      recommendations,
    };
  }

  private getMemoryTrend(): { icon: string; status: string } {
    const result = this.analyzeForLeaks();
    
    switch (result.memoryTrend) {
      case 'stable':
        return { icon: '✅', status: 'Stable' };
      case 'growing':
        return { icon: '⚠️', status: 'Growing' };
      case 'critical':
        return { icon: '🚨', status: 'Critical' };
    }
  }

  private displayMemoryChart(): void {
    if (this.snapshots.length < 2) return;
    
    const maxHeap = Math.max(...this.snapshots.map(s => s.heapUsed));
    const minHeap = Math.min(...this.snapshots.map(s => s.heapUsed));
    const range = maxHeap - minHeap;
    
    console.log();
    console.log('   Memory Usage Chart (last 10 samples):');
    
    const recentSnapshots = this.snapshots.slice(-10);
    const chartHeight = 5;
    
    for (let row = chartHeight; row >= 0; row--) {
      let line = '   ';
      for (const snapshot of recentSnapshots) {
        const normalized = (snapshot.heapUsed - minHeap) / range;
        const level = Math.round(normalized * chartHeight);
        line += level >= row ? '█' : ' ';
      }
      console.log(line);
    }
    console.log('   ' + '─'.repeat(recentSnapshots.length));
  }

  private displayLeakWarning(result: LeakDetectionResult): void {
    console.log();
    console.log('⚠️  MEMORY LEAK WARNING ⚠️');
    console.log(`Leak Rate: ${result.leakRate.toFixed(2)} MB/min`);
    
    if (result.suspectedLeaks.length > 0) {
      console.log('\nSuspected Causes:');
      for (const leak of result.suspectedLeaks) {
        console.log(`  - ${leak}`);
      }
    }
    
    if (result.recommendations.length > 0) {
      console.log('\nRecommendations:');
      for (const rec of result.recommendations) {
        console.log(`  - ${rec}`);
      }
    }
  }

  private saveSnapshotReport(snapshot: MemorySnapshot, label: string): void {
    const report = {
      label,
      timestamp: new Date(snapshot.timestamp).toISOString(),
      runtime: (snapshot.timestamp - this.snapshots[0].timestamp) / 1000,
      memory: {
        heapUsed: (snapshot.heapUsed / 1024 / 1024).toFixed(2) + ' MB',
        heapTotal: (snapshot.heapTotal / 1024 / 1024).toFixed(2) + ' MB',
        rss: (snapshot.rss / 1024 / 1024).toFixed(2) + ' MB',
        external: (snapshot.external / 1024 / 1024).toFixed(2) + ' MB',
        arrayBuffers: (snapshot.arrayBuffers / 1024 / 1024).toFixed(2) + ' MB',
      },
      analysis: this.analyzeForLeaks(),
    };
    
    fs.writeFileSync(
      path.join(this.reportDir, `report-${label}.json`),
      JSON.stringify(report, null, 2)
    );
  }

  private stop(): void {
    console.log('\n🛑 Stopping memory leak detection test...');
    
    if (this.heapSnapshotInterval) {
      clearInterval(this.heapSnapshotInterval);
    }
    
    if (this.tester) {
      this.tester.stop();
    }
    
    // Take final snapshot
    this.takeMemorySnapshot('final');
    
    // Generate final report
    this.generateFinalReport();
    
    process.exit(0);
  }

  private generateFinalReport(): void {
    const analysis = this.analyzeForLeaks();
    const runtime = (performance.now() - this.startTime) / 1000;
    
    console.log('\n📊 Memory Leak Detection Report:');
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log(`   Test Duration:       ${runtime.toFixed(1)}s`);
    console.log(`   Snapshots Taken:     ${this.snapshots.length}`);
    console.log(`   GC Runs:             ${this.gcCount}`);
    console.log();
    
    const first = this.snapshots[0];
    const last = this.snapshots[this.snapshots.length - 1];
    
    console.log('💾 Memory Usage Summary:');
    console.log(`   Initial Heap:        ${(first.heapUsed / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   Final Heap:          ${(last.heapUsed / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   Total Growth:        ${((last.heapUsed - first.heapUsed) / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   Growth Rate:         ${analysis.leakRate.toFixed(2)} MB/min`);
    console.log();
    
    console.log('🔍 Leak Detection Result:');
    console.log(`   Memory Leak:         ${analysis.hasLeak ? 'DETECTED ❌' : 'NOT DETECTED ✅'}`);
    console.log(`   Memory Trend:        ${analysis.memoryTrend.toUpperCase()}`);
    
    if (analysis.suspectedLeaks.length > 0) {
      console.log();
      console.log('🚨 Suspected Leak Sources:');
      for (const leak of analysis.suspectedLeaks) {
        console.log(`   - ${leak}`);
      }
    }
    
    if (analysis.recommendations.length > 0) {
      console.log();
      console.log('💡 Recommendations:');
      for (const rec of analysis.recommendations) {
        console.log(`   - ${rec}`);
      }
    }
    
    console.log();
    console.log(`📁 Detailed reports saved to: ${this.reportDir}`);
    console.log('   - Heap snapshots (.heapsnapshot) can be analyzed in Chrome DevTools');
    console.log('   - JSON reports contain detailed metrics for each snapshot');
    
    // Save final summary
    const summary = {
      testDuration: runtime,
      memoryLeakDetected: analysis.hasLeak,
      leakRate: analysis.leakRate,
      memoryTrend: analysis.memoryTrend,
      suspectedLeaks: analysis.suspectedLeaks,
      recommendations: analysis.recommendations,
      snapshots: this.snapshots.map((s, i) => ({
        label: i === 0 ? 'initial' : i === this.snapshots.length - 1 ? 'final' : `snapshot-${i}`,
        timestamp: new Date(s.timestamp).toISOString(),
        heapUsedMB: (s.heapUsed / 1024 / 1024).toFixed(2),
        rssMB: (s.rss / 1024 / 1024).toFixed(2),
      })),
    };
    
    fs.writeFileSync(
      path.join(this.reportDir, 'summary.json'),
      JSON.stringify(summary, null, 2)
    );
  }
}

// Run the test
if (require.main === module) {
  const wsUrl = process.env.WS_URL || 'ws://localhost:8080';
  const duration = parseInt(process.env.DURATION || '600'); // 10 minutes default
  
  // Run with --expose-gc flag to enable manual GC
  if (!global.gc) {
    console.warn('⚠️  Warning: Run with --expose-gc flag for better memory analysis');
    console.log('   node --expose-gc memory-leak-test.js');
  }
  
  const test = new MemoryLeakDetectionTest(wsUrl, duration);
  test.start().catch(console.error);
  
  process.on('SIGINT', () => {
    test['stop']();
  });
}