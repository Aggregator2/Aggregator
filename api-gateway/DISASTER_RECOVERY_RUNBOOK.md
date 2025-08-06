# Disaster Recovery Runbook
**Version**: 2.0  
**Last Updated**: July 12, 2025  
**Classification**: CONFIDENTIAL  

---

## Table of Contents

1. [Overview](#overview)
2. [Emergency Contacts](#emergency-contacts)
3. [Disaster Scenarios](#disaster-scenarios)
4. [Recovery Procedures](#recovery-procedures)
5. [RTO/RPO Targets](#rtorpo-targets)
6. [Escalation Matrix](#escalation-matrix)
7. [Testing Procedures](#testing-procedures)
8. [Post-Recovery Actions](#post-recovery-actions)

---

## Overview

This runbook provides step-by-step procedures for recovering from various disaster scenarios affecting the SettlementQueue API Gateway. All procedures are designed to meet our **RTO (Recovery Time Objective) of 15 minutes** and **RPO (Recovery Point Objective) of 5 minutes**.

### Critical Success Factors
- **Maximum tolerable downtime**: 15 minutes
- **Maximum acceptable data loss**: 5 minutes
- **Business continuity**: 99.9% availability target
- **Customer notification**: Within 5 minutes of incident

---

## Emergency Contacts

### Primary Response Team
| Role | Name | Phone | Email | Backup |
|------|------|-------|--------|---------|
| **Incident Commander** | John Smith | +1-555-0101 | john.smith@company.com | Jane Doe |
| **Technical Lead** | Sarah Johnson | +1-555-0102 | sarah.johnson@company.com | Mike Chen |
| **Database Admin** | Mike Chen | +1-555-0103 | mike.chen@company.com | Sarah Johnson |
| **DevOps Lead** | Jane Doe | +1-555-0104 | jane.doe@company.com | John Smith |
| **Security Lead** | Alex Kim | +1-555-0105 | alex.kim@company.com | Tom Wilson |

### Management Escalation
| Role | Name | Phone | Email |
|------|------|-------|--------|
| **CTO** | Robert Brown | +1-555-0201 | robert.brown@company.com |
| **CEO** | Linda Garcia | +1-555-0301 | linda.garcia@company.com |

### External Contacts
| Service | Contact | Phone | Email |
|---------|---------|-------|--------|
| **AWS Support** | Enterprise Support | +1-800-AWS-HELP | aws-support@company.com |
| **CloudFlare** | Enterprise Support | +1-855-253-7638 | cloudflare@company.com |
| **Monitoring (PagerDuty)** | Support | +1-844-732-4774 | support@pagerduty.com |

---

## Disaster Scenarios

### Scenario Classification

#### **Severity 1 (Critical)**
- Complete API Gateway failure
- Primary region total outage
- Database corruption with data loss
- Security breach with data compromise

#### **Severity 2 (High)**
- Partial service degradation
- Single region failure with backup available
- Performance degradation >300% normal response time
- Limited security incident

#### **Severity 3 (Medium)**
- Minor service impacts
- Backup system failures
- Non-critical component failures

---

## Recovery Procedures

### **SCENARIO 1: Primary Region Total Failure**

**RTO Target**: 10 minutes  
**RPO Target**: 5 minutes  

#### **Step 1: Immediate Assessment (0-2 minutes)**

```bash
# 1. Verify region failure scope
curl -I https://api.settlementqueue.com/health
dig api.settlementqueue.com

# 2. Check monitoring dashboards
# - CloudWatch: us-east-1 metrics
# - Grafana: System overview
# - PagerDuty: Incident correlation

# 3. Confirm with AWS Status Page
# https://status.aws.amazon.com/
```

#### **Step 2: Initiate Emergency Response (2-3 minutes)**

```bash
# 1. Activate incident response team
# Send alerts via PagerDuty/Slack

# 2. Notify stakeholders
# Customer status page update
# Internal communication via Slack #incidents

# 3. Document incident start time
echo "INCIDENT START: $(date -u)" >> /var/log/incidents/dr-$(date +%Y%m%d-%H%M%S).log
```

#### **Step 3: Execute Automated Failover (3-8 minutes)**

```bash
# 1. Trigger automated failover to us-west-2
kubectl config use-context us-west-2
./scripts/emergency-failover.sh --target-region us-west-2 --confirm

# 2. Verify failover status
curl -I https://us-west-2.api.settlementqueue.com/health

# 3. Update DNS routing
aws route53 change-resource-record-sets \
  --hosted-zone-id Z123456789 \
  --change-batch file://dns-failover-us-west-2.json

# 4. Verify DNS propagation
dig api.settlementqueue.com @8.8.8.8
```

#### **Step 4: Validate Service Recovery (8-10 minutes)**

```bash
# 1. Run comprehensive health checks
./scripts/health-check-comprehensive.sh

# 2. Verify critical API endpoints
curl -X POST https://api.settlementqueue.com/api/v1/orders \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $TEST_API_KEY" \
  -d @test-data/valid-order.json

# 3. Check database connectivity
psql -h us-west-2-db.cluster-abc123.us-west-2.rds.amazonaws.com \
  -U postgres -d settlement_queue -c "SELECT COUNT(*) FROM orders;"

# 4. Verify real-time features
# WebSocket connections
# GraphQL subscriptions
```

#### **Step 5: Communication & Monitoring (10+ minutes)**

```bash
# 1. Update status page
curl -X POST https://api.statuspage.io/v1/pages/abc123/incidents \
  -H "Authorization: OAuth $STATUSPAGE_API_KEY" \
  -d "name=Primary Region Recovered&status=investigating&message=Service restored in backup region"

# 2. Continuous monitoring
watch -n 30 './scripts/health-check-comprehensive.sh'

# 3. Begin root cause analysis
./scripts/incident-data-collection.sh --incident-id $(date +%Y%m%d-%H%M%S)
```

---

### **SCENARIO 2: Database Corruption**

**RTO Target**: 15 minutes  
**RPO Target**: 5 minutes  

#### **Step 1: Immediate Isolation (0-2 minutes)**

```bash
# 1. Stop all write operations
kubectl scale deployment api-gateway --replicas=0

# 2. Put system in read-only mode
kubectl apply -f configs/read-only-mode.yaml

# 3. Assess corruption scope
psql -h $DB_HOST -U postgres -d settlement_queue -c "
  SELECT schemaname, tablename, 
         pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
  FROM pg_tables 
  WHERE schemaname = 'public' 
  ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;"
```

#### **Step 2: Determine Recovery Strategy (2-5 minutes)**

```bash
# 1. Check latest backup availability
aws s3 ls s3://settlement-queue-backups/daily/ --recursive | tail -10

# 2. Check point-in-time recovery options
aws rds describe-db-cluster-snapshots \
  --db-cluster-identifier settlement-queue-cluster \
  --query 'DBClusterSnapshots[0].SnapshotCreateTime'

# 3. Assess transaction log integrity
./scripts/check-transaction-log-integrity.sh
```

#### **Step 3: Execute Point-in-Time Recovery (5-12 minutes)**

```bash
# 1. Create new database instance for recovery
aws rds restore-db-cluster-to-point-in-time \
  --source-db-cluster-identifier settlement-queue-cluster \
  --db-cluster-identifier settlement-queue-recovery \
  --restore-to-time $(date -u -d '10 minutes ago' +%Y-%m-%dT%H:%M:%S.000Z) \
  --subnet-group-name settlement-queue-subnet-group

# 2. Wait for recovery completion (5-7 minutes typical)
while true; do
  STATUS=$(aws rds describe-db-clusters \
    --db-cluster-identifier settlement-queue-recovery \
    --query 'DBClusters[0].Status' --output text)
  
  if [ "$STATUS" = "available" ]; then
    echo "Recovery cluster available"
    break
  fi
  
  echo "Recovery status: $STATUS - waiting..."
  sleep 30
done

# 3. Verify recovered data integrity
NEW_DB_ENDPOINT=$(aws rds describe-db-clusters \
  --db-cluster-identifier settlement-queue-recovery \
  --query 'DBClusters[0].Endpoint' --output text)

psql -h $NEW_DB_ENDPOINT -U postgres -d settlement_queue -c "
  SELECT COUNT(*) as total_orders FROM orders;
  SELECT MAX(created_at) as latest_order FROM orders;
"
```

#### **Step 4: Switch to Recovered Database (12-15 minutes)**

```bash
# 1. Update application configuration
kubectl create configmap db-config \
  --from-literal=DB_HOST=$NEW_DB_ENDPOINT \
  --dry-run=client -o yaml | kubectl apply -f -

# 2. Restart application with new database
kubectl rollout restart deployment api-gateway
kubectl rollout status deployment api-gateway

# 3. Verify application connectivity
./scripts/health-check-comprehensive.sh

# 4. Re-enable write operations
kubectl apply -f configs/normal-mode.yaml
```

---

### **SCENARIO 3: Security Breach**

**RTO Target**: 30 minutes (extended for security)  
**RPO Target**: 0 minutes (data integrity critical)  

#### **Step 1: Immediate Containment (0-5 minutes)**

```bash
# 1. IMMEDIATELY isolate affected systems
kubectl patch networkpolicy default -p '{"spec":{"ingress":[]}}'

# 2. Disable all API access
kubectl scale deployment api-gateway --replicas=0

# 3. Preserve evidence
./scripts/security-incident-preservation.sh --incident-id SEC-$(date +%Y%m%d-%H%M%S)

# 4. Notify security team
curl -X POST $SECURITY_WEBHOOK_URL \
  -H "Content-Type: application/json" \
  -d '{"alert":"SECURITY_BREACH","severity":"CRITICAL","timestamp":"'$(date -u)'"}'
```

#### **Step 2: Impact Assessment (5-10 minutes)**

```bash
# 1. Analyze logs for compromise indicators
./scripts/security-analysis.sh --start-time "2 hours ago"

# 2. Check data integrity
./scripts/data-integrity-check.sh --comprehensive

# 3. Identify compromised accounts/keys
grep -E "(auth_failure|suspicious_activity)" /var/log/api-gateway/*.log

# 4. Document findings
echo "SECURITY INCIDENT ASSESSMENT" > /tmp/security-assessment-$(date +%Y%m%d-%H%M%S).txt
```

#### **Step 3: Clean Environment Setup (10-25 minutes)**

```bash
# 1. Deploy to clean environment
kubectl config use-context security-clean-env

# 2. Restore from pre-breach backup
CLEAN_BACKUP=$(aws s3 ls s3://settlement-queue-backups/verified-clean/ | tail -1 | awk '{print $4}')
./scripts/restore-from-backup.sh --backup-id $CLEAN_BACKUP --environment clean

# 3. Update all secrets and keys
./scripts/rotate-all-credentials.sh --force

# 4. Apply security patches
./scripts/apply-security-patches.sh --critical-only
```

#### **Step 4: Secure Restart (25-30 minutes)**

```bash
# 1. Enhanced security configuration
kubectl apply -f configs/high-security-mode.yaml

# 2. Start services with additional monitoring
kubectl apply -f configs/enhanced-monitoring.yaml
kubectl rollout restart deployment api-gateway

# 3. Verify security posture
./scripts/security-posture-check.sh --strict

# 4. Limited access restoration
kubectl apply -f configs/limited-access-mode.yaml
```

---

### **SCENARIO 4: Complete Data Loss**

**RTO Target**: 45 minutes  
**RPO Target**: Based on last verified backup  

#### **Step 1: Assess Scope (0-5 minutes)**

```bash
# 1. Confirm complete data loss
./scripts/data-loss-assessment.sh --comprehensive

# 2. Identify last known good backup
aws s3 ls s3://settlement-queue-backups/ --recursive | grep verified | tail -10

# 3. Check cross-region backup availability
./scripts/check-backup-availability.sh --all-regions

# 4. Calculate maximum acceptable data loss
LAST_BACKUP_TIME=$(aws s3 api head-object --bucket settlement-queue-backups --key latest-verified.json --query LastModified)
echo "Data loss window: $LAST_BACKUP_TIME to $(date -u)"
```

#### **Step 2: Recovery Environment Preparation (5-15 minutes)**

```bash
# 1. Provision new infrastructure
terraform apply -var="disaster_recovery=true" -var="environment=recovery" -auto-approve

# 2. Set up clean database cluster
aws rds create-db-cluster \
  --db-cluster-identifier settlement-queue-dr \
  --engine aurora-postgresql \
  --master-username postgres \
  --master-user-password $(aws secretsmanager get-secret-value --secret-id db-master-password --query SecretString --output text)

# 3. Wait for infrastructure readiness
while ! curl -s http://recovery-env-health-check.internal/ready; do
  echo "Waiting for recovery environment..."
  sleep 30
done
```

#### **Step 3: Full System Restore (15-40 minutes)**

```bash
# 1. Restore database from backup
LATEST_BACKUP=$(aws s3 ls s3://settlement-queue-backups/full/ --recursive | tail -1 | awk '{print $4}')
./scripts/full-restore.sh --backup-file $LATEST_BACKUP --target-cluster settlement-queue-dr

# 2. Restore application state
./scripts/restore-application-state.sh --backup-date $(date -d yesterday +%Y-%m-%d)

# 3. Restore configuration
./scripts/restore-configuration.sh --environment production

# 4. Verify restore integrity
./scripts/comprehensive-verification.sh --post-restore
```

#### **Step 4: Service Restoration (40-45 minutes)**

```bash
# 1. Update DNS to point to recovery environment
aws route53 change-resource-record-sets \
  --hosted-zone-id Z123456789 \
  --change-batch file://dns-recovery-env.json

# 2. Start all services
kubectl apply -f manifests/production/

# 3. Comprehensive testing
./scripts/end-to-end-testing.sh --critical-path-only

# 4. Monitor for issues
./scripts/enhanced-monitoring-post-recovery.sh
```

---

## RTO/RPO Targets

### **Service Level Objectives**

| Scenario | RTO Target | RPO Target | Business Impact |
|----------|------------|------------|-----------------|
| Primary Region Failure | 10 minutes | 5 minutes | Minimal revenue impact |
| Database Corruption | 15 minutes | 5 minutes | Moderate revenue impact |
| Security Breach | 30 minutes | 0 minutes | High security risk |
| Complete Data Loss | 45 minutes | 24 hours | Significant revenue impact |

### **Monitoring and Alerting**

```bash
# RTO Monitoring Commands
./scripts/rto-monitor.sh --incident-type region_failure --start-time $INCIDENT_START

# RPO Calculation
./scripts/rpo-calculate.sh --last-backup-time $BACKUP_TIME --incident-time $INCIDENT_TIME

# SLA Tracking
./scripts/sla-tracking.sh --month $(date +%Y-%m) --generate-report
```

---

## Escalation Matrix

### **Automatic Escalation Rules**

| Time Since Incident | Action | Responsible Party |
|---------------------|--------|-------------------|
| 0 minutes | Initial alert sent | Monitoring System |
| 5 minutes | Page on-call engineer | PagerDuty |
| 15 minutes | Escalate to Technical Lead | On-call Engineer |
| 30 minutes | Escalate to Incident Commander | Technical Lead |
| 60 minutes | Escalate to Management | Incident Commander |
| 120 minutes | Escalate to Executive Team | Management |

### **Escalation Communication Templates**

#### **Initial Alert (0-5 minutes)**
```
SUBJECT: [CRITICAL] API Gateway Service Disruption - Incident #DR-{TIMESTAMP}

IMPACT: {Service/Feature} is experiencing {Impact Description}
START TIME: {UTC Timestamp}
ESTIMATED USERS AFFECTED: {Number}
CURRENT STATUS: {Investigation/Mitigation in Progress}

Initial Response Team Activated.
Updates every 15 minutes.

Status Page: https://status.settlementqueue.com
```

#### **Management Escalation (30+ minutes)**
```
SUBJECT: [CRITICAL - MANAGEMENT ATTENTION] Extended Service Disruption #DR-{TIMESTAMP}

SITUATION: API Gateway service disruption continuing beyond 30 minutes
DURATION: {Duration} minutes
CUSTOMER IMPACT: {Detailed Impact}
ROOT CAUSE: {Known/Under Investigation}
MITIGATION: {Current Actions}
ESTIMATED RESOLUTION: {ETA or Unknown}

BUSINESS IMPACT:
- Revenue Impact: ${Estimated Loss}
- Customer Impact: {Number} affected users
- SLA Impact: {Breach Status}

Next Update: {Time}
```

---

## Testing Procedures

### **Monthly Disaster Recovery Testing**

#### **Test Schedule**
- **1st Monday**: Primary region failover test
- **2nd Monday**: Database recovery test  
- **3rd Monday**: Security incident simulation
- **4th Monday**: Complete backup restoration test

#### **Test Execution Commands**

```bash
# 1. Automated DR Test Execution
./scripts/dr-test.sh --scenario region_failure --environment staging

# 2. Manual Verification Steps
./scripts/dr-test-verification.sh --checklist full

# 3. Performance Validation
./scripts/performance-validation.sh --post-recovery

# 4. Test Results Documentation
./scripts/generate-test-report.sh --test-date $(date +%Y-%m-%d) --scenario region_failure
```

#### **Test Success Criteria**
- ✅ RTO target met (within target time)
- ✅ RPO target met (data loss within acceptable range)
- ✅ All critical services operational
- ✅ Performance within 10% of baseline
- ✅ No data corruption detected
- ✅ Security controls functional

---

## Post-Recovery Actions

### **Immediate Post-Recovery (0-2 hours)**

```bash
# 1. Comprehensive system health check
./scripts/post-recovery-health-check.sh --comprehensive

# 2. Performance baseline validation
./scripts/performance-baseline-check.sh --compare-to-pre-incident

# 3. Data integrity verification
./scripts/data-integrity-comprehensive.sh --full-scan

# 4. Security posture verification
./scripts/security-posture-check.sh --post-incident
```

### **Short-term Actions (2-24 hours)**

```bash
# 1. Customer communication
./scripts/customer-notification.sh --template recovery_complete --incident-id $INCIDENT_ID

# 2. Service monitoring enhancement
./scripts/enhanced-monitoring.sh --post-incident --duration 24h

# 3. Performance optimization
./scripts/performance-optimization.sh --post-recovery

# 4. Backup verification
./scripts/backup-verification.sh --enhanced --all-regions
```

### **Root Cause Analysis (1-7 days)**

```bash
# 1. Incident data collection
./scripts/incident-data-collection.sh --comprehensive --incident-id $INCIDENT_ID

# 2. Timeline reconstruction
./scripts/timeline-reconstruction.sh --incident-id $INCIDENT_ID --generate-report

# 3. Root cause analysis
./scripts/root-cause-analysis.sh --incident-id $INCIDENT_ID --output-format pdf

# 4. Improvement recommendations
./scripts/improvement-recommendations.sh --based-on-incident $INCIDENT_ID
```

### **Process Improvement (1-4 weeks)**

1. **Runbook Updates**: Update procedures based on lessons learned
2. **Tool Enhancement**: Improve automation and monitoring
3. **Training Updates**: Update team training materials
4. **Testing Enhancement**: Improve DR testing procedures

---

## Document Control

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0 | 2025-06-01 | Initial version | DevOps Team |
| 1.1 | 2025-06-15 | Added security breach procedures | Security Team |
| 2.0 | 2025-07-12 | Complete rewrite with enhanced automation | DevOps Team |

**Next Review Date**: 2025-08-12  
**Owner**: DevOps Team  
**Approval**: CTO, Head of Security  

---

**⚠️ IMPORTANT**: This runbook contains sensitive operational procedures. Access is restricted to authorized personnel only.

**📞 EMERGENCY HOTLINE**: +1-555-HELP-NOW (24/7)