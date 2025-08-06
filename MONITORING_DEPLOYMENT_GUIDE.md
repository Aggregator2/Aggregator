# DEX Monitoring System Deployment Guide

## Overview

This guide covers the deployment and configuration of the enhanced DEX monitoring system with security, performance optimizations, and comprehensive fraud detection.

## Prerequisites

### System Requirements
- **Node.js**: v16+ 
- **Redis**: v6+ with TLS support
- **Memory**: Minimum 4GB RAM (8GB+ recommended)
- **Storage**: 50GB+ for metrics retention
- **Network**: VPC with private subnets

### Dependencies
```bash
npm install redis lru-cache
npm install --optional bufferutil utf-8-validate  # WebSocket optimizations
```

## Architecture Overview

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Matching      │    │   Monitoring     │    │   Grafana       │
│   Engine        ├────┤   System         ├────┤   Dashboard     │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                              │
                              ▼
                       ┌──────────────────┐
                       │   Redis Cluster  │
                       │   (Encrypted)    │
                       └──────────────────┘
```

## Component Deployment

### 1. SecureMetricsCollector

```javascript
// Initialize the secure metrics collector
const { getSecureMetricsCollector } = require('./monitoring/secure-metrics-collector');

const metricsConfig = {
  redisUrl: process.env.REDIS_URL,
  encryptionKey: process.env.METRICS_ENCRYPTION_KEY,
  retentionPeriod: 86400 * 7, // 7 days
  maxMemoryMB: 512,
  rateLimitPerSecond: 1000
};

const metrics = getSecureMetricsCollector(metricsConfig);
await metrics.initialize();
```

### 2. RobustSuspiciousActivityDetector

```javascript
const RobustSuspiciousActivityDetector = require('./monitoring/robust-suspicious-activity-detector');

const detectorConfig = {
  alertThreshold: 0.8,
  windowSize: 300000, // 5 minutes
  maxAlertsPerHour: 100,
  enableCircuitBreaker: true,
  enableAdaptiveThresholds: true
};

const detector = new RobustSuspiciousActivityDetector(detectorConfig);
await detector.start(matchingEngine, orderBook);
```

### 3. OptimizedOrderBookVisualizer

```javascript
const OptimizedOrderBookVisualizer = require('./monitoring/optimized-orderbook-visualizer');

const visualizerConfig = {
  updateInterval: 1000,
  maxHistorySize: 3600,
  enableSampling: true,
  sampleRate: 0.1,
  cacheSize: 1000
};

const visualizer = new OptimizedOrderBookVisualizer(matchingEngine, visualizerConfig);
await visualizer.start();
```

## Environment Configuration

### Production Environment Variables

```bash
# Redis Configuration
REDIS_URL=rediss://your-redis-cluster:6380
REDIS_PASSWORD=your-strong-redis-password

# Security Configuration
METRICS_ENCRYPTION_KEY=your-minimum-32-character-encryption-key-here
ENABLE_SECURITY_FEATURES=true

# Performance Configuration
MAX_MEMORY_MB=1024
METRICS_RATE_LIMIT_PER_SECOND=2000
ENABLE_SAMPLING=true
SAMPLE_RATE=0.05

# Monitoring Configuration
ALERT_WEBHOOK_URL=https://your-alert-endpoint.com/webhook
GRAFANA_API_KEY=your-grafana-api-key
PROMETHEUS_PUSH_GATEWAY=http://prometheus-pushgateway:9091

# Network Configuration
NODE_ENV=production
PORT=8080
CORS_ORIGIN=https://your-dashboard.com

# Logging Configuration
LOG_LEVEL=info
LOG_FORMAT=json
AUDIT_LOG_ENABLED=true
```

### Development Environment

```bash
# Basic Redis for development
REDIS_URL=redis://localhost:6379

# Development settings
MAX_MEMORY_MB=256
LOG_LEVEL=debug
ENABLE_SAMPLING=false
```

## Docker Deployment

### Dockerfile
```dockerfile
FROM node:18-alpine

# Security: Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S dexmonitor -u 1001

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy application code
COPY --chown=dexmonitor:nodejs . .

# Security: Set proper permissions
RUN chmod -R 755 /app
RUN chmod 700 /app/monitoring

USER dexmonitor

EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1

CMD ["node", "monitoring/index.js"]
```

### Docker Compose

```yaml
version: '3.8'

