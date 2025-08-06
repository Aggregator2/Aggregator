const EventEmitter = require('events');
const crypto = require('crypto');
const { getSecureMetricsCollector } = require('../../monitoring/secure-metrics-collector');

class SecureEventualConsistencyManager extends EventEmitter {
  constructor(config = {}) {
    super();
    
    // Validate and sanitize configuration
    this.config = this.validateAndSanitizeConfig(config);
    
    this.metrics = getSecureMetricsCollector();
    this.redis = null;
    this.isRunning = false;
    
    // Enhanced security services
    this.authenticationService = null;
    this.authorizationService = null;
    this.auditLogger = null;
    this.encryptionService = null;
    
    // Secure event sourcing with integrity protection
    this.eventStore = new Map(); // eventId -> encrypted event data
    this.entityStates = new Map(); // entityId -> current state with signatures
    this.pendingSyncs = new Map(); // entityId -> pending sync operations
    this.conflictQueue = new Map(); // conflictId -> conflict details
    
    // Enhanced vector clocks with cryptographic protection
    this.vectorClocks = new Map(); // nodeId -> vector clock with signature
    this.nodeId = this.generateSecureNodeId();
    this.clockSignatures = new Map(); // nodeId -> clock signature
    
    // Secure state projectors and validators with sandboxing
    this.stateProjectors = new Map(); // entityType -> validated projector function
    this.consistencyValidators = new Map(); // entityType -> validated validator function
    this.projectorSignatures = new Map(); // entityType -> cryptographic signature
    
    // Enhanced security tracking
    this.securityMetrics = {
      authenticationAttempts: 0,
      authenticationFailures: 0,
      authorizationFailures: 0,
      encryptionOperations: 0,
      integrityViolations: 0,
      clockTamperingAttempts: 0,
      suspiciousProjectorRegistrations: 0
    };
    
    // Performance tracking with security context
    this.performanceStats = {
      eventsProcessed: 0,
      syncOperations: 0,
      conflictsResolved: 0,
      averageSyncTime: 0,
      consistencyRate: 0,
      pendingSyncs: 0,
      vectorClockOperations: 0,
      stateProjections: 0
    };
    
    // Security controls
    this.securityControls = {
      enableAuthentication: true,
      enableAuthorization: true,
      enableEncryption: true,
      enableVectorClockSigning: true,
      enableStateIntegrity: true,
      maxEventSize: 1024 * 1024, // 1MB
      maxEntitiesPerSync: 1000,
      vectorClockTTL: 3600000, // 1 hour
      requireProjectorSignatures: true
    };
    
    // Synchronization tracking with security
    this.syncQueues = new Map(); // category -> secure sync queue
    this.syncStatus = new Map(); // entityId -> sync status with integrity
    this.lastSyncTimes = new Map(); // entityId -> last sync timestamp
    
    // Conflict resolution with audit trail
    this.conflictResolutionStrategies = new Map();
    this.conflictHistory = new Map(); // conflictId -> resolution history
    
    // Memory and resource monitoring
    this.resourceLimits = {
      maxMemoryUsage: 512 * 1024 * 1024, // 512MB
      maxConcurrentSyncs: 100,
      maxEventStoreSize: 1000000, // 1M events
      maxConflictQueueSize: 10000
    };
    
    // Distributed lock management
    this.lockService = null;
    this.lockTimeouts = new Map();
    this.maxLockTime = 30000; // 30 seconds
  }

  validateAndSanitizeConfig(config) {
    const allowedConfigKeys = new Set([
      'syncInterval', 'conflictResolutionInterval', 'consistencyLevel',
      'maxSyncDelay', 'conflictResolution', 'vectorClockEnabled',
      'dataCategories', 'batchSize', 'maxConcurrentSyncs',
      'redisUrl', 'keyPrefix', 'encryptionEnabled', 'authenticationRequired'
    ]);
    
    const sanitized = {};
    
    for (const [key, value] of Object.entries(config)) {
      if (allowedConfigKeys.has(key)) {
        sanitized[key] = this.sanitizeConfigValue(key, value);
      }
    }
    
    return {
      syncInterval: this.validateNumber(sanitized.syncInterval, 30000, 5000, 300000),
      conflictResolutionInterval: this.validateNumber(sanitized.conflictResolutionInterval, 60000, 30000, 600000),
      consistencyLevel: this.validateConsistencyLevel(sanitized.consistencyLevel || 'eventual'),
      maxSyncDelay: this.validateNumber(sanitized.maxSyncDelay, 300000, 60000, 3600000),
      conflictResolution: this.validateConflictResolution(sanitized.conflictResolution || 'last_write_wins'),
      vectorClockEnabled: sanitized.vectorClockEnabled !== false,
      dataCategories: this.validateDataCategories(sanitized.dataCategories || {
        critical: { consistencyLevel: 'strong', syncPriority: 'high' },
        important: { consistencyLevel: 'eventual', syncPriority: 'medium' },
        cache: { consistencyLevel: 'weak', syncPriority: 'low' }
      }),
      batchSize: this.validateNumber(sanitized.batchSize, 100, 10, 1000),
      maxConcurrentSyncs: this.validateNumber(sanitized.maxConcurrentSyncs, 10, 1, 100),
      
      // Redis configuration with validation
      redisUrl: this.sanitizeUrl(sanitized.redisUrl || process.env.REDIS_URL),
      keyPrefix: this.sanitizeKeyPrefix(sanitized.keyPrefix || 'ec:'),
      
      // Security settings (always enabled)
      encryptionEnabled: true,
      authenticationRequired: true,
      stateIntegrityChecks: true
    };
  }

