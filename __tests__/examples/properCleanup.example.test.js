/**
 * Example test file showing proper cleanup patterns
 */

const { 
  registerConnection, 
  registerListener, 
  registerMock,
  registerSingleton,
  cleanupTests
} = require('../utils/testCleanup');
const { testDataHelpers } = require('../utils/integrationTestHelpers');

describe('Example: Proper Test Cleanup', () => {
  let mockService;
  let eventEmitter;
  let redisClient;
  let websocket;

  beforeEach(() => {
    // Initialize mocks and services
    mockService = {
      getData: jest.fn(),
      processData: jest.fn(),
      reset: jest.fn(),
    };
    
    // Register mock for cleanup
    registerMock(mockService);
    
    // Create event emitter
    eventEmitter = new (require('events').EventEmitter)();
    
    // Create and register connections
    if (global.testEnv?.redis) {
      redisClient = global.testEnv.redis;
      registerConnection(redisClient);
    }
  });

  afterEach(async () => {
    // This is handled by global cleanup in setup.js
    // But you can add test-specific cleanup here if needed
    
    // Example: Clear specific Redis keys used in this test
    if (redisClient) {
      await redisClient.del('test:key:*');
    }
    
    // Example: Remove specific event listeners
    eventEmitter.removeAllListeners();
  });

  describe('Database Tests', () => {
    it('should create and clean up test data', async () => {
      // Use global test environment
      const { prisma } = global.testEnv;
      
      // Create test user
      const user = await testDataHelpers.createTestUser(prisma, {
        email: 'cleanup-test@example.com',
      });
      
      expect(user).toBeDefined();
      expect(user.email).toBe('cleanup-test@example.com');
      
      // Create test order
      const order = await testDataHelpers.createTestOrder(prisma, user.id);
      
      expect(order).toBeDefined();
      expect(order.userId).toBe(user.id);
      
      // Data will be automatically cleaned up after test
    });

    it('should handle concurrent database operations', async () => {
      const { prisma } = global.testEnv;
      
      // Create multiple users concurrently
      const userPromises = Array.from({ length: 5 }, (_, i) => 
        testDataHelpers.createTestUser(prisma, {
          email: `concurrent-${i}@example.com`,
        })
      );
      
      const users = await Promise.all(userPromises);
      
      expect(users).toHaveLength(5);
      
      // All data will be cleaned up automatically
    });
  });

  describe('Redis Tests', () => {
    it('should set and clean up Redis data', async () => {
      const { redis } = global.testEnv;
      
      // Set test data
      await redis.set('test:key:1', 'value1');
      await redis.hset('test:hash:1', 'field1', 'value1');
      await redis.sadd('test:set:1', 'member1', 'member2');
      
      // Verify data exists
      expect(await redis.get('test:key:1')).toBe('value1');
      expect(await redis.hget('test:hash:1', 'field1')).toBe('value1');
      expect(await redis.scard('test:set:1')).toBe(2);
      
      // Data will be automatically cleaned up
    });

    it('should handle Redis pub/sub', async () => {
      const { redis } = global.testEnv;
      
      // Create subscriber
      const subscriber = redis.duplicate();
      await subscriber.connect();
      registerConnection(subscriber);
      
      const messages = [];
      const handler = (message) => messages.push(message);
      
      // Subscribe and register listener
      await subscriber.subscribe('test:channel', handler);
      registerListener(subscriber, 'message', handler);
      
      // Publish message
      await redis.publish('test:channel', 'test message');
      
      // Wait for message
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(messages).toContain('test message');
      
      // Cleanup is automatic
    });
  });

  describe('Mock and Stub Tests', () => {
    it('should properly clean up mocks', async () => {
      // Setup mock
      mockService.getData.mockResolvedValue({ data: 'test' });
      mockService.processData.mockImplementation((data) => {
        return { processed: data };
      });
      
      // Use mock
      const result = await mockService.getData();
      const processed = mockService.processData(result);
      
      expect(processed).toEqual({ processed: { data: 'test' } });
      expect(mockService.getData).toHaveBeenCalledTimes(1);
      expect(mockService.processData).toHaveBeenCalledWith({ data: 'test' });
      
      // Mocks will be cleared automatically
    });
  });

  describe('Event Listener Tests', () => {
    it('should clean up event listeners', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();
      
      // Add listeners and register them
      eventEmitter.on('test-event', handler1);
      eventEmitter.on('test-event', handler2);
      registerListener(eventEmitter, 'test-event', handler1);
      registerListener(eventEmitter, 'test-event', handler2);
      
      // Emit event
      eventEmitter.emit('test-event', 'data');
      
      expect(handler1).toHaveBeenCalledWith('data');
      expect(handler2).toHaveBeenCalledWith('data');
      
      // Listeners will be removed automatically
    });
  });

  describe('Singleton Service Tests', () => {
    it('should reset singleton services', () => {
      // Create a singleton service
      class SingletonService {
        constructor() {
          this.data = [];
          this.connections = new Set();
        }
        
        addData(item) {
          this.data.push(item);
        }
        
        connect(id) {
          this.connections.add(id);
        }
        
        reset() {
          this.data = [];
          this.connections.clear();
        }
      }
      
      const singleton = new SingletonService();
      registerSingleton('testSingleton', singleton);
      
      // Use singleton
      singleton.addData('test1');
      singleton.addData('test2');
      singleton.connect('conn1');
      
      expect(singleton.data).toHaveLength(2);
      expect(singleton.connections.size).toBe(1);
      
      // Singleton will be reset automatically
    });
  });

  describe('WebSocket Tests', () => {
    it('should clean up WebSocket connections', (done) => {
      // Mock WebSocket
      const mockWs = {
        readyState: 1, // OPEN
        close: jest.fn(),
        send: jest.fn(),
        on: jest.fn(),
        removeListener: jest.fn(),
      };
      
      registerConnection(mockWs);
      
      // Use WebSocket
      mockWs.send('test message');
      
      expect(mockWs.send).toHaveBeenCalledWith('test message');
      
      // Simulate close
      setTimeout(() => {
        mockWs.readyState = 3; // CLOSED
        done();
      }, 100);
      
      // WebSocket will be closed automatically if still open
    });
  });

  describe('Timer Tests', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should clean up timers', () => {
      const callback = jest.fn();
      
      // Set timers
      setTimeout(callback, 1000);
      setInterval(callback, 500);
      
      // Advance time
      jest.advanceTimersByTime(2000);
      
      expect(callback).toHaveBeenCalledTimes(5); // 1 timeout + 4 intervals
      
      // Timers will be cleared automatically
    });
  });
});

// Example of custom cleanup for specific test suites
describe('Custom Cleanup Example', () => {
  // Custom cleanup function
  const customCleanup = async () => {
    // Perform custom cleanup logic
    console.log('Performing custom cleanup...');
  };

  afterEach(async () => {
    // Call global cleanup with specific options
    await cleanupTests({
      database: true,
      redis: true,
      mocks: true,
      timers: true,
      singletons: true,
      websockets: true,
      modules: ['./src/services'], // Reset specific modules
    });
    
    // Perform custom cleanup
    await customCleanup();
  });

  it('should use custom cleanup', () => {
    expect(true).toBe(true);
  });
});