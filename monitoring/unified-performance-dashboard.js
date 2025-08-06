/**
 * Unified Performance Dashboard
 * Aggregates and displays all performance metrics in a centralized dashboard
 */

const { getMetricsCollector } = require("./metrics-collector");
const EventEmitter = require("events");
const express = require("express");
const http = require("http");
const WebSocket = require("ws");

class UnifiedPerformanceDashboard extends EventEmitter {
  constructor(config = {}) {
    super();
    this.metrics = getMetricsCollector();

    this.config = {
      port: config.port || 3001,
      updateInterval: config.updateInterval || 5000, // 5 seconds
      retentionPeriod: config.retentionPeriod || 3600000, // 1 hour
      // Component monitors
      monitors: {
        matchingEngine: config.matchingEngineMonitor,
        settlement: config.settlementMonitor,
        api: config.apiMonitor,
        database: config.databaseAnalyzer,
        redis: config.redisMonitor,
      },
      // Alert thresholds
      alerts: {
        criticalCount: 5, // Number of critical alerts before escalation
        alertRetention: 3600000, // 1 hour
      },
      ...config,
    };

    // Dashboard state
    this.state = {
      metrics: {
        matchingEngine: {},
        settlement: {},
        api: {},
        database: {},
        redis: {},
        system: {},
      },
      alerts: [],
      performance: {
        overall: "healthy",
        components: {},
      },
      history: {
        matchingLatency: [],
        apiResponseTime: [],
        throughput: [],
        cacheHitRate: [],
        errorRate: [],
      },
    };

    // WebSocket connections
    this.wsClients = new Set();

    this.initialize();
  }

  async initialize() {
    try {
      // Setup web server
      this.setupWebServer();

      // Connect to monitors
      this.connectMonitors();

      // Start metric collection
      this.startMetricCollection();

      // Start alert monitoring
      this.startAlertMonitoring();

      console.log(
        `🎯 Unified Performance Dashboard started on port ${this.config.port}`
      );
    } catch (error) {
      console.error("Failed to initialize Performance Dashboard:", error);
      throw error;
    }
  }

  /**
   * Setup web server and WebSocket
   */
  setupWebServer() {
    this.app = express();
    this.server = http.createServer(this.app);
    this.wss = new WebSocket.Server({ server: this.server });

    // Serve static dashboard
    this.app.use(express.static(__dirname + "/dashboard-ui"));

    // API endpoints
    this.app.get("/api/metrics", (req, res) => {
      res.json(this.getMetricsSummary());
    });

    this.app.get("/api/performance", (req, res) => {
      res.json(this.getPerformanceReport());
    });

    this.app.get("/api/alerts", (req, res) => {
      res.json(this.getActiveAlerts());
    });

    this.app.get("/api/history/:metric", (req, res) => {
      const metric = req.params.metric;
      res.json(this.getMetricHistory(metric));
    });

    this.app.get("/api/recommendations", (req, res) => {
      res.json(this.getOptimizationRecommendations());
    });

    // WebSocket connections
    this.wss.on("connection", (ws) => {
      this.wsClients.add(ws);

      // Send initial state
      ws.send(
        JSON.stringify({
          type: "initial",
          data: this.getMetricsSummary(),
        })
      );

      ws.on("close", () => {
        this.wsClients.delete(ws);
      });
    });

    // Start server
    this.server.listen(this.config.port);
  }

