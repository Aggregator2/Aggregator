const EventEmitter = require('events');
const crypto = require('crypto');
const { getSecureMetricsCollector } = require('../monitoring/secure-metrics-collector');

/**
 * Secure System Status Notification Feed
 * Provides real-time system status updates with enhanced security and access control
 */
class SecureSystemStatusFeed extends EventEmitter {
  constructor(config = {}) {
    super();
    
    // Validate configuration
    this.validateConfig(config);
    
    this.config = {
      updateInterval: Math.max(config.updateInterval || 5000, 1000), // Min 1 second
      enableHealthChecks: config.enableHealthChecks !== false,
      enableMaintenanceNotifications: config.enableMaintenanceNotifications !== false,
      enablePerformanceMetrics: config.enablePerformanceMetrics !== false,
      healthCheckInterval: Math.max(config.healthCheckInterval || 30000, 5000), // Min 5 seconds
      maintenanceCheckInterval: Math.max(config.maintenanceCheckInterval || 60000, 10000), // Min 10 seconds
      alertRetention: Math.min(config.alertRetention || 86400000, 7 * 86400000), // Max 7 days
      maxAlertsPerType: Math.min(config.maxAlertsPerType || 1000, 10000),
      maxSubscriptionsPerUser: Math.min(config.maxSubscriptionsPerUser || 10, 100),
      encryptionKey: config.encryptionKey, // Required for secure operations
      enableAccessControl: config.enableAccessControl !== false,
      enableAuditLogging: config.enableAuditLogging !== false,
      ...config
    };
    
    this.metrics = getSecureMetricsCollector();
    this.webSocketManager = null;
    
    // System status tracking with security
    this.systemStatus = {
      overall: 'operational', // operational, degraded, down
      services: new Map(), // service -> status
      lastUpdate: Date.now(),
      uptime: process.uptime(),
      version: process.env.APP_VERSION || '1.0.0'
    };
    
    // Component health monitoring
    this.healthChecks = new Map(); // component -> health data
    this.performanceMetrics = new Map(); // metric -> value
    this.maintenanceSchedule = new Map(); // maintenanceId -> maintenance data
    
    // Alert management with bounded collections
    this.activeAlerts = new LRUCache(this.config.maxAlertsPerType * 10);
    this.alertHistory = new LRUCache(this.config.maxAlertsPerType * 20);
    this.alertSubscriptions = new Map(); // subscriptionKey -> subscription details
    
    // Subscription management with access control
    this.userSubscriptions = new Map(); // userId -> Set of subscription keys
    this.connectionSubscriptions = new Map(); // connectionId -> subscription data
    this.userSubscriptionCounts = new Map(); // userId -> count
    
    // Security controls
    this.securityConfig = {
      maxConcurrentOperations: 50,
      enableStrictAccessControl: true,
      adminOnlyComponents: ['database', 'security', 'authentication'],
      publicComponents: ['api', 'frontend', 'general'],
      enableDataSanitization: true,
      auditSystemAccess: true,
      enableRateLimiting: true,
      maxUpdatesPerSecond: 100,
      hashAlgorithm: 'sha256'
    };
    
    // Status levels and their permissions
    this.statusLevels = {
      PUBLIC: 'public',           // Basic system status
      OPERATIONAL: 'operational', // Service status
      DETAILED: 'detailed',       // Performance metrics
      ADMIN: 'admin'             // Full system diagnostics
    };
    
    // Permission matrix for different status levels
    this.permissionMatrix = {
      [this.statusLevels.PUBLIC]: [],
      [this.statusLevels.OPERATIONAL]: ['read_system_status'],
      [this.statusLevels.DETAILED]: ['read_detailed_status'],
      [this.statusLevels.ADMIN]: ['admin', 'read_admin_status']
    };
    
    // Alert severity levels
    this.alertSeverity = {
      INFO: 'info',
      WARNING: 'warning',
      ERROR: 'error',
      CRITICAL: 'critical'
    };
    
    // Performance and security tracking
    this.performanceStats = {
      statusUpdatesProcessed: 0,
      statusUpdatesSent: 0,
      alertsGenerated: 0,
      alertsSent: 0,
      subscriptionsActive: 0,
      healthChecksPerformed: 0,
      avgResponseTime: 0,
      securityViolations: 0,
      accessDenied: 0,
      dataAccessLogged: 0,
      sanitizedResponses: 0
    };
    
    // Input validation schemas
    this.validationSchemas = {
      statusUpdate: {
        component: { type: 'string', maxLength: 100, required: true },
        status: { type: 'string', enum: ['operational', 'degraded', 'down'], required: true },
        message: { type: 'string', maxLength: 500 },
        severity: { type: 'string', enum: Object.values(this.alertSeverity) },
        timestamp: { type: 'number', min: 0, required: true }
      },
      subscriptionParams: {
        statusLevel: { type: 'string', enum: Object.values(this.statusLevels) },
        components: { type: 'array', maxItems: 20 },
        alertTypes: { type: 'array', maxItems: 10 }
      }
    };
    
    // Active operations tracking
    this.activeOperations = new Set();
    this.accessLog = new LRUCache(10000);
    
    // Rate limiting
    this.updateRateLimiter = {
      windowMs: 1000,
      maxUpdates: this.securityConfig.maxUpdatesPerSecond,
      currentWindow: Math.floor(Date.now() / 1000),
      currentCount: 0
    };
    
    this.startSecureStatusMonitoring();
    this.startSecureHealthChecks();
    this.startMaintenanceMonitoring();
    this.startSecurityMonitoring();
    this.startCleanupTask();
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
  }
  
