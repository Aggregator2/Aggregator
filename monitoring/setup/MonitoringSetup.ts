import { PrometheusMetricsExporter } from '../prometheus/PrometheusMetricsExporter';
import { SLAMonitor, defaultSLAConfig, SLAConfig } from '../sla/SLAMonitor';
import { AlertManager, AlertConfig } from '../alerting/AlertManager';
import { ReportGenerator, ReportConfig } from '../reporting/ReportGenerator';
import { MetricsStreamer, StreamConfig } from '../realtime/MetricsStreamer';
import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface MonitoringConfig {
  prometheus: {
    port: number;
    retention: string;
  };
  grafana: {
    port: number;
    adminPassword: string;
    datasources: {
      name: string;
      url: string;
    }[];
  };
  sla: SLAConfig;
  alerting: AlertConfig;
  reporting: ReportConfig;
  streaming: StreamConfig;
  docker: boolean;
}

export class MonitoringSetup {
  private config: MonitoringConfig;
  private metricsExporter?: PrometheusMetricsExporter;
  private slaMonitor?: SLAMonitor;
  private alertManager?: AlertManager;
  private reportGenerator?: ReportGenerator;
  private metricsStreamer?: MetricsStreamer;

  constructor(config: MonitoringConfig) {
    this.config = config;
  }

  async setup(): Promise<void> {
    console.log('🚀 Setting up monitoring infrastructure...');
    
    try {
      // 1. Setup directories
      await this.setupDirectories();
      
      // 2. Initialize Prometheus exporter
      await this.setupPrometheusExporter();
      
      // 3. Initialize SLA monitor
      await this.setupSLAMonitor();
      
      // 4. Initialize alert manager
      await this.setupAlertManager();
      
      // 5. Initialize report generator
      await this.setupReportGenerator();
      
      // 6. Initialize metrics streamer
      await this.setupMetricsStreamer();
      
      // 7. Setup external services if using Docker
      if (this.config.docker) {
        await this.setupDockerServices();
      }
      
      // 8. Import Grafana dashboards
      await this.importGrafanaDashboards();
      
      // 9. Connect all components
      await this.connectComponents();
      
      console.log('✅ Monitoring infrastructure setup complete!');
      
      // Print access information
      this.printAccessInfo();
      
    } catch (error) {
      console.error('❌ Error setting up monitoring infrastructure:', error);
      throw error;
    }
  }

  private async setupDirectories(): Promise<void> {
    const dirs = [
      '/workspace/monitoring/data/prometheus',
      '/workspace/monitoring/data/grafana',
      '/workspace/monitoring/logs',
      '/workspace/monitoring/reports',
      '/workspace/monitoring/config',
    ];
    
    for (const dir of dirs) {
      await fs.mkdir(dir, { recursive: true });
    }
    console.log('✅ Created monitoring directories');
  }

  private async setupPrometheusExporter(): Promise<void> {
    this.metricsExporter = new PrometheusMetricsExporter(this.config.prometheus.port);
    await this.metricsExporter.start();
    console.log(`✅ Prometheus exporter started on port ${this.config.prometheus.port}`);
  }

  private async setupSLAMonitor(): Promise<void> {
    this.slaMonitor = new SLAMonitor(
      this.config.sla || defaultSLAConfig,
      this.metricsExporter!
    );
    this.slaMonitor.start();
    console.log('✅ SLA monitor started');
  }

  private async setupAlertManager(): Promise<void> {
    this.alertManager = new AlertManager(this.config.alerting);
    
    // Connect SLA violations to alert manager
    this.slaMonitor!.on('violation', (violation) => {
      this.alertManager!.createAlertFromSLAViolation(violation);
    });
    
    console.log('✅ Alert manager configured');
  }

  private async setupReportGenerator(): Promise<void> {
    this.reportGenerator = new ReportGenerator(
      this.config.reporting,
      this.metricsExporter!,
      this.slaMonitor!
    );
    console.log('✅ Report generator initialized');
  }

  private async setupMetricsStreamer(): Promise<void> {
    this.metricsStreamer = new MetricsStreamer(
      this.config.streaming,
      this.metricsExporter!,
      this.slaMonitor!
    );
    await this.metricsStreamer.start();
    console.log(`✅ Metrics streaming started on port ${this.config.streaming.port}`);
  }

  private async setupDockerServices(): Promise<void> {
    console.log('🐳 Setting up Docker services...');
    
    // Generate docker-compose.yml
    const dockerCompose = this.generateDockerCompose();
    await fs.writeFile('/workspace/monitoring/docker-compose.yml', dockerCompose);
    
    // Generate Prometheus config
    const prometheusConfig = this.generatePrometheusConfig();
    await fs.writeFile('/workspace/monitoring/config/prometheus.yml', prometheusConfig);
    
    // Generate Grafana provisioning config
    await this.generateGrafanaProvisioning();
    
    // Start services
    console.log('Starting Docker services...');
    await execAsync('cd /workspace/monitoring && docker-compose up -d');
    
    // Wait for services to be ready
    await this.waitForServices();
    
    console.log('✅ Docker services started');
  }

