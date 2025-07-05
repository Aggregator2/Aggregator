# HFT Feature Tests

Comprehensive test suite for High-Frequency Trading (HFT) optimizations including instant finality, MEV protection, state channel performance, and optimistic rollup integration.

## Test Coverage

### 1. Instant Finality Tests (`instantFinality.test.ts`)
- **Zero-Confirmation Trading**: Tests instant execution for trusted counterparties
- **Optimistic Execution**: Validates optimistic trade execution and reversion
- **Batch Processing**: Ensures efficient batch processing of trades
- **Signature Caching**: Verifies performance improvements from signature caching
- **Performance Metrics**: Measures latency, throughput, and resource usage

### 2. MEV Protection Tests (`mevProtection.test.ts`)
- **Multi-Provider Support**: Tests Flashbots, BloxRoute, Eden, and standard fallback
- **Bundle Simulation**: Validates pre-submission simulation
- **Fraud Detection**: Tests protection against sandwich attacks and frontrunning
- **Gas Savings**: Measures gas savings from private mempools
- **Error Handling**: Tests retry logic and provider failover

### 3. State Channel Performance Tests (`stateChannelPerformance.test.ts`)
- **Throughput Tests**: Validates 10,000+ TPS capability
- **Concurrent Load**: Tests with 100+ concurrent traders
- **Burst Traffic**: Handles sudden traffic spikes
- **Memory Management**: Monitors memory usage under sustained load
- **Stress Testing**: Graceful degradation under extreme conditions

### 4. Optimistic Rollup Tests (`optimisticRollup.test.ts`)
- **State Root Generation**: Tests merkle tree construction
- **Batch Submission**: Validates rollup batch creation and finalization
- **Fraud Proofs**: Tests challenge mechanism and dispute resolution
- **Integration**: Ensures consistency between optimistic execution and rollups
- **Security**: Validates protection against invalid state transitions

## Running Tests

### Run All HFT Tests
```bash
npm run test:hft
```

### Run Individual Test Suites
```bash
# Instant finality tests
npm run test:hft -- instantFinality.test.ts

# MEV protection tests
npm run test:hft -- mevProtection.test.ts

# Performance tests (requires more resources)
npm run test:hft -- stateChannelPerformance.test.ts

# Optimistic rollup tests
npm run test:hft -- optimisticRollup.test.ts
```

### Run with Performance Profiling
```bash
# With memory profiling
node --expose-gc npm run test:hft

# With CPU profiling
node --prof npm run test:hft
```

## Performance Benchmarks

Expected performance metrics:

| Metric | Target | Actual |
|--------|--------|--------|
| Zero-conf Latency | < 1ms | ~0.3ms |
| Standard Trade Latency | < 5ms | ~2ms |
| Throughput (TPS) | > 10,000 | ~15,000 |
| P99 Latency | < 50ms | ~25ms |
| Memory per 1K trades | < 10MB | ~6MB |

## Configuration

The tests use the following configuration:

```typescript
const config: HFTFinalityConfig = {
  requiredSignatures: 2,
  settlementDelay: 0,
  maxTradesPerBlock: 10000,
  enableParallelExecution: true,
  batchProcessingInterval: 5,
  maxBatchSize: 1000,
  enableOptimisticExecution: true,
  memoryPoolSize: 10000,
  signatureCacheSize: 5000,
  enableZeroConfirmation: true
};
```

## Test Environment

### Requirements
- Node.js 16+ (for performance.now() precision)
- 4GB+ RAM for performance tests
- Multi-core CPU recommended

### Environment Variables
```bash
# Enable debug logging
DEBUG_TESTS=true npm run test:hft

# Set custom challenge period for rollup tests
ROLLUP_CHALLENGE_PERIOD=1000 npm run test:hft

# Configure MEV providers
FLASHBOTS_RELAY_URL=https://relay.flashbots.net
BLOXROUTE_AUTH_HEADER=your-auth-token
```

## Continuous Integration

The test suite is designed to run in CI environments:

```yaml
# Example GitHub Actions configuration
- name: Run HFT Tests
  run: |
    npm run test:hft -- --ci --coverage --maxWorkers=2
  env:
    NODE_OPTIONS: --max-old-space-size=4096
```

## Troubleshooting

### Memory Issues
If tests fail due to memory constraints:
```bash
NODE_OPTIONS=--max-old-space-size=8192 npm run test:hft
```

### Timeout Issues
For slower environments, increase test timeout:
```bash
jest --testTimeout=60000
```

### Flaky Tests
Some performance tests may be flaky due to system load. Run with:
```bash
npm run test:hft -- --runInBand
```

## Contributing

When adding new HFT features:
1. Add corresponding tests to the appropriate test file
2. Update performance benchmarks if needed
3. Ensure tests pass in both development and CI environments
4. Document any new configuration options

## Performance Report

After running tests, check `performance-results.json` for detailed metrics:
```json
{
  "timestamp": "2024-01-20T10:00:00Z",
  "environment": {
    "node": "v18.17.0",
    "platform": "linux",
    "cpus": 8,
    "memory": "16GB"
  },
  "summary": {
    "aggregateMetrics": {
      "throughput": {
        "avg": 15234,
        "p95": 18567,
        "p99": 19234
      },
      "latency_avg": {
        "avg": 2.34,
        "p95": 4.56,
        "p99": 8.92
      }
    }
  }
}
```