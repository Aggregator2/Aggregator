# Production Deployment Guide

This guide provides comprehensive instructions for deploying the aggregator system to production with full monitoring, logging, and alerting capabilities.

## Table of Contents

1. [Environment Setup](#environment-setup)
2. [Database Configuration](#database-configuration)
3. [Contract Deployment](#contract-deployment)
4. [Service Configuration](#service-configuration)
5. [Monitoring Setup](#monitoring-setup)
6. [Security Checklist](#security-checklist)
7. [Deployment Process](#deployment-process)
8. [Post-Deployment Verification](#post-deployment-verification)

## Environment Setup

### 1. Copy Environment Configuration

```bash
# Copy the production environment template
cp .env.production .env.local

# Edit with your production values
nano .env.local
```

### 2. Required Environment Variables

#### Database Configuration
- `DATABASE_URL`: PostgreSQL connection string
- `REDIS_URL`: Redis connection string
- `MONGODB_URI`: MongoDB connection string (optional, for logs)

#### Settlement Contract Addresses
- `ETH_MAINNET_SETTLEMENT_CONTRACT`: Ethereum mainnet settlement contract
- `ETH_MAINNET_ESCROW_CONTRACT`: Ethereum mainnet escrow contract
- `POLYGON_SETTLEMENT_CONTRACT`: Polygon settlement contract
- `ARBITRUM_SETTLEMENT_CONTRACT`: Arbitrum settlement contract

#### WebSocket Configuration
- `WS_PORT`: WebSocket server port (default: 8080)
- `WS_SSL_ENABLED`: Enable SSL for WebSocket (true/false)
- `WS_SSL_CERT_PATH`: SSL certificate path
- `WS_SSL_KEY_PATH`: SSL key path

#### API Keys
- `ZEROX_API_KEY`: 0x API key
- `ONEINCH_API_KEY`: 1inch API key
- `COINGECKO_API_KEY`: CoinGecko API key
- `CHAINLINK_API_KEY`: Chainlink API key

#### Security
- `JWT_SECRET`: JWT signing secret (generate with `openssl rand -hex 32`)
- `HOT_WALLET_PRIVATE_KEY`: Hot wallet private key for operations

## Database Configuration

### PostgreSQL Setup

```sql
-- Create production database
CREATE DATABASE aggregator_prod;

-- Create user with limited permissions
CREATE USER aggregator_user WITH ENCRYPTED PASSWORD 'your_secure_password';
GRANT CONNECT ON DATABASE aggregator_prod TO aggregator_user;
GRANT USAGE ON SCHEMA public TO aggregator_user;
GRANT CREATE, SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO aggregator_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO aggregator_user;

-- Enable required extensions
\c aggregator_prod
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";
```

### Redis Configuration

```bash
# redis.conf
maxmemory 2gb
maxmemory-policy allkeys-lru
save 900 1
save 300 10
save 60 10000
requirepass your_redis_password
```

### Run Database Migrations

```bash
# Run Prisma migrations
npx prisma migrate deploy

# Seed initial data (if needed)
npx prisma db seed
```

## Contract Deployment

### 1. Deploy Settlement Contracts

```bash
# Deploy to Ethereum mainnet
npx hardhat run scripts/deploy-settlement.js --network mainnet

# Deploy to Polygon
npx hardhat run scripts/deploy-settlement.js --network polygon

# Deploy to Arbitrum
npx hardhat run scripts/deploy-settlement.js --network arbitrum
```

### 2. Verify Contracts

```bash
# Verify on Etherscan
npx hardhat verify --network mainnet DEPLOYED_CONTRACT_ADDRESS

# Save contract addresses to .env.local
echo "ETH_MAINNET_SETTLEMENT_CONTRACT=0x..." >> .env.local
```

## Service Configuration

### 1. Matching Engine Configuration

```typescript
// src/config/matching-engine.config.ts
export const matchingEngineConfig = {
  tickInterval: 100, // milliseconds
  orderBookDepth: 50,
  minOrderSize: 1, // USD
  maxOrderSize: 1000000, // USD
  feeRate: 0.0025, // 0.25%
};
```

### 2. Settlement Engine Configuration

```typescript
// src/config/settlement-engine.config.ts
export const settlementEngineConfig = {
  batchSize: 100,
  batchInterval: 300000, // 5 minutes
  gasPriceMultiplier: 1.2,
  maxGasPriceGwei: 500,
  minProfitUSD: 10,
  slippageTolerance: 0.005, // 0.5%
};
```

## Monitoring Setup

### 1. Prometheus Configuration

```yaml
# prometheus.yml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'aggregator'
    static_configs:
      - targets: ['localhost:9090']
    metrics_path: '/metrics'
```

### 2. Grafana Dashboards

Import the provided dashboards:
- `grafana/dashboards/system-overview.json`
- `grafana/dashboards/trading-metrics.json`
- `grafana/dashboards/settlement-performance.json`

### 3. Alert Rules

```yaml
# alertmanager.yml
groups:
  - name: aggregator_alerts
    rules:
      - alert: HighErrorRate
        expr: rate(http_requests_total{status=~"5.."}[5m]) > 0.05
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: High error rate detected
          
      - alert: SettlementQueueBacklog
        expr: settlement_queue_size > 100
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: Settlement queue backlog detected
```

## Security Checklist

### Pre-Deployment

- [ ] All secrets are stored in environment variables
- [ ] Database connections use SSL
- [ ] API keys have appropriate permissions
- [ ] Hot wallet has limited funds
- [ ] Contract ownership is transferred to multisig
- [ ] Rate limiting is configured
- [ ] CORS is properly configured
- [ ] Security headers are enabled

### Network Security

- [ ] Firewall rules configured
- [ ] VPN access for admin operations
- [ ] DDoS protection enabled
- [ ] SSL certificates installed
- [ ] Security monitoring enabled

## Deployment Process

### 1. Build Application

```bash
# Install dependencies
npm ci --production

# Build TypeScript
npm run build

# Run tests
npm test
```

### 2. Deploy with Docker

```dockerfile
# Dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
RUN npm run build
EXPOSE 3000 8080
CMD ["node", "dist/src/server.js"]
```

```bash
# Build and push Docker image
docker build -t aggregator:latest .
docker tag aggregator:latest your-registry/aggregator:latest
docker push your-registry/aggregator:latest
```

### 3. Kubernetes Deployment

```yaml
# k8s/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: aggregator
spec:
  replicas: 3
  selector:
    matchLabels:
      app: aggregator
  template:
    metadata:
      labels:
        app: aggregator
    spec:
      containers:
      - name: aggregator
        image: your-registry/aggregator:latest
        ports:
        - containerPort: 3000
        - containerPort: 8080
        env:
        - name: NODE_ENV
          value: "production"
        envFrom:
        - secretRef:
            name: aggregator-secrets
        livenessProbe:
          httpGet:
            path: /health/live
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health/ready
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5
```

### 4. Apply Kubernetes Configuration

```bash
# Create namespace
kubectl create namespace aggregator

# Create secrets
kubectl create secret generic aggregator-secrets \
  --from-env-file=.env.local \
  -n aggregator

# Apply deployment
kubectl apply -f k8s/ -n aggregator

# Check deployment status
kubectl get pods -n aggregator
```

## Post-Deployment Verification

### 1. Health Checks

```bash
# Check basic health
curl https://api.yourdomain.com/health

# Check detailed health
curl https://api.yourdomain.com/health/detailed

# Check specific services
curl https://api.yourdomain.com/health/matching-engine
curl https://api.yourdomain.com/health/settlement-engine
```

### 2. Monitoring Verification

- [ ] Prometheus is scraping metrics
- [ ] Grafana dashboards are populated
- [ ] Alerts are configured and firing test alerts
- [ ] Logs are being collected and indexed

### 3. Functional Testing

```bash
# Test order submission
curl -X POST https://api.yourdomain.com/api/orders \
  -H "Content-Type: application/json" \
  -d '{"type":"buy","pair":"ETH/USDC","amount":"1"}'

# Test WebSocket connection
wscat -c wss://api.yourdomain.com/ws
```

### 4. Performance Testing

```bash
# Load test with k6
k6 run tests/load-test.js --vus 100 --duration 5m
```

## Maintenance

### Log Rotation

```bash
# /etc/logrotate.d/aggregator
/var/log/aggregator/*.log {
    daily
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 aggregator aggregator
    sharedscripts
    postrotate
        systemctl reload aggregator
    endscript
}
```

### Backup Strategy

```bash
# Backup script
#!/bin/bash
# backup.sh

# Backup PostgreSQL
pg_dump $DATABASE_URL | gzip > backup_$(date +%Y%m%d_%H%M%S).sql.gz

# Upload to S3
aws s3 cp backup_*.sql.gz s3://aggregator-backups/

# Clean old backups
find . -name "backup_*.sql.gz" -mtime +30 -delete
```

### Monitoring Alerts

Configure alerts for:
- High error rates
- Low disk space
- Database connection failures
- Settlement failures
- Low wallet balance
- High gas prices

## Troubleshooting

### Common Issues

1. **Database Connection Errors**
   - Check connection string
   - Verify network connectivity
   - Check connection pool settings

2. **High Memory Usage**
   - Review memory leaks
   - Adjust Node.js heap size
   - Check for unbounded data structures

3. **Settlement Failures**
   - Check gas prices
   - Verify contract addresses
   - Review wallet balance

### Debug Mode

```bash
# Enable debug logging
export LOG_LEVEL=debug
export DEBUG=aggregator:*

# Run with increased verbosity
node dist/src/server.js
```

## Support

For production support:
- Slack: #aggregator-alerts
- On-call: Use PagerDuty
- Documentation: Internal wiki

Remember to keep this guide updated as the system evolves!