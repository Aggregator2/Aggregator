# SwappiQ Protocol Monitoring Infrastructure

## Overview

Comprehensive monitoring and observability stack for the SwappiQ Protocol, featuring Prometheus metrics collection, Grafana visualization, ELK stack for log aggregation, and Jaeger for distributed tracing.

## Components

### 1. Metrics Collector (`metrics-collector.js`)
Central metrics collection system using Redis for storage and aggregation.

**Features:**
- Timer metrics for latency tracking
- Counter metrics for event counting
- Gauge metrics for current values
- Histogram metrics for distributions
- Time series data storage
- Automatic data retention and cleanup

### 2. Matching Engine Monitor (`matching-engine-monitor.js`)
Real-time monitoring of the matching engine performance.

**Tracks:**
- Order processing rates
- Matching efficiency
- Latency percentiles (P50, P75, P90, P95, P99)
- CPU and memory usage
- Event loop lag
- Order book imbalances

### 3. Order Book Visualizer (`orderbook-visualizer.js`)
Comprehensive order book depth and liquidity analysis.

**Features:**
- Real-time depth visualization
- Spread analysis
- Liquidity metrics
- Market pressure indicators
- Large order detection
- Historical heatmaps

### 4. Settlement Monitor (`settlement-monitor.js`)
Tracks settlement performance and success rates.

**Monitors:**
- Settlement success/failure rates
- Gas consumption per settlement
- Settlement duration
- Stuck settlement detection
- Historical settlement patterns

### 5. Gas Tracker (`gas-tracker.js`)
Multi-network gas price monitoring and optimization.

**Features:**
- Real-time gas prices (Mainnet, Arbitrum, Polygon, Optimism)
- Gas consumption tracking by operation
- Cost analysis and reporting
- Optimization recommendations
- Network comparison

### 6. Suspicious Activity Detector (`suspicious-activity-detector.js`)
Advanced pattern detection for market manipulation and fraud.

**Detects:**
- Wash trading
- Layering/Spoofing
- Front-running
- Market manipulation
- Unusual volume patterns
- Rapid order cancellations
- Coordinated activities

### 7. Performance Benchmark (`performance-benchmark.js`)
Comprehensive performance testing and benchmarking tools.

**Features:**
- Automated benchmarking
- Stress testing
- Concurrency testing
- Performance regression detection
- System resource monitoring

## API Endpoints

### `/api/monitoring/metrics`
Get real-time metrics and historical data.

**Query Parameters:**
- `type`: `snapshot` | `timeseries` | `aggregate` | `summary`
- `metric`: Specific metric name
- `startTime`: Start timestamp for time series
- `endTime`: End timestamp for time series
- `interval`: Aggregation interval
- `aggregation`: `avg` | `sum` | `min` | `max` | `count`

### `/api/monitoring/alerts`
Manage and retrieve security alerts.

**GET Parameters:**
- `limit`: Number of alerts to retrieve
- `severity`: Filter by severity level
- `type`: Filter by alert type
- `userId`: Filter by user
- `status`: Filter by status

**POST Actions:**
- `acknowledge`: Acknowledge an alert
- `resolve`: Mark alert as resolved
- `escalate`: Escalate to higher severity
- `dismiss`: Dismiss alert

### `/api/monitoring/dashboard`
Get dashboard data for different views.

**Views:**
- `overview`: System-wide overview
- `matching`: Matching engine metrics
- `orderbook`: Order book visualization
- `settlement`: Settlement tracking
- `gas`: Gas consumption and prices
- `performance`: Performance benchmarks
- `security`: Security alerts and threats

## Grafana Integration

### Dashboard Setup
1. Import the dashboard from `/monitoring/grafana/dashboards/dex-monitoring.json`
2. Configure Prometheus data source
3. Set refresh interval (recommended: 5s for real-time)

### Alert Configuration
1. Import alert rules from `/monitoring/grafana/alerts/alert-rules.yaml`
2. Configure notification channels (email, Slack, PagerDuty)
3. Adjust thresholds based on your requirements

## Metrics Reference

### Matching Engine Metrics
- `matching_engine.orders_submitted`: Total orders submitted
- `matching_engine.orders_matched`: Total orders matched
- `matching_engine.order_processing_time`: Processing latency histogram
- `matching_engine.order_rate`: Orders per second
- `matching_engine.match_rate`: Matches per second
- `matching_engine.efficiency`: Percentage of orders processed within SLA

### Order Book Metrics
- `orderbook.spread`: Current bid-ask spread
- `orderbook.spread_percent`: Spread as percentage
- `orderbook.depth.<level>.total`: Total volume at depth level
- `orderbook.pressure_score`: Buy/sell pressure indicator
- `orderbook.large_orders_count`: Number of large orders

