# SwappiQ Redis Caching Strategy

## Overview

This comprehensive Redis caching system provides high-performance, scalable caching solutions for the SwappiQ Protocol. It includes specialized caching for order books, user sessions, rate limiting, wallet balances, real-time pub/sub messaging, and intelligent cache warming.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    SwappiQ Redis Cache System                  │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │ Order Book  │  │ Session     │  │ Rate        │            │
│  │ Cache       │  │ Manager     │  │ Limiter     │            │
│  └─────────────┘  └─────────────┘  └─────────────┘            │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │ Wallet      │  │ Pub/Sub     │  │ Cache       │            │
│  │ Balance     │  │ Manager     │  │ Warming     │            │
│  └─────────────┘  └─────────────┘  └─────────────┘            │
├─────────────────────────────────────────────────────────────────┤
│                    Redis Cluster/Instance                      │
└─────────────────────────────────────────────────────────────────┘
```

## Components

### 1. Order Book Cache (`OrderBookCache.js`)
- **Atomic Updates**: Lua scripts ensure order book consistency
- **Compression**: Large order books are automatically compressed
- **Snapshots**: Regular snapshots for data persistence
- **Real-time Updates**: Instant order book synchronization

### 2. Session Manager (`SessionManager.js`)
- **Sliding Expiration**: Sessions extend automatically with activity
- **Concurrent Session Control**: Limit simultaneous sessions per user
- **Security Features**: IP binding, device fingerprinting, security levels
- **Session Rotation**: Automatic session ID rotation for security

### 3. Rate Limiting Cache (`RateLimitingCache.js`)
- **Multiple Algorithms**: Sliding window, token bucket, leaky bucket
- **Distributed**: Works across multiple application instances
- **Adaptive**: Dynamic rate limit adjustments
- **Blacklist/Whitelist**: IP-based access control

### 4. Wallet Balance Cache (`WalletBalanceCache.js`)
- **Real-time Updates**: Blockchain event-driven balance updates
- **Staleness Detection**: Smart cache invalidation
- **Multi-chain Support**: Support for multiple blockchain networks
- **Batch Operations**: Efficient bulk balance updates

### 5. Pub/Sub Manager (`PubSubManager.js`)
- **Real-time Messaging**: Low-latency message delivery
- **Pattern Subscriptions**: Subscribe to message patterns
- **Message Validation**: Schema validation for message types
- **Rate Limiting**: Built-in message rate limiting

### 6. Cache Warming Manager (`CacheWarmingManager.js`)
- **Predictive Warming**: ML-based cache preloading
- **Scheduled Warming**: Cron-based cache warming
- **Usage-based**: Warm cache based on access patterns
- **Dependency-based**: Warm related cache keys

## Quick Start

```javascript
const { SwappiQRedisCache } = require('./lib/cache/RedisCache');

// Initialize the cache system
const cache = new SwappiQRedisCache({
    redis: {
        host: 'localhost',
        port: 6379,
        keyPrefix: 'swappiq:prod:'
    },
    strategies: {
        orderBook: {
            ttl: 300,
            atomicUpdates: true
        },
        userSessions: {
            ttl: 3600,
            maxConcurrentSessions: 5
        },
        walletBalances: {
            ttl: 30,
            refreshThreshold: 0.8
        }
    }
});

await cache.initialize();

// Get component managers
const orderBookCache = cache.getOrderBookCache();
const sessionManager = cache.getSessionManager();
const walletCache = cache.getWalletCache();
const rateLimiter = cache.getRateLimiter();
const pubSubManager = cache.getPubSubManager();
```

## Usage Examples

### Order Book Management

```javascript
// Update order book atomically
await orderBookCache.updateOrderBook('ETH-USDT', {
    bids: [[1800, 5], [1799, 10]],
    asks: [[1801, 3], [1802, 8]]
}, sequenceNumber);

// Add new order
await orderBookCache.addOrder('ETH-USDT', 'bid', 1795, 2.5, 'order123');

// Get order book with depth limit
const orderBook = await orderBookCache.getOrderBook('ETH-USDT', 10);

// Get top of book
const topOfBook = await orderBookCache.getTopOfBook('ETH-USDT');
```

### Session Management

```javascript
// Create user session
const session = await sessionManager.createSession(
    'user123',
    'Mozilla/5.0...',
    '192.168.1.100',
    { platform: 'web' }
);

