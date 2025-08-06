# Backup & Recovery Deployment Guide
**Version**: 1.0  
**Last Updated**: July 12, 2025  
**Target Environment**: Production

---

## Overview

This guide provides comprehensive deployment instructions for the enterprise-grade backup and recovery system for the SettlementQueue API Gateway. The system includes point-in-time recovery, cross-region replication, automated verification, and disaster recovery capabilities.

## 🏗️ Architecture Overview

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Primary       │    │   Secondary     │    │   Tertiary      │
│   Region        │◄──►│   Region        │◄──►│   Region        │
│   (us-east-1)   │    │   (us-west-2)   │    │   (eu-west-1)   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Backup        │    │   Backup        │    │   Backup        │
│   Storage       │    │   Storage       │    │   Storage       │
│   S3 + RDS      │    │   S3 + RDS      │    │   S3 + RDS      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 ▼
                    ┌─────────────────┐
                    │   Monitoring    │
                    │   & Alerting    │
                    │   (CloudWatch)  │
                    └─────────────────┘
```

## 📋 Prerequisites

### Infrastructure Requirements
- **AWS Account** with multi-region access
- **PostgreSQL RDS** clusters in multiple regions
- **S3 buckets** for backup storage
- **VPC** with cross-region peering
- **IAM roles** with appropriate permissions
- **CloudWatch** for monitoring
- **SNS** for alerting

### Software Requirements
- **Node.js** >= 18.0.0
- **kubectl** >= 1.25
- **AWS CLI** >= 2.0
- **Terraform** >= 1.0 (optional)
- **Docker** >= 20.0

### Security Requirements
- **KMS keys** for encryption
- **VPC endpoints** for secure communication
- **Security groups** properly configured
- **IAM policies** with least privilege

---

## 🚀 Installation Steps

### Step 1: Infrastructure Setup

#### 1.1 Create S3 Buckets for Backup Storage

```bash
# Primary backup bucket (us-east-1)
aws s3 mb s3://settlement-queue-backups-primary --region us-east-1

# Secondary backup bucket (us-west-2)
aws s3 mb s3://settlement-queue-backups-secondary --region us-west-2

# Tertiary backup bucket (eu-west-1)
aws s3 mb s3://settlement-queue-backups-tertiary --region eu-west-1

# Enable versioning and encryption
aws s3api put-bucket-versioning \
  --bucket settlement-queue-backups-primary \
  --versioning-configuration Status=Enabled

aws s3api put-bucket-encryption \
  --bucket settlement-queue-backups-primary \
  --server-side-encryption-configuration '{
    "Rules": [{
      "ApplyServerSideEncryptionByDefault": {
        "SSEAlgorithm": "aws:kms",
        "KMSMasterKeyID": "arn:aws:kms:us-east-1:ACCOUNT:key/KEY-ID"
      }
    }]
  }'

# Repeat for other regions...
```

#### 1.2 Create RDS Read Replicas

```bash
# Create read replica in us-west-2
aws rds create-db-cluster \
  --db-cluster-identifier settlement-queue-replica-west \
  --source-db-cluster-identifier settlement-queue-primary \
  --replication-source-identifier arn:aws:rds:us-east-1:ACCOUNT:cluster:settlement-queue-primary \
  --region us-west-2

# Create read replica in eu-west-1
aws rds create-db-cluster \
  --db-cluster-identifier settlement-queue-replica-eu \
  --source-db-cluster-identifier settlement-queue-primary \
  --replication-source-identifier arn:aws:rds:us-east-1:ACCOUNT:cluster:settlement-queue-primary \
  --region eu-west-1
```

#### 1.3 Setup Cross-Region Replication

```bash
# Configure S3 cross-region replication
aws s3api put-bucket-replication \
  --bucket settlement-queue-backups-primary \
  --replication-configuration file://replication-config.json
