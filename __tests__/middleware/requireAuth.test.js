const jwt = require('jsonwebtoken');
const { faker } = require('@faker-js/faker');

// Mock Next.js request/response
const createMockReq = (headers = {}) => ({
  headers,
  method: 'POST',
  body: {}
});

const createMockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  res.end = jest.fn().mockReturnValue(res);
  return res;
};

describe('requireAuth Middleware', () => {
  let requireAuth;
  const JWT_SECRET = 'test-secret-key-for-testing-only';
  const originalEnv = process.env;

  beforeAll(() => {
    // Set test environment
    process.env = { ...originalEnv, JWT_SECRET };
    
    // Clear module cache to ensure fresh import
    jest.resetModules();
    
    // Import after setting env
    requireAuth = require('../../src/middleware/auth').requireAuth;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('No Token Scenarios', () => {
    it('should return 401 when no authorization header is provided', async () => {
      const req = createMockReq();
      const res = createMockRes();
      const next = jest.fn();
      const handler = jest.fn();

      const protectedHandler = requireAuth(handler);
      await protectedHandler(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
      expect(handler).not.toHaveBeenCalled();
    });

    it('should return 401 when authorization header is empty', async () => {
      const req = createMockReq({ authorization: '' });
      const res = createMockRes();
      const next = jest.fn();
      const handler = jest.fn();

      const protectedHandler = requireAuth(handler);
      await protectedHandler(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
      expect(handler).not.toHaveBeenCalled();
    });

    it('should return 401 when authorization header has wrong format', async () => {
      const req = createMockReq({ authorization: 'NotBearer some-token' });
      const res = createMockRes();
      const next = jest.fn();
      const handler = jest.fn();

      const protectedHandler = requireAuth(handler);
      await protectedHandler(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
      expect(handler).not.toHaveBeenCalled();
    });

    it('should return 401 when Bearer token is missing', async () => {
      const req = createMockReq({ authorization: 'Bearer ' });
      const res = createMockRes();
      const next = jest.fn();
      const handler = jest.fn();

      const protectedHandler = requireAuth(handler);
      await protectedHandler(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('Invalid Token Scenarios', () => {
    it('should return 401 when token is malformed', async () => {
      const req = createMockReq({ 
        authorization: 'Bearer not-a-valid-jwt-token' 
      });
      const res = createMockRes();
      const next = jest.fn();
      const handler = jest.fn();

      const protectedHandler = requireAuth(handler);
      await protectedHandler(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid token' });
      expect(handler).not.toHaveBeenCalled();
    });

    it('should return 401 when token is signed with wrong secret', async () => {
      const wrongSecret = 'wrong-secret-key';
      const token = jwt.sign(
        { userId: faker.string.uuid(), email: faker.internet.email() },
        wrongSecret,
        { expiresIn: '1h' }
      );

      const req = createMockReq({ 
        authorization: `Bearer ${token}` 
      });
      const res = createMockRes();
      const next = jest.fn();
      const handler = jest.fn();

      const protectedHandler = requireAuth(handler);
      await protectedHandler(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid token' });
      expect(handler).not.toHaveBeenCalled();
    });

    it('should return 401 when token is expired', async () => {
      const expiredToken = jwt.sign(
        { userId: faker.string.uuid(), email: faker.internet.email() },
        JWT_SECRET,
        { expiresIn: '-1h' } // Already expired
      );

      const req = createMockReq({ 
        authorization: `Bearer ${expiredToken}` 
      });
      const res = createMockRes();
      const next = jest.fn();
      const handler = jest.fn();

      const protectedHandler = requireAuth(handler);
      await protectedHandler(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid token' });
      expect(handler).not.toHaveBeenCalled();
    });

    it('should return 401 when token has invalid signature', async () => {
      const token = jwt.sign(
        { userId: faker.string.uuid(), email: faker.internet.email() },
        JWT_SECRET,
        { expiresIn: '1h' }
      );
      
      // Tamper with the token
      const tamperedToken = token.slice(0, -10) + 'tampered123';

      const req = createMockReq({ 
        authorization: `Bearer ${tamperedToken}` 
      });
      const res = createMockRes();
      const next = jest.fn();
      const handler = jest.fn();

      const protectedHandler = requireAuth(handler);
      await protectedHandler(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid token' });
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('Valid Token Scenarios', () => {
    it('should call handler with user data when token is valid', async () => {
      const userData = {
        userId: faker.string.uuid(),
        email: faker.internet.email(),
        role: 'USER'
      };

      const token = jwt.sign(userData, JWT_SECRET, { expiresIn: '1h' });

      const req = createMockReq({ 
        authorization: `Bearer ${token}` 
      });
      const res = createMockRes();
      const next = jest.fn();
      const handler = jest.fn().mockImplementation((req, res) => {
        res.status(200).json({ success: true });
      });

      const protectedHandler = requireAuth(handler);
      await protectedHandler(req, res, next);

      expect(handler).toHaveBeenCalledWith(req, res);
      expect(req.user).toBeDefined();
      expect(req.user.userId).toBe(userData.userId);
      expect(req.user.email).toBe(userData.email);
      expect(req.user.role).toBe(userData.role);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should handle async handlers correctly', async () => {
      const userData = {
        userId: faker.string.uuid(),
        email: faker.internet.email()
      };

      const token = jwt.sign(userData, JWT_SECRET, { expiresIn: '1h' });

      const req = createMockReq({ 
        authorization: `Bearer ${token}` 
      });
      const res = createMockRes();
      const next = jest.fn();
      
      // Async handler that takes some time
      const handler = jest.fn().mockImplementation(async (req, res) => {
        await new Promise(resolve => setTimeout(resolve, 10));
        res.status(200).json({ success: true, processed: true });
      });

      const protectedHandler = requireAuth(handler);
      await protectedHandler(req, res, next);

      expect(handler).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ success: true, processed: true });
    });

    it('should handle errors thrown by handler', async () => {
      const userData = {
        userId: faker.string.uuid(),
        email: faker.internet.email()
      };

      const token = jwt.sign(userData, JWT_SECRET, { expiresIn: '1h' });

      const req = createMockReq({ 
        authorization: `Bearer ${token}` 
      });
      const res = createMockRes();
      const next = jest.fn();
      
      const errorMessage = 'Handler error';
      const handler = jest.fn().mockImplementation(() => {
        throw new Error(errorMessage);
      });

      const protectedHandler = requireAuth(handler);
      
      // Wrap in try-catch since the middleware might throw
      try {
        await protectedHandler(req, res, next);
      } catch (error) {
        expect(error.message).toBe(errorMessage);
      }

      expect(handler).toHaveBeenCalled();
    });

    it('should pass through different token claims', async () => {
      const customClaims = {
        userId: faker.string.uuid(),
        email: faker.internet.email(),
        role: 'ADMIN',
        permissions: ['read', 'write', 'delete'],
        customField: 'customValue'
      };

      const token = jwt.sign(customClaims, JWT_SECRET, { expiresIn: '1h' });

      const req = createMockReq({ 
        authorization: `Bearer ${token}` 
      });
      const res = createMockRes();
      const next = jest.fn();
      const handler = jest.fn();

      const protectedHandler = requireAuth(handler);
      await protectedHandler(req, res, next);

      expect(handler).toHaveBeenCalled();
      expect(req.user).toMatchObject(customClaims);
      expect(req.user.permissions).toEqual(['read', 'write', 'delete']);
    });

    it('should work with different authorization header cases', async () => {
      const userData = {
        userId: faker.string.uuid(),
        email: faker.internet.email()
      };

      const token = jwt.sign(userData, JWT_SECRET, { expiresIn: '1h' });

      // Test with different cases
      const headerVariations = [
        { authorization: `Bearer ${token}` },
        { Authorization: `Bearer ${token}` },
        { AUTHORIZATION: `Bearer ${token}` }
      ];

      for (const headers of headerVariations) {
        const req = createMockReq(headers);
        const res = createMockRes();
        const next = jest.fn();
        const handler = jest.fn();

        const protectedHandler = requireAuth(handler);
        await protectedHandler(req, res, next);

        expect(handler).toHaveBeenCalled();
        expect(req.user).toBeDefined();
        expect(req.user.userId).toBe(userData.userId);
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle JWT_SECRET not being set', async () => {
      // Temporarily remove JWT_SECRET
      const originalSecret = process.env.JWT_SECRET;
      delete process.env.JWT_SECRET;
      
      // Re-import to get fresh module
      jest.resetModules();
      const { requireAuth: requireAuthNoSecret } = require('../../src/middleware/auth');

      const token = jwt.sign(
        { userId: faker.string.uuid() },
        'some-secret',
        { expiresIn: '1h' }
      );

      const req = createMockReq({ 
        authorization: `Bearer ${token}` 
      });
      const res = createMockRes();
      const next = jest.fn();
      const handler = jest.fn();

      const protectedHandler = requireAuthNoSecret(handler);
      
      // Should fail since no secret is configured
      await protectedHandler(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(handler).not.toHaveBeenCalled();

      // Restore
      process.env.JWT_SECRET = originalSecret;
    });

    it('should handle very long tokens gracefully', async () => {
      const userData = {
        userId: faker.string.uuid(),
        email: faker.internet.email(),
        // Add a lot of data to make token long
        metadata: faker.lorem.paragraphs(10)
      };

      const token = jwt.sign(userData, JWT_SECRET, { expiresIn: '1h' });

      const req = createMockReq({ 
        authorization: `Bearer ${token}` 
      });
      const res = createMockRes();
      const next = jest.fn();
      const handler = jest.fn();

      const protectedHandler = requireAuth(handler);
      await protectedHandler(req, res, next);

      expect(handler).toHaveBeenCalled();
      expect(req.user).toBeDefined();
      expect(req.user.userId).toBe(userData.userId);
    });

    it('should not leak sensitive information in error messages', async () => {
      const scenarios = [
        { authorization: 'Bearer invalid-token' },
        { authorization: 'Bearer ' + jwt.sign({ user: 'test' }, 'wrong-secret') },
        { authorization: 'Bearer expired-token-here' }
      ];

      for (const headers of scenarios) {
        const req = createMockReq(headers);
        const res = createMockRes();
        const next = jest.fn();
        const handler = jest.fn();

        const protectedHandler = requireAuth(handler);
        await protectedHandler(req, res, next);

        // Should not expose specific JWT errors
        expect(res.json).toHaveBeenCalledWith({ error: 'Invalid token' });
        // Should not include stack traces or internal errors
        const jsonCall = res.json.mock.calls[0][0];
        expect(JSON.stringify(jsonCall)).not.toContain('JsonWebTokenError');
        expect(JSON.stringify(jsonCall)).not.toContain('TokenExpiredError');
      }
    });
  });
});