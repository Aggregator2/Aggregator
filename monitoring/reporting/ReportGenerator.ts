import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import { PrometheusMetricsExporter } from '../prometheus/PrometheusMetricsExporter';
import { SLAMonitor, SLAReport, SLAViolation } from '../sla/SLAMonitor';
import * as puppeteer from 'puppeteer';
import * as nodemailer from 'nodemailer';
import { format } from 'date-fns';
import * as Handlebars from 'handlebars';

export interface ReportConfig {
  outputFormats: ('html' | 'pdf' | 'json')[];
  outputDirectory: string;
  emailConfig?: {
    enabled: boolean;
    smtp: {
      host: string;
      port: number;
      secure: boolean;
      auth: {
        user: string;
        pass: string;
      };
    };
    recipients: string[];
    from: string;
  };
  schedule: {
    daily: { hour: number; minute: number };
    weekly: { dayOfWeek: number; hour: number; minute: number };
    monthly: { dayOfMonth: number; hour: number; minute: number };
  };
  includeMetrics: {
    websocket: boolean;
    orders: boolean;
    trades: boolean;
    system: boolean;
    sla: boolean;
  };
  grafanaConfig?: {
    url: string;
    apiKey: string;
    dashboards: string[];
  };
}

export interface ReportData {
  period: { start: Date; end: Date };
  generatedAt: Date;
  summary: {
    overallHealth: 'healthy' | 'degraded' | 'critical';
    slaCompliance: number;
    totalViolations: number;
    criticalIssues: number;
    keyMetrics: {
      avgLatency: number;
      totalOrders: number;
      totalTrades: number;
      uptime: number;
    };
  };
  sections: {
    websocket?: WebSocketSection;
    orders?: OrdersSection;
    trades?: TradesSection;
    system?: SystemSection;
    sla?: SLASection;
  };
  recommendations: string[];
}

interface WebSocketSection {
  totalConnections: number;
  avgActiveConnections: number;
  messageVolume: number;
  errorRate: number;
  avgLatency: number;
  p95Latency: number;
  p99Latency: number;
  topErrors: { type: string; count: number }[];
}

interface OrdersSection {
  totalOrders: number;
  executedOrders: number;
  cancelledOrders: number;
  rejectedOrders: number;
  avgProcessingTime: number;
  rejectionRate: number;
  fillRate: number;
  topPairs: { pair: string; count: number; volume: number }[];
}

interface TradesSection {
  totalTrades: number;
  totalVolume: number;
  avgTradeSize: number;
  avgExecutionTime: number;
  topTradingPairs: { pair: string; volume: number; count: number }[];
}

interface SystemSection {
  avgCpuUsage: number;
  maxCpuUsage: number;
  avgMemoryUsage: number;
  maxMemoryUsage: number;
  avgEventLoopLag: number;
  maxEventLoopLag: number;
  uptime: number;
  gcStats: { count: number; avgDuration: number };
}

interface SLASection {
  overallCompliance: number;
  violations: SLAViolation[];
  byCategory: {
    category: string;
    compliance: number;
    violations: number;
  }[];
  trends: {
    date: string;
    compliance: number;
    violations: number;
  }[];
}

export class ReportGenerator extends EventEmitter {
  private config: ReportConfig;
  private metricsExporter: PrometheusMetricsExporter;
  private slaMonitor: SLAMonitor;
  private emailTransporter?: nodemailer.Transporter;
  private scheduleIntervals: NodeJS.Timeout[] = [];
  private htmlTemplate?: Handlebars.TemplateDelegate;

  constructor(
    config: ReportConfig,
    metricsExporter: PrometheusMetricsExporter,
    slaMonitor: SLAMonitor
  ) {
    super();
    this.config = config;
    this.metricsExporter = metricsExporter;
    this.slaMonitor = slaMonitor;
    this.initialize();
  }

  private async initialize(): Promise<void> {
    // Create output directory
    await fs.mkdir(this.config.outputDirectory, { recursive: true });

    // Setup email transporter
    if (this.config.emailConfig?.enabled) {
      this.emailTransporter = nodemailer.createTransport(this.config.emailConfig.smtp);
      
      try {
        await this.emailTransporter.verify();
        console.log('✅ Email configuration verified for report delivery');
      } catch (error) {
        console.error('❌ Email configuration error:', error);
      }
    }

    // Load HTML template
    await this.loadHtmlTemplate();

    // Setup scheduled reports
    this.setupSchedules();
  }

