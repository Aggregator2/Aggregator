# SettlementQueueV5 - Production Deployment Guide

## Table of Contents
1. [Pre-Deployment Checklist](#pre-deployment-checklist)
2. [Security Configuration](#security-configuration)
3. [Performance Optimization](#performance-optimization)
4. [Monitoring Setup](#monitoring-setup)
5. [Deployment Steps](#deployment-steps)
6. [Post-Deployment Verification](#post-deployment-verification)
7. [Operational Procedures](#operational-procedures)
8. [Emergency Procedures](#emergency-procedures)
9. [Maintenance and Updates](#maintenance-and-updates)

---

## Pre-Deployment Checklist

### ✅ Security Requirements

- [ ] **Security Audit Completed**: All critical and high-severity vulnerabilities addressed
- [ ] **Code Review**: Multi-person review of all smart contracts and backend services
- [ ] **Formal Verification**: Critical functions formally verified using symbolic execution
- [ ] **Penetration Testing**: External security testing completed
- [ ] **Bug Bounty**: Active bug bounty program established

### ✅ Smart Contract Verification

- [ ] **Contract Compilation**: Verified deterministic compilation with exact compiler version
- [ ] **Source Code Verification**: All contracts verified on Etherscan/block explorer
- [ ] **Constructor Parameters**: All deployment parameters documented and verified
- [ ] **Upgrade Paths**: Upgrade mechanisms tested and documented
- [ ] **Emergency Controls**: Emergency pause/stop mechanisms tested

### ✅ Infrastructure Requirements

- [ ] **Multi-Signature Wallets**: 3/5 multi-sig configured for all admin functions
- [ ] **Oracle Network**: Minimum 3 independent oracle providers configured
- [ ] **Database Setup**: PostgreSQL cluster with read replicas and automatic failover
- [ ] **Monitoring Systems**: Prometheus/Grafana stack with 24/7 alerting
- [ ] **Backup Systems**: Automated backups with disaster recovery procedures
- [ ] **Load Balancers**: High-availability load balancers with health checks

### ✅ Operational Readiness

- [ ] **Team Training**: Operations team trained on system management
- [ ] **Documentation**: Complete operational runbooks and troubleshooting guides
- [ ] **Incident Response**: Incident response procedures tested and documented
- [ ] **Communication Plans**: Stakeholder communication procedures established
- [ ] **Legal Compliance**: Regulatory compliance verified for target jurisdictions

---

## Security Configuration

### Smart Contract Security

#### Role-Based Access Control Setup

```solidity
// 1. Deploy with initial admin
const settlement = await SettlementQueueV5.deploy(/* constructor params */);

// 2. Configure multi-signature wallets
const adminMultiSig = "0x..."; // 3/5 multi-sig for admin operations
const guardianMultiSig = "0x..."; // 3/5 multi-sig for emergency operations
const operatorWallet = "0x..."; // Hot wallet for routine operations

// 3. Grant roles to multi-sig wallets
await settlement.grantRole(await settlement.DEFAULT_ADMIN_ROLE(), adminMultiSig);
await settlement.grantRole(await settlement.GUARDIAN_ROLE(), guardianMultiSig);
await settlement.grantRole(await settlement.OPERATOR_ROLE(), operatorWallet);

// 4. Revoke deployer's admin role
await settlement.renounceRole(await settlement.DEFAULT_ADMIN_ROLE(), deployerAddress);
```

#### Oracle Security Configuration

```javascript
// Configure multiple oracle providers for redundancy
const oracleConfig = {
    providers: [
        {
            name: "Chainlink",
            address: "0x...",
            weight: 40,
            updateFrequency: 30 // seconds
        },
        {
            name: "Uniswap V3 TWAP",
            address: "0x...",
            weight: 35,
            updateFrequency: 60
        },
        {
            name: "Custom Oracle Network",
            address: "0x...",
            weight: 25,
            updateFrequency: 45
        }
    ],
    consensusThreshold: 2, // Minimum 2 oracles must agree
    maxDeviation: 1000, // 10% maximum price deviation
    stalePriceThreshold: 300 // 5 minutes
};

// Deploy oracle configuration
await settlement.configureOracles(
    oracleConfig.providers.map(p => p.address),
    oracleConfig.providers.map(p => p.weight),
    oracleConfig.consensusThreshold,
    oracleConfig.maxDeviation
);
```

### Database Security

#### PostgreSQL Security Configuration

```sql
-- 1. Create dedicated database user with limited privileges
CREATE USER settlement_app WITH PASSWORD 'SECURE_RANDOM_PASSWORD';

-- 2. Create separate users for different access levels
CREATE USER settlement_read_only WITH PASSWORD 'SECURE_RANDOM_PASSWORD';
CREATE USER settlement_admin WITH PASSWORD 'SECURE_RANDOM_PASSWORD';

-- 3. Grant appropriate permissions
GRANT SELECT, INSERT, UPDATE ON orders, user_balances, settlement_transactions TO settlement_app;
GRANT SELECT ON audit_log, order_history TO settlement_read_only;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO settlement_admin;

-- 4. Enable row-level security
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_access_policy ON audit_log
    FOR ALL TO settlement_read_only
    USING (compliance_level != 'critical');

-- 5. Configure SSL/TLS
ALTER SYSTEM SET ssl = on;
ALTER SYSTEM SET ssl_cert_file = '/path/to/server.crt';
ALTER SYSTEM SET ssl_key_file = '/path/to/server.key';
```

### API Security

#### Authentication and Authorization

```javascript
// JWT-based authentication with role-based access control
const authConfig = {
    jwtSecret: process.env.JWT_SECRET, // 256-bit random secret
    jwtExpiration: '1h',
    refreshTokenExpiration: '7d',
    
    // Rate limiting configuration
    rateLimiting: {
        windowMs: 60 * 1000, // 1 minute
        max: 100, // Maximum 100 requests per minute
        standardHeaders: true,
        legacyHeaders: false,
    },
    
    // API key configuration for system integrations
    apiKeys: {
        enabled: true,
        keyLength: 64,
        permissions: ['read', 'write', 'admin']
    }
};

// Apply security middleware
app.use(helmet()); // Security headers
app.use(cors(corsOptions)); // CORS configuration
app.use(rateLimit(authConfig.rateLimiting));
app.use('/api', authenticate);
app.use('/api', authorize);
```

---

## Performance Optimization

### Smart Contract Gas Optimization

#### Deployment with Optimized Settings

```javascript
// Hardhat configuration for production deployment
module.exports = {
    solidity: {
        version: "0.8.19",
        settings: {
            optimizer: {
                enabled: true,
                runs: 1000000 // Optimize for deployment cost vs. execution cost
            },
            viaIR: true, // Enable intermediate representation for better optimization
            outputSelection: {
                "*": {
                    "*": ["evm.bytecode", "evm.deployedBytecode", "abi"]
                }
            }
        }
    },
    
    // Gas reporter configuration
    gasReporter: {
        enabled: true,
        currency: 'USD',
        gasPrice: 20, // gwei
        coinmarketcap: process.env.COINMARKETCAP_API_KEY
    }
};

// Deployment script with gas optimization
async function deployOptimized() {
    const gasPrice = await ethers.provider.getGasPrice();
    const optimizedGasPrice = gasPrice.mul(110).div(100); // 10% above current gas price
    
    const settlement = await SettlementQueueV5.deploy({
        gasPrice: optimizedGasPrice,
        gasLimit: 6000000
    });
    
    console.log(`Deployed with gas price: ${ethers.utils.formatUnits(optimizedGasPrice, 'gwei')} gwei`);
    console.log(`Deployment cost: ${ethers.utils.formatEther(receipt.gasUsed.mul(optimizedGasPrice))} ETH`);
}
```

### Database Performance Optimization

#### PostgreSQL Configuration for High-Performance

```sql
-- Production PostgreSQL configuration (postgresql.conf)
-- Memory configuration (for 32GB RAM server)
shared_buffers = 8GB
effective_cache_size = 24GB
work_mem = 256MB
maintenance_work_mem = 2GB

-- WAL configuration for high-throughput writes
wal_buffers = 64MB
max_wal_size = 8GB
min_wal_size = 2GB
checkpoint_completion_target = 0.9

-- Connection and concurrency
max_connections = 500
max_prepared_transactions = 100

-- Query planner optimization
random_page_cost = 1.1  # SSD-optimized
effective_io_concurrency = 200
max_worker_processes = 16
max_parallel_workers_per_gather = 4

-- Create performance-optimized indexes
CREATE INDEX CONCURRENTLY idx_orders_trader_status_optimized 
ON orders (trader_address, status, created_at DESC) 
WHERE status IN ('pending', 'revealed', 'processing')
INCLUDE (id, priority, token_in, token_out, amount_in);

CREATE INDEX CONCURRENTLY idx_orders_priority_processing 
ON orders (priority DESC, created_at ASC) 
WHERE status = 'revealed'
INCLUDE (id, trader_address, token_in, token_out, amount_in);
```

### Application Performance Optimization

#### Node.js Configuration for Production

```javascript
// Production server configuration
const cluster = require('cluster');
const numCPUs = require('os').cpus().length;

if (cluster.isMaster) {
    console.log(`Master ${process.pid} is running`);
    
    // Fork workers
    for (let i = 0; i < numCPUs; i++) {
        cluster.fork();
    }
    
    cluster.on('exit', (worker, code, signal) => {
        console.log(`Worker ${worker.process.pid} died`);
        cluster.fork(); // Replace dead worker
    });
} else {
    // Worker process
    const app = require('./app');
    
    // Performance optimizations
    app.set('trust proxy', true);
    
    // Connection pooling
    const poolConfig = {
        max: 20, // Maximum pool size
        min: 5,  // Minimum pool size
        acquireTimeoutMillis: 60000,
        idleTimeoutMillis: 30000,
        reapIntervalMillis: 1000,
        createRetryIntervalMillis: 200
    };
    
    // Redis connection pooling
    const redisCluster = new Redis.Cluster([
        { host: 'redis-1', port: 6379 },
        { host: 'redis-2', port: 6379 },
        { host: 'redis-3', port: 6379 }
    ], {
        enableOfflineQueue: false,
        retryDelayOnFailover: 100,
        maxRetriesPerRequest: 3
    });
    
    const server = app.listen(process.env.PORT || 3000, () => {
        console.log(`Worker ${process.pid} started`);
    });
    
    // Graceful shutdown
    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);
    
    function gracefulShutdown() {
        console.log('Received kill signal, shutting down gracefully');
        server.close(() => {
            console.log('Process terminated');
            process.exit(0);
        });
    }
}
```

---

## Monitoring Setup

### Comprehensive Monitoring Stack

#### Prometheus Configuration

```yaml
# prometheus.yml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

rule_files:
  - "settlement_queue_alerts.yml"

scrape_configs:
  - job_name: 'settlement-queue-api'
    static_configs:
      - targets: ['localhost:3000']
    scrape_interval: 10s
    metrics_path: /metrics
    
  - job_name: 'settlement-queue-contracts'
    static_configs:
      - targets: ['localhost:9090']
    scrape_interval: 30s
    
  - job_name: 'postgres-exporter'
    static_configs:
      - targets: ['localhost:9187']
    scrape_interval: 15s
    
  - job_name: 'redis-exporter'
    static_configs:
      - targets: ['localhost:9121']
    scrape_interval: 15s

alertmanager_configs:
  - static_configs:
      - targets: ['localhost:9093']
```

#### Alert Rules Configuration

```yaml
# settlement_queue_alerts.yml
groups:
- name: settlement_queue_critical
  rules:
  - alert: HighGasUsage
    expr: avg_gas_per_order > 150000
    for: 5m
    labels:
      severity: warning
    annotations:
      summary: "High gas usage detected"
      description: "Average gas per order is {{ $value }}"
      
  - alert: OracleConsensusFailure
    expr: oracle_consensus_failures > 3
    for: 1m
    labels:
      severity: critical
    annotations:
      summary: "Oracle consensus failure"
      description: "{{ $value }} consensus failures in the last minute"
      
  - alert: DatabaseConnectionPoolExhausted
    expr: database_connection_pool_active >= database_connection_pool_max * 0.9
    for: 2m
    labels:
      severity: warning
    annotations:
      summary: "Database connection pool nearly exhausted"
      
  - alert: SettlementQueueBacklog
    expr: settlement_queue_depth > 1000
    for: 5m
    labels:
      severity: warning
    annotations:
      summary: "Large settlement queue backlog"
      description: "{{ $value }} orders in settlement queue"
```

#### Grafana Dashboard Configuration

```json
{
  "dashboard": {
    "title": "SettlementQueue V5 Production Dashboard",
    "panels": [
      {
        "title": "Orders Per Minute",
        "type": "graph",
        "targets": [
          {
            "expr": "rate(orders_submitted_total[1m]) * 60",
            "legendFormat": "Orders/min"
          }
        ]
      },
      {
        "title": "Gas Usage",
        "type": "graph", 
        "targets": [
          {
            "expr": "avg_gas_per_order",
            "legendFormat": "Avg Gas per Order"
          },
          {
            "expr": "p95_gas_per_order",
            "legendFormat": "95th Percentile"
          }
        ]
      },
      {
        "title": "Settlement Success Rate",
        "type": "stat",
        "targets": [
          {
            "expr": "rate(settlements_successful_total[5m]) / rate(settlements_attempted_total[5m]) * 100",
            "legendFormat": "Success Rate %"
          }
        ]
      },
      {
        "title": "Oracle Price Deviations",
        "type": "graph",
        "targets": [
          {
            "expr": "oracle_price_deviation_percent",
            "legendFormat": "{{ oracle_name }}"
          }
        ]
      }
    ]
  }
}
```

---

## Deployment Steps

### Step 1: Infrastructure Preparation

```bash
#!/bin/bash
# infrastructure-setup.sh

# 1. Set up production environment
export NODE_ENV=production
export DATABASE_URL="postgresql://user:pass@localhost:5432/settlement_queue"
export REDIS_URL="redis://localhost:6379"

# 2. Install dependencies
npm ci --only=production

# 3. Build application
npm run build

# 4. Set up SSL certificates
sudo certbot --nginx -d api.settlementqueue.com

# 5. Configure firewall
sudo ufw enable
sudo ufw allow 22    # SSH
sudo ufw allow 80    # HTTP
sudo ufw allow 443   # HTTPS
sudo ufw allow 5432  # PostgreSQL (internal only)
sudo ufw allow 6379  # Redis (internal only)

# 6. Set up log rotation
sudo cp configs/logrotate/settlement-queue /etc/logrotate.d/

# 7. Configure systemd services
sudo cp configs/systemd/settlement-queue.service /etc/systemd/system/
sudo systemctl enable settlement-queue
sudo systemctl daemon-reload
```

### Step 2: Database Migration

```bash
#!/bin/bash
# database-migration.sh

# 1. Create database backup
pg_dump -h localhost -U postgres settlement_queue > backup_$(date +%Y%m%d_%H%M%S).sql

# 2. Run database migrations
npm run migrate:production

# 3. Create database indexes
psql -h localhost -U postgres -d settlement_queue -f database/production-indexes.sql

# 4. Set up partition management
psql -h localhost -U postgres -d settlement_queue -c "SELECT partition_mgmt.create_future_partitions();"

# 5. Configure automated maintenance
echo "0 2 * * * postgres psql -d settlement_queue -c 'SELECT partition_mgmt.daily_maintenance();'" | sudo crontab -
```

### Step 3: Smart Contract Deployment

```javascript
// deploy-production.js
const { ethers, upgrades } = require("hardhat");

async function deployProduction() {
    console.log("Starting production deployment...");
    
    // 1. Verify network
    const network = await ethers.provider.getNetwork();
    console.log(`Deploying to network: ${network.name} (${network.chainId})`);
    
    if (network.chainId !== 1) {
        throw new Error("This script is for mainnet deployment only");
    }
    
    // 2. Check deployer balance
    const [deployer] = await ethers.getSigners();
    const balance = await deployer.getBalance();
    console.log(`Deployer balance: ${ethers.utils.formatEther(balance)} ETH`);
    
    if (balance.lt(ethers.utils.parseEther("0.5"))) {
        throw new Error("Insufficient balance for deployment");
    }
    
    // 3. Deploy contracts
    const SettlementQueueV5 = await ethers.getContractFactory("SettlementQueueV5_Optimized");
    
    const constructorArgs = [
        ["0x...oracle1", "0x...oracle2", "0x...oracle3"], // Oracle addresses
        "SettlementQueueV5",
        "1.0"
    ];
    
    console.log("Deploying SettlementQueueV5...");
    const settlement = await SettlementQueueV5.deploy(...constructorArgs);
    await settlement.deployed();
    
    console.log(`SettlementQueueV5 deployed to: ${settlement.address}`);
    
    // 4. Verify contract on Etherscan
    console.log("Verifying contract on Etherscan...");
    await hre.run("verify:verify", {
        address: settlement.address,
        constructorArguments: constructorArgs,
    });
    
    // 5. Configure initial settings
    console.log("Configuring initial settings...");
    
    // Set up roles
    const adminMultiSig = "0x..."; // Production multi-sig
    const guardianMultiSig = "0x..."; // Emergency multi-sig
    
    await settlement.grantRole(await settlement.GUARDIAN_ROLE(), guardianMultiSig);
    await settlement.grantRole(await settlement.DEFAULT_ADMIN_ROLE(), adminMultiSig);
    
    // Configure system parameters
    await settlement.setMaxBatchSize(50);
    await settlement.setCircuitBreakerThreshold(1000);
    
    // 6. Save deployment information
    const deploymentInfo = {
        network: network.name,
        chainId: network.chainId,
        contractAddress: settlement.address,
        deployer: deployer.address,
        deploymentHash: settlement.deployTransaction.hash,
        blockNumber: settlement.deployTransaction.blockNumber,
        timestamp: new Date().toISOString(),
        constructorArgs,
        gasUsed: settlement.deployTransaction.gasLimit.toString(),
        gasPrice: settlement.deployTransaction.gasPrice.toString()
    };
    
    require('fs').writeFileSync(
        'deployment-production.json',
        JSON.stringify(deploymentInfo, null, 2)
    );
    
    console.log("Production deployment completed successfully!");
    return settlement;
}

deployProduction()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
```

### Step 4: Application Deployment

```bash
#!/bin/bash
# deploy-application.sh

# 1. Deploy to production servers
echo "Deploying to production servers..."

# Build and deploy API server
docker build -t settlement-queue-api:latest .
docker tag settlement-queue-api:latest your-registry/settlement-queue-api:latest
docker push your-registry/settlement-queue-api:latest

# Deploy using Docker Compose
docker-compose -f docker-compose.production.yml up -d

# 2. Run health checks
echo "Running health checks..."
sleep 30

# Check API health
curl -f http://localhost:3000/health || exit 1

# Check database connectivity
npm run db:health-check || exit 1

# Check Redis connectivity
redis-cli ping || exit 1

# 3. Run smoke tests
echo "Running smoke tests..."
npm run test:smoke:production || exit 1

echo "Application deployment completed successfully!"
```

---

## Post-Deployment Verification

### Automated Verification Script

```bash
#!/bin/bash
# post-deployment-verification.sh

echo "Starting post-deployment verification..."

# 1. Contract verification
echo "Verifying smart contract deployment..."

# Check contract is deployed and verified
CONTRACT_CODE=$(cast code $CONTRACT_ADDRESS --rpc-url $RPC_URL)
if [ ${#CONTRACT_CODE} -lt 10 ]; then
    echo "ERROR: Contract not deployed properly"
    exit 1
fi

# Verify contract on block explorer
echo "Contract deployed successfully at: $CONTRACT_ADDRESS"

# 2. Test core functionality
echo "Testing core contract functionality..."

# Test order submission
cast send $CONTRACT_ADDRESS "submitOrderOptimized((uint128,uint64,uint32,uint32,address,uint64,uint32,address,address,uint128,uint96,uint16,uint8,bool),bytes)" \
    --rpc-url $RPC_URL \
    --private-key $TEST_PRIVATE_KEY \
    --gas-limit 200000

# Test oracle price updates
cast call $CONTRACT_ADDRESS "getOraclePrice(address)" $TEST_TOKEN --rpc-url $RPC_URL

# 3. API functionality tests
echo "Testing API functionality..."

# Health check
curl -f http://localhost:3000/health || exit 1

# Authentication test
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
    -H "Content-Type: application/json" \
    -d '{"username":"test","password":"test"}' | jq -r .token)

if [ "$TOKEN" == "null" ]; then
    echo "ERROR: Authentication failed"
    exit 1
fi

# Order submission test
curl -f -X POST http://localhost:3000/api/orders \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"tokenIn":"0x...","tokenOut":"0x...","amountIn":"1000000000000000000"}' || exit 1

# 4. Database verification
echo "Verifying database setup..."

# Check database connectivity
psql $DATABASE_URL -c "SELECT 1;" || exit 1

# Check partitions are created
PARTITION_COUNT=$(psql $DATABASE_URL -t -c "SELECT COUNT(*) FROM pg_tables WHERE tablename LIKE 'orders_%';")
if [ $PARTITION_COUNT -lt 3 ]; then
    echo "ERROR: Insufficient partitions created"
    exit 1
fi

# Check indexes exist
INDEX_COUNT=$(psql $DATABASE_URL -t -c "SELECT COUNT(*) FROM pg_indexes WHERE tablename = 'orders';")
if [ $INDEX_COUNT -lt 10 ]; then
    echo "ERROR: Insufficient indexes created"
    exit 1
fi

# 5. Monitoring verification
echo "Verifying monitoring setup..."

# Check Prometheus metrics
curl -f http://localhost:9090/metrics | grep -q "settlement_queue" || exit 1

# Check Grafana connectivity
curl -f http://localhost:3001/api/health || exit 1

# 6. Load testing
echo "Running light load test..."
npx artillery run tests/load/light-load-test.yml || exit 1

echo "✅ Post-deployment verification completed successfully!"
echo "🚀 SettlementQueueV5 is ready for production!"
```

---

## Operational Procedures

### Daily Operations Checklist

```bash
#!/bin/bash
# daily-operations-check.sh

echo "=== Daily Operations Check - $(date) ==="

# 1. System health check
echo "📊 System Health Check"
echo "CPU Usage: $(top -bn1 | grep "Cpu(s)" | awk '{print $2}' | awk -F'%' '{print $1}')"
echo "Memory Usage: $(free | grep Mem | awk '{printf("%.1f%%"), $3/$2 * 100.0}')"
echo "Disk Usage: $(df -h / | awk 'NR==2{printf "%s", $5}')"

# 2. Database health
echo "💾 Database Health"
psql $DATABASE_URL -c "SELECT 
    pg_size_pretty(pg_database_size('settlement_queue')) as db_size,
    (SELECT COUNT(*) FROM orders WHERE created_at > NOW() - INTERVAL '24 hours') as orders_24h,
    (SELECT COUNT(*) FROM orders WHERE status = 'pending') as pending_orders;"

# 3. Contract metrics
echo "📋 Contract Metrics"
TOTAL_ORDERS=$(cast call $CONTRACT_ADDRESS "getSystemStats()" --rpc-url $RPC_URL)
echo "Total Orders: $TOTAL_ORDERS"

# 4. Error rates
echo "🚨 Error Rates (Last 24h)"
echo "API Errors: $(grep -c "ERROR" /var/log/settlement-queue/api.log | tail -1000)"
echo "Database Errors: $(grep -c "ERROR" /var/log/postgresql/postgresql.log | tail -1000)"

# 5. Performance metrics
echo "⚡ Performance Metrics"
echo "Average Response Time: $(tail -1000 /var/log/settlement-queue/api.log | grep response_time | awk '{sum+=$NF; count++} END {print sum/count "ms"}')"

# 6. Security alerts
echo "🔒 Security Status"
FAILED_LOGINS=$(grep -c "authentication failed" /var/log/settlement-queue/api.log | tail -100)
echo "Failed Logins (Last 100 entries): $FAILED_LOGINS"

echo "=== Daily Check Complete ==="
```

### Weekly Maintenance

```sql
-- weekly-maintenance.sql
-- Run every Sunday at 2 AM UTC

-- 1. Update database statistics
ANALYZE;

-- 2. Vacuum old partitions
VACUUM (ANALYZE) orders;
VACUUM (ANALYZE) settlement_transactions;

-- 3. Clean up old audit logs
DELETE FROM audit_log WHERE timestamp < NOW() - INTERVAL '90 days' AND compliance_level = 'low';

-- 4. Update materialized views
REFRESH MATERIALIZED VIEW CONCURRENTLY active_orders_summary;
REFRESH MATERIALIZED VIEW CONCURRENTLY token_pair_volume_24h;

-- 5. Check partition health
SELECT partition_mgmt.check_partition_health();

-- 6. Generate weekly report
SELECT 
    'Weekly Report' as period,
    COUNT(*) as total_orders,
    COUNT(*) FILTER (WHERE status = 'completed') as completed_orders,
    AVG(EXTRACT(EPOCH FROM (completed_at - created_at))) as avg_completion_time,
    COUNT(DISTINCT trader_address) as unique_traders
FROM orders 
WHERE created_at > NOW() - INTERVAL '7 days';
```

---

## Emergency Procedures

### Emergency Response Playbook

#### Level 1: System Degradation
**Symptoms**: Slow response times, increased error rates
**Response Time**: 15 minutes

```bash
# 1. Immediate assessment
curl -f http://localhost:3000/health
systemctl status settlement-queue
docker ps

# 2. Scale resources if needed
docker-compose -f docker-compose.production.yml up -d --scale api=3

# 3. Check database performance
psql $DATABASE_URL -c "SELECT * FROM pg_stat_activity WHERE state = 'active' ORDER BY query_start;"

# 4. Monitor recovery
watch "curl -s http://localhost:3000/metrics | grep response_time"
```

#### Level 2: Service Disruption
**Symptoms**: API errors >5%, settlement failures
**Response Time**: 5 minutes

```bash
# 1. Enable circuit breaker
cast send $CONTRACT_ADDRESS "emergencyPause()" --rpc-url $RPC_URL --private-key $GUARDIAN_PRIVATE_KEY

# 2. Scale down traffic
# Update load balancer to reduce traffic by 50%

# 3. Investigate root cause
tail -f /var/log/settlement-queue/error.log
journalctl -u settlement-queue -f

# 4. Implement fix and gradually restore service
cast send $CONTRACT_ADDRESS "unpause()" --rpc-url $RPC_URL --private-key $GUARDIAN_PRIVATE_KEY
```

#### Level 3: Security Incident
**Symptoms**: Suspicious transactions, unauthorized access
**Response Time**: Immediate

```bash
# 1. IMMEDIATE ISOLATION
cast send $CONTRACT_ADDRESS "emergencyPause()" --rpc-url $RPC_URL --private-key $GUARDIAN_PRIVATE_KEY

# 2. Preserve evidence
cp -r /var/log/settlement-queue /incident-$(date +%Y%m%d_%H%M%S)/
pg_dump $DATABASE_URL > incident-db-$(date +%Y%m%d_%H%M%S).sql

# 3. Isolate affected systems
sudo ufw deny out 443  # Block outbound HTTPS if needed
sudo ufw deny in 22    # Block SSH if compromised

# 4. Contact security team
echo "SECURITY INCIDENT DETECTED" | mail -s "URGENT: Settlement Queue Security Alert" security@company.com

# 5. Begin forensic analysis
# Follow incident response procedures
```

---

## Maintenance and Updates

### Update Procedure

#### Smart Contract Updates

```javascript
// contract-upgrade.js
const { ethers, upgrades } = require("hardhat");

async function upgradeContract() {
    console.log("Starting contract upgrade...");
    
    // 1. Deploy new implementation
    const SettlementQueueV6 = await ethers.getContractFactory("SettlementQueueV6");
    
    // 2. Propose upgrade (requires multi-sig)
    const upgradeProposal = await upgrades.prepareUpgrade(PROXY_ADDRESS, SettlementQueueV6);
    console.log("New implementation deployed to:", upgradeProposal);
    
    // 3. Create upgrade proposal with timelock
    const proposal = {
        target: PROXY_ADDRESS,
        value: 0,
        data: upgrades.getUpgradeData(upgradeProposal),
        description: "Upgrade to SettlementQueueV6 with gas optimizations",
        delay: 48 * 3600 // 48 hours
    };
    
    // 4. Submit to timelock
    // This requires multi-sig approval
    console.log("Upgrade proposal ready for multi-sig approval");
    console.log("Proposal:", proposal);
    
    return proposal;
}
```

#### Application Updates

```bash
#!/bin/bash
# application-update.sh

echo "Starting application update..."

# 1. Backup current version
docker tag settlement-queue-api:latest settlement-queue-api:backup-$(date +%Y%m%d)

# 2. Build new version
docker build -t settlement-queue-api:latest .

# 3. Test new version
docker run --rm -d --name test-api settlement-queue-api:latest
sleep 10
curl -f http://localhost:3000/health || exit 1
docker stop test-api

# 4. Rolling update
docker-compose -f docker-compose.production.yml up -d --no-deps api

# 5. Verify update
sleep 30
curl -f http://localhost:3000/health || exit 1

# 6. Run smoke tests
npm run test:smoke:production || {
    echo "Smoke tests failed, rolling back..."
    docker tag settlement-queue-api:backup-$(date +%Y%m%d) settlement-queue-api:latest
    docker-compose -f docker-compose.production.yml up -d --no-deps api
    exit 1
}

echo "Application update completed successfully!"
```

### Backup and Recovery

#### Automated Backup Script

```bash
#!/bin/bash
# backup.sh - Run daily at 3 AM

BACKUP_DIR="/backups/$(date +%Y%m%d)"
mkdir -p $BACKUP_DIR

# 1. Database backup
pg_dump $DATABASE_URL | gzip > $BACKUP_DIR/database.sql.gz

# 2. Configuration backup
tar -czf $BACKUP_DIR/configs.tar.gz /etc/settlement-queue/

# 3. Application state backup
docker exec redis redis-cli BGSAVE
cp /var/lib/redis/dump.rdb $BACKUP_DIR/

# 4. Upload to cloud storage
aws s3 sync $BACKUP_DIR s3://settlement-queue-backups/$(date +%Y%m%d)/

# 5. Cleanup old backups (keep 30 days)
find /backups -type d -mtime +30 -exec rm -rf {} \;

echo "Backup completed: $BACKUP_DIR"
```

---

## Contact Information

### Production Support Team

- **On-Call Engineer**: +1-XXX-XXX-XXXX (24/7)
- **Security Team**: security@company.com
- **DevOps Lead**: devops@company.com
- **Product Owner**: product@company.com

### Escalation Matrix

1. **Level 1**: On-call engineer responds within 15 minutes
2. **Level 2**: Team lead notified, response within 5 minutes  
3. **Level 3**: Executive team notified immediately

### Communication Channels

- **Slack**: #settlement-queue-ops
- **PagerDuty**: settlement-queue-team
- **Status Page**: status.settlementqueue.com

---

## Legal and Compliance

### Regulatory Compliance

- [ ] **KYC/AML**: User verification procedures implemented
- [ ] **Data Protection**: GDPR/CCPA compliance verified
- [ ] **Financial Regulations**: Securities law compliance reviewed
- [ ] **Audit Trail**: Complete transaction history maintained
- [ ] **Reporting**: Regulatory reporting procedures established

### License and Terms

- [ ] **Terms of Service**: Updated and legally reviewed
- [ ] **Privacy Policy**: Comprehensive privacy policy published
- [ ] **API Terms**: Developer API terms and conditions
- [ ] **Liability**: Insurance coverage verified
- [ ] **Jurisdiction**: Legal jurisdiction clearly defined

---

*This production deployment guide provides comprehensive procedures for deploying and operating SettlementQueueV5 in a production environment. Regular updates to this documentation are required as the system evolves.*

**Last Updated**: July 12, 2025  
**Version**: 5.0  
**Classification**: Internal Use Only