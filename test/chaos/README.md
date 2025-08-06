# Chaos Engineering Suite for SwappiQ Protocol

This directory contains chaos engineering tools designed to test the resilience and fault tolerance of the SwappiQ Protocol system.

## ⚠️ WARNING

**These tests are destructive and will intentionally break your system!**
- Only run in test environments
- Ensure you have backups
- Some tests require root/sudo privileges
- System recovery may be required after tests

## Overview

The chaos engineering suite tests system behavior under various failure conditions:

### 1. **Service Failure** (`01-service-failure.js`)
- Randomly kills services (Docker containers, processes, systemd services)
- Tests service discovery and recovery mechanisms
- Validates system behavior with missing components

### 2. **Network Chaos** (`02-network-chaos.js`)
- Injects network latency (50-350ms)
- Simulates packet loss (5-20%)
- Creates network partitions
- Throttles bandwidth
- Corrupts DNS resolution

### 3. **Database Chaos** (`03-database-chaos.js`)
- Kills database connections
- Locks critical tables
- Creates slow queries
- Exhausts connection pools
- Triggers failover scenarios
- Simulates deadlocks

### 4. **Redis Chaos** (`04-redis-chaos.js`)
- Kills cluster nodes
- Creates cluster partitions
- Fills memory
- Slows down nodes
- Triggers Sentinel failovers
- Simulates Out-of-Memory conditions

### 5. **Resource Exhaustion** (`05-resource-exhaustion.js`)
- CPU spikes (up to 95% usage)
- Memory leaks
- Disk I/O stress
- Network bandwidth consumption
- File descriptor exhaustion
- Thread exhaustion

## Prerequisites

### Required Tools

```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install -y \
    stress-ng \
    iproute2 \
    iptables \
    iperf3 \
    iostat \
    postgresql-client \
    redis-tools

# macOS
brew install stress-ng iperf3
```

### Required Permissions

Some chaos scenarios require elevated privileges:
```bash
# Run with sudo for network chaos
sudo ./run-chaos.sh network

# Or run entire suite with sudo
sudo ./run-chaos.sh all
```

## Usage

### Interactive Mode

Run the chaos suite with an interactive menu:
```bash
./run-chaos.sh
```

### Command Line Mode

Run specific scenarios:
```bash
# Service failures (5 minutes)
./run-chaos.sh service-failure

# Network chaos (10 minutes)
sudo ./run-chaos.sh network 600

# Database chaos (5 minutes)
./run-chaos.sh database

# Redis chaos (5 minutes)
./run-chaos.sh redis

# Resource exhaustion (5 minutes)
./run-chaos.sh resource

# Run all scenarios
sudo ./run-chaos.sh all
```

### Custom Duration

Specify duration in seconds:
```bash
# Run network chaos for 10 minutes
sudo ./run-chaos.sh network 600

# Run database chaos for 2 minutes
./run-chaos.sh database 120
```

## Architecture

### Core Libraries

1. **ChaosMonkey** (`lib/chaos-monkey.js`)
   - Base chaos engineering framework
   - Manages chaos scenarios and recovery
   - Provides logging and metrics

2. **RedisChaos** (`lib/redis-chaos.js`)
   - Redis-specific chaos operations
   - Cluster and Sentinel management
   - Data consistency testing

3. **DatabaseChaos** (`lib/database-chaos.js`)
   - PostgreSQL chaos operations
   - Connection and query manipulation
   - Replication testing

### Safety Features

1. **Automatic Snapshots**
   - Database backups before chaos
   - Redis snapshots
   - Service state recording

2. **Recovery Mechanisms**
   - Automatic service recovery
   - Network rule cleanup
   - Resource cleanup

3. **Health Monitoring**
   - Continuous health checks
   - Recovery validation
   - Metric collection

## Scenarios in Detail

### Service Failure
```javascript
// Kills random services with configurable recovery
services: [
  { name: 'api-server', autoRecover: true, recoveryDelay: 30000 },
  { name: 'order-matching-engine', autoRecover: true, recoveryDelay: 20000 },
  { name: 'settlement-processor', autoRecover: true, recoveryDelay: 45000 }
]
```

### Network Chaos
```javascript
// Various network disruptions
scenarios: [
  { name: 'latency_spike', latency: '100-300ms', jitter: '30%' },
  { name: 'packet_loss', loss: '5-20%' },
  { name: 'bandwidth_throttle', limit: '1-5 Mbps' },
  { name: 'network_partition', duration: '30-60s' }
]
```

### Database Chaos
```javascript
// Database-specific failures
scenarios: [
  { name: 'connection_kill', pattern: '%node%' },
  { name: 'table_lock', tables: ['orders', 'trades'] },
  { name: 'slow_queries', count: 5 },
  { name: 'failover', promotion: 'replica1' }
]
```