// Validate session
const validation = await sessionManager.validateSession(
    session.sessionId,
    '192.168.1.100',
    'Mozilla/5.0...'
);

// Update session activity
await sessionManager.updateSessionActivity(session.sessionId, {
    page: '/trading',
    action: 'place_order'
});

// Get user's active sessions
const activeSessions = await sessionManager.getUserSessions('user123');
```

### Rate Limiting

```javascript
// Check rate limit
const rateLimit = await rateLimiter.checkRateLimit('user123', {
    algorithm: 'sliding_window_log',
    windowSize: 60,
    maxRequests: 100,
    userTier: 'premium',
    ipAddress: '192.168.1.100'
});

if (!rateLimit.allowed) {
    throw new Error(`Rate limit exceeded. Try again in ${rateLimit.resetTime}ms`);
}

// Add IP to blacklist
await rateLimiter.addToBlacklist('192.168.1.200', 'suspicious_activity', 3600);

// Set user tier limits
await rateLimiter.setUserTier('user123', 'premium', {
    maxRequests: 1000,
    windowSize: 60
});
```

### Wallet Balance Caching

```javascript
// Get wallet balance
const balance = await walletCache.getBalance(
    '0x742d35Cc6635C0532925a3b8D400e6fef7e6e26c',
    '0xA0b86a33E6441e9e6b7f9bf1e6a8e31cF5C3cD31', // Token address
    'ethereum',
    { includeUSDValue: true }
);

// Update balance (from blockchain event)
await walletCache.updateBalance(
    '0x742d35Cc6635C0532925a3b8D400e6fef7e6e26c',
    '0xA0b86a33E6441e9e6b7f9bf1e6a8e31cF5C3cD31',
    '1000000000000000000', // 1 token
    blockNumber,
    'ethereum'
);

// Get portfolio summary
const portfolio = await walletCache.getPortfolioSummary(
    '0x742d35Cc6635C0532925a3b8D400e6fef7e6e26c',
    'ethereum',
    true // include USD values
);
```

### Pub/Sub Messaging

```javascript
// Subscribe to order book updates
await pubSubManager.subscribe('orderbook:ETH-USDT', (channel, data, metadata) => {
    console.log('Order book updated:', data);
});

// Publish order book update
await pubSubManager.publishOrderBookUpdate('ETH-USDT', {
    tradingPair: 'ETH-USDT',
    bids: [[1800, 5]],
    asks: [[1801, 3]],
    sequence: 12345,
    timestamp: Date.now()
});

// Subscribe to user notifications
await pubSubManager.subscribe('notifications:user:123', (channel, data) => {
    console.log('User notification:', data);
});

// Send private notification
await pubSubManager.sendPrivateMessage('user123', {
    type: 'trade_executed',
    message: 'Your order has been executed',
    tradeId: 'trade123'
});
```

### Cache Warming

```javascript
const warmingManager = cache.getWarmingManager();

// Warm specific keys
await warmingManager.warmKeys([
    'orderbook:ETH-USDT',
    'orderbook:BTC-USDT',
    'price:ETH',
    'price:BTC'
]);

// Predictive warming
await warmingManager.predictiveWarmKeys({
    userId: 'user123',
    tradingPairs: ['ETH-USDT', 'BTC-USDT']
});

// Get warming recommendations
const recommendations = await warmingManager.getWarmingRecommendations(50);