  /**
   * Connect to component monitors
   */
  connectMonitors() {
    const { monitors } = this.config;

    // Connect to Matching Engine Monitor
    if (monitors.matchingEngine) {
      monitors.matchingEngine.on("alert", (alert) => {
        this.handleAlert("matchingEngine", alert);
      });
    }

    // Connect to Settlement Monitor
    if (monitors.settlement) {
      monitors.settlement.on("alert", (alert) => {
        this.handleAlert("settlement", alert);
      });
    }

    // Connect to API Monitor
    if (monitors.api) {
      monitors.api.on("alert", (alert) => {
        this.handleAlert("api", alert);
      });
    }

    // Connect to Database Analyzer
    if (monitors.database) {
      monitors.database.on("alert", (alert) => {
        this.handleAlert("database", alert);
      });

      monitors.database.on("optimization_suggestion", (suggestion) => {
        this.handleOptimizationSuggestion("database", suggestion);
      });
    }

    // Connect to Redis Monitor
    if (monitors.redis) {
      monitors.redis.on("alert", (alert) => {
        this.handleAlert("redis", alert);
      });

      monitors.redis.on("optimization_suggestion", (suggestion) => {
        this.handleOptimizationSuggestion("redis", suggestion);
      });
    }
  }

  /**
   * Start metric collection
   */
  startMetricCollection() {
    this.metricInterval = setInterval(async () => {
      await this.collectAllMetrics();
      this.updatePerformanceStatus();
      this.broadcastMetrics();
    }, this.config.updateInterval);
  }

  /**
   * Collect metrics from all monitors
   */
  async collectAllMetrics() {
    const { monitors } = this.config;
    const now = Date.now();

    // Collect Matching Engine metrics
    if (monitors.matchingEngine) {
      this.state.metrics.matchingEngine = {
        latency: monitors.matchingEngine.getLatencyMetrics(),
        throughput: {
          ordersPerSecond: await this.getMetricValue(
            "matching_engine.order_rate"
          ),
          matchesPerSecond: await this.getMetricValue(
            "matching_engine.match_rate"
          ),
        },
        efficiency: await this.getMetricValue("matching_engine.efficiency"),
      };

      // Update history
      this.updateHistory("matchingLatency", {
        timestamp: now,
        p50: monitors.matchingEngine.latencyStats.p50,
        p95: monitors.matchingEngine.latencyStats.p95,
        p99: monitors.matchingEngine.latencyStats.p99,
      });
    }

    // Collect Settlement metrics
    if (monitors.settlement) {
      const settlementMetrics = monitors.settlement.getThroughputMetrics();
      this.state.metrics.settlement = {
        throughput: settlementMetrics.realtime,
        efficiency: settlementMetrics.efficiency,
        stats: monitors.settlement.getRealtimeStats(),
      };

      // Update throughput history
      this.updateHistory("throughput", {
        timestamp: now,
        ordersPerMinute: settlementMetrics.realtime.ordersPerMinute,
        settlementRate: settlementMetrics.realtime.batchFrequency,
      });
    }

    // Collect API metrics
    if (monitors.api) {
      const apiReport = monitors.api.getPerformanceReport();
      this.state.metrics.api = {
        responseTime: apiReport.percentiles,
        throughput: {
          rps: apiReport.lastMinute.throughput,
          rpm: apiReport.lastMinute.count,
        },
        errorRate: apiReport.lastMinute.errorRate * 100,
        loadStatus: apiReport.loadStatus,
      };

      // Update history
      this.updateHistory("apiResponseTime", {
        timestamp: now,
        p50: apiReport.percentiles.p50,
        p95: apiReport.percentiles.p95,
        p99: apiReport.percentiles.p99,
      });

      this.updateHistory("errorRate", {
        timestamp: now,
        rate: apiReport.lastMinute.errorRate * 100,
      });
    }

    // Collect Database metrics
    if (monitors.database) {
      const dbReport = await monitors.database.getOptimizationReport();
      this.state.metrics.database = {
        queryPerformance: {
          slowQueries: dbReport.summary.slowQueries,
          cacheHitRate: dbReport.summary.cacheHitRate,
          activeConnections: dbReport.summary.activeConnections,
        },
        maintenance: {
          unusedIndexes: dbReport.unusedIndexes.length,
          tablesNeedingVacuum: dbReport.tableMaintenance.length,
        },
      };
    }

    // Collect Redis metrics
    if (monitors.redis) {
      const redisReport = monitors.redis.getCacheReport();
      this.state.metrics.redis = {
        hitRate: redisReport.summary.hitRate,
        responseTime: redisReport.summary.avgResponseTime,
        memory: redisReport.memory,
        operations: redisReport.operations,
      };

      // Update history
      this.updateHistory("cacheHitRate", {
        timestamp: now,
        rate: redisReport.summary.hitRate,
      });
    }

    // Collect system metrics
    await this.collectSystemMetrics();
  }

