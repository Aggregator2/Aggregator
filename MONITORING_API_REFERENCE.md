# DEX Monitoring System API Reference

## Overview

This document provides comprehensive API reference for the DEX monitoring system, including endpoints for metrics collection, suspicious activity detection, and order book visualization.

## Base URL

```
Production: https://api.dex-monitoring.com
Development: http://localhost:8080
```

## Authentication

All API endpoints require authentication via JWT tokens:

```bash
curl -H "Authorization: Bearer your-jwt-token" \
     https://api.dex-monitoring.com/api/v1/metrics
```

## Rate Limiting

- **Default Limit**: 1000 requests per second per IP
- **Burst Limit**: 5000 requests per minute
- **Headers**: Rate limit information included in response headers

```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999
X-RateLimit-Reset: 1640995200
```

## Metrics API

### POST /api/v1/metrics/counter

Increment a counter metric.

**Request Body:**
```json
{
  "name": "orders_submitted",
  "value": 1,
  "labels": {
    "pair": "ETH/USDT",
    "side": "buy"
  },
  "identifier": "user123"
}
```

**Response:**
```json
{
  "success": true,
  "value": 1542,
  "timestamp": 1640995200000
}
```

**Parameters:**
- `name` (string, required): Metric name (alphanumeric + underscores)
- `value` (number, optional): Increment value (default: 1)
- `labels` (object, optional): Key-value labels
- `identifier` (string, optional): Rate limiting identifier

### POST /api/v1/metrics/gauge

Set a gauge metric value.

**Request Body:**
```json
{
  "name": "order_book_spread",
  "value": 0.05,
  "labels": {
    "pair": "BTC/USDT"
  }
}
```

**Response:**
```json
{
  "success": true,
  "value": 0.05,
  "timestamp": 1640995200000
}
```

### POST /api/v1/metrics/histogram

Record a histogram value.

**Request Body:**
```json
{
  "name": "order_processing_time",
  "value": 45.2,
  "labels": {
    "engine": "primary"
  }
}
```

**Response:**
```json
{
  "success": true,
  "recorded": true,
  "statistics": {
    "count": 1000,
    "mean": 42.5,
    "p95": 65.3,
    "p99": 89.1
  }
}
```

### POST /api/v1/metrics/timer/start

Start a timing measurement.

**Request Body:**
```json
{
  "name": "trade_execution_time",
  "labels": {
    "pair": "SOL/USDT"
  }
}
```

**Response:**
```json
{
  "success": true,
  "timerId": "timer_1640995200000_a1b2c3d4"
}
```

### POST /api/v1/metrics/timer/end

End a timing measurement.

**Request Body:**
```json
{
  "timerId": "timer_1640995200000_a1b2c3d4"
}
```

**Response:**
```json
{
  "success": true,
  "duration": 123.45,
  "unit": "milliseconds"
}
```

### GET /api/v1/metrics/snapshot

Get current metrics snapshot.

**Query Parameters:**
- `format` (string): Response format (`json`, `prometheus`)
- `compress` (boolean): Enable gzip compression

**Response:**
```json
{
  "timestamp": 1640995200000,
  "counters": {
    "orders_submitted{pair=ETH/USDT}": 1542,
    "orders_matched{pair=ETH/USDT}": 1489
  },
  "gauges": {
    "order_book_spread{pair=BTC/USDT}": 0.05
  },
  "histograms": {
    "order_processing_time": {
      "count": 1000,
      "mean": 42.5,
      "p50": 38.2,
      "p95": 65.3,
      "p99": 89.1
    }
  },
  "memoryUsage": 536870912,
  "rateLimitStatus": 156
}
```

### GET /api/v1/metrics/timeseries

Get time series data for a metric.

**Query Parameters:**
- `type` (string, required): Metric type (`counter`, `gauge`, `histogram`)
- `name` (string, required): Metric name
- `start` (number, required): Start timestamp (Unix milliseconds)
- `end` (number, required): End timestamp (Unix milliseconds)
- `labels` (string, optional): JSON-encoded labels object