// Start scheduled warming
await warmingManager.startScheduledWarming();
```

## Configuration

### Redis Configuration

```javascript
const config = {
    redis: {
        host: 'localhost',
        port: 6379,
        password: 'your_password',
        db: 0,
        keyPrefix: 'swappiq:',
        maxRetriesPerRequest: 3,
        retryDelayOnFailover: 100,
        lazyConnect: true
    },
    cluster: {
        enabled: true,
        nodes: [
            { host: 'redis1.example.com', port: 6379 },
            { host: 'redis2.example.com', port: 6379 },
            { host: 'redis3.example.com', port: 6379 }
        ]
    }
};
```

### Component Strategies

```javascript
const strategies = {
    orderBook: {
        ttl: 300, // 5 minutes
        maxSize: 10000,
        compressionThreshold: 1024,
        atomicUpdates: true,
        snapshotInterval: 60000 // 1 minute
    },
    userSessions: {
        ttl: 3600, // 1 hour
        slidingExpiration: true,
        maxConcurrentSessions: 5,
        securityMode: 'strict', // 'standard', 'strict', 'paranoid'
        ipBinding: true,
        deviceFingerprinting: true
    },
    rateLimiting: {
        windowSize: 60, // 1 minute
        maxRequests: 100,
        algorithm: 'sliding_window_log',
        adaptiveRateLimit: true,
        blacklistEnabled: true,
        whitelistEnabled: true
    },
    walletBalances: {
        ttl: 30, // 30 seconds
        refreshThreshold: 0.8,
        batchSize: 50,
        enableRealtimeUpdates: true,
        networkSpecific: true
    },
    cacheWarming: {
        enabled: true,
        schedules: [
            {
                name: 'morning_warmup',
                schedule: '0 7 * * *',
                strategy: 'usage_based',
                targets: ['orderBooks', 'prices']
            }
        ],
        adaptiveWarming: true,
        predictiveWarming: true
    }
};
```

## Performance Optimization

### Connection Pooling
- Automatic connection pooling for high throughput
- Configurable pool size and timeout settings
- Health checks and automatic reconnection

### Compression
- Automatic compression for large data objects
- Configurable compression thresholds
- LZ4 compression for optimal performance

### Batching
- Batch operations for improved throughput
- Pipeline support for multiple Redis commands
- Configurable batch sizes

### Memory Management
- LRU eviction policies
- Memory usage monitoring
- Automatic cache cleanup

## Monitoring and Metrics

### Built-in Statistics
```javascript
// Get overall cache statistics
const stats = cache.getStats();

// Get component-specific statistics
const orderBookStats = orderBookCache.getStats();
const sessionStats = sessionManager.getStats();
const rateLimitStats = rateLimiter.getStats();
```

### Health Checks
```javascript
// Overall system health
const health = await cache.healthCheck();

// Component health checks
const orderBookHealth = await orderBookCache.healthCheck();
const sessionHealth = await sessionManager.healthCheck();
```

### Events and Logging
```javascript
// Listen to cache events
cache.on('initialized', (info) => {
    console.log('Cache system initialized:', info);
});

cache.on('error', (error) => {
    console.error('Cache error:', error);
});

// Component-specific events
orderBookCache.on('orderBookUpdated', (data) => {
    console.log('Order book updated:', data);
});

pubSubManager.on('messagePublished', (info) => {
    console.log('Message published:', info);
});
```

## Security Features

### Encryption
- Optional data encryption at rest
- Key rotation support
- Configurable encryption algorithms

### Access Control
- IP-based blacklisting/whitelisting
- User tier-based rate limiting
- Session security validation

### Audit Logging
- Comprehensive audit trails
- Security event logging
- Compliance reporting

## Best Practices

1. **Use Appropriate TTLs**: Set TTLs based on data volatility
2. **Monitor Memory Usage**: Implement memory monitoring and alerts
3. **Use Compression**: Enable compression for large objects
4. **Implement Health Checks**: Regular health monitoring
5. **Use Batch Operations**: Batch multiple operations when possible
6. **Configure Security**: Enable appropriate security features
7. **Monitor Performance**: Track cache hit rates and response times

## Troubleshooting

### Common Issues

1. **High Memory Usage**
   - Check TTL settings
   - Enable compression
   - Monitor key patterns

2. **Low Cache Hit Rates**
   - Analyze access patterns
   - Adjust warming strategies
   - Review TTL settings

3. **Connection Issues**
   - Check Redis server status
   - Verify network connectivity
   - Review connection pool settings

4. **Performance Issues**
   - Enable pipelining
   - Use batch operations
   - Check Redis server performance

### Debug Mode
```javascript
const cache = new SwappiQRedisCache({
    // ... other config
    debug: true,
    logging: {
        level: 'debug',
        performance: true
    }
});
```

## Contributing

When contributing to the cache system:

1. Follow the existing code patterns
2. Add comprehensive tests
3. Update documentation
4. Consider performance implications
5. Test with real Redis instances
6. Add appropriate error handling

## License

This caching system is part of the SwappiQ Protocol and follows the project's licensing terms.