# Rate Limiting and DDoS Protection Guide

## Overview

This guide explains the comprehensive rate limiting and DDoS protection mechanisms implemented in the middleware layer. The system provides multiple layers of protection against various attack vectors while maintaining good performance for legitimate users.

## Features

### 1. **Multi-tiered Rate Limiting**

Different rate limits for different types of endpoints:

- **Public Endpoints**: 100 requests per minute
- **Authenticated Endpoints**: 1000 requests per minute
- **Trading Endpoints**: 10 requests per second
- **Sensitive Operations**: 10 requests per 5 minutes
- **WebSocket Connections**: 100 connections per minute per IP

### 2. **DDoS Protection Mechanisms**

- **Per-IP rate limiting**: Prevents single IP from overwhelming the service
- **Pattern detection**: Identifies and blocks suspicious request patterns
- **Tarpit delays**: Slows down suspicious requests
- **IP blocking**: Automatic blocking of malicious IPs
- **Circuit breaker**: Protects downstream services from cascading failures

### 3. **Graceful Degradation**

- **Redis fallback**: Automatically falls back to in-memory rate limiting if Redis is unavailable
- **Service degradation**: Returns cached or fallback responses when services are overloaded
- **Health-based routing**: Routes traffic away from unhealthy instances

### 4. **Rate Limit Headers**

All rate-limited endpoints include standard headers:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 99
X-RateLimit-Reset: 2024-01-01T00:01:00.000Z
Retry-After: 60
```

## Implementation

### Basic Rate Limiting

```typescript
import { publicRateLimiter, authenticatedRateLimiter } from './middleware/rateLimiter';

// Public endpoint
app.get('/api/public/data', publicRateLimiter, (req, res) => {
  res.json({ data: 'public data' });
});

// Authenticated endpoint
app.get('/api/user/profile', 
  authenticatedRateLimiter,
  requireAuth,
  (req, res) => {
    res.json({ user: req.user });
  }
);
```

### Advanced DDoS Protection

```typescript
import { withAdvancedDDoSProtection, rateLimitPresets } from './middleware/enhancedAuth';

// Use preset configurations
app.get('/api/public/search', 
  ...rateLimitPresets.publicApi,
  searchHandler
);

app.post('/api/trading/order',
  ...rateLimitPresets.tradingApi,
  placeOrderHandler
);
```

### Custom Rate Limiting

```typescript
import { withRateLimit } from './middleware/enhancedAuth';

// Custom rate limit configuration
app.post('/api/custom/endpoint',
  withRateLimit('sensitive', (req) => {
    // Custom key generator
    return `${req.user?.id || req.ip}:${req.body.resource}`;
  }),
  customHandler
);
```

### WebSocket Rate Limiting

```typescript
import { RateLimiter } from './services/websocket/RateLimiter';

const wsRateLimiter = new RateLimiter({
  maxSubscriptionsPerConnection: 10,
  maxConnectionsPerApiKey: 5,
  messageThrottling: {
    windowMs: 60000,
    maxMessages: 1000,
    highFrequencyChannels: ['orderbook', 'trades'],
    throttleDelay: 100
  }
});

// Check before accepting connection
wss.on('connection', (ws, req) => {
  const apiKey = extractApiKey(req);
  const ip = req.socket.remoteAddress;
  
  const { allowed, reason } = wsRateLimiter.canConnect(apiKey, ip);
  if (!allowed) {
    ws.close(1008, reason);
    return;
  }
  
  wsRateLimiter.registerConnection(ws.id, apiKey, ip);
});
```

## Attack Scenarios and Protection

### 1. **Brute Force Attacks**

Protection against credential stuffing and brute force:

```typescript
app.post('/api/auth/login',
  ...rateLimitPresets.loginEndpoint,
  async (req, res) => {
    // Login logic
  }
);
```

- Limits login attempts to 5 per 15 minutes per email/IP
- Implements exponential backoff for repeated failures
- Tracks patterns across multiple IPs

### 2. **Distributed Denial of Service (DDoS)**

Multi-layered protection:

1. **Network Level**: CloudFlare or AWS Shield (external)
2. **Application Level**: 
   - Per-IP rate limiting (1000 req/sec)
   - Pattern detection
   - Automatic IP blocking
3. **Service Level**: Circuit breakers prevent cascade failures

### 3. **Application Layer Attacks**

Protection against:
- **Slowloris**: Connection timeouts and limits
- **HTTP Flood**: Request rate limiting
- **Resource Exhaustion**: Request size limits and timeouts

## Configuration

### Environment Variables

```env
# Redis connection for distributed rate limiting
REDIS_URL=redis://localhost:6379

# Rate limit configurations
RATE_LIMIT_PUBLIC=100
RATE_LIMIT_AUTHENTICATED=1000
RATE_LIMIT_TRADING=10
RATE_LIMIT_WINDOW_MS=60000