  private generateDockerCompose(): string {
    return `version: '3.8'

services:
  prometheus:
    image: prom/prometheus:latest
    ports:
      - "${this.config.prometheus.port}:9090"
    volumes:
      - ./config/prometheus.yml:/etc/prometheus/prometheus.yml
      - ./data/prometheus:/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'
      - '--storage.tsdb.retention.time=${this.config.prometheus.retention}'
      - '--web.enable-lifecycle'
    restart: unless-stopped

  grafana:
    image: grafana/grafana:latest
    ports:
      - "${this.config.grafana.port}:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=${this.config.grafana.adminPassword}
      - GF_USERS_ALLOW_SIGN_UP=false
    volumes:
      - ./data/grafana:/var/lib/grafana
      - ./config/grafana/provisioning:/etc/grafana/provisioning
    restart: unless-stopped

  node-exporter:
    image: prom/node-exporter:latest
    ports:
      - "9100:9100"
    volumes:
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro
      - /:/rootfs:ro
    command:
      - '--path.procfs=/host/proc'
      - '--path.sysfs=/host/sys'
      - '--collector.filesystem.mount-points-exclude=^/(sys|proc|dev|host|etc)($$|/)'
    restart: unless-stopped

networks:
  default:
    name: monitoring-network
`;
  }

  private generatePrometheusConfig(): string {
    return `global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'trading-system'
    static_configs:
      - targets: ['host.docker.internal:${this.config.prometheus.port}']
        labels:
          service: 'trading-api'

  - job_name: 'node-exporter'
    static_configs:
      - targets: ['node-exporter:9100']
        labels:
          service: 'node-metrics'

  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9090']
        labels:
          service: 'prometheus'

  - job_name: 'grafana'
    static_configs:
      - targets: ['grafana:3000']
        labels:
          service: 'grafana'
`;
  }

  private async generateGrafanaProvisioning(): Promise<void> {
    // Create provisioning directories
    const provisioningDirs = [
      '/workspace/monitoring/config/grafana/provisioning/datasources',
      '/workspace/monitoring/config/grafana/provisioning/dashboards',
      '/workspace/monitoring/config/grafana/provisioning/notifiers',
    ];
    
    for (const dir of provisioningDirs) {
      await fs.mkdir(dir, { recursive: true });
    }
    
    // Datasource provisioning
    const datasourceConfig = `apiVersion: 1

datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
    editable: true
`;
    
    await fs.writeFile(
      '/workspace/monitoring/config/grafana/provisioning/datasources/prometheus.yml',
      datasourceConfig
    );
    
    // Dashboard provisioning
    const dashboardConfig = `apiVersion: 1

providers:
  - name: 'Trading System Dashboards'
    orgId: 1
    folder: ''
    type: file
    disableDeletion: false
    updateIntervalSeconds: 10
    options:
      path: /etc/grafana/provisioning/dashboards
`;
    
    await fs.writeFile(
      '/workspace/monitoring/config/grafana/provisioning/dashboards/default.yml',
      dashboardConfig
    );
  }

