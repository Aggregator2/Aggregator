# SettlementQueueV5 - Operational Runbook

## Overview

This runbook provides step-by-step procedures for operating the SettlementQueueV5 anti-MEV settlement system in production. It covers normal operations, monitoring, incident response, and emergency procedures.

## Prerequisites

### Required Access
- Multi-signature wallet access (Guardian role)
- Monitoring dashboard credentials
- Emergency contact information
- Backup communication channels

### System Requirements
- 24/7 monitoring infrastructure
- Redundant oracle network
- Emergency response procedures
- Incident escalation protocols

## Normal Operations

### Daily Procedures

#### Morning Health Check (Every 8:00 AM UTC)

1. **System Status Verification**
   ```bash
   # Check contract status
   curl -X GET https://api.dex.com/health/settlement-queue
   
   # Verify oracle consensus
   curl -X GET https://api.dex.com/health/oracles
   
   # Check operator bonds
   curl -X GET https://api.dex.com/health/operator-bonds
   ```

2. **Performance Metrics Review**
   - Order processing latency: Target < 15 seconds
   - Gas efficiency: Target < 100k gas per order
   - Success rate: Target > 99.5%
   - Queue depth: Target < 100 pending orders

3. **Security Metrics Review**
   - Anomaly detection alerts: Should be 0
   - Failed signature validations: Should be < 5/hour
   - Oracle price deviations: Should be < 2%
   - Circuit breaker status: Should be inactive

#### Weekly Procedures (Every Monday 10:00 AM UTC)

1. **Oracle Performance Review**
   - Check price deviation patterns
   - Verify staleness metrics
   - Review consensus failures
   - Update oracle weights if needed

2. **Operator Bond Verification**
   - Verify all operators maintain 32+ ETH bonds
   - Check for pending withdrawals
   - Review slashing events
   - Validate operator performance metrics

3. **Insurance Fund Review**
   - Check current balance (target: 100+ ETH)
   - Review recent payouts
   - Analyze fund utilization trends
   - Schedule funding if needed

### Monthly Procedures

1. **Security Audit Review**
   - Review automated security scan results
   - Analyze suspicious activity reports
   - Update threat intelligence
   - Schedule external security review if needed

2. **Performance Optimization**
   - Analyze gas consumption trends
   - Review and optimize gas parameters
   - Update efficiency benchmarks
   - Implement optimization improvements

3. **Backup and Recovery Testing**
   - Test emergency recovery procedures
   - Verify backup system integrity
   - Update disaster recovery plans
   - Conduct failover simulations

## Monitoring and Alerting

### Critical Alerts (Immediate Response Required)

#### Security Alerts

1. **Multi-Block Reentrancy Detected**
   ```
   Alert: MultiBlockReentrancy detected
   Severity: CRITICAL
   Action: Immediate investigation and potential circuit breaker activation
   ```
   
   **Response Steps:**
   1. Verify alert authenticity
   2. Trigger emergency circuit breaker if confirmed
   3. Begin forensic analysis
   4. Notify security team immediately
   5. Prepare incident report

2. **Oracle Price Manipulation**
   ```
   Alert: Price deviation >10% detected
   Severity: HIGH
   Action: Verify oracle integrity and consider circuit breaker
   ```
   
   **Response Steps:**
   1. Check all oracle sources
   2. Validate TWAP calculations
   3. Investigate potential manipulation
   4. Update oracle weights if needed
   5. Consider temporary circuit breaker

3. **Anomalous Activity Pattern**
   ```
   Alert: Unusual transaction patterns detected
   Severity: MEDIUM-HIGH
   Action: Investigate potential attack
   ```
   
   **Response Steps:**
   1. Analyze transaction patterns
   2. Check for MEV attacks
   3. Review affected orders
   4. Implement additional protections if needed

#### Operational Alerts

1. **Circuit Breaker Triggered**
   ```
   Alert: Automatic circuit breaker activated
   Severity: HIGH
   Action: Investigate cause and plan recovery
   ```
   
   **Response Steps:**
   1. Identify trigger cause
   2. Assess system state
   3. Fix underlying issue
   4. Plan controlled recovery
   5. Resume operations safely

2. **Oracle Consensus Failure**
   ```
   Alert: Oracle consensus lost
   Severity: HIGH
   Action: Restore oracle network integrity
   ```
   
   **Response Steps:**
   1. Check oracle node status
   2. Verify network connectivity
   3. Restart failed oracle nodes
   4. Validate price data integrity
   5. Resume normal operations

3. **Insurance Fund Low**
   ```
   Alert: Insurance fund below 50 ETH
   Severity: MEDIUM
   Action: Schedule fund replenishment
   ```
   
   **Response Steps:**
   1. Calculate required funding
   2. Coordinate with treasury
   3. Execute funding transaction
   4. Verify fund balance
   5. Update monitoring thresholds

### Performance Alerts

1. **High Gas Usage**
   ```
   Alert: Average gas >150k per order
   Severity: MEDIUM
   Action: Investigate efficiency degradation
   ```

2. **Slow Order Processing**
   ```
   Alert: Processing latency >30 seconds
   Severity: MEDIUM
   Action: Check system performance
   ```

3. **Queue Backlog**
   ```
   Alert: >200 orders in queue
   Severity: MEDIUM
   Action: Scale processing capacity
   ```

