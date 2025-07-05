# Rate Limiting Guide for Next.js API Routes

This guide explains how to implement and use rate limiting in your Next.js API routes using Redis as the backing store.

## Overview

The rate limiting middleware provides:
- Redis-backed storage with automatic fallback to in-memory storage
- Different rate limit configurations for various endpoint types
- Per-user or per-IP rate limiting
- Proper HTTP headers and error responses
- Easy integration with Next.js API routes

## Installation

The required packages are already installed:
```bash
npm install express-rate-limit rate-limit-redis ioredis
```

## Basic Usage

### 1. Import the Rate Limiter

```typescript
import { withRateLimit, withSensitiveRateLimit } from '@/src/middleware/nextRateLimiter';
```

### 2. Apply to Your API Route

```typescript
// Simple usage with predefined configurations
export default withSensitiveRateLimit(async (req, res) => {
  // Your API logic here
});
```

## Predefined Rate Limit Configurations

| Configuration | Limit | Window | Use Case |
|--------------|-------|---------|----------|
| `general` | 100 requests | 15 minutes | General API endpoints |
| `sensitive` | 10 requests | 15 minutes | Order submission, sensitive operations |
| `trading` | 20 requests | 1 minute | Trading operations |
| `auth` | 5 requests | 15 minutes | Login, registration |
| `websocket` | 50 requests | 1 minute | WebSocket connections |
| `public` | 200 requests | 15 minutes | Public read endpoints |

## Examples

### General Endpoint
```typescript
import { withGeneralRateLimit } from '@/src/middleware/nextRateLimiter';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.json({ data: 'Your response' });
}

export default withGeneralRateLimit(handler);
```

### Sensitive Endpoint (e.g., submitOrder)
```typescript
import { withSensitiveRateLimit } from '@/src/middleware/nextRateLimiter';

async function submitOrder(req: NextApiRequest, res: NextApiResponse) {
  // Validate and process order
  const { userId, pair, quantity } = req.body;
  
  // Your order logic here
  res.json({ success: true, orderId: '12345' });
}

export default withSensitiveRateLimit(submitOrder);
```

### Custom Rate Limit Configuration
```typescript
import { withRateLimit, RateLimitConfig } from '@/src/middleware/nextRateLimiter';

const customConfig: RateLimitConfig = {
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 25, // 25 requests
  keyPrefix: 'rl:api:special:',
  keyGenerator: (req) => {
    // Custom key based on API key
    return req.headers['x-api-key'] || req.ip;
  }
};

export default withRateLimit(handler, customConfig);
```

### Multiple Rate Limiters
```typescript
import { withMultipleRateLimits } from '@/src/middleware/nextRateLimiter';

// Apply both general and trading rate limits
export default withMultipleRateLimits(handler, ['general', 'trading']);
```

## Response Headers

The middleware automatically sets these headers:

- `X-RateLimit-Limit`: Maximum requests allowed
- `X-RateLimit-Remaining`: Requests remaining in current window
- `X-RateLimit-Reset`: Time when the rate limit resets (ISO 8601)
- `Retry-After`: Seconds until retry (only on 429 responses)

## Error Response

When rate limit is exceeded:
```json
{
  "success": false,
  "error": "Too Many Requests",
  "message": "Rate limit exceeded. Please try again later.",
  "retryAfter": 180
}
```

## Redis Configuration

Set these environment variables:
```bash
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_password  # Optional
REDIS_DB=0                     # Optional
```

## Testing Rate Limits

### Run All Tests
```bash
node test-rate-limiting.js
```

### Test Specific Endpoints
```bash
node test-rate-limiting.js general   # Test general endpoint
node test-rate-limiting.js sensitive # Test sensitive endpoint
node test-rate-limiting.js custom    # Test custom endpoint
node test-rate-limiting.js clients   # Test different clients
```

### Manual Testing with cURL
```bash
# Test general endpoint
for i in {1..5}; do
  curl -X GET http://localhost:3000/api/examples/rate-limited-general \
    -H "X-Test: Request-$i" \
    -w "\nStatus: %{http_code}\n"
  sleep 0.5
done

# Test sensitive endpoint
for i in {1..12}; do
  curl -X POST http://localhost:3000/api/examples/rate-limited-sensitive \
    -H "Content-Type: application/json" \
    -d '{"amount": 100, "pair": "ETH/USDC"}' \
    -w "\nStatus: %{http_code}\n"
  sleep 0.5
done
```

## Best Practices

1. **Choose Appropriate Limits**: Set limits based on your API's capacity and user needs
2. **Use User-Based Limiting**: When possible, rate limit by authenticated user ID rather than IP
3. **Monitor Redis Connection**: The middleware falls back to in-memory storage if Redis is unavailable
4. **Set Proper Key Prefixes**: Use descriptive prefixes to organize rate limit keys in Redis
5. **Handle 429 Responses**: Clients should respect the `Retry-After` header

## Debugging

Check Redis for rate limit keys:
```bash
redis-cli
> KEYS rl:*
> GET rl:general:user:123:1234567
> TTL rl:general:user:123:1234567
```

## Migration from Express

If migrating from Express middleware:
```typescript
// Old Express way
app.use('/api/orders', rateLimiter);

// New Next.js way
export default withRateLimit(handler, 'sensitive');
```

## Advanced Usage

### Custom Error Handler
```typescript
const config: RateLimitConfig = {
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyPrefix: 'rl:custom:',
  handler: (req, res) => {
    res.status(429).json({
      error: 'RATE_LIMIT_EXCEEDED',
      code: 'E_TOO_MANY_REQUESTS',
      retryAfter: res.getHeader('Retry-After')
    });
  }
};
```

### Skip Successful/Failed Requests
```typescript
const config: RateLimitConfig = {
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyPrefix: 'rl:orders:',
  skipSuccessfulRequests: true,  // Only count failed requests
  skipFailedRequests: false
};
```

## Monitoring

Monitor rate limiting effectiveness:
1. Track 429 response rates
2. Monitor Redis memory usage
3. Analyze rate limit headers in responses
4. Set up alerts for frequent rate limit violations