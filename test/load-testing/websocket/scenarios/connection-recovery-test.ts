import { WebSocketLoadTester } from '../WebSocketLoadTester';
import WebSocket from 'ws';
import { performance } from 'perf_hooks';

interface RecoveryMetrics {
  totalDisconnects: number;
  successfulReconnects: number;
  failedReconnects: number;
  averageReconnectTime: number;
  maxReconnectTime: number;
  dataLossDuringDisconnect: number;
  connectionStability: number; // percentage of time connected
  reconnectAttempts: Map<string, number>;
}

export class ConnectionRecoveryTest {
  private metrics: RecoveryMetrics = {
    totalDisconnects: 0,
    successfulReconnects: 0,
    failedReconnects: 0,
    averageReconnectTime: 0,
    maxReconnectTime: 0,
    dataLossDuringDisconnect: 0,
    connectionStability: 100,
    reconnectAttempts: new Map(),
  };
  
  private connectionStates = new Map<string, {
    connected: boolean;
    lastDisconnect?: number;
    lastReconnect?: number;
    reconnectTimes: number[];
    messagesSentBeforeDisconnect: number;
    messagesReceivedAfterReconnect: number;
    lastSequence: number;
  }>();
  
  private startTime: number = 0;
  private totalConnectionTime: number = 0;
  private scenarios: any[] = [];

  constructor(
    private wsUrl: string,
    private connectionCount: number = 100
  ) {}

  async start(): Promise<void> {
    console.log('🚀 Starting Connection Recovery Test');
    console.log(`🔗 Testing with ${this.connectionCount} connections`);
    console.log(`🎯 Scenarios: Network disruption, Server restart, Packet loss, etc.`);
    
    this.startTime = performance.now();
    
    // Create test scenarios
    this.setupScenarios();
    
    // Start connections with recovery enabled
    const tester = new WebSocketLoadTester({
      url: this.wsUrl,
      targetConnections: this.connectionCount,
      connectionsPerSecond: 20,
      messageRate: 10, // 10 messages/sec per connection
      testDuration: 0,
      reconnectOnError: true,
      messageGenerator: () => this.generateSequencedMessage(),
    });
    
    this.setupEventHandlers(tester);
    
    // Start the test
    await tester.start();
    
    // Execute recovery scenarios
    await this.executeScenarios();
    
    // Monitor for duration
    setTimeout(() => {
      this.displayFinalReport();
      tester.stop();
      process.exit(0);
    }, 300000); // 5 minutes
  }

  private setupEventHandlers(tester: WebSocketLoadTester): void {
    // Track connection states
    tester.on('connected', (connectionId: string) => {
      if (!this.connectionStates.has(connectionId)) {
        this.connectionStates.set(connectionId, {
          connected: true,
          reconnectTimes: [],
          messagesSentBeforeDisconnect: 0,
          messagesReceivedAfterReconnect: 0,
          lastSequence: 0,
        });
      } else {
        // This is a reconnection
        const state = this.connectionStates.get(connectionId)!;
        const reconnectTime = performance.now() - (state.lastDisconnect || 0);
        state.reconnectTimes.push(reconnectTime);
        state.connected = true;
        state.lastReconnect = performance.now();
        
        this.metrics.successfulReconnects++;
        this.updateReconnectMetrics();
      }
    });
    
    tester.on('disconnected', (connectionId: string) => {
      const state = this.connectionStates.get(connectionId);
      if (state) {
        state.connected = false;
        state.lastDisconnect = performance.now();
        this.metrics.totalDisconnects++;
      }
    });
    
    tester.on('message', ({ connectionId, message }) => {
      const state = this.connectionStates.get(connectionId);
      if (state && message.sequence) {
        // Check for message gaps
        if (message.sequence > state.lastSequence + 1) {
          const gap = message.sequence - state.lastSequence - 1;
          this.metrics.dataLossDuringDisconnect += gap;
        }
        state.lastSequence = message.sequence;
        
        // Track messages after reconnect
        if (state.lastReconnect && performance.now() - state.lastReconnect < 5000) {
          state.messagesReceivedAfterReconnect++;
        }
      }
    });
    
    // Monitor connection stability
    setInterval(() => {
      let connectedCount = 0;
      for (const state of this.connectionStates.values()) {
        if (state.connected) connectedCount++;
      }
      
      const stability = (connectedCount / this.connectionStates.size) * 100;
      this.metrics.connectionStability = stability;
      
      this.displayMetrics();
    }, 1000);
  }

  private generateSequencedMessage(): any {
    return {
      type: 'test_message',
      sequence: Math.floor(Math.random() * 1000000),
      timestamp: Date.now(),
      data: {
        random: Math.random(),
        payload: 'x'.repeat(100), // 100 byte payload
      },
    };
  }

