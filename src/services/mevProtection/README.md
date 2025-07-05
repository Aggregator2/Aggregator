# MEV Protection System

This document describes the comprehensive MEV (Maximum Extractable Value) protection system integrated into the settlement engine to prevent front-running, sandwich attacks, and other forms of transaction manipulation.

## Overview

The MEV Protection System routes all settlement transactions through private mempools to protect against:

- **Front-running**: Bots inserting transactions ahead of yours
- **Sandwich attacks**: Bots placing transactions before and after yours
- **Back-running**: Bots following your transaction to extract value
- **Transaction reordering**: Miners/validators manipulating transaction order

## Architecture

```
Settlement Request → MEVProtectedSettlementEngine → MEVProtectionService
                                                            ↓
                                                    Provider Selection
                                                            ↓
                                        ┌─────────────────────┴─────────────────────┐
                                        ↓                                           ↓
                                   Primary Provider                          Fallback Providers
                                   (e.g., Flashbots)                    (bloXroute, Eden, etc.)
                                        ↓                                           ↓
                                 Private Mempool                            Private Mempool
                                        ↓                                           ↓
                                   Block Builder                              Block Builder
                                        ↓                                           ↓
                                    On-chain                                   On-chain
```

## Supported Providers

### 1. Flashbots
- **Type**: Bundle auction system
- **Network**: Ethereum mainnet
- **Features**: Bundle simulation, priority ordering, revert protection
- **Configuration**:
  ```typescript
  flashbotsRelayUrl: 'https://relay.flashbots.net',
  flashbotsAuthSigner: wallet // Separate signing key
  ```

### 2. bloXroute
- **Type**: Global blockchain infrastructure
- **Network**: Multi-chain support
- **Features**: Ultra-low latency, multiple builder connections
- **Configuration**:
  ```typescript
  bloxrouteAuthHeader: 'Bearer YOUR_API_KEY'
  ```

### 3. Eden Network
- **Type**: Priority transaction network
- **Network**: Ethereum mainnet
- **Features**: Staker priority, MEV redistribution
- **Configuration**:
  ```typescript
  edenRpcUrl: 'https://api.edennetwork.io/v1/rpc'
  ```

### 4. mistX
- **Type**: User-first DEX aggregator
- **Network**: Ethereum mainnet
- **Features**: Built-in MEV protection, gasless swaps
- **Configuration**:
  ```typescript
  mistxApiKey: 'YOUR_API_KEY'
  ```

### 5. Secure RPC
- **Type**: Generic private mempool
- **Network**: Configurable
- **Features**: Basic private transaction submission
- **Configuration**:
  ```typescript
  secureRpcUrl: 'https://your-secure-rpc.com'
  ```

### 6. Standard (Fallback)
- **Type**: Public mempool
- **Network**: Any
- **Features**: Regular transaction submission (no MEV protection)
- **Usage**: Last resort when all other providers fail

## Configuration

### Basic Configuration
```typescript
const mevConfig: MEVProtectionConfig = {
  primaryProvider: MEVProtectionProvider.FLASHBOTS,
  fallbackProviders: [
    MEVProtectionProvider.BLOXROUTE,
    MEVProtectionProvider.EDEN,
    MEVProtectionProvider.STANDARD
  ],
  simulationEnabled: true,
  bundleTimeout: 120000, // 2 minutes
  retryAttempts: 3
};
```

### Advanced Configuration
```typescript
const settlementConfig: MEVProtectedSettlementConfig = {
  mevProtection: {
    // Provider configuration
    primaryProvider: MEVProtectionProvider.FLASHBOTS,
    fallbackProviders: [/* ... */],
    
    // Provider-specific settings
    flashbotsRelayUrl: 'https://relay.flashbots.net',
    flashbotsAuthSigner: authWallet,
    bloxrouteAuthHeader: process.env.BLOXROUTE_AUTH,
    
    // Transaction settings
    maxBlocksInFuture: 25,
    simulationEnabled: true,
    bundleTimeout: 120000,
    retryAttempts: 3,
    retryDelay: 1000
  },
  
  // Settlement settings
  settlementContractAddress: '0x...',
  epochDuration: 300000, // 5 minutes
  prioritizeLargeSettlements: true,
  simulateBeforeSending: true
};
```

