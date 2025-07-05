# API Authentication Implementation Guide

## Overview

This guide documents the authentication implementation for the 134 API endpoints in `/pages/api`. The system uses JWT-based authentication with role-based access control (RBAC).

## Authentication Levels

### 1. Public Endpoints (No Authentication)
- Health checks
- Market data (quotes, orderbooks, trades)
- Token information
- Public configuration

### 2. Authenticated Endpoints (Valid JWT Required)
- Order management (submit, cancel, history)
- User notifications
- Account data
- Analytics
- Personal trading operations

### 3. Admin Endpoints (Admin Role Required)
- System operations (seed data, test functions)
- Settlement administration
- Dispute resolution
- Market maker management

## Implementation

### Existing Auth Middleware

Located in `/src/middleware/auth.ts`:
- `requireAuth` - Basic JWT authentication
- `withApiKey` - API key authentication with permissions

### Enhanced Auth Wrapper

Located in `/src/middleware/authWrapper.ts`:
- `withAuth` - Flexible authentication with role/permission support
- `authenticatedEndpoint` - Convenience wrapper for authenticated endpoints
- `adminEndpoint` - Convenience wrapper for admin-only endpoints
- `secureEndpoints` - Multi-method endpoint security

## Usage Examples

### 1. Simple Authentication

```typescript
import { authenticatedEndpoint } from '@/src/middleware/authWrapper';

export default authenticatedEndpoint(async (req, res) => {
  const userId = req.user?.id;
  // Your protected logic here
});
```

### 2. Admin-Only Endpoint

```typescript
import { adminEndpoint } from '@/src/middleware/authWrapper';

export default adminEndpoint(async (req, res) => {
  // Only admins can access this
});
```

### 3. Different Auth per HTTP Method

```typescript
import { secureEndpoints, PermissionLevel } from '@/src/middleware/authWrapper';

export default secureEndpoints({
  GET: {
    handler: getHandler,
    auth: { level: PermissionLevel.PUBLIC }
  },
  POST: {
    handler: postHandler,
    auth: { level: PermissionLevel.AUTHENTICATED }
  },
  DELETE: {
    handler: deleteHandler,
    auth: { level: PermissionLevel.ADMIN }
  }
});
```

### 4. Custom Permissions

```typescript
import { withAuth } from '@/src/middleware/authWrapper';

export default withAuth(handler, {
  roles: ['market_maker', 'admin'],
  permissions: ['trading.execute']
});
```

## Scripts

### 1. Security Audit Script

```bash
node scripts/api-security-audit.js
```

Analyzes all endpoints and reports:
- Properly secured endpoints
- Endpoints missing authentication
- Security score
- Generates fix scripts

### 2. Batch Authentication Application

```bash
node scripts/apply-auth-batch.js
```

Automatically adds authentication to unsecured endpoints based on their category.

### 3. Authentication Testing

```bash
node scripts/test-authentication.js
```

Tests authentication on various endpoints:
- Verifies public endpoints work without auth
- Verifies protected endpoints require auth
- Tests different token types (valid, expired, invalid)
- Tests role-based access

## JWT Token Structure

```json
{
  "id": "user123",
  "email": "user@example.com",
  "role": "user|admin|market_maker",
  "permissions": ["trading.view", "trading.execute"],
  "iat": 1234567890,
  "exp": 1234567890
}
```

## Environment Variables

```env
JWT_SECRET=your-secret-key-here
JWT_EXPIRY=1h
```

## Testing Commands

### 1. Run Security Audit
```bash
npm run audit:security
# or
node scripts/api-security-audit.js
```

### 2. Test Authentication
```bash
# Start the server first
npm run dev

# In another terminal
node scripts/test-authentication.js
```

### 3. Apply Auth to Endpoints
```bash
# Review which endpoints need auth
node scripts/api-security-audit.js

# Apply authentication
node scripts/apply-auth-batch.js
```

## Endpoint Categories

### Public (No Auth)
- `/api/health/*`
- `/api/tokens/*`
- `/api/supported-tokens`
- `/api/chains`
- `/api/quote/*`
- `/api/orderbook/*`
- `/api/trades/*`

### Authenticated
- `/api/submitOrder*`
- `/api/cancelOrder`
- `/api/orders/*`
- `/api/notifications/*`
- `/api/account/*`
- `/api/analytics/*`
- `/api/trading/*`
- `/api/rfq/*`

### Admin Only
- `/api/seedOrders`
- `/api/settlement/proof/claim`
- `/api/disputes/settle`
- `/api/market-maker/apply`
- `/api/test/*`

## Error Responses

### 401 Unauthorized
```json
{
  "error": "Unauthorized",
  "message": "Missing or invalid authorization header"
}
```

### 403 Forbidden
```json
{
  "error": "Forbidden",
  "message": "Admin access required"
}
```

### Token Expired
```json
{
  "error": "Unauthorized",
  "message": "Token expired"
}
```

## Best Practices

1. **Always use HTTPS** in production
2. **Rotate JWT secrets** regularly
3. **Set appropriate token expiry** (1h for users, 5m for sensitive operations)
4. **Validate permissions** at the endpoint level
5. **Log authentication failures** for security monitoring
6. **Use rate limiting** in conjunction with authentication
7. **Implement refresh tokens** for better UX

## Migration Guide

### From `requireAuth` to `authWrapper`

Before:
```typescript
import { requireAuth } from '@/src/middleware/auth';
export default requireAuth(handler);
```

After:
```typescript
import { authenticatedEndpoint } from '@/src/middleware/authWrapper';
export default authenticatedEndpoint(handler);
```

Benefits:
- Better error messages
- Role-based access control
- Permission checking
- Consistent response format

## Security Checklist

- [ ] Run security audit script
- [ ] Apply authentication to all sensitive endpoints
- [ ] Test authentication on all endpoints
- [ ] Configure JWT secret in production
- [ ] Enable HTTPS in production
- [ ] Set up monitoring for auth failures
- [ ] Review and update endpoint categories regularly
- [ ] Implement token refresh mechanism
- [ ] Add rate limiting to auth endpoints
- [ ] Document API authentication in public docs