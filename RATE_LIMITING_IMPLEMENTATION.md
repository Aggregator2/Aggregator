# Rate Limiting Implementation

## Overview

Rate limiting has been implemented across all API endpoints to protect against abuse and ensure fair usage. The implementation uses `express-rate-limit` with optional Redis backing for distributed rate limiting.

## Configuration

### Rate Limit Tiers

1. **Public Endpoints** (100 requests/minute)
   - Health checks
   - Token information
   - Market data
   - Quote endpoints

2. **Authenticated Endpoints** (1000 requests/minute)
   - User-specific data
   - Order history
   - Account information
   - Notifications

3. **Trading Endpoints** (10 requests/second)
   - Order submission
   - Order cancellation
   - Trade execution
   - RFQ operations

4. **Strict Endpoints** (10 requests/5 minutes)
   - Authentication (login/register)
   - Market maker applications
   - Settlement claims
   - Fund releases

5. **WebSocket Endpoints** (100 connections/minute)
   - Real-time order streams
   - WebSocket connections

## Implementation Details

### Files Created/Modified

1. **`/src/middleware/rateLimiter.ts`** - Core rate limiting middleware
2. **`/src/middleware/applyRateLimiting.ts`** - Endpoint configuration and application
3. **`/middleware.ts`** - Next.js middleware for API routes
4. **`/src/server.ts`** - Express server integration

### Redis Support

When Redis is available (via `REDIS_URL` environment variable), rate limits are stored in Redis for distributed rate limiting across multiple server instances. If Redis is unavailable, the system falls back to in-memory storage.

### Headers

All rate-limited responses include the following headers:
- `X-RateLimit-Limit` - Maximum requests allowed
- `X-RateLimit-Remaining` - Remaining requests in current window
- `X-RateLimit-Reset` - Timestamp when the limit resets
- `Retry-After` - Seconds until retry (only on 429 responses)

## Usage Examples

### Next.js API Routes

```typescript
import { withRateLimiting } from '@/src/middleware/applyRateLimiting';

// Apply rate limiting to your handler
export default withRateLimiting(handler, 'trading');
```

### Express Routes

Rate limiting is automatically applied based on endpoint patterns. No additional configuration needed.

### Manual Application

```typescript
import { tradingRateLimiter } from '@/src/middleware/rateLimiter';

// In your route handler
router.post('/api/custom-endpoint', tradingRateLimiter, (req, res) => {
  // Your logic here
});
```

## Testing

Run the rate limiting tests:

```bash
node scripts/test-rate-limiting.js
```

## Environment Variables

- `REDIS_URL` - Redis connection URL for distributed rate limiting (optional)
- `NODE_ENV` - Set to 'production' for production optimizations

## Error Responses

When rate limit is exceeded:

```json
{
  "error": "Too many requests",
  "message": "Rate limit exceeded. Please try again later.",
  "retryAfter": 30
}
```

Status code: 429 (Too Many Requests)

## Best Practices

1. **Client Implementation**
   - Respect `Retry-After` headers
   - Implement exponential backoff
   - Cache responses when appropriate

2. **Authentication**
   - Authenticated users get higher limits
   - Rate limits are per-user when authenticated

3. **Monitoring**
   - Monitor 429 responses
   - Adjust limits based on usage patterns
   - Set up alerts for abuse patterns

## Troubleshooting

1. **Rate limits not working**: Ensure middleware is applied before route handlers
2. **Redis connection issues**: Check `REDIS_URL` and Redis server status
3. **Inconsistent limits**: Verify Redis is being used for distributed systems

## Future Enhancements

1. Dynamic rate limits based on user tiers
2. IP-based allowlisting for trusted sources
3. Burst allowances for temporary spikes
4. Rate limit metrics and dashboards