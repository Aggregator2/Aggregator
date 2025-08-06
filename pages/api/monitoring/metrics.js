import { getMetricsCollector } from '../../../monitoring/metrics-collector';
import { authMiddleware } from '../../../utils/auth';

export default async function handler(req, res) {
  // Apply authentication for monitoring endpoints
  const authResult = await authMiddleware(req, res);
  if (!authResult) return;

  const metrics = getMetricsCollector();

  if (req.method === 'GET') {
    try {
      const { 
        type = 'snapshot', 
        metric,
        startTime,
        endTime,
        interval,
        aggregation = 'avg'
      } = req.query;

      let response;

      switch (type) {
        case 'snapshot':
          // Get current metrics snapshot
          response = await metrics.getSnapshot();
          break;

        case 'timeseries':
          // Get time series data for specific metric
          if (!metric) {
            return res.status(400).json({ error: 'Metric name required for timeseries' });
          }

          const [metricType, metricName] = metric.split(':');
          response = await metrics.getTimeSeries(
            metricType,
            metricName,
            parseInt(startTime) || Date.now() - 3600000, // Default: last hour
            parseInt(endTime) || Date.now()
          );
          break;

        case 'aggregate':
          // Get aggregated metrics
          if (!metric || !interval) {
            return res.status(400).json({ error: 'Metric and interval required for aggregation' });
          }

          const [aggType, aggName] = metric.split(':');
          response = await metrics.aggregateMetrics(
            aggType,
            aggName,
            parseInt(interval),
            aggregation
          );
          break;

        case 'summary':
          // Get comprehensive summary
          response = await getMetricsSummary();
          break;

        default:
          return res.status(400).json({ error: 'Invalid type parameter' });
      }

      res.status(200).json({
        success: true,
        timestamp: Date.now(),
        data: response
      });

    } catch (error) {
      console.error('Metrics API error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve metrics',
        message: error.message
      });
    }
  } else {
    res.setHeader('Allow', ['GET']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}

async function getMetricsSummary() {
  const metrics = getMetricsCollector();
  const snapshot = await metrics.getSnapshot();

  // Calculate key metrics
  const summary = {
    matching_engine: {
      orderRate: snapshot.gauges['matching_engine.order_rate'] || 0,
      matchRate: snapshot.gauges['matching_engine.match_rate'] || 0,
      activeOrders: snapshot.gauges['matching_engine.active_orders'] || 0,
      efficiency: snapshot.gauges['matching_engine.efficiency'] || 100,
      cpu: snapshot.gauges['matching_engine.cpu_usage'] || 0,
      memory: snapshot.gauges['matching_engine.memory_usage'] || 0
    },
    orderbook: {
      spread: {},
      depth: {},
      pressure: {}
    },
    settlements: {
      pending: snapshot.counters['settlements.pending'] || 0,
      successRate: {
        hourly: snapshot.gauges['settlements.success_rate.hourly'] || 1,
        daily: snapshot.gauges['settlements.success_rate.daily'] || 1
      },
      gasUsage: {
        average: snapshot.gauges['settlements.gas.average'] || 0,
        total: snapshot.counters['settlements.gas.total'] || 0
      }
    },
    gas: {
      prices: {},
      consumption: {},
      costs: {}
    },
    alerts: {
      total: snapshot.counters['suspicious_activity.alerts'] || 0,
      byType: {},
      bySeverity: {}
    },
    performance: {
      benchmarks: {},
      lastRun: snapshot.gauges['performance.last_run'] || 0
    }
  };

  // Populate orderbook metrics for each pair
  const pairs = ['ETH/USDT', 'BTC/USDT', 'SOL/USDT']; // Get from config
  for (const pair of pairs) {
    summary.orderbook.spread[pair] = snapshot.gauges[`orderbook.spread.${pair}`] || 0;
    summary.orderbook.depth[pair] = snapshot.gauges[`orderbook.depth.1%.total.${pair}`] || 0;
    summary.orderbook.pressure[pair] = snapshot.gauges[`orderbook.pressure_score.${pair}`] || 0;
  }

  // Populate gas prices by network
  const networks = ['mainnet', 'arbitrum', 'polygon', 'optimism'];
  for (const network of networks) {
    summary.gas.prices[network] = {
      slow: snapshot.gauges[`gas.price.${network}.slow`] || 0,
      standard: snapshot.gauges[`gas.price.${network}.standard`] || 0,
      fast: snapshot.gauges[`gas.price.${network}.fast`] || 0
    };
  }

  // Populate alert counts
  const alertTypes = ['wash_trading', 'front_running', 'layering', 'spoofing'];
  for (const type of alertTypes) {
    summary.alerts.byType[type] = snapshot.gauges[`suspicious_activity.alerts_by_type.${type}`] || 0;
  }

  const severities = ['low', 'medium', 'high', 'critical'];
  for (const severity of severities) {
    summary.alerts.bySeverity[severity] = snapshot.gauges[`suspicious_activity.alerts_by_severity.${severity}`] || 0;
  }

  // Get benchmark results
  const benchmarks = ['order_matching', 'orderbook_insertion', 'settlement_batch'];
  for (const benchmark of benchmarks) {
    const p95 = snapshot.gauges[`benchmark.${benchmark}.p95`];
    const opsPerSec = snapshot.gauges[`benchmark.${benchmark}.ops_per_second`];
    
    if (p95 !== undefined || opsPerSec !== undefined) {
      summary.performance.benchmarks[benchmark] = {
        p95: p95 || 0,
        opsPerSecond: opsPerSec || 0
      };
    }
  }

  return summary;
}