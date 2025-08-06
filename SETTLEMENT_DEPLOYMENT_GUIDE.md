# SettlementQueueV3 Deployment Guide

## Overview

This guide provides step-by-step instructions for deploying the SettlementQueueV3 smart contract system to production networks.

## Prerequisites

### Development Environment
- Node.js >= 16.0.0
- Hardhat >= 2.12.0
- TypeScript >= 4.8.0
- OpenZeppelin Contracts >= 4.8.0

### Network Requirements
- Ethereum Mainnet or compatible L2
- Gas oracle for EIP-1559 optimization
- Multi-signature wallet setup
- Monitoring infrastructure

## Deployment Steps

### 1. Environment Configuration

Create deployment configuration:

```bash
# Copy environment template
cp .env.example .env.production

# Configure network settings
NETWORK=mainnet
RPC_URL=https://mainnet.infura.io/v3/YOUR_PROJECT_ID
PRIVATE_KEY=your_deployer_private_key
ETHERSCAN_API_KEY=your_etherscan_api_key

# Multi-sig addresses
ADMIN_MULTISIG=0x...
GUARDIAN_MULTISIG=0x...
EMERGENCY_MULTISIG=0x...
```

### 2. Pre-Deployment Verification

Run comprehensive tests:

```bash
# Run all test suites
npm run test

# Run critical security tests
npx hardhat test test/SettlementQueueV3.critical.test.ts

# Run gas optimization benchmarks
npx hardhat test --grep "Performance Benchmarks"

# Verify gas usage targets
npx hardhat test --grep "gas efficiency"
```

Expected results:
- ✅ All tests passing (100% success rate)
- ✅ Gas usage < 20k per settlement
- ✅ Security tests passing
- ✅ No critical vulnerabilities

### 3. Contract Deployment

Deploy in the following order:

#### Step 3.1: Deploy Mock Tokens (Testnet Only)
```bash
npx hardhat run scripts/deploy-mock-tokens.ts --network testnet
```

#### Step 3.2: Deploy SettlementQueueV3
```bash
npx hardhat run scripts/deploy-settlement-queue-v3.ts --network mainnet
```

#### Step 3.3: Verify Contract
```bash
npx hardhat verify --network mainnet CONTRACT_ADDRESS \
  1000000000 \  # largeSettlementThreshold (1000 USDC)
  "[\"0xA0b86a33E6C1c8EfA6B71847c5FC73Aa8D331D3A\",\"0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2\"]" \  # [USDC, WETH]
  "[\"1000000000000\",\"1000000000000000000000\"]" \  # [1M USDC, 1k WETH] daily limits
  0x0000000000000000000000000000000000000000  # gasOracle (set to zero for manual)
```

### 4. Initial Configuration

#### Step 4.1: Role Setup
```solidity
// Grant roles to multi-sig addresses
await queueV3.grantRole(OPERATOR_ROLE, OPERATOR_MULTISIG);
await queueV3.grantRole(EXECUTOR_ROLE, EXECUTOR_MULTISIG);
await queueV3.grantRole(GUARDIAN_ROLE, GUARDIAN_MULTISIG);
await queueV3.grantRole(EMERGENCY_ROLE, EMERGENCY_MULTISIG);
await queueV3.grantRole(INSURANCE_ROLE, INSURANCE_MULTISIG);

// Revoke deployer admin role
await queueV3.renounceRole(DEFAULT_ADMIN_ROLE, deployer.address);
```

#### Step 4.2: Economic Security Setup
```solidity
// Operators add bonds (minimum 10 ETH each)
await queueV3.connect(operator1).addOperatorBond({ value: ethers.utils.parseEther("10") });
await queueV3.connect(operator2).addOperatorBond({ value: ethers.utils.parseEther("10") });

// Fund insurance pool (100 ETH initial funding)
await queueV3.connect(insurance).fundInsurance({ value: ethers.utils.parseEther("100") });
```

#### Step 4.3: Token Configuration
```solidity
// Configure additional tokens if needed
await queueV3.whitelistToken(DAI_ADDRESS, ethers.utils.parseUnits("1000000", 18)); // 1M DAI daily
await queueV3.whitelistToken(USDT_ADDRESS, ethers.utils.parseUnits("1000000", 6)); // 1M USDT daily
```

### 5. Security Hardening

#### Step 5.1: Access Control Validation
```bash
# Verify role assignments
npx hardhat run scripts/verify-roles.ts --network mainnet
```

#### Step 5.2: Economic Parameters Check
```bash
# Verify bond requirements and insurance fund
npx hardhat run scripts/verify-economic-security.ts --network mainnet
```

#### Step 5.3: Emergency Procedures Test
```bash
# Test emergency pause/unpause (testnet only)
npx hardhat run scripts/test-emergency-procedures.ts --network testnet
```

### 6. Monitoring Setup