services:
  dex-monitoring:
    build: .
    environment:
      - NODE_ENV=production
      - REDIS_URL=redis://redis:6379
      - METRICS_ENCRYPTION_KEY=${METRICS_ENCRYPTION_KEY}
      - MAX_MEMORY_MB=1024
    depends_on:
      - redis
    ports:
      - "8080:8080"
    volumes:
      - ./logs:/app/logs
    restart: unless-stopped
    networks:
      - monitoring-network

  redis:
    image: redis:7-alpine
    command: redis-server --requirepass ${REDIS_PASSWORD} --appendonly yes
    environment:
      - REDIS_PASSWORD=${REDIS_PASSWORD}
    volumes:
      - redis-data:/data
    ports:
      - "6379:6379"
    networks:
      - monitoring-network

  grafana:
    image: grafana/grafana:latest
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=${GRAFANA_PASSWORD}
      - GF_DATABASE_TYPE=postgres
      - GF_DATABASE_HOST=postgres:5432
      - GF_DATABASE_NAME=grafana
      - GF_DATABASE_USER=grafana
      - GF_DATABASE_PASSWORD=${DB_PASSWORD}
    volumes:
      - grafana-data:/var/lib/grafana
      - ./monitoring/grafana/dashboards:/etc/grafana/provisioning/dashboards
      - ./monitoring/grafana/datasources:/etc/grafana/provisioning/datasources
    ports:
      - "3000:3000"
    networks:
      - monitoring-network

volumes:
  redis-data:
  grafana-data:

networks:
  monitoring-network:
    driver: bridge
```

## Kubernetes Deployment

### ConfigMap
```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: dex-monitoring-config
data:
  MAX_MEMORY_MB: "1024"
  METRICS_RATE_LIMIT_PER_SECOND: "2000"
  ENABLE_SAMPLING: "true"
  SAMPLE_RATE: "0.05"
  LOG_LEVEL: "info"
  LOG_FORMAT: "json"
```

### Secret
```yaml
apiVersion: v1
kind: Secret
metadata:
  name: dex-monitoring-secrets
type: Opaque
data:
  redis-url: <base64-encoded-redis-url>
  encryption-key: <base64-encoded-encryption-key>
  grafana-api-key: <base64-encoded-grafana-key>
```

### Deployment
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: dex-monitoring
  labels:
    app: dex-monitoring
spec:
  replicas: 3
  selector:
    matchLabels:
      app: dex-monitoring
  template:
    metadata:
      labels:
        app: dex-monitoring
    spec:
      containers:
      - name: monitoring
        image: dex-monitoring:latest
        ports:
        - containerPort: 8080
        envFrom:
        - configMapRef:
            name: dex-monitoring-config
        - secretRef:
            name: dex-monitoring-secrets
        resources:
          requests:
            memory: "512Mi"
            cpu: "250m"
          limits:
            memory: "2Gi"
            cpu: "1000m"
        livenessProbe:
          httpGet:
            path: /health
            port: 8080
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /ready
            port: 8080
          initialDelaySeconds: 5
          periodSeconds: 5
```

### Service
```yaml
apiVersion: v1
kind: Service
metadata:
  name: dex-monitoring-service
spec:
  selector:
    app: dex-monitoring
  ports:
  - protocol: TCP
    port: 80
    targetPort: 8080
  type: LoadBalancer
```

## Monitoring Setup

### Prometheus Configuration

```yaml
# prometheus.yml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'dex-monitoring'
    static_configs:
      - targets: ['dex-monitoring:8080']
    scrape_interval: 5s
    metrics_path: /metrics

  - job_name: 'redis'
    static_configs:
      - targets: ['redis:6379']

rule_files:
  - "/etc/prometheus/alert-rules.yml"

alerting:
  alertmanagers:
    - static_configs:
        - targets:
          - alertmanager:9093
```

### Grafana Data Source
```yaml
# datasources/prometheus.yml
apiVersion: 1

datasources:
  - name: Prometheus
    type: prometheus
    url: http://prometheus:9090
    access: proxy
    isDefault: true
```

## Performance Tuning

### Memory Optimization
```javascript
// Configure garbage collection
process.env.NODE_OPTIONS = '--max-old-space-size=2048 --gc-interval=100'

// Monitoring memory usage
setInterval(() => {
  const usage = process.memoryUsage();
  console.log('Memory usage:', {
    heapUsed: Math.round(usage.heapUsed / 1024 / 1024) + 'MB',
    heapTotal: Math.round(usage.heapTotal / 1024 / 1024) + 'MB'
  });
}, 60000);
```