**Response:**
```json
{
  "metricName": "order_processing_time",
  "metricType": "histogram",
  "timeRange": {
    "start": 1640995200000,
    "end": 1640995500000
  },
  "data": [
    {
      "timestamp": 1640995200000,
      "value": 42.5
    },
    {
      "timestamp": 1640995260000,
      "value": 45.1
    }
  ]
}
```

## Suspicious Activity API

### GET /api/v1/security/alerts

Get suspicious activity alerts.

**Query Parameters:**
- `severity` (string): Filter by severity (`low`, `medium`, `high`, `critical`)
- `type` (string): Filter by alert type
- `start` (number): Start timestamp
- `end` (number): End timestamp
- `limit` (number): Maximum results (default: 100, max: 1000)
- `offset` (number): Pagination offset

**Response:**
```json
{
  "alerts": [
    {
      "id": "alert_1640995200000_a1b2c3d4",
      "type": "wash_trading",
      "severity": "high",
      "confidence": 0.92,
      "timestamp": 1640995200000,
      "userIdHash": "a1b2c3d4e5f6...",
      "patterns": [
        {
          "pattern": "washTrading",
          "confidence": 0.92,
          "details": "Same user on both sides, Same IP address"
        }
      ],
      "status": "new",
      "metadata": {
        "adaptiveThreshold": 0.8,
        "systemLoad": 256.5,
        "detectionVersion": "2.0"
      }
    }
  ],
  "pagination": {
    "total": 1542,
    "limit": 100,
    "offset": 0,
    "hasMore": true
  }
}
```

### POST /api/v1/security/alerts/{alertId}/acknowledge

Acknowledge an alert.

**Path Parameters:**
- `alertId` (string): Alert ID

**Request Body:**
```json
{
  "acknowledgement": "Investigated - false positive",
  "action": "whitelist_user"
}
```

**Response:**
```json
{
  "success": true,
  "alert": {
    "id": "alert_1640995200000_a1b2c3d4",
    "status": "acknowledged",
    "acknowledgedBy": "analyst123",
    "acknowledgedAt": 1640995500000,
    "acknowledgement": "Investigated - false positive"
  }
}
```

### GET /api/v1/security/patterns

Get detection pattern statistics.

**Response:**
```json
{
  "patterns": {
    "washTrading": {
      "totalDetections": 156,
      "averageConfidence": 0.87,
      "falsePositiveRate": 0.05
    },
    "frontRunning": {
      "totalDetections": 23,
      "averageConfidence": 0.93,
      "falsePositiveRate": 0.02
    },
    "layering": {
      "totalDetections": 89,
      "averageConfidence": 0.79,
      "falsePositiveRate": 0.08
    }
  },
  "performance": {
    "detectionsPerSecond": 12.5,
    "averageProcessingTime": 35.2,
    "memoryUsage": 145.8,
    "alertAccuracy": 0.95
  }
}
```

### POST /api/v1/security/whitelist

Add user to whitelist.

**Request Body:**
```json
{
  "userId": "user123",
  "reason": "Verified institutional trader",
  "expiresAt": 1640995200000
}
```

**Response:**
```json
{
  "success": true,
  "whitelisted": true,
  "expiresAt": 1640995200000
}
```

### POST /api/v1/security/blacklist

Add user to blacklist.

**Request Body:**
```json
{
  "userId": "user123",
  "reason": "Confirmed market manipulation",
  "duration": 86400000,
  "severity": "permanent"
}
```

**Response:**
```json
{
  "success": true,
  "blacklisted": true,
  "expiresAt": 1641081600000,
  "reason": "Confirmed market manipulation"
}
```

## Order Book API

### GET /api/v1/orderbook/visualization

Get order book visualization data.

**Query Parameters:**
- `pair` (string, required): Trading pair (e.g., "ETH/USDT")
- `timeRange` (number): Time range in milliseconds (default: 300000)
- `format` (string): Response format (`json`, `csv`)

