# Comprehensive State Channel and EIP-712 Tests

This directory contains comprehensive test suites for SwappiQ's state channel implementation and EIP-712 signature handling.

## Test Suites

### 1. State Channel Lifecycle Tests (`stateChannels/channelLifecycle.test.ts`)
Tests the complete lifecycle of state channels including:
- Channel creation and initialization
- Collateral deposits and withdrawals
- Off-chain trade execution
- Channel state updates and synchronization
- Dispute resolution and fraud proofs
- Channel settlement and finalization
- Multi-party channels
- Performance and stress tests

### 2. EIP-712 Signature Handling Tests (`eip712/signatureHandling.test.ts`)
Comprehensive tests for EIP-712 typed data signing:
- Domain separator configuration
- Order signing and verification
- Signature recovery
- Typed data structure validation
- Signature replay protection
- Cross-chain signature compatibility
- Quote signature operations
- Performance tests

### 3. Security and Fraud Proof Tests (`security/fraudProofTests.test.ts`)
Security-focused tests including:
- Fraud proof generation and verification
- Double-spend prevention
- Signature forgery prevention
- Channel manipulation attack prevention
- Race condition handling
- Cryptographic attack resistance
- MEV protection

### 4. Full System Integration Tests (`integration/fullSystemTests.test.ts`)
End-to-end integration tests:
- State channel + matching engine integration
- EIP-712 signatures in order submission
- Settlement proof generation
- Merkle tree construction
- Complete trading lifecycle scenarios
- High-frequency trading scenarios

## Running Tests

### Run All Tests
```bash
./test/comprehensive/runTests.ts
```

### Run Individual Test Suite
```bash
npx hardhat test test/comprehensive/stateChannels/channelLifecycle.test.ts
npx hardhat test test/comprehensive/eip712/signatureHandling.test.ts
npx hardhat test test/comprehensive/security/fraudProofTests.test.ts
npx hardhat test test/comprehensive/integration/fullSystemTests.test.ts
```

### Run with Coverage
```bash
npx hardhat coverage --testfiles "test/comprehensive/**/*.test.ts"
```

## Test Configuration

Tests use the following configuration:
- **Network**: Hardhat local network (chainId: 31337)
- **Challenge Period**: 3600 seconds (1 hour)
- **Max Trade Value**: 10,000 ETH
- **HFT Configuration**:
  - Batch Processing Interval: 100ms
  - Max Batch Size: 50 trades
  - Signature Cache Size: 10,000 entries
  - Memory Pool Size: 1,000 pre-allocated trades

## Performance Benchmarks

Expected performance metrics:
- **HFT Throughput**: >100 TPS (trades per second)
- **Average Latency**: <5ms per trade
- **P99 Latency**: <20ms
- **Signature Verification**: >500 verifications/sec
- **State Proof Generation**: <1s for 50 participants

## Security Considerations

The tests verify:
1. **Balance Conservation**: Total balances never exceed collateral
2. **Signature Validation**: All state transitions require valid signatures
3. **Nonce Ordering**: States must have strictly increasing nonces
4. **Fraud Detection**: Invalid states generate verifiable fraud proofs
5. **MEV Resistance**: Trades are processed in fair order
6. **Timing Attack Resistance**: Constant-time signature verification

## Extending Tests

To add new test cases:

1. **State Channel Tests**: Add to `channelLifecycle.test.ts`
2. **EIP-712 Tests**: Add to `signatureHandling.test.ts`
3. **Security Tests**: Add to `fraudProofTests.test.ts`
4. **Integration Tests**: Add to `fullSystemTests.test.ts`

Follow the existing patterns and ensure tests are:
- Deterministic
- Independent
- Well-documented
- Performance-conscious

## Test Reports

Test reports are automatically generated in the format:
`test-report-YYYY-MM-DDTHH-mm-ss.md`

Reports include:
- Summary statistics
- Individual test results
- Performance metrics
- Failure details

## Dependencies

Required packages:
- `chai`: Assertion library
- `ethers`: Ethereum library
- `hardhat`: Development environment
- `@nomiclabs/hardhat-ethers`: Hardhat ethers plugin
- `@types/chai`: TypeScript types
- `@types/mocha`: TypeScript types

## Known Issues

1. **Timeout on Slow Systems**: Increase timeout in `runTests.ts` if needed
2. **Memory Usage**: HFT tests can consume significant memory
3. **Concurrent Tests**: Some tests may fail if run concurrently

## Contributing

When adding tests:
1. Follow existing naming conventions
2. Add descriptive comments
3. Include performance assertions where relevant
4. Update this README with new test descriptions