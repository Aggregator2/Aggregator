const EventEmitter = require('events');
const crypto = require('crypto');
const { getSecureMetricsCollector } = require('../../monitoring/secure-metrics-collector');

class EventualConsistencyManager extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      // Synchronization intervals with validation
      syncInterval: this.validateNumber(config.syncInterval, 30000, 5000, 300000),
      conflictResolutionInterval: this.validateNumber(config.conflictResolutionInterval, 60000, 30000, 600000),
      
      // Consistency levels
      consistencyLevel: this.validateConsistencyLevel(config.consistencyLevel || 'eventual'),
      maxSyncDelay: this.validateNumber(config.maxSyncDelay, 300000, 60000, 3600000),
      
      // Conflict resolution strategies
      conflictResolution: this.validateConflictResolution(config.conflictResolution || 'last_write_wins'),
      vectorClockEnabled: config.vectorClockEnabled !== false,
      
      // Data categorization for consistency requirements
      dataCategories: this.validateDataCategories(config.dataCategories || {
        critical: { consistencyLevel: 'strong', syncPriority: 'high' },
        important: { consistencyLevel: 'eventual', syncPriority: 'medium' },
        cache: { consistencyLevel: 'weak', syncPriority: 'low' },
        analytics: { consistencyLevel: 'weak', syncPriority: 'low' }
      }),
      
      // Performance settings
      batchSize: this.validateNumber(config.batchSize, 100, 10, 1000),
      maxConcurrentSyncs: this.validateNumber(config.maxConcurrentSyncs, 10, 1, 100),
      
      // Redis configuration for event sourcing and sync
      redisUrl: this.sanitizeUrl(config.redisUrl || process.env.REDIS_URL),
      keyPrefix: this.sanitizeKeyPrefix(config.keyPrefix || 'ec:'),
      
      // Security settings
      encryptionEnabled: config.encryptionEnabled !== false,
      authenticationRequired: config.authenticationRequired !== false,
      
      // Storage backends
      primaryStore: config.primaryStore || 'redis',
      secondaryStores: config.secondaryStores || [],
      
      ...config
    };
    
    this.metrics = getSecureMetricsCollector();
    this.redis = null;
    this.isRunning = false;
    
    // Event sourcing and state management
    this.eventStore = new Map(); // eventId -> event data
    this.entityStates = new Map(); // entityId -> current state
    this.pendingSyncs = new Map(); // entityId -> pending sync operations
    this.conflictQueue = new Map(); // conflictId -> conflict details
    
    // Vector clocks for causality tracking
    this.vectorClocks = new Map(); // nodeId -> vector clock
    this.nodeId = this.generateNodeId();
    
    // Synchronization tracking
    this.syncQueues = new Map(); // category -> sync queue
    this.syncStatus = new Map(); // entityId -> sync status
    this.lastSyncTimes = new Map(); // entityId -> last sync timestamp
    
    // Performance tracking
    this.performanceStats = {
      eventsProcessed: 0,
      syncOperations: 0,
      conflictsResolved: 0,
      averageSyncTime: 0,
      consistencyRate: 0,
      pendingSyncs: 0
    };
    
    // Consistency validators
    this.consistencyValidators = new Map(); // entityType -> validator function
    this.stateProjectors = new Map(); // entityType -> state projector function
    
    // Security tracking
    this.failedAttempts = new Map();
    this.authorizedUsers = new Set();
    
    // Sync intervals
    this.syncInterval = null;
    this.conflictResolutionInterval = null;
  }

  validateNumber(value, defaultValue, min, max) {
    if (typeof value !== 'number' || !isFinite(value) || value < min || value > max) {
      return defaultValue;
    }
    return value;
  }

  validateConsistencyLevel(level) {
    const allowedLevels = ['strong', 'eventual', 'weak'];
    return allowedLevels.includes(level) ? level : 'eventual';
  }

  validateConflictResolution(strategy) {
    const allowedStrategies = ['last_write_wins', 'first_write_wins', 'custom', 'merge', 'vector_clock'];
    return allowedStrategies.includes(strategy) ? strategy : 'last_write_wins';
  }

  validateDataCategories(categories) {
    const validated = {};
    const allowedLevels = ['strong', 'eventual', 'weak'];
    const allowedPriorities = ['high', 'medium', 'low'];
    
    for (const [category, config] of Object.entries(categories)) {
      const sanitizedCategory = this.sanitizeString(category);
      if (sanitizedCategory && typeof config === 'object' && config !== null) {
        validated[sanitizedCategory] = {
          consistencyLevel: allowedLevels.includes(config.consistencyLevel) ? 
            config.consistencyLevel : 'eventual',
          syncPriority: allowedPriorities.includes(config.syncPriority) ? 
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

  generateNodeId() {
    const hostname = require('os').hostname();
    const random = crypto.randomBytes(4).toString('hex');
    return `${hostname}_${random}`;
  }

  async initialize() {
    try {
      console.log('🔄 Initializing Eventual Consistency Manager...');
      
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
      
      // Initialize vector clock for this node
      if (this.config.vectorClockEnabled) {
        this.vectorClocks.set(this.nodeId, new Map());
      }
      
      // Initialize sync queues for each data category
      for (const category of Object.keys(this.config.dataCategories)) {
        this.syncQueues.set(category, []);
      }
      
      // Load pending events and states
      await this.loadPendingStates();
      
      console.log('✅ Eventual Consistency Manager initialized');
    } catch (error) {
      console.error('Failed to initialize Eventual Consistency Manager:', error);
      throw error;
    }
  }

  async start() {
    if (this.isRunning) return;
    
    console.log('🚀 Starting Eventual Consistency Manager...');
    this.isRunning = true;
    
    // Start synchronization loops
    this.startSynchronization();
    this.startConflictResolution();
    
    // Start performance monitoring
    this.startPerformanceMonitoring();
    
    console.log('✅ Eventual Consistency Manager started');
  }

  startSynchronization() {
    this.syncInterval = setInterval(async () => {
      try {
        await this.performSynchronization();
      } catch (error) {
        console.error('Synchronization error:', error);
      }
    }, this.config.syncInterval);
  }

  startConflictResolution() {
    this.conflictResolutionInterval = setInterval(async () => {
      try {
        await this.resolveConflicts();
      } catch (error) {
        console.error('Conflict resolution error:', error);
      }
    }, this.config.conflictResolutionInterval);
  }

  startPerformanceMonitoring() {
    this.performanceInterval = setInterval(async () => {
      await this.updatePerformanceMetrics();
    }, 60000); // Every minute
  }

  // Register entity state projector
  registerStateProjector(entityType, projectorFunction) {
    const sanitizedType = this.sanitizeString(entityType);
    if (!sanitizedType) {
      throw new Error('Invalid entity type');
    }
    
    if (typeof projectorFunction !== 'function') {
      throw new Error('Projector must be a function');
    }
    
    this.stateProjectors.set(sanitizedType, projectorFunction);
    console.log(`State projector registered: ${sanitizedType}`);
  }

  // Register consistency validator
  registerConsistencyValidator(entityType, validatorFunction) {
    const sanitizedType = this.sanitizeString(entityType);
    if (!sanitizedType) {
      throw new Error('Invalid entity type');
    }
    
    if (typeof validatorFunction !== 'function') {
      throw new Error('Validator must be a function');
    }
    
    this.consistencyValidators.set(sanitizedType, validatorFunction);
    console.log(`Consistency validator registered: ${sanitizedType}`);
  }

  // Append event to event store with eventual consistency guarantees
  async appendEvent(entityId, entityType, eventType, eventData, category = 'important', authenticatedUser = null) {
    // Security validation
    if (this.config.authenticationRequired && !authenticatedUser) {
      throw new Error('Authentication required for event appending');
    }
    
    // Input validation
    const sanitizedEntityId = this.sanitizeString(entityId);
    const sanitizedEntityType = this.sanitizeString(entityType);
    const sanitizedEventType = this.sanitizeString(eventType);
    const sanitizedCategory = this.sanitizeString(category);
    
    if (!sanitizedEntityId || !sanitizedEntityType || !sanitizedEventType) {
      throw new Error('Invalid event parameters');
    }
    
    // Generate event ID
    const eventId = this.generateEventId();
    
    // Update vector clock if enabled
    let vectorClock = null;
    if (this.config.vectorClockEnabled) {
      vectorClock = this.incrementVectorClock(this.nodeId);
    }
    
    // Create event
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
      userId: authenticatedUser?.id,
      version: await this.getNextVersion(sanitizedEntityId)
    };
    
    try {
      // Store event
      this.eventStore.set(eventId, event);
      
      // Persist to Redis
      await this.persistEvent(event);
      
      // Project new state
      await this.projectEntityState(sanitizedEntityId, sanitizedEntityType, event);
      
      // Queue for synchronization based on category
      await this.queueForSync(event);
      
      // Update performance stats
      this.performanceStats.eventsProcessed++;
      
      this.emit('event_appended', {
        eventId,
        entityId: sanitizedEntityId,
        entityType: sanitizedEntityType,
        eventType: sanitizedEventType,
        category: sanitizedCategory
      });
      
      console.log(`Event appended: ${eventId} for entity ${sanitizedEntityId}`);
      
      return {
        eventId,
        version: event.version,
        timestamp: event.timestamp,
        queuedForSync: true
      };
      
    } catch (error) {
      console.error(`Failed to append event for entity ${sanitizedEntityId}:`, error);
      throw error;
    }
  }

  generateEventId() {
    const timestamp = Date.now();
    const random = crypto.randomBytes(8).toString('hex');
    return `evt_${timestamp}_${random}`;
  }

  incrementVectorClock(nodeId) {
    let vectorClock = this.vectorClocks.get(nodeId) || new Map();
    const currentValue = vectorClock.get(nodeId) || 0;
    vectorClock.set(nodeId, currentValue + 1);
    this.vectorClocks.set(nodeId, vectorClock);
    
    // Return serializable vector clock
    return Object.fromEntries(vectorClock);
  }

  sanitizeEventData(data) {
    if (!data || typeof data !== 'object') return {};
    
    const sanitized = {};
    for (const [key, value] of Object.entries(data)) {
      const cleanKey = this.sanitizeString(key);
      if (cleanKey && typeof value !== 'function') {
        if (typeof value === 'string') {
          sanitized[cleanKey] = this.sanitizeString(value);
        } else if (typeof value === 'number' && isFinite(value)) {
          sanitized[cleanKey] = value;
        } else if (typeof value === 'boolean') {
          sanitized[cleanKey] = value;
        } else if (typeof value === 'object' && value !== null) {
          sanitized[cleanKey] = this.sanitizeEventData(value);
        }
      }
    }
    return sanitized;
  }

  async getNextVersion(entityId) {
    const currentState = this.entityStates.get(entityId);
    return currentState ? (currentState.version || 0) + 1 : 1;
  }

  async persistEvent(event) {
    try {
      // Store event in Redis with encryption if enabled
      const eventData = this.config.encryptionEnabled ? 
        this.encryptData(JSON.stringify(event)) : JSON.stringify(event);
      
      await this.redis.hSet(
        `${this.config.keyPrefix}events`,
        event.id,
        eventData
      );
      
      // Add to entity event log
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
      console.error('Failed to persist event:', error);
      throw error;
    }
  }

  encryptData(data) {
    if (!process.env.EC_ENCRYPTION_KEY) {
      return data; // Return unencrypted if no key configured
    }
    
    const key = Buffer.from(process.env.EC_ENCRYPTION_KEY, 'hex');
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipher('aes-256-cbc', key);
    
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    return iv.toString('hex') + ':' + encrypted;
  }

  decryptData(encryptedData) {
    if (!process.env.EC_ENCRYPTION_KEY) {
      return encryptedData; // Return as-is if no key configured
    }
    
    const key = Buffer.from(process.env.EC_ENCRYPTION_KEY, 'hex');
    const parts = encryptedData.split(':');
    
    if (parts.length !== 2) {
      return encryptedData; // Return as-is if not encrypted format
    }
    
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    
    const decipher = crypto.createDecipher('aes-256-cbc', key);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }

  async projectEntityState(entityId, entityType, event) {
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
      
      // Project new state
      const newState = await projector(currentState, event);
      
      // Validate new state
      const validator = this.consistencyValidators.get(entityType);
      if (validator && !await validator(newState, currentState, event)) {
        throw new Error(`State validation failed for entity ${entityId}`);
      }
      
      // Update state
      newState.version = event.version;
      newState.lastUpdated = event.timestamp;
      newState.lastEventId = event.id;
      
      this.entityStates.set(entityId, newState);
      
      // Persist state
      await this.persistEntityState(entityId, newState);
      
      this.emit('state_projected', {
        entityId,
        entityType,
        oldVersion: currentState.version,
        newVersion: newState.version,
        eventId: event.id
      });
      
    } catch (error) {
      console.error(`Failed to project state for entity ${entityId}:`, error);
      throw error;
    }
  }

  async persistEntityState(entityId, state) {
    try {
      const stateData = this.config.encryptionEnabled ? 
        this.encryptData(JSON.stringify(state)) : JSON.stringify(state);
      
      await this.redis.hSet(
        `${this.config.keyPrefix}states`,
        entityId,
        stateData
      );
      
    } catch (error) {
      console.error('Failed to persist entity state:', error);
      throw error;
    }
  }

  async queueForSync(event) {
    const category = event.category;
    const syncQueue = this.syncQueues.get(category);
    
    if (syncQueue) {
      syncQueue.push({
        eventId: event.id,
        entityId: event.entityId,
        priority: this.config.dataCategories[category].syncPriority,
        timestamp: event.timestamp
      });
      
      // Sort by priority and timestamp
      syncQueue.sort((a, b) => {
        const priorityOrder = { high: 3, medium: 2, low: 1 };
        const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
        return priorityDiff !== 0 ? priorityDiff : a.timestamp - b.timestamp;
      });
      
      // Limit queue size
      if (syncQueue.length > this.config.batchSize * 10) {
        syncQueue.splice(this.config.batchSize * 10);
      }
      
      this.syncQueues.set(category, syncQueue);
    }
  }

  async performSynchronization() {
    const syncPromises = [];
    let activeSyncs = 0;
    
    // Process sync queues by priority
    const sortedCategories = Object.entries(this.config.dataCategories)
      .sort(([,a], [,b]) => {
        const priorityOrder = { high: 3, medium: 2, low: 1 };
        return priorityOrder[b.syncPriority] - priorityOrder[a.syncPriority];
      })
      .map(([category]) => category);
    
    for (const category of sortedCategories) {
      if (activeSyncs >= this.config.maxConcurrentSyncs) break;
      
      const syncQueue = this.syncQueues.get(category);
      if (!syncQueue || syncQueue.length === 0) continue;
      
      // Take batch of items to sync
      const batch = syncQueue.splice(0, Math.min(this.config.batchSize, syncQueue.length));
      
      if (batch.length > 0) {
        const syncPromise = this.syncBatch(category, batch);
        syncPromises.push(syncPromise);
        activeSyncs++;
      }
    }
    
    // Wait for all sync operations to complete
    if (syncPromises.length > 0) {
      await Promise.allSettled(syncPromises);
    }
  }

  async syncBatch(category, batch) {
    const startTime = Date.now();
    
    try {
      // Group by entity for efficient processing
      const entitiesBatch = this.groupByEntity(batch);
      
      // Sync each entity
      for (const [entityId, items] of entitiesBatch) {
        await this.syncEntity(entityId, items, category);
      }
      
      // Update performance stats
      this.performanceStats.syncOperations += batch.length;
      const syncTime = Date.now() - startTime;
      this.performanceStats.averageSyncTime = 
        (this.performanceStats.averageSyncTime * 0.9) + (syncTime * 0.1);
      
      this.emit('batch_synced', {
        category,
        batchSize: batch.length,
        syncTime,
        entities: entitiesBatch.size
      });
      
    } catch (error) {
      console.error(`Failed to sync batch for category ${category}:`, error);
      
      // Re-queue failed items
      const syncQueue = this.syncQueues.get(category);
      syncQueue.unshift(...batch);
    }
  }

  groupByEntity(batch) {
    const grouped = new Map();
    
    for (const item of batch) {
      const entityItems = grouped.get(item.entityId) || [];
      entityItems.push(item);
      grouped.set(item.entityId, entityItems);
    }
    
    return grouped;
  }

  async syncEntity(entityId, items, category) {
    try {
      // Get current state
      const currentState = this.entityStates.get(entityId);
      if (!currentState) {
        console.warn(`No state found for entity ${entityId}, skipping sync`);
        return;
      }
      
      // Check if entity needs sync based on category settings
      const categoryConfig = this.config.dataCategories[category];
      const lastSyncTime = this.lastSyncTimes.get(entityId) || 0;
      
      if (Date.now() - lastSyncTime < categoryConfig.maxAge) {
        // Skip sync if too recent
        return;
      }
      
      // Detect conflicts
      const conflicts = await this.detectConflicts(entityId, currentState);
      
      if (conflicts.length > 0) {
        // Queue conflicts for resolution
        for (const conflict of conflicts) {
          this.queueConflict(conflict);
        }
        return;
      }
      
      // Perform sync to secondary stores
      await this.syncToSecondaryStores(entityId, currentState);
      
      // Update sync status
      this.lastSyncTimes.set(entityId, Date.now());
      this.syncStatus.set(entityId, {
        lastSync: Date.now(),
        status: 'synced',
        conflicts: conflicts.length
      });
      
    } catch (error) {
      console.error(`Failed to sync entity ${entityId}:`, error);
      
      // Update sync status with error
      this.syncStatus.set(entityId, {
        lastSync: Date.now(),
        status: 'error',
        error: error.message
      });
    }
  }

  async detectConflicts(entityId, currentState) {
    const conflicts = [];
    
    try {
      // Check for concurrent modifications using vector clocks
      if (this.config.vectorClockEnabled && currentState.vectorClock) {
        const remoteStates = await this.getRemoteStates(entityId);
        
        for (const remoteState of remoteStates) {
          if (this.hasConflict(currentState.vectorClock, remoteState.vectorClock)) {
            conflicts.push({
              entityId,
              localState: currentState,
              remoteState,
              conflictType: 'concurrent_modification',
              detectedAt: Date.now()
            });
          }
        }
      }
      
      // Check for version conflicts
      const remoteVersions = await this.getRemoteVersions(entityId);
      for (const [nodeId, version] of Object.entries(remoteVersions)) {
        if (version > currentState.version) {
          conflicts.push({
            entityId,
            localVersion: currentState.version,
            remoteVersion: version,
            remoteNode: nodeId,
            conflictType: 'version_mismatch',
            detectedAt: Date.now()
          });
        }
      }
      
    } catch (error) {
      console.error(`Failed to detect conflicts for entity ${entityId}:`, error);
    }
    
    return conflicts;
  }

  hasConflict(localClock, remoteClock) {
    if (!localClock || !remoteClock) return false;
    
    // Two vector clocks are in conflict if neither dominates the other
    let localDominates = false;
    let remoteDominates = false;
    
    const allNodes = new Set([...Object.keys(localClock), ...Object.keys(remoteClock)]);
    
    for (const node of allNodes) {
      const localValue = localClock[node] || 0;
      const remoteValue = remoteClock[node] || 0;
      
      if (localValue > remoteValue) {
        localDominates = true;
      } else if (remoteValue > localValue) {
        remoteDominates = true;
      }
    }
    
    // Conflict if both clocks dominate in different dimensions
    return localDominates && remoteDominates;
  }

  async getRemoteStates(entityId) {
    // Implementation would fetch states from secondary stores
    // Simplified for this example
    return [];
  }

  async getRemoteVersions(entityId) {
    // Implementation would fetch versions from secondary stores
    // Simplified for this example
    return {};
  }

  queueConflict(conflict) {
    const conflictId = this.generateConflictId();
    this.conflictQueue.set(conflictId, {
      ...conflict,
      id: conflictId,
      status: 'pending',
      attempts: 0
    });
  }

  generateConflictId() {
    const timestamp = Date.now();
    const random = crypto.randomBytes(4).toString('hex');
    return `conflict_${timestamp}_${random}`;
  }

  async syncToSecondaryStores(entityId, state) {
    const syncPromises = [];
    
    for (const store of this.config.secondaryStores) {
      syncPromises.push(this.syncToStore(store, entityId, state));
    }
    
    await Promise.allSettled(syncPromises);
  }

  async syncToStore(store, entityId, state) {
    // Implementation would sync to specific storage backend
    // This would be customized based on the store type (database, cache, etc.)
    console.log(`Syncing entity ${entityId} to store ${store}`);
  }

  async resolveConflicts() {
    const conflictIds = Array.from(this.conflictQueue.keys());
    
    for (const conflictId of conflictIds) {
      try {
        await this.resolveConflict(conflictId);
      } catch (error) {
        console.error(`Failed to resolve conflict ${conflictId}:`, error);
      }
    }
  }

  async resolveConflict(conflictId) {
    const conflict = this.conflictQueue.get(conflictId);
    if (!conflict) return;
    
    conflict.attempts++;
    
    try {
      let resolution;
      
      switch (this.config.conflictResolution) {
        case 'last_write_wins':
          resolution = await this.lastWriteWinsResolution(conflict);
          break;
        case 'first_write_wins':
          resolution = await this.firstWriteWinsResolution(conflict);
          break;
        case 'vector_clock':
          resolution = await this.vectorClockResolution(conflict);
          break;
        case 'merge':
          resolution = await this.mergeResolution(conflict);
          break;
        case 'custom':
          resolution = await this.customResolution(conflict);
          break;
        default:
          throw new Error(`Unknown conflict resolution strategy: ${this.config.conflictResolution}`);
      }
      
      // Apply resolution
      await this.applyResolution(conflict.entityId, resolution);
      
      // Remove from queue
      this.conflictQueue.delete(conflictId);
      
      // Update performance stats
      this.performanceStats.conflictsResolved++;
      
      this.emit('conflict_resolved', {
        conflictId,
        entityId: conflict.entityId,
        resolution: this.config.conflictResolution,
        attempts: conflict.attempts
      });
      
    } catch (error) {
      console.error(`Failed to resolve conflict ${conflictId}:`, error);
      
      // Remove after max attempts
      if (conflict.attempts >= 5) {
        this.conflictQueue.delete(conflictId);
        this.emit('conflict_resolution_failed', {
          conflictId,
          entityId: conflict.entityId,
          error: error.message
        });
      }
    }
  }

  async lastWriteWinsResolution(conflict) {
    // Use the state with the latest timestamp
    if (conflict.localState.lastUpdated > conflict.remoteState.lastUpdated) {
      return conflict.localState;
    } else {
      return conflict.remoteState;
    }
  }

  async firstWriteWinsResolution(conflict) {
    // Use the state with the earliest timestamp
    if (conflict.localState.lastUpdated < conflict.remoteState.lastUpdated) {
      return conflict.localState;
    } else {
      return conflict.remoteState;
    }
  }

  async vectorClockResolution(conflict) {
    // Use vector clock to determine causality
    const localClock = conflict.localState.vectorClock;
    const remoteClock = conflict.remoteState.vectorClock;
    
    if (this.dominates(localClock, remoteClock)) {
      return conflict.localState;
    } else if (this.dominates(remoteClock, localClock)) {
      return conflict.remoteState;
    } else {
      // Concurrent modifications - fallback to last write wins
      return this.lastWriteWinsResolution(conflict);
    }
  }

  dominates(clock1, clock2) {
    if (!clock1 || !clock2) return false;
    
    let dominates = false;
    const allNodes = new Set([...Object.keys(clock1), ...Object.keys(clock2)]);
    
    for (const node of allNodes) {
      const value1 = clock1[node] || 0;
      const value2 = clock2[node] || 0;
      
      if (value1 < value2) {
        return false; // clock1 does not dominate
      } else if (value1 > value2) {
        dominates = true;
      }
    }
    
    return dominates;
  }

  async mergeResolution(conflict) {
    // Merge the two states
    const mergedState = {
      ...conflict.localState,
      data: {
        ...conflict.remoteState.data,
        ...conflict.localState.data
      },
      version: Math.max(conflict.localState.version, conflict.remoteState.version) + 1,
      lastUpdated: Date.now()
    };
    
    return mergedState;
  }

  async customResolution(conflict) {
    // Custom resolution logic would be implemented here
    // For now, fallback to last write wins
    return this.lastWriteWinsResolution(conflict);
  }

  async applyResolution(entityId, resolvedState) {
    // Update local state
    this.entityStates.set(entityId, resolvedState);
    
    // Persist resolved state
    await this.persistEntityState(entityId, resolvedState);
    
    // Sync to secondary stores
    await this.syncToSecondaryStores(entityId, resolvedState);
  }

  async loadPendingStates() {
    try {
      // Load entity states from Redis
      const states = await this.redis.hGetAll(`${this.config.keyPrefix}states`);
      let loadedCount = 0;
      
      for (const [entityId, stateData] of Object.entries(states)) {
        try {
          const decryptedData = this.config.encryptionEnabled ? 
            this.decryptData(stateData) : stateData;
          const state = JSON.parse(decryptedData);
          
          this.entityStates.set(entityId, state);
          loadedCount++;
        } catch (error) {
          console.error(`Failed to load state for entity ${entityId}:`, error);
        }
      }
      
      console.log(`Loaded ${loadedCount} entity states`);
      
    } catch (error) {
      console.error('Failed to load pending states:', error);
    }
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
      await this.metrics.setGauge('ec.events_processed', this.performanceStats.eventsProcessed, {}, 'consistency');
      await this.metrics.setGauge('ec.sync_operations', this.performanceStats.syncOperations, {}, 'consistency');
      await this.metrics.setGauge('ec.conflicts_resolved', this.performanceStats.conflictsResolved, {}, 'consistency');
      await this.metrics.setGauge('ec.consistency_rate', this.performanceStats.consistencyRate, {}, 'consistency');
      await this.metrics.setGauge('ec.pending_syncs', this.performanceStats.pendingSyncs, {}, 'consistency');
      await this.metrics.setGauge('ec.average_sync_time', this.performanceStats.averageSyncTime, {}, 'consistency');
      
    } catch (error) {
      console.error('Failed to update performance metrics:', error);
    }
  }

  getEntityState(entityId) {
    return this.entityStates.get(entityId);
  }

  getSyncStatus(entityId) {
    return this.syncStatus.get(entityId);
  }

  getSystemStatus() {
    return {
      isRunning: this.isRunning,
      totalEntities: this.entityStates.size,
      pendingConflicts: this.conflictQueue.size,
      performanceStats: this.performanceStats,
      syncQueues: Object.fromEntries(
        Array.from(this.syncQueues.entries()).map(([category, queue]) => [
          category, { size: queue.length }
        ])
      )
    };
  }

  stop() {
    if (!this.isRunning) return;
    
    console.log('🛑 Stopping Eventual Consistency Manager...');
    
    // Stop intervals
    if (this.syncInterval) clearInterval(this.syncInterval);
    if (this.conflictResolutionInterval) clearInterval(this.conflictResolutionInterval);
    if (this.performanceInterval) clearInterval(this.performanceInterval);
    
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
    this.lastSyncTimes.clear();
    
    this.isRunning = false;
    console.log('✅ Eventual Consistency Manager stopped');
  }
}

module.exports = EventualConsistencyManager;