  /**
   * Collect system-wide metrics
   */
  async collectSystemMetrics() {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    this.state.metrics.system = {
      memory: {
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        external: memUsage.external,
        rss: memUsage.rss,
      },
      cpu: {
        user: cpuUsage.user,
        system: cpuUsage.system,
      },
      uptime: process.uptime(),
    };
  }

  /**
   * Update performance status
   */
  updatePerformanceStatus() {
    const components = {};
    let overallScore = 100;

    // Evaluate Matching Engine
    if (this.state.metrics.matchingEngine?.latency) {
      const latency = this.state.metrics.matchingEngine.latency;
      if (latency.current.p99 > 15) {
        components.matchingEngine = "degraded";
        overallScore -= 20;
      } else if (latency.current.p99 > 10) {
        components.matchingEngine = "warning";
        overallScore -= 10;
      } else {
        components.matchingEngine = "healthy";
      }
    }

    // Evaluate API Performance
    if (this.state.metrics.api?.errorRate !== undefined) {
      if (this.state.metrics.api.errorRate > 5) {
        components.api = "critical";
        overallScore -= 30;
      } else if (this.state.metrics.api.errorRate > 1) {
        components.api = "warning";
        overallScore -= 10;
      } else {
        components.api = "healthy";
      }
    }

    // Evaluate Redis
    if (this.state.metrics.redis?.hitRate !== undefined) {
      if (this.state.metrics.redis.hitRate < 80) {
        components.redis = "degraded";
        overallScore -= 15;
      } else if (this.state.metrics.redis.hitRate < 85) {
        components.redis = "warning";
        overallScore -= 5;
      } else {
        components.redis = "healthy";
      }
    }

    // Determine overall status
    let overall = "healthy";
    if (overallScore < 50) {
      overall = "critical";
    } else if (overallScore < 70) {
      overall = "degraded";
    } else if (overallScore < 90) {
      overall = "warning";
    }

    this.state.performance = {
      overall,
      score: overallScore,
      components,
    };
  }

