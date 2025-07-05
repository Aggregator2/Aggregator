#!/usr/bin/env node

import { io, Socket } from 'socket.io-client';
import Redis from 'ioredis';
import { performance } from 'perf_hooks';

interface HealthCheckResult {
  service: string;
  status: 'pass' | 'fail' | 'warning';
  latency?: number;
  details: any;
  timestamp: number;
}

class WebSocketRedisHealthChecker {
  private results: HealthCheckResult[] = [];
  private redis: Redis | null = null;
  private wsClient: Socket | null = null;

  async runHealthChecks(): Promise<void> {
    console.log('🏥 Running WebSocket & Redis Health Checks...\n');

    try {
      // Redis health checks
      await this.checkRedisConnection();
      await this.checkRedisOperations();
      await this.checkRedisPubSub();
      await this.checkRedisMemory();

      // WebSocket health checks
      await this.checkWebSocketConnection();
      await this.checkWebSocketSubscriptions();
      await this.checkWebSocketLatency();
      await this.checkWebSocketScaling();

      // Integration checks
      await this.checkIntegration();

      // Generate report
      this.generateReport();
    } catch (error) {
      console.error('Health check failed:', error);
    } finally {
      await this.cleanup();
    }
  }

  // Redis Health Checks
  private async checkRedisConnection(): Promise<void> {
    console.log('🔍 Checking Redis connection...');
    const startTime = performance.now();

    try {
      this.redis = new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD,
        connectTimeout: 5000,
        maxRetriesPerRequest: 1
      });

      await this.redis.ping();
      const latency = performance.now() - startTime;

      this.results.push({
        service: 'Redis Connection',
        status: latency < 100 ? 'pass' : 'warning',
        latency,
        details: {
          host: process.env.REDIS_HOST || 'localhost',
          port: process.env.REDIS_PORT || '6379',
          connected: true
        },
        timestamp: Date.now()
      });