### Settlement Metrics
- `settlements.initiated`: Settlements initiated
- `settlements.completed`: Successful settlements
- `settlements.failed`: Failed settlements
- `settlements.duration`: Settlement duration histogram
- `settlements.gas_used`: Gas used per settlement
- `settlements.success_rate.<period>`: Success rate by period

### Gas Metrics
- `gas.price.<network>.<speed>`: Gas prices by network and speed
- `gas.consumption.<operation>`: Gas consumed by operation
- `gas.cost.<period>`: Gas costs by time period

### Security Metrics
- `suspicious_activity.alerts`: Total alerts generated
- `suspicious_activity.alerts_by_type.<type>`: Alerts by type
- `suspicious_activity.alerts_by_severity.<level>`: Alerts by severity
- `suspicious_activity.bans`: Users banned

### Performance Metrics
- `benchmark.<test>.time`: Benchmark execution time
- `benchmark.<test>.p95`: 95th percentile latency
- `benchmark.<test>.ops_per_second`: Operations per second
- `benchmark.<test>.memory_avg`: Average memory usage

## Configuration

### Environment Variables
```bash
# Redis connection
REDIS_URL=redis://localhost:6379

# Monitoring intervals
METRICS_RETENTION_PERIOD=604800  # 7 days
AGGREGATION_INTERVALS=60,300,900,3600

# Alert thresholds
ALERT_THRESHOLD=0.8
MAX_ALERTS_PER_HOUR=100

# Gas tracking
ETH_GAS_STATION_API=your_api_key
MAINNET_RPC_URL=https://eth-mainnet.alchemyapi.io/v2/your_key
ARBITRUM_RPC_URL=https://arb-mainnet.g.alchemy.com/v2/your_key
POLYGON_RPC_URL=https://polygon-mainnet.g.alchemy.com/v2/your_key
```

### Thresholds Configuration
Edit thresholds in each monitor class:
```javascript
this.thresholds = {
  matchingLatency: 100,        // ms
  orderProcessingRate: 1000,   // orders/sec
  settlementDelay: 300000,     // 5 minutes
  gasSpike: 2,                 // 2x average
  failureRate: 0.05            // 5%
};
```

## Usage Examples

### Starting Monitoring
```javascript
const { getMetricsCollector } = require('./monitoring/metrics-collector');
const MatchingEngineMonitor = require('./monitoring/matching-engine-monitor');

// Initialize metrics collector
const metrics = getMetricsCollector();
await metrics.initialize();

// Start matching engine monitoring
const engineMonitor = new MatchingEngineMonitor(matchingEngine);
await engineMonitor.start();

// Start other monitors...
```

### Running Benchmarks
```javascript
const PerformanceBenchmark = require('./monitoring/performance-benchmark');
const benchmark = new PerformanceBenchmark();

// Run order matching benchmark
const results = await benchmark.benchmarkOrderMatching(matchingEngine, {
  orderCount: 10000,
  benchmarkRuns: 1000
});

console.log(results.summary);
```

### Detecting Suspicious Activity
```javascript
const SuspiciousActivityDetector = require('./monitoring/suspicious-activity-detector');
const detector = new SuspiciousActivityDetector();

// Start detection
await detector.start(matchingEngine, orderBook);

// Listen for alerts
detector.on('alert', (alert) => {
  console.log('Security alert:', alert);
  // Send notifications, take action, etc.
});
```

## Monitoring Best Practices

1. **Set Appropriate Thresholds**: Adjust alert thresholds based on your system's normal behavior
2. **Regular Benchmarking**: Run benchmarks regularly to detect performance regressions
3. **Alert Fatigue**: Avoid too many low-priority alerts
4. **Incident Response**: Have clear procedures for each alert type
5. **Data Retention**: Balance between historical data needs and storage costs
6. **Dashboard Organization**: Create role-specific dashboards (operations, security, business)

## Troubleshooting

### High Memory Usage
- Check Redis memory usage
- Reduce retention period
- Increase aggregation intervals
- Enable Redis persistence

### Missing Metrics
- Verify Redis connection
- Check metric names and labels
- Ensure monitors are started
- Check for errors in logs

### Alert Storm
- Increase alert thresholds
- Implement alert grouping
- Add rate limiting
- Check for cascading failures

### Performance Issues
- Use sampling for high-frequency metrics
- Optimize Redis queries
- Implement metric batching
- Consider metric aggregation

## Security Considerations

1. **Access Control**: Protect monitoring endpoints with authentication
2. **Data Privacy**: Don't log sensitive user data
3. **Rate Limiting**: Prevent monitoring system abuse
4. **Encryption**: Use TLS for Redis connections
5. **Audit Trail**: Log all alert actions and configuration changes