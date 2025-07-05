// Example: How to apply rate limiting to existing endpoints

import { withSensitiveRateLimit, withTradingRateLimit, withAuthRateLimit } from './nextRateLimiter';

// Example 1: Apply to submitOrder endpoint
// In /pages/api/submitOrder.ts
/*
import { withSensitiveRateLimit } from '@/src/middleware/nextRateLimiter';

// Your existing handler
async function submitOrderHandler(req, res) {
  // ... existing logic
}

// Export with rate limiting
export default withSensitiveRateLimit(submitOrderHandler);
*/

// Example 2: Apply to multiple trading endpoints
// In /pages/api/trading/[...].ts
/*
import { withTradingRateLimit } from '@/src/middleware/nextRateLimiter';

export default withTradingRateLimit(async (req, res) => {
  // Trading logic
});
*/

// Example 3: Apply to auth endpoints
// In /pages/api/auth/login.ts
/*
import { withAuthRateLimit } from '@/src/middleware/nextRateLimiter';

export default withAuthRateLimit(async (req, res) => {
  // Auth logic
});
*/

// Example 4: Custom rate limiting for API keys
/*
import { withRateLimit, RateLimitConfig } from '@/src/middleware/nextRateLimiter';

const apiKeyRateLimit: RateLimitConfig = {
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute for API key holders
  keyPrefix: 'rl:apikey:',
  keyGenerator: (req) => {
    const apiKey = req.headers['x-api-key'];
    return apiKey ? `key:${apiKey}` : `ip:${req.ip}`;
  }
};

export default withRateLimit(handler, apiKeyRateLimit);
*/

// Export types for use in other files
export { RateLimitConfig } from './nextRateLimiter';