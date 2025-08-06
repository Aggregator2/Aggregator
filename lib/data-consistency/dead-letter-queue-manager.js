const EventEmitter = require('events');
const crypto = require('crypto');
const { getSecureMetricsCollector } = require('../../monitoring/secure-metrics-collector');

class DeadLetterQueueManager extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      // Queue configuration with validation
      maxRetries: this.validateNumber(config.maxRetries, 3, 1, 20),
      retryBackoff: this.validateNumber(config.retryBackoff, 1000, 100, 60000),
      backoffMultiplier: this.validateNumber(config.backoffMultiplier, 2, 1, 10),
      maxBackoffDelay: this.validateNumber(config.maxBackoffDelay, 300000, 10000, 3600000),
      
      // Dead letter queue settings
      dlqRetentionPeriod: this.validateNumber(config.dlqRetentionPeriod, 86400000 * 7, 86400000, 86400000 * 30), // 7 days
      maxDlqSize: this.validateNumber(config.maxDlqSize, 100000, 1000, 10000000),
      
      // Processing configuration
      processingInterval: this.validateNumber(config.processingInterval, 30000, 5000, 300000),
      batchSize: this.validateNumber(config.batchSize, 50, 1, 1000),
      maxConcurrentProcessing: this.validateNumber(config.maxConcurrentProcessing, 10, 1, 100),
      
      // Categorization and prioritization
      messageCategories: this.validateMessageCategories(config.messageCategories || {
        critical: { priority: 10, maxRetries: 5, alertThreshold: 5 },
        high: { priority: 7, maxRetries: 3, alertThreshold: 10 },
        medium: { priority: 5, maxRetries: 3, alertThreshold: 50 },
        low: { priority: 1, maxRetries: 2, alertThreshold: 100 }
      }),
      
      // Failure analysis
      failureAnalysisEnabled: config.failureAnalysisEnabled !== false,
      failurePatternDetection: config.failurePatternDetection !== false,
      
      // Security settings
      authenticationRequired: config.authenticationRequired !== false,
      encryptionEnabled: config.encryptionEnabled !== false,
      
      // Redis configuration for queue persistence
      redisUrl: this.sanitizeUrl(config.redisUrl || process.env.REDIS_URL),
      keyPrefix: this.sanitizeKeyPrefix(config.keyPrefix || 'dlq:'),
      
      // Alert configuration
      alertWebhook: this.sanitizeUrl(config.alertWebhook),
      slackWebhook: this.sanitizeUrl(config.slackWebhook),
      emailNotifications: this.validateEmailList(config.emailNotifications || []),
      
      ...config
    };
    
    this.metrics = getSecureMetricsCollector();
    this.redis = null;
    this.isRunning = false;
    
    // Queue management
    this.processingQueues = new Map(); // category -> queue of messages
    this.deadLetterQueues = new Map(); // category -> dead letter queue
    this.retryQueues = new Map(); // category -> retry queue with delays
    
    // Message tracking
    this.messageProcessors = new Map(); // messageType -> processor function
    this.failedMessages = new Map(); // messageId -> failure details
    this.messageStats = new Map(); // messageType -> statistics
    
    // Performance tracking
    this.performanceStats = {
      messagesProcessed: 0,
      messagesRetried: 0,
      messagesDeadLettered: 0,
      averageProcessingTime: 0,
      successRate: 0,
      retryRate: 0,
      deadLetterRate: 0,
      currentQueueSize: 0
    };
    
    // Failure pattern analysis
    this.failurePatterns = new Map(); // pattern -> occurrence count
    this.recentFailures = []; // Rolling window of recent failures
    this.failureAnalysisWindow = 3600000; // 1 hour
    
    // Active processing tracking
    this.activeProcessing = new Map(); // messageId -> processing details
    this.processingTimeouts = new Map(); // messageId -> timeout handle
    
    // Security tracking
    this.failedAttempts = new Map();
    this.authorizedUsers = new Set();
    
    // Processing intervals
    this.processingInterval = null;
    this.retryInterval = null;
    this.cleanupInterval = null;
  }

  validateNumber(value, defaultValue, min, max) {
    if (typeof value !== 'number' || !isFinite(value) || value < min || value > max) {
      return defaultValue;
    }
    return value;
  }

  validateMessageCategories(categories) {
    const validated = {};
    
    for (const [category, config] of Object.entries(categories)) {
      const sanitizedCategory = this.sanitizeString(category);
      if (sanitizedCategory && typeof config === 'object' && config !== null) {
        validated[sanitizedCategory] = {
          priority: this.validateNumber(config.priority, 5, 1, 10),
          maxRetries: this.validateNumber(config.maxRetries, 3, 1, 20),
          alertThreshold: this.validateNumber(config.alertThreshold, 10, 1, 10000)
        };
      }
    }
    
    return validated;
  }

  validateEmailList(emails) {
    if (!Array.isArray(emails)) return [];
    return emails
      .filter(email => typeof email === 'string' && email.includes('@'))
      .map(email => email.toLowerCase().trim())
      .slice(0, 50); // Limit list size
  }

  sanitizeUrl(url) {
    if (!url || typeof url !== 'string') return null;
    try {
      const parsed = new URL(url);
      const allowedProtocols = ['http:', 'https:', 'redis:', 'rediss:'];
      if (allowedProtocols.includes(parsed.protocol)) {
        return url;
      }
    } catch {
      return null;
    }
    return null;
  }

  sanitizeKeyPrefix(prefix) {
    if (typeof prefix !== 'string') return 'dlq:';
    return prefix.replace(/[^a-zA-Z0-9:_-]/g, '').substring(0, 50) + ':';
  }

  sanitizeString(input) {
    if (typeof input !== 'string') return '';
    return input.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 200);
  }

  async initialize() {
    try {
      console.log('☠️ Initializing Dead Letter Queue Manager...');
      
      // Initialize Redis connection
      const Redis = require('redis');
      this.redis = Redis.createClient({
        url: this.config.redisUrl,
        socket: {
          connectTimeout: 10000,
          lazyConnect: true
        },
        retryDelayOnFailover: 100,
        maxRetriesPerRequest: 3
      });
      
      await this.redis.connect();
      
      // Initialize metrics
      await this.metrics.initialize();
      
      // Initialize queues for each category
      for (const category of Object.keys(this.config.messageCategories)) {
        this.processingQueues.set(category, []);
        this.deadLetterQueues.set(category, []);
        this.retryQueues.set(category, []);
      }
      
      // Load persistent queue data
      await this.loadQueueData();
      
      console.log('✅ Dead Letter Queue Manager initialized');
    } catch (error) {
      console.error('Failed to initialize Dead Letter Queue Manager:', error);
      throw error;
    }
  }

  async start() {
    if (this.isRunning) return;
    
    console.log('🚀 Starting Dead Letter Queue Manager...');
    this.isRunning = true;
    
    // Start message processing
    this.startMessageProcessing();
    
    // Start retry processing
    this.startRetryProcessing();
    
    // Start cleanup and maintenance
    this.startCleanupTasks();
    
    // Start performance monitoring
    this.startPerformanceMonitoring();
    
    console.log('✅ Dead Letter Queue Manager started');
  }

  startMessageProcessing() {
    this.processingInterval = setInterval(async () => {
      try {
        await this.processQueues();
      } catch (error) {
        console.error('Message processing error:', error);
      }
    }, this.config.processingInterval);
  }

  startRetryProcessing() {
    this.retryInterval = setInterval(async () => {
      try {
        await this.processRetryQueues();
      } catch (error) {
        console.error('Retry processing error:', error);
      }
    }, this.config.processingInterval / 2); // More frequent retry processing
  }

  startCleanupTasks() {
    this.cleanupInterval = setInterval(async () => {
      try {
        await this.performCleanup();
        await this.analyzeFailurePatterns();
      } catch (error) {
        console.error('Cleanup task error:', error);
      }
    }, 300000); // Every 5 minutes
  }

  startPerformanceMonitoring() {
    this.performanceInterval = setInterval(async () => {
      await this.updatePerformanceMetrics();
    }, 60000); // Every minute
  }

  // Register message processor for specific message types
  registerMessageProcessor(messageType, processorFunction) {
    const sanitizedType = this.sanitizeString(messageType);
    if (!sanitizedType) {
      throw new Error('Invalid message type');
    }
    
    if (typeof processorFunction !== 'function') {
      throw new Error('Processor must be a function');
    }
    
    this.messageProcessors.set(sanitizedType, processorFunction);
    console.log(`Message processor registered: ${sanitizedType}`);
  }

  // Enqueue message for processing with retry logic
  async enqueueMessage(messageType, messageData, category = 'medium', priority = null, authenticatedUser = null) {
    // Security validation
    if (this.config.authenticationRequired && !authenticatedUser) {
      throw new Error('Authentication required for message enqueueing');
    }
    
    // Input validation
    const sanitizedMessageType = this.sanitizeString(messageType);
    const sanitizedCategory = this.sanitizeString(category);
    
    if (!sanitizedMessageType) {
      throw new Error('Invalid message type');
    }
    
    if (!this.config.messageCategories[sanitizedCategory]) {
      throw new Error(`Invalid message category: ${sanitizedCategory}`);
    }
    
    // Generate message ID
    const messageId = this.generateMessageId();
    
    // Get category configuration
    const categoryConfig = this.config.messageCategories[sanitizedCategory];
    
    // Create message
    const message = {
      id: messageId,
      type: sanitizedMessageType,
      data: this.sanitizeMessageData(messageData),
      category: sanitizedCategory,
      priority: priority !== null ? this.validateNumber(priority, categoryConfig.priority, 1, 10) : categoryConfig.priority,
      createdAt: Date.now(),
      attempts: 0,
      maxRetries: categoryConfig.maxRetries,
      userId: authenticatedUser?.id,
      status: 'pending'
    };
    
    try {
      // Add to processing queue
      const queue = this.processingQueues.get(sanitizedCategory);
      queue.push(message);
      
      // Sort by priority (higher priority first)
      queue.sort((a, b) => b.priority - a.priority);
      
      // Persist to Redis
      await this.persistMessage(message);
      
      // Initialize message stats if needed
      if (!this.messageStats.has(sanitizedMessageType)) {
        this.messageStats.set(sanitizedMessageType, {
          total: 0,
          success: 0,
          failed: 0,
          retried: 0,
          deadLettered: 0
        });
      }
      
      const stats = this.messageStats.get(sanitizedMessageType);
      stats.total++;
      
      this.emit('message_enqueued', {
        messageId,
        messageType: sanitizedMessageType,
        category: sanitizedCategory,
        priority: message.priority
      });
      
      console.log(`Message enqueued: ${messageId} (${sanitizedMessageType}, ${sanitizedCategory})`);
      
      return {
        messageId,
        status: 'enqueued',
        category: sanitizedCategory,
        priority: message.priority,
        estimatedProcessingTime: this.estimateProcessingTime(sanitizedCategory)
      };
      
    } catch (error) {
      console.error(`Failed to enqueue message:`, error);
      throw error;
    }
  }

  generateMessageId() {
    const timestamp = Date.now();
    const random = crypto.randomBytes(8).toString('hex');
    return `msg_${timestamp}_${random}`;
  }

  sanitizeMessageData(data) {
    if (!data || typeof data !== 'object') return {};
    
    const sanitized = {};
    for (const [key, value] of Object.entries(data)) {
      const cleanKey = this.sanitizeString(key);
      if (cleanKey && typeof value !== 'function') {
        if (typeof value === 'string') {
          sanitized[cleanKey] = value.substring(0, 10000); // Limit string length
        } else if (typeof value === 'number' && isFinite(value)) {
          sanitized[cleanKey] = value;
        } else if (typeof value === 'boolean') {
          sanitized[cleanKey] = value;
        } else if (typeof value === 'object' && value !== null) {
          sanitized[cleanKey] = this.sanitizeMessageData(value);
        }
      }
    }
    return sanitized;
  }

  estimateProcessingTime(category) {
    const categoryConfig = this.config.messageCategories[category];
    const baseTimes = { critical: 1000, high: 5000, medium: 10000, low: 30000 };
    return baseTimes[category] || baseTimes.medium;
  }

  async processQueues() {
    const processingPromises = [];
    let activeProcessingCount = this.activeProcessing.size;
    
    if (activeProcessingCount >= this.config.maxConcurrentProcessing) {
      return; // Already at max concurrent processing
    }
    
    // Process queues by priority (critical first)
    const sortedCategories = Object.entries(this.config.messageCategories)
      .sort(([,a], [,b]) => b.priority - a.priority)
      .map(([category]) => category);
    
    for (const category of sortedCategories) {
      if (activeProcessingCount >= this.config.maxConcurrentProcessing) break;
      
      const queue = this.processingQueues.get(category);
      if (!queue || queue.length === 0) continue;
      
      // Take batch of messages to process
      const batch = queue.splice(0, Math.min(
        this.config.batchSize,
        this.config.maxConcurrentProcessing - activeProcessingCount
      ));
      
      for (const message of batch) {
        const processingPromise = this.processMessage(message);
        processingPromises.push(processingPromise);
        activeProcessingCount++;
      }
    }
    
    // Wait for all processing to complete
    if (processingPromises.length > 0) {
      await Promise.allSettled(processingPromises);
    }
  }

  async processMessage(message) {
    const messageId = message.id;
    const startTime = Date.now();
    
    // Mark as active processing
    this.activeProcessing.set(messageId, {
      message,
      startTime,
      attempt: message.attempts + 1
    });
    
    // Set processing timeout
    const timeout = setTimeout(() => {
      this.handleProcessingTimeout(messageId);
    }, this.estimateProcessingTime(message.category) * 2);
    
    this.processingTimeouts.set(messageId, timeout);
    
    try {
      message.attempts++;
      message.status = 'processing';
      message.lastAttempt = Date.now();
      
      // Get processor
      const processor = this.messageProcessors.get(message.type);
      if (!processor) {
        throw new Error(`No processor found for message type: ${message.type}`);
      }
      
      // Process message
      const result = await processor(message.data, message);
      
      // Mark as successful
      message.status = 'completed';
      message.completedAt = Date.now();
      message.result = this.sanitizeMessageData(result);
      
      // Update stats
      const stats = this.messageStats.get(message.type);
      if (stats) {
        stats.success++;
      }
      
      // Update performance stats
      this.performanceStats.messagesProcessed++;
      const processingTime = Date.now() - startTime;
      this.performanceStats.averageProcessingTime = 
        (this.performanceStats.averageProcessingTime * 0.9) + (processingTime * 0.1);
      
      // Clean up
      this.activeProcessing.delete(messageId);
      this.clearProcessingTimeout(messageId);
      
      this.emit('message_processed', {
        messageId,
        messageType: message.type,
        processingTime,
        attempts: message.attempts
      });
      
      console.log(`Message processed successfully: ${messageId} (${message.attempts} attempts)`);
      
    } catch (error) {
      console.error(`Failed to process message ${messageId}:`, error);
      
      // Clean up
      this.activeProcessing.delete(messageId);
      this.clearProcessingTimeout(messageId);
      
      // Handle failure
      await this.handleMessageFailure(message, error);
    }
  }

  clearProcessingTimeout(messageId) {
    const timeout = this.processingTimeouts.get(messageId);
    if (timeout) {
      clearTimeout(timeout);
      this.processingTimeouts.delete(messageId);
    }
  }

  async handleProcessingTimeout(messageId) {
    const processing = this.activeProcessing.get(messageId);
    if (!processing) return;
    
    const message = processing.message;
    console.warn(`Message processing timeout: ${messageId}`);
    
    // Mark as timed out
    this.activeProcessing.delete(messageId);
    this.clearProcessingTimeout(messageId);
    
    // Handle as failure
    await this.handleMessageFailure(message, new Error('Processing timeout'));
  }

  async handleMessageFailure(message, error) {
    const messageId = message.id;
    
    // Record failure details
    const failureDetails = {
      messageId,
      messageType: message.type,
      attempt: message.attempts,
      error: error.message,
      stack: error.stack,
      timestamp: Date.now(),
      category: message.category
    };
    
    this.failedMessages.set(messageId, failureDetails);
    
    // Add to recent failures for pattern analysis
    if (this.config.failurePatternDetection) {
      this.recentFailures.push(failureDetails);
      this.cleanupRecentFailures();
    }
    
    // Update stats
    const stats = this.messageStats.get(message.type);
    if (stats) {
      stats.failed++;
    }
    
    // Determine next action based on retry count
    if (message.attempts < message.maxRetries) {
      // Schedule retry
      await this.scheduleRetry(message, error);
    } else {
      // Move to dead letter queue
      await this.moveToDeadLetterQueue(message, error);
    }
    
    this.emit('message_failed', {
      messageId,
      messageType: message.type,
      error: error.message,
      attempts: message.attempts,
      willRetry: message.attempts < message.maxRetries
    });
  }

  async scheduleRetry(message, error) {
    const messageId = message.id;
    
    // Calculate retry delay with exponential backoff
    const delay = this.calculateRetryDelay(message.attempts);
    const retryTime = Date.now() + delay;
    
    // Update message for retry
    message.status = 'retry_scheduled';
    message.retryTime = retryTime;
    message.lastError = error.message;
    
    // Add to retry queue
    const retryQueue = this.retryQueues.get(message.category);
    retryQueue.push(message);
    
    // Sort by retry time
    retryQueue.sort((a, b) => a.retryTime - b.retryTime);
    
    // Update stats
    const stats = this.messageStats.get(message.type);
    if (stats) {
      stats.retried++;
    }
    
    this.performanceStats.messagesRetried++;
    
    // Persist retry state
    await this.persistRetryMessage(message);
    
    console.log(`Message scheduled for retry: ${messageId} (attempt ${message.attempts}/${message.maxRetries} in ${delay}ms)`);
  }

  calculateRetryDelay(attempt) {
    const baseDelay = this.config.retryBackoff;
    const exponentialDelay = baseDelay * Math.pow(this.config.backoffMultiplier, attempt - 1);
    
    // Add jitter to prevent thundering herd
    const jitter = Math.random() * baseDelay;
    const totalDelay = exponentialDelay + jitter;
    
    return Math.min(totalDelay, this.config.maxBackoffDelay);
  }

  async moveToDeadLetterQueue(message, error) {
    const messageId = message.id;
    
    // Update message status
    message.status = 'dead_lettered';
    message.deadLetteredAt = Date.now();
    message.finalError = error.message;
    
    // Add to dead letter queue
    const dlq = this.deadLetterQueues.get(message.category);
    dlq.push(message);
    
    // Limit DLQ size
    if (dlq.length > this.config.maxDlqSize) {
      dlq.shift(); // Remove oldest
    }
    
    // Update stats
    const stats = this.messageStats.get(message.type);
    if (stats) {
      stats.deadLettered++;
    }
    
    this.performanceStats.messagesDeadLettered++;
    
    // Persist to DLQ
    await this.persistDeadLetterMessage(message);
    
    // Check if alert threshold is reached
    const categoryConfig = this.config.messageCategories[message.category];
    if (dlq.length >= categoryConfig.alertThreshold) {
      await this.sendDeadLetterAlert(message.category, dlq.length);
    }
    
    this.emit('message_dead_lettered', {
      messageId,
      messageType: message.type,
      category: message.category,
      finalAttempts: message.attempts,
      error: error.message
    });
    
    console.warn(`Message moved to dead letter queue: ${messageId} after ${message.attempts} attempts`);
  }

  async processRetryQueues() {
    const now = Date.now();
    
    for (const [category, retryQueue] of this.retryQueues) {
      const readyMessages = [];
      
      // Find messages ready for retry
      while (retryQueue.length > 0 && retryQueue[0].retryTime <= now) {
        readyMessages.push(retryQueue.shift());
      }
      
      // Move back to processing queue
      if (readyMessages.length > 0) {
        const processingQueue = this.processingQueues.get(category);
        processingQueue.push(...readyMessages);
        
        // Sort by priority
        processingQueue.sort((a, b) => b.priority - a.priority);
        
        console.log(`Moved ${readyMessages.length} messages from retry queue to processing queue (${category})`);
      }
    }
  }

  cleanupRecentFailures() {
    const cutoff = Date.now() - this.failureAnalysisWindow;
    this.recentFailures = this.recentFailures.filter(f => f.timestamp > cutoff);
  }

  async analyzeFailurePatterns() {
    if (!this.config.failureAnalysisEnabled || this.recentFailures.length === 0) {
      return;
    }
    
    // Analyze failure patterns
    const patterns = new Map();
    
    for (const failure of this.recentFailures) {
      // Group by error type
      const errorType = this.extractErrorType(failure.error);
      const patternKey = `${failure.messageType}:${errorType}`;
      
      const count = patterns.get(patternKey) || 0;
      patterns.set(patternKey, count + 1);
    }
    
    // Update pattern tracking
    for (const [pattern, count] of patterns) {
      const currentCount = this.failurePatterns.get(pattern) || 0;
      this.failurePatterns.set(pattern, currentCount + count);
    }
    
    // Check for concerning patterns
    for (const [pattern, count] of patterns) {
      if (count >= 10) { // 10 failures of same pattern in analysis window
        await this.sendFailurePatternAlert(pattern, count);
      }
    }
  }

  extractErrorType(errorMessage) {
    // Extract error type from error message
    if (errorMessage.includes('timeout')) return 'timeout';
    if (errorMessage.includes('connection')) return 'connection';
    if (errorMessage.includes('validation')) return 'validation';
    if (errorMessage.includes('permission')) return 'permission';
    if (errorMessage.includes('not found')) return 'not_found';
    return 'unknown';
  }

  async sendDeadLetterAlert(category, dlqSize) {
    const alert = {
      type: 'dead_letter_threshold_exceeded',
      category,
      dlqSize,
      threshold: this.config.messageCategories[category].alertThreshold,
      timestamp: Date.now()
    };
    
    // Send webhook alert if configured
    if (this.config.alertWebhook) {
      await this.sendWebhookAlert(alert);
    }
    
    // Send Slack alert if configured
    if (this.config.slackWebhook) {
      await this.sendSlackAlert(alert);
    }
    
    this.emit('dead_letter_alert', alert);
  }

  async sendFailurePatternAlert(pattern, count) {
    const alert = {
      type: 'failure_pattern_detected',
      pattern,
      occurrences: count,
      timeWindow: this.failureAnalysisWindow,
      timestamp: Date.now()
    };
    
    // Send alerts
    if (this.config.alertWebhook) {
      await this.sendWebhookAlert(alert);
    }
    
    this.emit('failure_pattern_alert', alert);
  }

  async sendWebhookAlert(alert) {
    try {
      const https = require('https');
      const url = require('url');
      
      const webhook = url.parse(this.config.alertWebhook);
      const postData = JSON.stringify(alert);
      
      const options = {
        hostname: webhook.hostname,
        port: webhook.port || 443,
        path: webhook.path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': postData.length
        }
      };
      
      const req = https.request(options);
      req.write(postData);
      req.end();
      
    } catch (error) {
      console.error('Failed to send webhook alert:', error);
    }
  }

  async sendSlackAlert(alert) {
    // Implementation for Slack webhook notification
    // Similar to webhook alert but with Slack-specific formatting
  }

  async persistMessage(message) {
    try {
      const messageData = this.config.encryptionEnabled ? 
        this.encryptData(JSON.stringify(message)) : JSON.stringify(message);
      
      await this.redis.hSet(
        `${this.config.keyPrefix}messages`,
        message.id,
        messageData
      );
      
      // Add to category queue list
      await this.redis.lPush(
        `${this.config.keyPrefix}queue:${message.category}`,
        message.id
      );
      
    } catch (error) {
      console.error('Failed to persist message:', error);
    }
  }

  async persistRetryMessage(message) {
    try {
      const retryData = this.config.encryptionEnabled ? 
        this.encryptData(JSON.stringify(message)) : JSON.stringify(message);
      
      await this.redis.hSet(
        `${this.config.keyPrefix}retry_messages`,
        message.id,
        retryData
      );
      
    } catch (error) {
      console.error('Failed to persist retry message:', error);
    }
  }

  async persistDeadLetterMessage(message) {
    try {
      const dlqData = this.config.encryptionEnabled ? 
        this.encryptData(JSON.stringify(message)) : JSON.stringify(message);
      
      await this.redis.hSet(
        `${this.config.keyPrefix}dead_letters`,
        message.id,
        dlqData
      );
      
      // Set expiration
      await this.redis.expire(
        `${this.config.keyPrefix}dead_letters`,
        Math.floor(this.config.dlqRetentionPeriod / 1000)
      );
      
    } catch (error) {
      console.error('Failed to persist dead letter message:', error);
    }
  }

  encryptData(data) {
    if (!process.env.DLQ_ENCRYPTION_KEY) {
      return data; // Return unencrypted if no key configured
    }
    
    const key = Buffer.from(process.env.DLQ_ENCRYPTION_KEY, 'hex');
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipher('aes-256-cbc', key);
    
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    return iv.toString('hex') + ':' + encrypted;
  }

  async loadQueueData() {
    try {
      // Load messages from Redis queues
      for (const category of Object.keys(this.config.messageCategories)) {
        const messageIds = await this.redis.lRange(
          `${this.config.keyPrefix}queue:${category}`,
          0, -1
        );
        
        for (const messageId of messageIds) {
          try {
            const messageData = await this.redis.hGet(
              `${this.config.keyPrefix}messages`,
              messageId
            );
            
            if (messageData) {
              const message = JSON.parse(messageData);
              const queue = this.processingQueues.get(category);
              queue.push(message);
            }
          } catch (error) {
            console.error(`Failed to load message ${messageId}:`, error);
          }
        }
      }
      
      console.log('Loaded queue data from Redis');
      
    } catch (error) {
      console.error('Failed to load queue data:', error);
    }
  }

  async performCleanup() {
    // Clean up old failed messages
    const cutoff = Date.now() - this.config.dlqRetentionPeriod;
    
    for (const [messageId, failure] of this.failedMessages) {
      if (failure.timestamp < cutoff) {
        this.failedMessages.delete(messageId);
      }
    }
    
    // Clean up old failure patterns
    const patternCutoff = Date.now() - (this.config.dlqRetentionPeriod * 2);
    for (const [pattern, _] of this.failurePatterns) {
      // Reset pattern counts periodically
      if (Math.random() < 0.1) { // 10% chance to reset each cleanup
        this.failurePatterns.delete(pattern);
      }
    }
    
    // Update current queue size for metrics
    this.performanceStats.currentQueueSize = Array.from(this.processingQueues.values())
      .reduce((total, queue) => total + queue.length, 0);
  }

  async updatePerformanceMetrics() {
    try {
      // Calculate rates
      const totalMessages = this.performanceStats.messagesProcessed + 
        this.performanceStats.messagesDeadLettered;
      
      this.performanceStats.successRate = totalMessages > 0 ? 
        this.performanceStats.messagesProcessed / totalMessages : 0;
      
      this.performanceStats.retryRate = totalMessages > 0 ? 
        this.performanceStats.messagesRetried / totalMessages : 0;
      
      this.performanceStats.deadLetterRate = totalMessages > 0 ? 
        this.performanceStats.messagesDeadLettered / totalMessages : 0;
      
      // Update metrics
      await this.metrics.setGauge('dlq.messages_processed', this.performanceStats.messagesProcessed, {}, 'consistency');
      await this.metrics.setGauge('dlq.messages_retried', this.performanceStats.messagesRetried, {}, 'consistency');
      await this.metrics.setGauge('dlq.messages_dead_lettered', this.performanceStats.messagesDeadLettered, {}, 'consistency');
      await this.metrics.setGauge('dlq.success_rate', this.performanceStats.successRate, {}, 'consistency');
      await this.metrics.setGauge('dlq.retry_rate', this.performanceStats.retryRate, {}, 'consistency');
      await this.metrics.setGauge('dlq.dead_letter_rate', this.performanceStats.deadLetterRate, {}, 'consistency');
      await this.metrics.setGauge('dlq.current_queue_size', this.performanceStats.currentQueueSize, {}, 'consistency');
      await this.metrics.setGauge('dlq.active_processing', this.activeProcessing.size, {}, 'consistency');
      
      // Update category-specific metrics
      for (const [category, dlq] of this.deadLetterQueues) {
        await this.metrics.setGauge('dlq.dead_letter_queue_size', dlq.length, { category }, 'consistency');
      }
      
    } catch (error) {
      console.error('Failed to update performance metrics:', error);
    }
  }

  getMessageStatus(messageId) {
    // Check active processing
    const active = this.activeProcessing.get(messageId);
    if (active) {
      return {
        status: 'processing',
        startTime: active.startTime,
        attempt: active.attempt
      };
    }
    
    // Check failed messages
    const failure = this.failedMessages.get(messageId);
    if (failure) {
      return {
        status: 'failed',
        error: failure.error,
        attempts: failure.attempt,
        timestamp: failure.timestamp
      };
    }
    
    return { status: 'not_found' };
  }

  getQueueStats(category = null) {
    if (category) {
      const processingQueue = this.processingQueues.get(category);
      const retryQueue = this.retryQueues.get(category);
      const dlq = this.deadLetterQueues.get(category);
      
      return {
        category,
        processing: processingQueue ? processingQueue.length : 0,
        retry: retryQueue ? retryQueue.length : 0,
        deadLetter: dlq ? dlq.length : 0
      };
    }
    
    // Return stats for all categories
    const stats = {};
    for (const cat of Object.keys(this.config.messageCategories)) {
      stats[cat] = this.getQueueStats(cat);
    }
    return stats;
  }

  getSystemStatus() {
    return {
      isRunning: this.isRunning,
      messageProcessors: this.messageProcessors.size,
      performanceStats: this.performanceStats,
      queueStats: this.getQueueStats(),
      failurePatterns: Object.fromEntries(this.failurePatterns),
      recentFailures: this.recentFailures.length,
      activeProcessing: this.activeProcessing.size
    };
  }

  stop() {
    if (!this.isRunning) return;
    
    console.log('🛑 Stopping Dead Letter Queue Manager...');
    
    // Stop intervals
    if (this.processingInterval) clearInterval(this.processingInterval);
    if (this.retryInterval) clearInterval(this.retryInterval);
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);
    if (this.performanceInterval) clearInterval(this.performanceInterval);
    
    // Clear all timeouts
    for (const timeout of this.processingTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.processingTimeouts.clear();
    
    // Close Redis connection
    if (this.redis) {
      this.redis.quit();
    }
    
    // Clear data structures
    this.processingQueues.clear();
    this.deadLetterQueues.clear();
    this.retryQueues.clear();
    this.messageProcessors.clear();
    this.failedMessages.clear();
    this.messageStats.clear();
    this.activeProcessing.clear();
    
    this.isRunning = false;
    console.log('✅ Dead Letter Queue Manager stopped');
  }
}

module.exports = DeadLetterQueueManager;