  private async loadHtmlTemplate(): Promise<void> {
    const templatePath = path.join(__dirname, 'templates', 'report.hbs');
    const templateContent = await fs.readFile(templatePath, 'utf-8').catch(() => this.getDefaultTemplate());
    
    this.htmlTemplate = Handlebars.compile(templateContent);
    
    // Register Handlebars helpers
    Handlebars.registerHelper('formatNumber', (num: number) => {
      return new Intl.NumberFormat('en-US').format(num);
    });
    
    Handlebars.registerHelper('formatPercent', (num: number) => {
      return `${num.toFixed(2)}%`;
    });
    
    Handlebars.registerHelper('formatDate', (date: Date) => {
      return format(date, 'yyyy-MM-dd HH:mm:ss');
    });
    
    Handlebars.registerHelper('severityClass', (severity: string) => {
      return `severity-${severity}`;
    });
  }

  private getDefaultTemplate(): string {
    return `
<!DOCTYPE html>
<html>
<head>
    <title>Trading System Report - {{formatDate period.start}} to {{formatDate period.end}}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        h1, h2, h3 { color: #333; }
        .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin: 20px 0; }
        .metric-card { background: #f8f9fa; padding: 20px; border-radius: 8px; text-align: center; }
        .metric-value { font-size: 32px; font-weight: bold; color: #2196F3; }
        .metric-label { font-size: 14px; color: #666; margin-top: 5px; }
        .health-healthy { color: #4CAF50; }
        .health-degraded { color: #FF9800; }
        .health-critical { color: #F44336; }
        .severity-low { color: #2196F3; }
        .severity-medium { color: #FF9800; }
        .severity-high { color: #F44336; }
        .severity-critical { color: #D32F2F; font-weight: bold; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background-color: #f8f9fa; font-weight: bold; }
        .section { margin: 40px 0; }
        .chart { margin: 20px 0; padding: 20px; background: #f8f9fa; border-radius: 8px; }
        .recommendations { background: #E3F2FD; padding: 20px; border-radius: 8px; margin: 20px 0; }
        .recommendations ul { margin: 10px 0; padding-left: 20px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Trading System Performance Report</h1>
        <p><strong>Period:</strong> {{formatDate period.start}} to {{formatDate period.end}}</p>
        <p><strong>Generated:</strong> {{formatDate generatedAt}}</p>
        
        <div class="summary">
            <div class="metric-card">
                <div class="metric-value health-{{summary.overallHealth}}">{{summary.overallHealth}}</div>
                <div class="metric-label">System Health</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">{{formatPercent summary.slaCompliance}}</div>
                <div class="metric-label">SLA Compliance</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">{{formatNumber summary.totalViolations}}</div>
                <div class="metric-label">Total Violations</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">{{formatNumber summary.criticalIssues}}</div>
                <div class="metric-label">Critical Issues</div>
            </div>
        </div>

        {{#if sections.websocket}}
        <div class="section">
            <h2>WebSocket Performance</h2>
            <div class="summary">
                <div class="metric-card">
                    <div class="metric-value">{{formatNumber sections.websocket.avgActiveConnections}}</div>
                    <div class="metric-label">Avg Active Connections</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value">{{sections.websocket.avgLatency}}ms</div>
                    <div class="metric-label">Avg Latency</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value">{{sections.websocket.p99Latency}}ms</div>
                    <div class="metric-label">P99 Latency</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value">{{formatPercent sections.websocket.errorRate}}</div>
                    <div class="metric-label">Error Rate</div>
                </div>
            </div>
        </div>
        {{/if}}

        {{#if sections.orders}}
        <div class="section">
            <h2>Order Processing</h2>
            <div class="summary">
                <div class="metric-card">
                    <div class="metric-value">{{formatNumber sections.orders.totalOrders}}</div>
                    <div class="metric-label">Total Orders</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value">{{formatPercent sections.orders.fillRate}}</div>
                    <div class="metric-label">Fill Rate</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value">{{sections.orders.avgProcessingTime}}ms</div>
                    <div class="metric-label">Avg Processing Time</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value">{{formatPercent sections.orders.rejectionRate}}</div>
                    <div class="metric-label">Rejection Rate</div>
                </div>
            </div>
        </div>
        {{/if}}

        {{#if sections.sla}}
        <div class="section">
            <h2>SLA Violations</h2>
            <table>
                <thead>
                    <tr>
                        <th>Time</th>
                        <th>Type</th>
                        <th>Severity</th>
                        <th>Metric</th>
                        <th>Threshold</th>
                        <th>Actual</th>
                        <th>Duration</th>
                    </tr>
                </thead>
                <tbody>
                    {{#each sections.sla.violations}}
                    <tr>
                        <td>{{formatDate timestamp}}</td>
                        <td>{{type}}</td>
                        <td class="{{severityClass severity}}">{{severity}}</td>
                        <td>{{metric}}</td>
                        <td>{{threshold}}</td>
                        <td>{{actual}}</td>
                        <td>{{#if duration}}{{duration}}ms{{else}}-{{/if}}</td>
                    </tr>
                    {{/each}}
                </tbody>
            </table>
        </div>
        {{/if}}

        {{#if recommendations}}
        <div class="recommendations">
            <h2>Recommendations</h2>
            <ul>
                {{#each recommendations}}
                <li>{{this}}</li>
                {{/each}}
            </ul>
        </div>
        {{/if}}
    </div>
</body>
</html>
    `;
  }

