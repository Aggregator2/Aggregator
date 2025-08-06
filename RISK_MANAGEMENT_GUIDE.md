# DEX Risk Management System Guide

## Overview

The Risk Management System provides comprehensive risk controls for the DEX platform, including position limits, volume restrictions, circuit breakers, ML-based fraud detection, geographic compliance, and token management.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                 Risk Management System                      │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐ │
│  │ Position Limits │  │Volume Restrictions│ │Circuit Breakers│ │
│  │ Manager         │  │ Manager          │  │ Manager      │ │
│  └─────────────────┘  └─────────────────┘  └──────────────┘ │
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐ │
│  │   ML Activity   │  │ Geo Restrictions │  │    Token     │ │
│  │   Detector      │  │ Manager         │  │ Management   │ │
│  └─────────────────┘  └─────────────────┘  └──────────────┘ │
├─────────────────────────────────────────────────────────────┤
│              Monitoring & Metrics System                   │
└─────────────────────────────────────────────────────────────┘
```

## Components

### 1. Position Limits Manager
Controls user position exposure with real-time tracking.

**Features:**
- Per-user position limits (USD value, leverage, open orders)
- Tier-based limits (basic, verified, professional, institutional)
- Real-time position tracking with Redis persistence
- Emergency stops for limit violations
- Adaptive risk thresholds

**Usage:**
```javascript
const positionLimits = new PositionLimitsManager({
  defaultMaxPosition: 100000, // $100k
  defaultMaxLeverage: 10,
  defaultMaxOpenOrders: 50,
  tierLimits: {
    institutional: { maxPosition: 10000000, maxLeverage: 50 }
  }
});

await positionLimits.initialize();
await positionLimits.start();

// Set custom limits
await positionLimits.setUserLimits('user123', {
  maxPosition: 500000,
  maxLeverage: 20,
  tier: 'professional'
});

// Check trading permission
const permission = await positionLimits.isUserAllowedToTrade('user123', 10000);
```

### 2. Volume Restrictions Manager
Implements rolling window volume limits with compliance tracking.

**Features:**
- Daily, weekly, monthly volume limits
- Rolling window calculations with efficient bucket storage
- Tier-based volume restrictions
- Automatic user suspension for violations
- Cache optimization for high-frequency checks

**Usage:**
```javascript
const volumeRestrictions = new VolumeRestrictionsManager({
  defaultDailyLimit: 100000,
  tierLimits: {
    verified: { daily: 1000000, weekly: 5000000 }
  }
});

// Record trading volume
await volumeRestrictions.recordVolume('user123', 5000);

// Check trading permission
const permission = await volumeRestrictions.isUserAllowedToTrade('user123', 15000);
```

### 3. Circuit Breaker Manager
Provides system-wide protection with automated fault tolerance.

**Features:**
- Multiple circuit breaker patterns (per-service, system-wide)
- Configurable failure thresholds and recovery windows
- Emergency mode activation for cascade failures
- Real-time monitoring and auto-recovery
- Integration with system health checks

**Usage:**
```javascript
const circuitBreakers = new CircuitBreakerManager({
  failureThreshold: 10,
  timeWindow: 60000,
  resetWindow: 300000
});

// Create circuit breaker
await circuitBreakers.createCircuitBreaker('trading', {
  type: 'system',
  priority: 'critical'
});

// Check execution permission
const permission = await circuitBreakers.canExecuteRequest('trading');

// Record request result
await circuitBreakers.recordRequest('trading', { 
  success: true, 
  latency: 50 
});
```

### 4. ML Activity Detector
Advanced fraud detection using machine learning and statistical analysis.

**Features:**
- Real-time feature extraction (transaction patterns, timing, volumes)
- Multiple detection algorithms (wash trading, layering, spoofing)
- Adaptive thresholds with confidence scoring
- Batch processing for performance optimization
- Anomaly detection with pattern recognition

**Key Detection Patterns:**
- **Wash Trading**: Same user/IP, similar timing patterns
- **Market Manipulation**: Layering, spoofing, front-running
- **Ghost Liquidity**: Orders cancelled before execution
- **Ping-pong Trading**: Back-and-forth between same parties
- **Momentum Ignition**: Price manipulation through rapid trades

**Usage:**
```javascript
const mlDetector = new MLActivityDetector({
  anomalyThreshold: 0.8,
  features: ['transaction_frequency', 'volume_patterns', 'cancellation_rate']
});

// Analyze user activity
const analysis = await mlDetector.analyzeUserActivity('user123', {
  transactions: userTransactions,
  orders: userOrders
});

