/**
 * Test cleanup utilities to prevent shared state between tests
 */

const { PrismaClient } = require('@prisma/client');
const Redis = require('ioredis');

// Track all active connections and listeners
const activeConnections = new Set();
const activeListeners = new Map();
const activeMocks = new Set();
const activeTimers = new Set();
const singletonInstances = new Map();

/**
 * Register a connection for cleanup
 */
function registerConnection(connection) {
  activeConnections.add(connection);
}

/**
 * Register an event listener for cleanup
 */
function registerListener(emitter, event, handler) {
  if (!activeListeners.has(emitter)) {
    activeListeners.set(emitter, new Map());
  }
  const emitterListeners = activeListeners.get(emitter);
  if (!emitterListeners.has(event)) {
    emitterListeners.set(event, new Set());
  }
  emitterListeners.get(event).add(handler);
}

/**
 * Register a mock for cleanup
 */
function registerMock(mock) {
  activeMocks.add(mock);
}

/**
 * Register a timer for cleanup
 */
function registerTimer(timer) {
  activeTimers.add(timer);
}

/**
 * Register a singleton instance
 */
function registerSingleton(name, instance) {
  singletonInstances.set(name, instance);
}

/**
 * Clean up all database connections
 */
async function cleanupDatabase() {
  // Clean up Prisma connections
  const prismaInstances = [...singletonInstances.values()].filter(
    instance => instance instanceof PrismaClient
  );
  
  for (const prisma of prismaInstances) {
    try {
      // Clear test data
      await prisma.$transaction([
        prisma.order.deleteMany({}),
        prisma.trade.deleteMany({}),
        prisma.user.deleteMany({}),
        prisma.notification.deleteMany({}),
        prisma.apiKey.deleteMany({}),
        prisma.webhook.deleteMany({}),
      ]);
      
      // Disconnect
      await prisma.$disconnect();
    } catch (error) {
      console.error('Error cleaning up Prisma:', error);
    }
  }
}

/**
 * Clean up all Redis connections
 */
async function cleanupRedis() {
  // Find all Redis instances
  const redisInstances = [...activeConnections].filter(
    conn => conn instanceof Redis || conn.constructor.name === 'Redis'
  );
  
  for (const redis of redisInstances) {
    try {
      // Clear test data
      await redis.flushdb();
      
      // Disconnect
      redis.disconnect();
      activeConnections.delete(redis);
    } catch (error) {
      console.error('Error cleaning up Redis:', error);
    }
  }
}

/**
 * Clean up all event listeners
 */
function cleanupEventListeners() {
  for (const [emitter, events] of activeListeners) {
    for (const [event, handlers] of events) {
      for (const handler of handlers) {
        emitter.removeListener(event, handler);
      }
    }
  }
  activeListeners.clear();
}

/**
 * Clean up all mocks
 */
function cleanupMocks() {
  // Clear all Jest mocks
  jest.clearAllMocks();
  jest.restoreAllMocks();
  
  // Clear registered mocks
  for (const mock of activeMocks) {
    if (typeof mock.restore === 'function') {
      mock.restore();
    }
  }
  activeMocks.clear();
}

/**
 * Clean up all timers
 */
function cleanupTimers() {
  // Clear all timers
  jest.clearAllTimers();
  
  // Clear registered timers
  for (const timer of activeTimers) {
    clearTimeout(timer);
    clearInterval(timer);
  }
  activeTimers.clear();
}

/**
 * Clean up singleton instances
 */
function cleanupSingletons() {
  for (const [name, instance] of singletonInstances) {
    // Call reset method if available
    if (typeof instance.reset === 'function') {
      instance.reset();
    } else if (typeof instance.clear === 'function') {
      instance.clear();
    } else if (typeof instance.destroy === 'function') {
      instance.destroy();
    }
  }
  singletonInstances.clear();
}

/**
 * Clean up WebSocket connections
 */
function cleanupWebSockets() {
  const wsConnections = [...activeConnections].filter(
    conn => conn.readyState !== undefined && typeof conn.close === 'function'
  );
  
  for (const ws of wsConnections) {
    try {
      ws.close();
      activeConnections.delete(ws);
    } catch (error) {
      console.error('Error closing WebSocket:', error);
    }
  }
}

/**
 * Reset module cache for specific modules
 */
function resetModules(modulePatterns = []) {
  // Reset all modules by default
  if (modulePatterns.length === 0) {
    jest.resetModules();
    return;
  }
  
  // Reset specific modules
  const moduleIds = Object.keys(require.cache);
  for (const pattern of modulePatterns) {
    const regex = new RegExp(pattern);
    moduleIds
      .filter(id => regex.test(id))
      .forEach(id => delete require.cache[id]);
  }
}

/**
 * Complete cleanup function to be called in afterEach
 */
async function cleanupTests(options = {}) {
  const {
    database = true,
    redis = true,
    listeners = true,
    mocks = true,
    timers = true,
    singletons = true,
    websockets = true,
    modules = [],
  } = options;
  
  // Run all cleanup tasks
  const cleanupTasks = [];
  
  if (mocks) cleanupMocks();
  if (timers) cleanupTimers();
  if (listeners) cleanupEventListeners();
  if (websockets) cleanupWebSockets();
  if (singletons) cleanupSingletons();
  if (database) cleanupTasks.push(cleanupDatabase());
  if (redis) cleanupTasks.push(cleanupRedis());
  
  // Wait for async cleanup tasks
  await Promise.all(cleanupTasks);
  
  // Reset modules if requested
  if (modules.length > 0 || modules === true) {
    resetModules(modules === true ? [] : modules);
  }
  
  // Clear all registered items
  activeConnections.clear();
  activeListeners.clear();
  activeMocks.clear();
  activeTimers.clear();
}

/**
 * Setup function to be called in beforeEach
 */
function setupTests() {
  // Clear any state from previous tests
  activeConnections.clear();
  activeListeners.clear();
  activeMocks.clear();
  activeTimers.clear();
  
  // Reset Jest state
  jest.clearAllMocks();
  jest.clearAllTimers();
}

module.exports = {
  // Registration functions
  registerConnection,
  registerListener,
  registerMock,
  registerTimer,
  registerSingleton,
  
  // Individual cleanup functions
  cleanupDatabase,
  cleanupRedis,
  cleanupEventListeners,
  cleanupMocks,
  cleanupTimers,
  cleanupSingletons,
  cleanupWebSockets,
  resetModules,
  
  // Main cleanup and setup
  cleanupTests,
  setupTests,
  
  // Expose collections for advanced usage
  activeConnections,
  activeListeners,
  activeMocks,
  activeTimers,
  singletonInstances,
};