## Usage

### Basic Usage
```typescript
import { MEVProtectedSettlementEngine } from './MEVProtectedSettlementEngine';

// Create MEV-protected settlement engine
const settlementEngine = new MEVProtectedSettlementEngine(
  provider,
  privateKey,
  config
);

// Add settlements (automatically protected)
settlementEngine.addSettlement({
  tradeId: 'trade-123',
  buyer: '0x...',
  seller: '0x...',
  buyerAmount: ethers.parseEther('100'),
  sellerAmount: ethers.parseEther('0.04'),
  buyerToken: '0x...',
  sellerToken: '0x...',
  timestamp: Date.now(),
  priority: 50
});
```

### Risk Assessment
```typescript
// Estimate MEV risk for a bundle
const risk = settlementEngine.estimateMEVRisk(bundle);
console.log('Risk Level:', risk.riskLevel); // LOW, MEDIUM, HIGH
console.log('Estimated MEV:', risk.estimatedMEV);
console.log('Vulnerabilities:', risk.vulnerabilities);
```

### Provider Health Check
```typescript
// Check provider health
const health = await settlementEngine.checkMEVProtectionHealth();
console.log('System healthy:', health.healthy);
console.log('Provider status:', health.providers);
```

## Monitoring

### Setup Monitoring
```typescript
import { MEVProtectionMonitor } from './MEVProtectionMonitor';

const monitor = new MEVProtectionMonitor(
  mevService,
  settlementEngine,
  {
    updateInterval: 60000, // 1 minute
    alertThresholds: {
      failureRateThreshold: 20, // 20%
      averageConfirmationTimeThreshold: 300000 // 5 minutes
    }
  }
);

await monitor.start();
```

### Monitoring API Endpoints

| Endpoint | Description | Response |
|----------|-------------|----------|
| `GET /api/mev/metrics` | Current metrics | MEVMetricsSnapshot |
| `GET /api/mev/metrics/history` | Historical metrics | MEVMetricsSnapshot[] |
| `GET /api/mev/providers` | Provider statuses | MEVProviderStatus[] |
| `GET /api/mev/alerts` | Active alerts | MEVAlert[] |
| `GET /api/mev/performance` | Provider performance | Performance summary |
| `GET /api/mev/health` | System health check | Health status |

### Metrics Tracked

1. **Transaction Metrics**
   - Total bundles submitted
   - Protected bundles confirmed
   - Failed protection attempts
   - Success rate percentage

2. **Performance Metrics**
   - Average confirmation time
   - Gas saved (in ETH)
   - Provider response times
   - Retry attempts

3. **Protection Metrics**
   - Front-runs avoided
   - Sandwich attacks prevented
   - MEV extracted (estimated)

## Events

### Settlement Engine Events
```typescript
// Bundle submitted with MEV protection
settlementEngine.on('mevProtection:submitted', (data) => {
  console.log('Transaction submitted:', data.txId, data.provider);
});

// Bundle confirmed on-chain
settlementEngine.on('mevProtection:confirmed', (data) => {
  console.log('Transaction confirmed:', data.txHash);
});

// Bundle failed
settlementEngine.on('mevProtection:failed', (data) => {
  console.log('Transaction failed:', data.error);
});
```

### Monitor Events
```typescript
// Alert created
monitor.on('alert:created', (alert) => {
  console.log('Alert:', alert.type, alert.message);
});

// Metrics collected
monitor.on('metrics:collected', (metrics) => {
  console.log('Success rate:', metrics.successRate);
});
```

## Alert Types

| Alert Type | Severity | Description | Trigger |
|------------|----------|-------------|---------|
| `PROVIDER_DOWN` | WARNING | MEV provider not responding | Health check failure |
| `HIGH_FAILURE_RATE` | CRITICAL | Too many failed transactions | > 20% failure rate |
| `SLOW_CONFIRMATION` | WARNING | Transactions taking too long | > 5 min avg confirmation |
| `NO_HEALTHY_PROVIDERS` | CRITICAL | All providers are down | No available providers |

