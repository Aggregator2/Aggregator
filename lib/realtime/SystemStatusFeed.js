const EventEmitter = require('events');
const { getSecureMetricsCollector } = require('../monitoring/secure-metrics-collector');

/**
 * System Status Notification Service
 * Provides real-time system health, maintenance alerts, and operational status updates
 */
class SystemStatusFeed extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      updateInterval: config.updateInterval || 5000,      // 5 second health checks
      alertInterval: config.alertInterval || 1000,       // 1 second alert checks
      maintenanceWindow: config.maintenanceWindow || 300000, // 5 minutes
      severityLevels: config.severityLevels || ['info', 'warning', 'error', 'critical'],
      enableMetrics: config.enableMetrics !== false,
      enableHealthChecks: config.enableHealthChecks !== false,
      ...config
    };
    
    this.metrics = getSecureMetricsCollector();
    this.webSocketManager = null;
    
    // System status tracking
    this.systemHealth = {
      status: 'unknown',
      uptime: 0,
      lastCheck: Date.now(),
      components: new Map(), // componentName -> health status
      alerts: [],
      maintenance: {
        active: false,
        scheduledStart: null,
        scheduledEnd: null,
        reason: null
      }
    };
    
    // Component health definitions
    this.componentChecks = new Map();
    this.componentThresholds = new Map();
    this.componentStatus = new Map();
    
    // Alert management
    this.activeAlerts = new Map(); // alertId -> alert data
    this.alertHistory = []; // Recent alerts for replay
    this.alertSubscribers = new Set(); // connectionIds subscribed to alerts
    
    // Subscription management
    this.statusSubscribers = new Set(); // connectionIds subscribed to status
    this.componentSubscribers = new Map(); // componentName -> Set of connectionIds
    this.maintenanceSubscribers = new Set(); // connectionIds subscribed to maintenance
    
    // Performance and metrics tracking
    this.performanceMetrics = {
      responseTime: { current: 0, average: 0, samples: [] },
      throughput: { current: 0, peak: 0, average: 0 },
      errorRate: { current: 0, threshold: 0.05 },
      activeConnections: 0,
      memoryUsage: { current: 0, peak: 0, threshold: 0.85 },
      cpuUsage: { current: 0, peak: 0, threshold: 0.80 }
    };
    
    // Alert types and priorities
    this.alertTypes = {
      SYSTEM_DEGRADED: 'system_degraded',
      COMPONENT_DOWN: 'component_down',
      HIGH_ERROR_RATE: 'high_error_rate',
      HIGH_LATENCY: 'high_latency',
      MAINTENANCE_SCHEDULED: 'maintenance_scheduled',
      MAINTENANCE_STARTED: 'maintenance_started',
      MAINTENANCE_COMPLETED: 'maintenance_completed',
      SECURITY_INCIDENT: 'security_incident',
      CAPACITY_WARNING: 'capacity_warning'
    };
    
    // System components to monitor
    this.monitoredComponents = {
      api: { name: 'API Gateway', critical: true },
      database: { name: 'Database', critical: true },
      redis: { name: 'Redis Cache', critical: true },
      orderbook: { name: 'Order Book Engine', critical: true },
      matching: { name: 'Matching Engine', critical: true },
      websocket: { name: 'WebSocket Server', critical: false },
      blockchain: { name: 'Blockchain Connector', critical: false },
      storage: { name: 'File Storage', critical: false }
    };
    
    // Performance tracking
    this.performanceStats = {
      statusChecksPerformed: 0,
      alertsSent: 0,
      statusUpdatesSent: 0,
      maintenanceNotificationsSent: 0,
      subscriptionsActive: 0,
      avgCheckLatency: 0
    };
    
    this.initializeComponents();
    this.startHealthMonitoring();
    this.startAlertProcessor();
  }
  
  /**
   * Initialize with WebSocket manager
   */
  initialize(webSocketManager) {
    this.webSocketManager = webSocketManager;
    
    // Listen for subscription events
    this.webSocketManager.on('subscribed', (event) => {
      if (event.channel === 'system_status') {
        this.handleStatusSubscription(event);
      } else if (event.channel === 'system_alerts') {
        this.handleAlertSubscription(event);
      } else if (event.channel === 'maintenance') {
        this.handleMaintenanceSubscription(event);
      }
    });
    
    this.webSocketManager.on('unsubscribed', (event) => {
      if (['system_status', 'system_alerts', 'maintenance'].includes(event.channel)) {
        this.handleUnsubscription(event);
      }
    });
    
    this.webSocketManager.on('disconnection', (event) => {
      this.handleDisconnection(event);
    });
    
    // Monitor WebSocket server health
    this.registerComponentCheck('websocket', () => this.checkWebSocketHealth());
  }
  
  /**
   * Initialize system components
   */
  initializeComponents() {
    // Register default component health checks
    Object.entries(this.monitoredComponents).forEach(([componentId, component]) => {
      this.componentStatus.set(componentId, {
        name: component.name,
        status: 'unknown',
        lastCheck: null,
        responseTime: 0,
        errorCount: 0,
        critical: component.critical,
        metadata: {}
      });
      
      // Set default thresholds
      this.componentThresholds.set(componentId, {
        responseTime: 5000, // 5 seconds
        errorRate: 0.1,     // 10%
        availability: 0.99  // 99%
      });
    });
  }
  
  /**
   * Register a component health check
   */
  registerComponentCheck(componentId, checkFunction) {
    if (!this.monitoredComponents[componentId]) {
      throw new Error(`Unknown component: ${componentId}`);
    }
    
    this.componentChecks.set(componentId, checkFunction);
  }
  
  /**
   * Set component thresholds
   */
  setComponentThresholds(componentId, thresholds) {
    if (!this.monitoredComponents[componentId]) {
      throw new Error(`Unknown component: ${componentId}`);
    }
    
    this.componentThresholds.set(componentId, {
      ...this.componentThresholds.get(componentId),
      ...thresholds
    });
  }
  
  /**
   * Update component status manually
   */
  updateComponentStatus(componentId, status, metadata = {}) {
    if (!this.componentStatus.has(componentId)) {
      return;
    }
    
    const component = this.componentStatus.get(componentId);
    const previousStatus = component.status;
    
    component.status = status;
    component.lastCheck = Date.now();
    component.metadata = { ...component.metadata, ...metadata };
    
    // Generate alert if status changed
    if (previousStatus !== status && status !== 'healthy') {
      this.generateComponentAlert(componentId, status, previousStatus);
    }
    
    // Update overall system health
    this.updateSystemHealth();
    
    // Broadcast to subscribers
    this.broadcastComponentStatus(componentId, component);
  }
  
  /**
   * Start health monitoring
   */
  startHealthMonitoring() {
    setInterval(() => {
      this.performHealthChecks();
    }, this.config.updateInterval);
    
    // Also monitor performance metrics
    setInterval(() => {
      this.updatePerformanceMetrics();
    }, 1000); // Every second
  }
  
  /**
   * Perform health checks
   */
  async performHealthChecks() {
    const startTime = Date.now();
    
    // Check each registered component
    for (const [componentId, checkFunction] of this.componentChecks) {
      try {
        const checkStartTime = Date.now();
        const result = await checkFunction();
        const responseTime = Date.now() - checkStartTime;
        
        this.processHealthCheckResult(componentId, result, responseTime);
      } catch (error) {
        this.processHealthCheckResult(componentId, {
          status: 'error',
          error: error.message
        }, Date.now() - startTime);
      }
    }
    
    // Update overall system health
    this.updateSystemHealth();
    
    // Broadcast system status
    this.broadcastSystemStatus();
    
    this.performanceStats.statusChecksPerformed++;
    this.performanceStats.avgCheckLatency = this.updateAverage(
      this.performanceStats.avgCheckLatency,
      Date.now() - startTime,
      this.performanceStats.statusChecksPerformed
    );
  }
  
  /**
   * Process health check result
   */
  processHealthCheckResult(componentId, result, responseTime) {
    const component = this.componentStatus.get(componentId);
    if (!component) return;
    
    const previousStatus = component.status;
    component.status = result.status || 'unknown';
    component.lastCheck = Date.now();
    component.responseTime = responseTime;
    component.metadata = { ...component.metadata, ...result.metadata };
    
    // Track errors
    if (result.status === 'error' || result.status === 'degraded') {
      component.errorCount++;
    }
    
    // Check thresholds
    this.checkComponentThresholds(componentId, component);
    
    // Generate alerts for status changes
    if (previousStatus !== component.status) {
      this.generateComponentAlert(componentId, component.status, previousStatus);
    }
  }
  
  /**
   * Check component thresholds
   */
  checkComponentThresholds(componentId, component) {
    const thresholds = this.componentThresholds.get(componentId);
    if (!thresholds) return;
    
    // Check response time threshold
    if (component.responseTime > thresholds.responseTime) {
      this.generateAlert(this.alertTypes.HIGH_LATENCY, {
        component: componentId,
        responseTime: component.responseTime,
        threshold: thresholds.responseTime
      }, 'warning');
    }
    
    // Check error rate (would need historical data)
    // This is simplified - in practice would track error rate over time
  }
  
  /**
   * Update system health
   */
  updateSystemHealth() {
    const components = Array.from(this.componentStatus.values());
    const criticalComponents = components.filter(c => c.critical);
    
    // Determine overall status
    let overallStatus = 'healthy';
    
    // Check critical components
    const criticalDown = criticalComponents.filter(c => c.status === 'error').length;
    const criticalDegraded = criticalComponents.filter(c => c.status === 'degraded').length;
    
    if (criticalDown > 0) {
      overallStatus = 'critical';
    } else if (criticalDegraded > 0) {
      overallStatus = 'degraded';
    } else {
      // Check non-critical components
      const nonCriticalIssues = components.filter(c => 
        !c.critical && (c.status === 'error' || c.status === 'degraded')
      ).length;
      
      if (nonCriticalIssues > 2) {
        overallStatus = 'degraded';
      }
    }
    
    // Update system health
    const previousStatus = this.systemHealth.status;
    this.systemHealth.status = overallStatus;
    this.systemHealth.lastCheck = Date.now();
    this.systemHealth.uptime = process.uptime() * 1000;
    
    // Update component map
    this.systemHealth.components.clear();
    components.forEach(component => {
      this.systemHealth.components.set(component.name, {
        status: component.status,
        lastCheck: component.lastCheck,
        responseTime: component.responseTime
      });
    });
    
    // Generate system-level alerts
    if (previousStatus !== overallStatus) {
      this.generateSystemAlert(overallStatus, previousStatus);
    }
  }
  
  /**
   * Update performance metrics
   */
  updatePerformanceMetrics() {
    // Get current metrics (simplified - would integrate with actual monitoring)
    const memUsage = process.memoryUsage();
    const memPercent = memUsage.heapUsed / memUsage.heapTotal;
    
    this.performanceMetrics.memoryUsage.current = memPercent;
    if (memPercent > this.performanceMetrics.memoryUsage.peak) {
      this.performanceMetrics.memoryUsage.peak = memPercent;
    }
    
    // Check memory threshold
    if (memPercent > this.performanceMetrics.memoryUsage.threshold) {
      this.generateAlert(this.alertTypes.CAPACITY_WARNING, {
        type: 'memory',
        current: (memPercent * 100).toFixed(1),
        threshold: (this.performanceMetrics.memoryUsage.threshold * 100).toFixed(1)
      }, 'warning');
    }
    
    // Update active connections from WebSocket manager
    if (this.webSocketManager) {
      this.performanceMetrics.activeConnections = this.webSocketManager.connections?.size || 0;
    }
  }
  
  /**
   * Generate component alert
   */
  generateComponentAlert(componentId, newStatus, previousStatus) {
    const component = this.componentStatus.get(componentId);
    if (!component) return;
    
    let alertType = this.alertTypes.COMPONENT_DOWN;
    let severity = 'error';
    
    if (newStatus === 'degraded') {
      alertType = this.alertTypes.SYSTEM_DEGRADED;
      severity = 'warning';
    } else if (newStatus === 'healthy' && previousStatus !== 'healthy') {
      // Component recovered
      alertType = 'component_recovered';
      severity = 'info';
    }
    
    this.generateAlert(alertType, {
      component: componentId,
      componentName: component.name,
      status: newStatus,
      previousStatus: previousStatus,
      critical: component.critical
    }, severity);
  }
  
  /**
   * Generate system alert
   */
  generateSystemAlert(newStatus, previousStatus) {
    if (newStatus === 'critical') {
      this.generateAlert(this.alertTypes.SYSTEM_DEGRADED, {
        status: newStatus,
        previousStatus: previousStatus,
        message: 'Critical system components are experiencing issues'
      }, 'critical');
    } else if (newStatus === 'degraded') {
      this.generateAlert(this.alertTypes.SYSTEM_DEGRADED, {
        status: newStatus,
        previousStatus: previousStatus,
        message: 'System performance is degraded'
      }, 'warning');
    } else if (newStatus === 'healthy' && previousStatus !== 'healthy') {
      this.generateAlert('system_recovered', {
        status: newStatus,
        previousStatus: previousStatus,
        message: 'All systems have recovered and are operating normally'
      }, 'info');
    }
  }
  
  /**
   * Generate alert
   */
  generateAlert(type, data, severity = 'info') {
    const alertId = this.generateAlertId();
    const alert = {
      id: alertId,
      type: type,
      severity: severity,
      message: this.generateAlertMessage(type, data),
      data: data,
      timestamp: Date.now(),
      acknowledged: false,
      resolvedAt: null
    };
    
    // Store active alert
    this.activeAlerts.set(alertId, alert);
    
    // Add to history
    this.alertHistory.push(alert);
    
    // Maintain history size
    if (this.alertHistory.length > 1000) {
      this.alertHistory.splice(0, this.alertHistory.length - 1000);
    }
    
    // Broadcast alert
    this.broadcastAlert(alert);
    
    this.performanceStats.alertsSent++;
    
    this.emit('alert_generated', alert);
  }
  
  /**
   * Generate alert message
   */
  generateAlertMessage(type, data) {
    switch (type) {
      case this.alertTypes.COMPONENT_DOWN:
        return `Component ${data.componentName} is down`;
      case this.alertTypes.SYSTEM_DEGRADED:
        return `System status changed to ${data.status}`;
      case this.alertTypes.HIGH_LATENCY:
        return `High latency detected on ${data.component}: ${data.responseTime}ms`;
      case this.alertTypes.CAPACITY_WARNING:
        return `${data.type} usage is ${data.current}% (threshold: ${data.threshold}%)`;
      case this.alertTypes.MAINTENANCE_SCHEDULED:
        return `Maintenance scheduled from ${new Date(data.start).toISOString()} to ${new Date(data.end).toISOString()}`;
      case this.alertTypes.MAINTENANCE_STARTED:
        return `Maintenance window has started: ${data.reason}`;
      case this.alertTypes.MAINTENANCE_COMPLETED:
        return `Maintenance window has completed`;
      case 'component_recovered':
        return `Component ${data.componentName} has recovered`;
      case 'system_recovered':
        return `All systems have recovered and are operating normally`;
      default:
        return `System alert: ${type}`;
    }
  }
  
  /**
   * Schedule maintenance
   */
  scheduleMaintenance(startTime, endTime, reason) {
    this.systemHealth.maintenance = {
      active: false,
      scheduledStart: startTime,
      scheduledEnd: endTime,
      reason: reason
    };
    
    // Generate maintenance alert
    this.generateAlert(this.alertTypes.MAINTENANCE_SCHEDULED, {
      start: startTime,
      end: endTime,
      reason: reason
    }, 'info');
    
    // Schedule maintenance start
    const delay = startTime - Date.now();
    if (delay > 0) {
      setTimeout(() => {
        this.startMaintenance(reason);
      }, delay);
    }
  }
  
  /**
   * Start maintenance
   */
  startMaintenance(reason) {
    this.systemHealth.maintenance.active = true;
    this.systemHealth.maintenance.reason = reason;
    
    this.generateAlert(this.alertTypes.MAINTENANCE_STARTED, {
      reason: reason
    }, 'warning');
    
    this.broadcastMaintenanceStatus();
  }
  
  /**
   * End maintenance
   */
  endMaintenance() {
    this.systemHealth.maintenance.active = false;
    this.systemHealth.maintenance.reason = null;
    
    this.generateAlert(this.alertTypes.MAINTENANCE_COMPLETED, {}, 'info');
    
    this.broadcastMaintenanceStatus();
  }
  
  /**
   * Handle status subscription
   */
  handleStatusSubscription(event) {
    const { connectionId } = event;
    
    this.statusSubscribers.add(connectionId);
    this.performanceStats.subscriptionsActive++;
    
    // Send current system status
    this.sendSystemStatus(connectionId);
    
    this.emit('status_subscription_added', { connectionId });
  }
  
  /**
   * Handle alert subscription
   */
  handleAlertSubscription(event) {
    const { connectionId, params } = event;
    const { severity } = params || {};
    
    this.alertSubscribers.add(connectionId);
    this.performanceStats.subscriptionsActive++;
    
    // Send recent alerts
    this.sendRecentAlerts(connectionId, severity);
    
    this.emit('alert_subscription_added', { connectionId });
  }
  
  /**
   * Handle maintenance subscription
   */
  handleMaintenanceSubscription(event) {
    const { connectionId } = event;
    
    this.maintenanceSubscribers.add(connectionId);
    this.performanceStats.subscriptionsActive++;
    
    // Send current maintenance status
    this.sendMaintenanceStatus(connectionId);
    
    this.emit('maintenance_subscription_added', { connectionId });
  }
  
  /**
   * Send system status
   */
  sendSystemStatus(connectionId) {
    const status = {
      status: this.systemHealth.status,
      uptime: this.systemHealth.uptime,
      lastCheck: this.systemHealth.lastCheck,
      components: Object.fromEntries(this.systemHealth.components),
      maintenance: this.systemHealth.maintenance,
      performance: this.config.enableMetrics ? this.performanceMetrics : undefined
    };
    
    const message = {
      type: 'system_status_snapshot',
      data: status,
      timestamp: Date.now()
    };
    
    this.webSocketManager.sendToConnection(connectionId, message);
  }
  
  /**
   * Send recent alerts
   */
  sendRecentAlerts(connectionId, severityFilter) {
    let alerts = this.alertHistory.slice(-50); // Last 50 alerts
    
    if (severityFilter) {
      alerts = alerts.filter(alert => alert.severity === severityFilter);
    }
    
    const message = {
      type: 'system_alerts_snapshot',
      data: alerts,
      timestamp: Date.now()
    };
    
    this.webSocketManager.sendToConnection(connectionId, message);
  }
  
  /**
   * Send maintenance status
   */
  sendMaintenanceStatus(connectionId) {
    const message = {
      type: 'maintenance_status',
      data: this.systemHealth.maintenance,
      timestamp: Date.now()
    };
    
    this.webSocketManager.sendToConnection(connectionId, message);
  }
  
  /**
   * Broadcast system status
   */
  broadcastSystemStatus() {
    if (this.statusSubscribers.size === 0) return;
    
    const status = {
      status: this.systemHealth.status,
      uptime: this.systemHealth.uptime,
      lastCheck: this.systemHealth.lastCheck,
      components: Object.fromEntries(this.systemHealth.components),
      maintenance: this.systemHealth.maintenance,
      performance: this.config.enableMetrics ? this.performanceMetrics : undefined
    };
    
    const message = {
      type: 'system_status_update',
      data: status,
      timestamp: Date.now()
    };
    
    this.statusSubscribers.forEach(connectionId => {
      this.webSocketManager.sendToConnection(connectionId, message);
    });
    
    this.performanceStats.statusUpdatesSent++;
  }
  
  /**
   * Broadcast component status
   */
  broadcastComponentStatus(componentId, component) {
    const subscribers = this.componentSubscribers.get(componentId);
    if (!subscribers || subscribers.size === 0) return;
    
    const message = {
      type: 'component_status_update',
      data: {
        componentId: componentId,
        ...component
      },
      timestamp: Date.now()
    };
    
    subscribers.forEach(connectionId => {
      this.webSocketManager.sendToConnection(connectionId, message);
    });
  }
  
  /**
   * Broadcast alert
   */
  broadcastAlert(alert) {
    if (this.alertSubscribers.size === 0) return;
    
    const message = {
      type: 'system_alert',
      data: alert,
      timestamp: Date.now()
    };
    
    this.alertSubscribers.forEach(connectionId => {
      this.webSocketManager.sendToConnection(connectionId, message);
    });
  }
  
  /**
   * Broadcast maintenance status
   */
  broadcastMaintenanceStatus() {
    if (this.maintenanceSubscribers.size === 0) return;
    
    const message = {
      type: 'maintenance_status_update',
      data: this.systemHealth.maintenance,
      timestamp: Date.now()
    };
    
    this.maintenanceSubscribers.forEach(connectionId => {
      this.webSocketManager.sendToConnection(connectionId, message);
    });
    
    this.performanceStats.maintenanceNotificationsSent++;
  }
  
  /**
   * Start alert processor
   */
  startAlertProcessor() {
    setInterval(() => {
      this.processAlerts();
    }, this.config.alertInterval);
  }
  
  /**
   * Process alerts (auto-resolution, etc.)
   */
  processAlerts() {
    const now = Date.now();
    
    for (const [alertId, alert] of this.activeAlerts) {
      // Auto-resolve old alerts of certain types
      if (this.shouldAutoResolve(alert, now)) {
        this.resolveAlert(alertId);
      }
    }
  }
  
  /**
   * Should auto resolve alert
   */
  shouldAutoResolve(alert, now) {
    const age = now - alert.timestamp;
    
    // Auto-resolve capacity warnings after 5 minutes if no longer triggered
    if (alert.type === this.alertTypes.CAPACITY_WARNING && age > 300000) {
      return true;
    }
    
    // Auto-resolve high latency alerts after 2 minutes
    if (alert.type === this.alertTypes.HIGH_LATENCY && age > 120000) {
      return true;
    }
    
    return false;
  }
  
  /**
   * Resolve alert
   */
  resolveAlert(alertId) {
    const alert = this.activeAlerts.get(alertId);
    if (!alert) return;
    
    alert.resolvedAt = Date.now();
    this.activeAlerts.delete(alertId);
    
    this.emit('alert_resolved', alert);
  }
  
  /**
   * Acknowledge alert
   */
  acknowledgeAlert(alertId, userId) {
    const alert = this.activeAlerts.get(alertId);
    if (!alert) return false;
    
    alert.acknowledged = true;
    alert.acknowledgedBy = userId;
    alert.acknowledgedAt = Date.now();
    
    this.emit('alert_acknowledged', alert);
    return true;
  }
  
  /**
   * Check WebSocket health
   */
  checkWebSocketHealth() {
    if (!this.webSocketManager) {
      return { status: 'unknown' };
    }
    
    const stats = this.webSocketManager.getStats();
    const connectionsActive = stats.connectionsActive || 0;
    const errorRate = stats.rateLimitViolations / Math.max(stats.connectionsTotal, 1);
    
    let status = 'healthy';
    if (errorRate > 0.1) {
      status = 'degraded';
    }
    
    return {
      status: status,
      metadata: {
        activeConnections: connectionsActive,
        totalConnections: stats.connectionsTotal,
        errorRate: errorRate
      }
    };
  }
  
  /**
   * Handle unsubscription
   */
  handleUnsubscription(event) {
    const { connectionId, channel } = event;
    
    if (channel === 'system_status') {
      this.statusSubscribers.delete(connectionId);
    } else if (channel === 'system_alerts') {
      this.alertSubscribers.delete(connectionId);
    } else if (channel === 'maintenance') {
      this.maintenanceSubscribers.delete(connectionId);
    }
    
    this.performanceStats.subscriptionsActive--;
  }
  
  /**
   * Handle disconnection
   */
  handleDisconnection(event) {
    const { connectionId } = event;
    
    this.statusSubscribers.delete(connectionId);
    this.alertSubscribers.delete(connectionId);
    this.maintenanceSubscribers.delete(connectionId);
    
    // Remove from component subscribers
    for (const subscribers of this.componentSubscribers.values()) {
      subscribers.delete(connectionId);
    }
    
    this.performanceStats.subscriptionsActive = Math.max(0, 
      this.performanceStats.subscriptionsActive - 1);
  }
  
  /**
   * Generate alert ID
   */
  generateAlertId() {
    return `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  /**
   * Update running average
   */
  updateAverage(currentAvg, newValue, count) {
    return currentAvg + (newValue - currentAvg) / count;
  }
  
  /**
   * Get statistics
   */
  getStats() {
    return {
      ...this.performanceStats,
      systemHealth: this.systemHealth.status,
      activeAlerts: this.activeAlerts.size,
      componentsMonitored: this.componentStatus.size,
      subscriptionsActive: this.statusSubscribers.size + 
                          this.alertSubscribers.size + 
                          this.maintenanceSubscribers.size
    };
  }
  
  /**
   * Get current system status
   */
  getSystemStatus() {
    return {
      ...this.systemHealth,
      components: Object.fromEntries(this.systemHealth.components),
      activeAlerts: Array.from(this.activeAlerts.values()),
      performance: this.performanceMetrics
    };
  }
  
  /**
   * Shutdown system status feed
   */
  shutdown() {
    this.componentChecks.clear();
    this.componentStatus.clear();
    this.activeAlerts.clear();
    this.statusSubscribers.clear();
    this.alertSubscribers.clear();
    this.maintenanceSubscribers.clear();
    this.componentSubscribers.clear();
    
    this.emit('shutdown');
  }
}

module.exports = SystemStatusFeed;