  private setupSchedules(): void {
    const { schedule } = this.config;

    // Daily reports
    if (schedule.daily) {
      const dailyInterval = this.scheduleDaily(
        schedule.daily.hour,
        schedule.daily.minute,
        () => this.generateDailyReport()
      );
      this.scheduleIntervals.push(dailyInterval);
    }

    // Weekly reports
    if (schedule.weekly) {
      const weeklyInterval = this.scheduleWeekly(
        schedule.weekly.dayOfWeek,
        schedule.weekly.hour,
        schedule.weekly.minute,
        () => this.generateWeeklyReport()
      );
      this.scheduleIntervals.push(weeklyInterval);
    }

    // Monthly reports
    if (schedule.monthly) {
      const monthlyInterval = this.scheduleMonthly(
        schedule.monthly.dayOfMonth,
        schedule.monthly.hour,
        schedule.monthly.minute,
        () => this.generateMonthlyReport()
      );
      this.scheduleIntervals.push(monthlyInterval);
    }
  }

  private scheduleDaily(hour: number, minute: number, callback: () => void): NodeJS.Timeout {
    const now = new Date();
    const scheduled = new Date(now);
    scheduled.setHours(hour, minute, 0, 0);
    
    if (scheduled <= now) {
      scheduled.setDate(scheduled.getDate() + 1);
    }
    
    const delay = scheduled.getTime() - now.getTime();
    
    return setTimeout(() => {
      callback();
      // Reschedule for tomorrow
      this.scheduleDaily(hour, minute, callback);
    }, delay);
  }

  private scheduleWeekly(dayOfWeek: number, hour: number, minute: number, callback: () => void): NodeJS.Timeout {
    const now = new Date();
    const scheduled = new Date(now);
    
    // Calculate days until target day
    const daysUntil = (dayOfWeek - now.getDay() + 7) % 7 || 7;
    scheduled.setDate(scheduled.getDate() + daysUntil);
    scheduled.setHours(hour, minute, 0, 0);
    
    const delay = scheduled.getTime() - now.getTime();
    
    return setTimeout(() => {
      callback();
      // Reschedule for next week
      this.scheduleWeekly(dayOfWeek, hour, minute, callback);
    }, delay);
  }

  private scheduleMonthly(dayOfMonth: number, hour: number, minute: number, callback: () => void): NodeJS.Timeout {
    const now = new Date();
    const scheduled = new Date(now);
    
    scheduled.setDate(dayOfMonth);
    scheduled.setHours(hour, minute, 0, 0);
    
    if (scheduled <= now) {
      scheduled.setMonth(scheduled.getMonth() + 1);
    }
    
    const delay = scheduled.getTime() - now.getTime();
    
    return setTimeout(() => {
      callback();
      // Reschedule for next month
      this.scheduleMonthly(dayOfMonth, hour, minute, callback);
    }, delay);
  }