if (analysis.anomalyScore > 0.8) {
  console.log(`Suspicious activity detected: ${analysis.severity}`);
}
```

### 5. Geo Restrictions Manager
Geographic compliance with real-time location verification.

**Features:**
- Multi-provider IP geolocation (MaxMind, IPApi, IPGeolocation)
- VPN/Proxy detection with confidence scoring
- OFAC, EU, UN sanctions compliance
- Impossible travel detection
- Compliance framework integration

**Supported Compliance:**
- **OFAC**: US Treasury sanctions
- **EU Sanctions**: European Union restrictions
- **UN Sanctions**: United Nations sanctions
- **FATF Gray List**: Financial Action Task Force monitoring

**Usage:**
```javascript
const geoRestrictions = new GeoRestrictionsManager({
  blockedCountries: ['US', 'CU', 'IR', 'KP'],
  vpnDetection: true,
  complianceFrameworks: {
    OFAC: { enabled: true, priority: 'critical' }
  }
});

// Check location compliance
const result = await geoRestrictions.checkLocationCompliance('1.2.3.4', 'user123');

if (!result.compliance.allowed) {
  console.log(`Access blocked: ${result.compliance.reason}`);
}
```

### 6. Token Management System
Comprehensive token whitelisting and risk assessment.

**Features:**
- Automated token risk scoring using market data
- Multi-source price and metadata aggregation
- Compliance checks against sanction lists
- Approval workflow with auto-approval criteria
- Real-time market monitoring for risk changes

**Risk Assessment Factors:**
- **Volatility**: Price movement analysis
- **Liquidity**: Market depth and volume
- **Market Cap**: Token valuation and stability
- **Age**: Time since token creation
- **Compliance**: Sanction list verification

**Usage:**
```javascript
const tokenManagement = new TokenManagementSystem({
  defaultWhitelist: ['ETH', 'BTC', 'USDC'],
  autoBlacklistCriteria: {
    volatilityThreshold: 0.5,
    liquidityThreshold: 10000
  }
});

// Request token approval
const request = await tokenManagement.requestTokenApproval('NEWTOKEN', 'user123', 'Popular DeFi token');

// Check token status
const status = tokenManagement.isTokenAllowed('NEWTOKEN');
```

## Integration Guide

### Basic Setup
```javascript
const RiskManagementSystem = require('./risk-management');

const riskSystem = new RiskManagementSystem({
  positionLimits: {
    defaultMaxPosition: 100000,
    tierLimits: {
      institutional: { maxPosition: 10000000 }
    }
  },
  volumeRestrictions: {
    defaultDailyLimit: 50000
  },
  circuitBreakers: {
    systemBreakers: {
      trading: { enabled: true, priority: 'critical' }
    }
  },
  mlDetection: {
    anomalyThreshold: 0.8,
    enableSampling: true
  },
  geoRestrictions: {
    blockedCountries: ['US', 'CU', 'IR'],
    vpnDetection: true
  },
  tokenManagement: {
    requireManualApproval: true
  }
});

await riskSystem.initialize();
await riskSystem.start(matchingEngine, orderBook);
```

### Order Processing Integration
```javascript
async function processOrder(order) {
  // Comprehensive risk assessment
  const riskAssessment = await riskSystem.assessOrderRisk(order);
  
  if (!riskAssessment.allowed) {
    throw new Error(`Order blocked: ${riskAssessment.blocked.join(', ')}`);
  }
  
  // Process order...
  const result = await matchingEngine.submitOrder(order);
  
  // Record activity for risk tracking
  await riskSystem.recordUserActivity(order.userId, {
    volume: order.amount * order.price,
    orders: [order],
    request: { success: true, latency: 50 }
  });
  
  return result;
}
```

### User Onboarding Integration
```javascript
async function onboardUser(userId, userInfo) {
  // Location compliance check
  const locationRisk = await riskSystem.assessLocationRisk(userInfo.ip, userId);
  
  if (!locationRisk.allowed) {
    throw new Error(`Registration blocked: ${locationRisk.reason}`);
  }
  
  // Set initial limits based on user tier
  const positionLimits = riskSystem.components.get('positionLimits');
  await positionLimits.setUserLimits(userId, {
    maxPosition: userInfo.tier === 'verified' ? 500000 : 10000,
    tier: userInfo.tier
  });
  
  const volumeRestrictions = riskSystem.components.get('volumeRestrictions');
  await volumeRestrictions.setUserVolumeLimit(userId, {
    daily: userInfo.tier === 'verified' ? 100000 : 10000,
    tier: userInfo.tier
  });
}
```

### Real-time Risk Monitoring
```javascript
// Listen for risk events
riskSystem.on('risk_event', (event) => {
  console.log(`Risk event: ${event.type}`, event.data);
  
  switch (event.type) {
    case 'emergency_stop':
      // Immediate action required
      notifyRiskTeam(event);
      break;
      
    case 'volume_violation':
      // Log for investigation
      logViolation(event);
      break;
      
    case 'unusual_activity_detected':
      // Queue for manual review
      queueForReview(event);
      break;
  }
});

