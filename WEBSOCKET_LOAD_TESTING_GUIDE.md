# WebSocket Load Testing Suite

## Overview

This comprehensive WebSocket load testing suite is designed to stress test WebSocket servers at scale, supporting up to 50,000 concurrent connections and 100,000 messages per second. It includes various test scenarios, memory leak detection, and a real-time performance monitoring dashboard.

## Features

### 1. **Test Scenarios**

#### 50K Concurrent Connections Test
- Tests server capacity with 50,000 simultaneous WebSocket connections
- Distributed across multiple worker processes for optimal performance
- Measures connection success rate, latency, and stability

#### Order Book Subscription Stress Test
- Simulates real-world trading scenarios with order book subscriptions
- Tests rapid subscribe/unsubscribe patterns
- Monitors sequence gaps and data integrity
- Supports 15+ trading pairs with varying depths

#### 100K Messages/Second Throughput Test
- Pushes the server to handle 100,000 messages per second
- Measures sustained throughput and peak performance
- Detects backpressure and message drops
- Monitors CPU and memory usage under load

#### Connection Recovery Test
- Simulates network disruptions and server restarts
- Tests automatic reconnection mechanisms
- Measures recovery time and data loss
- Validates connection stability over time

#### Memory Leak Detection
- Runs long-duration tests with memory profiling
- Takes periodic heap snapshots
- Detects memory growth patterns
- Identifies potential leak sources

### 2. **Performance Monitoring Dashboard**

Real-time web dashboard showing:
- Active connections and connection rate
- Messages per second and throughput (MB/s)
- Latency statistics (average, P95, P99)
- Memory usage and GC activity
- Error rates and error types
- Performance charts and trends

### 3. **Automated Test Runner**

Orchestrates all tests with:
- Sequential test execution
- Configurable test parameters
- Automatic metric validation
- Comprehensive test reporting
- Pass/fail criteria checking

## Installation

```bash
# Install dependencies
npm install ws express uuid
npm install -D @types/ws @types/express typescript ts-node

# Install additional monitoring tools
npm install v8-profiler-next
```

## Usage

### Running Individual Tests

```bash
# 50K connections test
ts-node test/load-testing/websocket/scenarios/50k-connections-test.ts

# Order book stress test
ts-node test/load-testing/websocket/scenarios/orderbook-stress-test.ts

# Throughput test
ts-node test/load-testing/websocket/scenarios/throughput-test.ts

# Connection recovery test
ts-node test/load-testing/websocket/scenarios/connection-recovery-test.ts

# Memory leak detection (requires --expose-gc flag)
node --expose-gc test/load-testing/websocket/scenarios/memory-leak-test.js
```

### Running All Tests

```bash
# Run complete test suite
ts-node test/load-testing/websocket/run-all-tests.ts

# With custom WebSocket URL
WS_URL=ws://your-server:8080 ts-node run-all-tests.ts

# Skip specific tests
SKIP_TESTS="Memory Leak Detection" ts-node run-all-tests.ts
```

### Using the Dashboard

The dashboard automatically starts when running the test suite:
1. Open http://localhost:8081 in your browser
2. Connect to your WebSocket server
3. Select and run tests from the UI
4. Monitor real-time performance metrics

## Configuration

### Environment Variables

```bash
# WebSocket server URL
WS_URL=ws://localhost:8080

# Number of worker processes (for distributed tests)
NUM_WORKERS=8

# Target connection count
CONNECTIONS_TARGET=50000

# Messages per second target
MESSAGES_PER_SECOND=100000

# Test duration in seconds
DURATION=600
```

### Test Configuration

Edit test configurations in `run-all-tests.ts`:

```typescript
{
  name: 'Custom Test',
  script: 'path/to/test.ts',
  duration: 300, // seconds
  env: {
    CUSTOM_VAR: 'value'
  },
  expectedMetrics: {
    minConnections: 10000,
    minMessagesPerSecond: 50000,
    maxLatency: 50, // ms
    maxErrorRate: 1, // percentage
  }
}
```

## Performance Tuning

### System Requirements

For optimal performance:
- **CPU**: 8+ cores recommended
- **RAM**: 16GB+ for 50K connections
- **Network**: 1Gbps+ connection
- **OS**: Linux recommended, tune ulimits

### System Tuning

```bash
# Increase file descriptor limits
ulimit -n 100000

# Tune kernel parameters
sudo sysctl -w net.core.somaxconn=65535
sudo sysctl -w net.ipv4.tcp_max_syn_backlog=65535
sudo sysctl -w net.core.netdev_max_backlog=65535

# For memory leak detection
node --expose-gc --max-old-space-size=8192 memory-leak-test.js
```

### Node.js Optimization

```bash
# Use cluster mode for better CPU utilization
NODE_CLUSTER_SCHED_POLICY=rr node app.js

# Increase V8 heap size
node --max-old-space-size=8192 app.js

# Enable TLS session reuse (for WSS)
NODE_TLS_REJECT_UNAUTHORIZED=0 node app.js
```

## Interpreting Results

### Success Criteria

- **50K Connections**: >90% success rate, <5% error rate
- **Throughput**: >90% of target (90K+ msgs/sec)
- **Latency**: P99 <100ms under load
- **Recovery**: >95% successful reconnections
- **Memory**: <10MB/min growth rate

### Common Issues

1. **EMFILE errors**: Increase ulimits
2. **Timeouts**: Check server capacity
3. **High latency**: Review message processing
4. **Memory leaks**: Check event listener cleanup
5. **Connection drops**: Monitor network stability

## Test Report

After running all tests, a comprehensive report is generated:

```markdown
# WebSocket Load Testing Report

## Summary
- Total Tests: 5
- Passed: 4 ✅
- Failed: 1 ❌
- Success Rate: 80.0%

## Detailed Results
...
```

## Extending the Test Suite

### Adding Custom Tests

1. Create a new test file in `scenarios/`:
```typescript
export class CustomTest {
  async start(): Promise<void> {
    // Your test implementation
  }
}
```

2. Add to test runner configuration
3. Define expected metrics
4. Run the test suite

### Custom Metrics

Extend the metrics collection:
```typescript
tester.on('custom-metric', (data) => {
  // Process custom metric
});
```

## Troubleshooting

### Dashboard Not Loading
- Check if port 8081 is available
- Verify dashboard server started
- Check browser console for errors

### Tests Timing Out
- Increase test duration
- Check server logs
- Monitor system resources

### Inconsistent Results
- Run tests multiple times
- Check for background processes
- Monitor network conditions
- Use dedicated test environment

## Best Practices

1. **Warm up** the server before peak load tests
2. **Monitor** both client and server metrics
3. **Use dedicated** test infrastructure
4. **Run tests** at different times to account for variance
5. **Save results** for trend analysis
6. **Automate** tests in CI/CD pipeline

## Support

For issues or enhancements:
1. Check test logs in console output
2. Review heap snapshots for memory issues
3. Analyze server-side logs
4. Monitor network traffic with Wireshark
5. Profile Node.js with Chrome DevTools