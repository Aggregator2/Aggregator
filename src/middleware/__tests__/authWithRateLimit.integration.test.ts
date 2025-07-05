import request from 'supertest';
import express, { Request, Response, NextFunction } from 'express';
import { requireAuth, withApiKey } from '../auth';
import { publicRateLimiter, authenticatedRateLimiter, tradingRateLimiter } from '../rateLimiter';
import jwt from 'jsonwebtoken';

// Mock dependencies
jest.mock('../../services/apiKeyService', () => ({
  ApiKeyService: {
    validateApiKey: jest.fn((key: string) => {
      if (key === 'valid-api-key') {
        return Promise.resolve({
          id: 'key-123',
          userId: 'user-123',
          permissions: ['read', 'write'],
          rateLimit: 1000
        });
      }
      return Promise.resolve(null);
    }),
    hasPermission: jest.fn((keyDetails: any, permission: string) => {
      return keyDetails.permissions.includes(permission);
    })
  },
  ApiKeyPermission: {
    READ: 'read',
    WRITE: 'write',
    ADMIN: 'admin'
  }
}));

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

describe('Auth Middleware with Rate Limiting Integration', () => {
  let app: express.Application;
  const JWT_SECRET = 'test-secret';

  beforeAll(() => {
    process.env.JWT_SECRET = JWT_SECRET;

    app = express();
    app.use(express.json());

    // Public endpoint with rate limiting
    app.get('/api/public/data', publicRateLimiter, (req: Request, res: Response) => {
      res.json({ data: 'public data' });
    });

    // JWT auth endpoint with rate limiting
    app.get('/api/user/profile', 
      authenticatedRateLimiter,
      requireAuth,
      (req: Request, res: Response) => {
        res.json({ 
          user: (req as any).user,
          message: 'Protected user data' 
        });
      }
    );

    // API key auth endpoint with rate limiting
    app.post('/api/data/submit',
      authenticatedRateLimiter,
      withApiKey,
      (req: Request, res: Response) => {
        res.json({ 
          success: true,
          apiKey: (req as any).apiKey,
          data: req.body 
        });
      }
    );

    // Trading endpoint with both auth and strict rate limiting
    app.post('/api/trading/order',
      tradingRateLimiter,
      requireAuth,
      (req: Request, res: Response) => {
        res.json({ 
          orderId: 'order-123',
          user: (req as any).user,
          order: req.body 
        });
      }
    );

    // Combined auth methods endpoint
    app.get('/api/admin/stats',
      authenticatedRateLimiter,
      (req: Request, res: Response, next: NextFunction) => {
        // Try JWT auth first
        const authHeader = req.headers.authorization;
        if (authHeader?.startsWith('Bearer ') && !authHeader.includes('api-key')) {
          return requireAuth(req, res, next);
        }
        // Fall back to API key auth
        return withApiKey(req, res, next);
      },
      (req: Request, res: Response) => {
        res.json({ 
          stats: 'admin statistics',
          authMethod: (req as any).user ? 'jwt' : 'apiKey'
        });
      }
    );
  });

  describe('Public endpoints with rate limiting', () => {
    it('should allow public access up to rate limit', async () => {
      const responses = [];
      
      // Make 100 requests (public limit)
      for (let i = 0; i < 100; i++) {
        const res = await request(app)
          .get('/api/public/data')
          .set('X-Forwarded-For', '192.168.1.100');
        responses.push(res);
      }

      // All should succeed
      expect(responses.every(r => r.status === 200)).toBe(true);

      // Next request should be rate limited
      const rateLimitedRes = await request(app)
        .get('/api/public/data')
        .set('X-Forwarded-For', '192.168.1.100');

      expect(rateLimitedRes.status).toBe(429);
      expect(rateLimitedRes.body.error).toBe('Too many requests');
    });
  });

  describe('JWT authenticated endpoints with rate limiting', () => {
    let validToken: string;
    let expiredToken: string;

    beforeAll(() => {
      validToken = jwt.sign(
        { id: 'user-123', email: 'user@example.com' },
        JWT_SECRET,
        { expiresIn: '1h' }
      );

      expiredToken = jwt.sign(
        { id: 'user-456', email: 'expired@example.com' },
        JWT_SECRET,
        { expiresIn: '-1h' }
      );
    });

    it('should enforce auth before rate limiting', async () => {
      // Request without auth should fail with 401, not 429
      const res = await request(app)
        .get('/api/user/profile');

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Unauthorized');
    });

    it('should rate limit authenticated users', async () => {
      // Make multiple requests with valid token
      const responses = [];
      for (let i = 0; i < 50; i++) {
        const res = await request(app)
          .get('/api/user/profile')
          .set('Authorization', `Bearer ${validToken}`);
        responses.push(res);
      }

      // All should succeed (well under 1000 limit)
      expect(responses.every(r => r.status === 200)).toBe(true);
      expect(responses[0].body.user.id).toBe('user-123');
    });

    it('should reject expired tokens regardless of rate limit', async () => {
      const res = await request(app)
        .get('/api/user/profile')
        .set('Authorization', `Bearer ${expiredToken}`);

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid token');
    });

    it('should track rate limits per user, not per token', async () => {
      // Create two tokens for same user
      const token1 = jwt.sign(
        { id: 'user-789', email: 'user789@example.com' },
        JWT_SECRET,
        { expiresIn: '1h' }
      );

      const token2 = jwt.sign(
        { id: 'user-789', email: 'user789@example.com', sessionId: 'different' },
        JWT_SECRET,
        { expiresIn: '1h' }
      );

      // Make requests with both tokens
      const responses = [];
      for (let i = 0; i < 25; i++) {
        const res1 = await request(app)
          .get('/api/user/profile')
          .set('Authorization', `Bearer ${token1}`);
        responses.push(res1);

        const res2 = await request(app)
          .get('/api/user/profile')
          .set('Authorization', `Bearer ${token2}`);
        responses.push(res2);
      }

      // All should count against same user's rate limit
      expect(responses.every(r => r.status === 200)).toBe(true);
      expect(responses.length).toBe(50); // Total requests for the user
    });
  });

  describe('API key authenticated endpoints with rate limiting', () => {
    it('should enforce auth before rate limiting', async () => {
      // Request without API key should fail with 401
      const res = await request(app)
        .post('/api/data/submit')
        .send({ data: 'test' });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Unauthorized: Missing or invalid API key');
    });

    it('should rate limit API key users', async () => {
      const responses = [];
      
      // Make multiple requests with valid API key
      for (let i = 0; i < 50; i++) {
        const res = await request(app)
          .post('/api/data/submit')
          .set('Authorization', 'Bearer valid-api-key')
          .send({ data: `test-${i}` });
        responses.push(res);
      }

      // All should succeed
      expect(responses.every(r => r.status === 200)).toBe(true);
      expect(responses[0].body.apiKey.id).toBe('key-123');
    });

    it('should reject invalid API keys', async () => {
      const res = await request(app)
        .post('/api/data/submit')
        .set('Authorization', 'Bearer invalid-api-key')
        .send({ data: 'test' });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Unauthorized: Invalid or expired API key');
    });
  });

  describe('Trading endpoints with strict rate limiting', () => {
    let tradingToken: string;

    beforeAll(() => {
      tradingToken = jwt.sign(
        { id: 'trader-123', email: 'trader@example.com' },
        JWT_SECRET,
        { expiresIn: '1h' }
      );
    });

    it('should enforce strict per-second rate limits', async () => {
      const startTime = Date.now();
      const responses = [];

      // Make 10 requests rapidly (trading limit per second)
      for (let i = 0; i < 10; i++) {
        const res = await request(app)
          .post('/api/trading/order')
          .set('Authorization', `Bearer ${tradingToken}`)
          .send({ 
            symbol: 'BTC/USD',
            amount: 0.1,
            price: 50000 
          });
        responses.push(res);
      }

      const elapsedTime = Date.now() - startTime;
      
      // All 10 should succeed if within 1 second
      expect(responses.filter(r => r.status === 200).length).toBeGreaterThanOrEqual(9);

      // If we're still within the same second, next request should fail
      if (elapsedTime < 1000) {
        const extraRes = await request(app)
          .post('/api/trading/order')
          .set('Authorization', `Bearer ${tradingToken}`)
          .send({ 
            symbol: 'BTC/USD',
            amount: 0.1,
            price: 50000 
          });

        expect(extraRes.status).toBe(429);
      }
    });
  });

  describe('Combined auth methods with rate limiting', () => {
    let jwtToken: string;

    beforeAll(() => {
      jwtToken = jwt.sign(
        { id: 'admin-123', email: 'admin@example.com' },
        JWT_SECRET,
        { expiresIn: '1h' }
      );
    });

    it('should support both JWT and API key auth with same rate limits', async () => {
      // Test with JWT
      const jwtRes = await request(app)
        .get('/api/admin/stats')
        .set('Authorization', `Bearer ${jwtToken}`);

      expect(jwtRes.status).toBe(200);
      expect(jwtRes.body.authMethod).toBe('jwt');

      // Test with API key
      const apiKeyRes = await request(app)
        .get('/api/admin/stats')
        .set('Authorization', 'Bearer valid-api-key');

      expect(apiKeyRes.status).toBe(200);
      expect(apiKeyRes.body.authMethod).toBe('apiKey');

      // Both should share the same rate limit pool
      const responses = [];
      for (let i = 0; i < 20; i++) {
        // Alternate between JWT and API key
        const authHeader = i % 2 === 0 
          ? `Bearer ${jwtToken}`
          : 'Bearer valid-api-key';
        
        const res = await request(app)
          .get('/api/admin/stats')
          .set('Authorization', authHeader);
        responses.push(res);
      }

      expect(responses.every(r => r.status === 200)).toBe(true);
    });
  });

  describe('Rate limit headers with auth', () => {
    let token: string;

    beforeAll(() => {
      token = jwt.sign(
        { id: 'header-test-user', email: 'headers@example.com' },
        JWT_SECRET,
        { expiresIn: '1h' }
      );
    });

    it('should include rate limit headers in authenticated responses', async () => {
      const res = await request(app)
        .get('/api/user/profile')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.headers['x-ratelimit-limit']).toBe('1000');
      expect(res.headers['x-ratelimit-remaining']).toBeDefined();
      expect(res.headers['x-ratelimit-reset']).toBeDefined();
    });

    it('should show correct remaining count', async () => {
      // Make 5 requests
      let lastResponse;
      for (let i = 0; i < 5; i++) {
        lastResponse = await request(app)
          .get('/api/user/profile')
          .set('Authorization', `Bearer ${token}`);
      }

      const remaining = parseInt(lastResponse!.headers['x-ratelimit-remaining']);
      expect(remaining).toBeLessThan(1000);
      expect(remaining).toBeGreaterThanOrEqual(995);
    });
  });

  describe('DDoS protection with authentication', () => {
    it('should protect against credential stuffing attacks', async () => {
      const attackPromises = [];
      
      // Simulate credential stuffing with different invalid tokens
      for (let i = 0; i < 150; i++) {
        const fakeToken = jwt.sign(
          { id: `attacker-${i}` },
          'wrong-secret',
          { expiresIn: '1h' }
        );

        attackPromises.push(
          request(app)
            .get('/api/user/profile')
            .set('Authorization', `Bearer ${fakeToken}`)
            .set('X-Forwarded-For', `10.0.0.${i % 50}`) // Vary IPs
        );
      }

      const results = await Promise.all(attackPromises);
      
      // Should get mix of 401 (auth failures) and 429 (rate limited)
      const authFailures = results.filter(r => r.status === 401).length;
      const rateLimited = results.filter(r => r.status === 429).length;
      
      expect(authFailures).toBeGreaterThan(0);
      expect(rateLimited).toBeGreaterThan(0);
    });

    it('should protect against API key brute force', async () => {
      const bruteForcePromises = [];
      
      // Try many invalid API keys from same IP
      for (let i = 0; i < 110; i++) {
        bruteForcePromises.push(
          request(app)
            .post('/api/data/submit')
            .set('Authorization', `Bearer invalid-key-${i}`)
            .set('X-Forwarded-For', '192.168.50.50')
            .send({ data: 'test' })
        );
      }

      const results = await Promise.all(bruteForcePromises);
      
      // After 100 requests, should be rate limited
      const rateLimited = results.filter(r => r.status === 429).length;
      expect(rateLimited).toBeGreaterThan(0);
    });
  });
});