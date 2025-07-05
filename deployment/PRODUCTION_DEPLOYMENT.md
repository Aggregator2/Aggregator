# Production Deployment Guide

## Overview

This guide covers the complete production deployment setup for the Trading Platform, including:
- Docker Compose orchestration
- Nginx with SSL/TLS
- PostgreSQL with automated backups
- Redis caching
- PM2 process management
- Health monitoring
- Log management
- Security best practices

## Prerequisites

- Ubuntu 20.04+ or similar Linux distribution
- Docker 20.10+ and Docker Compose 1.29+
- Domain name with DNS configured
- SSL certificate (automated with Let's Encrypt)
- Minimum 4 CPU cores, 8GB RAM
- 100GB+ SSD storage

## Initial Server Setup

### 1. Update System

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git vim htop net-tools ufw fail2ban
```

### 2. Configure Firewall

```bash
# Allow SSH
sudo ufw allow 22/tcp

# Allow HTTP and HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Enable firewall
sudo ufw enable
```

### 3. Install Docker

```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
```

### 4. Install Docker Compose

```bash
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
```

## Deployment Steps

### 1. Clone Repository

```bash
cd /opt
sudo git clone https://github.com/your-org/trading-platform.git
cd trading-platform
```

### 2. Configure Environment

```bash
# Copy example environment file
cp deployment/.env.example deployment/.env.production

# Edit with your values
vim deployment/.env.production
```

Required configuration:
- Database credentials
- Redis password
- JWT secrets
- API keys
- Domain name
- Email settings

### 3. Setup SSL Certificate

```bash
cd deployment
chmod +x scripts/setup-ssl.sh

# Run SSL setup
sudo ./scripts/setup-ssl.sh --domain your-domain.com --email admin@your-domain.com
```

### 4. Build and Start Services

```bash
# Build images
docker-compose build

# Start services
docker-compose up -d

# Check status
docker-compose ps
```

### 5. Initialize Database

```bash
# Run migrations
docker-compose exec app npm run migrate

# Seed initial data (if needed)
docker-compose exec app npm run seed
```

### 6. Setup Automated Backups

```bash
# Make backup script executable
chmod +x scripts/backup-postgres.sh

# Add to crontab
sudo crontab -e
# Add: 0 2 * * * /opt/trading-platform/deployment/scripts/backup-postgres.sh
```

### 7. Configure Log Rotation

```bash
# Copy logrotate config
sudo cp deployment/logrotate/trading-platform /etc/logrotate.d/

# Test configuration
sudo logrotate -d /etc/logrotate.d/trading-platform
```

### 8. Setup Monitoring

Access monitoring dashboards:
- Prometheus: http://localhost:9090
- Grafana: http://localhost:3030 (admin/admin)

Configure alerts in Grafana for:
- High CPU/Memory usage
- Database connection failures
- API response times
- Error rates

## Health Checks

### API Health Endpoints

```bash
# Simple health check
curl https://your-domain.com/health

# Detailed health check
curl https://your-domain.com/health/detailed

# Prometheus metrics
curl https://your-domain.com/metrics
```

### Service Health

```bash
# Check all services
docker-compose ps

# Check logs
docker-compose logs -f app
docker-compose logs -f nginx
docker-compose logs -f postgres
```

## Security Checklist

### 1. System Security

- [x] Firewall configured (UFW)
- [x] Fail2ban installed and configured
- [x] SSH key authentication only
- [x] Regular security updates enabled

### 2. Application Security

- [x] SSL/TLS with strong ciphers
- [x] Security headers configured
- [x] Rate limiting enabled
- [x] CORS properly configured
- [x] Input validation
- [x] SQL injection protection
- [x] XSS protection

### 3. Database Security

- [x] Strong passwords
- [x] Encrypted connections
- [x] Limited network access
- [x] Regular backups
- [x] Encrypted backups

### 4. Monitoring & Alerts

- [x] Health check endpoints
- [x] Prometheus metrics
- [x] Grafana dashboards
- [x] Log aggregation
- [x] Error tracking (Sentry)
- [x] Uptime monitoring

## Performance Optimization

### 1. Nginx Optimization

- Gzip compression enabled
- Static file caching
- Connection pooling
- Rate limiting

### 2. Node.js Optimization

- PM2 cluster mode
- Memory limits
- Graceful shutdowns
- Health checks

### 3. Database Optimization

- Connection pooling
- Query optimization
- Index management
- Regular VACUUM

### 4. Redis Optimization

- Persistence configuration
- Memory limits
- Eviction policies

## Maintenance Tasks

### Daily

- Monitor error logs
- Check disk space
- Verify backups

### Weekly

- Review performance metrics
- Check security alerts
- Update dependencies

### Monthly

- Security patches
- SSL certificate renewal
- Performance review
- Backup restoration test

## Troubleshooting

### Service Won't Start

```bash
# Check logs
docker-compose logs service-name

# Check resources
df -h
free -m
htop
```

### Database Connection Issues

```bash
# Test connection
docker-compose exec postgres psql -U trading_user -d trading_platform

# Check configuration
docker-compose exec app env | grep DATABASE
```

### High Memory Usage

```bash
# Check memory by container
docker stats

# Restart specific service
docker-compose restart app
```

### SSL Certificate Issues

```bash
# Renew certificate manually
docker-compose run --rm certbot renew

# Check certificate
openssl s_client -connect your-domain.com:443 -servername your-domain.com
```

## Scaling

### Horizontal Scaling

1. **Load Balancer**: Add HAProxy or AWS ALB
2. **Multiple App Instances**: Scale with Docker Swarm or Kubernetes
3. **Database Replication**: Setup PostgreSQL streaming replication
4. **Redis Cluster**: Configure Redis Sentinel

### Vertical Scaling

1. Increase server resources
2. Adjust Docker resource limits
3. Tune database parameters
4. Optimize application code

## Backup and Recovery

### Backup Locations

- Local: `/backups/`
- S3: `s3://your-bucket/postgres-backups/`

### Recovery Process

```bash
# Stop application
docker-compose stop app

# Restore database
gunzip -c /backups/postgres_trading_platform_20240101_020000.sql.gz | \
  docker-compose exec -T postgres psql -U trading_user -d trading_platform

# Start application
docker-compose start app
```

## Monitoring URLs

- Application: https://your-domain.com
- Health Check: https://your-domain.com/health
- Metrics: https://your-domain.com/metrics
- Grafana: https://your-domain.com:3030
- Prometheus: https://your-domain.com:9090

## Support

- Documentation: https://docs.your-domain.com
- Support: support@your-domain.com
- Emergency: +1-234-567-8900

## Version History

- v1.0.0 - Initial deployment
- v1.1.0 - Added monitoring stack
- v1.2.0 - Enhanced security features