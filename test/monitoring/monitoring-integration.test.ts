import { PrometheusMetricsExporter } from '../../monitoring/prometheus/PrometheusMetricsExporter';
import { SLAMonitor, defaultSLAConfig } from '../../monitoring/sla/SLAMonitor';
import { AlertManager } from '../../monitoring/alerting/AlertManager';
import { ReportGenerator } from '../../monitoring/reporting/ReportGenerator';
import { MetricsStreamer } from '../../monitoring/realtime/MetricsStreamer';
import * as WebSocket from 'ws';

describe('Monitoring Integration Tests', () => {
  let metricsExporter: PrometheusMetricsExporter;
  let slaMonitor: SLAMonitor;
  let alertManager: AlertManager;
  let reportGenerator: ReportGenerator;
  let metricsStreamer: MetricsStreamer;

  beforeAll(async () => {
    // Setup components
    metricsExporter = new PrometheusMetricsExporter(9091);
    await metricsExporter.start();

    slaMonitor = new SLAMonitor(defaultSLAConfig, metricsExporter);
    slaMonitor.start();

    alertManager = new AlertManager({
      email: { enabled: false },
      slack: { enabled: false },
      pagerduty: { enabled: false },
      webhook: { enabled: false },
      thresholds: {
        criticalDelay: 300,
        aggregationWindow: 60,
        maxAlertsPerWindow: 10,
      },
    });

    reportGenerator = new ReportGenerator(
      {
        outputFormats: ['json'],
        outputDirectory: '/tmp/test-reports',
        schedule: {
          daily: { hour: 9, minute: 0 },
          weekly: { dayOfWeek: 1, hour: 9, minute: 0 },
          monthly: { dayOfMonth: 1, hour: 9, minute: 0 },
        },
        includeMetrics: {
          websocket: true,
          orders: true,
          trades: true,
          system: true,
          sla: true,
        },
      },
      metricsExporter,
      slaMonitor
    );

    metricsStreamer = new MetricsStreamer(
      {
        port: 8081,
        authEnabled: false,
        maxConnections: 100,
        heartbeatInterval: 5000,
        metrics: {
          websocket: true,
          orders: true,
          trades: true,
          system: true,
          sla: true,
        },
        aggregation: {
          interval: 1000,
          windowSize: 60,
        },
        compression: false,
      },
      metricsExporter,
      slaMonitor
    );
    await metricsStreamer.start();
  });

  afterAll(async () => {
    metricsStreamer.stop();
    reportGenerator.stop();
    alertManager.stop();
    slaMonitor.stop();
    metricsExporter.stop();
  });

  describe('Metrics Collection', () => {
    it('should record WebSocket metrics', async () => {
      // Record various WebSocket metrics
      metricsExporter.recordWebSocketConnection('success');
      metricsExporter.recordWebSocketMessage('in', 'subscribe');
      metricsExporter.recordWebSocketMessage('out', 'orderbook');
      metricsExporter.recordWebSocketLatency('ping', 45);
      
      // Get metrics
      const metrics = await metricsExporter.getCurrentMetrics();
      
      expect(metrics).toContain('websocket_connections_total');
      expect(metrics).toContain('websocket_messages_received_total');
      expect(metrics).toContain('websocket_message_latency_seconds');
    });

    it('should record order processing metrics', async () => {
      // Record order metrics
      metricsExporter.recordOrder('ETH/USDT', 'buy', 'limit', 'executed');
      metricsExporter.recordOrderLatency('ETH/USDT', 'limit', 'executed', 25);
      metricsExporter.recordOrderValue('ETH/USDT', 'buy', 1500);
      
      const metrics = await metricsExporter.getCurrentMetrics();
      
      expect(metrics).toContain('orders_total');
      expect(metrics).toContain('order_processing_latency_seconds');
      expect(metrics).toContain('order_value_usd');
    });

    it('should update system metrics', async () => {
      // Update system metrics
      metricsExporter.updateSystemMetrics({
        cpuUsage: 45.5,
        memoryUsage: process.memoryUsage(),
        eventLoopLag: 15,
      });
      
      const metrics = await metricsExporter.getCurrentMetrics();
      
      expect(metrics).toContain('process_cpu_usage_percent');
      expect(metrics).toContain('process_memory_usage_bytes');
      expect(metrics).toContain('nodejs_event_loop_lag_seconds');
    });
  });

  describe('SLA Monitoring', () => {
    it('should detect WebSocket latency violations', (done) => {
      slaMonitor.once('violation', (violation) => {
        expect(violation.type).toBe('websocket_latency');
        expect(violation.severity).toBe('medium');
        expect(violation.actual).toBe(150);
        done();
      });

      // Trigger violation
      slaMonitor.checkWebSocketLatency(150); // Above default 100ms threshold
    });

    it('should detect system performance violations', (done) => {
      slaMonitor.once('violation', (violation) => {
        expect(violation.type).toBe('cpu_usage');
        expect(violation.severity).toBe('critical');
        done();
      });

      // Trigger CPU violation
      slaMonitor.checkSystemMetrics({
        cpuUsage: 95, // Above 80% threshold
        memoryUsage: 2048,
        eventLoopLag: 50,
      });
    });

    it('should generate SLA reports', () => {
      const report = slaMonitor.generateReport();
      
      expect(report).toHaveProperty('period');
      expect(report).toHaveProperty('compliance');
      expect(report).toHaveProperty('violations');
      expect(report).toHaveProperty('metrics');
      expect(report.violations).toBeInstanceOf(Array);
    });
  });

  describe('Alert Management', () => {
    it('should create alerts from SLA violations', (done) => {
      alertManager.once('alert-created', (alert) => {
        expect(alert.type).toContain('sla_violation');
        expect(alert.severity).toBe('high');
        expect(alert.source).toBe('sla_monitor');
        done();
      });

      // Create SLA violation alert
      alertManager.createAlertFromSLAViolation({
        id: 'test-violation',
        type: 'order_processing',
        severity: 'high',
        metric: 'Order Processing Time',
        threshold: 50,
        actual: 120,
        timestamp: Date.now(),
        message: 'Order processing time exceeded threshold',
      });
    });

    it('should aggregate similar alerts', async () => {
      // Create multiple similar alerts
      for (let i = 0; i < 5; i++) {
        await alertManager.createAlert({
          type: 'high_latency',
          severity: 'medium',
          title: 'High Latency Detected',
          message: `Latency spike ${i}`,
          source: 'test',
        });
      }

      // Wait for aggregation
      await new Promise(resolve => setTimeout(resolve, 1100));

      const stats = alertManager.getAlertStats();
      expect(stats.total).toBeGreaterThanOrEqual(5);
    });

    it('should acknowledge and resolve alerts', () => {
      const alertId = 'test-alert-123';
      
      alertManager.createAlert({
        type: 'test',
        severity: 'low',
        title: 'Test Alert',
        message: 'Test message',
        source: 'test',
      });

      const activeAlerts = alertManager.getActiveAlerts();
      const alert = activeAlerts[activeAlerts.length - 1];

      alertManager.acknowledgeAlert(alert.id, 'test-user');
      expect(alert.acknowledged).toBe(true);
      expect(alert.acknowledgedBy).toBe('test-user');

      alertManager.resolveAlert(alert.id);
      expect(alert.resolved).toBe(true);
    });
  });

  describe('Report Generation', () => {
    it('should generate on-demand reports', async () => {
      const report = await reportGenerator.generateOnDemandReport(1);
      
      expect(report).toHaveProperty('period');
      expect(report).toHaveProperty('summary');
      expect(report).toHaveProperty('sections');
      expect(report).toHaveProperty('recommendations');
      expect(report.summary.overallHealth).toMatch(/healthy|degraded|critical/);
    });

    it('should include all configured sections', async () => {
      const report = await reportGenerator.generateOnDemandReport(1);
      
      expect(report.sections).toHaveProperty('websocket');
      expect(report.sections).toHaveProperty('orders');
      expect(report.sections).toHaveProperty('trades');
      expect(report.sections).toHaveProperty('system');
      expect(report.sections).toHaveProperty('sla');
    });
  });

  describe('Real-time Metrics Streaming', () => {
    it('should accept WebSocket connections', (done) => {
      const ws = new WebSocket('ws://localhost:8081');
      
      ws.on('open', () => {
        done();
        ws.close();
      });
      
      ws.on('error', done);
    });

    it('should send welcome message on connection', (done) => {
      const ws = new WebSocket('ws://localhost:8081');
      
      ws.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'welcome') {
          expect(message).toHaveProperty('clientId');
          expect(message).toHaveProperty('config');
          expect(message.config.availableMetrics).toBeInstanceOf(Array);
          done();
          ws.close();
        }
      });
    });

    it('should stream metrics updates', (done) => {
      const ws = new WebSocket('ws://localhost:8081');
      let receivedUpdate = false;
      
      ws.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'update' && !receivedUpdate) {
          receivedUpdate = true;
          expect(message).toHaveProperty('data');
          expect(message.data).toHaveProperty('timestamp');
          done();
          ws.close();
        }
      });
    });

    it('should handle subscription requests', (done) => {
      const ws = new WebSocket('ws://localhost:8081');
      
      ws.on('open', () => {
        ws.send(JSON.stringify({
          type: 'subscribe',
          metrics: ['websocket', 'orders'],
        }));
      });
      
      ws.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'subscribed') {
          expect(message.metrics).toContain('websocket');
          expect(message.metrics).toContain('orders');
          done();
          ws.close();
        }
      });
    });
  });

  describe('Integration Flow', () => {
    it('should flow from metrics to alerts to reports', async () => {
      // 1. Generate high latency metrics
      for (let i = 0; i < 10; i++) {
        metricsExporter.recordWebSocketLatency('message', 200); // High latency
        slaMonitor.checkWebSocketLatency(200);
      }

      // 2. This should trigger SLA violations
      const violations = slaMonitor.getActiveViolations();
      expect(violations.length).toBeGreaterThan(0);

      // 3. Generate a report
      const report = await reportGenerator.generateOnDemandReport(1);
      
      // 4. Report should reflect the issues
      expect(report.summary.totalViolations).toBeGreaterThan(0);
      expect(report.sections.sla?.violations.length).toBeGreaterThan(0);
      expect(report.recommendations.length).toBeGreaterThan(0);
    });
  });
});