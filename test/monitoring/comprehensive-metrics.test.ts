import { Pool } from 'pg';
import Redis from 'ioredis';
import { BusinessMetricsCollector } from '../../monitoring/metrics/BusinessMetricsCollector';
import { TechnicalMetricsCollector } from '../../monitoring/metrics/TechnicalMetricsCollector';
import { InfrastructureMetricsCollector } from '../../monitoring/metrics/InfrastructureMetricsCollector';
import { DEXMetricsExporter, defaultDEXMetricsConfig } from '../../monitoring/metrics/DEXMetricsExporter';
import * as request from 'supertest';

// Mock implementations
jest.mock('pg');
jest.mock('ioredis');

describe('Comprehensive Metrics Collection', () => {
  let db: jest.Mocked<Pool>;
  let redis: jest.Mocked<Redis>;
  let businessCollector: BusinessMetricsCollector;
  let technicalCollector: TechnicalMetricsCollector;
  let infrastructureCollector: InfrastructureMetricsCollector;
  let dexExporter: DEXMetricsExporter;

  beforeEach(() => {
    // Setup mocks
    db = new Pool() as jest.Mocked<Pool>;
    redis = new Redis() as jest.Mocked<Redis>;
    
    // Mock database queries
    db.query = jest.fn().mockResolvedValue({
      rows: [
        { 
          total_count: '1000',
          status: 'executed',
          pair: 'ETH/USDT',
          avg_size: '1500.50',
          large_orders: '10'
        }
      ]
    });
    
    // Mock Redis operations
    redis.setex = jest.fn().mockResolvedValue('OK');
    redis.zadd = jest.fn().mockResolvedValue(1);
    redis.zremrangebyscore = jest.fn().mockResolvedValue(0);
    redis.zrevrange = jest.fn().mockResolvedValue(['1000', '500']);
    redis.zrange = jest.fn().mockResolvedValue(['2000', '1000']);
    redis.info = jest.fn().mockResolvedValue(`
      used_memory:1000000
      used_memory_peak:2000000
      connected_clients:10
      instantaneous_ops_per_sec:1000
    `);
    redis.ping = jest.fn().mockResolvedValue('PONG');

    // Initialize collectors
    businessCollector = new BusinessMetricsCollector(db, redis);
    technicalCollector = new TechnicalMetricsCollector(redis);
    infrastructureCollector = new InfrastructureMetricsCollector(redis, db);
    
    // Initialize exporter
    dexExporter = new DEXMetricsExporter(
      {
        ...defaultDEXMetricsConfig,
        port: 9091, // Use different port for tests
        updateInterval: 1000, // Fast updates for testing
      },
      db,
      redis
    );
  });

  afterEach(() => {
    businessCollector.stop();
    infrastructureCollector.stop();
    dexExporter.stop();
    jest.clearAllMocks();
  });

  describe('Business Metrics Collection', () => {
    it('should collect order metrics', async () => {
      await businessCollector.start(1000);
      
      // Wait for initial collection
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const metrics = businessCollector.getCurrentMetrics();
      
      expect(metrics).toBeDefined();
      expect(metrics?.orders.totalCount).toBeGreaterThan(0);
      expect(metrics?.orders.countByStatus).toHaveProperty('executed');
      expect(metrics?.orders.countByPair).toHaveProperty('ETH/USDT');
      expect(metrics?.orders.averageSize).toBeGreaterThan(0);
      expect(metrics?.orders.largeOrderCount).toBeGreaterThanOrEqual(0);
    });

    it('should collect volume metrics', async () => {
      // Mock volume query
      db.query = jest.fn().mockResolvedValue({
        rows: [
          {
            pair: 'ETH/USDT',
            volume: '1000000',
            hour: new Date().toISOString()
          }
        ]
      });
      
      await businessCollector.start(1000);
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const metrics = businessCollector.getCurrentMetrics();
      
      expect(metrics?.volume.total24h).toBeGreaterThan(0);
      expect(metrics?.volume.byPair24h).toHaveProperty('ETH/USDT');
      expect(metrics?.volume.byHour).toHaveLength(24);
      expect(metrics?.volume.movingAverage).toBeGreaterThanOrEqual(0);
    });

    it('should collect user metrics', async () => {
      // Mock user queries
      db.query = jest.fn()
        .mockResolvedValueOnce({ rows: [{ count: '500' }] }) // DAU
        .mockResolvedValueOnce({ rows: [{ count: '2000' }] }) // WAU
        .mockResolvedValueOnce({ rows: [{ count: '50' }] }) // New today
        .mockResolvedValueOnce({ rows: [{ count: '10000' }] }) // Total
        .mockResolvedValueOnce({ 
          rows: [
            { user_id: 'user1', volume: '50000' },
            { user_id: 'user2', volume: '45000' }
          ] 
        }); // Top traders
      
      await businessCollector.start(1000);
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const metrics = businessCollector.getCurrentMetrics();
      
      expect(metrics?.users.activeDaily).toBe(500);
      expect(metrics?.users.activeWeekly).toBe(2000);
      expect(metrics?.users.newToday).toBe(50);
      expect(metrics?.users.totalRegistered).toBe(10000);
      expect(metrics?.users.topTraders).toHaveLength(2);
    });

    it('should store metrics in Redis with TTL', async () => {
      await businessCollector.start(1000);
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(redis.setex).toHaveBeenCalled();
      expect(redis.zadd).toHaveBeenCalledWith(
        'business_metrics:timeline',
        expect.any(Number),
        expect.stringContaining('business_metrics:')
      );
      expect(redis.zremrangebyscore).toHaveBeenCalled();
    });

    it('should emit metrics-updated event', (done) => {
      businessCollector.on('metrics-updated', (metrics) => {
        expect(metrics).toHaveProperty('orders');
        expect(metrics).toHaveProperty('volume');
        expect(metrics).toHaveProperty('fees');
        expect(metrics).toHaveProperty('users');
        expect(metrics).toHaveProperty('liquidity');
        expect(metrics).toHaveProperty('market');
        done();
      });
      
      businessCollector.start(1000);
    });
  });

  describe('Technical Metrics Collection', () => {
    it('should record HTTP request metrics', () => {
      technicalCollector.recordHttpRequest('GET', '/api/orders', 200, 50);
      technicalCollector.recordHttpRequest('POST', '/api/orders', 201, 100);
      technicalCollector.recordHttpRequest('GET', '/api/orders', 500, 200);
      
      const buffers = technicalCollector['metricsBuffer'];
      expect(buffers.get('http:GET:/api/orders')).toContain(50);
      expect(buffers.get('http:POST:/api/orders')).toContain(100);
      expect(buffers.get('http:GET:/api/orders')).toContain(200);
    });

    it('should record WebSocket metrics', () => {
      technicalCollector.recordWebSocketMessage('subscribe', 'in', 10);
      technicalCollector.recordWebSocketMessage('orderbook', 'out', 5);
      
      const buffers = technicalCollector['metricsBuffer'];
      expect(buffers.get('ws:subscribe:in')).toContain(10);
      expect(buffers.get('ws:orderbook:out')).toContain(5);
    });

    it('should record order processing metrics', () => {
      technicalCollector.recordOrderProcessing('limit', 'executed', 25);
      technicalCollector.recordOrderProcessing('market', 'executed', 15);
      
      const buffers = technicalCollector['metricsBuffer'];
      expect(buffers.get('order:limit:executed')).toContain(25);
      expect(buffers.get('order:market:executed')).toContain(15);
    });

    it('should track errors and calculate error rate', async () => {
      // Record some requests and errors
      technicalCollector.recordHttpRequest('GET', '/api/test', 200, 50);
      technicalCollector.recordHttpRequest('GET', '/api/test', 200, 60);
      technicalCollector.recordHttpRequest('GET', '/api/test', 500, 100);
      technicalCollector.recordError('server_error', 'Internal server error', '/api/test');
      
      const metrics = await technicalCollector.calculateMetrics();
      
      expect(metrics.errors.totalCount).toBeGreaterThan(0);
      expect(metrics.errors.byType).toHaveProperty('server_error');
      expect(metrics.errors.errorRate).toBeGreaterThan(0);
    });

    it('should calculate latency percentiles', async () => {
      // Record various latencies
      for (let i = 1; i <= 100; i++) {
        technicalCollector.recordHttpRequest('GET', '/api/test', 200, i);
      }
      
      const metrics = await technicalCollector.calculateMetrics();
      
      expect(metrics.latency.apiEndpoints['GET /api/test']).toBeDefined();
      expect(metrics.latency.apiEndpoints['GET /api/test'].p50).toBeCloseTo(50, 0);
      expect(metrics.latency.apiEndpoints['GET /api/test'].p95).toBeCloseTo(95, 0);
      expect(metrics.latency.apiEndpoints['GET /api/test'].p99).toBeCloseTo(99, 0);
    });

    it('should track cache hit rate', () => {
      // Record cache hits and misses
      for (let i = 0; i < 10; i++) {
        technicalCollector.recordCacheAccess('query', i < 7); // 70% hit rate
      }
      
      const buffers = technicalCollector['metricsBuffer'];
      expect(buffers.get('cache:query:hits')?.[0]).toBe(7);
      expect(buffers.get('cache:query:total')?.[0]).toBe(10);
    });

    it('should provide Express middleware', () => {
      const middleware = technicalCollector.expressMiddleware();
      expect(middleware).toBeInstanceOf(Function);
      
      // Test middleware
      const req = { method: 'GET', path: '/test' };
      const res = { 
        statusCode: 200,
        on: jest.fn((event, callback) => {
          if (event === 'finish') {
            callback();
          }
        })
      };
      const next = jest.fn();
      
      middleware(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(res.on).toHaveBeenCalledWith('finish', expect.any(Function));
    });
  });

  describe('Infrastructure Metrics Collection', () => {
    beforeEach(() => {
      // Mock system calls
      jest.spyOn(infrastructureCollector as any, 'execCommand')
        .mockImplementation((cmd: string) => {
          if (cmd.includes('df')) {
            return Promise.resolve('Filesystem 1K-blocks Used Available Use%\n/dev/sda1 100000000 50000000 50000000 50%');
          }
          if (cmd.includes('docker')) {
            return Promise.resolve('{"Name":"container1","CPUPerc":"10%","MemPerc":"20%"}');
          }
          return Promise.resolve('');
        });
    });

    it('should collect CPU metrics', async () => {
      await infrastructureCollector.start(1000);
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Access metrics through event
      await new Promise<void>((resolve) => {
        infrastructureCollector.once('metrics-updated', (metrics) => {
          expect(metrics.cpu).toBeDefined();
          expect(metrics.cpu.usage).toBeGreaterThanOrEqual(0);
          expect(metrics.cpu.loadAverage).toHaveLength(3);
          expect(metrics.cpu.cores).toBeGreaterThan(0);
          resolve();
        });
      });
    });

    it('should collect memory metrics', async () => {
      await infrastructureCollector.start(1000);
      
      await new Promise<void>((resolve) => {
        infrastructureCollector.once('metrics-updated', (metrics) => {
          expect(metrics.memory).toBeDefined();
          expect(metrics.memory.total).toBeGreaterThan(0);
          expect(metrics.memory.used).toBeGreaterThan(0);
          expect(metrics.memory.free).toBeGreaterThan(0);
          expect(metrics.memory.heapUsed).toBeGreaterThan(0);
          expect(metrics.memory.rss).toBeGreaterThan(0);
          resolve();
        });
      });
    });

    it('should collect disk metrics', async () => {
      await infrastructureCollector.start(1000);
      
      await new Promise<void>((resolve) => {
        infrastructureCollector.once('metrics-updated', (metrics) => {
          expect(metrics.disk).toBeDefined();
          expect(metrics.disk.total).toBeGreaterThan(0);
          expect(metrics.disk.used).toBeGreaterThan(0);
          expect(metrics.disk.free).toBeGreaterThan(0);
          expect(metrics.disk.utilizationPercent).toBeBetween(0, 100);
          resolve();
        });
      });
    });

    it('should collect Node.js metrics', async () => {
      await infrastructureCollector.start(1000);
      
      await new Promise<void>((resolve) => {
        infrastructureCollector.once('metrics-updated', (metrics) => {
          expect(metrics.services.nodejs).toBeDefined();
          expect(metrics.services.nodejs.version).toMatch(/^v\d+\.\d+\.\d+/);
          expect(metrics.services.nodejs.uptime).toBeGreaterThan(0);
          expect(metrics.services.nodejs.eventLoopLag).toBeGreaterThanOrEqual(0);
          expect(metrics.services.nodejs.heapSpaces).toBeInstanceOf(Array);
          resolve();
        });
      });
    });

    it('should collect database metrics', async () => {
      // Mock database queries
      db.query = jest.fn()
        .mockResolvedValueOnce({ 
          rows: [{ active: '5', idle: '10', idle_in_transaction: '0', waiting: '1' }] 
        })
        .mockResolvedValueOnce({ rows: [{ size: '1000000' }] })
        .mockResolvedValueOnce({ rows: [{ cache_hit_ratio: '0.95' }] })
        .mockResolvedValueOnce({ 
          rows: [{ active: '3', blocked: '0', slow: '1' }] 
        });
      
      await infrastructureCollector.start(1000);
      
      await new Promise<void>((resolve) => {
        infrastructureCollector.once('metrics-updated', (metrics) => {
          expect(metrics.services.database).toBeDefined();
          expect(metrics.services.database.connections.active).toBe(5);
          expect(metrics.services.database.connections.idle).toBe(10);
          expect(metrics.services.database.cacheHitRatio).toBeCloseTo(0.95);
          resolve();
        });
      });
    });

    it('should collect Redis metrics', async () => {
      await infrastructureCollector.start(1000);
      
      await new Promise<void>((resolve) => {
        infrastructureCollector.once('metrics-updated', (metrics) => {
          expect(metrics.services.redis).toBeDefined();
          expect(metrics.services.redis.connected).toBe(true);
          expect(metrics.services.redis.memory.used).toBeGreaterThan(0);
          expect(metrics.services.redis.clients.connected).toBeGreaterThanOrEqual(0);
          expect(metrics.services.redis.stats.instantaneousOps).toBeGreaterThanOrEqual(0);
          resolve();
        });
      });
    });
  });

  describe('DEX Metrics Exporter', () => {
    let app: any;

    beforeEach(async () => {
      // Start the exporter
      await dexExporter.start();
      
      // Get Express app for testing
      const express = require('express');
      app = express();
      app.use(technicalCollector.expressMiddleware());
    });

    it('should expose metrics endpoint', async () => {
      const response = await request(`http://localhost:9091`)
        .get('/metrics')
        .expect(200);
      
      expect(response.text).toContain('# HELP');
      expect(response.text).toContain('# TYPE');
    });

    it('should expose health endpoint', async () => {
      const response = await request(`http://localhost:9091`)
        .get('/health')
        .expect(200);
      
      expect(response.body).toHaveProperty('status', 'healthy');
      expect(response.body).toHaveProperty('collectors');
      expect(response.body).toHaveProperty('uptime');
    });

    it('should record DEX-specific metrics', () => {
      // Record liquidity event
      dexExporter.recordLiquidityEvent('ETH/USDT', 'ETH', 'USDT', 'add', 1000000);
      
      // Record MEV protection
      dexExporter.recordMEVProtection('front_run_detected', 'flashbot_protection', true);
      
      // Record gas optimization
      dexExporter.recordGasOptimization('batch_settlement', 'ethereum', 1000);
      
      // Record cross-chain activity
      dexExporter.recordCrossChainActivity('ethereum', 'polygon', 'bridge_transfer', 50000);
      
      // Record yield metrics
      dexExporter.recordYieldMetrics('ETH-USDT-LP', 'SUSHI', 15.5, 10000000);
      
      // Record governance activity
      dexExporter.recordGovernanceActivity('active', 'votes_cast', 1500);
      
      // All methods should complete without error
      expect(true).toBe(true);
    });

    it('should aggregate metrics from all collectors', async () => {
      const metricsJson = await dexExporter.getMetricsJSON();
      
      expect(metricsJson).toHaveProperty('timestamp');
      expect(metricsJson).toHaveProperty('business');
      expect(metricsJson).toHaveProperty('technical');
      expect(metricsJson).toHaveProperty('prometheus');
      expect(metricsJson.prometheus).toBeInstanceOf(Array);
    });

    it('should handle collector errors gracefully', (done) => {
      let errorCount = 0;
      
      dexExporter.on('error', (error) => {
        expect(error).toHaveProperty('collector');
        expect(error).toHaveProperty('error');
        errorCount++;
        
        if (errorCount === 2) {
          done();
        }
      });
      
      // Emit errors from collectors
      businessCollector.emit('error', new Error('Business collector error'));
      infrastructureCollector.emit('error', new Error('Infrastructure collector error'));
    });
  });

  describe('Historical Metrics Retrieval', () => {
    it('should retrieve historical business metrics', async () => {
      // Mock Redis responses for historical data
      redis.zrangebyscore = jest.fn().mockResolvedValue([
        'business_metrics:1000',
        'business_metrics:2000',
        'business_metrics:3000'
      ]);
      
      redis.get = jest.fn()
        .mockResolvedValueOnce(JSON.stringify({ orders: { totalCount: 100 } }))
        .mockResolvedValueOnce(JSON.stringify({ orders: { totalCount: 200 } }))
        .mockResolvedValueOnce(JSON.stringify({ orders: { totalCount: 300 } }));
      
      const startTime = Date.now() - 3600000; // 1 hour ago
      const endTime = Date.now();
      
      const historicalMetrics = await businessCollector.getHistoricalMetrics(
        startTime,
        endTime,
        'hour'
      );
      
      expect(historicalMetrics).toHaveLength(3);
      expect(historicalMetrics[0]).toHaveProperty('timestamp');
      expect(historicalMetrics[0]).toHaveProperty('orders');
    });
  });
});

// Custom matcher for numeric ranges
expect.extend({
  toBeBetween(received: number, floor: number, ceiling: number) {
    const pass = received >= floor && received <= ceiling;
    if (pass) {
      return {
        message: () => `expected ${received} not to be between ${floor} and ${ceiling}`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${received} to be between ${floor} and ${ceiling}`,
        pass: false,
      };
    }
  },
});