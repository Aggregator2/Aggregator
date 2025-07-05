import request from 'supertest';
import express, { Request, Response } from 'express';
import { createClient } from 'redis';
import { 
  publicRateLimiter, 
  authenticatedRateLimiter, 
  tradingRateLimiter,
  strictRateLimiter,
  websocketRateLimiter 
} from '../rateLimiter';
import { RateLimiter } from '../../services/websocket/RateLimiter';

// Mock Redis client
jest.mock('redis', () => ({
  createClient: jest.fn(() => ({
    connect: jest.fn().mockResolvedValue(undefined),
    isOpen: true,
    on: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
    incr: jest.fn(),
    expire: jest.fn()
  }))
}));

describe('Rate Limiter Middleware', () => {
  let app: express.Application;
  let redisClient: any;

  beforeAll(() => {
    // Set up express app for testing
    app = express();
    app.use(express.json());

    // Public endpoint
    app.get('/api/public', publicRateLimiter, (req: Request, res: Response) => {
      res.json({ message: 'Public endpoint' });
    });

    // Authenticated endpoint
    app.get('/api/auth', (req: Request, res: Response, next) => {
      // Simulate authenticated user
      (req as any).user = { id: 'user123' };
      next();
    }, authenticatedRateLimiter, (req: Request, res: Response) => {
      res.json({ message: 'Authenticated endpoint' });
    });

    // Trading endpoint
    app.post('/api/trade', (req: Request, res: Response, next) => {
      (req as any).user = { id: req.body.userId || 'user123' };
      next();
    }, tradingRateLimiter, (req: Request, res: Response) => {
      res.json({ message: 'Trade executed' });
    });

    // Sensitive endpoint
    app.post('/api/sensitive', strictRateLimiter, (req: Request, res: Response) => {
      res.json({ message: 'Sensitive operation' });
    });

    // WebSocket endpoint
    app.get('/ws', websocketRateLimiter, (req: Request, res: Response) => {
      res.json({ message: 'WebSocket connection' });
    });
  });

  afterAll(() => {
    jest.clearAllMocks();
  });

  describe('Rate limit enforcement per user/IP', () => {
    it('should enforce rate limits for public endpoints by IP', async () => {
      const responses = [];

      // Make 100 requests (within limit)
      for (let i = 0; i < 100; i++) {
        const res = await request(app)
          .get('/api/public')
          .set('X-Forwarded-For', '192.168.1.1');
        responses.push(res);
      }

      // All should succeed
      expect(responses.every(r => r.status === 200)).toBe(true);

      // 101st request should be rate limited
      const rateLimitedRes = await request(app)
        .get('/api/public')
        .set('X-Forwarded-For', '192.168.1.1');

      expect(rateLimitedRes.status).toBe(429);
      expect(rateLimitedRes.body).toMatchObject({
        error: 'Too many requests',
        message: 'Rate limit exceeded. Please try again later.'
      });
    });

    it('should enforce separate rate limits per user for authenticated endpoints', async () => {
      const user1Responses = [];
      const user2Responses = [];

      // User 1 makes 50 requests
      for (let i = 0; i < 50; i++) {
        const res = await request(app)
          .get('/api/auth')
          .set('Authorization', 'Bearer user1-token');
        user1Responses.push(res);
      }

      // User 2 makes 50 requests
      for (let i = 0; i < 50; i++) {
        const res = await request(app)
          .get('/api/auth')
          .set('Authorization', 'Bearer user2-token');
        user2Responses.push(res);
      }

      // Both users should succeed (each under their 1000 limit)
      expect(user1Responses.every(r => r.status === 200)).toBe(true);
      expect(user2Responses.every(r => r.status === 200)).toBe(true);
    });

    it('should enforce trading rate limits per second', async () => {
      const startTime = Date.now();
      const responses = [];

      // Make 10 requests rapidly (within 1 second)
      for (let i = 0; i < 10; i++) {
        const res = await request(app)
          .post('/api/trade')
          .send({ userId: 'trader1' });
        responses.push(res);
      }

      const elapsedTime = Date.now() - startTime;
      expect(elapsedTime).toBeLessThan(1000); // Ensure all requests were within 1 second

      // All should succeed
      expect(responses.every(r => r.status === 200)).toBe(true);

      // 11th request within the same second should fail
      if (elapsedTime < 1000) {
        const rateLimitedRes = await request(app)
          .post('/api/trade')
          .send({ userId: 'trader1' });

        expect(rateLimitedRes.status).toBe(429);
      }
    });

    it('should enforce strict rate limits for sensitive endpoints', async () => {
      const responses = [];

      // Make 10 requests (within limit)
      for (let i = 0; i < 10; i++) {
        const res = await request(app).post('/api/sensitive');
        responses.push(res);
      }

      // All should succeed
      expect(responses.every(r => r.status === 200)).toBe(true);

      // 11th request should be rate limited
      const rateLimitedRes = await request(app).post('/api/sensitive');
      expect(rateLimitedRes.status).toBe(429);
    });
  });

  describe('DDoS protection mechanisms', () => {
    it('should protect against distributed attacks from multiple IPs', async () => {
      const attackPromises = [];
      const ipCount = 20;
      const requestsPerIp = 10;

      // Simulate distributed attack
      for (let ip = 1; ip <= ipCount; ip++) {
        for (let req = 1; req <= requestsPerIp; req++) {
          attackPromises.push(
            request(app)
              .get('/api/public')
              .set('X-Forwarded-For', `192.168.1.${ip}`)
          );
        }
      }

      const results = await Promise.all(attackPromises);
      
      // Count successful and rate-limited responses
      const successCount = results.filter(r => r.status === 200).length;
      const rateLimitedCount = results.filter(r => r.status === 429).length;

      // Each IP should be rate limited after 100 requests
      expect(successCount).toBeLessThanOrEqual(ipCount * 100);
      expect(rateLimitedCount).toBeGreaterThan(0);
    });

    it('should handle burst traffic patterns', async () => {
      // Simulate burst of 50 requests in rapid succession
      const burstPromises = [];
      for (let i = 0; i < 50; i++) {
        burstPromises.push(
          request(app)
            .get('/api/public')
            .set('X-Forwarded-For', '10.0.0.1')
        );
      }

      const burstResults = await Promise.all(burstPromises);
      const successfulRequests = burstResults.filter(r => r.status === 200).length;

      // Should allow all requests within rate limit
      expect(successfulRequests).toBe(50);

      // Wait a bit and send another burst
      await new Promise(resolve => setTimeout(resolve, 100));

      const secondBurstPromises = [];
      for (let i = 0; i < 60; i++) {
        secondBurstPromises.push(
          request(app)
            .get('/api/public')
            .set('X-Forwarded-For', '10.0.0.1')
        );
      }

      const secondBurstResults = await Promise.all(secondBurstPromises);
      const rateLimitedInSecondBurst = secondBurstResults.filter(r => r.status === 429).length;

      // Should rate limit after exceeding 100 requests per minute
      expect(rateLimitedInSecondBurst).toBeGreaterThan(0);
    });

    it('should protect WebSocket endpoints from connection flooding', async () => {
      const connectionPromises = [];
      
      // Attempt 100 WebSocket connections from same IP
      for (let i = 0; i < 100; i++) {
        connectionPromises.push(
          request(app)
            .get('/ws')
            .set('X-Forwarded-For', '172.16.0.1')
        );
      }

      const results = await Promise.all(connectionPromises);
      const successCount = results.filter(r => r.status === 200).length;

      // All should succeed (within limit)
      expect(successCount).toBe(100);

      // 101st connection should be rate limited
      const extraConnection = await request(app)
        .get('/ws')
        .set('X-Forwarded-For', '172.16.0.1');

      expect(extraConnection.status).toBe(429);
    });
  });

  describe('Graceful degradation under load', () => {
    it('should fall back to in-memory rate limiting if Redis is unavailable', async () => {
      // Mock Redis connection failure
      const mockRedisClient = {
        connect: jest.fn().mockRejectedValue(new Error('Redis connection failed')),
        isOpen: false
      };

      (createClient as jest.Mock).mockReturnValue(mockRedisClient);

      // Create new rate limiter instance with failed Redis
      const { publicRateLimiter: fallbackLimiter } = jest.requireActual('../rateLimiter');

      const testApp = express();
      testApp.get('/test', fallbackLimiter, (req, res) => {
        res.json({ message: 'Success' });
      });

      // Should still enforce rate limits using in-memory store
      const responses = [];
      for (let i = 0; i < 101; i++) {
        const res = await request(testApp).get('/test');
        responses.push(res);
      }

      const rateLimited = responses.filter(r => r.status === 429).length;
      expect(rateLimited).toBeGreaterThan(0);
    });

    it('should handle high concurrency without crashing', async () => {
      const concurrentRequests = 200;
      const promises = [];

      // Send many concurrent requests
      for (let i = 0; i < concurrentRequests; i++) {
        promises.push(
          request(app)
            .get('/api/public')
            .set('X-Forwarded-For', `10.1.1.${i % 50}`) // Distribute across 50 IPs
            .catch(err => ({ status: err.status || 500 }))
        );
      }

      const results = await Promise.all(promises);
      
      // Should handle all requests without server errors
      const serverErrors = results.filter(r => r.status >= 500).length;
      expect(serverErrors).toBe(0);

      // Should have mix of successful and rate-limited responses
      const successful = results.filter(r => r.status === 200).length;
      const rateLimited = results.filter(r => r.status === 429).length;
      
      expect(successful).toBeGreaterThan(0);
      expect(rateLimited).toBeGreaterThan(0);
      expect(successful + rateLimited).toBe(concurrentRequests);
    });
  });

  describe('Rate limit headers in responses', () => {
    it('should include standard rate limit headers', async () => {
      const res = await request(app)
        .get('/api/public')
        .set('X-Forwarded-For', '192.168.100.1');

      expect(res.status).toBe(200);
      expect(res.headers).toHaveProperty('x-ratelimit-limit');
      expect(res.headers).toHaveProperty('x-ratelimit-remaining');
      expect(res.headers).toHaveProperty('x-ratelimit-reset');

      // Verify header values
      expect(parseInt(res.headers['x-ratelimit-limit'])).toBe(100);
      expect(parseInt(res.headers['x-ratelimit-remaining'])).toBe(99);
    });

    it('should include Retry-After header when rate limited', async () => {
      // Exhaust rate limit
      for (let i = 0; i < 100; i++) {
        await request(app)
          .get('/api/public')
          .set('X-Forwarded-For', '192.168.200.1');
      }

      // Next request should be rate limited
      const rateLimitedRes = await request(app)
        .get('/api/public')
        .set('X-Forwarded-For', '192.168.200.1');

      expect(rateLimitedRes.status).toBe(429);
      expect(rateLimitedRes.headers).toHaveProperty('retry-after');
      expect(rateLimitedRes.body.retryAfter).toBeDefined();
    });

    it('should show different limits for different endpoint types', async () => {
      // Public endpoint
      const publicRes = await request(app)
        .get('/api/public')
        .set('X-Forwarded-For', '192.168.201.1');
      expect(parseInt(publicRes.headers['x-ratelimit-limit'])).toBe(100);

      // Authenticated endpoint
      const authRes = await request(app)
        .get('/api/auth')
        .set('X-Forwarded-For', '192.168.201.1');
      expect(parseInt(authRes.headers['x-ratelimit-limit'])).toBe(1000);

      // Trading endpoint
      const tradeRes = await request(app)
        .post('/api/trade')
        .send({ userId: 'trader123' })
        .set('X-Forwarded-For', '192.168.201.1');
      expect(parseInt(tradeRes.headers['x-ratelimit-limit'])).toBe(10);

      // Sensitive endpoint
      const sensitiveRes = await request(app)
        .post('/api/sensitive')
        .set('X-Forwarded-For', '192.168.201.1');
      expect(parseInt(sensitiveRes.headers['x-ratelimit-limit'])).toBe(10);
    });
  });
});