# DDoS protection
DDOS_MAX_REQUESTS_PER_SECOND=1000
DDOS_BLOCK_DURATION=3600
DDOS_SUSPICIOUS_THRESHOLD=100
```

### Custom Configuration

```typescript
// config/rateLimits.ts
export const customRateLimits = {
  api: {
    v1: {
      public: { points: 100, duration: 60 },
      authenticated: { points: 1000, duration: 60 },
      premium: { points: 10000, duration: 60 }
    }
  },
  websocket: {
    connections: { max: 10000, perApiKey: 50, perIp: 10 },
    messages: { max: 1000, window: 60000 }
  }
};
```

## Monitoring and Alerts

### Metrics to Track

1. **Rate Limit Metrics**
   - Requests per endpoint
   - Rate limit violations
   - Unique IPs/Users hitting limits

2. **DDoS Metrics**
   - Suspicious IP count
   - Blocked IP count
   - Request patterns

3. **Performance Metrics**
   - Response times under load
   - Circuit breaker states
   - Service availability

### Example Monitoring Setup

```typescript
import { EventEmitter } from 'events';

class RateLimitMonitor extends EventEmitter {
  private metrics = {
    rateLimitHits: new Map<string, number>(),
    blockedIps: new Set<string>(),
    suspiciousPatterns: new Map<string, number>()
  };

  logRateLimitHit(endpoint: string, userId: string) {
    const key = `${endpoint}:${userId}`;
    const count = (this.metrics.rateLimitHits.get(key) || 0) + 1;
    this.metrics.rateLimitHits.set(key, count);
    
    if (count > 10) {
      this.emit('highRateLimitViolations', { endpoint, userId, count });
    }
  }

  getMetrics() {
    return {
      totalRateLimitHits: Array.from(this.metrics.rateLimitHits.values())
        .reduce((sum, count) => sum + count, 0),
      uniqueViolators: this.metrics.rateLimitHits.size,
      blockedIps: this.metrics.blockedIps.size,
      suspiciousPatterns: this.metrics.suspiciousPatterns.size
    };
  }
}
```

## Best Practices

### 1. **Key Generation**

Use appropriate keys for rate limiting:

```typescript
// Good: User-specific for authenticated endpoints
const key = req.user?.id || req.apiKey?.id;

// Good: Resource-specific for public endpoints
const key = `${req.ip}:${req.params.resource}`;

// Bad: Too broad
const key = 'global';
```

### 2. **Error Handling**

Always provide clear error messages:

```typescript
app.use((err, req, res, next) => {
  if (err.status === 429) {
    return res.status(429).json({
      error: 'Too Many Requests',
      message: 'Rate limit exceeded. Please try again later.',
      retryAfter: err.retryAfter,
      limit: err.limit,
      remaining: 0,
      reset: err.reset
    });
  }
  next(err);
});
```

### 3. **Testing Rate Limits**

```typescript
// Test rate limiting
describe('Rate Limiting', () => {
  it('should enforce rate limits', async () => {
    const requests = Array(101).fill(null).map(() => 
      request(app).get('/api/public/data')
    );
    
    const responses = await Promise.all(requests);
    const rateLimited = responses.filter(r => r.status === 429);
    
    expect(rateLimited.length).toBeGreaterThan(0);
  });
});
```

### 4. **Gradual Rollout**

When implementing rate limiting:

1. Start with generous limits
2. Monitor actual usage patterns
3. Gradually tighten limits based on data
4. Implement alerts before hard blocks

## Troubleshooting

### Common Issues

1. **Redis Connection Failures**
   - System automatically falls back to memory
   - Check Redis connection string
   - Verify Redis server is running

2. **Legitimate Users Blocked**
   - Review rate limit thresholds
   - Check for shared IP addresses (corporate NAT)
   - Implement allowlisting for known good IPs

3. **Performance Impact**
   - Use Redis for distributed systems
   - Implement caching for rate limit checks
   - Use async middleware properly

### Debug Mode

Enable debug logging:

```typescript
if (process.env.RATE_LIMIT_DEBUG === 'true') {
  rateLimiter.on('consume', (key, points) => {
    console.log(`Rate limit consumed: ${key} - ${points} points`);
  });
  
  rateLimiter.on('block', (key, points) => {
    console.log(`Rate limit blocked: ${key} - attempted ${points} points`);
  });
}
```

## Security Considerations

1. **Don't Leak Information**: Rate limit errors should not reveal system internals
2. **Consistent Behavior**: Apply rate limits consistently across all endpoints
3. **Bypass for Health Checks**: Allow monitoring endpoints to bypass rate limits
4. **Secure Key Storage**: Store API keys and secrets securely
5. **Regular Reviews**: Periodically review and update rate limit configurations

## Further Reading

- [OWASP DDoS Protection](https://owasp.org/www-community/attacks/Denial_of_Service)
- [Rate Limiting Best Practices](https://cloud.google.com/architecture/rate-limiting-strategies-techniques)
- [Circuit Breaker Pattern](https://martinfowler.com/bliki/CircuitBreaker.html)
- [Redis Rate Limiting](https://redis.io/docs/manual/patterns/rate-limiting/)