```

**replication-config.json**:
```json
{
  "Role": "arn:aws:iam::ACCOUNT:role/S3ReplicationRole",
  "Rules": [
    {
      "ID": "ReplicateToWest",
      "Status": "Enabled",
      "Priority": 1,
      "Filter": {},
      "Destination": {
        "Bucket": "arn:aws:s3:::settlement-queue-backups-secondary",
        "StorageClass": "STANDARD_IA"
      }
    },
    {
      "ID": "ReplicateToEU",
      "Status": "Enabled",
      "Priority": 2,
      "Filter": {},
      "Destination": {
        "Bucket": "arn:aws:s3:::settlement-queue-backups-tertiary",
        "StorageClass": "STANDARD_IA"
      }
    }
  ]
}
```

### Step 2: Service Deployment

#### 2.1 Deploy Backup Services

```bash
# Create namespace for backup services
kubectl create namespace backup-recovery

# Deploy backup service
kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: backup-service
  namespace: backup-recovery
spec:
  replicas: 2
  selector:
    matchLabels:
      app: backup-service
  template:
    metadata:
      labels:
        app: backup-service
    spec:
      containers:
      - name: backup-service
        image: settlement-queue/backup-service:latest
        env:
        - name: NODE_ENV
          value: "production"
        - name: AWS_REGION
          value: "us-east-1"
        - name: BACKUP_BUCKET
          value: "settlement-queue-backups-primary"
        - name: DB_HOST
          valueFrom:
            secretKeyRef:
              name: db-credentials
              key: host
        - name: DB_PASSWORD
          valueFrom:
            secretKeyRef:
              name: db-credentials
              key: password
        resources:
          requests:
            memory: "512Mi"
            cpu: "250m"
          limits:
            memory: "1Gi"
            cpu: "500m"
        volumeMounts:
        - name: backup-storage
          mountPath: /tmp/backups
      volumes:
      - name: backup-storage
        emptyDir:
          sizeLimit: 10Gi
EOF
```

#### 2.2 Deploy Replication Service

```bash
kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: replication-service
  namespace: backup-recovery
spec:
  replicas: 1
  selector:
    matchLabels:
      app: replication-service
  template:
    metadata:
      labels:
        app: replication-service
    spec:
      containers:
      - name: replication-service
        image: settlement-queue/replication-service:latest
        env:
        - name: PRIMARY_REGION
          value: "us-east-1"
        - name: SECONDARY_REGIONS
          value: "us-west-2,eu-west-1"
        - name: REPLICATION_MODE
          value: "async"
        resources:
          requests:
            memory: "256Mi"
            cpu: "100m"
          limits:
            memory: "512Mi"
            cpu: "250m"
EOF
```

#### 2.3 Deploy Verification Service

```bash
kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: verification-service
  namespace: backup-recovery
spec:
  replicas: 1
  selector:
    matchLabels:
      app: verification-service
  template:
    metadata:
      labels:
        app: verification-service
    spec:
      containers:
      - name: verification-service
        image: settlement-queue/verification-service:latest
        env:
        - name: VERIFICATION_SCHEDULE
          value: "0 2 * * *"  # Daily at 2 AM
        - name: RESTORE_TEST_SCHEDULE
          value: "0 3 * * 0"  # Weekly on Sunday at 3 AM
        resources:
          requests:
            memory: "512Mi"
            cpu: "250m"
          limits:
            memory: "1Gi"
            cpu: "500m"
EOF
```

#### 2.4 Deploy RTO/RPO Monitoring

```bash
kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: rto-rpo-monitoring
  namespace: backup-recovery
spec:
  replicas: 1
  selector:
    matchLabels:
      app: rto-rpo-monitoring
  template:
    metadata:
      labels:
        app: rto-rpo-monitoring
    spec:
      containers:
      - name: rto-rpo-monitoring
        image: settlement-queue/rto-rpo-monitoring:latest
        env:
        - name: RTO_CRITICAL
          value: "600000"    # 10 minutes
        - name: RPO_CRITICAL
          value: "300000"    # 5 minutes
        - name: ALERTING_ENABLED
          value: "true"
        resources:
          requests:
            memory: "256Mi"
            cpu: "100m"
          limits:
            memory: "512Mi"
            cpu: "250m"
