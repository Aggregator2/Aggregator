# Grafana Integration Guide for DEX Metrics

This guide provides comprehensive instructions for integrating the DEX metrics with Grafana dashboards.

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [Data Source Configuration](#data-source-configuration)
3. [Dashboard Organization](#dashboard-organization)
4. [Key Metrics and Queries](#key-metrics-and-queries)
5. [Dashboard Examples](#dashboard-examples)
6. [Alerting Rules](#alerting-rules)
7. [Best Practices](#best-practices)

## Prerequisites

- Grafana 8.0+ installed
- Prometheus configured as data source
- DEX Metrics Exporter running on port 9090

## Data Source Configuration

### 1. Add Prometheus Data Source

```yaml
apiVersion: 1

datasources:
  - name: Prometheus-DEX
    type: prometheus
    access: proxy
    url: http://localhost:9090
    isDefault: true
    jsonData:
      timeInterval: "5s"
      queryTimeout: "60s"
      httpMethod: POST
```

### 2. Configure Scrape Interval

In your Prometheus configuration:

```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'dex-metrics'
    static_configs:
      - targets: ['localhost:9090']
        labels:
          service: 'swappiq-dex'
```

## Dashboard Organization

### Recommended Dashboard Structure

1. **Executive Overview** - High-level business metrics
2. **Trading Performance** - Order flow and execution metrics
3. **Liquidity Analytics** - Pool depth and utilization
4. **Technical Performance** - Latency, throughput, errors
5. **Infrastructure Health** - System resources and availability
6. **User Analytics** - User behavior and retention
7. **Financial Metrics** - Revenue, fees, and volumes

## Key Metrics and Queries

### Business Metrics

#### Trading Volume (24h)
```promql
sum(dex_trading_volume_24h_usd{pair=~"$pair"})
```

#### Order Flow Rate
```promql
sum(rate(dex_orders_per_minute{pair=~"$pair"}[5m])) * 60
```

#### Active Users
```promql
dex_active_users{period="1d", user_type="all"}
```

#### Total Value Locked
```promql
sum(dex_total_value_locked_usd{pair=~"$pair"})
```

#### Fee Revenue (24h)
```promql
sum(dex_trading_fees_24h_usd{pair=~"$pair"})
```

### Technical Metrics

#### API Response Time (P95)
```promql
histogram_quantile(0.95, 
  sum(rate(dex_http_request_duration_seconds_bucket{route=~"$route"}[5m])) 
  by (le, route)
)
```

#### WebSocket Message Latency
```promql
histogram_quantile(0.99,
  sum(rate(dex_websocket_message_latency_seconds_bucket{message_type=~"$type"}[5m]))
  by (le, message_type)
)
```

#### Order Processing Time
```promql
histogram_quantile(0.95,
  sum(rate(dex_order_processing_duration_seconds_bucket{order_type=~"$type"}[5m]))
  by (le, order_type)
)
```

#### Error Rate
```promql
sum(rate(dex_http_request_errors_total[5m])) / 
sum(rate(dex_http_requests_total[5m])) * 100
```

### Infrastructure Metrics

#### CPU Usage
```promql
avg(dex_cpu_usage_percent{type="user"}) + avg(dex_cpu_usage_percent{type="system"})
```

#### Memory Usage
```promql
dex_memory_usage_bytes{type="rss"} / dex_memory_usage_bytes{type="total"} * 100
```

#### Database Connections
```promql
sum(dex_database_connections{state=~"active|idle"})
```

#### Redis Memory
```promql
dex_redis_memory_bytes{type="used"} / 1024 / 1024 / 1024
```

### DEX-Specific Metrics

#### Liquidity Utilization
```promql
avg(swappiq_liquidity_pool_metrics{metric_type="utilization", pool=~"$pool"})
```

#### Slippage Distribution
```promql
histogram_quantile(0.95,
  sum(rate(swappiq_slippage_percent_bucket{pair=~"$pair"}[1h]))
  by (le, pair)
)
```

#### MEV Protection Success Rate
```promql
sum(rate(swappiq_mev_protection_events{success="true"}[5m])) /
sum(rate(swappiq_mev_protection_events[5m])) * 100
```

## Dashboard Examples

### 1. Executive Overview Dashboard

Key panels:
- Trading Volume (Time Series)
- Active Users (Stat)
- TVL Growth (Time Series)
- Fee Revenue (Stat)
- Market Share (Gauge)
- Top Trading Pairs (Bar Chart)

### 2. Trading Performance Dashboard

Key panels:
- Order Flow Rate (Time Series)
- Order Book Depth (Heatmap)
- Execution Latency (Histogram)
- Fill Rate (Gauge)
- Slippage Analysis (Time Series)
- Failed Orders (Table)

### 3. Liquidity Analytics Dashboard

Key panels:
- Pool TVL (Time Series)
- Liquidity Utilization (Gauge)
- Impermanent Loss (Time Series)
- LP Returns (Bar Chart)
- Pool Composition (Pie Chart)
- Liquidity Events (Table)

## Alerting Rules

### Critical Alerts

```yaml
groups:
  - name: dex_critical
    interval: 30s
    rules:
      - alert: HighErrorRate
        expr: |
          sum(rate(dex_http_request_errors_total[5m])) / 
          sum(rate(dex_http_requests_total[5m])) > 0.05
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "High error rate detected"
          description: "Error rate is {{ $value | humanizePercentage }}"

      - alert: OrderProcessingLatency
        expr: |
          histogram_quantile(0.99, 
            sum(rate(dex_order_processing_duration_seconds_bucket[5m])) 
            by (le)
          ) > 1
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "High order processing latency"
          description: "P99 latency is {{ $value }}s"

      - alert: LowLiquidity
        expr: |
          dex_liquidity_depth_usd{depth_percent="1"} < 100000
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Low liquidity detected"
          description: "Liquidity depth at 1% is ${{ $value }}"
```

### Business Alerts

```yaml
  - name: dex_business
    interval: 5m
    rules:
      - alert: LowTradingVolume
        expr: |
          sum(rate(dex_trading_volume_24h_usd[1h])) < 1000000
        for: 1h
        labels:
          severity: warning
        annotations:
          summary: "Trading volume below threshold"
          description: "24h volume is ${{ $value | humanize }}"

      - alert: HighSlippage
        expr: |
          histogram_quantile(0.95,
            sum(rate(swappiq_slippage_percent_bucket[15m]))
            by (le, pair)
          ) > 2
        for: 15m
        labels:
          severity: warning
        annotations:
          summary: "High slippage detected"
          description: "P95 slippage is {{ $value }}% for {{ $labels.pair }}"
```

## Best Practices

### 1. Dashboard Design
- Group related metrics together
- Use consistent color schemes
- Add helpful tooltips and descriptions
- Include time range selectors
- Use variables for filtering

### 2. Query Optimization
- Use recording rules for complex queries
- Aggregate data appropriately
- Limit time ranges for heavy queries
- Use `by` and `without` for efficiency

### 3. Alert Configuration
- Set appropriate thresholds based on baselines
- Use multi-window alerts to reduce noise
- Include runbook links in annotations
- Test alerts in staging first

### 4. Performance Tips
- Limit number of queries per dashboard
- Use shared queries where possible
- Enable query caching
- Set appropriate refresh intervals

### 5. Maintenance
- Regularly review and update dashboards
- Archive unused metrics
- Document custom panels
- Version control dashboard JSON

## Variable Configuration

Add these variables to your dashboards:

```json
{
  "templating": {
    "list": [
      {
        "name": "pair",
        "type": "query",
        "query": "label_values(dex_trading_volume_24h_usd, pair)",
        "multi": true,
        "includeAll": true
      },
      {
        "name": "interval",
        "type": "interval",
        "options": ["1m", "5m", "15m", "1h", "6h", "1d"],
        "current": {
          "text": "5m",
          "value": "5m"
        }
      }
    ]
  }
}
```

## Import Instructions

1. Navigate to Grafana → Dashboards → Import
2. Upload JSON files from `/workspace/monitoring/grafana/dashboards/`
3. Select Prometheus data source
4. Configure variables if prompted
5. Save dashboard to appropriate folder

## Troubleshooting

### No Data Points
- Verify Prometheus is scraping metrics endpoint
- Check time range selection
- Ensure metrics are being exported
- Validate query syntax

### Slow Queries
- Reduce time range
- Add more specific label selectors
- Consider using recording rules
- Check Prometheus resource usage

### Missing Metrics
- Verify metric names in Prometheus
- Check collector configuration
- Ensure all services are running
- Review exporter logs