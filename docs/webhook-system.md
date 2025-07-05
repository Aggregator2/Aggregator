# Webhook System Documentation

## Overview

The webhook system provides asynchronous event notifications for various trading platform events. It supports HMAC-SHA256 signature validation, exponential backoff retry logic, and comprehensive monitoring.

## Features

- **6 Event Types**: order.created, order.filled, order.cancelled, trade.executed, settlement.completed, settlement.claimed
- **HMAC-SHA256 Signatures**: Secure webhook validation
- **Exponential Backoff Retry**: Automatic retry with configurable delays
- **Dead Letter Queue**: Failed webhooks are queued for manual intervention
- **IP Whitelisting**: Optional IP-based access control
- **Custom Headers**: Support for custom HTTP headers
- **Monitoring & Metrics**: Prometheus metrics and monitoring dashboard
- **Bulk Operations**: Efficient batch webhook delivery
- **Event Deduplication**: Prevents duplicate event delivery

## Quick Start

### 1. Create a Webhook

```bash
curl -X POST https://api.yourplatform.com/api/webhooks \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-server.com/webhook",
    "events": ["order.created", "order.filled"],
    "description": "Production webhook",
    "headers": {
      "X-Custom-Header": "value"
    },
    "retryConfig": {
      "maxRetries": 5,
      "initialDelay": 1000,
      "maxDelay": 3600000,
      "timeout": 30000
    }
  }'
```

### 2. Verify Webhook Signatures

```javascript
const crypto = require('crypto');

function verifyWebhookSignature(payload, signature, secret, timestamp) {
  const message = `${timestamp}.${payload}`;
  const expectedSignature = `sha256=${crypto
    .createHmac('sha256', secret)
    .update(message)
    .digest('hex')}`;
  
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

// Express middleware example
app.post('/webhook', (req, res) => {
  const signature = req.headers['x-webhook-signature'];
  const timestamp = req.headers['x-webhook-timestamp'];
  const eventId = req.headers['x-webhook-event-id'];
  
  // Verify signature
  const isValid = verifyWebhookSignature(
    JSON.stringify(req.body),
    signature,
    YOUR_WEBHOOK_SECRET,
    timestamp
  );
  
  if (!isValid) {
    return res.status(401).send('Invalid signature');
  }
  
  // Verify timestamp (prevent replay attacks)
  const currentTime = Math.floor(Date.now() / 1000);
  const timeDiff = Math.abs(currentTime - parseInt(timestamp));
  
  if (timeDiff > 300) { // 5 minutes tolerance
    return res.status(401).send('Timestamp too old');
  }
  
  // Process webhook
  console.log('Received webhook:', req.body);
  
  // Always respond quickly
  res.status(200).send('OK');
});
```

## Event Types

### order.created
Triggered when a new order is placed.

```json
{
  "id": "evt_1234567890",
  "type": "order.created",
  "timestamp": "2024-01-15T10:30:00Z",
  "data": {
    "orderId": "ord_abc123",
    "userId": "usr_xyz789",
    "pair": "ETH/USDC",
    "side": "BUY",
    "type": "LIMIT",
    "quantity": "1.5",
    "price": "2000",
    "status": "OPEN",
    "createdAt": "2024-01-15T10:30:00Z"
  },
  "signature": "sha256=...",
  "api_version": "2024-01-01"
}
```

### order.filled
Triggered when an order is partially or fully filled.

```json
{
  "id": "evt_1234567891",
  "type": "order.filled",
  "timestamp": "2024-01-15T10:31:00Z",
  "data": {
    "orderId": "ord_abc123",
    "userId": "usr_xyz789",
    "pair": "ETH/USDC",
    "side": "BUY",
    "filledQuantity": "1.5",
    "remainingQuantity": "0",
    "averagePrice": "1995",
    "totalValue": "2992.5",
    "fee": "2.99",
    "status": "FILLED",
    "filledAt": "2024-01-15T10:31:00Z"
  },
  "signature": "sha256=...",
  "api_version": "2024-01-01"
}
```

### order.cancelled
Triggered when an order is cancelled.

```json
{
  "id": "evt_1234567892",
  "type": "order.cancelled",
  "timestamp": "2024-01-15T10:32:00Z",
  "data": {
    "orderId": "ord_def456",
    "userId": "usr_xyz789",
    "pair": "ETH/USDC",
    "side": "SELL",
    "cancelledQuantity": "0.5",
    "reason": "User requested",
    "cancelledAt": "2024-01-15T10:32:00Z"
  },
  "signature": "sha256=...",
  "api_version": "2024-01-01"
}
```

### trade.executed
Triggered when a trade is executed.

```json
{
  "id": "evt_1234567893",
  "type": "trade.executed",
  "timestamp": "2024-01-15T10:31:00Z",
  "data": {
    "tradeId": "trd_ghi789",
    "orderId": "ord_abc123",
    "userId": "usr_xyz789",
    "counterpartyId": "usr_def456",
    "pair": "ETH/USDC",
    "side": "BUY",
    "price": "1995",
    "quantity": "1.5",
    "value": "2992.5",
    "fee": "2.99",
    "executedAt": "2024-01-15T10:31:00Z"
  },
  "signature": "sha256=...",
  "api_version": "2024-01-01"
}
```

### settlement.completed
Triggered when a settlement epoch is completed.

