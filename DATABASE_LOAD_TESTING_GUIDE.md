# Database Load Testing Guide

## Overview

The SwappiQ Protocol Database Load Testing Framework provides comprehensive performance testing capabilities to ensure the system can handle high-volume trading scenarios. The framework tests concurrent order placement (10k/second), order matching under load, settlement processing bottlenecks, query performance degradation, and connection pool exhaustion.

## Components

### 1. Main Load Testing Framework
- **Location**: `/workspace/test/performance/DatabaseLoadTestFramework.js`
- **Features**:
  - Configurable test scenarios
  - Real-time metrics collection
  - Bottleneck detection
  - Performance recommendations
  - Results persistence

### 2. Load Test Runner
- **Location**: `/workspace/test/performance/load-test-runner.js`
- **Purpose**: Command-line interface for running load tests
- **Features**:
  - Interactive progress display
  - Real-time metrics visualization
  - Detailed results reporting
  - Pass/fail threshold checking

### 3. Specialized Load Tests
- **Location**: `/workspace/test/performance/specialized-load-tests.js`
- **Tests**:
  - OrderPlacementLoadTest: 10k orders/second
  - OrderMatchingLoadTest: Concurrent matching with deadlock detection
  - SettlementLoadTest: Batch processing performance
  - QueryPerformanceTest: Query degradation analysis
  - ConnectionExhaustionTest: Pool limit testing

## Running Load Tests

### Prerequisites

```bash
# Install dependencies
cd /workspace/test/performance
npm install

# Set up test database
export TEST_DB_HOST=localhost
export TEST_DB_PORT=5432
export TEST_DB_NAME=swappiq_test
export TEST_DB_USER=swappiq_test
export TEST_DB_PASSWORD=test_password

# Create test database
createdb swappiq_test
```

### Basic Usage

```bash
# Run all tests with default settings
npm test

# Run specific test scenario
npm run test:orders      # Order placement test
npm run test:matching    # Order matching test
npm run test:settlement  # Settlement processing test
npm run test:queries     # Query performance test
npm run test:connections # Connection exhaustion test

# Run with custom parameters
node load-test-runner.js -s orderPlacement -d 120 -r 15000 -c 150
# -s: scenario
# -d: duration in seconds
# -r: target rate (operations/second)
# -c: max connections
```

### Advanced Usage

```bash
# Run stress test (20k ops/sec, 200 connections, 10 minutes)
npm run test:stress

# Run mixed workload test
node load-test-runner.js -s mixed -d 300

# Save detailed results
node load-test-runner.js --save --verbose
```

## Test Scenarios

### 1. Order Placement Test (10k/second)

Tests high-volume order insertion with:
- Batch insertions for efficiency
- Randomized order parameters
- Price and quantity variations
- Multiple trading pairs

**Key Metrics**:
- Throughput: Should achieve ≥9,000 orders/second
- P95 Latency: Should be <20ms
- Error Rate: Should be <1%

### 2. Order Matching Test

Tests concurrent order matching with:
- SERIALIZABLE isolation level
- Optimistic locking (SKIP LOCKED)
- Deadlock detection and retry
- Trade creation

**Key Metrics**:
- Throughput: Should achieve ≥4,500 matches/second
- P95 Latency: Should be <50ms
- Deadlocks: Should be <10 total

### 3. Settlement Processing Test

Tests batch settlement with:
- Balance updates
- Commission calculations
- Transaction consistency
- Batch processing optimization

**Key Metrics**:
- Throughput: Should achieve ≥900 settlements/second
- P95 Latency: Should be <100ms
- Balance errors: Should be 0

### 4. Query Performance Test

Tests query degradation under load with:
- Order book depth queries
- User history queries
- Aggregation queries
- Complex joins

**Key Metrics**:
- Throughput: Should achieve ≥18,000 queries/second
- P95 Latency: Should be <50ms
- Degradation: Should be <20% over time

### 5. Connection Pool Exhaustion Test

Tests connection pool limits with:
- Gradual load increase
- Connection holding patterns
- Pool wait times
- Failure scenarios

**Key Metrics**:
- Success Rate: Should be >95%
- Max Wait Time: Should be <1000ms
- Pool Utilization: Should handle 80% capacity

## Performance Thresholds

```json
{
  "orderPlacement": {
    "minThroughput": 9000,    // ops/sec
    "p95Latency": 20,         // ms
    "maxErrorRate": 0.01      // 1%
  },
  "orderMatching": {
    "minThroughput": 4500,
    "p95Latency": 50,
    "maxDeadlocks": 10
  },
  "queries": {
    "minThroughput": 18000,
    "p95Latency": 50,
    "maxDegradation": 20      // %
  }
}
```

