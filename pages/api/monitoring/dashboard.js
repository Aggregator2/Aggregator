import { authMiddleware } from '../../../utils/auth';
import { getMetricsCollector } from '../../../monitoring/metrics-collector';
import MatchingEngineMonitor from '../../../monitoring/matching-engine-monitor';
import OrderBookVisualizer from '../../../monitoring/orderbook-visualizer';
import SettlementMonitor from '../../../monitoring/settlement-monitor';
import GasTracker from '../../../monitoring/gas-tracker';
import PerformanceBenchmark from '../../../monitoring/performance-benchmark';

// Store instances (in production, use proper state management)
let monitors = {
  matching: null,
  orderbook: null,
  settlement: null,
  gas: null,
  performance: null
};

export default async function handler(req, res) {
  // Apply authentication
  const authResult = await authMiddleware(req, res);
  if (!authResult) return;

  if (req.method === 'GET') {
    try {
      const { view = 'overview', timeRange = 300000 } = req.query; // Default 5 minutes

      let dashboardData;

      switch (view) {
        case 'overview':
          dashboardData = await getOverviewDashboard(timeRange);
          break;

        case 'matching':
          dashboardData = await getMatchingEngineDashboard(timeRange);
          break;

        case 'orderbook':
          dashboardData = await getOrderBookDashboard(timeRange);
          break;

        case 'settlement':
          dashboardData = await getSettlementDashboard(timeRange);
          break;

        case 'gas':
          dashboardData = await getGasDashboard(timeRange);
          break;

        case 'performance':
          dashboardData = await getPerformanceDashboard();
          break;

        case 'security':
          dashboardData = await getSecurityDashboard(timeRange);
          break;

        default:
          return res.status(400).json({ error: 'Invalid view parameter' });
      }

      res.status(200).json({
        success: true,
        timestamp: Date.now(),
        view,
        timeRange,
        data: dashboardData
      });

    } catch (error) {
      console.error('Dashboard API error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve dashboard data',
        message: error.message
      });
    }
  } else {
    res.setHeader('Allow', ['GET']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}

async function getOverviewDashboard(timeRange) {
  const metrics = getMetricsCollector();
  const snapshot = await metrics.getSnapshot();

  // Key metrics across all systems
  const overview = {
    system_health: calculateSystemHealth(snapshot),
    key_metrics: {
      total_orders: snapshot.counters['matching_engine.orders_submitted'] || 0,
      total_matches: snapshot.counters['matching_engine.orders_matched'] || 0,
      total_volume: snapshot.counters['matching_engine.volume_matched'] || 0,
      active_users: await getActiveUserCount(),
      settlement_success_rate: snapshot.gauges['settlements.success_rate.daily'] || 1,
      avg_gas_price: await getAverageGasPrice(),
      system_alerts: snapshot.counters['suspicious_activity.alerts'] || 0
    },
    performance: {
      matching_latency_p95: snapshot.histograms['matching_engine.order_processing_time']?.p95 || 0,
      throughput: snapshot.gauges['matching_engine.order_rate'] || 0,
      cpu_usage: snapshot.gauges['matching_engine.cpu_usage'] || 0,
      memory_usage: snapshot.gauges['matching_engine.memory_usage'] || 0
    },
    trends: await getSystemTrends(timeRange),
    recent_events: await getRecentEvents(50)
  };

  return overview;
}

async function getMatchingEngineDashboard(timeRange) {
  if (!monitors.matching) {
    // Initialize if needed
    return { error: 'Matching engine monitor not initialized' };
  }

  const realtimeStats = await monitors.matching.getRealtimeMetrics();
  const metrics = getMetricsCollector();

  // Get historical data
  const historicalData = await metrics.getTimeSeries(
    'gauge',
    'matching_engine.order_rate',
    Date.now() - timeRange,
    Date.now()
  );

  return {
    realtime: realtimeStats,
    historical: {
      orderRate: historicalData,
      matchRate: await metrics.getTimeSeries('gauge', 'matching_engine.match_rate', Date.now() - timeRange, Date.now()),
      latency: await metrics.getTimeSeries('histogram', 'matching_engine.order_processing_time', Date.now() - timeRange, Date.now())
    },
    pairs: await getPairStatistics(),
    efficiency: await getMatchingEfficiency()
  };
}

async function getOrderBookDashboard(timeRange) {
  if (!monitors.orderbook) {
    return { error: 'Order book visualizer not initialized' };
  }

  const pairs = ['ETH/USDT', 'BTC/USDT', 'SOL/USDT']; // Get from config
  const orderbooks = {};

  for (const pair of pairs) {
    orderbooks[pair] = monitors.orderbook.getVisualizationData(pair, timeRange);
  }

  return {
    orderbooks,
    market_overview: await getMarketOverview(),
    depth_analysis: await getDepthAnalysis(pairs),
    liquidity_metrics: await getLiquidityMetrics(pairs)
  };
}

async function getSettlementDashboard(timeRange) {
  if (!monitors.settlement) {
    return { error: 'Settlement monitor not initialized' };
  }

  const stats = monitors.settlement.getRealtimeStats();
  const history = monitors.settlement.getSettlementHistory(100);

  return {
    current: stats,
    history,
    gas_analysis: await getSettlementGasAnalysis(),
    success_trends: await getSuccessTrends(timeRange),
    pending_settlements: await getPendingSettlements()
  };
}

async function getGasDashboard(timeRange) {
  if (!monitors.gas) {
    monitors.gas = new GasTracker();
  }

  const report = monitors.gas.getGasReport('daily');

  return {
    current_prices: report.prices,
    consumption: report.consumption,
    costs: report.costs,
    recommendations: report.recommendations,
    historical: await getHistoricalGasData(timeRange),
    network_comparison: await getNetworkComparison()
  };
}

async function getPerformanceDashboard() {
  if (!monitors.performance) {
    monitors.performance = new PerformanceBenchmark();
  }

  const report = monitors.performance.generateReport();

  return {
    benchmarks: report.benchmarks,
    comparisons: report.comparisons,
    system_info: report.systemInfo,
    recommendations: getPerformanceRecommendations(report)
  };
}

async function getSecurityDashboard(timeRange) {
  const metrics = getMetricsCollector();
  const snapshot = await metrics.getSnapshot();

  return {
    alert_summary: {
      total: snapshot.counters['suspicious_activity.alerts'] || 0,
      by_type: getAlertsByType(snapshot),
      by_severity: getAlertsBySeverity(snapshot)
    },
    recent_alerts: await getRecentSecurityAlerts(50),
    banned_users: await getBannedUsers(),
    threat_level: calculateThreatLevel(snapshot),
    recommendations: await getSecurityRecommendations()
  };
}

// Helper functions
function calculateSystemHealth(snapshot) {
  let healthScore = 100;

  // Deduct for high CPU usage
  const cpuUsage = snapshot.gauges['matching_engine.cpu_usage'] || 0;
  if (cpuUsage > 80) healthScore -= 20;
  else if (cpuUsage > 60) healthScore -= 10;

  // Deduct for low success rate
  const successRate = snapshot.gauges['settlements.success_rate.hourly'] || 1;
  if (successRate < 0.95) healthScore -= 20;
  else if (successRate < 0.98) healthScore -= 10;

  // Deduct for high alert count
  const alerts = snapshot.counters['suspicious_activity.alerts'] || 0;
  if (alerts > 100) healthScore -= 15;
  else if (alerts > 50) healthScore -= 5;

  return {
    score: Math.max(0, healthScore),
    status: healthScore >= 80 ? 'healthy' : healthScore >= 60 ? 'warning' : 'critical',
    factors: {
      cpu: cpuUsage,
      success_rate: successRate,
      alerts: alerts
    }
  };
}

async function getActiveUserCount() {
  // Implementation would query from database
  return 1234; // Placeholder
}

async function getAverageGasPrice() {
  const metrics = getMetricsCollector();
  const mainnetGas = await metrics.getSnapshot();
  return mainnetGas.gauges['gas.price.mainnet.standard'] || 30;
}

async function getSystemTrends(timeRange) {
  // Implementation would analyze trends
  return {
    order_volume: 'increasing',
    gas_prices: 'stable',
    user_activity: 'increasing',
    settlement_efficiency: 'stable'
  };
}

async function getRecentEvents(limit) {
  // Implementation would fetch recent system events
  return [];
}

async function getPairStatistics() {
  // Implementation would get statistics for each trading pair
  return {};
}

async function getMatchingEfficiency() {
  // Implementation would calculate matching engine efficiency
  return {
    fill_rate: 0.92,
    avg_slippage: 0.1,
    order_to_match_ratio: 0.75
  };
}

async function getMarketOverview() {
  return {
    total_pairs: 3,
    active_orders: 5432,
    total_liquidity: 12500000,
    avg_spread: 0.15
  };
}

async function getDepthAnalysis(pairs) {
  // Implementation would analyze order book depth
  return {};
}

async function getLiquidityMetrics(pairs) {
  // Implementation would calculate liquidity metrics
  return {};
}

async function getSettlementGasAnalysis() {
  return {
    avg_gas_per_settlement: 250000,
    gas_optimization_potential: 0.15,
    recommended_batch_size: 50
  };
}

async function getSuccessTrends(timeRange) {
  return {
    trend: 'stable',
    current_rate: 0.98,
    week_avg: 0.97,
    month_avg: 0.96
  };
}

async function getPendingSettlements() {
  return [];
}

async function getHistoricalGasData(timeRange) {
  return {};
}

async function getNetworkComparison() {
  return {
    mainnet: { avg_cost: 50, speed: 'slow' },
    arbitrum: { avg_cost: 5, speed: 'fast' },
    polygon: { avg_cost: 1, speed: 'fast' },
    optimism: { avg_cost: 3, speed: 'fast' }
  };
}

function getPerformanceRecommendations(report) {
  const recommendations = [];

  // Check for performance regressions
  for (const [test, comparison] of Object.entries(report.comparisons)) {
    if (comparison.regression) {
      recommendations.push({
        type: 'regression',
        test,
        severity: 'high',
        message: `Performance regression detected: ${comparison.time.mean.percent.toFixed(1)}% slower`
      });
    }
  }

  return recommendations;
}

function getAlertsByType(snapshot) {
  const types = {};
  const alertTypes = ['wash_trading', 'front_running', 'layering', 'spoofing'];
  
  for (const type of alertTypes) {
    types[type] = snapshot.gauges[`suspicious_activity.alerts_by_type.${type}`] || 0;
  }
  
  return types;
}

function getAlertsBySeverity(snapshot) {
  const severities = {};
  const levels = ['low', 'medium', 'high', 'critical'];
  
  for (const level of levels) {
    severities[level] = snapshot.gauges[`suspicious_activity.alerts_by_severity.${level}`] || 0;
  }
  
  return severities;
}

async function getRecentSecurityAlerts(limit) {
  // Implementation would fetch recent alerts
  return [];
}

async function getBannedUsers() {
  // Implementation would fetch banned users
  return [];
}

function calculateThreatLevel(snapshot) {
  const criticalAlerts = snapshot.gauges['suspicious_activity.alerts_by_severity.critical'] || 0;
  const highAlerts = snapshot.gauges['suspicious_activity.alerts_by_severity.high'] || 0;
  
  if (criticalAlerts > 0) return 'critical';
  if (highAlerts > 5) return 'high';
  if (highAlerts > 0) return 'medium';
  return 'low';
}

async function getSecurityRecommendations() {
  return [
    {
      type: 'monitoring',
      priority: 'high',
      message: 'Enable real-time alert notifications'
    },
    {
      type: 'configuration',
      priority: 'medium',
      message: 'Review and update suspicious activity thresholds'
    }
  ];
}