  /**
   * Initialize with WebSocket manager
   */
  initialize(webSocketManager) {
    this.webSocketManager = webSocketManager;
    
    this.webSocketManager.on('subscribed', (event) => {
      try {
        if (event.channel === 'system_status') {
          this.handleSecureSystemStatusSubscription(event);
        }
      } catch (error) {
        this.handleSecurityViolation('subscription_error', error, event);
      }
    });
    
    this.webSocketManager.on('unsubscribed', (event) => {
      if (event.channel === 'system_status') {
        this.handleUnsubscription(event);
      }
    });
    
    this.webSocketManager.on('disconnection', (event) => {
      this.handleDisconnection(event);
    });
  }
  
  /**
   * Secure system status update with validation
   */
  updateSystemStatus(statusUpdate) {
    const operationId = crypto.randomBytes(8).toString('hex');
    
    try {
      // Rate limiting check
      if (!this.checkUpdateRateLimit()) {
        throw new SecurityError('Update rate limit exceeded');
      }
      
      // Check concurrent operations
      if (this.activeOperations.size >= this.securityConfig.maxConcurrentOperations) {
        throw new SecurityError('Maximum concurrent operations exceeded');
      }
      
      this.activeOperations.add(operationId);
      const startTime = Date.now();
      
      // Validate and sanitize status update
      const sanitizedUpdate = this.validateAndSanitizeStatusUpdate(statusUpdate);
      
      // Update system status securely
      this.secureUpdateSystemStatus(sanitizedUpdate);
      
      // Generate alerts if necessary
      this.processStatusChangeAlerts(sanitizedUpdate);
      
      // Broadcast to subscribers
      this.broadcastSecureStatusUpdate(sanitizedUpdate);
      
      // Log system access for audit
      this.logSystemStatusAccess('status_update', sanitizedUpdate.component);
      
      this.performanceStats.statusUpdatesProcessed++;
      this.performanceStats.avgResponseTime = this.updateAverage(
        this.performanceStats.avgResponseTime,
        Date.now() - startTime,
        this.performanceStats.statusUpdatesProcessed
      );
      
      this.emit('system_status_updated', {
        component: sanitizedUpdate.component,
        status: sanitizedUpdate.status,
        timestamp: sanitizedUpdate.timestamp,
        operationId: operationId
      });
      
    } catch (error) {
      this.handleStatusUpdateError(error, statusUpdate, operationId);
      throw error;
    } finally {
      this.activeOperations.delete(operationId);
    }
  }
  
  /**
   * Validate and sanitize status update
   */
  validateAndSanitizeStatusUpdate(statusUpdate) {
    // Validate against schema
    for (const [field, schema] of Object.entries(this.validationSchemas.statusUpdate)) {
      if (!this.validateField(statusUpdate[field], schema)) {
        if (schema.required) {
          throw new SecurityError(`Invalid ${field} in status update`);
        }
      }
    }
    
    // Sanitize and normalize
    const sanitized = {
      component: this.sanitizeString(statusUpdate.component).toLowerCase(),
      status: this.sanitizeString(statusUpdate.status).toLowerCase(),
      message: this.sanitizeString(statusUpdate.message || ''),
      severity: this.sanitizeString(statusUpdate.severity || this.alertSeverity.INFO).toLowerCase(),
      timestamp: this.validateTimestamp(statusUpdate.timestamp),
      metadata: this.sanitizeMetadata(statusUpdate.metadata || {})
    };
    
    // Business rule validation
    this.validateStatusBusinessRules(sanitized);
    
    return sanitized;
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
    
    if (schema.enum && !schema.enum.includes(value)) {
      return false;
    }
    
    if (schema.min !== undefined && value < schema.min) {
      return false;
    }
    
    if (schema.maxItems && Array.isArray(value) && value.length > schema.maxItems) {
      return false;
    }
    
    return true;
  }
  
