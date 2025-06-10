# Meta Aggregator 2.0 - Key Rotation System

## Overview

The Key Rotation System is a comprehensive security solution designed to automatically and manually rotate private keys used in the Meta Aggregator 2.0 escrow system. This system ensures that private keys are regularly updated to maintain security and reduce the risk of key compromise.

## Features

- **Automated Scheduled Rotation**: Keys are automatically rotated every 30 days
- **Event-Based Rotation**: Immediate rotation triggered by security events
- **Manual Rotation**: On-demand key rotation for maintenance or emergencies
- **Emergency Rotation**: Fast-track rotation for security breaches
- **Comprehensive Monitoring**: Health checks and alerting system
- **Secure Storage**: AES-256-CBC encryption for stored keys
- **Backup System**: Automatic backup of old keys before rotation
- **Validation System**: Comprehensive testing of new keys before activation
- **Audit Logging**: Complete audit trail of all rotation events

## Architecture

### Core Components

1. **KeyRotationManager**: Core rotation logic and key management
2. **ScheduledRotationService**: Automated daily/weekly rotation checks
3. **EventBasedRotationService**: Real-time event-triggered rotations
4. **RotationMonitoringService**: Health monitoring and alerting
5. **KeyValidator**: Validation and testing of rotated keys
6. **KeyRotationOrchestrator**: Unified management interface

### Key Types Managed

- `PRIVATE_KEY`: Backend signing key for order settlement
- `ARBITER_PRIVATE_KEY`: Escrow arbiter key for contract operations

## Installation

### Prerequisites

```bash
# Required Node.js packages
npm install ethers crypto fs path events node-cron
```

### Environment Setup

Create or update your `.env.local` file with the following variables:

```bash
# Current keys (will be managed by rotation system)
PRIVATE_KEY=0x...
ARBITER_PRIVATE_KEY=0x...

# Rotation configuration
ROTATION_INTERVAL_DAYS=30
ROTATION_SCHEDULE="0 2 * * *"  # Daily at 2 AM
KEY_ENCRYPTION_PASSWORD=your_secure_password_here

# Monitoring configuration
MONITORING_INTERVAL=60  # Minutes between health checks

# Alert configuration
ALERT_EMAIL=admin@yourdomain.com
ALERT_WEBHOOK=https://your-webhook-url.com/alerts
SLACK_WEBHOOK=https://hooks.slack.com/services/...

# Blockchain configuration
RPC_URL=https://polygon-mainnet.infura.io/v3/your-key
TEST_RPC_URL=https://polygon-mumbai.infura.io/v3/your-key

# Contract addresses
ESCROW_CONTRACT_ADDRESS=0x...
FIXED_ESCROW_CONTRACT_ADDRESS=0x...
```

### Initialize the System

```bash
# Navigate to the key rotation directory
cd security/key-rotation

# Initialize the system (creates directories and initial setup)
node orchestrator.js init
```

## Usage

### Starting the System

Start all key rotation services (monitoring, scheduled rotation, event handling):

```bash
node orchestrator.js start
```

This will start:
- Scheduled rotation service (checks daily at 2 AM)
- Event-based rotation service (listens for security events)
- Monitoring service (health checks every hour)

### Manual Operations

#### Check System Status
```bash
node orchestrator.js status
```

#### Manual Key Rotation
```bash
# Rotate backend signing key
node orchestrator.js rotate PRIVATE_KEY

# Rotate escrow arbiter key
node orchestrator.js rotate ARBITER_PRIVATE_KEY
```

#### Emergency Rotation
```bash
# Emergency rotation for security breach
node orchestrator.js emergency PRIVATE_KEY security_breach

# Emergency rotation for key compromise
node orchestrator.js emergency ARBITER_PRIVATE_KEY key_compromise
```

#### Generate Health Report
```bash
node orchestrator.js report
```

#### Run System Tests
```bash
node orchestrator.js test
```

