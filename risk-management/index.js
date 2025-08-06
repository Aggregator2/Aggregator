const EventEmitter = require('events');
const PositionLimitsManager = require('./position-limits-manager');
const VolumeRestrictionsManager = require('./volume-restrictions-manager');
const CircuitBreakerManager = require('./circuit-breaker-manager');
const MLActivityDetector = require('./ml-activity-detector');
const GeoRestrictionsManager = require('./geo-restrictions-manager');
const TokenManagementSystem = require('./token-management-system');
const { getSecureMetricsCollector } = require('../monitoring/secure-metrics-collector');

class RiskManagementSystem extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      // Component configurations
      positionLimits: config.positionLimits || {},
      volumeRestrictions: config.volumeRestrictions || {},
      circuitBreakers: config.circuitBreakers || {},
      mlDetection: config.mlDetection || {},
      geoRestrictions: config.geoRestrictions || {},
      tokenManagement: config.tokenManagement || {},
      
      // System-wide settings
      enableAllComponents: config.enableAllComponents !== false,
      strictMode: config.strictMode || false, // Fail-safe when components fail
      
      // Integration settings
      matchingEngineIntegration: config.matchingEngineIntegration !== false,
      orderBookIntegration: config.orderBookIntegration !== false,
      
      // Alert settings
      alertWebhook: config.alertWebhook,
      slackWebhook: config.slackWebhook,
      emailNotifications: config.emailNotifications || [],
      
      // Performance settings
      healthCheckInterval: config.healthCheckInterval || 30000, // 30 seconds
      
      ...config
    };
    
    this.metrics = getSecureMetricsCollector();
    this.isRunning = false;
    
    // Risk management components
    this.components = new Map();
    this.componentHealth = new Map();
    
    // System state
    this.systemHealth = 'healthy'; // healthy, degraded, critical
    this.lastHealthCheck = null;
    
    // Risk decisions cache
    this.riskDecisions = new Map();
    this.decisionCache = new Map();
    
    // Integration hooks
    this.matchingEngine = null;
    this.orderBook = null;
  }

  async initialize() {
    try {
      console.log('🛡️ Initializing Risk Management System...');
      
      // Initialize metrics collector
      await this.metrics.initialize();
      
      // Initialize all components
      await this.initializeComponents();
      
      // Setup component event handlers
      this.setupComponentEventHandlers();
      
      console.log('✅ Risk Management System initialized');
      
    } catch (error) {
      console.error('Failed to initialize Risk Management System:', error);
      throw error;
    }
  }

  async initializeComponents() {
    const componentConfigs = [
      { name: 'positionLimits', class: PositionLimitsManager, config: this.config.positionLimits },
      { name: 'volumeRestrictions', class: VolumeRestrictionsManager, config: this.config.volumeRestrictions },
      { name: 'circuitBreakers', class: CircuitBreakerManager, config: this.config.circuitBreakers },
      { name: 'mlDetection', class: MLActivityDetector, config: this.config.mlDetection },
      { name: 'geoRestrictions', class: GeoRestrictionsManager, config: this.config.geoRestrictions },
      { name: 'tokenManagement', class: TokenManagementSystem, config: this.config.tokenManagement }
    ];
    
    for (const { name, class: ComponentClass, config } of componentConfigs) {
      try {
        console.log(`Initializing ${name}...`);
        
        const component = new ComponentClass(config);
        await component.initialize();
        
        this.components.set(name, component);
        this.componentHealth.set(name, {
          status: 'healthy',
          lastCheck: Date.now(),
          errors: 0,
          initialized: true
        });
        
        console.log(`✅ ${name} initialized`);
        
      } catch (error) {
        console.error(`Failed to initialize ${name}:`, error);
        
        this.componentHealth.set(name, {
          status: 'failed',
          lastCheck: Date.now(),
          errors: 1,
          initialized: false,
          error: error.message
        });
        
        if (this.config.strictMode) {
          throw error;
        }
      }
    }
  }

  setupComponentEventHandlers() {
    // Position Limits Events
    const positionLimits = this.components.get('positionLimits');
    if (positionLimits) {
      positionLimits.on('limit_violation', (data) => {
        this.handleRiskEvent('position_limit_violation', data);
      });
      
      positionLimits.on('emergency_stop', (data) => {
        this.handleRiskEvent('emergency_stop', data);
      });
    }
    
    // Volume Restrictions Events
    const volumeRestrictions = this.components.get('volumeRestrictions');
    if (volumeRestrictions) {
      volumeRestrictions.on('volume_violation', (data) => {
        this.handleRiskEvent('volume_violation', data);
      });
      
      volumeRestrictions.on('user_suspended', (data) => {
        this.handleRiskEvent('user_suspended', data);
      });
    }
    
    // Circuit Breaker Events
    const circuitBreakers = this.components.get('circuitBreakers');
    if (circuitBreakers) {
      circuitBreakers.on('circuit_breaker_opened', (data) => {
        this.handleRiskEvent('circuit_breaker_opened', data);
      });
      
      circuitBreakers.on('emergency_mode_activated', (data) => {
        this.handleRiskEvent('emergency_mode_activated', data);
      });
    }
    
    // ML Detection Events
    const mlDetection = this.components.get('mlDetection');
    if (mlDetection) {
      mlDetection.on('unusual_activity_detected', (data) => {
        this.handleRiskEvent('unusual_activity_detected', data);
      });
    }
    
    // Geo Restrictions Events
    const geoRestrictions = this.components.get('geoRestrictions');
    if (geoRestrictions) {
      geoRestrictions.on('suspicious_location_change', (data) => {
        this.handleRiskEvent('suspicious_location_change', data);
      });
      
      geoRestrictions.on('impossible_travel_detected', (data) => {
        this.handleRiskEvent('impossible_travel_detected', data);
      });
    }
    
    // Token Management Events
    const tokenManagement = this.components.get('tokenManagement');
    if (tokenManagement) {
      tokenManagement.on('token_blacklisted', (data) => {
        this.handleRiskEvent('token_blacklisted', data);
      });
      
      tokenManagement.on('approval_required', (data) => {
        this.handleRiskEvent('token_approval_required', data);
      });
    }
  }

  async start(matchingEngine = null, orderBook = null) {
    if (this.isRunning) return;
    
    console.log('🚀 Starting Risk Management System...');
    this.isRunning = true;
    
    // Store integration references
    this.matchingEngine = matchingEngine;
    this.orderBook = orderBook;
    
    // Start all components
    await this.startComponents();
    
    // Start health monitoring
    this.startHealthMonitoring();
    
    console.log('✅ Risk Management System started');
    
    // Emit system ready event
    this.emit('system_ready', {
      timestamp: Date.now(),
      components: Array.from(this.components.keys()),
      systemHealth: this.systemHealth
    });
  }

  async startComponents() {
    for (const [name, component] of this.components) {
      try {
        console.log(`Starting ${name}...`);
        
        if (name === 'positionLimits' || name === 'volumeRestrictions') {
          await component.start();
        } else if (name === 'circuitBreakers') {
          await component.start();
        } else if (name === 'mlDetection') {
          await component.start();
        } else if (name === 'geoRestrictions') {
          await component.start();
        } else if (name === 'tokenManagement') {
          await component.start();
        } else {
          await component.start();
        }
        
        this.componentHealth.get(name).status = 'running';
        console.log(`✅ ${name} started`);
        
      } catch (error) {
        console.error(`Failed to start ${name}:`, error);
        
        const health = this.componentHealth.get(name);
        health.status = 'failed';
        health.errors++;
        health.error = error.message;
        
        if (this.config.strictMode) {
          throw error;
        }
      }
    }
  }

  startHealthMonitoring() {
    this.healthCheckInterval = setInterval(async () => {
      try {
        await this.performHealthCheck();
      } catch (error) {
        console.error('Health check error:', error);
      }
    }, this.config.healthCheckInterval);
  }

  async performHealthCheck() {
    let healthyComponents = 0;
    let totalComponents = 0;
    
    for (const [name, component] of this.components) {
      totalComponents++;
      
      try {
        // Check if component has a health check method
        let isHealthy = true;
        
        if (typeof component.getHealthStatus === 'function') {
          const status = component.getHealthStatus();
          isHealthy = status.isRunning || status.isHealthy;
        } else if (typeof component.isRunning !== 'undefined') {
          isHealthy = component.isRunning;
        }
        
        const health = this.componentHealth.get(name);
        if (isHealthy) {
          health.status = 'healthy';
          health.lastCheck = Date.now();
          healthyComponents++;
        } else {
          health.status = 'unhealthy';
          health.errors++;
        }
        
      } catch (error) {
        console.error(`Health check failed for ${name}:`, error);
        
        const health = this.componentHealth.get(name);
        health.status = 'failed';
        health.errors++;
        health.error = error.message;
      }
    }
    
    // Determine overall system health
    const healthRatio = healthyComponents / totalComponents;
    
    if (healthRatio >= 0.8) {
      this.systemHealth = 'healthy';
    } else if (healthRatio >= 0.5) {
      this.systemHealth = 'degraded';
    } else {
      this.systemHealth = 'critical';
    }
    
    this.lastHealthCheck = Date.now();
    
    // Update metrics
    await this.metrics.setGauge('risk_management.system_health', 
      healthRatio, {}, 'risk');
    
    await this.metrics.setGauge('risk_management.healthy_components', 
      healthyComponents, {}, 'risk');
    
    // Emit health status
    this.emit('health_check', {
      systemHealth: this.systemHealth,
      healthyComponents,
      totalComponents,
      componentHealth: Object.fromEntries(this.componentHealth),
      timestamp: Date.now()
    });
  }

  async handleRiskEvent(eventType, data) {
    try {
      const riskEvent = {
        type: eventType,
        data,
        timestamp: Date.now(),
        id: this.generateEventId()
      };
      
      // Store risk event
      this.riskDecisions.set(riskEvent.id, riskEvent);
      
      // Update metrics
      await this.metrics.incrementCounter('risk_management.risk_events', 1, {
        type: eventType
      }, 'risk');
      
      // Send notifications based on severity
      await this.sendRiskNotification(riskEvent);
      
      // Emit to external listeners
      this.emit('risk_event', riskEvent);
      
      console.log(`Risk event: ${eventType}`, { id: riskEvent.id, userId: data.userId });
      
    } catch (error) {
      console.error('Failed to handle risk event:', error);
    }
  }

  async sendRiskNotification(riskEvent) {
    const severity = this.determineSeverity(riskEvent);
    
    if (severity === 'critical' && this.config.alertWebhook) {
      await this.sendWebhookAlert(riskEvent);
    }
    
    if (severity !== 'low' && this.config.slackWebhook) {
      await this.sendSlackAlert(riskEvent);
    }
  }

  determineSeverity(riskEvent) {
    const criticalEvents = [
      'emergency_stop',
      'circuit_breaker_opened',
      'emergency_mode_activated',
      'impossible_travel_detected'
    ];
    
    const highEvents = [
      'position_limit_violation',
      'volume_violation',
      'user_suspended',
      'token_blacklisted'
    ];
    
    if (criticalEvents.includes(riskEvent.type)) return 'critical';
    if (highEvents.includes(riskEvent.type)) return 'high';
    return 'medium';
  }

  async sendWebhookAlert(riskEvent) {
    try {
      const https = require('https');
      const url = require('url');
      
      const webhook = url.parse(this.config.alertWebhook);
      const postData = JSON.stringify({
        event: riskEvent.type,
        severity: this.determineSeverity(riskEvent),
        timestamp: riskEvent.timestamp,
        data: riskEvent.data
      });
      
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

  async sendSlackAlert(riskEvent) {
    // Implement Slack webhook notification
    // Similar to webhook alert but with Slack-specific formatting
  }

  // Main risk assessment methods
  async assessUserRisk(userId, activityData = {}) {
    const assessments = [];
    
    try {
      // Position limits assessment
      const positionLimits = this.components.get('positionLimits');
      if (positionLimits) {
        const permission = await positionLimits.isUserAllowedToTrade(userId);
        assessments.push({
          component: 'positionLimits',
          allowed: permission.allowed,
          reason: permission.reason,
          details: permission
        });
      }
      
      // Volume restrictions assessment
      const volumeRestrictions = this.components.get('volumeRestrictions');
      if (volumeRestrictions) {
        const permission = await volumeRestrictions.isUserAllowedToTrade(userId);
        assessments.push({
          component: 'volumeRestrictions',
          allowed: permission.allowed,
          reason: permission.reason,
          details: permission
        });
      }
      
      // ML activity detection
      const mlDetection = this.components.get('mlDetection');
      if (mlDetection && activityData) {
        const analysis = await mlDetection.analyzeUserActivity(userId, activityData);
        assessments.push({
          component: 'mlDetection',
          allowed: analysis.severity === 'normal',
          reason: analysis.severity !== 'normal' ? 'unusual_activity' : null,
          details: analysis
        });
      }
      
      // Determine overall risk
      const blocked = assessments.filter(a => !a.allowed);
      const warnings = assessments.filter(a => a.details?.warning);
      
      return {
        userId,
        allowed: blocked.length === 0,
        blocked: blocked.map(b => b.reason),
        warnings: warnings.map(w => w.reason),
        assessments,
        riskScore: this.calculateOverallRiskScore(assessments),
        timestamp: Date.now()
      };
      
    } catch (error) {
      console.error(`User risk assessment failed for ${userId}:`, error);
      
      return {
        userId,
        allowed: false,
        blocked: ['risk_assessment_failed'],
        warnings: [],
        assessments: [],
        riskScore: 1.0,
        error: error.message,
        timestamp: Date.now()
      };
    }
  }

  async assessLocationRisk(ip, userId = null) {
    try {
      const geoRestrictions = this.components.get('geoRestrictions');
      if (!geoRestrictions) {
        return {
          allowed: true,
          reason: 'geo_restrictions_disabled'
        };
      }
      
      const result = await geoRestrictions.checkLocationCompliance(ip, userId);
      
      return {
        allowed: result.compliance.allowed,
        reason: result.compliance.reason,
        riskLevel: result.compliance.riskLevel,
        restrictions: result.compliance.restrictions,
        location: result.location,
        vpnDetected: result.vpnData?.isVpn || false
      };
      
    } catch (error) {
      console.error(`Location risk assessment failed for ${ip}:`, error);
      
      return {
        allowed: false,
        reason: 'location_check_failed',
        riskLevel: 'high',
        error: error.message
      };
    }
  }

  async assessTokenRisk(tokenId) {
    try {
      const tokenManagement = this.components.get('tokenManagement');
      if (!tokenManagement) {
        return {
          allowed: true,
          reason: 'token_management_disabled'
        };
      }
      
      const result = tokenManagement.isTokenAllowed(tokenId);
      
      return {
        allowed: result.allowed,
        status: result.status,
        riskLevel: result.riskLevel,
        compliance: result.compliance.compliant
      };
      
    } catch (error) {
      console.error(`Token risk assessment failed for ${tokenId}:`, error);
      
      return {
        allowed: false,
        status: 'assessment_failed',
        riskLevel: 'extreme',
        error: error.message
      };
    }
  }

  async assessOrderRisk(order) {
    try {
      const assessments = [];
      
      // Circuit breaker check
      const circuitBreakers = this.components.get('circuitBreakers');
      if (circuitBreakers) {
        const permission = await circuitBreakers.canExecuteRequest('trading');
        assessments.push({
          component: 'circuitBreakers',
          allowed: permission.allowed,
          reason: permission.reason,
          details: permission
        });
      }
      
      // Token risk check
      if (order.token || order.baseToken || order.quoteToken) {
        const tokens = [order.token, order.baseToken, order.quoteToken].filter(Boolean);
        
        for (const token of tokens) {
          const tokenRisk = await this.assessTokenRisk(token);
          assessments.push({
            component: 'tokenManagement',
            allowed: tokenRisk.allowed,
            reason: tokenRisk.status,
            details: { token, ...tokenRisk }
          });
        }
      }
      
      // User risk check
      if (order.userId) {
        const userRisk = await this.assessUserRisk(order.userId, { orders: [order] });
        assessments.push({
          component: 'userRisk',
          allowed: userRisk.allowed,
          reason: userRisk.blocked.join(', '),
          details: userRisk
        });
      }
      
      const blocked = assessments.filter(a => !a.allowed);
      
      return {
        orderId: order.orderId || order.id,
        allowed: blocked.length === 0,
        blocked: blocked.map(b => b.reason),
        assessments,
        riskScore: this.calculateOverallRiskScore(assessments),
        timestamp: Date.now()
      };
      
    } catch (error) {
      console.error(`Order risk assessment failed:`, error);
      
      return {
        orderId: order.orderId || order.id,
        allowed: false,
        blocked: ['order_assessment_failed'],
        assessments: [],
        riskScore: 1.0,
        error: error.message,
        timestamp: Date.now()
      };
    }
  }

  calculateOverallRiskScore(assessments) {
    if (assessments.length === 0) return 0.5;
    
    let totalRisk = 0;
    let riskCount = 0;
    
    for (const assessment of assessments) {
      if (!assessment.allowed) {
        totalRisk += 1.0; // Blocked = maximum risk
      } else if (assessment.details?.riskScore) {
        totalRisk += assessment.details.riskScore;
      } else if (assessment.details?.warning) {
        totalRisk += 0.5; // Warning = medium risk
      }
      riskCount++;
    }
    
    return riskCount > 0 ? totalRisk / riskCount : 0;
  }

  generateEventId() {
    const crypto = require('crypto');
    return `risk_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  }

  // Utility methods for external integration
  getSystemStatus() {
    return {
      isRunning: this.isRunning,
      systemHealth: this.systemHealth,
      lastHealthCheck: this.lastHealthCheck,
      components: Object.fromEntries(
        Array.from(this.components.keys()).map(name => [
          name,
          {
            enabled: this.components.has(name),
            health: this.componentHealth.get(name)
          }
        ])
      ),
      riskEvents: this.riskDecisions.size,
      integrations: {
        matchingEngine: !!this.matchingEngine,
        orderBook: !!this.orderBook
      }
    };
  }

  getComponentStatus(componentName) {
    const component = this.components.get(componentName);
    if (!component) {
      return { error: 'Component not found' };
    }
    
    const health = this.componentHealth.get(componentName);
    
    // Try to get component-specific status
    let componentStatus = {};
    if (typeof component.getStatus === 'function') {
      componentStatus = component.getStatus();
    } else if (typeof component.getPositionLimitsStatus === 'function') {
      componentStatus = component.getPositionLimitsStatus();
    } else if (typeof component.getVolumeRestrictionsStatus === 'function') {
      componentStatus = component.getVolumeRestrictionsStatus();
    } else if (typeof component.getCircuitBreakerStatus === 'function') {
      componentStatus = component.getCircuitBreakerStatus();
    } else if (typeof component.getMLDetectorStatus === 'function') {
      componentStatus = component.getMLDetectorStatus();
    } else if (typeof component.getGeoRestrictionsStatus === 'function') {
      componentStatus = component.getGeoRestrictionsStatus();
    } else if (typeof component.getTokenManagementStatus === 'function') {
      componentStatus = component.getTokenManagementStatus();
    }
    
    return {
      health,
      ...componentStatus
    };
  }

  async recordUserActivity(userId, activity) {
    // Record activity across relevant components
    const promises = [];
    
    // Position tracking
    const positionLimits = this.components.get('positionLimits');
    if (positionLimits && activity.position) {
      promises.push(positionLimits.updateUserPosition(userId, activity.position));
    }
    
    if (positionLimits && activity.orders) {
      promises.push(positionLimits.updateUserOrders(userId, activity.orders));
    }
    
    // Volume tracking
    const volumeRestrictions = this.components.get('volumeRestrictions');
    if (volumeRestrictions && activity.volume) {
      promises.push(volumeRestrictions.recordVolume(userId, activity.volume));
    }
    
    // Circuit breaker tracking
    const circuitBreakers = this.components.get('circuitBreakers');
    if (circuitBreakers && activity.request) {
      promises.push(circuitBreakers.recordRequest('trading', activity.request));
    }
    
    await Promise.all(promises);
  }

  stop() {
    if (!this.isRunning) return;
    
    console.log('🛑 Stopping Risk Management System...');
    
    // Stop health monitoring
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    
    // Stop all components
    for (const [name, component] of this.components) {
      try {
        if (typeof component.stop === 'function') {
          component.stop();
        }
        console.log(`✅ ${name} stopped`);
      } catch (error) {
        console.error(`Failed to stop ${name}:`, error);
      }
    }
    
    // Clear data
    this.components.clear();
    this.componentHealth.clear();
    this.riskDecisions.clear();
    this.decisionCache.clear();
    
    this.isRunning = false;
    console.log('✅ Risk Management System stopped');
  }
}

module.exports = RiskManagementSystem;