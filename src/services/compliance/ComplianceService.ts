import { EventEmitter } from 'events';
import { KYCService, KYCServiceConfig } from './kyc/KYCService';
import { AMLService, AMLServiceConfig } from './aml/AMLService';
import { TradeSurveillanceService, TradeData, OrderData } from './surveillance/TradeSurveillanceService';
import { RegulatoryReportingService, ReportConfig } from './reporting/RegulatoryReportingService';
import { ComplianceRulesEngine, RuleContext } from './rules/ComplianceRulesEngine';
import {
  KYCLevel,
  TransactionData,
  AMLCheckType,
  ReportType,
  ReportPeriod
} from './types';

export interface ComplianceServiceConfig {
  kyc: KYCServiceConfig;
  aml: AMLServiceConfig;
  reporting: ReportConfig;
  enableRealTimeChecks: boolean;
  jurisdiction: string;
}

export interface ComplianceCheckRequest {
  userId: string;
  action: 'TRADE' | 'WITHDRAW' | 'DEPOSIT' | 'LOGIN';
  amount?: string;
  currency?: string;
  pairId?: string;
  metadata?: Record<string, any>;
}

export interface ComplianceStatus {
  userId: string;
  kycVerified: boolean;
  kycLevel?: KYCLevel;
  amlCleared: boolean;
  amlRiskScore?: number;
  activeAlerts: number;
  restrictions: string[];
  lastChecked: Date;
}

export class ComplianceService extends EventEmitter {
  private kycService: KYCService;
  private amlService: AMLService;
  private surveillanceService: TradeSurveillanceService;
  private reportingService: RegulatoryReportingService;
  private rulesEngine: ComplianceRulesEngine;
  private config: ComplianceServiceConfig;

  constructor(config: ComplianceServiceConfig) {
    super();
    this.config = config;

    // Initialize services
    this.kycService = new KYCService(config.kyc);
    this.amlService = new AMLService(config.aml);
    this.surveillanceService = new TradeSurveillanceService();
    this.reportingService = new RegulatoryReportingService(config.reporting);
    this.rulesEngine = new ComplianceRulesEngine();

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // KYC events
    this.kycService.on('kyc:approved', async ({ userId }) => {
      this.emit('compliance:kyc:approved', { userId });
      await this.updateUserCompliance(userId);
    });

    this.kycService.on('kyc:rejected', async ({ userId, reason }) => {
      this.emit('compliance:kyc:rejected', { userId, reason });
      await this.blockUser(userId, 'KYC rejected: ' + reason);
    });

    // AML events
    this.amlService.on('aml:user:blocked', async ({ userId, check }) => {
      this.emit('compliance:aml:blocked', { userId, check });
      await this.blockUser(userId, 'AML check failed');
      
      // Generate SAR if needed
      if (check.riskScore > 80) {
        await this.generateSAR(userId, 'High risk AML score');
      }
    });

    // Surveillance events
    this.surveillanceService.on('surveillance:alert:created', async (alert) => {
      this.emit('compliance:alert:created', alert);
      
      if (alert.severity === 'CRITICAL') {
        await this.escalateAlert(alert);
      }
    });

    // Rules engine events
    this.rulesEngine.on('compliance:action:block', async ({ userId, reason }) => {
      await this.blockUser(userId, reason);
    });

    this.rulesEngine.on('compliance:violation:confirmed', async ({ userId, alertType }) => {
      await this.handleViolation(userId, alertType);
    });
  }

  // Main compliance check
  async checkCompliance(request: ComplianceCheckRequest): Promise<{
    allowed: boolean;
    reason?: string;
    requiredActions?: string[];
  }> {
    const { userId, action, amount, currency, pairId, metadata } = request;

    try {
      // Get user compliance data
      const kycData = await this.kycService.checkStatus(userId);
      const amlCheck = this.amlService.getLatestCheck(userId);

      // Build rule context
      const context: RuleContext = {
        userId,
        action,
        amount,
        currency,
        pairId,
        userKYC: kycData || undefined,
        userAML: amlCheck || undefined,
        metadata: {
          ...metadata,
          jurisdiction: this.config.jurisdiction
        }
      };

      // Check compliance rules
      const result = await this.rulesEngine.checkCompliance(context);

      if (!result.allowed) {
        this.emit('compliance:check:failed', {
          userId,
          action,
          blockedBy: result.blockedBy
        });

        return {
          allowed: false,
          reason: result.blockedBy?.join(', '),
          requiredActions: result.requiredActions?.map(a => a.type)
        };
      }

      // Additional real-time checks if enabled
      if (this.config.enableRealTimeChecks) {
        const realtimeResult = await this.performRealTimeChecks(request);
        if (!realtimeResult.allowed) {
          return realtimeResult;
        }
      }

      this.emit('compliance:check:passed', { userId, action });

      return {
        allowed: true,
        requiredActions: result.requiredActions?.map(a => a.type)
      };

    } catch (error) {
      this.emit('compliance:check:error', { userId, action, error: error.message });
      
      // Fail closed - deny if error
      return {
        allowed: false,
        reason: 'Compliance check failed'
      };
    }
  }

  private async performRealTimeChecks(request: ComplianceCheckRequest): Promise<{
    allowed: boolean;
    reason?: string;
  }> {
    // Perform additional real-time checks
    // This could include external API calls, ML models, etc.
    
    return { allowed: true };
  }

