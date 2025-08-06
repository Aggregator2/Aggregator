import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { performance } from 'perf_hooks';
import * as os from 'os';
import { v4 as uuidv4 } from 'uuid';

export interface LoadTestConfig {
  url: string;
  targetConnections: number;
  connectionsPerSecond: number;
  messageRate: number; // messages per second per connection
  testDuration: number; // seconds
  reconnectOnError: boolean;
  messageGenerator?: () => any;
  authToken?: string;
}

export interface TestMetrics {
  totalConnections: number;
  activeConnections: number;
  failedConnections: number;
  totalMessagesSent: number;
  totalMessagesReceived: number;
  totalBytes: number;
  averageLatency: number;
  p95Latency: number;
  p99Latency: number;
  errors: Map<string, number>;
  memoryUsage: NodeJS.MemoryUsage;
  cpuUsage: NodeJS.CpuUsage;
  connectTimeMs: number[];
  messageLatencies: number[];
}

export class WebSocketLoadTester extends EventEmitter {
  private config: LoadTestConfig;
  private connections: Map<string, WebSocket> = new Map();
  private metrics: TestMetrics;
  private startTime: number = 0;
  private messageTimestamps: Map<string, number> = new Map();
  private connectionAttempts: number = 0;
  private isRunning: boolean = false;
  private metricsInterval?: NodeJS.Timeout;
  private connectionInterval?: NodeJS.Timeout;
  private testTimeout?: NodeJS.Timeout;

  constructor(config: LoadTestConfig) {
    super();
    this.config = config;
    this.metrics = this.initializeMetrics();
  }

  private initializeMetrics(): TestMetrics {
    return {
      totalConnections: 0,
      activeConnections: 0,
      failedConnections: 0,
      totalMessagesSent: 0,
      totalMessagesReceived: 0,
      totalBytes: 0,
      averageLatency: 0,
      p95Latency: 0,
      p99Latency: 0,
      errors: new Map(),
      memoryUsage: process.memoryUsage(),
      cpuUsage: process.cpuUsage(),
      connectTimeMs: [],
      messageLatencies: [],
    };
  }

  async start(): Promise<void> {
    console.log(`🚀 Starting WebSocket load test...`);
    console.log(`Target: ${this.config.targetConnections} connections`);
    console.log(`Rate: ${this.config.connectionsPerSecond} connections/sec`);
    console.log(`Message rate: ${this.config.messageRate} msg/sec/connection`);
    
    this.isRunning = true;
    this.startTime = performance.now();
    
    // Start metrics collection
    this.startMetricsCollection();
    
    // Start creating connections
    await this.rampUpConnections();
    
    // Run for specified duration
    if (this.config.testDuration > 0) {
      this.testTimeout = setTimeout(() => {
        this.stop();
      }, this.config.testDuration * 1000);
    }
  }

  private async rampUpConnections(): Promise<void> {
    const batchSize = Math.min(10, this.config.connectionsPerSecond);
    const batchDelay = 1000 / (this.config.connectionsPerSecond / batchSize);
    
    this.connectionInterval = setInterval(async () => {
      if (!this.isRunning) {
        clearInterval(this.connectionInterval!);
        return;
      }
      
      if (this.connections.size >= this.config.targetConnections) {
        clearInterval(this.connectionInterval!);
        console.log(`✅ Reached target connections: ${this.connections.size}`);
        this.emit('targetReached', this.connections.size);
        return;
      }
      
      // Create batch of connections
      const promises: Promise<void>[] = [];
      for (let i = 0; i < batchSize && this.connections.size < this.config.targetConnections; i++) {
        promises.push(this.createConnection());
      }
      
      await Promise.allSettled(promises);
    }, batchDelay);
  }

  private async createConnection(): Promise<void> {
    const connectionId = uuidv4();
    const connectStart = performance.now();
    
    try {
      const ws = new WebSocket(this.config.url, {
        headers: this.config.authToken ? {
          'Authorization': `Bearer ${this.config.authToken}`
        } : undefined,
        perMessageDeflate: false, // Disable compression for performance
      });
      
      ws.on('open', () => {
        const connectTime = performance.now() - connectStart;
        this.metrics.connectTimeMs.push(connectTime);
        this.metrics.totalConnections++;
        this.metrics.activeConnections++;
        
        this.connections.set(connectionId, ws);
        this.setupMessageHandlers(ws, connectionId);
        this.startSendingMessages(ws, connectionId);
        
        this.emit('connected', connectionId);
      });
      
      ws.on('error', (error) => {
        this.handleError('connection', error);
        this.metrics.failedConnections++;
        
        if (this.config.reconnectOnError && this.isRunning) {
          setTimeout(() => this.createConnection(), 1000);
        }
      });
      
      ws.on('close', () => {
        this.connections.delete(connectionId);
        this.metrics.activeConnections--;
        this.emit('disconnected', connectionId);
        
        if (this.config.reconnectOnError && this.isRunning) {
          setTimeout(() => this.createConnection(), 1000);
        }
      });
      
    } catch (error) {
      this.handleError('connection', error);
      this.metrics.failedConnections++;
    }
  }