  /**
   * Sanitize string input
   */
  sanitizeString(str) {
    if (typeof str !== 'string') return '';
    
    return str
      .replace(/[<>\"'&]/g, '')
      .replace(/\${.*?}/g, '')
      .replace(/javascript:/gi, '')
      .replace(/(__proto__|constructor|prototype)/gi, '')
      .trim();
  }
  
  /**
   * Validate timestamp
   */
  validateTimestamp(timestamp) {
    const ts = parseInt(timestamp);
    const now = Date.now();
    
    if (isNaN(ts) || ts < now - 3600000 || ts > now + 3600000) {
      return now;
    }
    
    return ts;
  }
  
  /**
   * Sanitize metadata object
   */
  sanitizeMetadata(metadata) {
    const sanitized = {};
    const maxFields = 5;
    let fieldCount = 0;
    
    for (const [key, value] of Object.entries(metadata)) {
      if (fieldCount >= maxFields) break;
      
      const cleanKey = this.sanitizeString(key);
      if (cleanKey.length > 0 && cleanKey.length <= 20) {
        if (typeof value === 'string') {
          sanitized[cleanKey] = this.sanitizeString(value);
        } else if (typeof value === 'number' && isFinite(value)) {
          sanitized[cleanKey] = value;
        }
        fieldCount++;
      }
    }
    
    return sanitized;
  }
  
  /**
   * Validate status business rules
   */
  validateStatusBusinessRules(statusUpdate) {
    // Validate component name
    const allowedComponents = [
      'api', 'database', 'frontend', 'authentication', 'matching_engine',
      'settlement', 'risk_management', 'monitoring', 'security', 'general'
    ];
    
    if (!allowedComponents.includes(statusUpdate.component)) {
      throw new SecurityError('Invalid component name');
    }
    
    // Validate status transitions
    const currentStatus = this.systemStatus.services.get(statusUpdate.component);
    if (currentStatus && !this.isValidStatusTransition(currentStatus.status, statusUpdate.status)) {
      throw new SecurityError('Invalid status transition');
    }
  }
  
  /**
   * Check if status transition is valid
   */
  isValidStatusTransition(currentStatus, newStatus) {
    // Define valid transitions
    const validTransitions = {
      'operational': ['degraded', 'down'],
      'degraded': ['operational', 'down'],
      'down': ['degraded', 'operational']
    };
    
    return !currentStatus || 
           currentStatus === newStatus || 
           validTransitions[currentStatus]?.includes(newStatus);
  }
  
  /**
   * Secure update system status
   */
  secureUpdateSystemStatus(statusUpdate) {
    const component = statusUpdate.component;
    const status = statusUpdate.status;
    
    // Update service status
    this.systemStatus.services.set(component, {
      status: status,
      message: statusUpdate.message,
      lastUpdate: statusUpdate.timestamp,
      severity: statusUpdate.severity,
      metadata: statusUpdate.metadata
    });
    
    // Update overall system status
    this.calculateOverallSystemStatus();
    
    this.systemStatus.lastUpdate = Date.now();
  }
  
  /**
   * Calculate overall system status
   */
  calculateOverallSystemStatus() {
    const statuses = Array.from(this.systemStatus.services.values());
    
    if (statuses.some(s => s.status === 'down')) {
      this.systemStatus.overall = 'down';
    } else if (statuses.some(s => s.status === 'degraded')) {
      this.systemStatus.overall = 'degraded';
    } else {
      this.systemStatus.overall = 'operational';
    }
  }
  
  /**
   * Process status change alerts
   */
  processStatusChangeAlerts(statusUpdate) {
    const severity = statusUpdate.severity;
    const alertThresholds = [this.alertSeverity.WARNING, this.alertSeverity.ERROR, this.alertSeverity.CRITICAL];
    
    if (alertThresholds.includes(severity)) {
      this.generateSecureAlert({
        type: 'status_change',
        component: statusUpdate.component,
        status: statusUpdate.status,
        severity: severity,
        message: statusUpdate.message,
        timestamp: statusUpdate.timestamp,
        metadata: statusUpdate.metadata
      });
    }
  }
  
  /**
   * Generate secure alert
   */
  generateSecureAlert(alertData) {
    const alertId = crypto.randomBytes(16).toString('hex');
    
    const alert = {
      id: alertId,
      type: alertData.type,
      component: alertData.component,
      severity: alertData.severity,
      message: alertData.message,
      timestamp: alertData.timestamp || Date.now(),
      resolved: false,
      metadata: alertData.metadata || {}
    };
    
    // Store alert
    this.activeAlerts.set(alertId, alert);
    
    // Add to history
    let history = this.alertHistory.get(alert.type) || [];
    history.push(alert);
    if (history.length > this.config.maxAlertsPerType) {
      history = history.slice(-this.config.maxAlertsPerType);
    }
    this.alertHistory.set(alert.type, history);
    
    this.performanceStats.alertsGenerated++;
    
    // Broadcast alert to subscribers
    this.broadcastSecureAlert(alert);
    
    this.emit('alert_generated', {
      alertId: alertId,
      type: alert.type,
      severity: alert.severity,
      component: alert.component
    });
  }
  
  /**
   * Handle secure system status subscription
   */
  handleSecureSystemStatusSubscription(event) {
    const { connectionId, params } = event;
    
    // Get connection for authorization
    const connection = this.webSocketManager.connections?.get(connectionId);
    if (!connection || !connection.authenticated) {
      throw new SecurityError('Unauthenticated connection');
    }
    
    // Validate subscription parameters
    this.validateSubscriptionParams(params);
    
    const { 
      statusLevel = this.statusLevels.PUBLIC,
      components = [],
      alertTypes = []
    } = params;
    
    // Check authorization for status level
    this.validateStatusLevelAuthorization(connection, statusLevel);
    
    // Check subscription limits
    this.checkUserSubscriptionLimits(connection.userId);
    
    // Generate secure subscription key
    const subscriptionKey = this.generateSecureSubscriptionKey(connectionId, statusLevel);
    
    // Store subscription with security metadata
    this.connectionSubscriptions.set(connectionId, {
      subscriptionKey: subscriptionKey,
      userId: connection.userId,
      statusLevel: statusLevel,
      components: this.sanitizeComponentList(components),
      alertTypes: this.sanitizeAlertTypes(alertTypes),
      subscribedAt: Date.now(),
      accessCount: 0,
      permissions: connection.metadata?.permissions || [],
      roles: connection.metadata?.roles || []
    });
    
    // Store in alert subscriptions
    this.alertSubscriptions.set(subscriptionKey, {
      connectionId: connectionId,
      userId: connection.userId,
      statusLevel: statusLevel,
      components: this.sanitizeComponentList(components),
      alertTypes: this.sanitizeAlertTypes(alertTypes)
    });
    
    // Track user subscriptions
    this.addUserSubscription(connection.userId, subscriptionKey);
    
    // Update subscription count
    const currentCount = this.userSubscriptionCounts.get(connection.userId) || 0;
    this.userSubscriptionCounts.set(connection.userId, currentCount + 1);
    
    this.performanceStats.subscriptionsActive++;
    
    // Log subscription for audit
    this.logSubscriptionEvent(connection.userId, statusLevel, components);
    
    // Send current system status
    this.sendSecureCurrentStatus(connectionId, statusLevel);
    
    this.emit('system_status_subscription_added', {
      subscriptionKey,
      connectionId,
      userId: connection.userId,
      statusLevel: statusLevel
    });
  }
  
  /**
   * Validate status level authorization
   */
  validateStatusLevelAuthorization(connection, statusLevel) {
    const requiredPermissions = this.permissionMatrix[statusLevel];
    if (!requiredPermissions) {
      throw new SecurityError('Invalid status level');
    }
    
    if (requiredPermissions.length === 0) {
      return; // Public access
    }
    
    const userPermissions = connection.metadata?.permissions || [];
    const userRoles = connection.metadata?.roles || [];
    
    const hasPermission = requiredPermissions.some(permission => 
      userPermissions.includes(permission) || userRoles.includes(permission)
    );
    
    if (!hasPermission) {
      this.performanceStats.accessDenied++;
      throw new SecurityError('Insufficient permissions for status level');
    }
  }
  
  /**
   * Check user subscription limits
   */
  checkUserSubscriptionLimits(userId) {
    const currentCount = this.userSubscriptionCounts.get(userId) || 0;
    if (currentCount >= this.config.maxSubscriptionsPerUser) {
      throw new SecurityError('Maximum subscriptions per user exceeded');
    }
  }
  
  /**
   * Validate subscription parameters
   */
  validateSubscriptionParams(params) {
    for (const [field, schema] of Object.entries(this.validationSchemas.subscriptionParams)) {
      if (params[field] && !this.validateField(params[field], schema)) {
        throw new SecurityError(`Invalid ${field} in subscription parameters`);
      }
    }
  }
  
  /**
   * Sanitize component list
   */
  sanitizeComponentList(components) {
    if (!Array.isArray(components)) return [];
    
    const allowedComponents = [
      'api', 'database', 'frontend', 'authentication', 'matching_engine',
      'settlement', 'risk_management', 'monitoring', 'security', 'general'
    ];
    
    return components
      .filter(comp => typeof comp === 'string')
      .map(comp => this.sanitizeString(comp).toLowerCase())
      .filter(comp => allowedComponents.includes(comp))
      .slice(0, 20); // Limit to 20 components
  }
  
  /**
   * Sanitize alert types
   */
  sanitizeAlertTypes(alertTypes) {
    if (!Array.isArray(alertTypes)) return [];
    
    const allowedTypes = ['status_change', 'performance', 'security', 'maintenance', 'system'];
    
    return alertTypes
      .filter(type => typeof type === 'string')
      .map(type => this.sanitizeString(type).toLowerCase())
      .filter(type => allowedTypes.includes(type))
      .slice(0, 10); // Limit to 10 alert types
  }
  
  /**
   * Add user subscription
   */
  addUserSubscription(userId, subscriptionKey) {
    let userSubs = this.userSubscriptions.get(userId);
    if (!userSubs) {
      userSubs = new Set();
      this.userSubscriptions.set(userId, userSubs);
    }
    
    userSubs.add(subscriptionKey);
  }
  
  /**
   * Send secure current status
   */
  sendSecureCurrentStatus(connectionId, statusLevel) {
    try {
      const subscription = this.connectionSubscriptions.get(connectionId);
      if (!subscription) return;
      
      // Filter system status based on authorization level
      const filteredStatus = this.filterSystemStatusForLevel(statusLevel, subscription);
      
      const message = {
        type: 'system_status_snapshot',
        data: filteredStatus,
        timestamp: Date.now()
      };
      
      this.webSocketManager.sendToConnection(connectionId, message);
      
      subscription.accessCount++;
      this.performanceStats.sanitizedResponses++;
      this.logSystemStatusAccess('status_snapshot', 'system');
      
    } catch (error) {
      this.handleSecurityViolation('send_status_error', error, { connectionId, statusLevel });
    }
  }
  
  /**
   * Filter system status based on authorization level
   */
  filterSystemStatusForLevel(statusLevel, subscription) {
    const filtered = {
      overall: this.systemStatus.overall,
      lastUpdate: this.systemStatus.lastUpdate
    };
    
    // Add data based on authorization level
    switch (statusLevel) {
      case this.statusLevels.PUBLIC:
        filtered.uptime = this.systemStatus.uptime;
        break;
        
      case this.statusLevels.OPERATIONAL:
        filtered.uptime = this.systemStatus.uptime;
        filtered.services = this.filterServices(subscription, false);
        break;
        
      case this.statusLevels.DETAILED:
        filtered.uptime = this.systemStatus.uptime;
        filtered.version = this.systemStatus.version;
        filtered.services = this.filterServices(subscription, true);
        filtered.performance = this.getFilteredPerformanceMetrics();
        break;
        
      case this.statusLevels.ADMIN:
        filtered.uptime = this.systemStatus.uptime;
        filtered.version = this.systemStatus.version;
        filtered.services = this.getAllServices();
        filtered.performance = this.getAllPerformanceMetrics();
        filtered.health = this.getHealthCheckData();
        break;
    }
    
    return filtered;
  }
  
  /**
   * Filter services based on subscription and authorization
   */
  filterServices(subscription, includeDetails) {
    const filtered = {};
    const allowedComponents = subscription.components.length > 0 ? 
      subscription.components : 
      this.securityConfig.publicComponents;
    
    for (const [component, status] of this.systemStatus.services) {
      if (allowedComponents.includes(component)) {
        filtered[component] = {
          status: status.status,
          lastUpdate: status.lastUpdate
        };
        
        if (includeDetails) {
          filtered[component].message = status.message;
          filtered[component].severity = status.severity;
        }
      }
    }
    
    return filtered;
  }
  
  /**
   * Get all services (admin only)
   */
  getAllServices() {
    const services = {};
    
    for (const [component, status] of this.systemStatus.services) {
      services[component] = {
        status: status.status,
        message: status.message,
        severity: status.severity,
        lastUpdate: status.lastUpdate,
        metadata: status.metadata
      };
    }
    
    return services;
  }
  
  /**
   * Get filtered performance metrics
   */
  getFilteredPerformanceMetrics() {
    const publicMetrics = ['response_time', 'throughput', 'active_connections'];
    const filtered = {};
    
    for (const metric of publicMetrics) {
      const value = this.performanceMetrics.get(metric);
      if (value !== undefined) {
        filtered[metric] = value;
      }
    }
    
    return filtered;
  }
  
  /**
   * Get all performance metrics (admin only)
   */
  getAllPerformanceMetrics() {
    const metrics = {};
    
    for (const [metric, value] of this.performanceMetrics) {
      metrics[metric] = value;
    }
    
    return metrics;
  }
  
  /**
   * Get health check data (admin only)
   */
  getHealthCheckData() {
    const healthData = {};
    
    for (const [component, health] of this.healthChecks) {
      healthData[component] = {
        status: health.status,
        lastCheck: health.lastCheck,
        responseTime: health.responseTime,
        checks: health.checks || {}
      };
    }
    
    return healthData;
  }
  
  /**
   * Broadcast secure status update
   */
  broadcastSecureStatusUpdate(statusUpdate) {
    for (const [connectionId, subscription] of this.connectionSubscriptions) {
      try {
        // Check if subscription is interested in this component
        if (this.isSubscriptionInterestedInComponent(subscription, statusUpdate.component)) {
          const filteredUpdate = this.filterStatusUpdateForSubscription(statusUpdate, subscription);
          
          const message = {
            type: 'system_status_update',
            data: filteredUpdate,
            timestamp: Date.now()
          };
          
          this.webSocketManager.sendToConnection(connectionId, message);
          subscription.accessCount++;
          this.performanceStats.statusUpdatesSent++;
        }
      } catch (error) {
        this.handleSecurityViolation('broadcast_status_error', error, { connectionId });
      }
    }
  }
  
  /**
   * Check if subscription is interested in component
   */
  isSubscriptionInterestedInComponent(subscription, component) {
    // If no specific components requested, include public components
    if (subscription.components.length === 0) {
      return this.securityConfig.publicComponents.includes(component);
    }
    
    return subscription.components.includes(component);
  }
  
  /**
   * Filter status update for subscription
   */
  filterStatusUpdateForSubscription(statusUpdate, subscription) {
    const filtered = {
      component: statusUpdate.component,
      status: statusUpdate.status,
      timestamp: statusUpdate.timestamp
    };
    
    // Add details based on status level
    if (subscription.statusLevel === this.statusLevels.DETAILED || 
        subscription.statusLevel === this.statusLevels.ADMIN) {
      filtered.message = statusUpdate.message;
      filtered.severity = statusUpdate.severity;
    }
    
    if (subscription.statusLevel === this.statusLevels.ADMIN) {
      filtered.metadata = statusUpdate.metadata;
    }
    
    return filtered;
  }
  
  /**
   * Broadcast secure alert
   */
  broadcastSecureAlert(alert) {
    for (const [subscriptionKey, subscription] of this.alertSubscriptions) {
      try {
        // Check if subscription is interested in this alert
        if (this.isSubscriptionInterestedInAlert(subscription, alert)) {
          const filteredAlert = this.filterAlertForSubscription(alert, subscription);
          
          const message = {
            type: 'system_alert',
            data: filteredAlert,
            timestamp: Date.now()
          };
          
          this.webSocketManager.sendToConnection(subscription.connectionId, message);
          this.performanceStats.alertsSent++;
        }
      } catch (error) {
        this.handleSecurityViolation('broadcast_alert_error', error, { subscriptionKey });
      }
    }
  }
  
  /**
   * Check if subscription is interested in alert
   */
  isSubscriptionInterestedInAlert(subscription, alert) {
    // Check component filter
    if (subscription.components.length > 0 && 
        !subscription.components.includes(alert.component)) {
      return false;
    }
    
    // Check alert type filter
    if (subscription.alertTypes.length > 0 && 
        !subscription.alertTypes.includes(alert.type)) {
      return false;
    }
    
    return true;
  }
  
  /**
   * Filter alert for subscription
   */
  filterAlertForSubscription(alert, subscription) {
    const connectionSub = this.connectionSubscriptions.get(subscription.connectionId);
    if (!connectionSub) return alert;
    
    const filtered = {
      id: alert.id,
      type: alert.type,
      component: alert.component,
      severity: alert.severity,
      message: alert.message,
      timestamp: alert.timestamp,
      resolved: alert.resolved
    };
    
    // Add metadata for admin level
    if (connectionSub.statusLevel === this.statusLevels.ADMIN) {
      filtered.metadata = alert.metadata;
    }
    
    return filtered;
  }
  
  /**
   * Check update rate limit
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
   * Generate secure subscription key
   */
  generateSecureSubscriptionKey(...parts) {
    const data = parts.join(':') + ':' + Date.now() + ':' + crypto.randomBytes(8).toString('hex');
    return crypto.createHmac('sha256', this.config.encryptionKey)
      .update(data)
      .digest('hex')
      .substring(0, 32);
  }
  
  /**
   * Log subscription event
   */
  logSubscriptionEvent(userId, statusLevel, components) {
    if (!this.config.enableAuditLogging) return;
    
    const logEntry = {
      timestamp: Date.now(),
      event: 'system_status_subscription',
      userId: userId,
      statusLevel: statusLevel,
      components: components
    };
    
    this.accessLog.set(crypto.randomBytes(8).toString('hex'), logEntry);
    this.performanceStats.dataAccessLogged++;
  }
  
  /**
   * Log system status access
   */
  logSystemStatusAccess(operation, component) {
    if (!this.config.enableAuditLogging) return;
    
    const logEntry = {
      timestamp: Date.now(),
      event: 'system_status_access',
      operation: operation,
      component: component
    };
    
    this.accessLog.set(crypto.randomBytes(8).toString('hex'), logEntry);
    this.performanceStats.dataAccessLogged++;
  }
  
  /**
   * Handle security violations
   */
  handleSecurityViolation(type, error, context) {
    this.performanceStats.securityViolations++;
    
    this.emit('security_violation', {
      type: type,
      error: error.message,
      context: context,
      timestamp: Date.now()
    });
  }
  
  /**
   * Handle status update errors
   */
  handleStatusUpdateError(error, statusUpdate, operationId) {
    this.performanceStats.securityViolations++;
    
    this.emit('status_update_error', {
      error: error.message,
      statusUpdate: this.sanitizeErrorContext(statusUpdate),
      operationId: operationId,
      timestamp: Date.now()
    });
  }
  
  /**
   * Sanitize error context
   */
  sanitizeErrorContext(context) {
    if (!context) return {};
    
    return {
      component: context.component || 'unknown',
      status: context.status || 'unknown',
      timestamp: context.timestamp || Date.now()
    };
  }
  
  /**
   * Start secure status monitoring
   */
  startSecureStatusMonitoring() {
    setInterval(() => {
      try {
        this.updateSystemMetrics();
      } catch (error) {
        this.handleSecurityViolation('metrics_update_error', error);
      }
    }, this.config.updateInterval);
  }
  
  /**
   * Update system metrics
   */
  updateSystemMetrics() {
    // Update basic performance metrics
    this.performanceMetrics.set('uptime', process.uptime());
    this.performanceMetrics.set('memory_usage', process.memoryUsage().heapUsed);
    this.performanceMetrics.set('active_connections', this.connectionSubscriptions.size);
    this.performanceMetrics.set('active_subscriptions', this.performanceStats.subscriptionsActive);
    
    // Update system uptime
    this.systemStatus.uptime = process.uptime();
  }
  
  /**
   * Start secure health checks
   */
  startSecureHealthChecks() {
    if (!this.config.enableHealthChecks) return;
    
    setInterval(() => {
      try {
        this.performHealthChecks();
      } catch (error) {
        this.handleSecurityViolation('health_check_error', error);
      }
    }, this.config.healthCheckInterval);
  }
  
  /**
   * Perform health checks
   */
  performHealthChecks() {
    const components = ['api', 'database', 'frontend', 'authentication'];
    
    for (const component of components) {
      this.performComponentHealthCheck(component);
    }
    
    this.performanceStats.healthChecksPerformed++;
  }
  
  /**
   * Perform component health check
   */
  performComponentHealthCheck(component) {
    const startTime = Date.now();
    
    // Simulate health check (in production, this would be actual checks)
    const isHealthy = Math.random() > 0.05; // 95% healthy
    const responseTime = Math.random() * 100 + 10; // 10-110ms
    
    const healthData = {
      status: isHealthy ? 'healthy' : 'unhealthy',
      lastCheck: Date.now(),
      responseTime: responseTime,
      checks: {
        connectivity: isHealthy,
        responseTime: responseTime < 100
      }
    };
    
    this.healthChecks.set(component, healthData);
    
    // Update system status if health changed
    if (!isHealthy) {
      this.updateSystemStatus({
        component: component,
        status: 'degraded',
        message: 'Component health check failed',
        severity: this.alertSeverity.WARNING,
        timestamp: Date.now()
      });
    }
  }
  
  /**
   * Start maintenance monitoring
   */
  startMaintenanceMonitoring() {
    if (!this.config.enableMaintenanceNotifications) return;
    
    setInterval(() => {
      try {
        this.checkMaintenanceSchedule();
      } catch (error) {
        this.handleSecurityViolation('maintenance_check_error', error);
      }
    }, this.config.maintenanceCheckInterval);
  }
  
  /**
   * Check maintenance schedule
   */
  checkMaintenanceSchedule() {
    const now = Date.now();
    
    for (const [maintenanceId, maintenance] of this.maintenanceSchedule) {
      if (maintenance.startTime <= now && maintenance.endTime > now && !maintenance.notified) {
        this.generateSecureAlert({
          type: 'maintenance',
          component: maintenance.component || 'system',
          severity: this.alertSeverity.INFO,
          message: maintenance.message || 'Scheduled maintenance in progress',
          timestamp: now,
          metadata: {
            maintenanceId: maintenanceId,
            estimatedDuration: maintenance.endTime - maintenance.startTime
          }
        });
        
        maintenance.notified = true;
      }
    }
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
   * Perform security checks
   */
  performSecurityChecks() {
    // Clean up stale subscriptions
    this.cleanupStaleSubscriptions();
    
    // Monitor resource usage
    this.monitorResourceUsage();
    
    // Clean up old logs and alerts
    this.cleanupSecurityData();
  }
  
  /**
   * Clean up stale subscriptions
   */
  cleanupStaleSubscriptions() {
    const now = Date.now();
    const staleThreshold = 24 * 60 * 60 * 1000; // 24 hours
    
    for (const [connectionId, subscription] of this.connectionSubscriptions) {
      if ((now - subscription.subscribedAt) > staleThreshold && subscription.accessCount === 0) {
        this.removeSubscription(connectionId);
      }
    }
  }
  
  /**
   * Monitor resource usage
   */
  monitorResourceUsage() {
    const used = process.memoryUsage();
    const usedMB = used.heapUsed / 1024 / 1024;
    
    if (usedMB > 500) {
      this.emit('high_memory_usage', { usedMB });
    }
    
    // Update performance metric
    this.performanceMetrics.set('memory_usage_mb', usedMB);
  }
  
  /**
   * Clean up security data
   */
  cleanupSecurityData() {
    const now = Date.now();
    const retentionPeriod = this.config.alertRetention;
    
    // Clean up old access logs
    for (const [key, logEntry] of this.accessLog.cache) {
      if ((now - logEntry.timestamp) > retentionPeriod) {
        this.accessLog.delete(key);
      }
    }
    
    // Clean up resolved alerts
    for (const [alertId, alert] of this.activeAlerts.cache) {
      if (alert.resolved && (now - alert.timestamp) > retentionPeriod) {
        this.activeAlerts.delete(alertId);
      }
    }
  }
  
  /**
   * Remove subscription
   */
  removeSubscription(connectionId) {
    const subscription = this.connectionSubscriptions.get(connectionId);
    if (!subscription) return;
    
    this.connectionSubscriptions.delete(connectionId);
    
    // Remove from alert subscriptions
    this.alertSubscriptions.delete(subscription.subscriptionKey);
    
    // Remove from user subscriptions
    const userSubs = this.userSubscriptions.get(subscription.userId);
    if (userSubs) {
      userSubs.delete(subscription.subscriptionKey);
      if (userSubs.size === 0) {
        this.userSubscriptions.delete(subscription.userId);
      }
    }
    
    // Update subscription count
    const currentCount = this.userSubscriptionCounts.get(subscription.userId) || 0;
    this.userSubscriptionCounts.set(subscription.userId, Math.max(0, currentCount - 1));
    
    this.performanceStats.subscriptionsActive--;
  }
  
  /**
   * Handle unsubscription
   */
  handleUnsubscription(event) {
    const { connectionId } = event;
    this.removeSubscription(connectionId);
  }
  
  /**
   * Handle disconnection
   */
  handleDisconnection(event) {
    const { connectionId } = event;
    this.removeSubscription(connectionId);
  }
  
  /**
   * Start cleanup task
   */
  startCleanupTask() {
    setInterval(() => {
      this.cleanupOldData();
    }, 3600000); // Every hour
  }
  
  /**
   * Clean up old data
   */
  cleanupOldData() {
    const cutoff = Date.now() - this.config.alertRetention;
    
    // Clean up old alert history
    for (const [type, history] of this.alertHistory.cache) {
      if (history) {
        const filteredHistory = history.filter(alert => alert.timestamp > cutoff);
        this.alertHistory.set(type, filteredHistory);
      }
    }
    
    // Clean up old health check data
    for (const [component, health] of this.healthChecks) {
      if (health.lastCheck < cutoff) {
        this.healthChecks.delete(component);
      }
    }
  }
  
  /**
   * Update running average
   */
  updateAverage(currentAvg, newValue, count) {
    return currentAvg + (newValue - currentAvg) / count;
  }
  
  /**
   * Get comprehensive stats
   */
  getStats() {
    return {
      ...this.performanceStats,
      subscriptionsActive: this.connectionSubscriptions.size,
      activeAlerts: this.activeAlerts.size,
      healthChecks: this.healthChecks.size,
      systemStatus: this.systemStatus.overall,
      activeOperations: this.activeOperations.size
    };
  }
  
  /**
   * Schedule maintenance
   */
  scheduleMaintenance(maintenance) {
    const maintenanceId = crypto.randomBytes(16).toString('hex');
    
    this.maintenanceSchedule.set(maintenanceId, {
      ...maintenance,
      id: maintenanceId,
      scheduledAt: Date.now(),
      notified: false
    });
    
    return maintenanceId;
  }
  
  /**
   * Resolve alert
   */
  resolveAlert(alertId) {
    const alert = this.activeAlerts.get(alertId);
    if (alert) {
      alert.resolved = true;
      alert.resolvedAt = Date.now();
      
      this.emit('alert_resolved', {
        alertId: alertId,
        type: alert.type,
        component: alert.component
      });
    }
  }
  
  /**
   * Shutdown with secure cleanup
   */
  shutdown() {
    // Clear all data structures
    this.systemStatus.services.clear();
    this.healthChecks.clear();
    this.performanceMetrics.clear();
    this.maintenanceSchedule.clear();
    this.activeAlerts.clear();
    this.alertHistory.clear();
    this.alertSubscriptions.clear();
    this.userSubscriptions.clear();
    this.connectionSubscriptions.clear();
    this.userSubscriptionCounts.clear();
    this.accessLog.clear();
    this.activeOperations.clear();
    
    this.emit('shutdown');
  }
}

/**
 * LRU Cache implementation
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

module.exports = SecureSystemStatusFeed;