### Redis Optimization
```bash
# Redis configuration for production
redis-server --maxmemory 2gb \
             --maxmemory-policy allkeys-lru \
             --save 900 1 \
             --appendonly yes \
             --appendfsync everysec
```

### Node.js Clustering
```javascript
// cluster.js
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
    cluster.fork();
  });
} else {
  require('./monitoring/index.js');
  console.log(`Worker ${process.pid} started`);
}
```

## Security Hardening

### Network Security
```bash
# Firewall rules (iptables)
iptables -A INPUT -p tcp --dport 8080 -s 10.0.0.0/8 -j ACCEPT
iptables -A INPUT -p tcp --dport 6379 -s 10.0.0.0/8 -j ACCEPT
iptables -A INPUT -p tcp --dport 8080 -j DROP
iptables -A INPUT -p tcp --dport 6379 -j DROP
```

### TLS Configuration
```javascript
// HTTPS server setup
const https = require('https');
const fs = require('fs');

const options = {
  key: fs.readFileSync('/path/to/private-key.pem'),
  cert: fs.readFileSync('/path/to/certificate.pem'),
  ca: fs.readFileSync('/path/to/ca-certificate.pem')
};

https.createServer(options, app).listen(8443);
```

## Health Checks

### Application Health Endpoint
```javascript
app.get('/health', (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    redis: redis.isReady ? 'connected' : 'disconnected',
    components: {
      metricsCollector: metrics.isConnected(),
      suspiciousActivityDetector: detector.isDetecting,
      orderBookVisualizer: visualizer.isRunning()
    }
  };
  
  const isHealthy = health.redis === 'connected' && 
                   health.components.metricsCollector &&
                   health.components.suspiciousActivityDetector;
  
  res.status(isHealthy ? 200 : 503).json(health);
});
```

## Backup and Recovery

### Redis Backup
```bash
#!/bin/bash
# backup-redis.sh
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/backups/redis"

# Create backup
redis-cli --rdb $BACKUP_DIR/dump_$DATE.rdb

# Encrypt backup
gpg --cipher-algo AES256 --compress-algo 1 --symmetric \
    --output $BACKUP_DIR/dump_$DATE.rdb.gpg \
    $BACKUP_DIR/dump_$DATE.rdb

# Remove unencrypted backup
rm $BACKUP_DIR/dump_$DATE.rdb

# Upload to S3 (optional)
aws s3 cp $BACKUP_DIR/dump_$DATE.rdb.gpg \
          s3://your-backup-bucket/redis/
```

### Configuration Backup
```bash
#!/bin/bash
# backup-config.sh
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/backups/config"

# Backup configuration files
tar -czf $BACKUP_DIR/monitoring_config_$DATE.tar.gz \
    monitoring/ \
    docker-compose.yml \
    kubernetes/ \
    --exclude=node_modules \
    --exclude=logs
```

## Troubleshooting

### Common Issues

#### High Memory Usage
```bash
# Check memory usage by component
curl http://localhost:8080/metrics/memory

# Force garbage collection
curl -X POST http://localhost:8080/gc

# Emergency cleanup
curl -X POST http://localhost:8080/cleanup
```

#### Redis Connection Issues
```bash
# Test Redis connectivity
redis-cli -h your-redis-host -p 6379 ping

# Check Redis memory usage
redis-cli info memory

# Monitor Redis commands
redis-cli monitor
```

#### Performance Issues
```bash
# Check performance metrics
curl http://localhost:8080/metrics/performance

# Analyze slow queries
curl http://localhost:8080/metrics/slow-queries

# Check circuit breaker status
curl http://localhost:8080/metrics/circuit-breaker
```

### Log Analysis
```bash
# Monitor application logs
tail -f logs/combined.log | jq '.'

# Monitor error logs
tail -f logs/error.log | jq '. | select(.level == "error")'

# Monitor security events
tail -f logs/security.log | jq '. | select(.type == "security_alert")'
```

## Scaling Considerations

### Horizontal Scaling
- **Load Balancing**: Use sticky sessions for WebSocket connections
- **Redis Clustering**: Implement Redis Cluster for high availability
- **Metrics Sharding**: Distribute metrics across multiple Redis instances
- **Regional Deployment**: Deploy monitoring in multiple regions

### Vertical Scaling
- **Memory**: Increase container memory limits
- **CPU**: Add more CPU cores for compute-intensive operations
- **Storage**: Use SSD storage for better I/O performance
- **Network**: Ensure sufficient network bandwidth

---

For deployment support or issues, refer to the troubleshooting section or contact the infrastructure team.