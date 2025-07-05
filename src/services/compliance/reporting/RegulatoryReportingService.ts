import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  RegulatoryReport,
  ReportType,
  ReportPeriod,
  ReportStatus,
  AMLCheck,
  SurveillanceAlert,
  AlertType
} from '../types';

export interface ReportData {
  suspiciousActivities?: Array<{
    userId: string;
    activityType: string;
    amount?: string;
    timestamp: Date;
    description: string;
    riskScore: number;
  }>;
  largeTransactions?: Array<{
    userId: string;
    amount: string;
    currency: string;
    timestamp: Date;
    type: string;
    counterparty?: string;
  }>;
  tradingVolumes?: {
    total: string;
    byPair: Record<string, string>;
    byUser: Array<{ userId: string; volume: string }>;
  };
  complianceMetrics?: {
    totalUsers: number;
    verifiedUsers: number;
    flaggedUsers: number;
    blockedUsers: number;
    alertsGenerated: number;
    alertsResolved: number;
  };
}

export interface ReportConfig {
  outputDir: string;
  templates: Map<ReportType, ReportTemplate>;
  jurisdictions: string[];
  autoSubmit: boolean;
  encryptReports: boolean;
}

interface ReportTemplate {
  format: 'JSON' | 'XML' | 'CSV' | 'PDF';
  fields: string[];
  required: string[];
  transform?: (data: any) => any;
}

export class RegulatoryReportingService extends EventEmitter {
  private reports: Map<string, RegulatoryReport> = new Map();
  private config: ReportConfig;
  private scheduledReports: Map<string, NodeJS.Timer> = new Map();

  constructor(config: ReportConfig) {
    super();
    this.config = config;
    this.initializeTemplates();
  }

  private initializeTemplates(): void {
    // SAR Template
    this.config.templates.set(ReportType.SAR, {
      format: 'XML',
      fields: [
        'filingInstitution',
        'filingDate',
        'suspectInfo',
        'suspiciousActivity',
        'narrative',
        'lawEnforcementContact'
      ],
      required: ['suspectInfo', 'suspiciousActivity', 'narrative'],
      transform: this.transformToSAR.bind(this)
    });

    // CTR Template
    this.config.templates.set(ReportType.CTR, {
      format: 'XML',
      fields: [
        'filingInstitution',
        'transactionDate',
        'personInfo',
        'transactionInfo',
        'cashInAmount',
        'cashOutAmount'
      ],
      required: ['personInfo', 'transactionInfo'],
      transform: this.transformToCTR.bind(this)
    });
  }

  async generateReport(
    type: ReportType,
    period: ReportPeriod,
    data: ReportData,
    jurisdiction: string
  ): Promise<RegulatoryReport> {
    const reportId = this.generateReportId();
    const template = this.config.templates.get(type);

    if (!template) {
      throw new Error(`No template found for report type: ${type}`);
    }

    const report: RegulatoryReport = {
      reportId,
      type,
      period,
      generatedAt: new Date(),
      status: ReportStatus.DRAFT,
      jurisdiction,
      data,
      format: template.format
    };

    // Transform data if needed
    if (template.transform) {
      report.data = template.transform(data);
    }

    // Validate required fields
    this.validateReport(report, template);

    // Save report
    const filePath = await this.saveReport(report);
    report.filePath = filePath;
    report.status = ReportStatus.GENERATED;

    this.reports.set(reportId, report);
    this.emit('report:generated', report);

    return report;
  }

  async generateSAR(
    suspiciousActivities: AMLCheck[],
    alerts: SurveillanceAlert[],
    narrative: string,
    jurisdiction: string
  ): Promise<RegulatoryReport> {
    const sarData: ReportData = {
      suspiciousActivities: [
        ...suspiciousActivities.map(check => ({
          userId: check.userId,
          activityType: check.type,
          timestamp: check.timestamp,
          description: check.hits.map(h => h.reason).join('; '),
          riskScore: check.riskScore
        })),
        ...alerts.map(alert => ({
          userId: alert.userId || 'UNKNOWN',
          activityType: alert.type,
          timestamp: alert.timestamp,
          description: alert.pattern,
          riskScore: this.severityToRiskScore(alert.severity)
        }))
      ]
    };

    const period: ReportPeriod = {
      start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
      end: new Date(),
      frequency: 'AD_HOC'
    };

    return this.generateReport(ReportType.SAR, period, sarData, jurisdiction);
  }