**Response:**
```json
{
  "pair": "ETH/USDT",
  "timeRange": 300000,
  "current": {
    "timestamp": 1640995200000,
    "midPrice": 4234.56,
    "spread": 0.02,
    "bidVolume": 125.8,
    "askVolume": 143.2,
    "pressure": 15.3
  },
  "history": [
    {
      "timestamp": 1640995140000,
      "midPrice": 4234.12,
      "spread": 0.018,
      "bidVolume": 128.4,
      "askVolume": 139.7,
      "pressure": 12.1
    }
  ],
  "statistics": {
    "avgSpread": 0.019,
    "minSpread": 0.015,
    "maxSpread": 0.025,
    "avgPressure": 13.7,
    "trendDirection": "bullish"
  },
  "performance": {
    "processingTime": 12.5,
    "cacheHitRate": 0.85,
    "memoryUsage": 256.8
  }
}
```

### GET /api/v1/orderbook/depth

Get order book depth analysis.

**Query Parameters:**
- `pair` (string, required): Trading pair
- `levels` (string): Comma-separated depth levels (e.g., "0.1,0.5,1.0")

**Response:**
```json
{
  "pair": "ETH/USDT",
  "timestamp": 1640995200000,
  "midPrice": 4234.56,
  "depth": {
    "0.1%": {
      "bidVolume": 45.2,
      "askVolume": 52.1,
      "totalVolume": 97.3,
      "ratio": 0.87
    },
    "0.5%": {
      "bidVolume": 125.8,
      "askVolume": 143.2,
      "totalVolume": 269.0,
      "ratio": 0.88
    },
    "1.0%": {
      "bidVolume": 256.4,
      "askVolume": 289.7,
      "totalVolume": 546.1,
      "ratio": 0.89
    }
  }
}
```

### GET /api/v1/orderbook/pressure

Get market pressure analysis.

**Query Parameters:**
- `pair` (string, required): Trading pair
- `range` (number): Analysis range percentage (default: 0.5)

**Response:**
```json
{
  "pair": "ETH/USDT",
  "timestamp": 1640995200000,
  "midPrice": 4234.56,
  "pressure": {
    "buyPressure": 156.8,
    "sellPressure": 134.2,
    "pressureScore": 15.3,
    "direction": "bullish",
    "strength": "moderate"
  },
  "imbalance": {
    "top5": {
      "imbalanceRatio": 0.078,
      "bidDominance": 0.539
    },
    "top10": {
      "imbalanceRatio": 0.065,
      "bidDominance": 0.532
    },
    "top20": {
      "imbalanceRatio": 0.058,
      "bidDominance": 0.529
    }
  }
}
```

### WebSocket API

Connect to real-time order book updates via WebSocket:

```javascript
const ws = new WebSocket('wss://api.dex-monitoring.com/ws/orderbook');

ws.onopen = () => {
  // Subscribe to pair updates
  ws.send(JSON.stringify({
    type: 'subscribe',
    pairs: ['ETH/USDT', 'BTC/USDT']
  }));
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  
  if (data.type === 'orderbook_update') {
    console.log('Order book update:', data);
  }
};
```

**WebSocket Message Types:**

1. **Subscribe:**
```json
{
  "type": "subscribe",
  "pairs": ["ETH/USDT", "BTC/USDT"]
}
```

2. **Order Book Update:**
```json
{
  "type": "orderbook_update",
  "pair": "ETH/USDT",
  "timestamp": 1640995200000,
  "data": {
    "spread": 0.02,
    "midPrice": 4234.56,
    "bidVolume": 125.8,
    "askVolume": 143.2,
    "pressure": 15.3
  }
}
```

3. **Initial Data:**
```json
{
  "type": "initial_data",
  "data": {
    "ETH/USDT": [
      {
        "timestamp": 1640995140000,
        "midPrice": 4234.12,
        "spread": 0.018
      }
    ]
  }
}
```

## System APIs

### GET /api/v1/health

