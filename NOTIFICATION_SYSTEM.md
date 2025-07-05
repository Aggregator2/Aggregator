# Notification System Documentation

## Overview

The notification system provides a comprehensive solution for delivering real-time and asynchronous notifications to users through multiple channels including WebSocket, Email, Webhooks, and SMS. It features user preference management, exponential backoff for failed deliveries, and a React-based notification center UI.

## Architecture

### Core Components

1. **NotificationService** (`/src/services/notifications/NotificationService.ts`)
   - Main orchestrator for creating and managing notifications
   - Singleton pattern for centralized notification management
   - Handles user preferences and channel determination

2. **NotificationQueue** (`/src/services/notifications/NotificationQueue.ts`)
   - Redis-based queue system using Bull for reliable delivery
   - Implements exponential backoff with jitter
   - Separate queues for each delivery channel

3. **WebhookDeliveryService** (`/src/services/notifications/WebhookDeliveryService.ts`)
   - HMAC-SHA256 signature generation
   - Automatic retry with exponential backoff
   - Webhook testing functionality

4. **NotificationWebSocketHandlers** (`/src/services/websocket/NotificationWebSocketHandlers.ts`)
   - Real-time notification delivery
   - Order status change listeners
   - Trade execution notifications

5. **React Components**
   - `NotificationCenter` - Bell icon with unread badge and dropdown
   - `NotificationPreferences` - User preference management UI

### Database Schema

```sql
-- Main tables:
notifications
├── id (UUID, Primary Key)
├── userId (String)
├── type (ENUM: order, trade, settlement, etc.)
├── event (String: order_filled, trade_executed, etc.)
├── title (String)
├── message (Text)
├── data (JSONB)
├── read (Boolean)
├── archived (Boolean)
├── channels (JSONB)
├── deliveryStatus (JSONB)
├── priority (ENUM: low, medium, high, urgent)
├── createdAt (Timestamp)
└── expiresAt (Timestamp, nullable)

notification_preferences
├── id (UUID, Primary Key)
├── userId (String)
├── channel (ENUM: email, webhook, websocket, sms)
├── enabled (Boolean)
├── emailAddress (String, nullable)
├── webhookUrl (Text, nullable)
├── webhookSecret (String, nullable)
├── phoneNumber (String, nullable)
├── event subscriptions (Boolean fields)
├── batchNotifications (Boolean)
├── quietHoursEnabled (Boolean)
└── timezone (String)

webhook_deliveries
├── id (UUID, Primary Key)
├── notificationId (UUID, Foreign Key)
├── webhookUrl (Text)
├── attemptNumber (Integer)
├── status (ENUM: pending, success, failed, abandoned)
├── statusCode (Integer, nullable)
├── errorMessage (Text, nullable)
├── scheduledAt (Timestamp)
└── attemptedAt (Timestamp, nullable)
```

## Features

### 1. Read/Unread Status Management

#### Database Storage
- **read** (Boolean): Tracks whether notification has been read
- **readAt** (Timestamp): Records when notification was marked as read
- Indexed on (userId, read) for efficient querying
- Supports marking individual or all notifications as read

#### Real-time Updates
When a notification's read status changes:
1. Database is updated with read=true and readAt timestamp
2. `notification:updated` event is emitted
3. `notification:read` event is emitted with notification data
4. WebSocket sends real-time update to connected clients
5. Unread count is automatically recalculated and sent

#### API Endpoints
- `PUT /api/notifications/{id}/read` - Mark single notification as read
- `PUT /api/notifications/read-all` - Mark all notifications as read
- `PUT /api/notifications/batch-read` - Mark multiple notifications as read

#### TypeScript Types
```typescript
interface Notification {
  id: string;
  userId: string;
  // ... other fields
  read: boolean;
  readAt?: Date;
  archived: boolean;
}
```

### 2. Multi-Channel Delivery

#### WebSocket (Real-time)
- Instant delivery to connected clients
- No queueing required
- Automatic reconnection handling

#### Email
- Batching support for reducing email volume
- Template-based formatting
- Quiet hours respect

#### Webhooks
- HTTP POST with JSON payload
- HMAC-SHA256 signatures for security
- Custom headers support
- Configurable timeout (30 seconds)

#### SMS
- Limited to critical notifications
- Phone number verification required
- Character limit considerations

### 2. User Preferences

