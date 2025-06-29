# High-Performance Order Book Database

A production-ready order book database system designed for high-frequency trading with Redis for in-memory operations and PostgreSQL for persistent storage.

## Features

### Core Components

1. **Redis Order Book Store**
   - In-memory order matching with sub-millisecond latency
   - Real-time order book updates
   - Efficient price level aggregation
   - Atomic operations using Lua scripts
   - Pub/Sub for real-time notifications

2. **PostgreSQL History Store**
   - Persistent order and trade history
   - Time-series optimized schema with partitioning
   - Comprehensive indexing for fast queries
   - Support for complex historical analysis

3. **WebSocket Server**
   - Real-time order book streaming
   - Efficient update batching
   - Multiple subscription types (orderbook, trades, market data)
   - Connection management and authentication
   - Automatic reconnection handling

4. **Price Level Index**
   - O(1) price level lookups with LRU caching
   - Efficient cumulative volume calculations
   - Market impact analysis
   - Price discovery mechanisms

5. **Order Expiration Manager**
   - Automatic order expiration based on Time-in-Force
   - Configurable TTL per trading pair
   - Efficient expiration queue management
   - Bulk expiration support

6. **Replication Manager**
   - Multi-region Redis replication
   - Read replica load balancing
   - Automatic failover handling
   - Health monitoring and alerts

7. **Backup & Recovery**
   - Scheduled full and incremental backups
   - Local and S3 storage support
   - Compression and encryption
   - Point-in-time recovery

## Installation

```bash
npm install ioredis pg socket.io lru-cache @aws-sdk/client-s3
```

## Quick Start

```typescript
import { OrderBookDatabase, defaultConfig } from './orderBookDatabase';

// Initialize with default configuration
const database = new OrderBookDatabase(defaultConfig);
await database.initialize();

// Add an order
const order = {
  id: 'ORD-123',
  userId: 'USER-456',
  pair: 'ETH/USDC',
  side: 'BUY',
  type: 'LIMIT',
  price: 2000,
  quantity: 10,
  // ... other fields
};

await database.addOrder(order);

// Get order book snapshot
const snapshot = await database.getOrderBookSnapshot('ETH/USDC', 50);
console.log('Best bid:', snapshot.bids[0]);
console.log('Best ask:', snapshot.asks[0]);
```

## Configuration

```typescript
const config = {
  redis: {
    host: 'localhost',
    port: 6379,
    password: 'your-password',
    keyPrefix: 'orderbook:',
    // Retry strategy for connection failures
    retryStrategy: (times) => Math.min(times * 100, 3000)
  },
  
  postgres: {
    host: 'localhost',
    port: 5432,
    database: 'orderbook',
    user: 'postgres',
    password: 'postgres',
    poolSize: 20,
    ssl: true
  },
  
  websocket: {
    port: 8080,
    path: '/orderbook',
    pingInterval: 30000,
    maxConnections: 10000,
    cors: {
      origin: ['https://app.example.com'],
      credentials: true
    }
  },
  
  orderExpiration: {
    enabled: true,
    checkInterval: 60000, // 1 minute
    defaultTTL: 86400,    // 24 hours
    customTTL: {
      'ETH/USDC': 3600    // 1 hour
    }
  },
  
  replication: {
    enabled: true,
    replicas: {
      redis: ['redis://replica1:6379', 'redis://replica2:6379'],
      postgres: ['postgresql://replica1/orderbook', 'postgresql://replica2/orderbook']
    }
  },
  
  backup: {
    enabled: true,
    interval: 3600000,    // 1 hour
    retention: 30,        // 30 days
    s3: {
      bucket: 'orderbook-backups',
      region: 'us-east-1',
      accessKeyId: 'YOUR_KEY',
      secretAccessKey: 'YOUR_SECRET'
    }
  }
};
```

## WebSocket API

### Client Connection