  /**
   * Handle alerts from monitors
   */
  handleAlert(source, alert) {
    const enhancedAlert = {
      ...alert,
      source,
      timestamp: Date.now(),
      id: `${source}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    };

    // Add to alerts
    this.state.alerts.push(enhancedAlert);

    // Keep only recent alerts
    const cutoff = Date.now() - this.config.alerts.alertRetention;
    this.state.alerts = this.state.alerts.filter((a) => a.timestamp > cutoff);

    // Check for critical alert escalation
    const recentCritical = this.state.alerts.filter(
      (a) => a.severity === "critical" && a.timestamp > Date.now() - 300000 // 5 minutes
    );

    if (recentCritical.length >= this.config.alerts.criticalCount) {
      this.emit("critical_escalation", {
        alertCount: recentCritical.length,
        alerts: recentCritical,
      });
    }

    // Broadcast alert
    this.broadcastAlert(enhancedAlert);
  }

  /**
   * Handle optimization suggestions
   */
  handleOptimizationSuggestion(source, suggestion) {
    // Store suggestion (implementation depends on your storage strategy)
    console.log(`Optimization suggestion from ${source}:`, suggestion);
  }

  /**
   * Update metric history
   */
  updateHistory(metric, data) {
    if (!this.state.history[metric]) {
      this.state.history[metric] = [];
    }

    this.state.history[metric].push(data);

    // Keep only data within retention period
    const cutoff = Date.now() - this.config.retentionPeriod;
    this.state.history[metric] = this.state.history[metric].filter(
      (item) => item.timestamp > cutoff
    );
  }

  /**
   * Broadcast metrics to WebSocket clients
   */
  broadcastMetrics() {
    const data = {
      type: "metrics",
      data: this.getMetricsSummary(),
    };

    const message = JSON.stringify(data);
    this.wsClients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  /**
   * Broadcast alert to WebSocket clients
   */
  broadcastAlert(alert) {
    const data = {
      type: "alert",
      data: alert,
    };

    const message = JSON.stringify(data);
    this.wsClients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  /**
   * Get metrics summary
   */
  getMetricsSummary() {
    return {
      timestamp: Date.now(),
      performance: this.state.performance,
      metrics: this.state.metrics,
      alerts: {
        active: this.state.alerts.filter(
          (a) => a.timestamp > Date.now() - 300000
        ), // Last 5 minutes
        total: this.state.alerts.length,
      },
    };
  }

  /**
   * Get performance report
   */
  getPerformanceReport() {
    return {
      summary: {
        status: this.state.performance.overall,
        score: this.state.performance.score,
        components: this.state.performance.components,
      },
      keyMetrics: {
        matchingLatency:
          this.state.metrics.matchingEngine?.latency?.current?.p99 || 0,
        apiResponseTime: this.state.metrics.api?.responseTime?.p99 || 0,
        settlementThroughput:
          this.state.metrics.settlement?.throughput?.ordersPerMinute || 0,
        cacheHitRate: this.state.metrics.redis?.hitRate || 0,
        errorRate: this.state.metrics.api?.errorRate || 0,
        databaseConnections:
          this.state.metrics.database?.queryPerformance?.activeConnections || 0,
      },
      trends: this.calculateTrends(),
      timestamp: Date.now(),
    };
  }

  /**
   * Calculate performance trends
   */
  calculateTrends() {
    const trends = {};

    // Calculate latency trend
    if (this.state.history.matchingLatency.length > 10) {
      const recent = this.state.history.matchingLatency.slice(-10);
      const older = this.state.history.matchingLatency.slice(-20, -10);

      const recentAvg =
        recent.reduce((sum, item) => sum + item.p99, 0) / recent.length;
      const olderAvg =
        older.reduce((sum, item) => sum + item.p99, 0) / older.length;

      trends.latency = {
        direction: recentAvg > olderAvg ? "increasing" : "decreasing",
        change: ((recentAvg - olderAvg) / olderAvg) * 100,
      };
    }

    // Calculate error rate trend
    if (this.state.history.errorRate.length > 10) {
      const recent = this.state.history.errorRate.slice(-10);
      const older = this.state.history.errorRate.slice(-20, -10);

      const recentAvg =
        recent.reduce((sum, item) => sum + item.rate, 0) / recent.length;
      const olderAvg =
        older.reduce((sum, item) => sum + item.rate, 0) / older.length;

      trends.errorRate = {
        direction: recentAvg > olderAvg ? "increasing" : "decreasing",
        change: recentAvg - olderAvg,
      };
    }

    return trends;
  }

  /**
   * Get active alerts
   */
  getActiveAlerts() {
    return this.state.alerts
      .filter((a) => a.timestamp > Date.now() - 300000) // Last 5 minutes
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Get metric history
   */
  getMetricHistory(metric) {
    return this.state.history[metric] || [];
  }

  /**
   * Get optimization recommendations
   */
  async getOptimizationRecommendations() {
    const recommendations = [];

    // Check matching engine performance
    if (this.state.metrics.matchingEngine?.latency?.current?.p99 > 10) {
      recommendations.push({
        component: "matchingEngine",
        priority: "high",
        issue: "High order matching latency",
        current: `${this.state.metrics.matchingEngine.latency.current.p99}ms`,
        target: "<10ms",
        suggestions: [
          "Optimize order book data structures",
          "Implement order batching",
          "Review matching algorithm efficiency",
        ],
      });
    }

    // Check API performance
    if (this.state.metrics.api?.errorRate > 1) {
      recommendations.push({
        component: "api",
        priority: "critical",
        issue: "High API error rate",
        current: `${this.state.metrics.api.errorRate.toFixed(2)}%`,
        target: "<1%",
        suggestions: [
          "Review error logs for patterns",
          "Implement better error handling",
          "Check for resource constraints",
        ],
      });
    }

    // Check cache performance
    if (this.state.metrics.redis?.hitRate < 85) {
      recommendations.push({
        component: "redis",
        priority: "medium",
        issue: "Low cache hit rate",
        current: `${this.state.metrics.redis.hitRate.toFixed(2)}%`,
        target: ">85%",
        suggestions: [
          "Review cache key strategies",
          "Increase TTL for frequently accessed data",
          "Implement cache warming",
        ],
      });
    }

    return recommendations;
  }

  /**
   * Get metric value from collector
   */
  async getMetricValue(metricName) {
    try {
      const snapshot = await this.metrics.getSnapshot();
      return snapshot.gauges[metricName] || 0;
    } catch (error) {
      console.error(`Failed to get metric ${metricName}:`, error);
      return 0;
    }
  }

  /**
   * Start alert monitoring
   */
  startAlertMonitoring() {
    // Monitor for sustained issues
    this.alertMonitorInterval = setInterval(() => {
      const criticalAlerts = this.state.alerts.filter(
        (a) => a.severity === "critical" && a.timestamp > Date.now() - 600000 // 10 minutes
      );

      if (criticalAlerts.length > 10) {
        this.emit("system_degradation", {
          criticalAlertCount: criticalAlerts.length,
          affectedComponents: [...new Set(criticalAlerts.map((a) => a.source))],
          duration: 600000,
        });
      }
    }, 60000); // Check every minute
  }

  /**
   * Generate dashboard HTML
   */
  getDashboardHTML() {
    return `
<!DOCTYPE html>
<html>
<head>
    <title>SwappiQ Performance Dashboard</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 0;
            padding: 20px;
            background: #f5f5f5;
        }
        .dashboard {
            max-width: 1400px;
            margin: 0 auto;
        }
        .header {
            background: white;
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 20px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .metrics-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
            margin-bottom: 20px;
        }
        .metric-card {
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .metric-value {
            font-size: 2em;
            font-weight: bold;
            margin: 10px 0;
        }
        .status-healthy { color: #22c55e; }
        .status-warning { color: #f59e0b; }
        .status-degraded { color: #ef4444; }
        .status-critical { color: #dc2626; }
        .chart-container {
            height: 200px;
            margin-top: 10px;
        }
        .alerts {
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .alert-item {
            padding: 10px;
            margin: 5px 0;
            border-radius: 4px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .alert-critical { background: #fee2e2; }
        .alert-high { background: #fef3c7; }
        .alert-medium { background: #dbeafe; }
        .alert-low { background: #f3f4f6; }
    </style>
</head>
<body>
    <div class="dashboard">
        <div class="header">
            <h1>SwappiQ Performance Dashboard</h1>
            <div id="overall-status"></div>
        </div>
        
        <div class="metrics-grid">
            <div class="metric-card">
                <h3>Order Matching Latency</h3>
                <div id="matching-latency" class="metric-value">--</div>
                <div id="matching-chart" class="chart-container"></div>
            </div>
            
            <div class="metric-card">
                <h3>API Response Time</h3>
                <div id="api-response" class="metric-value">--</div>
                <div id="api-chart" class="chart-container"></div>
            </div>
            
            <div class="metric-card">
                <h3>Settlement Throughput</h3>
                <div id="settlement-throughput" class="metric-value">--</div>
                <div id="settlement-chart" class="chart-container"></div>
            </div>
            
            <div class="metric-card">
                <h3>Cache Hit Rate</h3>
                <div id="cache-hit-rate" class="metric-value">--</div>
                <div id="cache-chart" class="chart-container"></div>
            </div>
            
            <div class="metric-card">
                <h3>Error Rate</h3>
                <div id="error-rate" class="metric-value">--</div>
                <div id="error-chart" class="chart-container"></div>
            </div>
            
            <div class="metric-card">
                <h3>System Health</h3>
                <div id="system-health" class="metric-value">--</div>
                <div id="components-status"></div>
            </div>
        </div>
        
        <div class="alerts">
            <h2>Active Alerts</h2>
            <div id="alerts-container"></div>
        </div>
    </div>
    
    <script>
        const ws = new WebSocket('ws://localhost:${this.config.port}');
        
        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            
            if (data.type === 'metrics' || data.type === 'initial') {
                updateDashboard(data.data);
            } else if (data.type === 'alert') {
                addAlert(data.data);
            }
        };
        
        function updateDashboard(data) {
            // Update overall status
            const statusEl = document.getElementById('overall-status');
            statusEl.className = 'status-' + data.performance.overall;
            statusEl.textContent = 'Overall Status: ' + data.performance.overall.toUpperCase() + 
                                 ' (Score: ' + data.performance.score + '/100)';
            
            // Update metrics
            if (data.metrics.matchingEngine?.latency) {
                document.getElementById('matching-latency').textContent = 
                    data.metrics.matchingEngine.latency.current.p99.toFixed(1) + 'ms';
            }
            
            if (data.metrics.api?.responseTime) {
                document.getElementById('api-response').textContent = 
                    data.metrics.api.responseTime.p99.toFixed(1) + 'ms';
            }
            
            if (data.metrics.settlement?.throughput) {
                document.getElementById('settlement-throughput').textContent = 
                    data.metrics.settlement.throughput.ordersPerMinute + ' orders/min';
            }
            
            if (data.metrics.redis?.hitRate !== undefined) {
                document.getElementById('cache-hit-rate').textContent = 
                    data.metrics.redis.hitRate.toFixed(1) + '%';
            }
            
            if (data.metrics.api?.errorRate !== undefined) {
                document.getElementById('error-rate').textContent = 
                    data.metrics.api.errorRate.toFixed(2) + '%';
            }
            
            // Update component status
            const componentsEl = document.getElementById('components-status');
            componentsEl.innerHTML = Object.entries(data.performance.components || {})
                .map(([component, status]) => 
                    '<div class="status-' + status + '">' + component + ': ' + status + '</div>'
                ).join('');
            
            // Update alerts
            updateAlerts(data.alerts.active);
        }
        
        function updateAlerts(alerts) {
            const container = document.getElementById('alerts-container');
            container.innerHTML = alerts.length === 0 
                ? '<p>No active alerts</p>'
                : alerts.map(alert => 
                    '<div class="alert-item alert-' + alert.severity + '">' +
                    '<div>' +
                    '<strong>' + alert.source + '</strong>: ' + alert.message +
                    '</div>' +
                    '<small>' + new Date(alert.timestamp).toLocaleTimeString() + '</small>' +
                    '</div>'
                  ).join('');
        }
        
        function addAlert(alert) {
            // Add notification for new alerts
            if (alert.severity === 'critical') {
                // Could add browser notification here
                console.error('Critical alert:', alert);
            }
        }
    </script>
</body>
</html>
    `;
  }

  /**
   * Cleanup
   */
  stop() {
    clearInterval(this.metricInterval);
    clearInterval(this.alertMonitorInterval);

    this.wsClients.forEach((client) => client.close());
    this.wss.close();
    this.server.close();

    console.log("🛑 Unified Performance Dashboard stopped");
  }
}

module.exports = UnifiedPerformanceDashboard;