## Best Practices

### 1. Provider Configuration
- Always configure multiple fallback providers
- Use provider-specific features when available
- Monitor provider health regularly
- Rotate auth keys periodically

### 2. Transaction Optimization
- Bundle related transactions together
- Set appropriate gas prices
- Use simulation before submission
- Implement retry logic with backoff

### 3. Risk Management
- Assess MEV risk before submission
- Prioritize high-value transactions
- Monitor for suspicious patterns
- Set appropriate timeouts

### 4. Monitoring
- Set up alerts for critical metrics
- Track gas savings to measure effectiveness
- Monitor provider performance
- Review failed transactions

## Troubleshooting

### Common Issues

1. **"No healthy providers available"**
   - Check provider configurations
   - Verify API keys and endpoints
   - Check network connectivity

2. **"Transaction simulation failed"**
   - Verify contract addresses
   - Check account balances
   - Review gas estimates

3. **"Bundle timeout"**
   - Increase timeout settings
   - Check network congestion
   - Try different providers

4. **High failure rate**
   - Review transaction parameters
   - Check provider status
   - Adjust retry settings

### Debug Mode
```typescript
// Enable debug logging
const mevService = new MEVProtectionService(provider, wallet, {
  ...config,
  debug: true
});

// Log all events
mevService.on('*', (eventName, data) => {
  console.log(`[MEV] ${eventName}:`, data);
});
```

## Security Considerations

1. **Private Key Management**
   - Never expose settlement private keys
   - Use separate auth signers for Flashbots
   - Rotate keys regularly

2. **API Key Security**
   - Store API keys in environment variables
   - Use key rotation policies
   - Monitor for unauthorized usage

3. **Transaction Privacy**
   - Transactions are hidden until included in blocks
   - Some metadata may be visible to providers
   - Consider transaction timing

4. **Provider Trust**
   - Providers can see transaction contents
   - Choose reputable providers
   - Distribute risk across multiple providers

## Performance Optimization

### 1. Batch Settlements
```typescript
// Group multiple trades into one bundle
const bundle = settlementEngine.createBundle([trade1, trade2, trade3]);
await settlementEngine.executeBundle(bundle);
```

### 2. Priority Settings
```typescript
// High-priority settlement
settlementEngine.addSettlement({
  ...settlementData,
  priority: 90, // 0-100 scale
  metadata: { urgency: 'HIGH' }
});
```

### 3. Gas Optimization
```typescript
// Configure gas settings
const config = {
  simulateBeforeSending: true,
  gasBufferPercentage: 10,
  maxGasPrice: ethers.parseUnits('100', 'gwei')
};
```

## Integration Examples

### With Trading System
```typescript
// Connect to matching engine
matchingEngine.on('trade', async (trade) => {
  // Automatically protect settlement
  await settlementEngine.addSettlement({
    tradeId: trade.id,
    buyer: trade.buyer,
    seller: trade.seller,
    // ... other trade data
  });
});
```

### With Risk Management
```typescript
// Check risk before settlement
const risk = settlementEngine.estimateMEVRisk(bundle);
if (risk.riskLevel === 'HIGH') {
  // Use premium protection
  bundle.metadata = { urgency: 'HIGH' };
}
```

## Appendix: Provider Comparison

| Provider | Speed | Cost | Reliability | Features |
|----------|-------|------|-------------|----------|
| Flashbots | Fast | Free | High | Bundle auction, simulation |
| bloXroute | Fastest | Paid | Very High | Multi-region, low latency |
| Eden | Fast | Free* | High | Staker priority |
| mistX | Medium | Free | Medium | Built-in DEX aggregation |
| Secure RPC | Variable | Variable | Variable | Customizable |

*Eden requires staking for priority

## References

- [Flashbots Documentation](https://docs.flashbots.net/)
- [bloXroute Documentation](https://docs.bloxroute.com/)
- [Eden Network Documentation](https://docs.edennetwork.io/)
- [MEV Protection Best Practices](https://writings.flashbots.net/)