// System health monitoring
riskSystem.on('health_check', (health) => {
  if (health.systemHealth === 'critical') {
    // Alert operations team
    alertOpsTeam(health);
  }
});
```

## Configuration Reference

### Environment Variables
```bash
# Redis Configuration
REDIS_URL=redis://localhost:6379
REDIS_PASSWORD=your-redis-password

# API Keys for External Services
MAXMIND_API_KEY=your-maxmind-key
IPAPI_KEY=your-ipapi-key
COINGECKO_API_KEY=your-coingecko-key
CMC_API_KEY=your-coinmarketcap-key

# Encryption
METRICS_ENCRYPTION_KEY=your-32-character-encryption-key

# Webhooks
RISK_ALERT_WEBHOOK=https://your-alert-endpoint.com/webhook
SLACK_WEBHOOK=https://hooks.slack.com/your-webhook
```

### Configuration File
```javascript
module.exports = {
  // Position Limits Configuration
  positionLimits: {
    defaultMaxPosition: 100000,
    defaultMaxLeverage: 10,
    tierLimits: {
      basic: { maxPosition: 10000, maxLeverage: 3 },
      verified: { maxPosition: 100000, maxLeverage: 10 },
      professional: { maxPosition: 1000000, maxLeverage: 20 },
      institutional: { maxPosition: 10000000, maxLeverage: 50 }
    },
    emergencyStopThreshold: 0.95,
    warningThreshold: 0.8
  },
  
  // Volume Restrictions Configuration
  volumeRestrictions: {
    defaultDailyLimit: 100000,
    defaultWeeklyLimit: 500000,
    tierLimits: {
      verified: { daily: 1000000, weekly: 5000000 },
      institutional: { daily: 10000000, weekly: 50000000 }
    },
    warningThreshold: 0.8,
    emergencyThreshold: 0.95
  },
  
  // Circuit Breaker Configuration
  circuitBreakers: {
    failureThreshold: 10,
    timeWindow: 60000,
    resetWindow: 300000,
    systemBreakers: {
      trading: { enabled: true, priority: 'critical' },
      withdrawal: { enabled: true, priority: 'high' },
      api: { enabled: true, priority: 'medium' }
    }
  },
  
  // ML Detection Configuration
  mlDetection: {
    anomalyThreshold: 0.8,
    features: [
      'transaction_frequency',
      'volume_patterns', 
      'cancellation_rate',
      'market_timing'
    ],
    enableSampling: true,
    sampleRate: 0.1
  },
  
  // Geographic Restrictions Configuration
  geoRestrictions: {
    blockedCountries: ['US', 'CU', 'IR', 'KP', 'SY'],
    restrictedCountries: ['CN', 'RU'],
    vpnDetection: true,
    complianceFrameworks: {
      OFAC: { enabled: true, priority: 'critical' },
      EU_SANCTIONS: { enabled: true, priority: 'high' }
    }
  },
  
  // Token Management Configuration
  tokenManagement: {
    defaultWhitelist: ['ETH', 'BTC', 'USDC', 'USDT', 'DAI'],
    autoBlacklistCriteria: {
      volatilityThreshold: 0.5,
      liquidityThreshold: 10000,
      marketCapThreshold: 100000
    },
    requireManualApproval: true,
    autoApprovalThreshold: 0.9
  }
};
```

## API Reference

### Risk Assessment APIs
```javascript
// User risk assessment
const userRisk = await riskSystem.assessUserRisk('user123', activityData);

// Location risk assessment  
const locationRisk = await riskSystem.assessLocationRisk('1.2.3.4', 'user123');

// Token risk assessment
const tokenRisk = await riskSystem.assessTokenRisk('NEWTOKEN');

// Order risk assessment
const orderRisk = await riskSystem.assessOrderRisk(order);
```

### System Status APIs
```javascript
// Overall system status
const status = riskSystem.getSystemStatus();

