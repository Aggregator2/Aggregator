# SettlementQueueV5 - Production Deployment Guide

## Overview

SettlementQueueV5 represents the production-ready, security-hardened version of our anti-MEV settlement system. This guide covers deployment, configuration, monitoring, and operational procedures.

## Security Enhancements in V5

### Critical Vulnerabilities Fixed

1. **Multi-Block Reentrancy Protection**
   - Prevents cross-block reentrancy attacks
   - Tracks transactions across multiple blocks
   - Uses hybrid nonce + block number validation

2. **Integer Overflow Protection**
   - SafeMath operations throughout
   - Bounds checking on all arithmetic
   - Overflow-resistant price calculations

3. **Enhanced Oracle Security**
   - Multi-oracle price aggregation
   - TWAP implementation with 15-minute windows
   - Circuit breakers for price deviations >10%
   - Staleness protection (5-minute maximum)

4. **Economic Security Mechanisms**
   - Increased operator bond requirement (32 ETH)
   - Proportional slashing penalties
   - Insurance fund for failed settlements
   - Pull payment pattern for all ETH transfers

5. **Signature Security**
   - EIP-712 structured signatures with domain separation
   - Nonce-based replay protection
   - Signature expiration enforcement (30 minutes)
   - Malleability protection

## Prerequisites

### Smart Contract Dependencies

```solidity
// Required OpenZeppelin contracts
@openzeppelin/contracts/access/AccessControl.sol
@openzeppelin/contracts/utils/ReentrancyGuard.sol
@openzeppelin/contracts/utils/Pausable.sol
@openzeppelin/contracts/token/ERC20/IERC20.sol
@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol
@openzeppelin/contracts/utils/structs/EnumerableSet.sol
@openzeppelin/contracts/utils/cryptography/ECDSA.sol
@openzeppelin/contracts/utils/cryptography/MerkleProof.sol
@openzeppelin/contracts/utils/cryptography/EIP712.sol
```

### Infrastructure Requirements

- **Ethereum Node**: Full node with WebSocket support
- **Redis Cluster**: For mempool monitoring and caching
- **PostgreSQL**: For order history and analytics
- **Monitoring**: Prometheus + Grafana setup
- **Alerting**: PagerDuty or similar for security alerts

## Deployment Steps

### 1. Contract Deployment

```javascript
// deployment script
const SettlementQueueV5 = await ethers.getContractFactory("SettlementQueueV5");

const initialTokens = [
  "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // WETH
  "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC
  "0x6B175474E89094C44Da98b954EedeAC495271d0F"  // DAI
];

const initialLimits = [
  ethers.utils.parseUnits("1000", 18),    // 1k WETH
  ethers.utils.parseUnits("1000000", 6),  // 1M USDC
  ethers.utils.parseUnits("1000000", 18)  // 1M DAI
];

const initialOracles = [
  "0x...", // Chainlink ETH/USD
  "0x...", // Uniswap V3 TWAP
  "0x..."  // Custom price oracle
];

const queueV5 = await SettlementQueueV5.deploy(
  ethers.utils.parseUnits("10000", 6), // Large settlement threshold
  initialTokens,
  initialLimits,
  initialOracles
);

await queueV5.deployed();
console.log("SettlementQueueV5 deployed to:", queueV5.address);
```

### 2. Role Configuration

```javascript
// Grant roles with proper security
const OPERATOR_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("OPERATOR_ROLE"));
const EXECUTOR_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("EXECUTOR_ROLE"));
const GUARDIAN_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("GUARDIAN_ROLE"));
const ORACLE_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("ORACLE_ROLE"));

// Multi-sig wallet addresses
const MULTISIG_ADMIN = "0x...";
const MULTISIG_GUARDIAN = "0x...";

// Grant roles to multi-sig wallets
await queueV5.grantRole(OPERATOR_ROLE, MULTISIG_ADMIN);
await queueV5.grantRole(GUARDIAN_ROLE, MULTISIG_GUARDIAN);

// Setup oracle nodes
const oracleNodes = ["0x...", "0x...", "0x..."];
for (const oracle of oracleNodes) {
  await queueV5.grantRole(ORACLE_ROLE, oracle);
}
```

### 3. Security Configuration

```javascript
// Initialize operator bonds
const operatorAddresses = ["0x...", "0x...", "0x..."];
for (const operator of operatorAddresses) {
  // Each operator must bond 32 ETH
  await queueV5.connect(operator).addOperatorBond({
    value: ethers.utils.parseEther("32")
  });
}

// Fund insurance pool
await queueV5.fundInsurance({
  value: ethers.utils.parseEther("100") // Initial 100 ETH
});
```

## Operational Procedures

### Order Processing Flow

1. **Commitment Phase**
   ```javascript
   // Generate secure commitment
   const orderHash = getSecureOrderHash(order);
   const salt = generateSecureSalt();
   const commitmentHash = keccak256(abi.encode(orderHash, salt, trader, timestamp));
   
   // Submit commitment with deposit
   const tx = await queueV5.commitOrderSecure(
     commitmentHash,
     ethers.utils.parseEther("0.1"), // 0.1 ETH deposit
     deadline
   );
   ```

2. **Reveal Phase** (after MEV protection delay)
   ```javascript
   // Reveal order details
   const revealTx = await queueV5.revealOrderSecure(
     commitmentId,
     order,
     salt
   );
   ```

