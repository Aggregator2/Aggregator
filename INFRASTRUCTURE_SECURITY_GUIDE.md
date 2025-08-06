# SwappiQ Infrastructure Security - Complete Deployment Guide

## Overview

This comprehensive guide covers the deployment and configuration of SwappiQ's enterprise-grade infrastructure security system, including HSM integration, secrets management, rate limiting, DDoS protection, database encryption, and audit logging.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [HSM Integration](#hsm-integration)
3. [Secrets Management](#secrets-management)
4. [Rate Limiting](#rate-limiting)
5. [DDoS Protection](#ddos-protection)
6. [Database Encryption](#database-encryption)
7. [Audit Logging](#audit-logging)
8. [Deployment Configuration](#deployment-configuration)
9. [Monitoring & Alerting](#monitoring--alerting)
10. [Security Best Practices](#security-best-practices)
11. [Troubleshooting](#troubleshooting)

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     SwappiQ Security Stack                      │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │   CDN/WAF   │  │   Load      │  │   DDoS      │            │
│  │ (Cloudflare)│  │  Balancer   │  │ Protection  │            │
│  └─────────────┘  └─────────────┘  └─────────────┘            │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │ Rate        │  │ API         │  │ Signature   │            │
│  │ Limiter     │  │ Gateway     │  │ Verification│            │
│  └─────────────┘  └─────────────┘  └─────────────┘            │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │ Application │  │ Business    │  │ Matching    │            │
│  │ Layer       │  │ Logic       │  │ Engine      │            │
│  └─────────────┘  └─────────────┘  └─────────────┘            │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │ Database    │  │ HSM         │  │ Secrets     │            │
│  │ Encryption  │  │ Manager     │  │ Manager     │            │
│  └─────────────┘  └─────────────┘  └─────────────┘            │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │ Audit       │  │ Monitoring  │  │ Alerting    │            │
│  │ Logging     │  │ System      │  │ System      │            │
│  └─────────────┘  └─────────────┘  └─────────────┘            │
└─────────────────────────────────────────────────────────────────┘
```

## HSM Integration

### Prerequisites

- AWS CloudHSM cluster or compatible HSM device
- HSM client library installed
- Proper network connectivity to HSM
- Valid HSM credentials and certificates

### Configuration

```javascript
// HSM Configuration
const hsmConfig = {
    provider: 'aws', // 'aws', 'azure', 'local'
    region: 'us-east-1',
    clusterId: 'cluster-abc123def456',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    },
    libraryPath: '/opt/cloudhsm/lib/libcloudhsm_pkcs11.so',
    keyRotationInterval: 30 * 24 * 60 * 60 * 1000, // 30 days
    backupEnabled: true,
    auditLogging: true
};

// Initialize HSM Manager
const hsmManager = new HSMManager(hsmConfig);
await hsmManager.initialize();
```

### Deployment Steps

1. **HSM Cluster Setup**
   ```bash
   # Create HSM cluster (AWS)
   aws cloudhsmv2 create-cluster \
     --cluster-id cluster-production \
     --subnet-ids subnet-12345 subnet-67890 \
     --hsm-type hsm1.medium
   ```

2. **Install HSM Client**
   ```bash
   # Download and install CloudHSM client
   wget https://s3.amazonaws.com/cloudhsmv2-software/CloudHsmClient/EL7/cloudhsm-client-latest.el7.x86_64.rpm
   sudo rpm -i cloudhsm-client-latest.el7.x86_64.rpm
   ```

3. **Configure Network Access**
   ```bash
   # Update security groups to allow HSM traffic
   aws ec2 authorize-security-group-ingress \
     --group-id sg-hsm-access \
     --protocol tcp \
     --port 2223-2225 \
     --cidr 10.0.0.0/16
   ```

4. **Generate Trading Keys**
   ```javascript
   // Generate keys for different purposes
   await hsmManager.generateKey('trading-key-main', {
       algorithm: 'secp256k1',
       purpose: 'order-signing'
   });
   
   await hsmManager.generateKey('settlement-key', {
       algorithm: 'secp256k1',
       purpose: 'settlement-signing'
   });
   ```

### Security Best Practices

- **Key Rotation**: Automatic rotation every 30 days
- **Backup Strategy**: Encrypted backups to multiple locations
- **Access Control**: Role-based access with minimal privileges
- **Audit Logging**: All HSM operations logged and monitored

## Secrets Management

### Prerequisites

- HashiCorp Vault or AWS KMS/Secrets Manager
- Proper authentication credentials
- Network connectivity to secrets backend
- Encryption keys for additional security layer

### Configuration

```javascript
// Vault Configuration
const secretsConfig = {
    provider: 'vault', // 'vault', 'aws-kms', 'azure-kv'
    vaultUrl: 'https://vault.swappiq.com',
    vaultToken: process.env.VAULT_TOKEN,
    encryptionEnabled: true,
    cacheEnabled: true,
    cacheTTL: 300000, // 5 minutes
    auditLogging: true,
    rotationEnabled: true
};

// Initialize Secrets Manager
const secretsManager = new SecretsManager(secretsConfig);
await secretsManager.initialize();
```

### Deployment Steps

1. **Vault Server Setup**
   ```bash
   # Install Vault
   curl -fsSL https://apt.releases.hashicorp.com/gpg | sudo apt-key add -
   sudo apt-add-repository "deb [arch=amd64] https://apt.releases.hashicorp.com $(lsb_release -cs) main"
   sudo apt-get install vault
   
   # Configure Vault
   sudo tee /etc/vault.d/vault.hcl <<EOF
   storage "consul" {
     address = "127.0.0.1:8500"
     path    = "vault/"
   }
   
   listener "tcp" {
     address = "127.0.0.1:8200"
     tls_disable = 0
     tls_cert_file = "/etc/ssl/certs/vault.crt"
     tls_key_file = "/etc/ssl/private/vault.key"
   }
   
   seal "awskms" {
     region     = "us-east-1"
     kms_key_id = "12345678-1234-1234-1234-123456789012"
   }
   EOF
   ```

2. **Initialize and Unseal Vault**
   ```bash
   # Initialize Vault
   vault operator init -key-shares=5 -key-threshold=3
   
   # Unseal Vault (repeat with 3 different keys)
   vault operator unseal <unseal-key-1>
   vault operator unseal <unseal-key-2>
   vault operator unseal <unseal-key-3>
   ```

3. **Configure Authentication and Policies**
   ```bash
   # Enable AppRole authentication
   vault auth enable approle
   
   # Create policy for SwappiQ application
   vault policy write swappiq-policy - <<EOF
   path "secret/data/swappiq/*" {
     capabilities = ["create", "read", "update", "delete", "list"]
   }
   
   path "secret/metadata/swappiq/*" {
     capabilities = ["list"]
   }
   EOF
   
   # Create AppRole
   vault write auth/approle/role/swappiq \
     token_policies="swappiq-policy" \
     token_ttl=1h \
     token_max_ttl=4h
   ```

4. **Store Application Secrets**
   ```javascript
   // Store database credentials
   await secretsManager.setSecret('database/postgres/main', {
       host: 'db.swappiq.com',
       username: 'swappiq_user',
       password: 'super-secure-password',
       database: 'swappiq_production'
   }, {
       description: 'Main PostgreSQL database credentials',
       rotationEnabled: true
   });
   
   // Store API keys
   await secretsManager.setSecret('api-keys/external/coingecko', {
       apiKey: 'your-coingecko-api-key',
       rateLimit: 100
   });
   ```

### Secret Types and Usage

- **Database Credentials**: Connection strings, passwords
- **API Keys**: External service authentication
- **Encryption Keys**: Application-level encryption
- **Certificates**: TLS/SSL certificates and keys
- **Private Keys**: Non-HSM stored keys for development

## Rate Limiting

### Prerequisites

- Redis cluster for distributed rate limiting
- Network connectivity between application servers and Redis
- Proper Redis authentication and encryption

### Configuration

```javascript
// Rate Limiter Configuration
const rateLimiterConfig = {
    redis: {
        host: 'redis-cluster.swappiq.com',
        port: 6379,
        password: process.env.REDIS_PASSWORD,
        db: 0,
        keyPrefix: 'rl:swappiq:'
    },
    strategies: {
        ip: {
            windowMs: 60000, // 1 minute
            maxRequests: 100,
            skipSuccessfulRequests: false
        },
        wallet: {
            windowMs: 60000,
            maxRequests: 50,
            skipSuccessfulRequests: false
        },
        api: {
            windowMs: 60000,
            maxRequests: 1000,
            skipSuccessfulRequests: false
        }
    },
    whitelist: {
        ips: ['127.0.0.1', '::1'],
        wallets: ['0x742d35Cc6642C4532a6c70E42c0a6a1b23B35a52']
    },
    blacklist: {
        autoBlacklist: true,
        blacklistThreshold: 100,
        blacklistDuration: 24 * 60 * 60 * 1000 // 24 hours
    },
    adaptiveLimit: {
        enabled: true,
        factor: 0.8,
        highLoadThreshold: 0.8
    }
};

// Initialize Rate Limiter
const rateLimiter = new RateLimiter(rateLimiterConfig);
await rateLimiter.initialize();
```

### Deployment Steps

1. **Redis Cluster Setup**
   ```bash
   # Install Redis
   sudo apt-get install redis-server
   
   # Configure Redis for production
   sudo tee /etc/redis/redis.conf <<EOF
   bind 0.0.0.0
   port 6379
   requirepass your-secure-redis-password
   
   # Memory management
   maxmemory 2gb
   maxmemory-policy allkeys-lru
   
   # Persistence
   save 900 1
   save 300 10
   save 60 10000
   
   # Security
   rename-command FLUSHDB ""
   rename-command FLUSHALL ""
   rename-command DEBUG ""
   EOF
   ```

2. **Application Integration**
   ```javascript
   // Express.js middleware example
   app.use(async (req, res, next) => {
       try {
           const result = await rateLimiter.checkRateLimit({
               ip: req.ip,
               walletAddress: req.body.walletAddress,
               apiKey: req.headers['x-api-key'],
               endpoint: req.path,
               method: req.method
           });
           
           if (!result.allowed) {
               return res.status(429).json({
                   error: 'Rate limit exceeded',
                   retryAfter: result.retryAfter,
                   reason: result.reason
               });
           }
           
           next();
       } catch (error) {
           console.error('Rate limiting error:', error);
           next(); // Fail open for availability
       }
   });
   ```

3. **Monitoring and Alerting**
   ```javascript
   // Set up monitoring
   setInterval(async () => {
       const metrics = rateLimiter.getMetrics();
       
       // Send metrics to monitoring system
       await monitoringSystem.sendMetrics('rate_limiter', metrics);
       
       // Check for anomalies
       if (metrics.blockedRequests / metrics.totalRequests > 0.1) {
           await alertingSystem.sendAlert({
               type: 'high_block_rate',
               details: metrics
           });
       }
   }, 60000); // Every minute
   ```

### Rate Limiting Strategies

- **IP-based**: Prevent abuse from specific IP addresses
- **Wallet-based**: Limit requests per wallet address
- **API-based**: Control usage per API key
- **Endpoint-specific**: Different limits for different endpoints
- **Adaptive**: Automatically adjust limits based on system load

## DDoS Protection

### Prerequisites

- CDN/WAF service (Cloudflare, AWS WAF, etc.)
- Load balancer with DDoS protection
- Monitoring and alerting system
- Geographic IP filtering capability

### Configuration

```javascript
// DDoS Protection Configuration
const ddosConfig = {
    analysis: {
        windowSize: 60000, // 1 minute
        thresholds: {
            requestRate: 1000, // requests/minute
            errorRate: 0.5, // 50% error rate
            connectionRate: 100 // connections/second
        }
    },
    anomalyDetection: {
        enabled: true,
        algorithm: 'statistical',
        sensitivity: 0.7,
        adaptiveThresholds: true
    },
    geoFiltering: {
        enabled: true,
        blockedCountries: ['CN', 'RU', 'KP'],
        suspiciousCountries: ['IR', 'BY']
    },
    challenges: {
        enabled: true,
        types: ['captcha', 'proof-of-work', 'behavioral'],
        escalation: true
    },
    responses: {
        tarpit: true,
        honeypot: true,
        redirect: false,
        block: true
    }
};

// Initialize DDoS Protection
const ddosProtection = new DDoSProtectionSystem(ddosConfig);
await ddosProtection.initialize();
```

### Deployment Steps

1. **CDN/WAF Setup (Cloudflare Example)**
   ```bash
   # Configure DNS to point to Cloudflare
   dig swappiq.com @1.1.1.1
   
   # Enable security features via API
   curl -X PATCH "https://api.cloudflare.com/client/v4/zones/{zone_id}/settings/security_level" \
     -H "Authorization: Bearer {api_token}" \
     -H "Content-Type: application/json" \
     --data '{"value":"high"}'
   ```

2. **Application-Level Integration**
   ```javascript
   // Express.js middleware
   app.use(async (req, res, next) => {
       try {
           const result = await ddosProtection.analyzeRequest({
               ip: req.ip,
               userAgent: req.headers['user-agent'],
               method: req.method,
               url: req.url,
               headers: req.headers,
               country: req.geoip?.country
           });
           
           if (result.action === 'block') {
               return res.status(429).json({ 
                   error: 'Request blocked',
                   reason: result.reason 
               });
           } else if (result.action === 'challenge') {
               return res.status(202).json({ 
                   challenge: result.challengeRequired 
               });
           }
           
           next();
       } catch (error) {
           console.error('DDoS protection error:', error);
           next();
       }
   });
   ```

3. **Load Balancer Configuration**
   ```nginx
   # Nginx configuration with DDoS protection
   server {
       listen 80;
       server_name swappiq.com;
       
       # Rate limiting
       limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
       limit_req zone=api burst=20 nodelay;
       
       # Connection limiting
       limit_conn_zone $binary_remote_addr zone=conn_limit_per_ip:10m;
       limit_conn conn_limit_per_ip 20;
       
       # Geographic blocking
       geo $geo_blocked {
           default 0;
           include /etc/nginx/blocked_countries.conf;
       }
       
       if ($geo_blocked) {
           return 444;
       }
       
       location / {
           proxy_pass http://backend;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       }
   }
   ```

### Protection Layers

1. **Network Layer**: ISP-level DDoS mitigation
2. **CDN Layer**: Geographic distribution and caching
3. **WAF Layer**: Application-level filtering
4. **Load Balancer**: Connection limiting and health checks
5. **Application Layer**: Intelligent request analysis

## Database Encryption

### Prerequisites

- Database system with encryption support
- Key management system (KMS or HSM)
- Backup and recovery procedures
- Performance monitoring tools

### Configuration

```javascript
// Database Encryption Configuration
const dbEncryptionConfig = {
    defaultAlgorithm: 'aes-256-gcm',
    keyRotation: {
        enabled: true,
        interval: 30 * 24 * 60 * 60 * 1000, // 30 days
        keepOldKeys: 3
    },
    fieldEncryption: {
        sensitiveFields: [
            'privateKey', 'mnemonic', 'password', 
            'apiKey', 'secret', 'email', 'phone'
        ],
        searchableFields: ['email', 'phone', 'walletAddress']
    },
    performance: {
        cacheEnabled: true,
        cacheTTL: 300000, // 5 minutes
        batchEncryption: true,
        lazyDecryption: true
    },
    compliance: {
        gdpr: true,
        ccpa: true,
        pciDss: true,
        auditLogging: true
    }
};

// Initialize Database Encryption
const dbEncryption = new DatabaseEncryptionManager(dbEncryptionConfig);
await dbEncryption.initialize();
```

### Deployment Steps

1. **PostgreSQL Setup with Encryption**
   ```sql
   -- Enable transparent data encryption
   ALTER SYSTEM SET ssl = on;
   ALTER SYSTEM SET ssl_cert_file = '/etc/ssl/certs/server.crt';
   ALTER SYSTEM SET ssl_key_file = '/etc/ssl/private/server.key';
   
   -- Create encrypted tablespace
   CREATE TABLESPACE encrypted_data 
   LOCATION '/var/lib/postgresql/encrypted'
   WITH (encryption_key_id = 'production-key-1');
   
   -- Create tables with encryption
   CREATE TABLE users (
       id SERIAL PRIMARY KEY,
       email VARCHAR(255) ENCRYPTED,
       private_key TEXT ENCRYPTED,
       created_at TIMESTAMP DEFAULT NOW()
   ) TABLESPACE encrypted_data;
   ```

2. **Application Integration**
   ```javascript
   // User model with automatic encryption
   class User {
       static async create(userData) {
           // Encrypt sensitive fields before saving
           const encrypted = await dbEncryption.encryptData(userData);
           return await db.users.create(encrypted);
       }
       
       static async findById(id) {
           const user = await db.users.findByPk(id);
           if (!user) return null;
           
           // Decrypt sensitive fields after retrieval
           return await dbEncryption.decryptData(user.toJSON());
       }
       
       static async updateProfile(id, updates) {
           const encrypted = await dbEncryption.encryptData(updates);
           const [updatedRows] = await db.users.update(encrypted, {
               where: { id }
           });
           return updatedRows > 0;
       }
   }
   ```

3. **Backup Encryption**
   ```bash
   #!/bin/bash
   # Encrypted database backup script
   
   BACKUP_DIR="/var/backups/postgres"
   DATE=$(date +%Y%m%d_%H%M%S)
   BACKUP_FILE="$BACKUP_DIR/swappiq_backup_$DATE.sql"
   ENCRYPTED_FILE="$BACKUP_FILE.gpg"
   
   # Create backup
   pg_dump -U postgres swappiq_production > "$BACKUP_FILE"
   
   # Encrypt backup
   gpg --cipher-algo AES256 --compress-algo 1 --s2k-cipher-algo AES256 \
       --s2k-digest-algo SHA512 --s2k-mode 3 --s2k-count 65536 \
       --symmetric --output "$ENCRYPTED_FILE" "$BACKUP_FILE"
   
   # Remove unencrypted backup
   rm "$BACKUP_FILE"
   
   # Upload to secure storage
   aws s3 cp "$ENCRYPTED_FILE" "s3://swappiq-backups/database/" \
       --server-side-encryption AES256
   ```

### Encryption Strategies

- **Field-Level**: Encrypt specific sensitive columns
- **Row-Level**: Encrypt entire rows based on criteria
- **Table-Level**: Encrypt entire tables
- **Tablespace-Level**: Encrypt at storage level
- **Application-Level**: Encrypt before database storage

## Audit Logging

### Prerequisites

- Centralized logging infrastructure
- SIEM system (optional but recommended)
- Secure log storage with retention policies
- Compliance reporting capabilities

### Configuration

```javascript
// Audit Logging Configuration
const auditConfig = {
    storage: {
        local: {
            enabled: true,
            path: '/var/log/swappiq/audit',
            maxSize: 100 * 1024 * 1024, // 100MB
            maxFiles: 100
        },
        remote: {
            enabled: true,
            endpoints: [
                {
                    url: 'https://logs.swappiq.com/api/audit',
                    authentication: { type: 'bearer', token: process.env.LOG_TOKEN }
                }
            ]
        },
        siem: {
            enabled: true,
            provider: 'splunk',
            endpoint: 'https://splunk.swappiq.com:8088/services/collector',
            credentials: { token: process.env.SPLUNK_TOKEN }
        }
    },
    security: {
        tamperProofing: { enabled: true },
        encryption: { enabled: true },
        digitalSignatures: true
    },
    compliance: {
        standards: {
            sox: true,
            pciDss: true,
            gdpr: true
        },
        retention: {
            period: 7 * 365 * 24 * 60 * 60 * 1000 // 7 years
        }
    },
    monitoring: {
        alerting: {
            enabled: true,
            thresholds: {
                criticalEvents: 10,
                failedLogins: 5,
                dataModifications: 100
            }
        }
    }
};

// Initialize Audit Logger
const auditLogger = new AuditLogger(auditConfig);
await auditLogger.initialize();
```

### Deployment Steps

1. **Log Storage Setup**
   ```bash
   # Create secure log directory
   sudo mkdir -p /var/log/swappiq/audit
   sudo chown swappiq:swappiq /var/log/swappiq/audit
   sudo chmod 750 /var/log/swappiq/audit
   
   # Configure logrotate
   sudo tee /etc/logrotate.d/swappiq-audit <<EOF
   /var/log/swappiq/audit/*.log {
       daily
       rotate 365
       compress
       delaycompress
       missingok
       notifempty
       create 640 swappiq swappiq
       postrotate
           systemctl reload swappiq-api
       endscript
   }
   EOF
   ```

2. **Application Integration**
   ```javascript
   // User authentication logging
   app.post('/api/auth/login', async (req, res) => {
       const { email, password } = req.body;
       
       try {
           const user = await User.authenticate(email, password);
           
           // Log successful authentication
           await auditLogger.log({
               category: 'authentication',
               action: 'user_login',
               priority: 'info',
               userId: user.id,
               ipAddress: req.ip,
               userAgent: req.headers['user-agent'],
               details: {
                   email,
                   loginMethod: 'password',
                   success: true
               }
           });
           
           res.json({ token: user.generateToken() });
       } catch (error) {
           // Log failed authentication
           await auditLogger.log({
               category: 'authentication',
               action: 'login_failed',
               priority: 'high',
               ipAddress: req.ip,
               userAgent: req.headers['user-agent'],
               details: {
                   email,
                   reason: error.message,
                   timestamp: new Date().toISOString()
               }
           });
           
           res.status(401).json({ error: 'Authentication failed' });
       }
   });
   
   // Sensitive data access logging
   app.get('/api/users/:id/private-key', async (req, res) => {
       await auditLogger.log({
           category: 'data_access',
           action: 'private_key_accessed',
           priority: 'critical',
           userId: req.user.id,
           ipAddress: req.ip,
           details: {
               targetUserId: req.params.id,
               purpose: req.query.purpose || 'unknown',
               accessTime: new Date().toISOString()
           }
       });
       
       // ... handle request
   });
   ```

3. **SIEM Integration (Splunk Example)**
   ```javascript
   // Splunk forwarder configuration
   const splunkLogger = new SplunkLogger({
       token: process.env.SPLUNK_HEC_TOKEN,
       url: 'https://splunk.swappiq.com:8088',
       source: 'swappiq-api',
       sourcetype: 'json',
       index: 'swappiq_audit'
   });
   
   // Custom Splunk searches
   const searches = {
       failedLogins: `
           search index=swappiq_audit action=login_failed 
           | stats count by ipAddress 
           | where count > 5 
           | head 10
       `,
       criticalDataAccess: `
           search index=swappiq_audit category=data_access priority=critical 
           | eval hour=strftime(_time,"%H") 
           | stats count by hour 
           | sort hour
       `
   };
   ```

### Audit Event Types

- **Authentication**: Login, logout, password changes
- **Authorization**: Permission changes, role modifications
- **Data Access**: Sensitive data retrieval, exports
- **Data Modification**: Updates, deletions, creations
- **System Events**: Configuration changes, deployments
- **Security Events**: Failed attempts, suspicious activity
- **Compliance Events**: Regulatory actions, reports

## Deployment Configuration

### Environment Setup

```bash
# Production environment variables
export NODE_ENV=production
export DATABASE_URL=postgresql://user:pass@db.swappiq.com:5432/swappiq
export REDIS_URL=redis://redis.swappiq.com:6379
export VAULT_ADDR=https://vault.swappiq.com:8200
export VAULT_TOKEN=your-vault-token
export HSM_CLUSTER_ID=cluster-abc123
export AWS_REGION=us-east-1
export LOG_LEVEL=info
export AUDIT_LOG_LEVEL=debug
```

### Docker Deployment

```dockerfile
# Multi-stage Dockerfile for production
FROM node:18-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

FROM node:18-alpine AS runtime

# Security updates
RUN apk update && apk upgrade

# Create non-root user
RUN addgroup -g 1001 -S swappiq && \
    adduser -S swappiq -u 1001

# Install security tools
RUN apk add --no-cache \
    tini \
    dumb-init \
    curl \
    openssl

WORKDIR /app

# Copy application
COPY --from=builder /app/node_modules ./node_modules
COPY --chown=swappiq:swappiq . .

# Set permissions
RUN chmod 755 /app && \
    chown -R swappiq:swappiq /app

USER swappiq

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

EXPOSE 3000

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]
```

### Kubernetes Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: swappiq-api
  namespace: swappiq-production
spec:
  replicas: 3
  selector:
    matchLabels:
      app: swappiq-api
  template:
    metadata:
      labels:
        app: swappiq-api
      annotations:
        vault.hashicorp.com/agent-inject: "true"
        vault.hashicorp.com/role: "swappiq-api"
        vault.hashicorp.com/agent-inject-secret-config: "secret/swappiq/config"
    spec:
      serviceAccountName: swappiq-api
      securityContext:
        runAsNonRoot: true
        runAsUser: 1001
        fsGroup: 1001
      containers:
      - name: swappiq-api
        image: swappiq/api:latest
        ports:
        - containerPort: 3000
        env:
        - name: NODE_ENV
          value: "production"
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: db-credentials
              key: url
        resources:
          requests:
            memory: "512Mi"
            cpu: "500m"
          limits:
            memory: "1Gi"
            cpu: "1000m"
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /ready
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5
        volumeMounts:
        - name: audit-logs
          mountPath: /var/log/swappiq
      volumes:
      - name: audit-logs
        persistentVolumeClaim:
          claimName: audit-logs-pvc
---
apiVersion: v1
kind: Service
metadata:
  name: swappiq-api-service
  namespace: swappiq-production
spec:
  selector:
    app: swappiq-api
  ports:
  - port: 80
    targetPort: 3000
  type: ClusterIP
```

### Infrastructure as Code (Terraform)

```hcl
# main.tf
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# HSM Cluster
resource "aws_cloudhsm_v2_cluster" "swappiq_hsm" {
  hsm_type   = "hsm1.medium"
  subnet_ids = var.private_subnet_ids

  tags = {
    Name        = "swappiq-production-hsm"
    Environment = "production"
    Project     = "swappiq"
  }
}

# KMS Key for encryption
resource "aws_kms_key" "swappiq_encryption" {
  description             = "SwappiQ encryption key"
  deletion_window_in_days = 7
  
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "EnableIAMUserPermissions"
        Effect = "Allow"
        Principal = {
          AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"
        }
        Action   = "kms:*"
        Resource = "*"
      }
    ]
  })

  tags = {
    Name        = "swappiq-encryption-key"
    Environment = "production"
  }
}

# Secrets Manager for application secrets
resource "aws_secretsmanager_secret" "swappiq_config" {
  name                    = "swappiq/production/config"
  description             = "SwappiQ production configuration"
  recovery_window_in_days = 7

  tags = {
    Environment = "production"
    Project     = "swappiq"
  }
}

# RDS with encryption
resource "aws_db_instance" "swappiq_db" {
  identifier     = "swappiq-production"
  engine         = "postgres"
  engine_version = "15.4"
  instance_class = "db.r6g.xlarge"
  
  allocated_storage     = 100
  max_allocated_storage = 1000
  storage_encrypted     = true
  kms_key_id           = aws_kms_key.swappiq_encryption.arn
  
  db_name  = "swappiq"
  username = "swappiq_admin"
  password = random_password.db_password.result
  
  vpc_security_group_ids = [aws_security_group.rds.id]
  db_subnet_group_name   = aws_db_subnet_group.swappiq.name
  
  backup_retention_period = 30
  backup_window          = "03:00-04:00"
  maintenance_window     = "sun:04:00-sun:05:00"
  
  skip_final_snapshot = false
  final_snapshot_identifier = "swappiq-production-final-snapshot"
  
  enabled_cloudwatch_logs_exports = ["postgresql"]
  
  tags = {
    Name        = "swappiq-production-db"
    Environment = "production"
  }
}

# ElastiCache Redis with encryption
resource "aws_elasticache_replication_group" "swappiq_redis" {
  replication_group_id       = "swappiq-production-redis"
  description                = "SwappiQ production Redis cluster"
  
  node_type          = "cache.r6g.large"
  port               = 6379
  parameter_group_name = "default.redis7"
  
  num_cache_clusters = 3
  
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  auth_token                = random_password.redis_password.result
  
  subnet_group_name = aws_elasticache_subnet_group.swappiq.name
  security_group_ids = [aws_security_group.redis.id]
  
  tags = {
    Name        = "swappiq-production-redis"
    Environment = "production"
  }
}
```

## Monitoring & Alerting

### Metrics Collection

```javascript
// Prometheus metrics configuration
const prometheus = require('prom-client');

// Custom metrics
const httpRequestDuration = new prometheus.Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['method', 'route', 'status_code']
});

const rateLimitHits = new prometheus.Counter({
    name: 'rate_limit_hits_total',
    help: 'Total number of rate limit hits',
    labelNames: ['strategy', 'action']
});

const auditLogsCreated = new prometheus.Counter({
    name: 'audit_logs_created_total',
    help: 'Total number of audit logs created',
    labelNames: ['category', 'priority']
});

const hsmOperations = new prometheus.Counter({
    name: 'hsm_operations_total',
    help: 'Total number of HSM operations',
    labelNames: ['operation', 'status']
});

// Metrics endpoint
app.get('/metrics', async (req, res) => {
    res.set('Content-Type', prometheus.register.contentType);
    res.end(await prometheus.register.metrics());
});
```

### Grafana Dashboards

```json
{
  "dashboard": {
    "title": "SwappiQ Security Dashboard",
    "panels": [
      {
        "title": "Rate Limiting",
        "type": "stat",
        "targets": [
          {
            "expr": "rate(rate_limit_hits_total[5m])",
            "legendFormat": "Rate Limit Hits/sec"
          }
        ]
      },
      {
        "title": "DDoS Protection",
        "type": "graph",
        "targets": [
          {
            "expr": "ddos_requests_blocked_total",
            "legendFormat": "Blocked Requests"
          },
          {
            "expr": "ddos_challenges_sent_total",
            "legendFormat": "Challenges Sent"
          }
        ]
      },
      {
        "title": "HSM Operations",
        "type": "pie",
        "targets": [
          {
            "expr": "hsm_operations_total",
            "legendFormat": "{{operation}}"
          }
        ]
      },
      {
        "title": "Audit Log Volume",
        "type": "graph",
        "targets": [
          {
            "expr": "rate(audit_logs_created_total[5m])",
            "legendFormat": "{{category}}"
          }
        ]
      }
    ]
  }
}
```

### Alerting Rules

```yaml
# Prometheus alerting rules
groups:
- name: swappiq-security
  rules:
  - alert: HighRateLimitHits
    expr: rate(rate_limit_hits_total[5m]) > 100
    for: 2m
    labels:
      severity: warning
    annotations:
      summary: "High rate limit hit rate detected"
      description: "Rate limit hits are above 100/sec for more than 2 minutes"

  - alert: DDoSAttackDetected
    expr: rate(ddos_requests_blocked_total[1m]) > 1000
    for: 1m
    labels:
      severity: critical
    annotations:
      summary: "Potential DDoS attack detected"
      description: "More than 1000 requests blocked per second"

  - alert: HSMConnectionDown
    expr: up{job="hsm"} == 0
    for: 30s
    labels:
      severity: critical
    annotations:
      summary: "HSM connection is down"
      description: "Cannot connect to HSM cluster"

  - alert: CriticalAuditEvents
    expr: rate(audit_logs_created_total{priority="critical"}[5m]) > 10
    for: 1m
    labels:
      severity: warning
    annotations:
      summary: "High critical audit event rate"
      description: "More than 10 critical events per second"

  - alert: DatabaseEncryptionFailure
    expr: rate(database_encryption_errors_total[5m]) > 0
    for: 0s
    labels:
      severity: critical
    annotations:
      summary: "Database encryption failures detected"
      description: "Database encryption operations are failing"
```

## Security Best Practices

### Network Security

1. **Network Segmentation**
   ```bash
   # Configure VPC with multiple subnets
   # Public subnet: Load balancers only
   # Private subnet: Application servers
   # Database subnet: Databases and HSM
   ```

2. **Security Groups**
   ```bash
   # Minimal access rules
   # Allow only necessary ports
   # Use source-specific rules instead of 0.0.0.0/0
   ```

3. **VPN Access**
   ```bash
   # Set up VPN for administrative access
   # Multi-factor authentication required
   # Regular access reviews
   ```

### Application Security

1. **Input Validation**
   ```javascript
   // Validate all inputs
   const Joi = require('joi');
   
   const orderSchema = Joi.object({
       amount: Joi.number().positive().required(),
       price: Joi.number().positive().required(),
       walletAddress: Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/).required()
   });
   ```

2. **Output Encoding**
   ```javascript
   // Sanitize outputs
   const DOMPurify = require('isomorphic-dompurify');
   
   function sanitizeOutput(data) {
       if (typeof data === 'string') {
           return DOMPurify.sanitize(data);
       }
       return data;
   }
   ```

3. **Session Management**
   ```javascript
   // Secure session configuration
   app.use(session({
       secret: process.env.SESSION_SECRET,
       resave: false,
       saveUninitialized: false,
       cookie: {
           secure: true, // HTTPS only
           httpOnly: true, // No JavaScript access
           maxAge: 3600000, // 1 hour
           sameSite: 'strict'
       },
       store: new RedisStore({
           client: redisClient,
           ttl: 3600
       })
   }));
   ```

### Infrastructure Security

1. **Regular Updates**
   ```bash
   # Automated security updates
   sudo apt-get update && sudo apt-get upgrade -y
   
   # Container image scanning
   docker scan swappiq/api:latest
   ```

2. **Backup Security**
   ```bash
   # Encrypted backups with rotation
   # Multiple geographic locations
   # Regular restore testing
   ```

3. **Access Control**
   ```bash
   # Principle of least privilege
   # Regular access reviews
   # Role-based access control
   ```

## Troubleshooting

### Common Issues

1. **HSM Connection Issues**
   ```bash
   # Check HSM cluster status
   aws cloudhsmv2 describe-clusters --cluster-ids cluster-abc123
   
   # Verify network connectivity
   telnet hsm-endpoint 2223
   
   # Check client library
   ldd /opt/cloudhsm/lib/libcloudhsm_pkcs11.so
   ```

2. **Rate Limiting Problems**
   ```bash
   # Check Redis connectivity
   redis-cli -h redis.swappiq.com ping
   
   # Monitor rate limit metrics
   redis-cli -h redis.swappiq.com --scan --pattern "rl:*"
   
   # Clear rate limit data (emergency)
   redis-cli -h redis.swappiq.com flushdb
   ```

3. **Database Encryption Issues**
   ```sql
   -- Check encryption status
   SELECT schemaname, tablename, 
          pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
   FROM pg_tables 
   WHERE schemaname = 'public';
   
   -- Verify key rotation
   SELECT key_version, created_at FROM encryption_keys 
   ORDER BY created_at DESC LIMIT 5;
   ```

4. **Audit Logging Problems**
   ```bash
   # Check log files
   tail -f /var/log/swappiq/audit/audit.log
   
   # Verify log rotation
   ls -la /var/log/swappiq/audit/
   
   # Check disk space
   df -h /var/log
   ```

### Monitoring Commands

```bash
# System health
systemctl status swappiq-api
journalctl -u swappiq-api -f

# Performance monitoring
htop
iostat -x 1
netstat -tuln

# Security monitoring
fail2ban-client status
auditctl -l
```

### Emergency Procedures

1. **Security Incident Response**
   ```bash
   # Immediate actions
   # 1. Isolate affected systems
   # 2. Preserve evidence
   # 3. Notify stakeholders
   # 4. Begin investigation
   ```

2. **Service Recovery**
   ```bash
   # Failover procedures
   # 1. Health check failures
   # 2. Automatic failover
   # 3. Manual intervention
   # 4. Service restoration
   ```

## Conclusion

This comprehensive security infrastructure provides enterprise-grade protection for the SwappiQ protocol through multiple layers of defense:

- **HSM Integration**: Hardware-based key security
- **Secrets Management**: Centralized secret storage and rotation
- **Rate Limiting**: Multi-strategy request throttling
- **DDoS Protection**: Advanced threat detection and mitigation
- **Database Encryption**: Field-level and transparent data encryption
- **Audit Logging**: Comprehensive compliance and security logging

Regular security reviews, penetration testing, and compliance audits should be conducted to maintain the highest security standards.

For support or questions regarding this security infrastructure, contact the SwappiQ security team at security@swappiq.com.