// Component-specific status
const positionStatus = riskSystem.getComponentStatus('positionLimits');
const volumeStatus = riskSystem.getComponentStatus('volumeRestrictions');
```

### Activity Recording APIs
```javascript
// Record user activity
await riskSystem.recordUserActivity('user123', {
  volume: 5000,
  position: { pair: 'ETH/USDT', size: 10, value: 25000 },
  orders: [order1, order2],
  request: { success: true, latency: 45 }
});
```

## Monitoring and Alerts

### Metrics
The system exposes comprehensive metrics via the secure metrics collector:

- **Position Limits**: `position_limits.violations`, `position_limits.emergency_stops`
- **Volume Restrictions**: `volume_restrictions.violations`, `volume_restrictions.suspended_users`
- **Circuit Breakers**: `circuit_breaker.trips`, `circuit_breaker.system_availability`
- **ML Detection**: `ml_detector.anomalies_detected`, `ml_detector.predictions_per_second`
- **Geo Restrictions**: `geo_restrictions.blocked_requests`, `geo_restrictions.suspicious_locations`
- **Token Management**: `token_management.tokens_blacklisted`, `token_management.approval_requests`

### Grafana Dashboard
Import the provided dashboard configuration for comprehensive monitoring:

```json
{
  "dashboard": {
    "title": "Risk Management Dashboard",
    "panels": [
      {
        "title": "Risk Events by Type",
        "type": "stat",
        "targets": [
          {
            "expr": "rate(risk_management_risk_events_total[5m])",
            "legendFormat": "{{type}}"
          }
        ]
      }
    ]
  }
}
```

### Alert Rules
Configure alerts for critical risk events:

```yaml
groups:
  - name: risk_management
    rules:
      - alert: EmergencyStopActivated
        expr: increase(position_limits_emergency_stops_total[5m]) > 0
        labels:
          severity: critical
        annotations:
          summary: "Emergency stop activated for user positions"
          
      - alert: CircuitBreakerOpen
        expr: circuit_breaker_state > 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Circuit breaker opened: {{$labels.breakerId}}"
```

## Security Considerations

### Data Protection
- All sensitive data is encrypted using AES-256-GCM
- User identifiers are hashed in logs and metrics
- IP addresses are anonymized for privacy compliance
- Redis connections use TLS encryption

### Access Control
- Component-level access controls with JWT authentication
- Role-based permissions for risk management operations
- Audit logging for all risk decisions and configuration changes
- Rate limiting on all external API calls

### Compliance
- GDPR compliance with data retention policies
- SOX compliance with audit trails
- PCI DSS compliance for payment data handling
- Regular security assessments and penetration testing

## Performance Optimization

### Caching Strategy
- LRU caches with TTL for frequently accessed data
- Redis clustering for high-availability data storage
- Connection pooling for external API calls
- Batch processing for bulk operations

### Scaling Guidelines
- Horizontal scaling support with stateless components
- Load balancing with sticky sessions for user data
- Database sharding for large-scale deployments
- Microservice architecture for independent scaling

### Resource Management
- Memory usage monitoring with automatic cleanup
- Circuit breakers to prevent cascade failures
- Rate limiting to protect external dependencies
- Graceful degradation when components fail

## Troubleshooting

### Common Issues

#### High Memory Usage
```bash
# Check memory usage
curl http://localhost:8080/api/v1/risk/status

# Force cleanup
curl -X POST http://localhost:8080/api/v1/risk/cleanup
```

#### Component Failures
```bash
# Check component health
curl http://localhost:8080/api/v1/risk/components/positionLimits

# Restart component
curl -X POST http://localhost:8080/api/v1/risk/components/positionLimits/restart
```

#### Performance Issues
```bash
# Check performance metrics
curl http://localhost:8080/api/v1/risk/performance

# Enable debug logging
export LOG_LEVEL=debug
```

### Log Analysis
```bash
# Monitor risk events
tail -f logs/risk-events.log | jq '.type'

# Filter by severity
tail -f logs/risk-events.log | jq 'select(.severity == "critical")'

# Monitor component health
tail -f logs/health-checks.log | jq '.systemHealth'
```

## Support

For additional support:
- Review the troubleshooting section above
- Check component-specific status endpoints
- Enable debug logging for detailed information
- Contact the risk management team for complex issues

---

This risk management system provides enterprise-grade protection for DEX operations with comprehensive monitoring, real-time decision making, and regulatory compliance.