### Redis Chaos
```javascript
// Redis cluster disruptions
scenarios: [
  { name: 'node_kill', recovery: 'automatic' },
  { name: 'cluster_partition', groups: 2 },
  { name: 'memory_pressure', fill: '60-90%' },
  { name: 'sentinel_failover', master: 'mymaster' }
]
```

### Resource Exhaustion
```javascript
// System resource stress
scenarios: [
  { name: 'cpu_spike', cores: '80%', load: '95%' },
  { name: 'memory_leak', target: '70%', growth: 'gradual' },
  { name: 'disk_io_stress', size: '500-1000MB' },
  { name: 'thread_exhaustion', threads: 500 }
]
```

## Monitoring During Chaos

### Real-time Metrics
- Service availability
- Response times
- Error rates
- Resource usage
- Recovery times

### Log Files
```bash
# Chaos logs
tail -f logs/service-failure_*.log
tail -f logs/network-chaos_*.log

# System logs
journalctl -f -u swappiq-api
docker logs -f swappiq-api
```

### Health Checks
```bash
# API health
curl http://localhost:3000/api/health

# Database health
psql -h localhost -U postgres -c "SELECT 1"

# Redis health
redis-cli ping
redis-cli cluster info
```

## Recovery

### Automatic Recovery
Most scenarios include automatic recovery:
- Services restart after specified delays
- Network rules are cleaned up
- Resources are released

### Manual Recovery
If automatic recovery fails:

```bash
# Restart services
docker-compose restart
systemctl restart swappiq-api

# Clear network rules
sudo tc qdisc del dev eth0 root
sudo tc qdisc del dev lo root
sudo iptables -F

# Kill stress processes
pkill -f stress-ng
pkill -f iperf3

# Reset Redis cluster
redis-cli --cluster fix localhost:7000

# Vacuum PostgreSQL
psql -U postgres -d swappiq -c "VACUUM FULL"
```

## Results Analysis

### Success Criteria
- **Service Resilience**: Services recover within SLA
- **Data Integrity**: No data loss during failures
- **Performance**: Degraded but functional under stress
- **Recovery Time**: System returns to normal within 5 minutes

### Metrics Collected
1. **Availability Metrics**
   - Service uptime percentage
   - API success rate
   - Database connectivity

2. **Performance Metrics**
   - Response time percentiles
   - Throughput under stress
   - Resource utilization

3. **Recovery Metrics**
   - Time to detect failure
   - Time to recover
   - Data consistency checks

## Best Practices

1. **Start Small**
   - Run individual scenarios first
   - Increase duration gradually
   - Monitor system carefully

2. **Environment Preparation**
   - Use dedicated test environment
   - Create backups
   - Notify team members

3. **Progressive Chaos**
   - Begin with service failures
   - Add network chaos
   - Combine multiple failures

4. **Documentation**
   - Record all failures
   - Document recovery procedures
   - Update runbooks

## Troubleshooting

### Common Issues

1. **Permission Denied**
   ```bash
   # Run with sudo for network operations
   sudo ./run-chaos.sh network
   ```

2. **Service Won't Recover**
   ```bash
   # Manual service restart
   docker restart <container_name>
   systemctl restart <service_name>
   ```

3. **Network Still Degraded**
   ```bash
   # Reset all network rules
   sudo tc qdisc del dev eth0 root 2>/dev/null
   sudo tc qdisc del dev docker0 root 2>/dev/null
   ```

4. **High Resource Usage**
   ```bash
   # Kill all stress processes
   pkill -9 -f stress-ng
   pkill -9 -f node.*chaos
   ```

## Integration with CI/CD

### GitHub Actions Example
```yaml
name: Chaos Engineering Tests
on:
  schedule:
    - cron: '0 2 * * 1' # Weekly on Monday 2 AM
  workflow_dispatch:

jobs:
  chaos-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      
      - name: Setup environment
        run: |
          sudo apt-get update
          sudo apt-get install -y stress-ng iproute2
      
      - name: Run chaos tests
        run: |
          cd test/chaos
          ./run-chaos.sh service-failure 300
      
      - name: Upload results
        uses: actions/upload-artifact@v2
        with:
          name: chaos-results
          path: test/chaos/results/
```

## Contributing

When adding new chaos scenarios:

1. Follow the existing pattern in `scenarios/`
2. Implement recovery mechanisms
3. Add safety checks
4. Document the scenario
5. Test in isolation first

## Resources

- [Principles of Chaos Engineering](https://principlesofchaos.org/)
- [Chaos Monkey](https://netflix.github.io/chaosmonkey/)
- [Gremlin Chaos Engineering](https://www.gremlin.com/)
- [Litmus Chaos](https://litmuschaos.io/)