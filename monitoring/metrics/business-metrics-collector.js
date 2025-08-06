/**
 * Business Metrics Collector for SwappiQ Protocol
 * Author: SwappiQ Protocol
 * Description: Custom business KPI metrics collection and reporting
 */

const express = require('express');
const promClient = require('prom-client');
const Redis = require('ioredis');
const { Pool } = require('pg');
const WebSocket = require('ws');

// Initialize Prometheus metrics
const register = new promClient.Registry();

// Custom business metrics
const tradingVolumeGauge = new promClient.Gauge({
  name: 'swappiq_trading_volume_usd',
  help: 'Total trading volume in USD',
  labelNames: ['trading_pair', 'period'],
  registers: [register]
});

const activeUsersGauge = new promClient.Gauge({
  name: 'swappiq_active_users',
  help: 'Number of active users',
  labelNames: ['period'],
  registers: [register]
});

const revenueGauge = new promClient.Gauge({
  name: 'swappiq_fee_revenue_usd',
  help: 'Fee revenue in USD',
  labelNames: ['period', 'fee_type'],
  registers: [register]
});

const orderBookDepthGauge = new promClient.Gauge({
  name: 'swappiq_orderbook_depth_usd',
  help: 'Order book depth in USD',
  labelNames: ['trading_pair', 'side'],
  registers: [register]
});

const liquidityGauge = new promClient.Gauge({
  name: 'swappiq_liquidity_utilization',
  help: 'Liquidity utilization percentage',
  labelNames: ['trading_pair'],
  registers: [register]
});

const userRetentionGauge = new promClient.Gauge({
  name: 'swappiq_user_retention_rate',
  help: 'User retention rate percentage',
  labelNames: ['period'],
  registers: [register]
});

const averageTradeSize = new promClient.Gauge({
  name: 'swappiq_average_trade_size_usd',
  help: 'Average trade size in USD',
  labelNames: ['trading_pair', 'period'],
  registers: [register]
});

const marketShareGauge = new promClient.Gauge({
  name: 'swappiq_market_share_percentage',
  help: 'Market share percentage by trading pair',
  labelNames: ['trading_pair'],
  registers: [register]
});

const slippageGauge = new promClient.Gauge({
  name: 'swappiq_average_slippage_bps',
  help: 'Average slippage in basis points',
  labelNames: ['trading_pair', 'trade_size_category'],
  registers: [register]
});

const arbitrageOpportunities = new promClient.Gauge({
  name: 'swappiq_arbitrage_opportunities',
  help: 'Number of arbitrage opportunities detected',
  labelNames: ['trading_pair'],
  registers: [register]
});

// Counter metrics
const tradesCounter = new promClient.Counter({
  name: 'swappiq_trades_total',
  help: 'Total number of trades executed',
  labelNames: ['trading_pair', 'side', 'order_type'],
  registers: [register]
});

const ordersCounter = new promClient.Counter({
  name: 'swappiq_orders_total',
  help: 'Total number of orders placed',
  labelNames: ['trading_pair', 'side', 'type', 'status'],
  registers: [register]
});

const settlementCounter = new promClient.Counter({
  name: 'swappiq_settlements_total',
  help: 'Total number of settlements',
  labelNames: ['status', 'settlement_type'],
  registers: [register]
});

const userActionCounter = new promClient.Counter({
  name: 'swappiq_user_actions_total',
  help: 'Total user actions',
  labelNames: ['action_type', 'user_tier'],
  registers: [register]
});

// Histogram metrics
const tradeValueHistogram = new promClient.Histogram({
  name: 'swappiq_trade_value_usd_histogram',
  help: 'Distribution of trade values in USD',
  labelNames: ['trading_pair'],
  buckets: [10, 100, 1000, 10000, 100000, 1000000],
  registers: [register]
});

