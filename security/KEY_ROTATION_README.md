# Meta Aggregator 2.0 Key Rotation System

## Quick Setup

1. **Copy environment template:**
   ```bash
   copy security\.env.template .env.local
   ```

2. **Edit .env.local with your actual values:**
   - Update PRIVATE_KEY and ARBITER_PRIVATE_KEY
   - Set a secure KEY_ENCRYPTION_PASSWORD
   - Configure alert settings (optional)

3. **Initialize the system:**
   ```bash
   node key-rotation.js init
   ```

4. **Test the system:**
   ```bash
   node key-rotation.js test
   ```

## Key Rotation Commands

### Manual Rotation
```bash
# Rotate backend signing key
node security/key-rotation/orchestrator.js rotate PRIVATE_KEY

# Rotate escrow arbiter key  
node security/key-rotation/orchestrator.js rotate ARBITER_PRIVATE_KEY
```

### Emergency Rotation
```bash
# Emergency rotation due to security breach
node security/key-rotation/orchestrator.js emergency PRIVATE_KEY security_breach
```

### Start Automated Services
```bash
# Start scheduled rotation (runs in background)
node security/key-rotation/scheduled-rotation.js start

# Start monitoring service
node security/key-rotation/monitoring.js start

# Start complete orchestrator
node security/key-rotation/orchestrator.js start
```

### System Status
```bash
# Check system status
node security/key-rotation/orchestrator.js status

# Generate health report
node security/key-rotation/orchestrator.js report

# Run tests
node security/key-rotation/test-suite.js run
```

## File Structure

```
security/
├── key-rotation/
│   ├── KeyRotationManager.js     # Core rotation logic
│   ├── orchestrator.js           # Main orchestrator
│   ├── scheduled-rotation.js     # Automated scheduling
│   ├── event-rotation.js         # Event-based rotation
│   ├── monitoring.js             # Health monitoring
│   ├── validate-keys.js          # Key validation
│   ├── manual-rotation.js        # Manual rotation interface
│   └── test-suite.js             # Comprehensive tests
├── keys/                         # Encrypted key storage
├── backups/                      # Key backups
├── logs/                         # Rotation logs
└── .env.template                 # Environment template
```

## Security Features

- ✅ **AES-256-CBC Encryption** - All keys encrypted at rest
- ✅ **Versioned Key Storage** - Track key versions and history
- ✅ **Automated Backups** - Old keys safely backed up before rotation
- ✅ **Comprehensive Validation** - Test keys before activation
- ✅ **Event-Based Triggers** - React to security events
- ✅ **Scheduled Rotation** - Automatic 30-day rotation cycle
- ✅ **Emergency Procedures** - Fast rotation for security breaches
- ✅ **Health Monitoring** - Continuous system health checks
- ✅ **Alert System** - Email/Webhook/Slack notifications
- ✅ **Audit Logging** - Complete rotation history

## Production Deployment

1. Set NODE_ENV=production in environment
2. Configure proper alert channels
3. Set up monitoring dashboards
4. Test emergency procedures
5. Document incident response procedures

## Troubleshooting

### Common Issues

1. **Permission Errors**: Ensure proper file permissions for security/ directory
2. **Encryption Errors**: Verify KEY_ENCRYPTION_PASSWORD is set correctly
3. **Network Errors**: Check RPC_URL configuration
4. **Key Validation Fails**: Ensure keys are valid Ethereum private keys

### Support

- Check logs in security/logs/
- Run diagnostic: `node security/key-rotation/test-suite.js run`
- Validate configuration: `node security/key-rotation/orchestrator.js status`