  async generateCTR(
    largeTransactions: Array<{
      userId: string;
      amount: string;
      currency: string;
      timestamp: Date;
      type: string;
    }>,
    jurisdiction: string
  ): Promise<RegulatoryReport> {
    const ctrData: ReportData = {
      largeTransactions
    };

    const period: ReportPeriod = {
      start: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
      end: new Date(),
      frequency: 'DAILY'
    };

    return this.generateReport(ReportType.CTR, period, ctrData, jurisdiction);
  }

  async generateTradeReport(
    startDate: Date,
    endDate: Date,
    jurisdiction: string
  ): Promise<RegulatoryReport> {
    // This would integrate with order history store
    const tradeData: ReportData = {
      tradingVolumes: {
        total: '0', // Would be calculated from actual data
        byPair: {},
        byUser: []
      }
    };

    const period: ReportPeriod = {
      start: startDate,
      end: endDate,
      frequency: 'DAILY'
    };

    return this.generateReport(ReportType.TRADE_REPORT, period, tradeData, jurisdiction);
  }

  async generateComplianceSummary(
    period: ReportPeriod,
    metrics: ReportData['complianceMetrics'],
    jurisdiction: string
  ): Promise<RegulatoryReport> {
    const summaryData: ReportData = {
      complianceMetrics: metrics
    };

    return this.generateReport(ReportType.COMPLIANCE_SUMMARY, period, summaryData, jurisdiction);
  }

  private validateReport(report: RegulatoryReport, template: ReportTemplate): void {
    for (const field of template.required) {
      if (!this.hasField(report.data, field)) {
        throw new Error(`Required field missing: ${field}`);
      }
    }
  }

  private hasField(data: any, field: string): boolean {
    const fields = field.split('.');
    let current = data;
    
    for (const f of fields) {
      if (!current || !current[f]) {
        return false;
      }
      current = current[f];
    }
    
    return true;
  }

  private async saveReport(report: RegulatoryReport): Promise<string> {
    const filename = `${report.type}_${report.reportId}_${report.jurisdiction}.${report.format.toLowerCase()}`;
    const filePath = path.join(this.config.outputDir, filename);

    let content: string;
    
    switch (report.format) {
      case 'JSON':
        content = JSON.stringify(report.data, null, 2);
        break;
      case 'XML':
        content = this.toXML(report.data);
        break;
      case 'CSV':
        content = this.toCSV(report.data);
        break;
      default:
        content = JSON.stringify(report.data);
    }

    if (this.config.encryptReports) {
      content = this.encrypt(content);
    }

    await fs.writeFile(filePath, content);
    return filePath;
  }