  private setupScenarios(): void {
    // Scenario 1: Simulate network interruption
    this.scenarios.push({
      name: 'Network Interruption',
      delay: 30000, // 30 seconds after start
      execute: async () => {
        console.log('\n🔥 Scenario 1: Simulating network interruption');
        // In a real test, you would actually interrupt the network
        // For this simulation, we'll close random connections
        const connections = Array.from((global as any).activeWebSockets || []);
        const toDisconnect = Math.floor(connections.length * 0.3); // 30% of connections
        
        for (let i = 0; i < toDisconnect; i++) {
          const ws = connections[Math.floor(Math.random() * connections.length)];
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.close(1006, 'Network interruption simulation');
          }
        }
      },
    });
    
    // Scenario 2: Simulate server restart
    this.scenarios.push({
      name: 'Server Restart',
      delay: 60000, // 1 minute after start
      execute: async () => {
        console.log('\n🔥 Scenario 2: Simulating server restart');
        // Close all connections with specific code
        const connections = Array.from((global as any).activeWebSockets || []);
        for (const ws of connections) {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.close(1001, 'Server restart');
          }
        }
      },
    });
    
    // Scenario 3: Intermittent connectivity
    this.scenarios.push({
      name: 'Intermittent Connectivity',
      delay: 90000, // 1.5 minutes after start
      execute: async () => {
        console.log('\n🔥 Scenario 3: Simulating intermittent connectivity');
        const interval = setInterval(() => {
          const connections = Array.from((global as any).activeWebSockets || []);
          const toDisconnect = Math.floor(Math.random() * 10); // Random 0-10 connections
          
          for (let i = 0; i < toDisconnect; i++) {
            const ws = connections[Math.floor(Math.random() * connections.length)];
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.close(1006, 'Intermittent connectivity');
            }
          }
        }, 2000); // Every 2 seconds
        
        // Stop after 30 seconds
        setTimeout(() => clearInterval(interval), 30000);
      },
    });
    
    // Scenario 4: Rapid connect/disconnect
    this.scenarios.push({
      name: 'Rapid Connect/Disconnect',
      delay: 120000, // 2 minutes after start
      execute: async () => {
        console.log('\n🔥 Scenario 4: Rapid connect/disconnect test');
        const connections = Array.from((global as any).activeWebSockets || []);
        const targets = connections.slice(0, 20); // Target 20 connections
        
        for (let i = 0; i < 10; i++) {
          setTimeout(() => {
            for (const ws of targets) {
              if (ws && ws.readyState === WebSocket.OPEN) {
                ws.close(1000, 'Rapid test');
              }
            }
          }, i * 1000);
        }
      },
    });
  }

  private async executeScenarios(): Promise<void> {
    for (const scenario of this.scenarios) {
      setTimeout(() => {
        scenario.execute().catch(console.error);
      }, scenario.delay);
    }
  }

  private updateReconnectMetrics(): void {
    const allReconnectTimes: number[] = [];
    for (const state of this.connectionStates.values()) {
      allReconnectTimes.push(...state.reconnectTimes);
    }
    
    if (allReconnectTimes.length > 0) {
      this.metrics.averageReconnectTime = 
        allReconnectTimes.reduce((a, b) => a + b, 0) / allReconnectTimes.length;
      this.metrics.maxReconnectTime = Math.max(...allReconnectTimes);
    }
  }

  private displayMetrics(): void {
    const runtime = (performance.now() - this.startTime) / 1000;
    const reconnectRate = this.metrics.totalDisconnects > 0
      ? (this.metrics.successfulReconnects / this.metrics.totalDisconnects) * 100
      : 100;
    
    console.clear();
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log('                    Connection Recovery Test                        ');
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log();
    console.log(`⏱️  Runtime: ${runtime.toFixed(0)}s`);
    console.log();
    console.log('🔗 Connection Metrics:');
    console.log(`   Active Connections:   ${this.connectionStates.size}`);
    console.log(`   Connection Stability: ${this.metrics.connectionStability.toFixed(1)}%`);
    console.log();
    console.log('🔄 Recovery Metrics:');
    console.log(`   Total Disconnects:    ${this.metrics.totalDisconnects}`);
    console.log(`   Successful Reconnects: ${this.metrics.successfulReconnects}`);
    console.log(`   Failed Reconnects:    ${this.metrics.failedReconnects}`);
    console.log(`   Recovery Rate:        ${reconnectRate.toFixed(1)}%`);
    console.log();
    console.log('⏱️  Timing Metrics:');
    console.log(`   Avg Reconnect Time:   ${this.metrics.averageReconnectTime.toFixed(0)}ms`);
    console.log(`   Max Reconnect Time:   ${this.metrics.maxReconnectTime.toFixed(0)}ms`);
    console.log();
    console.log('📊 Data Integrity:');
    console.log(`   Messages Lost:        ${this.metrics.dataLossDuringDisconnect}`);
    console.log(`   Loss Rate:            ${(this.metrics.dataLossDuringDisconnect / (runtime * 10 * this.connectionCount) * 100).toFixed(3)}%`);
    
    // Show recent disconnects
    const recentDisconnects = Array.from(this.connectionStates.entries())
      .filter(([_, state]) => !state.connected && state.lastDisconnect)
      .sort((a, b) => b[1].lastDisconnect! - a[1].lastDisconnect!)
      .slice(0, 5);
    
    if (recentDisconnects.length > 0) {
      console.log();
      console.log('🚨 Recent Disconnections:');
      for (const [id, state] of recentDisconnects) {
        const timeSince = ((performance.now() - state.lastDisconnect!) / 1000).toFixed(1);
        console.log(`   ${id.substring(0, 8)}... - ${timeSince}s ago`);
      }
    }
    
    console.log();
    console.log('═══════════════════════════════════════════════════════════════════');
  }

  private displayFinalReport(): void {
    console.log('\n📊 Final Connection Recovery Report:');
    console.log('═══════════════════════════════════════════════════════════════════');
    
    const runtime = (performance.now() - this.startTime) / 1000;
    const overallStability = (this.totalConnectionTime / (runtime * this.connectionCount)) * 100;
    
    console.log(`   Test Duration:        ${runtime.toFixed(1)}s`);
    console.log(`   Total Connections:    ${this.connectionCount}`);
    console.log(`   Total Disconnects:    ${this.metrics.totalDisconnects}`);
    console.log(`   Recovery Success:     ${((this.metrics.successfulReconnects / this.metrics.totalDisconnects) * 100).toFixed(1)}%`);
    console.log(`   Overall Stability:    ${overallStability.toFixed(1)}%`);
    console.log(`   Avg Recovery Time:    ${this.metrics.averageReconnectTime.toFixed(0)}ms`);
    console.log(`   Data Loss Rate:       ${(this.metrics.dataLossDuringDisconnect / (runtime * 10 * this.connectionCount) * 100).toFixed(3)}%`);
    
    // Connection distribution
    const reconnectDistribution = new Map<string, number>();
    for (const state of this.connectionStates.values()) {
      const bucket = `${Math.floor(state.reconnectTimes.length / 5) * 5}-${Math.floor(state.reconnectTimes.length / 5) * 5 + 4}`;
      reconnectDistribution.set(bucket, (reconnectDistribution.get(bucket) || 0) + 1);
    }
    
    console.log();
    console.log('📈 Reconnection Distribution:');
    for (const [bucket, count] of Array.from(reconnectDistribution).sort((a, b) => parseInt(a[0]) - parseInt(b[0]))) {
      console.log(`   ${bucket} reconnects: ${count} connections`);
    }
    
    // Recovery time distribution
    console.log();
    console.log('⏱️  Recovery Time Distribution:');
    const times = [];
    for (const state of this.connectionStates.values()) {
      times.push(...state.reconnectTimes);
    }
    times.sort((a, b) => a - b);
    
    if (times.length > 0) {
      console.log(`   Min:  ${times[0].toFixed(0)}ms`);
      console.log(`   P50:  ${times[Math.floor(times.length * 0.5)].toFixed(0)}ms`);
      console.log(`   P90:  ${times[Math.floor(times.length * 0.9)].toFixed(0)}ms`);
      console.log(`   P99:  ${times[Math.floor(times.length * 0.99)].toFixed(0)}ms`);
      console.log(`   Max:  ${times[times.length - 1].toFixed(0)}ms`);
    }
    
    console.log();
    console.log('✅ Recovery test completed successfully!');
  }
}

// Track active WebSocket connections globally for scenarios
(global as any).activeWebSockets = new Set();

const originalWebSocket = WebSocket;
(WebSocket as any) = class extends originalWebSocket {
  constructor(address: string | URL, protocols?: string | string[], options?: WebSocket.ClientOptions) {
    super(address, protocols, options);
    (global as any).activeWebSockets.add(this);
    
    this.on('close', () => {
      (global as any).activeWebSockets.delete(this);
    });
  }
};

// Run the test
if (require.main === module) {
  const wsUrl = process.env.WS_URL || 'ws://localhost:8080';
  const connectionCount = parseInt(process.env.CONNECTIONS || '100');
  
  const test = new ConnectionRecoveryTest(wsUrl, connectionCount);
  test.start().catch(console.error);
  
  process.on('SIGINT', () => {
    console.log('\n🛑 Stopping recovery test...');
    process.exit(0);
  });
}