EOF
```

### Step 3: Configuration

#### 3.1 Create Configuration Files

**backup-config.yaml**:
```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: backup-config
  namespace: backup-recovery
data:
  backup.json: |
    {
      "enabled": true,
      "retentionDays": 30,
      "compressionLevel": 6,
      "encryption": true,
      "crossRegion": true,
      "incremental": true,
      "pointInTime": true,
      "regions": ["us-east-1", "us-west-2", "eu-west-1"],
      "primaryRegion": "us-east-1",
      "schedules": {
        "full": "0 2 * * 0",
        "incremental": "0 */4 * * *",
        "transactionLog": "*/5 * * * *",
        "pointInTime": "*/1 * * * *"
      },
      "rto": 600000,
      "rpo": 300000
    }
```

#### 3.2 Create Secrets

```bash
# Database credentials
kubectl create secret generic db-credentials \
  --namespace=backup-recovery \
  --from-literal=host="settlement-queue-cluster.cluster-abc123.us-east-1.rds.amazonaws.com" \
  --from-literal=username="postgres" \
  --from-literal=password="your-secure-password"

# Encryption keys
kubectl create secret generic encryption-keys \
  --namespace=backup-recovery \
  --from-literal=backup-key="your-256-bit-encryption-key" \
  --from-literal=kms-key-id="arn:aws:kms:us-east-1:ACCOUNT:key/KEY-ID"

# AWS credentials
kubectl create secret generic aws-credentials \
  --namespace=backup-recovery \
  --from-literal=access-key-id="AKIA..." \
  --from-literal=secret-access-key="your-secret-key"
```

### Step 4: Monitoring Setup

#### 4.1 Deploy Prometheus Monitoring

```bash
# Create monitoring configuration
kubectl apply -f - <<EOF
apiVersion: v1
kind: ConfigMap
metadata:
  name: prometheus-backup-config
  namespace: backup-recovery
data:
  backup-metrics.yml: |
    groups:
    - name: backup-recovery
      rules:
      - alert: BackupFailed
        expr: backup_job_success == 0
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Backup job failed"
          description: "Backup job {{ \$labels.job }} has failed"
      
      - alert: RTOViolation
        expr: incident_recovery_time > incident_rto_target
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "RTO target violated"
          description: "Recovery time exceeded RTO target"
      
      - alert: RPOViolation
        expr: backup_age_seconds > rpo_target_seconds
        for: 1m
        labels:
          severity: high
        annotations:
          summary: "RPO target violated"
          description: "Backup is older than RPO target"
EOF
```

#### 4.2 Deploy Grafana Dashboard

```bash
# Create Grafana dashboard for backup monitoring
kubectl apply -f - <<EOF
apiVersion: v1
kind: ConfigMap
metadata:
  name: grafana-backup-dashboard
  namespace: backup-recovery
data:
  backup-dashboard.json: |
    {
      "dashboard": {
        "title": "Backup & Recovery Monitoring",
        "panels": [
          {
            "title": "Backup Success Rate",
            "type": "stat",
            "targets": [
              {
                "expr": "rate(backup_jobs_total{status=\"success\"}[24h]) / rate(backup_jobs_total[24h]) * 100"
              }
            ]
          },
          {
            "title": "RTO Compliance",
            "type": "stat",
            "targets": [
              {
                "expr": "avg(incident_recovery_time <= incident_rto_target) * 100"
              }
            ]
          },
          {
            "title": "RPO Compliance",
            "type": "stat",
            "targets": [
              {
                "expr": "avg(backup_age_seconds <= rpo_target_seconds) * 100"
              }
            ]
          }
        ]
      }
    }
