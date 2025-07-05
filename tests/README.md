# Comprehensive Trading System Tests

This directory contains comprehensive tests for the matching engine and settlement system, covering unit tests, integration tests, and performance benchmarks.

## Test Structure

```
tests/
├── matching-engine/         # Matching engine specific tests
│   └── comprehensive-matching.test.ts
├── settlement/             # Settlement engine specific tests
│   └── comprehensive-settlement.test.ts
├── integration/            # End-to-end integration tests
│   └── end-to-end-trading.test.ts
├── performance/            # Performance and stress tests
│   └── stress-test.ts
├── setup.ts               # Test setup and utilities
├── run-all-tests.sh       # Test runner script
└── README.md              # This file
```

## Test Categories

### 1. Matching Engine Tests

**Location**: `matching-engine/comprehensive-matching.test.ts`

Tests cover:
- **Price-Time Priority Algorithm**: Verifies correct order matching based on price and time priority
- **Order Types**: Tests for limit, market, stop, and iceberg orders
- **Partial Fills**: Complex scenarios with fragmented liquidity
- **Fee Calculations**: Maker/taker fees and tiered fee structures
- **External Liquidity Integration**: LiFi, Jupiter, and other DEX integrations
- **Smart Order Routing**: Order splitting across venues for best execution
- **Concurrent Processing**: Race condition prevention and consistency
- **Performance**: Sub-millisecond latency and high throughput testing

### 2. Settlement Engine Tests

**Location**: `settlement/comprehensive-settlement.test.ts`

Tests cover:
- **Settlement Batch Creation**: Epochal batching of trades
- **Merkle Proof Generation**: Cryptographic proof generation and verification
- **On-chain Settlement**: Gas optimization and batch execution
- **Multi-chain Settlement**: Cross-chain bridge integration
- **Settlement Claiming**: User claim process with merkle proofs
- **Reconciliation**: Discrepancy detection and resolution
- **IPFS Backup**: Decentralized data backup and recovery
- **Settlement Verification**: On-chain/off-chain state consistency

### 3. Integration Tests

**Location**: `integration/end-to-end-trading.test.ts`

Tests cover:
- **Complete Trade Lifecycle**: Order → Match → Settle → Claim
- **External Liquidity Fallback**: Automatic routing to external DEXs
- **Settlement Proof Validation**: End-to-end proof generation and validation
- **Cross-chain Settlement Flows**: Multi-chain settlement execution
- **Error Recovery**: System resilience and retry mechanisms
- **Data Consistency**: Concurrent operation integrity

### 4. Performance Tests

**Location**: `performance/stress-test.ts`

Tests cover:
- **Throughput Testing**: Orders per second capacity
- **Latency Benchmarks**: P50, P95, P99 latencies
- **Scalability Testing**: Performance at different load levels
- **Longevity Testing**: 24+ hour continuous operation
- **Memory Profiling**: Memory usage and leak detection

## Running Tests

### Run All Tests
```bash
./tests/run-all-tests.sh
```

### Run Specific Test Suites

**Unit Tests Only**:
```bash
npm test -- --selectProjects=unit
```

**Integration Tests Only**:
```bash
npm test -- --selectProjects=integration
```

**Matching Engine Tests**:
```bash
npm test tests/matching-engine/comprehensive-matching.test.ts
```

**Settlement Tests**:
```bash
npm test tests/settlement/comprehensive-settlement.test.ts
```

**Performance Tests**:
```bash
npm run test:performance
# or
node -r ts-node/register tests/performance/stress-test.ts
```

### Run with Coverage
```bash
npm test -- --coverage
```

## Test Configuration

Tests use the configuration in `jest.config.comprehensive.js` which includes:
- TypeScript support via ts-jest
- 2-minute timeout for complex integration tests
- Coverage reporting
- Separate test projects for better organization

## Environment Setup

Tests require:
1. Local Ethereum node (Hardhat/Ganache) running on port 8545
2. Environment variables (automatically set in setup.ts):
   - `ETHEREUM_RPC_URL`: http://localhost:8545
   - `PRIVATE_KEY`: Test wallet private key
   - `SETTLEMENT_CONTRACT_ADDRESS`: Deployed settlement contract

## Performance Benchmarks

Expected performance metrics:
- **Order Submission**: < 1ms average latency
- **Order Matching**: < 0.5ms for simple matches
- **Throughput**: 10,000+ orders/second
- **Settlement Batching**: 1,000+ trades per batch
- **Merkle Proof Generation**: < 1 second for 1,000 settlements

## Continuous Integration

The test suite is designed to run in CI/CD pipelines:

```yaml
# Example GitHub Actions workflow
- name: Run Tests
  run: |
    npm install
    npm run test:ci
    
- name: Upload Coverage
  uses: codecov/codecov-action@v3
  with:
    files: ./coverage/lcov.info
```

## Troubleshooting

### Common Issues

1. **Tests timing out**: Increase timeout in jest.config.comprehensive.js
2. **Memory issues**: Run with `--maxWorkers=2` to limit parallelism
3. **External service failures**: Check mock configurations in setup.ts

### Debug Mode

Run tests with detailed logging:
```bash
DEBUG=* npm test -- --verbose
```

## Contributing

When adding new tests:
1. Place tests in appropriate directory based on category
2. Follow existing naming conventions
3. Include both positive and negative test cases
4. Add performance assertions where applicable
5. Update this README with new test descriptions