## Incident Response Procedures

### Severity Classification

- **CRITICAL**: System compromise, fund loss, complete outage
- **HIGH**: Security threats, major performance degradation
- **MEDIUM**: Minor issues, degraded performance
- **LOW**: Cosmetic issues, non-urgent improvements

### Incident Response Team

- **Incident Commander**: Senior DevOps Engineer
- **Security Lead**: Security Engineer
- **Development Lead**: Senior Developer
- **Communications Lead**: Product Manager

### Response Procedures

#### Critical Incident Response

1. **Immediate Actions (0-15 minutes)**
   - Confirm incident severity
   - Activate incident response team
   - Trigger circuit breaker if needed
   - Begin preliminary investigation

2. **Investigation Phase (15-60 minutes)**
   - Gather system logs
   - Analyze transaction data
   - Identify root cause
   - Assess impact scope

3. **Containment Phase (1-4 hours)**
   - Implement containment measures
   - Stop ongoing attacks
   - Preserve evidence
   - Coordinate with external partners

4. **Recovery Phase (4-24 hours)**
   - Develop recovery plan
   - Test solutions
   - Implement fixes
   - Gradually restore service

5. **Post-Incident Phase (24-72 hours)**
   - Conduct post-mortem
   - Document lessons learned
   - Update procedures
   - Implement preventive measures

## Emergency Procedures

### Circuit Breaker Activation

**Manual Activation:**
```solidity
// Guardian role required
await queueV5.connect(guardian).triggerEmergencyBreaker();
```

**When to Activate:**
- Suspected security breach
- Oracle manipulation detected
- Unusual loss patterns
- System instability

### Emergency Recovery

**Controlled System Resume:**
```solidity
// After investigation and fixes
await queueV5.connect(guardian).controlledUnpause();
```

**Recovery Checklist:**
- [ ] Root cause identified and fixed
- [ ] All security systems validated
- [ ] Oracle integrity confirmed
- [ ] Monitoring systems operational
- [ ] Team approval obtained

### Fund Recovery Procedures

**If User Funds at Risk:**

1. **Immediate Isolation**
   - Pause all operations
   - Prevent further transactions
   - Secure remaining funds

2. **Assessment**
   - Calculate total exposure
   - Identify affected users
   - Determine recovery options

3. **Recovery Execution**
   - Execute emergency withdrawals
   - Use insurance fund if needed
   - Coordinate user communications

## Maintenance Procedures

### Planned Maintenance Windows

**Monthly Maintenance (First Sunday 02:00 UTC)**

1. **Pre-Maintenance (T-24 hours)**
   - Announce maintenance window
   - Verify backup systems
   - Prepare rollback procedures

2. **Maintenance Execution (T-0)**
   - Enable maintenance mode
   - Perform updates
   - Test functionality
   - Validate performance

3. **Post-Maintenance (T+2 hours)**
   - Resume normal operations
   - Monitor system stability
   - Validate all functions
   - Update documentation

### Emergency Maintenance

**When Required:**
- Critical security patches
- Zero-day vulnerability fixes
- Oracle network updates
- Performance critical fixes

**Procedure:**
1. Assess urgency and impact
2. Notify stakeholders immediately
3. Execute minimum necessary changes
4. Verify system integrity
5. Document all changes

## Key Rotation Procedures

### Monthly Key Rotation

1. **Generate New Keys**
   ```bash
   # Generate new operator keys
   node scripts/generate-operator-keys.js
   
   # Generate new oracle keys
   node scripts/generate-oracle-keys.js
   ```

2. **Update Contract Configuration**
   ```solidity
   // Update operator addresses
   await queueV5.updateOperator(oldAddress, newAddress);
   
   // Update oracle addresses
   await queueV5.updateOracle(oldAddress, newAddress);
   ```

3. **Validation**
   - Test new key functionality
   - Verify access permissions
   - Update monitoring systems
   - Destroy old keys securely

### Emergency Key Rotation

**Triggered by:**
- Suspected key compromise
- Security incident
- Personnel changes
- Audit requirements

**Immediate Actions:**
1. Revoke compromised keys
2. Generate new keys
3. Update all systems
4. Notify security team
5. Investigate compromise

## Contact Information

### Primary Contacts

- **Incident Commander**: +1-XXX-XXX-XXXX
- **Security Lead**: +1-XXX-XXX-XXXX
- **On-Call Engineer**: +1-XXX-XXX-XXXX

### Secondary Contacts

- **CTO**: +1-XXX-XXX-XXXX
- **Security Consultant**: +1-XXX-XXX-XXXX
- **External Auditor**: +1-XXX-XXX-XXXX

### Communication Channels

- **Slack**: #settlement-queue-alerts
- **PagerDuty**: settlement-queue-team
- **Email**: security-incidents@dex.com
- **Discord**: #emergency-response

## Documentation References

- **API Documentation**: `/docs/api/settlement-queue-v5.md`
- **Security Procedures**: `/docs/security/incident-response.md`
- **Monitoring Setup**: `/docs/monitoring/grafana-dashboards.md`
- **Deployment Guide**: `/ANTI_MEV_V5_DEPLOYMENT_GUIDE.md`

---

**IMPORTANT**: This runbook contains sensitive operational procedures. Access should be restricted to authorized personnel only. Regular updates are required to maintain effectiveness.