## Interpreting Results

### Success Indicators
- ✅ All throughput targets met
- ✅ Latency within acceptable ranges
- ✅ Error rates below thresholds
- ✅ No connection pool exhaustion
- ✅ Minimal performance degradation

### Warning Signs
- ⚠️ P95 latency approaching limits
- ⚠️ Connection pool >80% utilized
- ⚠️ Query degradation >10%
- ⚠️ Occasional deadlocks
- ⚠️ Error rate >0.5%

### Failure Indicators
- ❌ Throughput below targets
- ❌ P99 latency exceeding limits
- ❌ Connection pool exhaustion
- ❌ High deadlock rate
- ❌ Cascading failures

## Bottleneck Analysis

The framework automatically detects:

1. **High Latency Operations**
   - Identifies operations exceeding latency thresholds
   - Provides query analysis recommendations

2. **Connection Pool Issues**
   - Detects pool exhaustion
   - Monitors wait times
   - Suggests pool sizing

3. **Query Performance**
   - Identifies slow queries
   - Tracks degradation over time
   - Recommends optimizations

4. **Lock Contention**
   - Monitors deadlocks
   - Tracks lock wait times
   - Suggests isolation levels

## Optimization Recommendations

Based on test results, the framework provides:

### Database Optimizations
- Index recommendations
- Query plan improvements
- Partitioning strategies
- Statistics updates

### Configuration Tuning
- Connection pool sizing
- Statement timeouts
- Work memory settings
- Cache configurations

### Application Changes
- Batch operation sizing
- Retry strategies
- Circuit breaker implementation
- Caching layer addition

## Monitoring During Tests

Real-time metrics display shows:
- Connection pool status
- Throughput by operation
- Error rates
- Latency percentiles
- Active operations

## Results Analysis

After test completion:

```bash
# View results in console
# (Automatically displayed after test)

# Analyze saved results
node analyze-results.js ./test-results/load-test-*.json

# Generate HTML report
node generate-report.js --format html
```

## Troubleshooting

### Common Issues

1. **Connection Refused**
   - Check database is running
   - Verify connection parameters
   - Check firewall rules

2. **Out of Memory**
   - Reduce batch sizes
   - Lower concurrency
   - Increase Node.js heap size

3. **Too Many Connections**
   - Increase max_connections in PostgreSQL
   - Enable PgBouncer
   - Reduce test concurrency

4. **Slow Performance**
   - Run VACUUM ANALYZE
   - Check for missing indexes
   - Review query plans
   - Monitor disk I/O

### Performance Tuning

```sql
-- PostgreSQL settings for load testing
ALTER SYSTEM SET max_connections = 500;
ALTER SYSTEM SET shared_buffers = '4GB';
ALTER SYSTEM SET effective_cache_size = '12GB';
ALTER SYSTEM SET work_mem = '64MB';
ALTER SYSTEM SET maintenance_work_mem = '512MB';
ALTER SYSTEM SET checkpoint_completion_target = 0.9;
ALTER SYSTEM SET wal_buffers = '16MB';
ALTER SYSTEM SET random_page_cost = 1.1;

-- Reload configuration
SELECT pg_reload_conf();
```

## Best Practices

1. **Test Preparation**
   - Run VACUUM ANALYZE before tests
   - Ensure adequate disk space
   - Monitor system resources
   - Use dedicated test environment

2. **During Testing**
   - Start with lower rates
   - Gradually increase load
   - Monitor database logs
   - Watch for system limits

3. **After Testing**
   - Analyze all metrics
   - Review database logs
   - Check for data consistency
   - Document findings

## Integration with CI/CD

```yaml
# Example GitHub Actions workflow
name: Load Tests
on:
  schedule:
    - cron: '0 2 * * *'  # Daily at 2 AM
  workflow_dispatch:

jobs:
  load-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: |
          cd test/performance
          npm install
      
      - name: Run load tests
        env:
          TEST_DB_PASSWORD: ${{ secrets.TEST_DB_PASSWORD }}
        run: |
          cd test/performance
          npm run test:all
      
      - name: Upload results
        uses: actions/upload-artifact@v3
        with:
          name: load-test-results
          path: test/performance/test-results/
```

## Conclusion

Regular load testing ensures the SwappiQ Protocol can handle production workloads. Run these tests:
- Before major releases
- After performance optimizations
- When changing database schema
- As part of capacity planning

The framework provides actionable insights to maintain and improve system performance.