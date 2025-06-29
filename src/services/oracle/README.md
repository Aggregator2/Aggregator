# Decentralized Off-Chain Oracle System

A robust, manipulation-resistant price oracle system that aggregates data from multiple centralized exchanges (CEXs) with advanced outlier detection, weighted averaging, and manipulation detection capabilities.

## Features

### Core Functionality
- **Multi-Exchange Aggregation**: Connects to multiple CEX APIs (Binance, Coinbase, Kraken)
- **Outlier Detection**: Statistical analysis using MAD (Median Absolute Deviation) and threshold-based filtering
- **Weighted Average Calculation**: Volume-weighted and reputation-weighted price aggregation
- **Price Feed Subscriptions**: Real-time price updates with configurable intervals
- **Oracle Reputation System**: Dynamic scoring based on accuracy and consistency
- **Manipulation Detection**: Identifies pump/dump schemes, wash trading, and spoofing
- **Failover Mechanisms**: Automatic reconnection and degraded mode operation
- **Data Validation**: Comprehensive validation of all incoming price data

### Architecture Components

1. **Exchange Connectors**: Modular connectors for each CEX with rate limiting
2. **Price Aggregator**: Weighted average calculation with outlier filtering
3. **Manipulation Detector**: Pattern recognition for various manipulation schemes
4. **Subscription Manager**: Event-driven price feed distribution
5. **Data Validator**: Input sanitization and validation
6. **Oracle Service**: Main orchestrator with health monitoring

## Usage

```typescript
import { OracleService, OracleConfig } from './oracle';

// Configure the oracle
const config: OracleConfig = {
  exchanges: [
    {
      name: 'Binance',
      apiUrl: 'https://api.binance.com',
      weight: 1.2,
      rateLimit: 20,
      timeout: 5000,
      enabled: true
    },
    {
      name: 'Coinbase',
      apiUrl: 'https://api.coinbase.com',
      weight: 1.0,
      rateLimit: 10,
      timeout: 5000,
      enabled: true
    }
  ],
  outlierThreshold: 0.05,  // 5% deviation threshold
  minSources: 2,           // Minimum required price sources
  maxPriceAge: 60000,      // 60 seconds
  volumeWeightEnabled: true,
  reputationEnabled: true
};

// Initialize and start the oracle
const oracle = new OracleService(config);

// Subscribe to manipulation alerts
oracle.on('manipulation-alert', (alert) => {
  console.warn('Manipulation detected:', alert);
});

// Start the oracle
await oracle.start();

// Subscribe to price feeds
const subscriptionId = oracle.subscribe(
  ['BTC/USDT', 'ETH/USDT'],
  (price) => {
    console.log(`${price.symbol}: $${price.price} (${price.confidence * 100}% confidence)`);
  },
  5000 // Update every 5 seconds
);

// Fetch price on-demand
const btcPrice = await oracle.fetchAggregatedPrice('BTC/USDT');

// Check system health
const health = await oracle.getHealth();

// Stop the oracle
await oracle.stop();
```

## API Reference

### OracleService

#### Methods

- `start()`: Initialize connections and start price updates
- `stop()`: Disconnect and clean up resources
- `fetchAggregatedPrice(symbol)`: Get aggregated price for a symbol
- `subscribe(symbols, callback, interval)`: Subscribe to price updates
- `unsubscribe(id)`: Remove a subscription
- `getHealth()`: Get health status of all connectors
- `getReputations()`: Get reputation scores for all exchanges

#### Events

- `oracle-started`: Oracle service has started
- `oracle-stopped`: Oracle service has stopped
- `manipulation-alert`: Price manipulation detected
- `price-update`: New aggregated price available
- `connector-failed`: Exchange connector failure
- `connector-recovered`: Exchange connector recovery
- `health-update`: Health status update

### Manipulation Detection

The system detects various manipulation patterns:

1. **Pump Schemes**: Sudden price increases with volume spikes
2. **Dump Schemes**: Rapid price drops indicating coordinated selling
3. **Wash Trading**: Artificial volume with minimal price movement
4. **Spoofing**: Single exchange showing significantly different prices

### Outlier Detection

Uses multiple statistical methods:
- Median Absolute Deviation (MAD) scoring
- Percentage deviation from median
- Historical price comparison
- Volume anomaly detection

### Reputation System

Exchanges earn reputation based on:
- Accuracy relative to aggregated price
- Consistency over time
- Number of accurate submissions
- Average deviation from consensus

## Configuration

### Exchange Configuration

```typescript
interface ExchangeConfig {
  name: string;           // Exchange identifier
  apiUrl: string;         // Base API URL
  apiKey?: string;        // Optional API key
  apiSecret?: string;     // Optional API secret
  weight: number;         // Base weight for averaging
  rateLimit: number;      // Requests per second
  timeout: number;        // Request timeout in ms
  enabled: boolean;       // Enable/disable exchange
}
```

### Oracle Configuration

```typescript
interface OracleConfig {
  exchanges: ExchangeConfig[];
  outlierThreshold: number;      // Max deviation (0.05 = 5%)
  minSources: number;            // Minimum required sources
  maxPriceAge: number;           // Max age for valid prices (ms)
  volumeWeightEnabled: boolean;  // Use volume for weighting
  reputationEnabled: boolean;    // Use reputation for weighting
}
```

## Error Handling

The oracle implements multiple layers of error handling:

1. **Connection Failures**: Automatic retry with exponential backoff
2. **Rate Limiting**: Built-in rate limiter for each exchange
3. **Data Validation**: Invalid data is filtered before aggregation
4. **Insufficient Sources**: Falls back to cached data when available
5. **Network Issues**: Timeout handling and circuit breaker pattern

## Security Considerations

1. **API Keys**: Store securely, never commit to version control
2. **Rate Limits**: Respect exchange limits to avoid IP bans
3. **Data Validation**: All external data is validated and sanitized
4. **Manipulation Detection**: Real-time alerts for suspicious activity
5. **Failover**: Continues operating with degraded functionality

## Testing

Run tests with:

```bash
npm test src/services/oracle/__tests__
```

## Future Enhancements

1. Add more exchange connectors (Bybit, OKX, etc.)
2. Implement WebSocket connections for real-time data
3. Add historical data storage and analysis
4. Enhance manipulation detection with ML models
5. Implement cross-exchange arbitrage detection
6. Add support for more complex financial instruments