# WebSocket Authentication

## Overview

The WebSocket server now requires JWT authentication for all connections. Clients must provide a valid JWT token during the handshake to establish a connection.

## Authentication Process

1. **Token Required**: All WebSocket connections must include a JWT token
2. **Token Validation**: The server validates the JWT token using the `JWT_SECRET` environment variable
3. **User Context**: Authenticated user information is stored in `socket.data.user`
4. **Automatic User Room**: Users are automatically joined to their user-specific room for targeted messages

## Client Connection

### Using Socket.IO Client

```javascript
import { io } from 'socket.io-client';

// Option 1: Token in auth object (recommended)
const socket = io('http://localhost:3001', {
  auth: {
    token: 'your-jwt-token'
  }
});

// Option 2: Token in headers
const socket = io('http://localhost:3001', {
  extraHeaders: {
    Authorization: 'Bearer your-jwt-token'
  }
});
```

### Handling Authentication

```javascript
socket.on('connect', () => {
  console.log('Connected to WebSocket server');
});

socket.on('auth:success', (data) => {
  console.log('Authentication successful:', data);
  // data contains: { userId, user }
});

socket.on('connect_error', (error) => {
  console.error('Connection failed:', error.message);
  // Common errors:
  // - "Unauthorized: No token provided"
  // - "Unauthorized: Invalid token"
  // - "Server configuration error" (JWT_SECRET not set)
});
```

## Server Configuration

### Environment Variables

```bash
JWT_SECRET=your-secret-key  # Required for JWT validation
WS_PORT=3001               # WebSocket server port (default: 3001)
FRONTEND_URL=http://localhost:3000  # CORS origin
```

### JWT Payload

The server expects the JWT payload to contain a user identifier in one of these fields:
- `userId`
- `sub` (standard JWT subject claim)
- `id`

Example JWT payload:
```json
{
  "userId": "user123",
  "email": "user@example.com",
  "exp": 1234567890
}
```

## Security Benefits

1. **No Anonymous Connections**: All connections require valid authentication
2. **Token Expiration**: JWT tokens have built-in expiration
3. **User Isolation**: Users can only receive their own private messages
4. **Revocation**: Invalid tokens are immediately rejected

## Migration Notes

### Breaking Changes

1. The `auth` event is no longer needed - authentication happens during connection
2. Notification subscriptions no longer require passing userId
3. Connection will fail immediately if token is invalid or missing

### Before (Old Implementation)
```javascript
socket.on('connect', () => {
  socket.emit('auth', { userId: 'user123' });
});

socket.on('auth:success', () => {
  socket.emit('subscribe:notifications', { userId: 'user123' });
});
```

### After (New Implementation)
```javascript
// Authentication happens during connection
const socket = io(url, {
  auth: { token: jwtToken }
});

socket.on('auth:success', (data) => {
  // Already authenticated with userId from token
  socket.emit('subscribe:notifications'); // No userId needed
});
```

## Error Handling

The server will reject connections with specific error messages:
- `Unauthorized: No token provided` - Token missing from handshake
- `Unauthorized: Invalid token` - JWT validation failed
- `Server configuration error` - JWT_SECRET not configured

## Testing

See `src/websocket/client-example.ts` for a complete example implementation.