      console.log(`✅ Redis connected (${latency.toFixed(2)}ms)`);
    } catch (error) {
      this.results.push({
        service: 'Redis Connection',
        status: 'fail',
        details: { error: error.message },
        timestamp: Date.now()
      });
      console.log('❌ Redis connection failed');
    }
  }

  private async checkRedisOperations(): Promise<void> {
    if (!this.redis) return;

    console.log('🔍 Checking Redis operations...');
    const operations = [
      { name: 'SET', test: () => this.redis!.set('health:test', 'value') },
      { name: 'GET', test: () => this.redis!.get('health:test') },
      { name: 'HSET', test: () => this.redis!.hset('health:hash', 'field', 'value') },
      { name: 'ZADD', test: () => this.redis!.zadd('health:sorted', 1, 'member') },
      { name: 'LPUSH', test: () => this.redis!.lpush('health:list', 'item') }
    ];

    for (const op of operations) {
      const startTime = performance.now();
      try {
        await op.test();
        const latency = performance.now() - startTime;
        
        console.log(`  ✅ ${op.name}: ${latency.toFixed(2)}ms`);
      } catch (error) {
        console.log(`  ❌ ${op.name}: Failed`);
      }
    }

    // Cleanup test keys
    await this.redis.del('health:test', 'health:hash', 'health:sorted', 'health:list');
  }

  private async checkRedisPubSub(): Promise<void> {
    if (!this.redis) return;

    console.log('🔍 Checking Redis Pub/Sub...');
    const startTime = performance.now();

    try {
      const subscriber = new Redis(this.redis.options);
      const publisher = new Redis(this.redis.options);
      
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Pub/Sub timeout')), 5000);
        
        subscriber.on('message', (channel, message) => {
          if (channel === 'health:test' && message === 'test-message') {
            clearTimeout(timeout);
            resolve();
          }
        });

        subscriber.subscribe('health:test').then(() => {
          publisher.publish('health:test', 'test-message');
        });
      });

      const latency = performance.now() - startTime;
      
      this.results.push({
        service: 'Redis Pub/Sub',
        status: latency < 200 ? 'pass' : 'warning',
        latency,
        details: { working: true },
        timestamp: Date.now()
      });

      console.log(`✅ Redis Pub/Sub working (${latency.toFixed(2)}ms)`);
      
      await subscriber.quit();
      await publisher.quit();
    } catch (error) {
      this.results.push({
        service: 'Redis Pub/Sub',
        status: 'fail',
        details: { error: error.message },
        timestamp: Date.now()
      });
      console.log('❌ Redis Pub/Sub failed');
    }
  }

  private async checkRedisMemory(): Promise<void> {
    if (!this.redis) return;

    console.log('🔍 Checking Redis memory...');
    
    try {
      const info = await this.redis.info('memory');
      const lines = info.split('\r\n');
      const memoryUsed = lines.find(l => l.startsWith('used_memory_human:'))?.split(':')[1];
      const memoryPeak = lines.find(l => l.startsWith('used_memory_peak_human:'))?.split(':')[1];
      
      this.results.push({
        service: 'Redis Memory',
        status: 'pass',
        details: {
          used: memoryUsed,
          peak: memoryPeak
        },
        timestamp: Date.now()
      });

      console.log(`✅ Redis memory: ${memoryUsed} (peak: ${memoryPeak})`);
    } catch (error) {
      console.log('❌ Redis memory check failed');
    }
  }

  // WebSocket Health Checks
  private async checkWebSocketConnection(): Promise<void> {
    console.log('🔍 Checking WebSocket connection...');
    const startTime = performance.now();

    try {
      this.wsClient = io('http://localhost:3001', {
        transports: ['websocket'],
        reconnection: false,
        timeout: 5000
      });

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Connection timeout')), 5000);
        
        this.wsClient!.on('connect', () => {
          clearTimeout(timeout);
          resolve();
        });

        this.wsClient!.on('connect_error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });

      const latency = performance.now() - startTime;
      
      this.results.push({
        service: 'WebSocket Connection',
        status: latency < 1000 ? 'pass' : 'warning',
        latency,
        details: {
          connected: true,
          id: this.wsClient.id
        },
        timestamp: Date.now()
      });

      console.log(`✅ WebSocket connected (${latency.toFixed(2)}ms)`);
    } catch (error) {
      this.results.push({
        service: 'WebSocket Connection',
        status: 'fail',
        details: { error: error.message },
        timestamp: Date.now()
      });
      console.log('❌ WebSocket connection failed');
    }
  }

  private async checkWebSocketSubscriptions(): Promise<void> {
    if (!this.wsClient || !this.wsClient.connected) return;

    console.log('🔍 Checking WebSocket subscriptions...');
    const subscriptions = ['orderbook', 'trades', 'market'];
    
    for (const sub of subscriptions) {
      const startTime = performance.now();
      
      try {
        await new Promise<void>((resolve) => {
          const eventName = `${sub}:snapshot`;
          
          this.wsClient!.once(eventName, () => {
            const latency = performance.now() - startTime;
            console.log(`  ✅ ${sub}: ${latency.toFixed(2)}ms`);
            resolve();
          });

          this.wsClient!.emit(`subscribe:${sub}`, ['ETH/USDC']);
          
          // Timeout fallback
          setTimeout(resolve, 2000);
        });
      } catch (error) {
        console.log(`  ❌ ${sub}: Failed`);
      }
    }
  }

  private async checkWebSocketLatency(): Promise<void> {
    if (!this.wsClient || !this.wsClient.connected) return;

    console.log('🔍 Checking WebSocket latency...');
    const measurements: number[] = [];

    for (let i = 0; i < 10; i++) {
      const startTime = performance.now();
      
      await new Promise<void>((resolve) => {
        this.wsClient!.emit('ping');
        this.wsClient!.once('pong', () => {
          const latency = performance.now() - startTime;
          measurements.push(latency);
          resolve();
        });
      });
    }

    const avgLatency = measurements.reduce((a, b) => a + b, 0) / measurements.length;
    const maxLatency = Math.max(...measurements);
    const minLatency = Math.min(...measurements);

    this.results.push({
      service: 'WebSocket Latency',
      status: avgLatency < 50 ? 'pass' : 'warning',
      latency: avgLatency,
      details: {
        avg: avgLatency.toFixed(2) + 'ms',
        min: minLatency.toFixed(2) + 'ms',
        max: maxLatency.toFixed(2) + 'ms',
        samples: measurements.length
      },
      timestamp: Date.now()
    });

    console.log(`✅ WebSocket latency: avg ${avgLatency.toFixed(2)}ms (${minLatency.toFixed(2)}-${maxLatency.toFixed(2)}ms)`);
  }

  private async checkWebSocketScaling(): Promise<void> {
    console.log('🔍 Checking WebSocket scaling...');
    const clients: Socket[] = [];
    const connectionCount = 20;

    try {
      // Create multiple connections
      for (let i = 0; i < connectionCount; i++) {
        const client = io('http://localhost:3001', {
          transports: ['websocket'],
          reconnection: false
        });

        await new Promise<void>((resolve) => {
          client.on('connect', resolve);
          setTimeout(resolve, 1000); // Timeout
        });

        if (client.connected) {
          clients.push(client);
        }
      }

      const connectedCount = clients.filter(c => c.connected).length;
      
      this.results.push({
        service: 'WebSocket Scaling',
        status: connectedCount === connectionCount ? 'pass' : 'warning',
        details: {
          attempted: connectionCount,
          connected: connectedCount,
          successRate: (connectedCount / connectionCount * 100).toFixed(2) + '%'
        },
        timestamp: Date.now()
      });

      console.log(`✅ WebSocket scaling: ${connectedCount}/${connectionCount} connected`);
    } finally {
      // Cleanup
      clients.forEach(c => c.disconnect());
    }
  }

  // Integration Health Check
  private async checkIntegration(): Promise<void> {
    if (!this.redis || !this.wsClient || !this.wsClient.connected) return;

    console.log('🔍 Checking WebSocket-Redis integration...');
    const testKey = 'integration:test:order';
    const testOrder = {
      id: 'health-check-order',
      pair: 'ETH/USDC',
      price: 2000,
      quantity: 1
    };

    try {
      // Store in Redis
      await this.redis.hset(testKey, testOrder);
      
      // Subscribe to updates
      const updateReceived = new Promise<boolean>((resolve) => {
        this.wsClient!.on('orderbook:update', () => {
          resolve(true);
        });
        
        setTimeout(() => resolve(false), 3000);
      });

      // Simulate update via Redis pub/sub
      await this.redis.publish('orderbook:ETH/USDC', JSON.stringify({
        type: 'update',
        data: testOrder
      }));

      const received = await updateReceived;
      
      this.results.push({
        service: 'WebSocket-Redis Integration',
        status: received ? 'pass' : 'warning',
        details: {
          pubSubWorking: received
        },
        timestamp: Date.now()
      });

      console.log(`${received ? '✅' : '⚠️'} WebSocket-Redis integration: ${received ? 'Working' : 'Degraded'}`);
      
      // Cleanup
      await this.redis.del(testKey);
    } catch (error) {
      console.log('❌ Integration check failed');
    }
  }

  private generateReport(): void {
    console.log('\n' + '='.repeat(50));
    console.log('HEALTH CHECK SUMMARY');
    console.log('='.repeat(50));

    const passed = this.results.filter(r => r.status === 'pass').length;
    const warnings = this.results.filter(r => r.status === 'warning').length;
    const failed = this.results.filter(r => r.status === 'fail').length;

    console.log(`Total Checks: ${this.results.length}`);
    console.log(`✅ Passed: ${passed}`);
    console.log(`⚠️  Warnings: ${warnings}`);
    console.log(`❌ Failed: ${failed}`);

    if (failed > 0) {
      console.log('\nFailed Checks:');
      this.results.filter(r => r.status === 'fail').forEach(r => {
        console.log(`  - ${r.service}: ${r.details.error || 'Unknown error'}`);
      });
    }

    if (warnings > 0) {
      console.log('\nWarnings:');
      this.results.filter(r => r.status === 'warning').forEach(r => {
        console.log(`  - ${r.service}: High latency (${r.latency?.toFixed(2)}ms)`);
      });
    }

    // Overall health status
    const overallStatus = failed > 0 ? 'UNHEALTHY' : warnings > 2 ? 'DEGRADED' : 'HEALTHY';
    console.log(`\nOverall Status: ${overallStatus}`);

    // Save detailed report
    const fs = require('fs');
    const reportPath = `./health-report-${Date.now()}.json`;
    fs.writeFileSync(reportPath, JSON.stringify({
      timestamp: new Date().toISOString(),
      status: overallStatus,
      summary: { passed, warnings, failed },
      checks: this.results
    }, null, 2));

    console.log(`\nDetailed report saved to: ${reportPath}`);
  }

  private async cleanup(): Promise<void> {
    if (this.wsClient) {
      this.wsClient.disconnect();
    }
    if (this.redis) {
      await this.redis.quit();
    }
  }
}

// Run health checks
const checker = new WebSocketRedisHealthChecker();
checker.runHealthChecks().catch(console.error);