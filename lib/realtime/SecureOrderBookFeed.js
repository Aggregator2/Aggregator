const EventEmitter = require('events');
const crypto = require('crypto');
const { getSecureMetricsCollector } = require('../monitoring/secure-metrics-collector');

/**
 * Secure Order Book Depth Feed System
 * Addresses critical security vulnerabilities with enhanced validation and bounds checking
 */
class SecureOrderBookFeed extends EventEmitter {
  constructor(config = {}) {
    super();
    
    // Validate configuration
    this.validateConfig(config);
    
    this.config = {
      maxDepth: Math.min(Math.max(config.maxDepth || 50, 1), 1000), // 1-1000 range
      updateInterval: Math.max(config.updateInterval || 100, 10), // Min 10ms
      priceGrouping: Math.min(Math.max(config.priceGrouping || 8, 0), 18), // 0-18 decimals
      enableCompression: config.enableCompression !== false,
      enableDelta: config.enableDelta !== false,
      maxSymbols: Math.min(config.maxSymbols || 1000, 10000), // Max 10k symbols
      maxSubscriptionsPerSymbol: Math.min(config.maxSubscriptionsPerSymbol || 1000, 5000),
      maxOrdersPerLevel: Math.min(config.maxOrdersPerLevel || 1000, 10000),
      maxUpdateBatchSize: Math.min(config.maxUpdateBatchSize || 1000, 5000),
      maxPendingUpdates: Math.min(config.maxPendingUpdates || 10000, 50000),
      updateProcessingTimeout: Math.max(config.updateProcessingTimeout || 5000, 1000),
      memoryThresholdMB: Math.max(config.memoryThresholdMB || 100, 50),
      enableIntegrityChecks: config.enableIntegrityChecks !== false,
      encryptionKey: config.encryptionKey, // Required for secure hashing
      ...config
    };
    
    this.metrics = getSecureMetricsCollector();
    this.webSocketManager = null;
    
    // Secure state management with bounded collections
    this.orderBooks = new Map(); // symbol -> order book data (bounded)
    this.lastSnapshots = new LRUCache(this.config.maxSymbols); 
    this.pendingUpdates = new Map(); // symbol -> bounded updates array
    this.updateBuffer = new LRUCache(this.config.maxSymbols * 10);
    
    // Subscription management with limits
    this.subscriptions = new Map(); // subscriptionKey -> subscription details
    this.symbolSubscribers = new Map(); // symbol -> Set of subscription keys (bounded)
    
    // Security controls
    this.securityConfig = {
      maxProcessingTimeMs: 1000,
      maxMemoryUsageMB: 200,
      maxConcurrentUpdates: 100,
      enableRateLimiting: true,
      maxUpdatesPerSecond: 10000,
      suspiciousActivityThreshold: 1000,
      enableCircuitBreaker: true,
      circuitBreakerThreshold: 0.5,
      maxSequenceIdGap: 1000000,
      hashAlgorithm: 'sha256'
    };
    
    // Performance and security tracking
    this.performanceStats = {
      updatesProcessed: 0,
      snapshotsSent: 0,
      deltasSent: 0,
      compressionRatio: 0,
      avgUpdateLatency: 0,
      subscriptionsActive: 0,
      booksTracked: 0,
      securityViolations: 0,
      memoryUsageMB: 0,
      circuitBreakerTrips: 0,
      integrityCheckFailures: 0,
      bufferOverflowPrevented: 0,
      raceConditionsDetected: 0
    };
    
    // Circuit breaker state
    this.circuitBreaker = {
      state: 'closed', // closed, open, half-open
      failureCount: 0,
      lastFailureTime: 0,
      resetTimeout: 30000 // 30 seconds
    };
    
    // Rate limiting for updates
    this.updateRateLimiter = {
      windowMs: 1000,
      maxUpdates: this.securityConfig.maxUpdatesPerSecond,
      currentWindow: Math.floor(Date.now() / 1000),
      currentCount: 0
    };
    
    // Buffering and batching with security
    this.updateTimer = null;
    this.lastUpdateTime = new Map(); // symbol -> last update timestamp
    this.activeProcessingTasks = new Set(); // Track concurrent processing
    
    // Input validation schemas
    this.validationSchemas = {
      orderData: {
        side: { type: 'string', enum: ['buy', 'sell'], required: true },
        price: { type: 'string', pattern: /^\d+\.?\d*$/, maxLength: 20, required: true },
        size: { type: 'string', pattern: /^\d+\.?\d*$/, maxLength: 20, required: true },
        orderId: { type: 'string', maxLength: 100, required: true },
        type: { type: 'string', enum: ['add', 'update', 'remove'], required: true }
      },
      symbol: {
        type: 'string',
        pattern: /^[A-Z]{2,10}\/[A-Z]{2,10}$/,
        maxLength: 20,
        required: true
      }
    };
    
    this.startUpdateProcessor();
    this.startSecurityMonitoring();
  }
  