const orderProcessingLatency = new promClient.Histogram({
  name: 'swappiq_order_processing_duration_seconds',
  help: 'Order processing latency in seconds',
  labelNames: ['order_type', 'trading_pair'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
  registers: [register]
});

const settlementLatency = new promClient.Histogram({
  name: 'swappiq_settlement_duration_seconds',
  help: 'Settlement processing latency in seconds',
  labelNames: ['settlement_type'],
  buckets: [1, 5, 10, 30, 60, 300, 600],
  registers: [register]
});

// Add default metrics
promClient.collectDefaultMetrics({ register });

class BusinessMetricsCollector {
  constructor(config) {
    this.config = config;
    this.redis = new Redis(config.redis);
    this.db = new Pool(config.database);
    this.app = express();
    this.wsConnections = new Set();
    
    this.setupRoutes();
    this.startMetricsCollection();
    this.setupWebSocketServer();
  }

  setupRoutes() {
    // Prometheus metrics endpoint
    this.app.get('/metrics', async (req, res) => {
      try {
        res.set('Content-Type', register.contentType);
        res.end(await register.metrics());
      } catch (error) {
        res.status(500).end(error.message);
      }
    });

    // Business metrics endpoint
    this.app.get('/business-metrics', async (req, res) => {
      try {
        const metrics = await this.getBusinessMetrics();
        res.json(metrics);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ status: 'healthy', timestamp: new Date().toISOString() });
    });

    // Real-time metrics WebSocket endpoint
    this.app.get('/ws-metrics', (req, res) => {
      res.json({ 
        message: 'WebSocket metrics available at ws://host:port/ws',
        connections: this.wsConnections.size
      });
    });
  }

  setupWebSocketServer() {
    const wss = new WebSocket.Server({ port: this.config.websocketPort || 8091 });
    
    wss.on('connection', (ws) => {
      this.wsConnections.add(ws);
      console.log(`WebSocket connected. Total connections: ${this.wsConnections.size}`);
      
      // Send initial metrics
      this.sendMetricsToWebSocket(ws);
      
      ws.on('close', () => {
        this.wsConnections.delete(ws);
        console.log(`WebSocket disconnected. Total connections: ${this.wsConnections.size}`);
      });
      
      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        this.wsConnections.delete(ws);
      });
    });
  }

  async sendMetricsToWebSocket(ws) {
    try {
      const metrics = await this.getBusinessMetrics();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'metrics_update',
          timestamp: new Date().toISOString(),
          data: metrics
        }));
      }
    } catch (error) {
      console.error('Error sending WebSocket metrics:', error);
    }
  }

  async broadcastMetrics() {
    const metrics = await this.getBusinessMetrics();
    const message = JSON.stringify({
      type: 'metrics_update',
      timestamp: new Date().toISOString(),
      data: metrics
    });

    this.wsConnections.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      } else {
        this.wsConnections.delete(ws);
      }
    });
  }

  startMetricsCollection() {
    // Collect metrics every 30 seconds
    setInterval(() => {
      this.collectTradingMetrics().catch(console.error);
    }, 30000);

    // Collect user metrics every minute
    setInterval(() => {
      this.collectUserMetrics().catch(console.error);
    }, 60000);

    // Collect liquidity metrics every 15 seconds
    setInterval(() => {
      this.collectLiquidityMetrics().catch(console.error);
    }, 15000);

    // Collect revenue metrics every 5 minutes
    setInterval(() => {
      this.collectRevenueMetrics().catch(console.error);
    }, 300000);

    // Broadcast real-time metrics every 10 seconds
    setInterval(() => {
      this.broadcastMetrics().catch(console.error);
    }, 10000);

    console.log('Business metrics collection started');
  }

  async collectTradingMetrics() {
    try {
      // Trading volume by pair (last hour)
      const volumeQuery = `
        SELECT 
          trading_pair,
          SUM(quantity * price) as volume_usd
        FROM trades 
        WHERE created_at > NOW() - INTERVAL '1 hour'
        GROUP BY trading_pair
      `;
      
      const volumeResult = await this.db.query(volumeQuery);
      volumeResult.rows.forEach(row => {
        tradingVolumeGauge
          .labels(row.trading_pair, '1h')
          .set(parseFloat(row.volume_usd) || 0);
      });

      // Trading volume (24h)
      const volume24hQuery = `
        SELECT 
          trading_pair,
          SUM(quantity * price) as volume_usd
        FROM trades 
        WHERE created_at > NOW() - INTERVAL '24 hours'
        GROUP BY trading_pair
      `;
      
      const volume24hResult = await this.db.query(volume24hQuery);
      volume24hResult.rows.forEach(row => {
        tradingVolumeGauge
          .labels(row.trading_pair, '24h')
          .set(parseFloat(row.volume_usd) || 0);
      });

      // Average trade size
      const avgTradeQuery = `
        SELECT 
          trading_pair,
          AVG(quantity * price) as avg_trade_size
        FROM trades 
        WHERE created_at > NOW() - INTERVAL '1 hour'
        GROUP BY trading_pair
      `;
      
      const avgTradeResult = await this.db.query(avgTradeQuery);
      avgTradeResult.rows.forEach(row => {
        averageTradeSize
          .labels(row.trading_pair, '1h')
          .set(parseFloat(row.avg_trade_size) || 0);
      });

      // Trade count and value distribution
      const tradeStatsQuery = `
        SELECT 
          trading_pair,
          side,
          order_type,
          COUNT(*) as trade_count,
          quantity * price as trade_value
        FROM trades 
        WHERE created_at > NOW() - INTERVAL '5 minutes'
        GROUP BY trading_pair, side, order_type, quantity, price
      `;
      
      const tradeStatsResult = await this.db.query(tradeStatsQuery);
      tradeStatsResult.rows.forEach(row => {
        tradesCounter
          .labels(row.trading_pair, row.side, row.order_type)
          .inc(parseInt(row.trade_count));
          
        tradeValueHistogram
          .labels(row.trading_pair)
          .observe(parseFloat(row.trade_value));
      });

      console.log('Trading metrics collected');
    } catch (error) {
      console.error('Error collecting trading metrics:', error);
    }
  }

  async collectUserMetrics() {
    try {
      // Active users (1h, 24h, 7d)
      const activeUsersQueries = [
        { period: '1h', interval: '1 hour' },
        { period: '24h', interval: '24 hours' },
        { period: '7d', interval: '7 days' }
      ];

      for (const { period, interval } of activeUsersQueries) {
        const query = `
          SELECT COUNT(DISTINCT user_id) as active_users
          FROM user_activities 
          WHERE created_at > NOW() - INTERVAL '${interval}'
        `;
        
        const result = await this.db.query(query);
        const activeUsers = parseInt(result.rows[0]?.active_users) || 0;
        
        activeUsersGauge.labels(period).set(activeUsers);
      }

      // User retention rate
      const retentionQuery = `
        SELECT 
          (COUNT(DISTINCT returning_users.user_id)::float / 
           COUNT(DISTINCT all_users.user_id)) * 100 as retention_rate
        FROM (
          SELECT DISTINCT user_id 
          FROM user_activities 
          WHERE created_at > NOW() - INTERVAL '7 days'
        ) all_users
        LEFT JOIN (
          SELECT DISTINCT user_id 
          FROM user_activities 
          WHERE created_at > NOW() - INTERVAL '7 days'
          AND user_id IN (
            SELECT DISTINCT user_id 
            FROM user_activities 
            WHERE created_at BETWEEN NOW() - INTERVAL '14 days' AND NOW() - INTERVAL '7 days'
          )
        ) returning_users ON all_users.user_id = returning_users.user_id
      `;
      
      const retentionResult = await this.db.query(retentionQuery);
      const retentionRate = parseFloat(retentionResult.rows[0]?.retention_rate) || 0;
      
      userRetentionGauge.labels('7d').set(retentionRate);

      // User actions
      const userActionsQuery = `
        SELECT 
          action_type,
          user_tier,
          COUNT(*) as action_count
        FROM user_activities ua
        JOIN users u ON ua.user_id = u.id
        WHERE ua.created_at > NOW() - INTERVAL '5 minutes'
        GROUP BY action_type, user_tier
      `;
      
      const userActionsResult = await this.db.query(userActionsQuery);
      userActionsResult.rows.forEach(row => {
        userActionCounter
          .labels(row.action_type, row.user_tier)
          .inc(parseInt(row.action_count));
      });

      console.log('User metrics collected');
    } catch (error) {
      console.error('Error collecting user metrics:', error);
    }
  }

  async collectLiquidityMetrics() {
    try {
      // Order book depth
      const depthQuery = `
        SELECT 
          trading_pair,
          side,
          SUM(quantity * price) as depth_usd
        FROM order_book 
        WHERE status = 'active'
        GROUP BY trading_pair, side
      `;
      
      const depthResult = await this.db.query(depthQuery);
      depthResult.rows.forEach(row => {
        orderBookDepthGauge
          .labels(row.trading_pair, row.side)
          .set(parseFloat(row.depth_usd) || 0);
      });

      // Liquidity utilization
      const liquidityQuery = `
        SELECT 
          trading_pair,
          (SUM(CASE WHEN status = 'filled' THEN quantity * price ELSE 0 END) / 
           SUM(quantity * price)) * 100 as utilization_rate
        FROM orders 
        WHERE created_at > NOW() - INTERVAL '1 hour'
        GROUP BY trading_pair
      `;
      
      const liquidityResult = await this.db.query(liquidityQuery);
      liquidityResult.rows.forEach(row => {
        liquidityGauge
          .labels(row.trading_pair)
          .set(parseFloat(row.utilization_rate) || 0);
      });

      // Average slippage
      const slippageQuery = `
        SELECT 
          trading_pair,
          CASE 
            WHEN quantity * price < 1000 THEN 'small'
            WHEN quantity * price < 10000 THEN 'medium'
            ELSE 'large'
          END as trade_size_category,
          AVG(ABS(executed_price - market_price) / market_price * 10000) as avg_slippage_bps
        FROM trades 
        WHERE created_at > NOW() - INTERVAL '1 hour'
        AND market_price > 0
        GROUP BY trading_pair, trade_size_category
      `;
      
      const slippageResult = await this.db.query(slippageQuery);
      slippageResult.rows.forEach(row => {
        slippageGauge
          .labels(row.trading_pair, row.trade_size_category)
          .set(parseFloat(row.avg_slippage_bps) || 0);
      });

      console.log('Liquidity metrics collected');
    } catch (error) {
      console.error('Error collecting liquidity metrics:', error);
    }
  }

  async collectRevenueMetrics() {
    try {
      // Fee revenue by type and period
      const revenueQueries = [
        { period: '1h', interval: '1 hour' },
        { period: '24h', interval: '24 hours' },
        { period: '7d', interval: '7 days' }
      ];

      for (const { period, interval } of revenueQueries) {
        const query = `
          SELECT 
            fee_type,
            SUM(fee_amount_usd) as revenue
          FROM fees 
          WHERE created_at > NOW() - INTERVAL '${interval}'
          GROUP BY fee_type
        `;
        
        const result = await this.db.query(query);
        result.rows.forEach(row => {
          revenueGauge
            .labels(period, row.fee_type)
            .set(parseFloat(row.revenue) || 0);
        });
      }

      console.log('Revenue metrics collected');
    } catch (error) {
      console.error('Error collecting revenue metrics:', error);
    }
  }

  async getBusinessMetrics() {
    try {
      // Get current metrics from Prometheus registry
      const metricsString = await register.metrics();
      
      // Parse and structure the metrics
      const metrics = {
        timestamp: new Date().toISOString(),
        trading: {
          volume_24h: await this.getMetricValue('swappiq_trading_volume_usd', { period: '24h' }),
          volume_1h: await this.getMetricValue('swappiq_trading_volume_usd', { period: '1h' }),
          trades_1h: await this.getMetricValue('swappiq_trades_total'),
          active_pairs: await this.getActiveTradingPairs()
        },
        users: {
          active_1h: await this.getMetricValue('swappiq_active_users', { period: '1h' }),
          active_24h: await this.getMetricValue('swappiq_active_users', { period: '24h' }),
          retention_7d: await this.getMetricValue('swappiq_user_retention_rate', { period: '7d' })
        },
        revenue: {
          total_24h: await this.getMetricValue('swappiq_fee_revenue_usd', { period: '24h' }),
          trading_fees: await this.getMetricValue('swappiq_fee_revenue_usd', { fee_type: 'trading' }),
          withdrawal_fees: await this.getMetricValue('swappiq_fee_revenue_usd', { fee_type: 'withdrawal' })
        },
        liquidity: {
          total_depth: await this.getTotalOrderBookDepth(),
          utilization: await this.getAverageLiquidityUtilization(),
          slippage: await this.getAverageSlippage()
        },
        performance: {
          avg_response_time: await this.getMetricValue('swappiq_http_request_duration_seconds'),
          error_rate: await this.getErrorRate(),
          uptime: await this.getServiceUptime()
        }
      };

      return metrics;
    } catch (error) {
      console.error('Error getting business metrics:', error);
      throw error;
    }
  }

  async getMetricValue(metricName, labels = {}) {
    try {
      const metric = register.getSingleMetric(metricName);
      if (!metric) return 0;

      const values = await metric.get();
      if (!values.values || values.values.length === 0) return 0;

      // Find matching metric with labels
      const matchingValue = values.values.find(value => {
        return Object.entries(labels).every(([key, val]) => value.labels[key] === val);
      });

      return matchingValue ? matchingValue.value : values.values[0].value;
    } catch (error) {
      console.error(`Error getting metric ${metricName}:`, error);
      return 0;
    }
  }

  async getActiveTradingPairs() {
    try {
      const query = `
        SELECT COUNT(DISTINCT trading_pair) as active_pairs
        FROM trades 
        WHERE created_at > NOW() - INTERVAL '24 hours'
      `;
      
      const result = await this.db.query(query);
      return parseInt(result.rows[0]?.active_pairs) || 0;
    } catch (error) {
      console.error('Error getting active trading pairs:', error);
      return 0;
    }
  }

  async getTotalOrderBookDepth() {
    try {
      const query = `
        SELECT SUM(quantity * price) as total_depth
        FROM order_book 
        WHERE status = 'active'
      `;
      
      const result = await this.db.query(query);
      return parseFloat(result.rows[0]?.total_depth) || 0;
    } catch (error) {
      console.error('Error getting total order book depth:', error);
      return 0;
    }
  }

  async getAverageLiquidityUtilization() {
    try {
      const metric = register.getSingleMetric('swappiq_liquidity_utilization');
      if (!metric) return 0;

      const values = await metric.get();
      if (!values.values || values.values.length === 0) return 0;

      const sum = values.values.reduce((acc, val) => acc + val.value, 0);
      return sum / values.values.length;
    } catch (error) {
      console.error('Error getting average liquidity utilization:', error);
      return 0;
    }
  }

  async getAverageSlippage() {
    try {
      const metric = register.getSingleMetric('swappiq_average_slippage_bps');
      if (!metric) return 0;

      const values = await metric.get();
      if (!values.values || values.values.length === 0) return 0;

      const sum = values.values.reduce((acc, val) => acc + val.value, 0);
      return sum / values.values.length;
    } catch (error) {
      console.error('Error getting average slippage:', error);
      return 0;
    }
  }

  async getErrorRate() {
    try {
      // Calculate error rate from HTTP request metrics
      const totalRequests = await this.getMetricValue('swappiq_http_requests_total');
      const errorRequests = await this.getMetricValue('swappiq_http_requests_total', { status: '5xx' });
      
      return totalRequests > 0 ? (errorRequests / totalRequests) * 100 : 0;
    } catch (error) {
      console.error('Error calculating error rate:', error);
      return 0;
    }
  }

  async getServiceUptime() {
    try {
      const uptimeMetric = register.getSingleMetric('process_uptime_seconds');
      if (!uptimeMetric) return 0;

      const values = await uptimeMetric.get();
      return values.values?.[0]?.value || 0;
    } catch (error) {
      console.error('Error getting service uptime:', error);
      return 0;
    }
  }

  start() {
    const port = this.config.port || 8090;
    this.app.listen(port, () => {
      console.log(`Business metrics collector started on port ${port}`);
      console.log(`Metrics endpoint: http://localhost:${port}/metrics`);
      console.log(`Business metrics: http://localhost:${port}/business-metrics`);
      console.log(`WebSocket metrics: ws://localhost:${this.config.websocketPort || 8091}/ws`);
    });
  }
}

// Configuration
const config = {
  port: process.env.METRICS_PORT || 8090,
  websocketPort: process.env.WS_METRICS_PORT || 8091,
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD,
    db: process.env.REDIS_DB || 0
  },
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'swappiq',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000
  }
};

// Start the collector
if (require.main === module) {
  const collector = new BusinessMetricsCollector(config);
  collector.start();
}

module.exports = BusinessMetricsCollector;