  private setupMessageHandlers(ws: WebSocket, connectionId: string): void {
    ws.on('message', (data: WebSocket.Data) => {
      try {
        const message = JSON.parse(data.toString());
        this.metrics.totalMessagesReceived++;
        this.metrics.totalBytes += data.toString().length;
        
        // Calculate latency if message has timestamp
        if (message.id && this.messageTimestamps.has(message.id)) {
          const latency = performance.now() - this.messageTimestamps.get(message.id)!;
          this.metrics.messageLatencies.push(latency);
          this.messageTimestamps.delete(message.id);
          
          // Clean up old timestamps to prevent memory leak
          if (this.messageTimestamps.size > 10000) {
            const cutoff = performance.now() - 30000; // 30 seconds
            for (const [id, timestamp] of this.messageTimestamps) {
              if (timestamp < cutoff) {
                this.messageTimestamps.delete(id);
              }
            }
          }
        }
        
        this.emit('message', { connectionId, message });
      } catch (error) {
        this.handleError('message_parse', error);
      }
    });
    
    ws.on('ping', () => {
      ws.pong();
    });
  }

  private startSendingMessages(ws: WebSocket, connectionId: string): void {
    if (this.config.messageRate <= 0) return;
    
    const messageInterval = 1000 / this.config.messageRate;
    
    const sendMessage = () => {
      if (!this.isRunning || ws.readyState !== WebSocket.OPEN) {
        return;
      }
      
      try {
        const message = this.generateMessage();
        const messageStr = JSON.stringify(message);
        
        ws.send(messageStr, (error) => {
          if (error) {
            this.handleError('send', error);
          } else {
            this.metrics.totalMessagesSent++;
            this.metrics.totalBytes += messageStr.length;
            
            if (message.id) {
              this.messageTimestamps.set(message.id, performance.now());
            }
          }
        });
      } catch (error) {
        this.handleError('message_generation', error);
      }
      
      // Schedule next message
      setTimeout(sendMessage, messageInterval + Math.random() * messageInterval * 0.1);
    };
    
    // Start sending messages
    setTimeout(sendMessage, Math.random() * messageInterval);
  }

  private generateMessage(): any {
    if (this.config.messageGenerator) {
      return this.config.messageGenerator();
    }
    
    // Default message
    return {
      id: uuidv4(),
      type: 'ping',
      timestamp: Date.now(),
      data: {
        connectionId: uuidv4(),
        random: Math.random(),
      }
    };
  }

  private handleError(type: string, error: any): void {
    const errorKey = `${type}: ${error.message || error}`;
    this.metrics.errors.set(errorKey, (this.metrics.errors.get(errorKey) || 0) + 1);
    
    if (this.metrics.errors.get(errorKey)! <= 5) {
      console.error(`❌ Error [${type}]:`, error.message || error);
    }
  }

  private startMetricsCollection(): void {
    this.metricsInterval = setInterval(() => {
      // Update system metrics
      this.metrics.memoryUsage = process.memoryUsage();
      this.metrics.cpuUsage = process.cpuUsage();
      
      // Calculate latency percentiles
      if (this.metrics.messageLatencies.length > 0) {
        const sorted = [...this.metrics.messageLatencies].sort((a, b) => a - b);
        const p95Index = Math.floor(sorted.length * 0.95);
        const p99Index = Math.floor(sorted.length * 0.99);
        
        this.metrics.averageLatency = sorted.reduce((a, b) => a + b, 0) / sorted.length;
        this.metrics.p95Latency = sorted[p95Index] || 0;
        this.metrics.p99Latency = sorted[p99Index] || 0;
      }
      
      this.emit('metrics', this.getMetrics());
    }, 1000);
  }

  stop(): void {
    console.log('🛑 Stopping load test...');
    this.isRunning = false;
    
    // Clear intervals
    if (this.connectionInterval) clearInterval(this.connectionInterval);
    if (this.metricsInterval) clearInterval(this.metricsInterval);
    if (this.testTimeout) clearTimeout(this.testTimeout);
    
    // Close all connections
    for (const [id, ws] of this.connections) {
      ws.close();
    }
    
    this.connections.clear();
    this.emit('complete', this.getMetrics());
  }

  getMetrics(): TestMetrics & { duration: number; messagesPerSecond: number } {
    const duration = (performance.now() - this.startTime) / 1000;
    const messagesPerSecond = this.metrics.totalMessagesSent / duration;
    
    return {
      ...this.metrics,
      duration,
      messagesPerSecond,
    };
  }

  // Memory leak detection
  async detectMemoryLeaks(duration: number): Promise<void> {
    const samples: NodeJS.MemoryUsage[] = [];
    const interval = 5000; // Sample every 5 seconds
    
    const sampleInterval = setInterval(() => {
      samples.push(process.memoryUsage());
      
      if (samples.length > 10) {
        // Analyze trend
        const heapTrend = this.calculateTrend(samples.map(s => s.heapUsed));
        const rssTrend = this.calculateTrend(samples.map(s => s.rss));
        
        if (heapTrend > 0.1 || rssTrend > 0.1) {
          console.warn('⚠️  Potential memory leak detected!');
          console.warn(`Heap trend: +${(heapTrend * 100).toFixed(2)}% per sample`);
          console.warn(`RSS trend: +${(rssTrend * 100).toFixed(2)}% per sample`);
          this.emit('memoryLeak', { heapTrend, rssTrend, samples });
        }
      }
    }, interval);
    
    setTimeout(() => {
      clearInterval(sampleInterval);
    }, duration * 1000);
  }

  private calculateTrend(values: number[]): number {
    if (values.length < 2) return 0;
    
    // Simple linear regression
    const n = values.length;
    const sumX = (n * (n - 1)) / 2;
    const sumY = values.reduce((a, b) => a + b, 0);
    const sumXY = values.reduce((sum, y, x) => sum + x * y, 0);
    const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const avgY = sumY / n;
    
    return avgY > 0 ? slope / avgY : 0;
  }
}

// Export types
export type { TestMetrics };