3. **Processing Phase**
   ```javascript
   // Process via flashbot bundle for MEV protection
   const bundle = await createFlashbotBundle([
     await queueV5.processOrderSecure(orderId)
   ]);
   
   await submitFlashbotBundle(bundle);
   ```

### Monitoring and Alerting

#### Critical Metrics to Monitor

1. **Security Metrics**
   - Failed signature validations per hour
   - Anomaly detection triggers
   - Large order frequency
   - Gas price deviations
   - Oracle price deviations

2. **Performance Metrics**
   - Order processing latency
   - Gas consumption per order
   - Success rate percentage
   - Queue depth and processing rate

3. **Economic Metrics**
   - Total value locked
   - Insurance fund balance
   - Operator bond balances
   - Slashing events

#### Alert Configuration

```yaml
# Prometheus alerting rules
groups:
  - name: settlement_queue_alerts
    rules:
      - alert: AnomalyDetected
        expr: settlement_queue_anomalies_total > 5
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Settlement queue anomaly detected"
          
      - alert: OraclePriceDeviation
        expr: abs(oracle_price_deviation_percent) > 10
        for: 30s
        labels:
          severity: warning
        annotations:
          summary: "Oracle price deviation exceeded threshold"
          
      - alert: InsuranceFundLow
        expr: insurance_fund_balance_eth < 10
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Insurance fund running low"
```

### Emergency Procedures

#### Circuit Breaker Activation

1. **Automatic Triggers**
   - Price deviation >10% from TWAP
   - More than 50 orders per minute
   - Gas price >125% of baseline
   - Oracle consensus failure

2. **Manual Override**
   ```javascript
   // Emergency pause (Guardian role)
   await queueV5.connect(guardian).triggerEmergencyBreaker();
   
   // Controlled recovery after investigation
   await queueV5.connect(guardian).controlledUnpause();
   ```

#### Incident Response

1. **Immediate Actions**
   - Pause contract if not auto-paused
   - Alert security team
   - Begin forensic analysis
   - Communicate with users

2. **Investigation Steps**
   - Review transaction logs
   - Analyze failed orders
   - Check oracle data integrity
   - Verify operator behavior

3. **Recovery Process**
   - Address root cause
   - Test fix on testnet
   - Gradual system restoration
   - Post-incident review

## Security Best Practices

### Operator Security

1. **Multi-Signature Requirements**
   - All critical operations require 3/5 signatures
   - Regular key rotation (quarterly)
   - Hardware security modules for key storage

2. **Access Control**
   - Role-based permissions with time delays
   - Regular access reviews
   - Principle of least privilege

3. **Monitoring**
   - 24/7 SOC monitoring
   - Real-time anomaly detection
   - Automated threat response

### Oracle Security

1. **Multi-Source Aggregation**
   - Minimum 3 oracle sources
   - Weighted average pricing
   - Outlier detection and filtering

2. **Data Validation**
   - Price staleness checks
   - Volatility-based circuit breakers
   - Cross-validation between sources

### Economic Security

1. **Bonding Requirements**
   - 32 ETH minimum operator bond
   - Gradual slashing for misbehavior
   - Insurance fund maintenance

2. **Incentive Alignment**
   - Performance-based rewards
   - Long-term staking incentives
   - Reputation scoring system

## Maintenance and Upgrades

### Regular Maintenance

1. **Weekly Tasks**
   - Review security logs
   - Update oracle configurations
   - Check insurance fund balance
   - Validate operator bonds

2. **Monthly Tasks**
   - Security audit review
   - Performance optimization
   - Gas optimization analysis
   - Stress testing

### Upgrade Process

1. **Preparation**
   - Comprehensive testing on testnet
   - Security audit of changes
   - Migration script preparation
   - Stakeholder communication

2. **Deployment**
   - Phased rollout approach
   - Real-time monitoring
   - Rollback procedures ready
   - User impact assessment

## Testing and Validation

### Pre-Deployment Testing

1. **Unit Tests**
   ```bash
   npx hardhat test test/SettlementQueueV5.test.ts
   npx hardhat test test/SettlementQueueV5.edge-cases.test.ts
   ```

2. **Integration Tests**
   ```bash
   npx hardhat test test/integration/
   ```

3. **Security Tests**
   ```bash
   npx hardhat test test/security/
   ```

### Load Testing

```javascript
// Simulate high load scenarios
const stress_test = async () => {
  const promises = [];
  for (let i = 0; i < 100; i++) {
    promises.push(submitRandomOrder());
  }
  await Promise.all(promises);
};
```

## Support and Documentation

### API Documentation

- **Order Submission**: `/docs/api/orders.md`
- **Order Status**: `/docs/api/status.md`
- **Flashbot Integration**: `/docs/api/flashbots.md`

### Developer Resources

- **SDK Documentation**: `/docs/sdk/`
- **Integration Examples**: `/examples/`
- **Testing Framework**: `/docs/testing.md`

### Contact Information

- **Security Issues**: security@dex.com
- **Technical Support**: support@dex.com
- **Emergency Contact**: +1-XXX-XXX-XXXX (24/7)

---

**CRITICAL SECURITY NOTICE**: This system handles real value and is subject to various attack vectors. Always follow security best practices and never deploy without thorough testing and security audits.