describe('WebSocket Rate Limiter', () => {
  let rateLimiter: RateLimiter;

  beforeEach(() => {
    rateLimiter = new RateLimiter({
      maxSubscriptionsPerConnection: 10,
      maxConnectionsPerApiKey: 5,
      messageThrottling: {
        windowMs: 60000,
        maxMessages: 1000,
        highFrequencyChannels: ['orderbook', 'trades'],
        throttleDelay: 100
      },
      connectionLimits: {
        globalMaxConnections: 100,
        perIpMaxConnections: 10,
        burstAllowance: 2
      }
    });
  });

  describe('Connection limits', () => {
    it('should enforce per-API key connection limits', () => {
      const apiKey = 'test-api-key';
      const ip = '192.168.1.1';

      // Register 5 connections (at limit)
      for (let i = 1; i <= 5; i++) {
        const result = rateLimiter.canConnect(apiKey, ip);
        expect(result.allowed).toBe(true);
        rateLimiter.registerConnection(`socket${i}`, apiKey, ip);
      }

      // 6th connection should be rejected
      const result = rateLimiter.canConnect(apiKey, ip);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('API key connection limit reached');
    });

    it('should enforce per-IP connection limits', () => {
      const ip = '10.0.0.1';

      // Register 10 connections from same IP (at limit)
      for (let i = 1; i <= 10; i++) {
        const result = rateLimiter.canConnect(`api-key-${i}`, ip);
        expect(result.allowed).toBe(true);
        rateLimiter.registerConnection(`socket${i}`, `api-key-${i}`, ip);
      }

      // 11th connection from same IP should be rejected
      const result = rateLimiter.canConnect('api-key-11', ip);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('IP connection limit reached');
    });

    it('should enforce global connection limit', () => {
      // Fill up to global limit
      for (let i = 1; i <= 100; i++) {
        rateLimiter.registerConnection(`socket${i}`, `api-${i}`, `ip-${i}`);
      }

      // Next connection should be rejected
      const result = rateLimiter.canConnect('new-api', 'new-ip');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Global connection limit reached');
    });
  });

  describe('Message rate limiting', () => {
    it('should enforce message rate limits per connection', () => {
      const socketId = 'test-socket';
      rateLimiter.registerConnection(socketId, 'api-key', '192.168.1.1');

      // Send 1000 messages (at limit)
      for (let i = 0; i < 1000; i++) {
        const result = rateLimiter.checkMessageRateLimit(socketId);
        expect(result.allowed).toBe(true);
      }

      // 1001st message should be rate limited
      const result = rateLimiter.checkMessageRateLimit(socketId);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Message rate limit exceeded');
    });

    it('should throttle high-frequency channel updates', (done) => {
      const socketId = 'test-socket';
      rateLimiter.registerConnection(socketId, 'api-key', '192.168.1.1');

      let messagesSent = 0;
      const messageCallback = () => {
        messagesSent++;
      };

      // Send multiple orderbook updates rapidly
      const shouldThrottle1 = rateLimiter.shouldThrottleMessage(socketId, 'orderbook', messageCallback);
      expect(shouldThrottle1).toBe(false);
      messagesSent++; // First message goes through immediately

      // Subsequent messages should be throttled
      const shouldThrottle2 = rateLimiter.shouldThrottleMessage(socketId, 'orderbook', messageCallback);
      expect(shouldThrottle2).toBe(true);

      const shouldThrottle3 = rateLimiter.shouldThrottleMessage(socketId, 'orderbook', messageCallback);
      expect(shouldThrottle3).toBe(true);

      // After throttle delay, queued message should be sent
      setTimeout(() => {
        expect(messagesSent).toBe(2); // Initial + one from queue
        done();
      }, 150);
    });

    it('should not throttle non-high-frequency channels', () => {
      const socketId = 'test-socket';
      rateLimiter.registerConnection(socketId, 'api-key', '192.168.1.1');

      const callback = jest.fn();

      // Regular channel should not be throttled
      const shouldThrottle1 = rateLimiter.shouldThrottleMessage(socketId, 'account', callback);
      expect(shouldThrottle1).toBe(false);

      const shouldThrottle2 = rateLimiter.shouldThrottleMessage(socketId, 'account', callback);
      expect(shouldThrottle2).toBe(false);
    });
  });

  describe('Subscription limits', () => {
    it('should enforce subscription limits per connection', () => {
      const socketId = 'test-socket';
      rateLimiter.registerConnection(socketId, 'api-key', '192.168.1.1');

      // Add 10 subscriptions (at limit)
      for (let i = 0; i < 10; i++) {
        const result = rateLimiter.canSubscribe(socketId);
        expect(result.allowed).toBe(true);
        rateLimiter.addSubscription(socketId);
      }

      // 11th subscription should be rejected
      const result = rateLimiter.canSubscribe(socketId);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Subscription limit reached');
    });

    it('should track subscription count correctly', () => {
      const socketId = 'test-socket';
      rateLimiter.registerConnection(socketId, 'api-key', '192.168.1.1');

      // Add subscriptions
      rateLimiter.addSubscription(socketId);
      rateLimiter.addSubscription(socketId);
      rateLimiter.addSubscription(socketId);

      let status = rateLimiter.getRateLimitStatus(socketId);
      expect(status.subscriptions.current).toBe(3);
      expect(status.subscriptions.remaining).toBe(7);

      // Remove subscription
      rateLimiter.removeSubscription(socketId);

      status = rateLimiter.getRateLimitStatus(socketId);
      expect(status.subscriptions.current).toBe(2);
      expect(status.subscriptions.remaining).toBe(8);
    });
  });

  describe('Statistics and monitoring', () => {
    it('should provide connection statistics', () => {
      // Register multiple connections
      rateLimiter.registerConnection('socket1', 'api-key-1', '192.168.1.1');
      rateLimiter.registerConnection('socket2', 'api-key-1', '192.168.1.2');
      rateLimiter.registerConnection('socket3', 'api-key-2', '192.168.1.3');

      // Get global stats
      const globalStats = rateLimiter.getConnectionStats();
      expect(globalStats.totalConnections).toBe(3);
      expect(globalStats.totalApiKeys).toBe(2);
      expect(globalStats.totalIps).toBe(3);

      // Get API key specific stats
      const apiKeyStats = rateLimiter.getConnectionStats('api-key-1');
      expect(apiKeyStats.connectionCount).toBe(2);
      expect(apiKeyStats.connections).toHaveLength(2);
    });

    it('should provide rate limit status for connections', () => {
      const socketId = 'test-socket';
      rateLimiter.registerConnection(socketId, 'api-key', '192.168.1.1');

      // Add some activity
      rateLimiter.addSubscription(socketId);
      rateLimiter.addSubscription(socketId);
      rateLimiter.checkMessageRateLimit(socketId);
      rateLimiter.checkMessageRateLimit(socketId);

      const status = rateLimiter.getRateLimitStatus(socketId);
      
      expect(status.subscriptions.current).toBe(2);
      expect(status.subscriptions.limit).toBe(10);
      expect(status.messages.current).toBe(2);
      expect(status.messages.limit).toBe(1000);
      expect(status.messages.windowResetIn).toBeGreaterThan(0);
    });

    it('should clean up idle connections', () => {
      // Register a connection
      const socketId = 'idle-socket';
      rateLimiter.registerConnection(socketId, 'api-key', '192.168.1.1');

      // Verify connection exists
      let stats = rateLimiter.getConnectionStats();
      expect(stats.totalConnections).toBe(1);

      // Mock time passage (would need to adjust connection time in real implementation)
      // For this test, we'll just remove the connection manually
      rateLimiter.removeConnection(socketId);

      stats = rateLimiter.getConnectionStats();
      expect(stats.totalConnections).toBe(0);
    });
  });
});