```json
{
  "id": "evt_1234567894",
  "type": "settlement.completed",
  "timestamp": "2024-01-15T12:00:00Z",
  "data": {
    "settlementId": "stl_jkl012",
    "epochId": "epoch_mno345",
    "userCount": 150,
    "tradeCount": 500,
    "totalVolume": "1000000",
    "status": "COMPLETED",
    "completedAt": "2024-01-15T12:00:00Z"
  },
  "signature": "sha256=...",
  "api_version": "2024-01-01"
}
```

### settlement.claimed
Triggered when a user claims their settlement.

```json
{
  "id": "evt_1234567895",
  "type": "settlement.claimed",
  "timestamp": "2024-01-15T12:05:00Z",
  "data": {
    "settlementId": "stl_jkl012",
    "userId": "usr_xyz789",
    "epochId": "epoch_mno345",
    "tokens": [
      {
        "token": "USDC",
        "amount": "1000",
        "direction": "CREDIT"
      },
      {
        "token": "ETH",
        "amount": "0.5",
        "direction": "DEBIT"
      }
    ],
    "transactionHash": "0x1234567890abcdef",
    "claimedAt": "2024-01-15T12:05:00Z"
  },
  "signature": "sha256=...",
  "api_version": "2024-01-01"
}
```

## API Endpoints

### Create Webhook
```
POST /api/webhooks
```

### List Webhooks
```
GET /api/webhooks
```

### Get Webhook
```
GET /api/webhooks/:id
```

### Update Webhook
```
PUT /api/webhooks/:id
```

### Delete Webhook
```
DELETE /api/webhooks/:id
```

### Test Webhook
```
POST /api/webhooks/:id/test
```

### Get Webhook Events
```
GET /api/webhooks/:id/events
```

### Get Webhook Secret
```
GET /api/webhooks/:id/secret
```

### Regenerate Secret
```
POST /api/webhooks/:id/regenerate-secret
```

## Retry Logic

The webhook system implements exponential backoff with jitter:

1. **Initial Delay**: 1 second (configurable)
2. **Backoff Formula**: `delay = initialDelay * 2^(attemptNumber - 1) + jitter`
3. **Max Delay**: 1 hour (configurable)
4. **Max Retries**: 5 attempts (configurable)
5. **Timeout**: 30 seconds per request (configurable)

Failed webhooks are retried with the following status codes:
- **5xx errors**: Always retried
- **429 (Too Many Requests)**: Retried with backoff
- **4xx errors (except 429)**: Not retried
- **Network errors**: Retried

## Security Best Practices

1. **Always verify signatures** before processing webhooks
2. **Validate timestamps** to prevent replay attacks
3. **Use HTTPS** for webhook URLs in production
4. **Implement idempotency** using the event ID
5. **Respond quickly** (within 30 seconds) to prevent timeouts
6. **Use IP whitelisting** for additional security
7. **Store webhook secrets securely** and rotate regularly
8. **Log webhook events** for debugging and audit trails

## Integration Example

```javascript
// In your order service
const { WebhookService } = require('./services/webhook/WebhookService');
const webhookService = WebhookService.getInstance();
const eventEmitter = webhookService.getEventEmitter();

class OrderService {
  async createOrder(orderData) {
    const order = await Order.create(orderData);
    
    // Emit webhook event
    await eventEmitter.emit('order:created', order);
    
    return order;
  }
  
  async fillOrder(orderId, fillData) {
    const order = await Order.findByPk(orderId);
    await order.update(fillData);
    
    // Emit webhook event
    await eventEmitter.emit('order:filled', order, fillData);
    
    return order;
  }
}
```

## Monitoring

### Health Check Endpoint
```
GET /api/webhook-monitoring/health
```

### Prometheus Metrics
```
GET /api/webhook-monitoring/metrics
```

### Dashboard
```
GET /api/webhook-monitoring/dashboard
```

### Key Metrics
- `webhook_delivery_total`: Total deliveries by event type and status
- `webhook_delivery_duration_seconds`: Delivery time histogram
- `webhook_queue_size`: Current queue sizes
- `webhook_active_count`: Active webhooks by event type
- `webhook_failure_rate`: Failure rate by webhook

## Troubleshooting

### Common Issues

1. **Webhook not receiving events**
   - Verify webhook is active
   - Check event types are subscribed
   - Validate URL is accessible
   - Check IP whitelist if configured

2. **Invalid signature errors**
   - Ensure using raw request body for signature
   - Verify secret matches
   - Check timestamp is within tolerance

3. **High failure rate**
   - Check endpoint availability
   - Verify response time < 30 seconds
   - Monitor for 4xx errors
   - Check rate limits

4. **Events in dead letter queue**
   - Review error messages
   - Check webhook configuration
   - Manually retry or fix issues

### Debug Headers

All webhook requests include debug headers:
- `X-Webhook-Event-ID`: Unique event identifier
- `X-Webhook-Timestamp`: Unix timestamp
- `X-Webhook-Signature`: HMAC signature
- `User-Agent`: TradingPlatform-Webhook/1.0

## Rate Limits

- **Webhook Creation**: 10 per minute per user
- **Webhook Testing**: 5 per minute per webhook
- **Event Delivery**: No hard limit, but queued for delivery
- **API Requests**: Standard platform rate limits apply