  private toXML(data: any): string {
    // Simplified XML generation
    const toXMLString = (obj: any, rootName: string = 'root'): string => {
      let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<${rootName}>\n`;
      
      for (const [key, value] of Object.entries(obj)) {
        if (value === null || value === undefined) continue;
        
        if (Array.isArray(value)) {
          for (const item of value) {
            xml += `  <${key}>\n`;
            if (typeof item === 'object') {
              for (const [k, v] of Object.entries(item)) {
                xml += `    <${k}>${v}</${k}>\n`;
              }
            } else {
              xml += `    ${item}\n`;
            }
            xml += `  </${key}>\n`;
          }
        } else if (typeof value === 'object') {
          xml += `  <${key}>\n`;
          for (const [k, v] of Object.entries(value)) {
            xml += `    <${k}>${v}</${k}>\n`;
          }
          xml += `  </${key}>\n`;
        } else {
          xml += `  <${key}>${value}</${key}>\n`;
        }
      }
      
      xml += `</${rootName}>`;
      return xml;
    };

    return toXMLString(data, 'Report');
  }

  private toCSV(data: any): string {
    // Simplified CSV generation for tabular data
    if (data.largeTransactions) {
      const headers = ['userId', 'amount', 'currency', 'timestamp', 'type'];
      const rows = data.largeTransactions.map((t: any) => 
        headers.map(h => t[h] || '').join(',')
      );
      return [headers.join(','), ...rows].join('\n');
    }
    
    return JSON.stringify(data);
  }

  private encrypt(content: string): string {
    // Placeholder for encryption logic
    // In production, use proper encryption library
    return Buffer.from(content).toString('base64');
  }

  private transformToSAR(data: ReportData): any {
    return {
      filingInstitution: {
        name: 'Exchange Name',
        id: 'EIN123456789'
      },
      filingDate: new Date().toISOString(),
      suspiciousActivity: data.suspiciousActivities,
      narrative: 'Automated suspicious activity detection'
    };
  }

  private transformToCTR(data: ReportData): any {
    return {
      filingInstitution: {
        name: 'Exchange Name',
        id: 'EIN123456789'
      },
      transactions: data.largeTransactions
    };
  }

  async submitReport(reportId: string): Promise<void> {
    const report = this.reports.get(reportId);
    if (!report) {
      throw new Error('Report not found');
    }

    if (report.status !== ReportStatus.REVIEWED) {
      throw new Error('Report must be reviewed before submission');
    }

    // In production, this would submit to regulatory authority API
    report.status = ReportStatus.SUBMITTED;
    report.submittedAt = new Date();

    this.emit('report:submitted', report);
  }

  async reviewReport(reportId: string, reviewedBy: string): Promise<void> {
    const report = this.reports.get(reportId);
    if (!report) {
      throw new Error('Report not found');
    }

    report.status = ReportStatus.REVIEWED;
    this.emit('report:reviewed', { reportId, reviewedBy });

    if (this.config.autoSubmit) {
      await this.submitReport(reportId);
    }
  }

  scheduleReport(
    type: ReportType,
    frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY',
    jurisdiction: string,
    generateData: () => Promise<ReportData>
  ): string {
    const scheduleId = `SCHEDULE_${Date.now()}`;
    
    const intervals = {
      DAILY: 24 * 60 * 60 * 1000,
      WEEKLY: 7 * 24 * 60 * 60 * 1000,
      MONTHLY: 30 * 24 * 60 * 60 * 1000
    };

    const timer = setInterval(async () => {
      try {
        const data = await generateData();
        const period: ReportPeriod = {
          start: new Date(Date.now() - intervals[frequency]),
          end: new Date(),
          frequency
        };

        await this.generateReport(type, period, data, jurisdiction);
      } catch (error) {
        this.emit('report:schedule:error', { scheduleId, error: error.message });
      }
    }, intervals[frequency]);

    this.scheduledReports.set(scheduleId, timer);
    return scheduleId;
  }

  cancelSchedule(scheduleId: string): void {
    const timer = this.scheduledReports.get(scheduleId);
    if (timer) {
      clearInterval(timer);
      this.scheduledReports.delete(scheduleId);
    }
  }

  getReports(filters?: {
    type?: ReportType;
    status?: ReportStatus;
    jurisdiction?: string;
    dateFrom?: Date;
    dateTo?: Date;
  }): RegulatoryReport[] {
    let reports = Array.from(this.reports.values());

    if (filters) {
      if (filters.type) {
        reports = reports.filter(r => r.type === filters.type);
      }
      if (filters.status) {
        reports = reports.filter(r => r.status === filters.status);
      }
      if (filters.jurisdiction) {
        reports = reports.filter(r => r.jurisdiction === filters.jurisdiction);
      }
      if (filters.dateFrom) {
        reports = reports.filter(r => r.generatedAt >= filters.dateFrom!);
      }
      if (filters.dateTo) {
        reports = reports.filter(r => r.generatedAt <= filters.dateTo!);
      }
    }

    return reports.sort((a, b) => b.generatedAt.getTime() - a.generatedAt.getTime());
  }

  private generateReportId(): string {
    return `RPT_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private severityToRiskScore(severity: string): number {
    const scores = {
      LOW: 25,
      MEDIUM: 50,
      HIGH: 75,
      CRITICAL: 100
    };
    return scores[severity as keyof typeof scores] || 0;
  }

  // Export functionality
  async exportReports(
    reportIds: string[],
    format: 'ZIP' | 'ENCRYPTED_ZIP'
  ): Promise<string> {
    // This would create a zip file with all selected reports
    const exportPath = path.join(this.config.outputDir, `export_${Date.now()}.zip`);
    
    // Implementation would use archiver or similar library
    this.emit('reports:exported', { reportIds, exportPath });
    
    return exportPath;
  }
}