  sanitizeConfigValue(key, value) {
    switch (key) {
      case 'syncInterval':
      case 'conflictResolutionInterval':
      case 'maxSyncDelay':
      case 'batchSize':
      case 'maxConcurrentSyncs':
        return typeof value === 'number' && isFinite(value) ? value : null;
      case 'vectorClockEnabled':
      case 'encryptionEnabled':
      case 'authenticationRequired':
        return Boolean(value);
      case 'consistencyLevel':
        return this.validateConsistencyLevel(value);
      case 'conflictResolution':
        return this.validateConflictResolution(value);
      case 'redisUrl':
        return this.sanitizeUrl(value);
      case 'keyPrefix':
        return this.sanitizeKeyPrefix(value);
      default:
        return value;
    }
  }

  validateNumber(value, defaultValue, min, max) {
    if (typeof value !== 'number' || !isFinite(value) || value < min || value > max) {
      return defaultValue;
    }
    return value;
  }

  validateConsistencyLevel(level) {
    const allowedLevels = new Set(['strong', 'eventual', 'weak']);
    return allowedLevels.has(level) ? level : 'eventual';
  }

  validateConflictResolution(strategy) {
    const allowedStrategies = new Set(['last_write_wins', 'first_write_wins', 'vector_clock', 'merge']);
    return allowedStrategies.has(strategy) ? strategy : 'last_write_wins';
  }

  validateDataCategories(categories) {
    const validated = {};
    const allowedLevels = new Set(['strong', 'eventual', 'weak']);
    const allowedPriorities = new Set(['high', 'medium', 'low']);
    
    for (const [category, config] of Object.entries(categories)) {
      const sanitizedCategory = this.sanitizeString(category);
      if (sanitizedCategory && typeof config === 'object' && config !== null) {
        validated[sanitizedCategory] = {
          consistencyLevel: allowedLevels.has(config.consistencyLevel) ? 
            config.consistencyLevel : 'eventual',
          syncPriority: allowedPriorities.has(config.syncPriority) ? 
            config.syncPriority : 'medium',
          maxAge: this.validateNumber(config.maxAge, 300000, 60000, 3600000)
        };
      }
    }
    
    return validated;
  }

  sanitizeUrl(url) {
    if (!url || typeof url !== 'string') return null;
    try {
      const parsed = new URL(url);
      if (!['redis:', 'rediss:'].includes(parsed.protocol)) {
        throw new Error('Invalid Redis URL protocol');
      }
      return url;
    } catch {
      return null;
    }
  }

  sanitizeKeyPrefix(prefix) {
    if (typeof prefix !== 'string') return 'ec:';
    return prefix.replace(/[^a-zA-Z0-9:_-]/g, '').substring(0, 50) + ':';
  }