  /**
   * Validate configuration for security
   */
  validateConfig(config) {
    const requiredFields = ['encryptionKey'];
    const missingFields = requiredFields.filter(field => !config[field]);
    if (missingFields.length > 0) {
      throw new SecurityError(`Missing required configuration: ${missingFields.join(', ')}`);
    }
    
    // Validate numeric ranges
    if (config.maxDepth && (config.maxDepth < 1 || config.maxDepth > 1000)) {
      throw new SecurityError('maxDepth must be between 1 and 1000');
    }
    
    if (config.updateInterval && config.updateInterval < 10) {
      throw new SecurityError('updateInterval must be at least 10ms');
    }
  }
  
  /**
   * Initialize with WebSocket manager
   */
  initialize(webSocketManager) {
    this.webSocketManager = webSocketManager;
    
    // Listen for subscription events with validation
    this.webSocketManager.on('subscribed', (event) => {
      try {
        if (event.channel === 'orderbook') {
          this.handleSubscription(event);
        }
      } catch (error) {
        this.handleSecurityViolation('subscription_error', error);
      }
    });
    
    this.webSocketManager.on('unsubscribed', (event) => {
      try {
        if (event.channel === 'orderbook') {
          this.handleUnsubscription(event);
        }
      } catch (error) {
        this.handleSecurityViolation('unsubscription_error', error);
      }
    });
    
    this.webSocketManager.on('disconnection', (event) => {
      this.handleDisconnection(event);
    });
  }
  
  /**
   * Secure order book update with comprehensive validation
   */
  updateOrderBook(symbol, orderData) {
    const startTime = Date.now();
    
    try {
      // Rate limiting check
      if (!this.checkUpdateRateLimit()) {
        this.performanceStats.securityViolations++;
        throw new SecurityError('Update rate limit exceeded');
      }
      
      // Circuit breaker check
      if (this.circuitBreaker.state === 'open') {
        throw new SecurityError('Circuit breaker is open');
      }
      
      // Validate inputs
      this.validateOrderBookInput(symbol, orderData);
      
      // Check memory usage
      this.checkMemoryUsage();
      
      // Get or create order book with security checks
      let orderBook = this.getOrCreateOrderBook(symbol);
      
      // Process the order update with race condition protection
      const changes = this.secureProcessOrderUpdate(orderBook, orderData);
      
      if (changes.length > 0) {
        this.addPendingUpdate(symbol, changes, orderBook.sequenceId++);
        this.lastUpdateTime.set(symbol, Date.now());
      }
      
      this.performanceStats.updatesProcessed++;
      this.performanceStats.avgUpdateLatency = this.updateAverage(
        this.performanceStats.avgUpdateLatency,
        Date.now() - startTime,
        this.performanceStats.updatesProcessed
      );
      
      // Reset circuit breaker on success
      if (this.circuitBreaker.state === 'half-open') {
        this.circuitBreaker.state = 'closed';
        this.circuitBreaker.failureCount = 0;
      }
      
    } catch (error) {
      this.handleUpdateError(error, symbol, orderData);
      throw error; // Re-throw for caller handling
    }
  }
  
