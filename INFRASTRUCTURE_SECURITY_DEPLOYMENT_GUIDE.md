# Infrastructure Security Deployment Guide

## SwappiQ Protocol Security Infrastructure

This guide provides comprehensive instructions for deploying and configuring the SwappiQ Protocol security infrastructure components.

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Component Architecture](#component-architecture)
4. [Deployment Steps](#deployment-steps)
5. [Configuration](#configuration)
6. [Monitoring and Maintenance](#monitoring-and-maintenance)
7. [Security Considerations](#security-considerations)
8. [Troubleshooting](#troubleshooting)

## Overview

The SwappiQ security infrastructure consists of six core components:

- **HSM Manager**: Hardware Security Module integration for private key management
- **Secrets Manager**: Vault/AWS KMS integration for secrets management
- **Rate Limiter**: Advanced rate limiting per IP/wallet
- **DDoS Protection**: Multi-layer DDoS protection system
- **Database Encryption**: Field-level encryption at rest
- **Audit Logger**: Comprehensive audit logging with compliance

## Prerequisites

### System Requirements

- **Operating System**: Linux (Ubuntu 20.04+ or CentOS 8+)
- **Node.js**: Version 16.x or higher
- **Memory**: Minimum 8GB RAM (16GB recommended)
- **Storage**: Minimum 100GB SSD
- **Network**: Dedicated security network segment recommended

### Dependencies

```bash
# Install required packages
sudo apt-get update
sudo apt-get install -y nodejs npm docker.io docker-compose
sudo npm install -g pm2

# Install Node.js dependencies
npm install crypto events winston node-vault aws-sdk redis
```

### External Services

- **Redis**: For rate limiting and caching
- **PostgreSQL/MongoDB**: For audit log storage
- **Elasticsearch** (optional): For log analytics
- **HashiCorp Vault** (optional): For secrets management
- **AWS KMS** (optional): For key management

## Component Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  SwappiQ Security Infrastructure             │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │ HSM Manager │  │ Secrets Mgr │  │ Rate Limiter│         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │DDoS Protect │  │ DB Encrypt  │  │ Audit Logger│         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
├─────────────────────────────────────────────────────────────┤
│                   External Dependencies                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │    Redis    │  │ PostgreSQL  │  │Elasticsearch│         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
│  ┌─────────────┐  ┌─────────────┐                          │
│  │    Vault    │  │   AWS KMS   │                          │
│  └─────────────┘  └─────────────┘                          │
└─────────────────────────────────────────────────────────────┘
```

## Deployment Steps

### Step 1: Environment Setup

```bash
# Create security infrastructure directory
sudo mkdir -p /opt/swappiq/security
cd /opt/swappiq/security

# Copy security components
cp /workspace/infrastructure/*.js ./
cp /workspace/INFRASTRUCTURE_SECURITY_DEPLOYMENT_GUIDE.md ./

# Create log directories
sudo mkdir -p /var/log/swappiq
sudo chown -R swappiq:swappiq /var/log/swappiq
sudo chmod 750 /var/log/swappiq
```

### Step 2: Redis Setup

```bash
# Install and configure Redis for rate limiting
sudo apt-get install redis-server

# Configure Redis for security
sudo tee /etc/redis/redis.conf << EOF
bind 127.0.0.1
port 6379
requirepass your_redis_password_here
maxmemory 256mb
maxmemory-policy allkeys-lru
save 900 1
save 300 10
save 60 10000
EOF

sudo systemctl restart redis-server
sudo systemctl enable redis-server
```

### Step 3: Database Setup

```bash
# PostgreSQL setup for audit logs
sudo apt-get install postgresql postgresql-contrib

sudo -u postgres createdb swappiq_audit
sudo -u postgres psql -c "CREATE USER swappiq_audit WITH PASSWORD 'secure_password';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE swappiq_audit TO swappiq_audit;"

# Create audit log table
sudo -u postgres psql swappiq_audit << EOF
CREATE TABLE audit_logs (
    id SERIAL PRIMARY KEY,
    event_id VARCHAR(255) UNIQUE NOT NULL,
    timestamp TIMESTAMP NOT NULL,
    action VARCHAR(255) NOT NULL,
    category VARCHAR(100) NOT NULL,
    level VARCHAR(50) NOT NULL,
    details JSONB,
    context JSONB,
    source JSONB,
    user_info JSONB,
    request_info JSONB,
    compliance JSONB,
    integrity JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_audit_logs_timestamp ON audit_logs(timestamp);
CREATE INDEX idx_audit_logs_category ON audit_logs(category);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_user ON audit_logs((user_info->>'id'));
EOF
```

### Step 4: HashiCorp Vault Setup (Optional)

```bash
# Install Vault
wget https://releases.hashicorp.com/vault/1.15.2/vault_1.15.2_linux_amd64.zip
unzip vault_1.15.2_linux_amd64.zip
sudo mv vault /usr/local/bin/

# Create Vault configuration
sudo mkdir -p /etc/vault
sudo tee /etc/vault/vault.hcl << EOF
storage "file" {
  path = "/opt/vault/data"
}

listener "tcp" {
  address     = "127.0.0.1:8200"
  tls_disable = 1
}

api_addr = "http://127.0.0.1:8200"
cluster_addr = "https://127.0.0.1:8201"
ui = true
EOF

# Create Vault service
sudo tee /etc/systemd/system/vault.service << EOF
[Unit]
Description=HashiCorp Vault
Documentation=https://www.vaultproject.io/
Requires=network-online.target
After=network-online.target
ConditionFileNotEmpty=/etc/vault/vault.hcl

[Service]
Type=notify
User=vault
Group=vault
ProtectSystem=full
ProtectHome=read-only
PrivateTmp=yes
PrivateDevices=yes
SecureBits=keep-caps
AmbientCapabilities=CAP_IPC_LOCK
Capabilities=CAP_IPC_LOCK+ep
CapabilityBoundingSet=CAP_SYSLOG CAP_IPC_LOCK
NoNewPrivileges=yes
ExecStart=/usr/local/bin/vault server -config=/etc/vault/vault.hcl
ExecReload=/bin/kill -HUP $MAINPID
KillMode=process
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
StartLimitInterval=60
StartLimitBurst=3
LimitNOFILE=65536
LimitMEMLOCK=infinity

[Install]
WantedBy=multi-user.target
EOF

sudo useradd --system --home /etc/vault --shell /bin/false vault
sudo mkdir -p /opt/vault/data
sudo chown -R vault:vault /opt/vault
sudo chown -R vault:vault /etc/vault

sudo systemctl enable vault
sudo systemctl start vault
```

### Step 5: Security Configuration Management

Create the security configuration file that integrates all components:

```javascript
// /opt/swappiq/security/SecurityConfig.js
class SecurityConfig {
    constructor() {
        this.config = this._loadConfiguration();
        this.validate();
    }

    _loadConfiguration() {
        return {
            // HSM Configuration
            hsm: {
                enabled: process.env.HSM_ENABLED === 'true',
                provider: process.env.HSM_PROVIDER || 'local',
                region: process.env.AWS_REGION || 'us-east-1',
                keyRotationInterval: parseInt(process.env.HSM_KEY_ROTATION_INTERVAL) || 86400000,
                auditLogging: true,
                pkcs11: {
                    library: process.env.PKCS11_LIBRARY || '/usr/local/lib/softhsm/libsofthsm2.so',
                    slot: parseInt(process.env.PKCS11_SLOT) || 0,
                    pin: process.env.PKCS11_PIN
                },
                aws: {
                    region: process.env.AWS_REGION || 'us-east-1',
                    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
                }
            },

            // Secrets Management
            secrets: {
                provider: process.env.SECRETS_PROVIDER || 'vault',
                vault: {
                    endpoint: process.env.VAULT_ENDPOINT || 'http://127.0.0.1:8200',
                    token: process.env.VAULT_TOKEN,
                    namespace: process.env.VAULT_NAMESPACE || 'swappiq',
                    mountPath: process.env.VAULT_MOUNT_PATH || 'secret'
                },
                aws: {
                    region: process.env.AWS_REGION || 'us-east-1',
                    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
                },
                encryption: {
                    enabled: process.env.SECRETS_ENCRYPTION === 'true',
                    algorithm: 'aes-256-gcm'
                },
                caching: {
                    enabled: process.env.SECRETS_CACHE_ENABLED !== 'false',
                    ttl: parseInt(process.env.SECRETS_CACHE_TTL) || 300000
                }
            },

            // Rate Limiting
            rateLimiting: {
                redis: {
                    host: process.env.REDIS_HOST || '127.0.0.1',
                    port: parseInt(process.env.REDIS_PORT) || 6379,
                    password: process.env.REDIS_PASSWORD,
                    db: parseInt(process.env.REDIS_DB) || 0
                },
                limits: {
                    perIP: {
                        requests: parseInt(process.env.RATE_LIMIT_IP_REQUESTS) || 1000,
                        window: parseInt(process.env.RATE_LIMIT_IP_WINDOW) || 60000
                    },
                    perWallet: {
                        requests: parseInt(process.env.RATE_LIMIT_WALLET_REQUESTS) || 100,
                        window: parseInt(process.env.RATE_LIMIT_WALLET_WINDOW) || 60000
                    },
                    perAPI: {
                        requests: parseInt(process.env.RATE_LIMIT_API_REQUESTS) || 10000,
                        window: parseInt(process.env.RATE_LIMIT_API_WINDOW) || 60000
                    },
                    global: {
                        requests: parseInt(process.env.RATE_LIMIT_GLOBAL_REQUESTS) || 50000,
                        window: parseInt(process.env.RATE_LIMIT_GLOBAL_WINDOW) || 60000
                    }
                },
                blacklist: process.env.RATE_LIMIT_BLACKLIST ? 
                    process.env.RATE_LIMIT_BLACKLIST.split(',') : [],
                whitelist: process.env.RATE_LIMIT_WHITELIST ? 
                    process.env.RATE_LIMIT_WHITELIST.split(',') : ['127.0.0.1', '::1']
            },

            // DDoS Protection
            ddosProtection: {
                enabled: process.env.DDOS_PROTECTION_ENABLED !== 'false',
                thresholds: {
                    requestsPerSecond: parseInt(process.env.DDOS_RPS_THRESHOLD) || 1000,
                    requestsPerMinute: parseInt(process.env.DDOS_RPM_THRESHOLD) || 10000,
                    uniqueIpsPerMinute: parseInt(process.env.DDOS_UNIQUE_IPS_THRESHOLD) || 5000,
                    bandwidthMbps: parseInt(process.env.DDOS_BANDWIDTH_THRESHOLD) || 100,
                    connectionCount: parseInt(process.env.DDOS_CONNECTION_THRESHOLD) || 10000,
                    errorRate: parseFloat(process.env.DDOS_ERROR_RATE_THRESHOLD) || 0.5
                },
                mitigation: {
                    challengeThreshold: parseFloat(process.env.DDOS_CHALLENGE_THRESHOLD) || 0.3,
                    blockThreshold: parseFloat(process.env.DDOS_BLOCK_THRESHOLD) || 0.7,
                    tempBlockDuration: parseInt(process.env.DDOS_TEMP_BLOCK_DURATION) || 300000,
                    permBlockDuration: parseInt(process.env.DDOS_PERM_BLOCK_DURATION) || 86400000
                },
                auditLogging: process.env.DDOS_AUDIT_LOGGING !== 'false'
            },

            // Database Encryption
            databaseEncryption: {
                enabled: process.env.DB_ENCRYPTION_ENABLED !== 'false',
                keyManagement: {
                    provider: process.env.DB_ENCRYPTION_KMS_PROVIDER || 'vault',
                    rotationInterval: parseInt(process.env.DB_ENCRYPTION_KEY_ROTATION) || 86400000,
                    autoRotation: process.env.DB_ENCRYPTION_AUTO_ROTATION !== 'false'
                },
                fields: {
                    encrypted: (process.env.DB_ENCRYPTION_FIELDS || 
                        'privateKey,mnemonic,password,email,phone,address,taxId,bankAccount').split(','),
                    searchable: (process.env.DB_ENCRYPTION_SEARCHABLE_FIELDS || 'email,phone').split(','),
                    sensitive: (process.env.DB_ENCRYPTION_SENSITIVE_FIELDS || 'privateKey,mnemonic,password').split(',')
                },
                performance: {
                    cacheEnabled: process.env.DB_ENCRYPTION_CACHE_ENABLED !== 'false',
                    cacheTTL: parseInt(process.env.DB_ENCRYPTION_CACHE_TTL) || 300000,
                    batchSize: parseInt(process.env.DB_ENCRYPTION_BATCH_SIZE) || 100
                }
            },

            // Audit Logging
            auditLogging: {
                outputs: {
                    file: {
                        enabled: process.env.AUDIT_FILE_ENABLED !== 'false',
                        path: process.env.AUDIT_FILE_PATH || '/var/log/swappiq/audit.log',
                        maxSize: parseInt(process.env.AUDIT_FILE_MAX_SIZE) || 100 * 1024 * 1024,
                        maxFiles: parseInt(process.env.AUDIT_FILE_MAX_FILES) || 50
                    },
                    database: {
                        enabled: process.env.AUDIT_DB_ENABLED === 'true',
                        connectionString: process.env.AUDIT_DB_CONNECTION || 
                            'postgresql://swappiq_audit:secure_password@localhost/swappiq_audit',
                        table: process.env.AUDIT_DB_TABLE || 'audit_logs'
                    },
                    elasticsearch: {
                        enabled: process.env.AUDIT_ES_ENABLED === 'true',
                        nodes: process.env.AUDIT_ES_NODES ? 
                            process.env.AUDIT_ES_NODES.split(',') : ['http://localhost:9200'],
                        index: process.env.AUDIT_ES_INDEX || 'swappiq-audit'
                    }
                },
                categories: {
                    security: { 
                        enabled: true, 
                        encryption: process.env.AUDIT_SECURITY_ENCRYPTION !== 'false' 
                    },
                    financial: { 
                        enabled: true, 
                        encryption: process.env.AUDIT_FINANCIAL_ENCRYPTION !== 'false' 
                    },
                    access: { 
                        enabled: true, 
                        encryption: process.env.AUDIT_ACCESS_ENCRYPTION === 'true' 
                    },
                    admin: { 
                        enabled: true, 
                        encryption: process.env.AUDIT_ADMIN_ENCRYPTION !== 'false' 
                    },
                    error: { 
                        enabled: true, 
                        encryption: process.env.AUDIT_ERROR_ENCRYPTION === 'true' 
                    }
                },
                security: {
                    encryption: { enabled: process.env.AUDIT_ENCRYPTION_ENABLED !== 'false' },
                    integrity: { 
                        enabled: process.env.AUDIT_INTEGRITY_ENABLED !== 'false',
                        chainValidation: process.env.AUDIT_CHAIN_VALIDATION !== 'false'
                    }
                },
                compliance: {
                    gdpr: { 
                        enabled: process.env.COMPLIANCE_GDPR_ENABLED === 'true',
                        anonymization: process.env.COMPLIANCE_GDPR_ANONYMIZATION !== 'false'
                    },
                    sox: { enabled: process.env.COMPLIANCE_SOX_ENABLED === 'true' },
                    pci: { enabled: process.env.COMPLIANCE_PCI_ENABLED === 'true' }
                },
                alerting: {
                    enabled: process.env.AUDIT_ALERTING_ENABLED !== 'false',
                    thresholds: {
                        errorRate: parseFloat(process.env.AUDIT_ERROR_RATE_THRESHOLD) || 0.05,
                        failedLogins: parseInt(process.env.AUDIT_FAILED_LOGIN_THRESHOLD) || 10,
                        privilegedAccess: parseInt(process.env.AUDIT_PRIVILEGED_ACCESS_THRESHOLD) || 5
                    },
                    channels: {
                        email: process.env.AUDIT_ALERT_EMAILS ? 
                            process.env.AUDIT_ALERT_EMAILS.split(',') : ['security@swappiq.com'],
                        webhook: process.env.AUDIT_ALERT_WEBHOOK || null
                    }
                }
            },

            // General Security Settings
            security: {
                encryptionKey: process.env.ENCRYPTION_KEY,
                signingKey: process.env.SIGNING_KEY,
                environment: process.env.NODE_ENV || 'production',
                debug: process.env.DEBUG === 'true'
            }
        };
    }

    validate() {
        const errors = [];

        // Validate HSM configuration
        if (this.config.hsm.enabled) {
            if (this.config.hsm.provider === 'aws' && !this.config.hsm.aws.accessKeyId) {
                errors.push('AWS HSM provider requires ACCESS_KEY_ID');
            }
            if (this.config.hsm.provider === 'local' && !this.config.hsm.pkcs11.pin) {
                errors.push('Local HSM provider requires PKCS11_PIN');
            }
        }

        // Validate Secrets configuration
        if (this.config.secrets.provider === 'vault' && !this.config.secrets.vault.token) {
            errors.push('Vault secrets provider requires VAULT_TOKEN');
        }
        if (this.config.secrets.provider === 'aws' && !this.config.secrets.aws.accessKeyId) {
            errors.push('AWS secrets provider requires ACCESS_KEY_ID');
        }

        // Validate Redis configuration
        if (!this.config.rateLimiting.redis.password) {
            errors.push('Redis requires password for production use');
        }

        // Validate encryption keys
        if (!this.config.security.encryptionKey) {
            errors.push('ENCRYPTION_KEY is required');
        }

        if (errors.length > 0) {
            throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
        }
    }

    get() {
        return this.config;
    }

    getHSMConfig() { return this.config.hsm; }
    getSecretsConfig() { return this.config.secrets; }
    getRateLimitingConfig() { return this.config.rateLimiting; }
    getDDoSProtectionConfig() { return this.config.ddosProtection; }
    getDatabaseEncryptionConfig() { return this.config.databaseEncryption; }
    getAuditLoggingConfig() { return this.config.auditLogging; }
}

module.exports = SecurityConfig;
```

### Step 6: Main Service Implementation

```javascript
// /opt/swappiq/security/SecurityService.js
const SecurityConfig = require('./SecurityConfig');
const { HSMManager } = require('./HSMManager');
const { SecretsManager } = require('./SecretsManager');
const { RateLimiter } = require('./RateLimiter');
const { DDoSProtection } = require('./DDoSProtection');
const { DatabaseEncryption } = require('./DatabaseEncryption');
const { AuditLogger } = require('./AuditLogger');

class SecurityService {
    constructor() {
        this.config = new SecurityConfig();
        this.components = new Map();
        this.initialized = false;
        this.healthStatus = 'unknown';
    }

    async initialize() {
        try {
            console.log('Initializing SwappiQ Security Service...');
            
            // Initialize Audit Logger first (for logging other component initialization)
            this.auditLogger = new AuditLogger(this.config.getAuditLoggingConfig());
            await this.auditLogger.initialize();
            this.components.set('auditLogger', this.auditLogger);

            await this.auditLogger.logSecurityEvent('SECURITY_SERVICE_INIT_STARTED', {
                components: ['auditLogger', 'hsmManager', 'secretsManager', 'rateLimiter', 'ddosProtection', 'databaseEncryption']
            });

            // Initialize HSM Manager if enabled
            if (this.config.getHSMConfig().enabled) {
                this.hsmManager = new HSMManager(this.config.getHSMConfig());
                await this.hsmManager.initialize();
                this.components.set('hsmManager', this.hsmManager);
                
                await this.auditLogger.logSecurityEvent('HSM_MANAGER_INITIALIZED', {
                    provider: this.config.getHSMConfig().provider
                });
            }

            // Initialize Secrets Manager
            this.secretsManager = new SecretsManager(this.config.getSecretsConfig());
            await this.secretsManager.initialize();
            this.components.set('secretsManager', this.secretsManager);
            
            await this.auditLogger.logSecurityEvent('SECRETS_MANAGER_INITIALIZED', {
                provider: this.config.getSecretsConfig().provider
            });

            // Initialize Rate Limiter
            this.rateLimiter = new RateLimiter(this.config.getRateLimitingConfig());
            await this.rateLimiter.initialize();
            this.components.set('rateLimiter', this.rateLimiter);
            
            await this.auditLogger.logSecurityEvent('RATE_LIMITER_INITIALIZED', {
                redis: this.config.getRateLimitingConfig().redis.host
            });

            // Initialize DDoS Protection
            this.ddosProtection = new DDoSProtection(this.config.getDDoSProtectionConfig());
            await this.ddosProtection.initialize();
            this.components.set('ddosProtection', this.ddosProtection);
            
            await this.auditLogger.logSecurityEvent('DDOS_PROTECTION_INITIALIZED', {
                enabled: this.config.getDDoSProtectionConfig().enabled
            });

            // Initialize Database Encryption
            this.databaseEncryption = new DatabaseEncryption(this.config.getDatabaseEncryptionConfig());
            await this.databaseEncryption.initialize();
            this.components.set('databaseEncryption', this.databaseEncryption);
            
            await this.auditLogger.logSecurityEvent('DATABASE_ENCRYPTION_INITIALIZED', {
                provider: this.config.getDatabaseEncryptionConfig().keyManagement.provider
            });

            this.initialized = true;
            this.healthStatus = 'healthy';

            await this.auditLogger.logSecurityEvent('SECURITY_SERVICE_INITIALIZED', {
                components: Array.from(this.components.keys()),
                status: 'success'
            }, 'info');

            console.log('SwappiQ Security Service initialized successfully');

        } catch (error) {
            this.healthStatus = 'failed';
            
            if (this.auditLogger) {
                await this.auditLogger.logSecurityEvent('SECURITY_SERVICE_INIT_FAILED', {
                    error: error.message,
                    stack: error.stack
                }, 'critical');
            }
            
            console.error('Failed to initialize Security Service:', error);
            throw error;
        }
    }

    // Component access methods
    getAuditLogger() { return this.auditLogger; }
    getHSMManager() { return this.hsmManager; }
    getSecretsManager() { return this.secretsManager; }
    getRateLimiter() { return this.rateLimiter; }
    getDDoSProtection() { return this.ddosProtection; }
    getDatabaseEncryption() { return this.databaseEncryption; }

    // Health monitoring
    async performHealthCheck() {
        const health = {
            overall: 'healthy',
            components: {},
            timestamp: new Date().toISOString(),
            uptime: process.uptime()
        };

        let unhealthyCount = 0;
        let totalComponents = this.components.size;

        for (const [name, component] of this.components.entries()) {
            try {
                const componentHealth = {
                    status: 'healthy',
                    lastCheck: new Date().toISOString()
                };

                if (component.getMetrics) {
                    componentHealth.metrics = component.getMetrics();
                }

                if (component.healthCheck) {
                    const healthResult = await component.healthCheck();
                    componentHealth.healthData = healthResult;
                    
                    if (healthResult.status !== 'healthy') {
                        componentHealth.status = healthResult.status;
                        unhealthyCount++;
                    }
                }

                health.components[name] = componentHealth;
            } catch (error) {
                health.components[name] = {
                    status: 'unhealthy',
                    error: error.message,
                    lastCheck: new Date().toISOString()
                };
                unhealthyCount++;
            }
        }

        // Determine overall health
        if (unhealthyCount === 0) {
            health.overall = 'healthy';
        } else if (unhealthyCount < totalComponents / 2) {
            health.overall = 'degraded';
        } else {
            health.overall = 'unhealthy';
        }

        this.healthStatus = health.overall;

        // Log health check if not healthy
        if (health.overall !== 'healthy') {
            await this.auditLogger.logSecurityEvent('SECURITY_SERVICE_HEALTH_DEGRADED', {
                overall: health.overall,
                unhealthyComponents: unhealthyCount,
                totalComponents
            }, 'warning');
        }

        return health;
    }

    async getMetrics() {
        const metrics = {
            service: {
                initialized: this.initialized,
                healthStatus: this.healthStatus,
                uptime: process.uptime(),
                memoryUsage: process.memoryUsage(),
                timestamp: new Date().toISOString()
            },
            components: {}
        };

        for (const [name, component] of this.components.entries()) {
            if (component.getMetrics) {
                try {
                    metrics.components[name] = component.getMetrics();
                } catch (error) {
                    metrics.components[name] = { error: error.message };
                }
            }
        }

        return metrics;
    }

    async shutdown() {
        console.log('Shutting down Security Service...');

        if (this.auditLogger) {
            await this.auditLogger.logSecurityEvent('SECURITY_SERVICE_SHUTDOWN_STARTED', {
                reason: 'graceful_shutdown'
            });
        }

        for (const [name, component] of this.components.entries()) {
            try {
                if (component.cleanup) {
                    await component.cleanup();
                }
                console.log(`${name} shut down successfully`);
            } catch (error) {
                console.error(`Failed to shutdown ${name}:`, error);
            }
        }

        if (this.auditLogger) {
            await this.auditLogger.logSecurityEvent('SECURITY_SERVICE_SHUTDOWN_COMPLETED', {
                components: Array.from(this.components.keys())
            });
        }

        console.log('Security Service shutdown completed');
    }
}

module.exports = SecurityService;
```

### Step 7: HTTP API Server

```javascript
// /opt/swappiq/security/server.js
const express = require('express');
const SecurityService = require('./SecurityService');

class SecurityAPIServer {
    constructor() {
        this.app = express();
        this.securityService = new SecurityService();
        this.server = null;
    }

    async start() {
        try {
            // Initialize security service
            await this.securityService.initialize();

            // Setup middleware
            this.app.use(express.json());
            this.app.use(this._requestLogger.bind(this));
            this.app.use(this._rateLimitMiddleware.bind(this));
            this.app.use(this._ddosProtectionMiddleware.bind(this));

            // Setup routes
            this._setupRoutes();

            // Start server
            const port = process.env.SECURITY_PORT || 3001;
            this.server = this.app.listen(port, () => {
                console.log(`Security API Server listening on port ${port}`);
            });

            // Setup graceful shutdown
            this._setupGracefulShutdown();

        } catch (error) {
            console.error('Failed to start Security API Server:', error);
            throw error;
        }
    }

    _setupRoutes() {
        // Health check endpoint
        this.app.get('/health', async (req, res) => {
            try {
                const health = await this.securityService.performHealthCheck();
                const statusCode = health.overall === 'healthy' ? 200 : 503;
                res.status(statusCode).json(health);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // Metrics endpoint
        this.app.get('/metrics', async (req, res) => {
            try {
                const metrics = await this.securityService.getMetrics();
                res.json(metrics);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // Component-specific endpoints
        this.app.get('/components/:component/metrics', async (req, res) => {
            try {
                const { component } = req.params;
                const comp = this.securityService.components.get(component);
                
                if (!comp) {
                    return res.status(404).json({ error: 'Component not found' });
                }

                if (!comp.getMetrics) {
                    return res.status(400).json({ error: 'Component does not support metrics' });
                }

                const metrics = comp.getMetrics();
                res.json(metrics);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // Audit log query endpoint
        this.app.post('/audit/query', async (req, res) => {
            try {
                const auditLogger = this.securityService.getAuditLogger();
                const results = await auditLogger.queryLogs(req.body.criteria, req.body.options);
                res.json(results);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // Generate compliance report
        this.app.post('/compliance/report', async (req, res) => {
            try {
                const auditLogger = this.securityService.getAuditLogger();
                const report = await auditLogger.generateComplianceReport(req.body);
                res.json(report);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
    }

    async _requestLogger(req, res, next) {
        const auditLogger = this.securityService.getAuditLogger();
        
        if (auditLogger) {
            await auditLogger.logAccessEvent('API_REQUEST', {
                method: req.method,
                path: req.path,
                ip: req.ip,
                userAgent: req.get('User-Agent')
            });
        }
        
        next();
    }

    async _rateLimitMiddleware(req, res, next) {
        try {
            const rateLimiter = this.securityService.getRateLimiter();
            const result = await rateLimiter.checkLimit('ip', req.ip);
            
            if (!result.allowed) {
                return res.status(429).json({
                    error: 'Rate limit exceeded',
                    retryAfter: result.retryAfter
                });
            }
            
            next();
        } catch (error) {
            console.error('Rate limiting middleware error:', error);
            next(); // Continue on error to maintain availability
        }
    }

    async _ddosProtectionMiddleware(req, res, next) {
        try {
            const ddosProtection = this.securityService.getDDoSProtection();
            const result = await ddosProtection.analyzeRequest({
                ip: req.ip,
                userAgent: req.get('User-Agent'),
                method: req.method,
                path: req.path,
                headers: req.headers,
                size: parseInt(req.get('Content-Length')) || 0
            });
            
            if (!result.allowed) {
                if (result.challenge) {
                    return res.status(202).json({
                        challenge: result.challenge,
                        message: 'Complete challenge to continue'
                    });
                } else {
                    return res.status(403).json({
                        error: 'Request blocked by DDoS protection',
                        retryAfter: result.retryAfter
                    });
                }
            }
            
            next();
        } catch (error) {
            console.error('DDoS protection middleware error:', error);
            next(); // Continue on error to maintain availability
        }
    }

    _setupGracefulShutdown() {
        const shutdown = async (signal) => {
            console.log(`Received ${signal}, shutting down gracefully...`);
            
            if (this.server) {
                this.server.close(() => {
                    console.log('HTTP server closed');
                });
            }
            
            await this.securityService.shutdown();
            process.exit(0);
        };

        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT'));
        process.on('SIGQUIT', () => shutdown('SIGQUIT'));
    }
}

// Start server if run directly
if (require.main === module) {
    const server = new SecurityAPIServer();
    server.start().catch(error => {
        console.error('Failed to start server:', error);
        process.exit(1);
    });
}

module.exports = SecurityAPIServer;
```

### Step 8: Process Management Configuration

```javascript
// /opt/swappiq/security/ecosystem.config.js
module.exports = {
    apps: [{
        name: 'swappiq-security',
        script: 'server.js',
        instances: 1,
        autorestart: true,
        watch: false,
        max_memory_restart: '2G',
        env: {
            NODE_ENV: 'production',
            SECURITY_PORT: 3001,
            
            // HSM Configuration
            HSM_ENABLED: 'true',
            HSM_PROVIDER: 'local',
            PKCS11_LIBRARY: '/usr/local/lib/softhsm/libsofthsm2.so',
            PKCS11_SLOT: '0',
            PKCS11_PIN: 'your_hsm_pin',
            
            // Secrets Configuration
            SECRETS_PROVIDER: 'vault',
            VAULT_ENDPOINT: 'http://127.0.0.1:8200',
            VAULT_TOKEN: 'your_vault_token',
            VAULT_NAMESPACE: 'swappiq',
            
            // Redis Configuration
            REDIS_HOST: '127.0.0.1',
            REDIS_PORT: '6379',
            REDIS_PASSWORD: 'your_redis_password',
            
            // Database Configuration
            AUDIT_DB_ENABLED: 'true',
            AUDIT_DB_CONNECTION: 'postgresql://swappiq_audit:secure_password@localhost/swappiq_audit',
            
            // Security Keys
            ENCRYPTION_KEY: 'your_32_byte_encryption_key_here',
            SIGNING_KEY: 'your_signing_key_here',
            
            // Monitoring
            AUDIT_ALERTING_ENABLED: 'true',
            AUDIT_ALERT_EMAILS: 'security@swappiq.com,admin@swappiq.com',
            
            // Compliance
            COMPLIANCE_GDPR_ENABLED: 'true',
            COMPLIANCE_SOX_ENABLED: 'true',
            COMPLIANCE_PCI_ENABLED: 'true'
        },
        error_file: '/var/log/swappiq/security-error.log',
        out_file: '/var/log/swappiq/security-out.log',
        log_file: '/var/log/swappiq/security-combined.log',
        log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    }]
};
```

## Final Deployment Commands

```bash
# Set permissions
sudo chown -R swappiq:swappiq /opt/swappiq/security
sudo chmod 755 /opt/swappiq/security/*.js
sudo chmod 644 /opt/swappiq/security/ecosystem.config.js

# Install dependencies
cd /opt/swappiq/security
npm install

# Start the service
pm2 start ecosystem.config.js
pm2 save
pm2 startup

# Enable automatic startup
sudo systemctl enable pm2-swappiq

# Verify service status
pm2 status
pm2 logs swappiq-security

# Test health endpoint
curl http://localhost:3001/health
```

This completes the comprehensive infrastructure security deployment guide for the SwappiQ Protocol.