#### Step 6.1: Event Monitoring
```javascript
// Monitor critical events
queueV3.on("SecurityAlert", (alertType, actor, details, timestamp, severity) => {
  if (severity >= 3) {
    notifySecurityTeam({
      type: alertType,
      actor,
      details,
      timestamp,
      severity
    });
  }
});

queueV3.on("AnomalyDetected", (anomalyType, metricValue, threshold, reporter) => {
  notifyOpsTeam({
    type: "Anomaly Detected",
    metric: metricValue,
    threshold,
    reporter
  });
});
```

#### Step 6.2: Performance Monitoring
```javascript
// Monitor gas usage and processing times
queueV3.on("SettlementProcessed", (settlementId, executor, gasUsed, gasPrice, success, txHash) => {
  logMetrics({
    settlementId,
    gasUsed,
    gasPrice,
    success,
    timestamp: Date.now()
  });
  
  if (gasUsed > 25000) {
    alertOpsTeam(`High gas usage detected: ${gasUsed} gas for settlement ${settlementId}`);
  }
});
```

### 7. Post-Deployment Verification

#### Step 7.1: Smoke Tests
```bash
# Run basic functionality tests
npx hardhat run scripts/smoke-tests.ts --network mainnet
```

#### Step 7.2: Security Validation
```bash
# Verify all security features are active
npx hardhat run scripts/security-validation.ts --network mainnet
```

#### Step 7.3: Performance Validation
```bash
# Test gas efficiency in production
npx hardhat run scripts/performance-validation.ts --network mainnet
```

## Configuration Parameters

### Critical Parameters

| Parameter | Mainnet Value | Description |
|-----------|---------------|-------------|
| `MIN_OPERATOR_BOND` | 10 ETH | Minimum bond for operators |
| `SLASHING_PENALTY` | 1 ETH | Penalty per slashing event |
| `MEV_PROTECTION_DELAY` | 12 seconds | Maximum MEV delay |
| `ANOMALY_THRESHOLD` | 100/minute | Settlement rate limit |
| `FLASH_LOAN_WINDOW` | 2 blocks | Flash loan detection window |
| `ROLE_CHANGE_DELAY` | 24 hours | Role change time lock |

### Token Limits

| Token | Daily Limit | Purpose |
|-------|-------------|---------|
| USDC | 1,000,000 | Primary stablecoin |
| USDT | 1,000,000 | Secondary stablecoin |
| DAI | 1,000,000 | Decentralized stablecoin |
| WETH | 1,000 | Primary ETH wrapper |

## Emergency Procedures

### Security Incident Response

1. **Immediate Response** (< 5 minutes)
   - Emergency role triggers pause
   - All settlements halt immediately
   - Incident assessment begins

2. **Investigation** (< 30 minutes)
   - Guardian role analyzes situation
   - Determine root cause
   - Assess impact scope

3. **Resolution** (< 2 hours)
   - Implement fixes if needed
   - Guardian role authorizes unpause
   - Resume normal operations

### Emergency Contacts

- **Security Team**: security@yourproject.com
- **Operations Team**: ops@yourproject.com
- **Development Team**: dev@yourproject.com

## Monitoring Dashboard

### Key Metrics

1. **Security Metrics**
   - Active security alerts
   - Anomaly detection status
   - Operator bond levels
   - Insurance fund balance

2. **Performance Metrics**
   - Average gas per settlement
   - Queue processing time
   - Settlement success rate
   - MEV protection effectiveness

3. **Economic Metrics**
   - Daily settlement volume
   - Reward distributions
   - Slashing events
   - Bond utilization

## Maintenance Procedures

### Regular Maintenance (Monthly)

1. **Security Review**
   - Audit operator bonds
   - Review slashing events
   - Validate role assignments

2. **Performance Review**
   - Analyze gas usage trends
   - Optimize queue parameters
   - Review anomaly thresholds

3. **Economic Review**
   - Assess insurance fund health
   - Evaluate reward mechanisms
   - Adjust economic parameters

### Upgrade Procedures

1. **Preparation**
   - Deploy new contract version
   - Run comprehensive tests
   - Prepare migration scripts

2. **Migration**
   - Pause current contract
   - Migrate critical state
   - Update monitoring systems

3. **Validation**
   - Verify migration success
   - Run post-migration tests
   - Resume operations

## Troubleshooting

### Common Issues

1. **High Gas Usage**
   - Check for inefficient transactions
   - Validate optimization settings
   - Consider batch processing

2. **Security Alerts**
   - Investigate alert source
   - Verify threat legitimacy
   - Take appropriate action

3. **Queue Congestion**
   - Analyze priority distribution
   - Consider parameter adjustments
   - Scale processing capacity

### Support Resources

- Documentation: `/docs/`
- Test Suite: `/test/`
- Scripts: `/scripts/`
- Monitoring: `/monitoring/`

---

**Deployment Guide Version**: 3.0  
**Last Updated**: [Current Date]  
**Next Review**: Monthly or after significant updates