  /**
   * Validate order book input data
   */
  validateOrderBookInput(symbol, orderData) {
    // Validate symbol
    if (!this.validateField(symbol, this.validationSchemas.symbol)) {
      throw new SecurityError('Invalid symbol format');
    }
    
    // Validate order data
    for (const [field, schema] of Object.entries(this.validationSchemas.orderData)) {
      if (!this.validateField(orderData[field], schema)) {
        throw new SecurityError(`Invalid ${field} in order data`);
      }
    }
    
    // Additional security checks
    const price = parseFloat(orderData.price);
    const size = parseFloat(orderData.size);
    
    if (price <= 0 || price > 1e12) {
      throw new SecurityError('Price out of acceptable range');
    }
    
    if (size < 0 || size > 1e12) {
      throw new SecurityError('Size out of acceptable range');
    }
    
    // Check for dangerous strings
    if (this.containsDangerousPatterns(orderData.orderId)) {
      throw new SecurityError('OrderId contains dangerous patterns');
    }
  }
  
  /**
   * Validate field against schema
   */
  validateField(value, schema) {
    if (schema.required && (value === undefined || value === null)) {
      return false;
    }
    
    if (value === undefined || value === null) {
      return !schema.required;
    }
    
    if (schema.type && typeof value !== schema.type) {
      return false;
    }
    
    if (schema.maxLength && value.length > schema.maxLength) {
      return false;
    }
    
    if (schema.pattern && !schema.pattern.test(value)) {
      return false;
    }
    
    if (schema.enum && !schema.enum.includes(value)) {
      return false;
    }
    
    return true;
  }
  