```typescript
interface NotificationPreferences {
  // Channel configuration
  channel: NotificationChannel;
  enabled: boolean;
  
  // Event subscriptions
  orderCreated: boolean;
  orderFilled: boolean;
  orderPartiallyFilled: boolean;
  orderCancelled: boolean;
  orderRejected: boolean;
  tradeExecuted: boolean;
  settlementCompleted: boolean;
  
  // Delivery preferences
  batchNotifications: boolean;
  batchIntervalMinutes: number;
  quietHoursEnabled: boolean;
  quietHoursStart?: string;
  quietHoursEnd?: string;
  timezone: string;
}
```

### 3. Reliability Features

#### Exponential Backoff
```typescript
// Retry delays: 1s, 2s, 4s, 8s, 16s, 32s, 1m, 2m, 4m, 8m, 16m, 32m, 1h, 2h...
const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
const jitter = delay * 0.1 * (Math.random() * 2 - 1);
return Math.floor(delay + jitter);
```

#### Queue Management
- Separate queues per channel
- Dead letter queue for failed messages
- Queue statistics and monitoring

### 4. Real-time Updates

Integration with order and trade events:
```typescript
// Order status changes
matchingEngine.on('orderFilled', (order) => {
  notificationHandlers.handleOrderStatusChange({
    order,
    previousStatus: OrderStatus.OPEN,
    newStatus: OrderStatus.FILLED,
    userId: order.userId
  });
});
```

## API Reference

### REST Endpoints

#### Get Notifications
```http
GET /api/notifications?userId={userId}&limit=20&offset=0
```

Response:
```json
{
  "notifications": [
    {
      "id": "notif_123",
      "type": "order",
      "event": "order_filled",
      "title": "Order Filled",
      "message": "Your buy order for 1 BTC has been filled",
      "data": { "orderId": "order_456", "price": "45000" },
      "read": false,
      "createdAt": "2024-01-20T10:30:00Z"
    }
  ],
  "total": 50,
  "unreadCount": 5
}
```

#### Mark as Read
```http
PUT /api/notifications/{notificationId}/read
Body: { "userId": "user123" }
```

#### Update Preferences
```http
PUT /api/notifications/preferences
Body: {
  "userId": "user123",
  "channel": "webhook",
  "webhookUrl": "https://api.example.com/webhook",
  "orderFilled": true,
  "orderCancelled": false
}
```

### WebSocket Events

#### Client → Server
```javascript
// Subscribe to notifications
socket.emit('subscribe:notifications', { userId: 'user123' });

// Unsubscribe
socket.emit('unsubscribe:notifications', { userId: 'user123' });
```

#### Server → Client
```javascript
// New notification
{
  type: 'notification:new',
  notification: { ... },
  timestamp: '2024-01-20T10:30:00Z'
}

// Notification updated
{
  type: 'notification:update',
  notification: { ... },
  timestamp: '2024-01-20T10:30:00Z'
}
```

## Usage Examples

### Backend Integration

```typescript
import { notificationService } from './src/services/notifications/NotificationService';

// Create notification on order fill
await notificationService.createNotification({
  userId: 'user123',
  type: NotificationType.ORDER,
  event: NotificationEvent.ORDER_FILLED,
  title: 'Order Filled',
  message: 'Your buy order for 1 BTC at $45,000 has been filled',
  data: {
    orderId: 'order_456',
    symbol: 'BTC/USD',
    quantity: '1',
    price: '45000',
    side: 'buy'
  },
  priority: NotificationPriority.HIGH
});
```

### React Integration

```tsx
import { NotificationCenter } from './components/NotificationCenter';
import { NotificationPreferences } from './components/NotificationPreferences';

// App header
function AppHeader({ userId }) {
  return (
    <header className="app-header">
      <Logo />
      <Navigation />
      <NotificationCenter userId={userId} />
      <UserMenu />
    </header>
  );
}

// Settings page
function SettingsPage({ userId }) {
  return (
    <div className="settings-page">
      <h1>Settings</h1>
      <NotificationPreferences userId={userId} />
    </div>
  );
}
```

### Webhook Implementation