  // User onboarding
  async onboardUser(
    userId: string,
    personalInfo?: any,
    businessInfo?: any,
    requiredLevel: KYCLevel = KYCLevel.STANDARD
  ): Promise<void> {
    // Initiate KYC
    await this.kycService.initiateKYC(userId, requiredLevel, personalInfo, businessInfo);

    // Perform initial AML check
    const name = personalInfo ? `${personalInfo.firstName} ${personalInfo.lastName}` : userId;
    await this.amlService.performCheck(
      userId,
      name,
      [AMLCheckType.SANCTIONS, AMLCheckType.PEP],
      personalInfo?.residenceCountry
    );

    this.emit('compliance:user:onboarded', { userId, requiredLevel });
  }

  // Transaction monitoring
  async monitorTransaction(transaction: TransactionData): Promise<void> {
    // AML transaction monitoring
    const amlCheck = await this.amlService.monitorTransaction(transaction);

    if (amlCheck && amlCheck.status !== 'CLEAR') {
      this.emit('compliance:transaction:flagged', {
        transaction,
        check: amlCheck
      });
    }

    // Update user activity metrics for rules engine
    await this.updateUserMetrics(transaction.userId, transaction);
  }

  // Trade monitoring
  async monitorTrade(trade: TradeData): Promise<void> {
    const alerts = await this.surveillanceService.analyzeTrade(trade);
    
    if (alerts.length > 0) {
      this.emit('compliance:trade:alerts', { trade, alerts });
    }
  }

  // Order monitoring
  async monitorOrder(order: OrderData): Promise<void> {
    const alerts = await this.surveillanceService.analyzeOrder(order);
    
    if (alerts.length > 0) {
      this.emit('compliance:order:alerts', { order, alerts });
    }
  }

  // Get user compliance status
  async getUserComplianceStatus(userId: string): Promise<ComplianceStatus> {
    const kycData = await this.kycService.checkStatus(userId);
    const amlCheck = this.amlService.getLatestCheck(userId);
    const alerts = this.surveillanceService.getAlerts({ userId, status: 'NEW' });

    const restrictions: string[] = [];
    
    if (!kycData || kycData.status !== 'APPROVED') {
      restrictions.push('KYC not verified');
    }
    
    if (amlCheck && amlCheck.status === 'BLOCKED') {
      restrictions.push('AML blocked');
    }

    return {
      userId,
      kycVerified: kycData?.status === 'APPROVED',
      kycLevel: kycData?.level,
      amlCleared: !amlCheck || amlCheck.status === 'CLEAR',
      amlRiskScore: amlCheck?.riskScore,
      activeAlerts: alerts.length,
      restrictions,
      lastChecked: new Date()
    };
  }

  // Reporting
  async generateComplianceReport(
    type: ReportType,
    period: ReportPeriod
  ): Promise<string> {
    const reportData = await this.gatherReportData(type, period);
    const report = await this.reportingService.generateReport(
      type,
      period,
      reportData,
      this.config.jurisdiction
    );

    return report.reportId;
  }

  private async gatherReportData(type: ReportType, period: ReportPeriod): Promise<any> {
    // Gather data based on report type
    switch (type) {
      case ReportType.COMPLIANCE_SUMMARY:
        return {
          complianceMetrics: {
            totalUsers: 0, // Would query from database
            verifiedUsers: 0,
            flaggedUsers: 0,
            blockedUsers: 0,
            alertsGenerated: this.surveillanceService.getAlerts().length,
            alertsResolved: this.surveillanceService.getAlerts({ status: 'RESOLVED' }).length
          }
        };
      
      default:
        return {};
    }
  }

  // Private helper methods
  private async blockUser(userId: string, reason: string): Promise<void> {
    // Implementation would update user status in database
    this.emit('compliance:user:blocked', { userId, reason });
  }

  private async updateUserCompliance(userId: string): Promise<void> {
    // Update user compliance status
    const status = await this.getUserComplianceStatus(userId);
    this.emit('compliance:status:updated', status);
  }

  private async escalateAlert(alert: any): Promise<void> {
    this.emit('compliance:alert:escalated', alert);
    
    // Could trigger notifications, create tickets, etc.
  }

  private async handleViolation(userId: string, violationType: string): Promise<void> {
    // Log violation
    this.emit('compliance:violation:detected', { userId, violationType });
    
    // Take action based on violation type
    switch (violationType) {
      case 'WASH_TRADING':
      case 'MARKET_MANIPULATION':
        await this.blockUser(userId, `Violation: ${violationType}`);
        await this.generateSAR(userId, `Trading violation: ${violationType}`);
        break;
      
      default:
        // Flag for review
        break;
    }
  }

  private async generateSAR(userId: string, reason: string): Promise<void> {
    const amlChecks = this.amlService.getChecks(userId);
    const alerts = this.surveillanceService.getAlerts({ userId });
    
    await this.reportingService.generateSAR(
      amlChecks,
      alerts,
      reason,
      this.config.jurisdiction
    );
  }

  private async updateUserMetrics(userId: string, transaction: TransactionData): Promise<void> {
    // This would update user metrics in database
    // Used by rules engine for velocity checks, etc.
  }

  // Admin functions
  async overrideKYCStatus(userId: string, status: any, reason: string): Promise<void> {
    await this.kycService.overrideStatus(userId, status, reason);
  }

  async reviewAMLCheck(checkId: string, status: any, notes: string): Promise<void> {
    await this.amlService.reviewCheck(checkId, status, notes);
  }

  async resolveAlert(alertId: string, resolution: any): Promise<void> {
    await this.surveillanceService.resolveAlert(alertId, resolution);
  }

  async reviewReport(reportId: string, reviewedBy: string): Promise<void> {
    await this.reportingService.reviewReport(reportId, reviewedBy);
  }

  // Cleanup
  destroy(): void {
    // Remove event listeners and cleanup resources
    this.removeAllListeners();
  }
}