EOF
```

### Step 5: Testing & Validation

#### 5.1 Test Backup Functionality

```bash
# Test manual backup
kubectl exec -n backup-recovery deployment/backup-service -- \
  node -e "
    const BackupService = require('./src/services/backup.js');
    const service = new BackupService(config);
    service.performFullBackup().then(console.log);
  "

# Verify backup in S3
aws s3 ls s3://settlement-queue-backups-primary/full/

# Test cross-region replication
aws s3 ls s3://settlement-queue-backups-secondary/full/
aws s3 ls s3://settlement-queue-backups-tertiary/full/
```

#### 5.2 Test Recovery Procedures

```bash
# Test point-in-time recovery
kubectl exec -n backup-recovery deployment/backup-service -- \
  node -e "
    const BackupService = require('./src/services/backup.js');
    const service = new BackupService(config);
    const targetTime = new Date(Date.now() - 3600000); // 1 hour ago
    service.pointInTimeRecovery(targetTime).then(console.log);
  "

# Test failover
kubectl exec -n backup-recovery deployment/replication-service -- \
  node -e "
    const ReplicationService = require('./src/services/replication.js');
    const service = new ReplicationService(config);
    service.initiateFailover('us-west-2').then(console.log);
  "
```

#### 5.3 Test Monitoring & Alerting

```bash
# Test RTO/RPO monitoring
kubectl exec -n backup-recovery deployment/rto-rpo-monitoring -- \
  node -e "
    const RTORPOService = require('./src/services/rto-rpo-monitoring.js');
    const service = new RTORPOService(config);
    service.getDashboardData().then(console.log);
  "

# Simulate incident to test alerting
kubectl exec -n backup-recovery deployment/rto-rpo-monitoring -- \
  node -e "
    const RTORPOService = require('./src/services/rto-rpo-monitoring.js');
    const service = new RTORPOService(config);
    service.startIncident({
      type: 'test_incident',
      severity: 'critical',
      services: ['api-gateway'],
      description: 'Test incident for validation'
    }).then(console.log);
  "
```

---

## 🔧 Configuration Options

### Backup Configuration

```javascript
// src/config/backup.js
export default {
  backup: {
    enabled: true,
    retentionDays: 30,
    compressionLevel: 6,
    encryption: true,
    encryptionKey: process.env.BACKUP_ENCRYPTION_KEY,
    crossRegion: true,
    incremental: true,
    pointInTime: true,
    verification: true,
    
    regions: [
      'us-east-1',  // Primary
      'us-west-2',  // Secondary
      'eu-west-1'   // Tertiary
    ],
    
    schedules: {
      full: '0 2 * * 0',          // Weekly on Sunday at 2 AM
      incremental: '0 */4 * * *',  // Every 4 hours
      transactionLog: '*/5 * * * *', // Every 5 minutes
      pointInTime: '*/1 * * * *'   // Every minute
    },
    
    storage: {
      type: 's3',
      bucket: 'settlement-queue-backups-primary',
      storageClass: 'STANDARD_IA',
      lifecycle: {
        transitionToIA: 30,    // Days
        transitionToGlacier: 90,
        deletion: 2555         // 7 years
      }
    }
  }
};
```

### RTO/RPO Targets

```javascript
// src/config/rto-rpo.js
export default {
  rto: {
    critical: 600000,     // 10 minutes
    high: 900000,         // 15 minutes
    medium: 1800000,      // 30 minutes
    low: 2700000          // 45 minutes
  },
  
  rpo: {
    critical: 300000,     // 5 minutes
    high: 300000,         // 5 minutes
    medium: 0,            // 0 minutes (no data loss)
    low: 86400000         // 24 hours
  },
  
  sla: {
    availability: 99.9,   // 99.9% uptime
    performance: 99.5,    // 99.5% within SLA
    recovery: 95.0        // 95% recovery within RTO
  }
};
```

---

## 📊 Monitoring & Alerting

### Key Metrics to Monitor

| Metric | Description | Alert Threshold |
|--------|-------------|-----------------|
| `backup_job_success` | Backup job success rate | < 95% |
| `backup_age_seconds` | Age of last backup | > RPO target |
| `incident_recovery_time` | Time to recover from incident | > RTO target |
| `cross_region_sync_lag` | Replication lag between regions | > 5 minutes |
| `verification_success_rate` | Backup verification success | < 98% |
| `storage_usage_bytes` | Backup storage utilization | > 80% capacity |

### Alert Destinations

- **PagerDuty**: Critical incidents (RTO/RPO violations)
- **Slack**: Warning alerts and status updates
- **Email**: Daily/weekly reports
- **SMS**: Emergency failover notifications

---

## 🔐 Security Considerations

### Encryption
- **Data at Rest**: AES-256 encryption for all backups
- **Data in Transit**: TLS 1.3 for all communications
- **Key Management**: AWS KMS with automatic key rotation

### Access Control
- **IAM Roles**: Least privilege access principles
- **MFA**: Required for all administrative operations
- **Audit Logging**: All access and operations logged

### Network Security
- **VPC Endpoints**: Secure communication within AWS
- **Security Groups**: Restricted network access
- **WAF**: Web application firewall protection

---

## 🚨 Troubleshooting

### Common Issues

#### Backup Failures
```bash
# Check backup service logs
kubectl logs -n backup-recovery deployment/backup-service

