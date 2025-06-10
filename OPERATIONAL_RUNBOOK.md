# Meta Aggregator 2.0 - Operational Runbook

## Emergency Contacts

### On-Call Escalation Path
1. **Primary**: Joeri van der Klink (+1-555-0123) - Development Lead
2. **Secondary**: Operations Team (+1-555-0100) - 24/7 Support
3. **Escalation**: Security Team (+1-555-0911) - Critical Issues

### Communication Channels
- **Slack**: #emergency-response (immediate alerts)
- **Discord**: @joeri_dev (development issues)
- **Email**: operations@metaaggregator.com (non-urgent)
- **Status Page**: status.metaaggregator.com

## Quick Reference Commands

### Development Environment Setup
```bash
# Start local development
npm install
npx hardhat node                    # Terminal 1: Start Hardhat network
npm run dev                         # Terminal 2: Start Next.js dev server

# Deploy contracts locally
npx hardhat run scripts/deployWithCorrectArbiter.js --network localhost

# Fund arbiter for testing
node scripts/fundArbiter.js

# Test deposit functionality
node scripts/testDeposit.js
```

### Testing Commands
```bash
# Run all tests
npm test                           # Unit tests
npx hardhat test                   # Smart contract tests
npx cypress run                    # E2E tests

# Specific test suites
npx hardhat test test/Escrow.test.js
npx hardhat test test/Escrow.integration.test.js

# Test API endpoints
node "Backend server/routes/controllers/services/tests/signAndSend.js"
```

### Deployment Commands
```bash
# Production deployment
npm run build                      # Build Next.js app
npm run deploy:contracts          # Deploy smart contracts
npm run deploy:backend            # Deploy backend services
npm run deploy:frontend           # Deploy frontend

# Environment-specific deployments
npm run deploy:staging
npm run deploy:production
```

### Monitoring Commands
```bash
# Health checks
curl -f http://localhost:3000/api/health
curl -f https://api.metaaggregator.com/health

# Check contract status
npx hardhat run scripts/checkContractStatus.js --network mainnet

# Database status
node scripts/checkDatabase.js
```

## Emergency Response Procedures

### 1. System Down - Complete Outage

**IMMEDIATE ACTIONS (< 5 minutes)**
```powershell
# Step 1: Alert the team
# Send Slack message to #emergency-response
# Call primary on-call: Joeri (+1-555-0123)

# Step 2: Check external dependencies
curl -f https://api.0x.org/swap/v1/quote
curl -f https://api.coingecko.com/api/v3/ping

# Step 3: Check our services  
curl -f https://metaaggregator.com
curl -f https://api.metaaggregator.com/health

# Step 4: If services down, rollback latest deployment
vercel --prod rollback

# Step 5: Monitor recovery
# Run every 30 seconds until service restored
while ($true) { 
    try { 
        curl -s https://metaaggregator.com | Select-Object -First 1
        Write-Host "$(Get-Date): Service responding" 
    } catch { 
        Write-Host "$(Get-Date): Service still down" 
    }
    Start-Sleep 30 
}
```

**FOLLOW-UP ACTIONS (< 30 minutes)**
- Update status page: status.metaaggregator.com
- Send customer communication via email/social media
- Document incident in incident log

### 2. Smart Contract Issue

**CRITICAL SECURITY RESPONSE (< 2 minutes)**
```powershell
# Step 1: IMMEDIATELY notify security team
# Call Security Hotline: +1-555-0911
# Send message to #emergency-response with "SMART CONTRACT EXPLOIT SUSPECTED"

# Step 2: Check contract status
npx hardhat run scripts/checkEscrowStatus.js --network mainnet

# Step 3: If exploit suspected, pause contract (if pausable)
# ONLY if pausable function exists in contract
npx hardhat run scripts/pauseContract.js --network mainnet

# Step 4: Assess impact and funds at risk
npx hardhat run scripts/assessContractRisk.js --network mainnet

# Step 5: Deploy emergency fix if needed (Security Team approval required)
# npx hardhat run scripts/deployEmergencyFix.js --network mainnet
```

**POST-INCIDENT ACTIONS**
- Coordinate with external security auditors
- Prepare public disclosure timeline
- Document all actions taken

### 3. API Performance Issues
```bash
# Step 1: Check API metrics
curl -w "@curl-format.txt" -s -o /dev/null https://api.metaaggregator.com/api/orders

# Step 2: Check database performance
node scripts/checkDbPerformance.js

# Step 3: Scale if needed (cloud deployment)
kubectl scale deployment meta-aggregator-api --replicas=5

# Step 4: Monitor improvement
watch -n 10 'curl -w "Time: %{time_total}s\n" -s -o /dev/null https://api.metaaggregator.com/api/orders'
```

## Diagnostic Commands

### System Health Diagnostics
```bash
# Check all core services
node scripts/healthCheck.js

# Check external dependencies
node scripts/checkExternalApis.js

# Check database connectivity
node scripts/testDbConnection.js

# Check smart contract interactions
node scripts/testContractInteraction.js
```

### Performance Diagnostics
```bash
# API performance test
ab -n 100 -c 10 https://api.metaaggregator.com/api/orders

# Database performance test
node scripts/dbPerformanceTest.js

# Smart contract gas usage analysis
npx hardhat run scripts/analyzeGasUsage.js --network mainnet
```

## Recovery Procedures

### Database Recovery
```bash
# Create backup before any recovery
pg_dump production_db > backup_$(date +%Y%m%d_%H%M%S).sql

# Restore from backup
pg_restore --clean --if-exists -d production_db latest_backup.dump

# Verify data integrity
node scripts/verifyDataIntegrity.js
```

### Contract Recovery
```bash
# For upgradeable contracts
npx hardhat run scripts/upgradeContract.js --network mainnet

# For non-upgradeable contracts, deploy new version
npx hardhat run scripts/deployNewContract.js --network mainnet

# Update frontend configuration
node scripts/updateContractAddress.js
```

## Maintenance Procedures

### Daily Maintenance
```bash
# Check system health
node scripts/dailyHealthCheck.js

# Update monitoring dashboard
node scripts/updateMetrics.js

# Check for security alerts
npm audit
```

### Weekly Maintenance
```bash
# Database optimization
node scripts/optimizeDatabase.js

# Check dependency updates
npm outdated

# Performance analysis
node scripts/weeklyPerformanceReport.js
```

### Monthly Maintenance
```bash
# Full system backup
node scripts/fullSystemBackup.js

# Security audit
npm audit --audit-level high

# Capacity planning review
node scripts/capacityAnalysis.js
```

---

*This runbook should be kept alongside the main RELEASE_STRATEGY.md document*