  private async waitForServices(): Promise<void> {
    console.log('⏳ Waiting for services to be ready...');
    
    const maxRetries = 30;
    const retryDelay = 2000;
    
    // Wait for Prometheus
    for (let i = 0; i < maxRetries; i++) {
      try {
        await fetch(`http://localhost:${this.config.prometheus.port}/-/ready`);
        console.log('✅ Prometheus is ready');
        break;
      } catch (error) {
        if (i === maxRetries - 1) throw new Error('Prometheus failed to start');
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }
    
    // Wait for Grafana
    for (let i = 0; i < maxRetries; i++) {
      try {
        await fetch(`http://localhost:${this.config.grafana.port}/api/health`);
        console.log('✅ Grafana is ready');
        break;
      } catch (error) {
        if (i === maxRetries - 1) throw new Error('Grafana failed to start');
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }
  }

  private async importGrafanaDashboards(): Promise<void> {
    if (!this.config.docker) {
      console.log('⚠️  Skipping Grafana dashboard import (Docker not enabled)');
      return;
    }
    
    console.log('📊 Importing Grafana dashboards...');
    
    // Copy dashboard files to provisioning directory
    const dashboardFiles = [
      'trading-system-overview.json',
      'websocket-performance.json',
      'order-processing.json',
      'sla-compliance.json',
    ];
    
    for (const file of dashboardFiles) {
      const sourcePath = path.join('/workspace/monitoring/grafana/dashboards', file);
      const destPath = path.join('/workspace/monitoring/config/grafana/provisioning/dashboards', file);
      
      try {
        await fs.copyFile(sourcePath, destPath);
        console.log(`✅ Imported dashboard: ${file}`);
      } catch (error) {
        console.warn(`⚠️  Dashboard not found: ${file}`);
      }
    }
  }

  private async connectComponents(): Promise<void> {
    console.log('🔗 Connecting monitoring components...');
    
    // Setup metric collection
    this.setupMetricCollection();
    
    // Setup event handlers
    this.setupEventHandlers();
    
    console.log('✅ Components connected');
  }

  private setupMetricCollection(): void {
    // Collect system metrics every second
    setInterval(() => {
      const cpuUsage = process.cpuUsage();
      const memUsage = process.memoryUsage();
      
      this.metricsExporter!.updateSystemMetrics({
        cpuUsage: (cpuUsage.user + cpuUsage.system) / 1000000,
        memoryUsage: memUsage,
        eventLoopLag: 0, // Would measure actual lag
      });
      
      // Check system SLAs
      this.slaMonitor!.checkSystemMetrics({
        cpuUsage: (cpuUsage.user + cpuUsage.system) / 1000000 / 100,
        memoryUsage: memUsage.heapUsed / 1024 / 1024,
        eventLoopLag: 0,
      });
    }, 1000);
  }

  private setupEventHandlers(): void {
    // Handle alerts
    this.alertManager!.on('alert-created', (alert) => {
      console.log(`🚨 Alert created: ${alert.title}`);
    });
    
    // Handle SLA reports
    this.slaMonitor!.on('report', (report) => {
      console.log(`📊 SLA Report: ${report.compliance.toFixed(2)}% compliance`);
    });
    
    // Handle metric streaming connections
    this.metricsStreamer!.on('client-connected', (client) => {
      console.log(`📡 Streaming client connected: ${client.clientId}`);
    });
  }

  private printAccessInfo(): void {
    console.log('\n📋 Monitoring Infrastructure Access Information:');
    console.log('================================================');
    console.log(`Prometheus Metrics: http://localhost:${this.config.prometheus.port}/metrics`);
    console.log(`Prometheus UI: http://localhost:${this.config.prometheus.port}`);
    console.log(`Grafana UI: http://localhost:${this.config.grafana.port}`);
    console.log(`  Username: admin`);
    console.log(`  Password: ${this.config.grafana.adminPassword}`);
    console.log(`Metrics Streaming WebSocket: ws://localhost:${this.config.streaming.port}`);
    console.log(`Reports Directory: /workspace/monitoring/reports`);
    console.log('================================================\n');
  }

  async stop(): Promise<void> {
    console.log('🛑 Stopping monitoring infrastructure...');
    
    if (this.metricsStreamer) {
      this.metricsStreamer.stop();
    }
    
    if (this.reportGenerator) {
      this.reportGenerator.stop();
    }
    
    if (this.alertManager) {
      this.alertManager.stop();
    }
    
    if (this.slaMonitor) {
      this.slaMonitor.stop();
    }
    
    if (this.metricsExporter) {
      this.metricsExporter.stop();
    }
    
    if (this.config.docker) {
      await execAsync('cd /workspace/monitoring && docker-compose down');
    }
    
    console.log('✅ Monitoring infrastructure stopped');
  }
}

// Example configuration
export const defaultMonitoringConfig: MonitoringConfig = {
  prometheus: {
    port: 9090,
    retention: '15d',
  },
  grafana: {
    port: 3000,
    adminPassword: 'admin123',
    datasources: [
      {
        name: 'Prometheus',
        url: 'http://prometheus:9090',
      },
    ],
  },
  sla: defaultSLAConfig,
  alerting: {
    email: {
      enabled: false,
      smtp: {
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        auth: {
          user: '',
          pass: '',
        },
      },
      recipients: [],
      from: 'alerts@trading-system.com',
    },
    slack: {
      enabled: false,
      webhookUrl: '',
      channel: '#alerts',
    },
    pagerduty: {
      enabled: false,
      integrationKey: '',
      serviceId: '',
    },
    webhook: {
      enabled: false,
      url: '',
    },
    thresholds: {
      criticalDelay: 300,
      aggregationWindow: 60,
      maxAlertsPerWindow: 10,
    },
  },
  reporting: {
    outputFormats: ['html', 'pdf', 'json'],
    outputDirectory: '/workspace/monitoring/reports',
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
  streaming: {
    port: 8080,
    authEnabled: false,
    maxConnections: 1000,
    heartbeatInterval: 30000,
    metrics: {
      websocket: true,
      orders: true,
      trades: true,
      system: true,
      sla: true,
    },
    aggregation: {
      interval: 1000,
      windowSize: 3600,
    },
    compression: false,
  },
  docker: true,
};