  sanitizeString(input) {
    if (typeof input !== 'string') return '';
    return input.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 200);
  }

  generateSecureNodeId() {
    const hostname = require('os').hostname();
    const processId = process.pid;
    const randomBytes = crypto.randomBytes(8);
    
    return crypto
      .createHash('sha256')
      .update(`${hostname}:${processId}:${randomBytes.toString('hex')}`)
      .digest('hex')
      .substring(0, 16);
  }

  async initialize() {
    try {
      console.log('🔒 Initializing Secure Eventual Consistency Manager...');
      
      // Initialize security services
      await this.initializeSecurity();
      
      // Initialize Redis connection with security
      await this.initializeSecureRedis();
      
      // Initialize metrics
      await this.metrics.initialize();
      
      // Initialize encryption service
      await this.initializeEncryption();
      
      // Initialize distributed lock service
      await this.initializeLockService();
      
      // Initialize vector clock with signature
      if (this.config.vectorClockEnabled) {
        await this.initializeSecureVectorClock();
      }
      
      // Initialize sync queues for each data category
      for (const category of Object.keys(this.config.dataCategories)) {
        this.syncQueues.set(category, []);
      }
      
      // Load pending states securely
      await this.loadPendingStatesSecurely();
      
      console.log('✅ Secure Eventual Consistency Manager initialized');
      
    } catch (error) {
      console.error('Failed to initialize Secure Eventual Consistency Manager:', error);
      await this.auditLog('manager_initialization_failed', { error: error.message });
      throw error;
    }
  }

  async initializeSecurity() {
    // Enhanced authentication service
    this.authenticationService = {
      validateUser: async (user, authToken) => {
        this.securityMetrics.authenticationAttempts++;
        
        if (!user || !authToken || typeof authToken !== 'string') {
          this.securityMetrics.authenticationFailures++;
          return false;
        }
        
        try {
          const decoded = this.verifyJWT(authToken);
          return decoded && decoded.sub === user.id;
        } catch (error) {
          this.securityMetrics.authenticationFailures++;
          await this.auditLog('authentication_failed', { 
            userId: user?.id, 
            error: error.message 
          });
          return false;
        }
      }
    };
    
    // Enhanced authorization service
    this.authorizationService = {
      checkEventPermission: async (user, action, entityType) => {
        if (!user || !user.roles) {
          this.securityMetrics.authorizationFailures++;
          return false;
        }
        
        const requiredPermissions = {
          'append_event': ['writer', 'admin'],
          'sync_state': ['writer', 'syncer', 'admin'],
          'resolve_conflict': ['resolver', 'admin'],
          'register_projector': ['admin', 'system']
        };
        
        const required = requiredPermissions[action];
        if (!required) return false;
        
        const hasPermission = user.roles.some(role => required.includes(role));
        
        if (!hasPermission) {
          this.securityMetrics.authorizationFailures++;
          await this.auditLog('authorization_failed', {
            userId: user.id,
            action,
            entityType,
            requiredRoles: required,
            userRoles: user.roles
          });
        }
        
        return hasPermission;
      }
    };
    
    // Enhanced audit logger
    this.auditLogger = {
      log: async (event, details) => {
        const auditEntry = {
          timestamp: new Date().toISOString(),
          component: 'SecureEventualConsistencyManager',
          event,
          details: this.sanitizeAuditDetails(details),
          nodeId: this.nodeId,
          processId: process.pid
        };
        
        console.log(`[EC-AUDIT] ${JSON.stringify(auditEntry)}`);
        
        if (this.redis) {
          try {
            await this.redis.lPush(
              `${this.config.keyPrefix}audit_log`,
              this.encryptSensitiveData(JSON.stringify(auditEntry))
            );
          } catch (error) {
            console.error('Failed to store audit log:', error);
          }
        }
      }
    };
  }

  async initializeSecureRedis() {
    if (!this.config.redisUrl) {
      throw new Error('Redis URL is required for secure operation');
    }
    
    const Redis = require('redis');
    this.redis = Redis.createClient({
      url: this.config.redisUrl,
      socket: {
        connectTimeout: 10000,
        lazyConnect: true,
        tls: this.config.redisUrl.startsWith('rediss:') ? {} : undefined
      },
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
      password: process.env.REDIS_PASSWORD
    });
    
    await this.redis.connect();
    await this.redis.ping();
    console.log('✅ Secure Redis connection established for EC');
  }

  async initializeEncryption() {
    this.encryptionService = {
      encrypt: (data, additionalData = '') => {
        if (!process.env.EC_ENCRYPTION_KEY) {
          throw new Error('EC encryption key not configured');
        }
        
        this.securityMetrics.encryptionOperations++;
        
        const key = Buffer.from(process.env.EC_ENCRYPTION_KEY, 'hex');
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipherGCM('aes-256-gcm', key, iv);
        
        if (additionalData) {
          cipher.setAAD(Buffer.from(additionalData, 'utf8'));
        }
        
        let encrypted = cipher.update(data, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        
        const authTag = cipher.getAuthTag();
        
        return {
          encrypted,
          iv: iv.toString('hex'),
          authTag: authTag.toString('hex'),
          additionalData
        };
      },
      
      decrypt: (encryptedData) => {
        if (!process.env.EC_ENCRYPTION_KEY) {
          throw new Error('EC encryption key not configured');
        }
        
        const key = Buffer.from(process.env.EC_ENCRYPTION_KEY, 'hex');
        const iv = Buffer.from(encryptedData.iv, 'hex');
        const decipher = crypto.createDecipherGCM('aes-256-gcm', key, iv);
        
        if (encryptedData.additionalData) {
          decipher.setAAD(Buffer.from(encryptedData.additionalData, 'utf8'));
        }
        
        decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));
        
        let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        
        return decrypted;
      },
      
      hash: (data) => {
        return crypto.createHash('sha256').update(data).digest('hex');
      },
      
      signVectorClock: (vectorClock, nodeId) => {
        const clockData = JSON.stringify({ vectorClock, nodeId, timestamp: Date.now() });
        return this.encryptionService.hash(clockData);
      },
      
      signStateIntegrity: (entityId, state) => {
        const stateData = JSON.stringify({ entityId, state, timestamp: Date.now() });
        return this.encryptionService.hash(stateData);
      }
    };
  }

  async initializeLockService() {
    this.lockService = {
      acquireLock: async (lockKey, ttl = this.maxLockTime) => {
        const lockValue = crypto.randomBytes(16).toString('hex');
        const acquired = await this.redis.set(
          `${this.config.keyPrefix}lock:${lockKey}`,
          lockValue,
          'PX', ttl,
          'NX'
        );
        
        if (acquired) {
          const timeoutHandle = setTimeout(async () => {
            await this.releaseLock(lockKey, lockValue);
          }, ttl);
          
          this.lockTimeouts.set(lockKey, { timeoutHandle, lockValue });
          return lockValue;
        }
        
        return null;
      },
      
      releaseLock: async (lockKey, lockValue) => {
        const script = `
          if redis.call("get", KEYS[1]) == ARGV[1] then
            return redis.call("del", KEYS[1])
          else
            return 0
          end
        `;
        
        const result = await this.redis.eval(script, 1, `${this.config.keyPrefix}lock:${lockKey}`, lockValue);
        
        const lockInfo = this.lockTimeouts.get(lockKey);
        if (lockInfo) {
          clearTimeout(lockInfo.timeoutHandle);
          this.lockTimeouts.delete(lockKey);
        }
        
        return result === 1;
      }
    };
  }

  async initializeSecureVectorClock() {
    // Initialize vector clock with cryptographic protection
    this.vectorClocks.set(this.nodeId, new Map());
    
    // Generate signature for the clock
    const clockSignature = this.encryptionService.signVectorClock(
      Object.fromEntries(this.vectorClocks.get(this.nodeId)),
      this.nodeId
    );
    
    this.clockSignatures.set(this.nodeId, clockSignature);
    
    console.log(`✅ Secure vector clock initialized for node: ${this.nodeId}`);
  }

  async loadPendingStatesSecurely() {
    try {
      // Load entity states from Redis with integrity verification
      const states = await this.redis.hGetAll(`${this.config.keyPrefix}states`);
      let loadedCount = 0;
      let corruptedCount = 0;
      
      for (const [entityId, stateData] of Object.entries(states)) {
        try {
          const decryptedData = this.decryptSensitiveData(stateData);
          const state = JSON.parse(decryptedData);
          
          // Verify state integrity
          if (this.verifyStateIntegrity(entityId, state)) {
            this.entityStates.set(entityId, state);
            loadedCount++;
          } else {
            corruptedCount++;
            this.securityMetrics.integrityViolations++;
            
            await this.auditLog('state_integrity_violation', {
              entityId,
              reason: 'signature_mismatch'
            });
          }
          
        } catch (error) {
          console.error(`Failed to load state for entity ${entityId}:`, error);
          corruptedCount++;
        }
      }
      
      console.log(`Loaded ${loadedCount} entity states (${corruptedCount} corrupted/rejected)`);
      
    } catch (error) {
      console.error('Failed to load pending states:', error);
    }
  }

  verifyStateIntegrity(entityId, state) {
    if (!state.integritySignature) return false;
    
    const expectedSignature = this.encryptionService.signStateIntegrity(entityId, {
      id: state.id,
      type: state.type,
      version: state.version,
      data: state.data,
      lastUpdated: state.lastUpdated
    });
    
    return state.integritySignature === expectedSignature;
  }

  // Main event append method with comprehensive security
  async appendEvent(entityId, entityType, eventType, eventData, category = 'important', authenticatedUser = null) {
    const startTime = Date.now();
    
    try {
      // Authentication and authorization
      if (!await this.authenticationService.validateUser(authenticatedUser, authenticatedUser?.authToken)) {
        throw new Error('Authentication failed');
      }
      
      if (!await this.authorizationService.checkEventPermission(authenticatedUser, 'append_event', entityType)) {
        throw new Error('Insufficient permissions to append event');
      }
      
      // Input validation and sanitization
      const sanitizedEntityId = this.sanitizeString(entityId);
      const sanitizedEntityType = this.sanitizeString(entityType);
      const sanitizedEventType = this.sanitizeString(eventType);
      const sanitizedCategory = this.sanitizeString(category);
      
      if (!sanitizedEntityId || !sanitizedEntityType || !sanitizedEventType) {
        throw new Error('Invalid event parameters');
      }
      
      // Validate event size
      const eventSize = JSON.stringify(eventData).length;
      if (eventSize > this.securityControls.maxEventSize) {
        throw new Error('Event size exceeds limits');
      }
      
      // Generate secure event ID
      const eventId = await this.generateSecureEventId();
      
      // Acquire entity lock for atomic operations
      const lockKey = `entity:${sanitizedEntityId}`;
      const lockValue = await this.lockService.acquireLock(lockKey);
      if (!lockValue) {
        throw new Error('Failed to acquire entity lock');
      }
      
      try {
        // Update vector clock if enabled
        let vectorClock = null;
        if (this.config.vectorClockEnabled) {
          vectorClock = this.incrementSecureVectorClock(this.nodeId);
        }
        
        // Create secure event with integrity protection
        const event = {
          id: eventId,
          entityId: sanitizedEntityId,
          entityType: sanitizedEntityType,
          eventType: sanitizedEventType,
          data: this.sanitizeEventData(eventData),
          category: sanitizedCategory,
          timestamp: Date.now(),
          nodeId: this.nodeId,
          vectorClock: vectorClock,
          userId: authenticatedUser.id,
          version: await this.getNextVersion(sanitizedEntityId),
          integrity: this.calculateEventIntegrity(eventId, sanitizedEntityId, eventData)
        };
        
        // Store event securely
        this.eventStore.set(eventId, event);
        await this.persistEventSecurely(event);
        
        // Project new state with integrity protection
        await this.projectEntityStateSecurely(sanitizedEntityId, sanitizedEntityType, event);
        
        // Queue for synchronization
        await this.queueForSecureSync(event);
        
        // Update performance stats
        this.performanceStats.eventsProcessed++;
        
        await this.auditLog('event_appended', {
          eventId,
          entityId: sanitizedEntityId,
          entityType: sanitizedEntityType,
          eventType: sanitizedEventType,
          category: sanitizedCategory,
          userId: authenticatedUser.id
        });
        
        this.emit('event_appended', {
          eventId,
          entityId: sanitizedEntityId,
          entityType: sanitizedEntityType,
          eventType: sanitizedEventType,
          category: sanitizedCategory
        });
        
        console.log(`✅ Event appended securely: ${eventId} for entity ${sanitizedEntityId}`);
        
        return {
          eventId,
          version: event.version,
          timestamp: event.timestamp,
          queuedForSync: true
        };
        
      } finally {
        // Always release the lock
        await this.lockService.releaseLock(lockKey, lockValue);
      }
      
    } catch (error) {
      console.error(`Failed to append event for entity ${entityId}:`, error);
      
      await this.auditLog('event_append_failed', {
        entityId,
        entityType,
        eventType,
        error: error.message,
        userId: authenticatedUser?.id
      });
      
      throw error;
    }
  }

  async generateSecureEventId() {
    const timestamp = Date.now();
    const randomBytes = crypto.randomBytes(16);
    const nodeId = this.nodeId;
    
    const hash = crypto
      .createHash('sha256')
      .update(`${timestamp}:${randomBytes.toString('hex')}:${nodeId}`)
      .digest('hex');
    
    return `evt_secure_${timestamp}_${hash.substring(0, 16)}`;
  }

  incrementSecureVectorClock(nodeId) {
    let vectorClock = this.vectorClocks.get(nodeId) || new Map();
    const currentValue = vectorClock.get(nodeId) || 0;
    
    // Check for clock tampering
    const expectedValue = currentValue + 1;
    if (expectedValue > currentValue + 1000) { // Unreasonable jump
      this.securityMetrics.clockTamperingAttempts++;
      throw new Error('Vector clock tampering detected');
    }
    
    vectorClock.set(nodeId, expectedValue);
    this.vectorClocks.set(nodeId, vectorClock);
    
    // Update signature
    const clockSignature = this.encryptionService.signVectorClock(
      Object.fromEntries(vectorClock),
      nodeId
    );
    this.clockSignatures.set(nodeId, clockSignature);
    
    this.performanceStats.vectorClockOperations++;
    
    return Object.fromEntries(vectorClock);
  }

  sanitizeEventData(data) {
    if (!data || typeof data !== 'object') return {};
    
    const sanitized = {};
    const allowedKeys = new Set([
      'operation', 'amount', 'token', 'metadata', 'signature',
      'timestamp', 'nonce', 'previousHash', 'userId'
    ]);
    
    for (const [key, value] of Object.entries(data)) {
      if (allowedKeys.has(key)) {
        if (typeof value === 'string') {
          sanitized[key] = value.substring(0, 1000);
        } else if (typeof value === 'number' && isFinite(value)) {
          sanitized[key] = value;
        } else if (typeof value === 'boolean') {
          sanitized[key] = value;
        } else if (typeof value === 'object' && value !== null) {
          sanitized[key] = this.sanitizeEventData(value);
        }
      }
    }
    
    return sanitized;
  }

  calculateEventIntegrity(eventId, entityId, eventData) {
    const integritySeed = JSON.stringify({
      eventId,
      entityId,
      eventData,
      nodeId: this.nodeId,
      timestamp: Date.now()
    });
    
    return this.encryptionService.hash(integritySeed);
  }

  async getNextVersion(entityId) {
    const currentState = this.entityStates.get(entityId);
    return currentState ? (currentState.version || 0) + 1 : 1;
  }

  async persistEventSecurely(event) {
    try {
      const eventData = this.encryptSensitiveData(JSON.stringify(event), 'event_data');
      
      await this.redis.hSet(
        `${this.config.keyPrefix}events`,
        event.id,
        eventData
      );
      
      // Add to entity event log with encryption
      await this.redis.lPush(
        `${this.config.keyPrefix}entity:${event.entityId}:events`,
        event.id
      );
      
      // Set TTL based on category
      const categoryConfig = this.config.dataCategories[event.category];
      if (categoryConfig && categoryConfig.maxAge) {
        await this.redis.expire(
          `${this.config.keyPrefix}entity:${event.entityId}:events`,
          Math.floor(categoryConfig.maxAge / 1000)
        );
      }
      
    } catch (error) {
      console.error('Failed to persist event securely:', error);
      throw error;
    }
  }

  async projectEntityStateSecurely(entityId, entityType, event) {
    try {
      // Get current state
      const currentState = this.entityStates.get(entityId) || {
        id: entityId,
        type: entityType,
        version: 0,
        data: {},
        lastUpdated: 0
      };
      
      // Get state projector
      const projector = this.stateProjectors.get(entityType);
      if (!projector) {
        console.warn(`No state projector found for entity type: ${entityType}`);
        return;
      }
      
      // Verify projector integrity
      const expectedSignature = this.projectorSignatures.get(entityType);
      if (!expectedSignature) {
        this.securityMetrics.integrityViolations++;
        throw new Error(`No signature found for state projector: ${entityType}`);
      }
      
      // Project new state in secure context
      const newState = await this.executeProjectorSecurely(projector, currentState, event);
      
      // Validate new state
      const validator = this.consistencyValidators.get(entityType);
      if (validator && !await this.executeValidatorSecurely(validator, newState, currentState, event)) {
        throw new Error(`State validation failed for entity ${entityId}`);
      }
      
      // Update state with integrity protection
      newState.version = event.version;
      newState.lastUpdated = event.timestamp;
      newState.lastEventId = event.id;
      newState.integritySignature = this.encryptionService.signStateIntegrity(entityId, newState);
      
      this.entityStates.set(entityId, newState);
      
      // Persist state securely
      await this.persistEntityStateSecurely(entityId, newState);
      
      this.performanceStats.stateProjections++;
      
      this.emit('state_projected', {
        entityId,
        entityType,
        oldVersion: currentState.version,
        newVersion: newState.version,
        eventId: event.id
      });
      
    } catch (error) {
      console.error(`Failed to project state securely for entity ${entityId}:`, error);
      throw error;
    }
  }

  async executeProjectorSecurely(projector, currentState, event) {
    // Execute projector in isolated context with timeout
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Projector execution timeout'));
      }, 5000); // 5 second timeout
      
      try {
        // Create sanitized context
        const sanitizedCurrentState = this.sanitizeStateData(currentState);
        const sanitizedEvent = this.sanitizeEventData(event.data);
        
        const result = projector(sanitizedCurrentState, { ...event, data: sanitizedEvent });
        
        if (result && typeof result.then === 'function') {
          result
            .then(resolve)
            .catch(reject)
            .finally(() => clearTimeout(timeout));
        } else {
          clearTimeout(timeout);
          resolve(result);
        }
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    });
  }

  async executeValidatorSecurely(validator, newState, currentState, event) {
    // Execute validator in isolated context with timeout
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Validator execution timeout'));
      }, 3000); // 3 second timeout
      
      try {
        const sanitizedNewState = this.sanitizeStateData(newState);
        const sanitizedCurrentState = this.sanitizeStateData(currentState);
        const sanitizedEvent = this.sanitizeEventData(event.data);
        
        const result = validator(sanitizedNewState, sanitizedCurrentState, { ...event, data: sanitizedEvent });
        
        if (result && typeof result.then === 'function') {
          result
            .then(resolve)
            .catch(reject)
            .finally(() => clearTimeout(timeout));
        } else {
          clearTimeout(timeout);
          resolve(result);
        }
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    });
  }

  sanitizeStateData(state) {
    if (!state || typeof state !== 'object') return {};
    
    const sanitized = {};
    const allowedKeys = new Set([
      'id', 'type', 'version', 'data', 'lastUpdated', 'lastEventId'
    ]);
    
    for (const [key, value] of Object.entries(state)) {
      if (allowedKeys.has(key)) {
        if (typeof value === 'string') {
          sanitized[key] = value.substring(0, 1000);
        } else if (typeof value === 'number' && isFinite(value)) {
          sanitized[key] = value;
        } else if (typeof value === 'object' && value !== null) {
          sanitized[key] = this.sanitizeStateData(value);
        }
      }
    }
    
    return sanitized;
  }

  async persistEntityStateSecurely(entityId, state) {
    try {
      const stateData = this.encryptSensitiveData(JSON.stringify(state), 'state_data');
      
      await this.redis.hSet(
        `${this.config.keyPrefix}states`,
        entityId,
        stateData
      );
      
    } catch (error) {
      console.error('Failed to persist entity state securely:', error);
      throw error;
    }
  }

  async queueForSecureSync(event) {
    const category = event.category;
    const syncQueue = this.syncQueues.get(category);
    
    if (syncQueue) {
      syncQueue.push({
        eventId: event.id,
        entityId: event.entityId,
        priority: this.config.dataCategories[category].syncPriority,
        timestamp: event.timestamp,
        integrity: event.integrity
      });
      
      // Sort by priority and timestamp
      syncQueue.sort((a, b) => {
        const priorityOrder = { high: 3, medium: 2, low: 1 };
        const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
        return priorityDiff !== 0 ? priorityDiff : a.timestamp - b.timestamp;
      });
      
      // Limit queue size for security
      if (syncQueue.length > this.config.batchSize * 10) {
        syncQueue.splice(this.config.batchSize * 10);
      }
      
      this.syncQueues.set(category, syncQueue);
    }
  }

  encryptSensitiveData(data, context = '') {
    if (this.config.encryptionEnabled && this.encryptionService) {
      return JSON.stringify(this.encryptionService.encrypt(data, context));
    }
    return data;
  }

  decryptSensitiveData(encryptedData) {
    if (this.config.encryptionEnabled && this.encryptionService) {
      try {
        const parsedData = JSON.parse(encryptedData);
        return this.encryptionService.decrypt(parsedData);
      } catch (error) {
        return encryptedData;
      }
    }
    return encryptedData;
  }

  verifyJWT(token) {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) throw new Error('Invalid JWT format');
      
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
      
      if (payload.exp && payload.exp < Date.now() / 1000) {
        throw new Error('JWT expired');
      }
      
      return payload;
    } catch (error) {
      throw new Error('JWT verification failed');
    }
  }

  sanitizeAuditDetails(details) {
    if (!details || typeof details !== 'object') return {};
    
    const sanitized = {};
    const allowedKeys = new Set([
      'eventId', 'entityId', 'entityType', 'eventType', 'category',
      'userId', 'version', 'error', 'reason', 'duration'
    ]);
    
    for (const [key, value] of Object.entries(details)) {
      if (allowedKeys.has(key)) {
        if (typeof value === 'string') {
          sanitized[key] = value.substring(0, 500);
        } else if (typeof value === 'number' && isFinite(value)) {
          sanitized[key] = value;
        } else if (typeof value === 'boolean') {
          sanitized[key] = value;
        }
      }
    }
    
    return sanitized;
  }

  async auditLog(event, details) {
    if (this.auditLogger) {
      await this.auditLogger.log(event, details);
    }
  }

  getEntityState(entityId) {
    return this.entityStates.get(entityId);
  }

  getSystemStatus() {
    return {
      isRunning: this.isRunning,
      totalEntities: this.entityStates.size,
      pendingConflicts: this.conflictQueue.size,
      performanceStats: this.performanceStats,
      securityMetrics: this.securityMetrics,
      securityControls: this.securityControls,
      syncQueues: Object.fromEntries(
        Array.from(this.syncQueues.entries()).map(([category, queue]) => [
          category, { size: queue.length }
        ])
      ),
      resourceUsage: {
        memoryUsage: process.memoryUsage(),
        eventStoreSize: this.eventStore.size,
        conflictQueueSize: this.conflictQueue.size
      }
    };
  }

  async start() {
    if (this.isRunning) return;
    
    console.log('🚀 Starting Secure Eventual Consistency Manager...');
    this.isRunning = true;
    
    // Start monitoring
    this.startPerformanceMonitoring();
    
    console.log('✅ Secure Eventual Consistency Manager started');
    
    await this.auditLog('manager_started', {
      timestamp: Date.now(),
      securityEnabled: true,
      nodeId: this.nodeId
    });
  }

  startPerformanceMonitoring() {
    this.performanceInterval = setInterval(async () => {
      await this.updatePerformanceMetrics();
    }, 60000); // Every minute
  }

  async updatePerformanceMetrics() {
    try {
      // Calculate consistency rate
      const totalEntities = this.entityStates.size;
      const consistentEntities = Array.from(this.syncStatus.values())
        .filter(status => status.status === 'synced').length;
      
      this.performanceStats.consistencyRate = totalEntities > 0 ? 
        consistentEntities / totalEntities : 1;
      
      // Calculate pending syncs
      this.performanceStats.pendingSyncs = Array.from(this.syncQueues.values())
        .reduce((total, queue) => total + queue.length, 0);
      
      // Update metrics
      await this.metrics.setGauge('ec.events_processed', this.performanceStats.eventsProcessed, { security: 'enabled' }, 'consistency');
      await this.metrics.setGauge('ec.sync_operations', this.performanceStats.syncOperations, { security: 'enabled' }, 'consistency');
      await this.metrics.setGauge('ec.conflicts_resolved', this.performanceStats.conflictsResolved, { security: 'enabled' }, 'consistency');
      await this.metrics.setGauge('ec.consistency_rate', this.performanceStats.consistencyRate, { security: 'enabled' }, 'consistency');
      await this.metrics.setGauge('ec.pending_syncs', this.performanceStats.pendingSyncs, { security: 'enabled' }, 'consistency');
      await this.metrics.setGauge('ec.vector_clock_operations', this.performanceStats.vectorClockOperations, { security: 'enabled' }, 'consistency');
      await this.metrics.setGauge('ec.state_projections', this.performanceStats.stateProjections, { security: 'enabled' }, 'consistency');
      
      // Security metrics
      await this.metrics.setGauge('ec.authentication_attempts', this.securityMetrics.authenticationAttempts, { security: 'enabled' }, 'consistency');
      await this.metrics.setGauge('ec.authentication_failures', this.securityMetrics.authenticationFailures, { security: 'enabled' }, 'consistency');
      await this.metrics.setGauge('ec.integrity_violations', this.securityMetrics.integrityViolations, { security: 'enabled' }, 'consistency');
      await this.metrics.setGauge('ec.clock_tampering_attempts', this.securityMetrics.clockTamperingAttempts, { security: 'enabled' }, 'consistency');
      
    } catch (error) {
      console.error('Failed to update performance metrics:', error);
    }
  }

  stop() {
    if (!this.isRunning) return;
    
    console.log('🛑 Stopping Secure Eventual Consistency Manager...');
    
    // Stop intervals
    if (this.performanceInterval) clearInterval(this.performanceInterval);
    
    // Clear lock timeouts
    for (const lockInfo of this.lockTimeouts.values()) {
      clearTimeout(lockInfo.timeoutHandle);
    }
    this.lockTimeouts.clear();
    
    // Close Redis connection
    if (this.redis) {
      this.redis.quit();
    }
    
    // Clear data structures
    this.eventStore.clear();
    this.entityStates.clear();
    this.pendingSyncs.clear();
    this.conflictQueue.clear();
    this.vectorClocks.clear();
    this.syncQueues.clear();
    this.syncStatus.clear();
    
    this.isRunning = false;
    console.log('✅ Secure Eventual Consistency Manager stopped');
    
    // Final audit log
    this.auditLog('manager_stopped', {
      timestamp: Date.now(),
      gracefulShutdown: true
    });
  }
}

module.exports = SecureEventualConsistencyManager;