System health check.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T12:00:00.000Z",
  "uptime": 86400.123,
  "memory": {
    "heapUsed": 536870912,
    "heapTotal": 1073741824,
    "external": 12345678
  },
  "redis": "connected",
  "components": {
    "metricsCollector": true,
    "suspiciousActivityDetector": true,
    "orderBookVisualizer": true
  }
}
```

### GET /api/v1/metrics/performance

System performance metrics.

**Response:**
```json
{
  "timestamp": 1640995200000,
  "system": {
    "cpuUsage": 45.2,
    "memoryUsage": 536870912,
    "heapUsage": 0.65,
    "eventLoopLag": 12.5
  },
  "metrics": {
    "collectionsPerSecond": 150.2,
    "averageProcessingTime": 8.5,
    "cacheHitRate": 0.85,
    "rateLimitHits": 5
  },
  "security": {
    "detectionsPerSecond": 12.5,
    "alertsGenerated": 156,
    "falsePositiveRate": 0.05,
    "circuitBreakerState": "closed"
  },
  "orderbook": {
    "snapshotsProcessed": 3600,
    "averageProcessingTime": 15.2,
    "wsConnections": 25,
    "cacheSize": 1000
  }
}
```

### POST /api/v1/admin/cleanup

Trigger manual cleanup (Admin only).

**Response:**
```json
{
  "success": true,
  "cleaned": {
    "metrics": 1543,
    "rateLimiters": 89,
    "cache": 256,
    "memory": "512MB freed"
  },
  "timestamp": 1640995200000
}
```

### POST /api/v1/admin/circuit-breaker/reset

Reset circuit breaker (Admin only).

**Response:**
```json
{
  "success": true,
  "circuitBreaker": {
    "state": "closed",
    "failures": 0,
    "lastReset": 1640995200000
  }
}
```

## Error Handling

All API endpoints return consistent error responses:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid metric name format",
    "details": {
      "field": "name",
      "value": "invalid-name!",
      "constraint": "Must match pattern: ^[a-zA-Z_][a-zA-Z0-9_]*$"
    },
    "timestamp": 1640995200000,
    "requestId": "req_1640995200000_a1b2c3d4"
  }
}
```

**Common Error Codes:**
- `VALIDATION_ERROR`: Input validation failed
- `RATE_LIMIT_EXCEEDED`: Rate limit exceeded
- `AUTHENTICATION_REQUIRED`: Missing or invalid authentication
- `AUTHORIZATION_FAILED`: Insufficient permissions
- `RESOURCE_NOT_FOUND`: Requested resource not found
- `INTERNAL_ERROR`: Internal server error
- `CIRCUIT_BREAKER_OPEN`: Circuit breaker is open
- `ENCRYPTION_ERROR`: Data encryption/decryption failed

## Rate Limiting

Rate limiting is applied per endpoint and identifier:

- **Metrics endpoints**: 1000/sec per identifier
- **Security endpoints**: 100/sec per user
- **Order book endpoints**: 500/sec per IP
- **Admin endpoints**: 10/sec per user

Rate limit headers are included in all responses:
```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999
X-RateLimit-Reset: 1640995260
X-RateLimit-Type: sliding_window
```

## SDK Examples

### JavaScript/Node.js

```javascript
const DexMonitoringClient = require('@dex/monitoring-client');

const client = new DexMonitoringClient({
  baseUrl: 'https://api.dex-monitoring.com',
  apiKey: 'your-api-key',
  timeout: 5000
});

// Submit counter metric
await client.metrics.counter('orders_submitted', 1, {
  pair: 'ETH/USDT',
  side: 'buy'
});

// Get order book data
const orderbook = await client.orderbook.getVisualization('ETH/USDT', {
  timeRange: 300000
});

// Subscribe to alerts
client.security.onAlert((alert) => {
  console.log('Security alert:', alert);
});
```

### Python

```python
from dex_monitoring import DexMonitoringClient

client = DexMonitoringClient(
    base_url='https://api.dex-monitoring.com',
    api_key='your-api-key',
    timeout=5.0
)

# Submit gauge metric
client.metrics.gauge('order_book_spread', 0.05, {
    'pair': 'BTC/USDT'
})

# Get security alerts
alerts = client.security.get_alerts(
    severity='high',
    limit=50
)
```

---

For additional API support or feature requests, please contact the development team or create an issue in the repository.