```javascript
// Express webhook handler
app.post('/webhook/notifications', (req, res) => {
  const signature = req.headers['x-signature'];
  const payload = JSON.stringify(req.body);
  
  // Verify signature
  const expectedSignature = crypto
    .createHmac('sha256', process.env.WEBHOOK_SECRET)
    .update(payload)
    .digest('hex');
  
  if (signature !== expectedSignature) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  
  // Process notification
  const notification = req.body.notification;
  console.log(`Received ${notification.type} notification:`, notification);
  
  // Handle based on type
  switch (notification.type) {
    case 'order':
      handleOrderNotification(notification);
      break;
    case 'trade':
      handleTradeNotification(notification);
      break;
    case 'settlement':
      handleSettlementNotification(notification);
      break;
  }
  
  res.status(200).json({ received: true });
});
```

## Configuration

### Environment Variables

```bash
# Redis
REDIS_URL=redis://localhost:6379

# WebSocket
WS_PORT=3001
FRONTEND_URL=http://localhost:3000

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/trading

# Email (optional)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=notifications@example.com
SMTP_PASS=password

# SMS (optional)
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_FROM_NUMBER=+1234567890
```

### Redis Queue Configuration

```typescript
const queueOptions = {
  redis: {
    host: 'localhost',
    port: 6379,
  },
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
    removeOnComplete: true,
    removeOnFail: false,
  },
};
```

## Performance Optimization

### 1. Batching
Email notifications can be batched to reduce API calls:
```typescript
// Batch interval: 5 minutes
// Max batch size: 100 notifications
```

### 2. Caching
- User preferences cached for 5 minutes
- WebSocket connection state cached
- Recent notifications cached client-side

### 3. Database Optimization
- Indexed queries on userId, createdAt
- Composite index on (userId, read, createdAt)
- Automatic cleanup of expired notifications

## Security Considerations

### 1. Authentication
- WebSocket connections require valid auth token
- API endpoints validate user ownership
- Webhook URLs must be HTTPS in production

### 2. Rate Limiting
- Max 100 notifications per user per hour
- Max 10 webhook test requests per hour
- WebSocket message rate limiting

### 3. Input Validation
- All user inputs sanitized
- URL validation for webhooks
- Phone number format validation

### 4. Webhook Security
```typescript
// Signature generation
const signature = crypto
  .createHmac('sha256', webhook.secret)
  .update(JSON.stringify(payload))
  .digest('hex');

headers['X-Signature'] = signature;
headers['X-Notification-Id'] = notification.id;
headers['X-Timestamp'] = new Date().toISOString();
```

## Monitoring & Debugging

### Queue Statistics
```typescript
const stats = await notificationQueue.getQueueStats();
// {
//   notifications: { waiting: 10, active: 2, completed: 1000, failed: 5 },
//   webhooks: { waiting: 5, active: 1, completed: 500, failed: 2 },
//   emails: { waiting: 20, active: 0, completed: 200, failed: 0 }
// }
```

### WebSocket Monitoring
```typescript
const wsStats = notificationHandlers.getNotificationStats();
// {
//   connectedUsers: 150,
//   activeChannels: 150,
//   sentToday: 5000
// }
```

### Common Issues

1. **Notifications not delivering**
   - Check Redis connection
   - Verify user preferences enabled
   - Check webhook URL accessibility
   - Review queue error logs

2. **WebSocket disconnections**
   - Check auth token expiration
   - Verify WebSocket server running
   - Check for proxy timeouts

3. **Webhook failures**
   - Verify HTTPS requirement
   - Check response time (<30s)
   - Validate signature secret
   - Check for rate limiting

## Testing

### Unit Tests
```typescript
describe('NotificationService', () => {
  it('should create notification with correct channels', async () => {
    const notification = await notificationService.createNotification({
      userId: 'test_user',
      type: NotificationType.ORDER,
      event: NotificationEvent.ORDER_FILLED,
      title: 'Test',
      message: 'Test message'
    });
    
    expect(notification.channels).toContain(NotificationChannel.WEBSOCKET);
  });
});
```

### Integration Tests
```typescript
describe('Webhook Delivery', () => {
  it('should retry failed webhook with backoff', async () => {
    // Mock failing webhook
    nock('https://api.example.com')
      .post('/webhook')
      .times(3)
      .reply(500);
    
    // Verify exponential backoff delays
    // 1s, 2s, 4s between retries
  });
});
```

## Future Enhancements

1. **Push Notifications** - Mobile app push notification support
2. **Rich Media** - Support for images and attachments
3. **Templates** - User-customizable notification templates
4. **Analytics** - Notification engagement tracking
5. **A/B Testing** - Message optimization
6. **Localization** - Multi-language support
7. **Aggregation** - Smart notification grouping
8. **Do Not Disturb** - Advanced scheduling options