### Individual Service Management

#### Scheduled Rotation Service
```bash
# Start scheduled service
node scheduled-rotation.js start

# Check rotation status
node scheduled-rotation.js status

# Perform immediate check
node scheduled-rotation.js check

# Dry run mode (no actual rotations)
node scheduled-rotation.js start --dry-run
```

#### Monitoring Service
```bash
# Start monitoring
node monitoring.js start

# Perform health check
node monitoring.js check

# Generate report
node monitoring.js report
```

#### Manual Rotation Interface
```bash
# Interactive rotation interface
node manual-rotation.js

# Quick rotation
node manual-rotation.js rotate PRIVATE_KEY
```

#### Key Validation
```bash
# Validate all keys
node validate-keys.js validate

# Test specific key
node validate-keys.js test PRIVATE_KEY

# Comprehensive validation
node validate-keys.js comprehensive
```

#### Test Suite
```bash
# Run all tests
node test-suite.js run

# Generate test report
node test-suite.js report
```

## Event-Based Rotation

The system can automatically rotate keys based on security events:

### Security Events

```javascript
// Emit security breach event
eventService.emit('security_breach', {
    severity: 'critical',
    affectedKeys: ['PRIVATE_KEY', 'ARBITER_PRIVATE_KEY'],
    source: 'intrusion_detection'
});

// Emit authentication failure
eventService.emit('auth_failure', {
    keyType: 'PRIVATE_KEY',
    source: 'api_endpoint',
    timestamp: new Date().toISOString()
});

// Emit key compromise detection
eventService.emit('key_compromise', {
    keyType: 'ARBITER_PRIVATE_KEY',
    evidence: 'suspicious_transactions',
    severity: 'high'
});
```

### Custom Event Integration

You can integrate the event system with your existing monitoring:

```javascript
const EventBasedRotationService = require('./event-rotation');

const eventService = new EventBasedRotationService();

// Monitor failed API calls
app.use((req, res, next) => {
    if (res.statusCode === 401) {
        eventService.emit('auth_failure', {
            keyType: 'PRIVATE_KEY',
            source: req.ip,
            endpoint: req.path
        });
    }
    next();
});
```

## Monitoring and Alerting

### Health Check Dashboard

The monitoring service provides comprehensive health monitoring:

- **Key Age**: How long since last rotation
- **Rotation Status**: Whether rotation is due or overdue
- **Service Health**: Status of all rotation services
- **Alert Management**: Active alerts and their severity

### Alert Channels

Configure multiple alert channels for different severity levels:

1. **Critical Alerts** (immediate notification):
   - Email
   - Webhook
   - Slack
   - SMS (via Twilio integration)

2. **Warning Alerts** (regular notification):
   - Webhook
   - Slack

3. **Info Alerts** (logging only):
   - Log files
   - Monitoring dashboard

### Custom Alert Integration

```javascript
// Email alerts (using SendGrid)
const sendgrid = require('@sendgrid/mail');
sendgrid.setApiKey(process.env.SENDGRID_API_KEY);

// Webhook alerts
const alertWebhook = async (level, message, alerts) => {
    await fetch(process.env.ALERT_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            level,
            message,
            alerts,
            timestamp: new Date().toISOString(),
            service: 'key-rotation'
        })
    });
};
```

## Security Considerations

### Key Storage

- Keys are encrypted using AES-256-CBC before storage
- Encryption password should be stored securely (not in code)
- Old keys are backed up before rotation for audit purposes
- Key files have restricted permissions (600)

### Network Security

- Use HTTPS for all webhook communications
- Validate SSL certificates for external services
- Implement rate limiting for rotation endpoints
- Use VPN or private networks for production deployments

### Access Control

- Restrict access to key rotation scripts
- Use separate service accounts for rotation processes
- Implement audit logging for all key access
- Regular security reviews of rotation procedures

## Troubleshooting

### Common Issues