  async generateReport(period: { start: Date; end: Date }): Promise<ReportData> {
    console.log(`📊 Generating report for period: ${period.start} to ${period.end}`);
    
    // Collect metrics from Prometheus
    const metrics = await this.collectMetrics(period);
    
    // Get SLA report
    const slaReport = this.slaMonitor.generateReport(period);
    
    // Analyze data and determine health
    const analysis = this.analyzeMetrics(metrics, slaReport);
    
    // Generate report data
    const reportData: ReportData = {
      period,
      generatedAt: new Date(),
      summary: {
        overallHealth: analysis.health,
        slaCompliance: slaReport.compliance,
        totalViolations: slaReport.violations.length,
        criticalIssues: slaReport.violations.filter(v => v.severity === 'critical').length,
        keyMetrics: {
          avgLatency: metrics.websocket?.avgLatency || 0,
          totalOrders: metrics.orders?.totalOrders || 0,
          totalTrades: metrics.trades?.totalTrades || 0,
          uptime: metrics.system?.uptime || 0,
        },
      },
      sections: {},
      recommendations: analysis.recommendations,
    };

    // Add sections based on config
    if (this.config.includeMetrics.websocket && metrics.websocket) {
      reportData.sections.websocket = metrics.websocket;
    }
    if (this.config.includeMetrics.orders && metrics.orders) {
      reportData.sections.orders = metrics.orders;
    }
    if (this.config.includeMetrics.trades && metrics.trades) {
      reportData.sections.trades = metrics.trades;
    }
    if (this.config.includeMetrics.system && metrics.system) {
      reportData.sections.system = metrics.system;
    }
    if (this.config.includeMetrics.sla) {
      reportData.sections.sla = {
        overallCompliance: slaReport.compliance,
        violations: slaReport.violations,
        byCategory: this.groupViolationsByCategory(slaReport.violations),
        trends: [], // Would be populated from historical data
      };
    }

    // Save report in configured formats
    await this.saveReport(reportData);
    
    // Send email if configured
    if (this.config.emailConfig?.enabled) {
      await this.emailReport(reportData);
    }
    
    this.emit('report-generated', reportData);
    
    return reportData;
  }

  private async collectMetrics(period: { start: Date; end: Date }): Promise<any> {
    // This would query Prometheus for metrics within the period
    // For now, returning mock data structure
    return {
      websocket: {
        totalConnections: 50000,
        avgActiveConnections: 25000,
        messageVolume: 1000000,
        errorRate: 0.1,
        avgLatency: 45,
        p95Latency: 80,
        p99Latency: 120,
        topErrors: [
          { type: 'connection_timeout', count: 50 },
          { type: 'message_parse_error', count: 30 },
        ],
      },
      orders: {
        totalOrders: 100000,
        executedOrders: 95000,
        cancelledOrders: 3000,
        rejectedOrders: 2000,
        avgProcessingTime: 25,
        rejectionRate: 2,
        fillRate: 95,
        topPairs: [
          { pair: 'ETH/USDT', count: 40000, volume: 5000000 },
          { pair: 'BTC/USDT', count: 35000, volume: 8000000 },
        ],
      },
      trades: {
        totalTrades: 95000,
        totalVolume: 15000000,
        avgTradeSize: 157.89,
        avgExecutionTime: 5,
        topTradingPairs: [
          { pair: 'BTC/USDT', volume: 8000000, count: 35000 },
          { pair: 'ETH/USDT', volume: 5000000, count: 40000 },
        ],
      },
      system: {
        avgCpuUsage: 45,
        maxCpuUsage: 78,
        avgMemoryUsage: 2048,
        maxMemoryUsage: 3500,
        avgEventLoopLag: 15,
        maxEventLoopLag: 85,
        uptime: 99.95,
        gcStats: { count: 1200, avgDuration: 5 },
      },
    };
  }

  private analyzeMetrics(metrics: any, slaReport: SLAReport): {
    health: 'healthy' | 'degraded' | 'critical';
    recommendations: string[];
  } {
    const recommendations: string[] = [];
    let health: 'healthy' | 'degraded' | 'critical' = 'healthy';

    // Analyze SLA compliance
    if (slaReport.compliance < 95) {
      health = 'degraded';
      recommendations.push('SLA compliance below 95%. Review and address recurring violations.');
    }
    if (slaReport.compliance < 90) {
      health = 'critical';
    }

    // Analyze critical violations
    const criticalViolations = slaReport.violations.filter(v => v.severity === 'critical');
    if (criticalViolations.length > 0) {
      health = 'critical';
      recommendations.push(`${criticalViolations.length} critical violations detected. Immediate action required.`);
    }

    // Analyze system metrics
    if (metrics.system) {
      if (metrics.system.maxCpuUsage > 80) {
        recommendations.push('High CPU usage detected. Consider scaling horizontally.');
      }
      if (metrics.system.maxMemoryUsage > 3500) {
        recommendations.push('High memory usage detected. Investigate potential memory leaks.');
      }
      if (metrics.system.maxEventLoopLag > 100) {
        recommendations.push('High event loop lag detected. Optimize synchronous operations.');
      }
    }

    // Analyze WebSocket metrics
    if (metrics.websocket) {
      if (metrics.websocket.errorRate > 1) {
        recommendations.push('WebSocket error rate above 1%. Investigate connection issues.');
      }
      if (metrics.websocket.p99Latency > 200) {
        recommendations.push('WebSocket P99 latency above 200ms. Consider optimizing message processing.');
      }
    }

    // Analyze order metrics
    if (metrics.orders) {
      if (metrics.orders.rejectionRate > 5) {
        recommendations.push('Order rejection rate above 5%. Review validation rules and limits.');
      }
      if (metrics.orders.avgProcessingTime > 50) {
        recommendations.push('Order processing time above 50ms. Optimize order matching engine.');
      }
    }

    return { health, recommendations };
  }