# Check S3 permissions
aws s3api head-bucket --bucket settlement-queue-backups-primary

# Verify database connectivity
kubectl exec -n backup-recovery deployment/backup-service -- \
  pg_isready -h $DB_HOST -p 5432
```

#### Replication Lag
```bash
# Check replication status
aws rds describe-db-clusters \
  --db-cluster-identifier settlement-queue-replica-west \
  --query 'DBClusters[0].ReplicationSourceIdentifier'

# Monitor replication lag
aws cloudwatch get-metric-statistics \
  --namespace AWS/RDS \
  --metric-name ReplicaLag \
  --dimensions Name=DBClusterIdentifier,Value=settlement-queue-replica-west \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Average
```

#### Recovery Issues
```bash
# Check recovery service status
kubectl get pods -n backup-recovery -l app=backup-service

# Verify backup integrity
kubectl exec -n backup-recovery deployment/verification-service -- \
  node -e "
    const VerificationService = require('./src/services/verification.js');
    const service = new VerificationService(config);
    service.verifyBackupIntegrity('backup-id-here').then(console.log);
  "
```

---

## 📈 Performance Optimization

### Backup Performance
- **Parallel Processing**: Multiple backup streams
- **Compression**: Reduce storage and transfer time
- **Incremental Backups**: Only backup changed data
- **Bandwidth Throttling**: Avoid impacting production

### Recovery Performance
- **Pre-warmed Replicas**: Keep replicas ready
- **SSD Storage**: Fast storage for critical operations
- **Network Optimization**: Dedicated backup network
- **Caching**: Cache frequently accessed backup metadata

---

## 📝 Maintenance

### Regular Tasks

#### Daily
- [ ] Verify backup completion
- [ ] Check RTO/RPO compliance
- [ ] Review alert notifications
- [ ] Monitor storage usage

#### Weekly
- [ ] Run disaster recovery test
- [ ] Review backup verification results
- [ ] Check cross-region replication
- [ ] Update documentation

#### Monthly
- [ ] Full system recovery test
- [ ] Review and update RTO/RPO targets
- [ ] Capacity planning review
- [ ] Security audit

#### Quarterly
- [ ] Disaster recovery drill
- [ ] Update emergency contacts
- [ ] Review and update procedures
- [ ] Performance optimization review

---

**Next Steps**: 
1. Complete infrastructure setup
2. Deploy and configure services
3. Run comprehensive testing
4. Schedule regular maintenance tasks
5. Train operations team on procedures

**Support**: For issues or questions, contact the DevOps team or refer to the [Disaster Recovery Runbook](./DISASTER_RECOVERY_RUNBOOK.md).