  /**
   * Check for dangerous patterns in strings
   */
  containsDangerousPatterns(str) {
    const dangerousPatterns = [
      /__proto__/, /constructor/, /prototype/,
      /<script>/, /javascript:/, /vbscript:/,
      /\$\{/, /\$\(/, /`/, /eval\(/
    ];
    
    return dangerousPatterns.some(pattern => pattern.test(str));
  }
  
  /**
   * Get or create order book with security checks
   */
  getOrCreateOrderBook(symbol) {
    let orderBook = this.orderBooks.get(symbol);
    
    if (!orderBook) {
      // Check symbol limit
      if (this.orderBooks.size >= this.config.maxSymbols) {
        throw new SecurityError('Maximum symbols limit exceeded');
      }
      
      orderBook = this.createEmptyOrderBook(symbol);
      this.orderBooks.set(symbol, orderBook);
      this.performanceStats.booksTracked++;
    }
    
    return orderBook;
  }
  
  /**
   * Secure process order update with race condition protection
   */
  secureProcessOrderUpdate(orderBook, orderData) {
    const updateId = crypto.randomBytes(16).toString('hex');
    
    // Lock the order book for atomic updates
    if (orderBook.updateLock) {
      this.performanceStats.raceConditionsDetected++;
      throw new SecurityError('Concurrent update detected');
    }
    
    orderBook.updateLock = updateId;
    
    try {
      const { side, price, size, orderId, type } = orderData;
      const changes = [];
      
      // Validate sequence
      if (orderBook.lastSequenceId && orderData.sequenceId) {
        const gap = orderData.sequenceId - orderBook.lastSequenceId;
        if (gap > this.securityConfig.maxSequenceIdGap) {
          throw new SecurityError('Sequence ID gap too large');
        }
      }
      
      if (type === 'add' || type === 'update') {
        this.secureAddOrUpdateOrder(orderBook, side, price, size, orderId, changes);
      } else if (type === 'remove') {
        this.secureRemoveOrder(orderBook, side, price, orderId, changes);
      }
      
      // Maintain order book integrity with bounds checking
      this.secureOrderBookMaintenance(orderBook, side);
      
      // Integrity check
      if (this.config.enableIntegrityChecks) {
        this.validateOrderBookIntegrity(orderBook);
      }
      
      orderBook.lastSequenceId = orderData.sequenceId;
      return changes;
      
    } finally {
      // Always release lock
      delete orderBook.updateLock;
    }
  }
  
  /**
   * Secure add or update order with bounds checking
   */
  secureAddOrUpdateOrder(orderBook, side, price, size, orderId, changes) {
    const targetSide = side === 'buy' ? orderBook.bids : orderBook.asks;
    
    if (parseFloat(size) > 0) {
      let existingLevel = targetSide.get(price);
      
      if (existingLevel) {
        // Check orders limit per level
        if (existingLevel.orders.size >= this.config.maxOrdersPerLevel) {
          if (!existingLevel.orders.has(orderId)) {
            throw new SecurityError('Max orders per level exceeded');
          }
        }
        
        existingLevel.size = parseFloat(size);
        existingLevel.orders.set(orderId, { 
          size: parseFloat(size), 
          timestamp: Date.now() 
        });
      } else {
        // Check total levels limit
        if (targetSide.size >= this.config.maxDepth) {
          this.performanceStats.bufferOverflowPrevented++;
          
          // Remove worst level to make space
          const sortedLevels = Array.from(targetSide.entries()).sort((a, b) => {
            return side === 'buy' ? 
              parseFloat(a[0]) - parseFloat(b[0]) : // Remove lowest bid
              parseFloat(b[0]) - parseFloat(a[0]);  // Remove highest ask
          });
          
          if (sortedLevels.length > 0) {
            targetSide.delete(sortedLevels[0][0]);
          }
        }
        
        targetSide.set(price, {
          price: price,
          size: parseFloat(size),
          orders: new Map([[orderId, { 
            size: parseFloat(size), 
            timestamp: Date.now() 
          }]])
        });
      }
      
      changes.push({
        type: 'level_update',
        side: side,
        price: price,
        size: parseFloat(size)
      });
    } else {
      // Remove order/level
      this.secureRemoveOrder(orderBook, side, price, orderId, changes);
    }
  }
  
  /**
   * Secure remove order with validation
   */
  secureRemoveOrder(orderBook, side, price, orderId, changes) {
    const targetSide = side === 'buy' ? orderBook.bids : orderBook.asks;
    const level = targetSide.get(price);
    
    if (level && level.orders.has(orderId)) {
      level.orders.delete(orderId);
      
      if (level.orders.size === 0) {
        targetSide.delete(price);
        changes.push({
          type: 'level_remove',
          side: side,
          price: price,
          size: 0
        });
      } else {
        // Recalculate level size atomically
        level.size = Array.from(level.orders.values())
          .reduce((total, order) => total + order.size, 0);
        
        changes.push({
          type: 'level_update',
          side: side,
          price: price,
          size: level.size
        });
      }
    }
  }
  
  /**
   * Secure order book maintenance with bounds checking
   */
  secureOrderBookMaintenance(orderBook, side) {
    const targetSide = side === 'buy' ? orderBook.bids : orderBook.asks;
    
    // Convert to sorted array with size limit
    const maxEntries = Math.min(targetSide.size, this.config.maxDepth * 2);
    const sortedLevels = Array.from(targetSide.entries())
      .slice(0, maxEntries)
      .sort((a, b) => {
        return side === 'buy' ? 
          parseFloat(b[0]) - parseFloat(a[0]) : // Bids: highest first
          parseFloat(a[0]) - parseFloat(b[0]);  // Asks: lowest first
      });
    
    // Trim to max depth with buffer overflow protection
    if (sortedLevels.length > this.config.maxDepth) {
      const levelsToRemove = sortedLevels.slice(this.config.maxDepth);
      levelsToRemove.forEach(([price]) => {
        targetSide.delete(price);
        this.performanceStats.bufferOverflowPrevented++;
      });
    }
    
    // Update best bid/ask safely
    if (side === 'buy' && sortedLevels.length > 0) {
      orderBook.bestBid = sortedLevels[0][0];
    } else if (side === 'sell' && sortedLevels.length > 0) {
      orderBook.bestAsk = sortedLevels[0][0];
    }
    
    // Update spread with validation
    if (orderBook.bestBid && orderBook.bestAsk) {
      const bid = parseFloat(orderBook.bestBid);
      const ask = parseFloat(orderBook.bestAsk);
      
      if (ask > bid) { // Sanity check
        orderBook.spread = ask - bid;
        orderBook.spreadPercent = (orderBook.spread / ask) * 100;
      }
    }
  }
  
  /**
   * Validate order book integrity
   */
  validateOrderBookIntegrity(orderBook) {
    // Check best bid/ask consistency
    if (orderBook.bestBid && orderBook.bestAsk) {
      const bid = parseFloat(orderBook.bestBid);
      const ask = parseFloat(orderBook.bestAsk);
      
      if (bid >= ask) {
        this.performanceStats.integrityCheckFailures++;
        throw new SecurityError('Order book integrity violation: bid >= ask');
      }
    }
    
    // Check level consistency
    for (const [side, levels] of [['buy', orderBook.bids], ['sell', orderBook.asks]]) {
      for (const [price, level] of levels) {
        const calculatedSize = Array.from(level.orders.values())
          .reduce((total, order) => total + order.size, 0);
        
        if (Math.abs(calculatedSize - level.size) > 0.00000001) {
          this.performanceStats.integrityCheckFailures++;
          throw new SecurityError(`Level size mismatch for ${price} on ${side} side`);
        }
      }
    }
  }
  
  /**
   * Add pending update with bounds checking
   */
  addPendingUpdate(symbol, changes, sequenceId) {
    if (!this.pendingUpdates.has(symbol)) {
      this.pendingUpdates.set(symbol, []);
    }
    
    const updates = this.pendingUpdates.get(symbol);
    
    // Check pending updates limit
    if (updates.length >= this.config.maxPendingUpdates) {
      this.performanceStats.bufferOverflowPrevented++;
      // Remove oldest update
      updates.shift();
    }
    
    updates.push({
      changes: changes,
      timestamp: Date.now(),
      sequenceId: sequenceId
    });
  }
  
  /**
   * Check update rate limiting
   */
  checkUpdateRateLimit() {
    const now = Math.floor(Date.now() / 1000);
    
    if (now > this.updateRateLimiter.currentWindow) {
      this.updateRateLimiter.currentWindow = now;
      this.updateRateLimiter.currentCount = 0;
    }
    
    this.updateRateLimiter.currentCount++;
    return this.updateRateLimiter.currentCount <= this.updateRateLimiter.maxUpdates;
  }
  
  /**
   * Check memory usage
   */
  checkMemoryUsage() {
    const used = process.memoryUsage();
    const usedMB = used.heapUsed / 1024 / 1024;
    this.performanceStats.memoryUsageMB = usedMB;
    
    if (usedMB > this.config.memoryThresholdMB) {
      throw new SecurityError('Memory usage threshold exceeded');
    }
  }
  
  /**
   * Handle subscription with security validation
   */
  handleSubscription(event) {
    const { connectionId, params } = event;
    
    // Validate parameters
    if (!params || !params.symbol) {
      throw new SecurityError('Invalid subscription parameters');
    }
    
    const { symbol, depth = this.config.maxDepth, grouped = false } = params;
    
    // Validate symbol
    if (!this.validateField(symbol, this.validationSchemas.symbol)) {
      throw new SecurityError('Invalid symbol format');
    }
    
    // Check subscription limits
    if (!this.symbolSubscribers.has(symbol)) {
      this.symbolSubscribers.set(symbol, new Set());
    }
    
    const symbolSubs = this.symbolSubscribers.get(symbol);
    if (symbolSubs.size >= this.config.maxSubscriptionsPerSymbol) {
      throw new SecurityError('Max subscriptions per symbol exceeded');
    }
    
    const subscriptionKey = this.generateSecureSubscriptionKey(connectionId, symbol, depth, grouped);
    
    // Store subscription details with bounds
    this.subscriptions.set(subscriptionKey, {
      connectionId: connectionId,
      symbol: symbol,
      depth: Math.min(Math.max(depth, 1), this.config.maxDepth),
      grouped: Boolean(grouped),
      subscribedAt: Date.now(),
      lastSnapshot: null,
      deltaMode: this.config.enableDelta
    });
    
    symbolSubs.add(subscriptionKey);
    this.performanceStats.subscriptionsActive++;
    
    // Send initial snapshot
    this.sendOrderBookSnapshot(subscriptionKey);
    
    this.emit('subscription_added', { subscriptionKey, symbol, connectionId });
  }
  
  /**
   * Generate secure subscription key
   */
  generateSecureSubscriptionKey(connectionId, symbol, depth, grouped) {
    const data = `${connectionId}:${symbol}:${depth}:${grouped}:${Date.now()}`;
    return crypto.createHmac('sha256', this.config.encryptionKey)
      .update(data)
      .digest('hex')
      .substring(0, 32);
  }
  
  /**
   * Handle update errors with circuit breaker
   */
  handleUpdateError(error, symbol, orderData) {
    this.circuitBreaker.failureCount++;
    this.circuitBreaker.lastFailureTime = Date.now();
    
    if (this.circuitBreaker.failureCount >= this.securityConfig.circuitBreakerThreshold * 10) {
      this.circuitBreaker.state = 'open';
      this.performanceStats.circuitBreakerTrips++;
    }
    
    this.performanceStats.securityViolations++;
    this.emit('security_violation', {
      type: 'update_error',
      error: error.message,
      symbol: symbol,
      timestamp: Date.now()
    });
  }
  
  /**
   * Handle security violations
   */
  handleSecurityViolation(type, error) {
    this.performanceStats.securityViolations++;
    this.emit('security_violation', {
      type: type,
      error: error.message,
      timestamp: Date.now()
    });
  }
  
  /**
   * Start security monitoring
   */
  startSecurityMonitoring() {
    setInterval(() => {
      this.performSecurityChecks();
    }, 60000); // Every minute
  }
  
  /**
   * Perform periodic security checks
   */
  performSecurityChecks() {
    // Memory check
    this.checkMemoryUsage();
    
    // Circuit breaker reset check
    if (this.circuitBreaker.state === 'open') {
      const timeSinceFailure = Date.now() - this.circuitBreaker.lastFailureTime;
      if (timeSinceFailure > this.circuitBreaker.resetTimeout) {
        this.circuitBreaker.state = 'half-open';
      }
    }
    
    // Clean up stale data
    this.cleanupStaleData();
  }
  
  /**
   * Clean up stale data to prevent memory leaks
   */
  cleanupStaleData() {
    const now = Date.now();
    const staleThreshold = 24 * 60 * 60 * 1000; // 24 hours
    
    // Clean up old pending updates
    for (const [symbol, updates] of this.pendingUpdates) {
      const filteredUpdates = updates.filter(update => 
        (now - update.timestamp) < staleThreshold
      );
      
      if (filteredUpdates.length !== updates.length) {
        this.pendingUpdates.set(symbol, filteredUpdates);
      }
    }
    
    // Clean up inactive order books
    for (const [symbol, orderBook] of this.orderBooks) {
      if ((now - orderBook.lastUpdated) > staleThreshold) {
        this.clearOrderBook(symbol);
      }
    }
  }
  
  /**
   * Start update processor with security
   */
  startUpdateProcessor() {
    this.updateTimer = setInterval(() => {
      try {
        this.processBufferedUpdates();
      } catch (error) {
        this.handleSecurityViolation('update_processor_error', error);
      }
    }, this.config.updateInterval);
  }
  
  /**
   * Process buffered updates with concurrency control
   */
  processBufferedUpdates() {
    if (this.activeProcessingTasks.size >= this.securityConfig.maxConcurrentUpdates) {
      return; // Skip if too many active tasks
    }
    
    const taskId = crypto.randomBytes(8).toString('hex');
    this.activeProcessingTasks.add(taskId);
    
    try {
      for (const [symbol, updates] of this.pendingUpdates) {
        if (updates.length === 0) continue;
        
        // Limit batch size
        const batchSize = Math.min(updates.length, this.config.maxUpdateBatchSize);
        const batchUpdates = updates.slice(0, batchSize);
        
        // Get subscribers for this symbol
        const subscribers = this.symbolSubscribers.get(symbol);
        if (!subscribers || subscribers.size === 0) {
          this.pendingUpdates.set(symbol, updates.slice(batchSize));
          continue;
        }
        
        // Process updates for each subscriber
        for (const subscriptionKey of subscribers) {
          this.sendOrderBookUpdate(subscriptionKey, batchUpdates);
        }
        
        // Remove processed updates
        this.pendingUpdates.set(symbol, updates.slice(batchSize));
      }
    } finally {
      this.activeProcessingTasks.delete(taskId);
    }
  }
  
  // ... Continue with remaining methods (sendOrderBookSnapshot, handleUnsubscription, etc.)
  // maintaining the same security pattern
  
  /**
   * Create empty order book with security defaults
   */
  createEmptyOrderBook(symbol) {
    return {
      symbol: symbol,
      bids: new Map(),
      asks: new Map(),
      bestBid: null,
      bestAsk: null,
      spread: null,
      spreadPercent: null,
      sequenceId: 1,
      lastUpdated: Date.now(),
      lastSequenceId: 0,
      updateLock: null
    };
  }
  
  /**
   * Update running average
   */
  updateAverage(currentAvg, newValue, count) {
    return currentAvg + (newValue - currentAvg) / count;
  }
  
  /**
   * Get order book with validation
   */
  getOrderBook(symbol) {
    if (!this.validateField(symbol, this.validationSchemas.symbol)) {
      throw new SecurityError('Invalid symbol format');
    }
    return this.orderBooks.get(symbol);
  }
  
  /**
   * Clear order book securely
   */
  clearOrderBook(symbol) {
    this.orderBooks.delete(symbol);
    this.pendingUpdates.delete(symbol);
    this.lastUpdateTime.delete(symbol);
    this.lastSnapshots.delete(symbol);
  }
  
  /**
   * Get comprehensive statistics
   */
  getStats() {
    return {
      ...this.performanceStats,
      booksTracked: this.orderBooks.size,
      subscriptionsActive: this.subscriptions.size,
      symbolsTracked: this.symbolSubscribers.size,
      circuitBreakerState: this.circuitBreaker.state,
      activeProcessingTasks: this.activeProcessingTasks.size
    };
  }
  
  /**
   * Shutdown with cleanup
   */
  shutdown() {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
    }
    
    // Wait for active tasks to complete
    const maxWait = 5000;
    const start = Date.now();
    
    const waitForTasks = () => {
      if (this.activeProcessingTasks.size === 0 || (Date.now() - start) > maxWait) {
        this.performCleanupShutdown();
        return;
      }
      setTimeout(waitForTasks, 100);
    };
    
    waitForTasks();
  }
  
  /**
   * Perform cleanup shutdown
   */
  performCleanupShutdown() {
    this.orderBooks.clear();
    this.subscriptions.clear();
    this.symbolSubscribers.clear();
    this.pendingUpdates.clear();
    this.activeProcessingTasks.clear();
    
    this.emit('shutdown');
  }
}

/**
 * LRU Cache implementation for bounded collections
 */
class LRUCache {
  constructor(maxSize = 1000) {
    this.maxSize = maxSize;
    this.cache = new Map();
  }
  
  get(key) {
    if (this.cache.has(key)) {
      const value = this.cache.get(key);
      this.cache.delete(key);
      this.cache.set(key, value);
      return value;
    }
    return undefined;
  }
  
  set(key, value) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }
  
  delete(key) {
    return this.cache.delete(key);
  }
  
  has(key) {
    return this.cache.has(key);
  }
  
  get size() {
    return this.cache.size;
  }
  
  clear() {
    this.cache.clear();
  }
}

/**
 * Security Error class
 */
class SecurityError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SecurityError';
  }
}

module.exports = SecureOrderBookFeed;