#### Key Rotation Fails
```bash
# Check system status
node orchestrator.js status

# Run validation tests
node validate-keys.js validate

# Check logs
tail -f security/rotation.log
```

#### Service Won't Start
```bash
# Check permissions
ls -la security/

# Verify environment variables
node -e "console.log(process.env.PRIVATE_KEY ? 'Key exists' : 'Key missing')"

# Test connectivity
node validate-keys.js test-connection
```

#### Monitoring Alerts Not Working
```bash
# Test alert channels
node monitoring.js check

# Verify webhook URLs
curl -X POST $ALERT_WEBHOOK -d '{"test": true}'

# Check notification settings
node orchestrator.js status
```

### Debug Mode

Enable debug logging:

```bash
export DEBUG=key-rotation:*
node orchestrator.js start
```

### Recovery Procedures

#### Restore from Backup
```bash
# List available backups
ls -la security/backups/

# Restore specific key
node manual-rotation.js restore PRIVATE_KEY backup_file.json
```

#### Emergency Key Reset
```bash
# Generate new keys immediately
node orchestrator.js emergency PRIVATE_KEY manual_reset
node orchestrator.js emergency ARBITER_PRIVATE_KEY manual_reset

# Update all dependent systems
# Update contract configurations
# Notify all stakeholders
```

## Best Practices

### Operational Procedures

1. **Regular Testing**: Run test suite monthly
2. **Backup Verification**: Verify backups can be restored
3. **Alert Testing**: Test all alert channels quarterly
4. **Security Reviews**: Annual security audit of rotation system
5. **Documentation Updates**: Keep procedures up to date

### Development Guidelines

1. **Environment Separation**: Use different keys for dev/staging/prod
2. **Testing**: Always run tests before deploying changes
3. **Code Reviews**: Review all changes to rotation logic
4. **Version Control**: Track all configuration changes
5. **Rollback Plans**: Always have rollback procedures ready

### Monitoring Best Practices

1. **Health Checks**: Monitor service health continuously
2. **Key Age Tracking**: Alert before rotation is due
3. **Performance Monitoring**: Track rotation success rates
4. **Capacity Planning**: Monitor storage and processing resources
5. **Incident Response**: Have clear escalation procedures

## API Reference

### KeyRotationManager

```javascript
const manager = new KeyRotationManager(config);

// Generate new key pair
const keyPair = manager.generateKeyPair();

// Rotate key
const result = await manager.rotateKey('PRIVATE_KEY', options);

// Emergency rotation
const result = await manager.emergencyRotateKey('PRIVATE_KEY', 'reason');

// Get rotation status
const status = await manager.getRotationStatus();
```

### ScheduledRotationService

```javascript
const service = new ScheduledRotationService(config);

// Start/stop service
service.start();
service.stop();

// Get status
const status = service.getStatus();

// Immediate check
await service.checkNow();
```

### EventBasedRotationService

```javascript
const service = new EventBasedRotationService(config);

// Emit events
service.emit('security_breach', eventData);
service.emit('auth_failure', eventData);
service.emit('key_compromise', eventData);

// Check cooldown
const inCooldown = service.isInCooldown('PRIVATE_KEY');
```

### RotationMonitoringService

```javascript
const service = new RotationMonitoringService(config);

// Start monitoring
service.start();

// Perform health check
await service.performHealthCheck();

// Generate report
const report = await service.generateHealthReport();
```

## Support

For issues with the key rotation system:

1. Check the troubleshooting section above
2. Review system logs in `security/rotation.log`
3. Run diagnostic tests: `node test-suite.js run`
4. Generate health report: `node orchestrator.js report`

## Changelog

### Version 1.0.0
- Initial implementation of key rotation system
- Support for PRIVATE_KEY and ARBITER_PRIVATE_KEY rotation
- Automated scheduled rotation
- Event-based rotation triggers
- Comprehensive monitoring and alerting
- Full test suite and validation system