  private groupViolationsByCategory(violations: SLAViolation[]): any[] {
    const groups = new Map<string, { compliance: number; violations: number }>();
    
    for (const violation of violations) {
      const category = violation.type.split('_')[0];
      if (!groups.has(category)) {
        groups.set(category, { compliance: 100, violations: 0 });
      }
      const group = groups.get(category)!;
      group.violations++;
    }
    
    return Array.from(groups.entries()).map(([category, data]) => ({
      category,
      compliance: 100 - (data.violations / violations.length) * 100,
      violations: data.violations,
    }));
  }

  private async saveReport(reportData: ReportData): Promise<void> {
    const timestamp = format(new Date(), 'yyyyMMdd_HHmmss');
    const baseFilename = `report_${timestamp}`;
    
    for (const format of this.config.outputFormats) {
      switch (format) {
        case 'json':
          await this.saveJsonReport(reportData, baseFilename);
          break;
        case 'html':
          await this.saveHtmlReport(reportData, baseFilename);
          break;
        case 'pdf':
          await this.savePdfReport(reportData, baseFilename);
          break;
      }
    }
  }

  private async saveJsonReport(reportData: ReportData, baseFilename: string): Promise<void> {
    const filepath = path.join(this.config.outputDirectory, `${baseFilename}.json`);
    await fs.writeFile(filepath, JSON.stringify(reportData, null, 2));
    console.log(`✅ JSON report saved: ${filepath}`);
  }

  private async saveHtmlReport(reportData: ReportData, baseFilename: string): Promise<void> {
    const html = this.htmlTemplate!(reportData);
    const filepath = path.join(this.config.outputDirectory, `${baseFilename}.html`);
    await fs.writeFile(filepath, html);
    console.log(`✅ HTML report saved: ${filepath}`);
  }

  private async savePdfReport(reportData: ReportData, baseFilename: string): Promise<void> {
    const html = this.htmlTemplate!(reportData);
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    
    await page.setContent(html, { waitUntil: 'networkidle0' });
    
    const filepath = path.join(this.config.outputDirectory, `${baseFilename}.pdf`);
    await page.pdf({
      path: filepath,
      format: 'A4',
      printBackground: true,
      margin: { top: '20px', right: '20px', bottom: '20px', left: '20px' },
    });
    
    await browser.close();
    console.log(`✅ PDF report saved: ${filepath}`);
  }

  private async emailReport(reportData: ReportData): Promise<void> {
    if (!this.emailTransporter || !this.config.emailConfig) return;
    
    const html = this.htmlTemplate!(reportData);
    const subject = `Trading System Report - ${format(reportData.generatedAt, 'yyyy-MM-dd')} - ${reportData.summary.overallHealth.toUpperCase()}`;
    
    try {
      await this.emailTransporter.sendMail({
        from: this.config.emailConfig.from,
        to: this.config.emailConfig.recipients.join(', '),
        subject,
        html,
        attachments: [
          {
            filename: `report_${format(reportData.generatedAt, 'yyyyMMdd_HHmmss')}.json`,
            content: JSON.stringify(reportData, null, 2),
          },
        ],
      });
      console.log(`✅ Report emailed to ${this.config.emailConfig.recipients.length} recipients`);
    } catch (error) {
      console.error('❌ Failed to email report:', error);
    }
  }

  async generateDailyReport(): Promise<void> {
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - 1);
    
    console.log('📅 Generating daily report...');
    await this.generateReport({ start, end });
  }

  async generateWeeklyReport(): Promise<void> {
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - 7);
    
    console.log('📅 Generating weekly report...');
    await this.generateReport({ start, end });
  }

  async generateMonthlyReport(): Promise<void> {
    const end = new Date();
    const start = new Date(end);
    start.setMonth(start.getMonth() - 1);
    
    console.log('📅 Generating monthly report...');
    await this.generateReport({ start, end });
  }

  async generateOnDemandReport(hours: number = 24): Promise<ReportData> {
    const end = new Date();
    const start = new Date(end);
    start.setHours(start.getHours() - hours);
    
    console.log(`📊 Generating on-demand report for last ${hours} hours...`);
    return await this.generateReport({ start, end });
  }

  stop(): void {
    // Clear all scheduled intervals
    for (const interval of this.scheduleIntervals) {
      clearTimeout(interval);
    }
    this.scheduleIntervals = [];
    
    this.emit('stopped');
  }
}