```javascript
const socket = io('ws://localhost:8080', {
  path: '/orderbook',
  transports: ['websocket']
});

// Authenticate
socket.emit('authenticate', {
  userId: 'USER-123',
  token: 'auth-token'
});

// Subscribe to order book updates
socket.emit('subscribe:orderbook', {
  pair: 'ETH/USDC',
  depth: 50
});

// Handle updates
socket.on('orderbook:snapshot', (data) => {
  console.log('Snapshot:', data.snapshot);
});

socket.on('orderbook:updates', (data) => {
  console.log('Updates:', data.updates);
});
```

### Available Events

- `authenticate` - Authenticate the connection
- `subscribe:orderbook` - Subscribe to order book updates
- `subscribe:trades` - Subscribe to trade feed
- `subscribe:marketdata` - Subscribe to market data
- `unsubscribe:orderbook` - Unsubscribe from order book

## Performance Optimization

### Redis Optimization

1. **Lua Scripts**: Atomic operations for order matching
2. **Pipelining**: Batch operations to reduce round trips
3. **Key Expiration**: Automatic cleanup of stale data
4. **Memory Optimization**: Efficient data structures

### PostgreSQL Optimization

1. **Partitioning**: Monthly partitions for trades table
2. **Indexes**: Covering indexes for common queries
3. **Connection Pooling**: Reuse connections
4. **Batch Inserts**: Queue and batch write operations

### Network Optimization

1. **WebSocket Compression**: Enable per-message deflate
2. **Update Batching**: Buffer updates for 100ms
3. **Binary Protocol**: Use MessagePack for smaller payloads
4. **CDN Distribution**: Serve static assets via CDN

## Monitoring & Alerts

```typescript
// Get system statistics
const stats = await database.getStatistics();
console.log('Active orders:', stats.postgres.activeOrders);
console.log('24h volume:', stats.postgres.volume24h);

// Health check
const health = await database.healthCheck();
if (!health.overall) {
  console.error('System unhealthy:', health);
}

// Monitor expiration manager
expirationManager.on('order:expired', (event) => {
  console.log('Order expired:', event.orderId);
});

// Monitor replication
replicationManager.on('replica:status:updated', (status) => {
  if (!status.connected) {
    console.error('Replica disconnected:', status.name);
  }
});
```

## Backup & Recovery

### Manual Backup

```typescript
const backupManager = new BackupManager(database, config);
const metadata = await backupManager.performBackup('full');
console.log('Backup saved:', metadata.path);
```

### Restore from Backup

```typescript
await backupManager.restoreFromBackup('backup-2024-01-15-abc123');
```

## Security Considerations

1. **Authentication**: Implement proper WebSocket authentication
2. **Rate Limiting**: Prevent abuse with connection limits
3. **Encryption**: Use TLS for all connections
4. **Access Control**: Implement role-based permissions
5. **Audit Logging**: Track all critical operations

## Production Deployment

### Docker Compose Example

```yaml
version: '3.8'

services:
  redis-primary:
    image: redis:7-alpine
    command: redis-server --appendonly yes
    volumes:
      - redis-data:/data
    
  postgres-primary:
    image: postgres:15
    environment:
      POSTGRES_DB: orderbook
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: secure-password
    volumes:
      - postgres-data:/var/lib/postgresql/data
    
  orderbook-api:
    build: .
    environment:
      REDIS_HOST: redis-primary
      POSTGRES_HOST: postgres-primary
    ports:
      - "8080:8080"
    depends_on:
      - redis-primary
      - postgres-primary

volumes:
  redis-data:
  postgres-data:
```

### Kubernetes Deployment

See `k8s/` directory for Kubernetes manifests including:
- StatefulSets for Redis and PostgreSQL
- Deployment for WebSocket servers
- Services and Ingress configuration
- ConfigMaps and Secrets
- HorizontalPodAutoscaler for auto-scaling

## Troubleshooting

### Common Issues

1. **Connection Timeouts**
   - Check network connectivity
   - Verify firewall rules
   - Increase connection timeout

2. **Memory Issues**
   - Monitor Redis memory usage
   - Configure maxmemory policy
   - Enable key expiration

3. **Slow Queries**
   - Check PostgreSQL query plans
   - Add missing indexes
   - Optimize batch sizes

## License

MIT