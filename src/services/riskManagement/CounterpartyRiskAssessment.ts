import { EventEmitter } from 'events';
import { CounterpartyRisk } from './types';

export interface TradeHistory {
  counterpartyId: string;
  tradeId: string;
  amount: number;
  settlementDate: Date;
  paymentDate: Date;
  isLate: boolean;
  daysLate: number;
}

export interface ExposureDetail {
  counterpartyId: string;
  symbol: string;
  exposure: number;
  collateral: number;
  netExposure: number;
  lastUpdated: Date;
}

export interface CreditEvent {
  id: string;
  counterpartyId: string;
  eventType: 'LATE_PAYMENT' | 'DEFAULT' | 'MARGIN_BREACH' | 'CREDIT_DOWNGRADE';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  impact: number;
  description: string;
  timestamp: Date;
}

export interface RiskMatrix {
  counterpartyId: string;
  creditScore: number;
  exposureScore: number;
  behaviorScore: number;
  overallRisk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  recommendations: string[];
}

export class CounterpartyRiskAssessment extends EventEmitter {
  private counterpartyRisks: Map<string, CounterpartyRisk> = new Map();
  private tradeHistory: Map<string, TradeHistory[]> = new Map();
  private exposureDetails: Map<string, ExposureDetail[]> = new Map();
  private creditEvents: CreditEvent[] = [];
  
  // Scoring parameters
  private readonly maxCreditScore = 1000;
  private readonly defaultCreditScore = 500;
  private readonly latePaymentPenalty = 50;
  private readonly defaultPenalty = 200;
  private readonly onTimeBonus = 10;
  
  // Risk thresholds
  private readonly highRiskThreshold = 300;
  private readonly mediumRiskThreshold = 500;
  private readonly lowRiskThreshold = 700;

  constructor() {
    super();
    this.startRiskMonitoring();
  }

  initializeCounterparty(counterpartyId: string, initialData?: Partial<CounterpartyRisk>): CounterpartyRisk {
    const risk: CounterpartyRisk = {
      counterpartyId,
      creditScore: initialData?.creditScore || this.defaultCreditScore,
      defaultProbability: this.calculateDefaultProbability(initialData?.creditScore || this.defaultCreditScore),
      exposureLimit: initialData?.exposureLimit || 1000000, // $1M default
      currentExposure: 0,
      collateralRatio: initialData?.collateralRatio || 1.0,
      paymentHistory: {
        onTimePayments: 0,
        latePayments: 0,
        defaults: 0
      },
      lastAssessment: new Date()
    };
    
    this.counterpartyRisks.set(counterpartyId, risk);
    this.emit('counterpartyInitialized', risk);
    
    return risk;
  }

  recordTrade(trade: TradeHistory): void {
    if (!this.tradeHistory.has(trade.counterpartyId)) {
      this.tradeHistory.set(trade.counterpartyId, []);
    }
    
    this.tradeHistory.get(trade.counterpartyId)!.push(trade);
    
    // Update payment history
    const risk = this.counterpartyRisks.get(trade.counterpartyId);
    if (risk) {
      if (trade.isLate) {
        if (trade.daysLate > 30) {
          risk.paymentHistory.defaults++;
          this.adjustCreditScore(trade.counterpartyId, -this.defaultPenalty);
          this.recordCreditEvent(trade.counterpartyId, 'DEFAULT', 'Payment default on trade');
        } else {
          risk.paymentHistory.latePayments++;
          this.adjustCreditScore(trade.counterpartyId, -this.latePaymentPenalty * (trade.daysLate / 30));
          this.recordCreditEvent(trade.counterpartyId, 'LATE_PAYMENT', `Payment ${trade.daysLate} days late`);
        }
      } else {
        risk.paymentHistory.onTimePayments++;
        this.adjustCreditScore(trade.counterpartyId, this.onTimeBonus);
      }
      
      this.reassessCounterparty(trade.counterpartyId);
    }
  }

  updateExposure(counterpartyId: string, exposures: ExposureDetail[]): void {
    this.exposureDetails.set(counterpartyId, exposures);
    
    const totalExposure = exposures.reduce((sum, exp) => sum + exp.netExposure, 0);
    const risk = this.counterpartyRisks.get(counterpartyId);
    
    if (risk) {
      risk.currentExposure = totalExposure;
      
      // Check exposure limits
      if (totalExposure > risk.exposureLimit) {
        this.emit('exposureLimitBreached', {
          counterpartyId,
          currentExposure: totalExposure,
          limit: risk.exposureLimit
        });
        
        this.recordCreditEvent(
          counterpartyId, 
          'MARGIN_BREACH', 
          `Exposure ${totalExposure} exceeds limit ${risk.exposureLimit}`
        );
      }
      
      this.reassessCounterparty(counterpartyId);
    }
  }

  assessCounterparty(counterpartyId: string): RiskMatrix {
    const risk = this.counterpartyRisks.get(counterpartyId);
    if (!risk) {
      throw new Error(`Counterparty ${counterpartyId} not found`);
    }
    
    // Calculate component scores
    const creditScore = this.normalizeCreditScore(risk.creditScore);
    const exposureScore = this.calculateExposureScore(risk);
    const behaviorScore = this.calculateBehaviorScore(risk);
    
    // Weighted average for overall risk
    const overallScore = (creditScore * 0.4 + exposureScore * 0.3 + behaviorScore * 0.3);
    const overallRisk = this.categorizeRisk(overallScore * this.maxCreditScore);
    
    // Generate recommendations
    const recommendations = this.generateRecommendations(risk, overallRisk);
    
    const matrix: RiskMatrix = {
      counterpartyId,
      creditScore,
      exposureScore,
      behaviorScore,
      overallRisk,
      recommendations
    };
    
    this.emit('riskAssessmentCompleted', matrix);
    return matrix;
  }

  private calculateDefaultProbability(creditScore: number): number {
    // Simplified default probability calculation
    // In production, use historical data and statistical models
    const normalized = creditScore / this.maxCreditScore;
    return Math.max(0, Math.min(1, 1 - normalized));
  }

  private adjustCreditScore(counterpartyId: string, adjustment: number): void {
    const risk = this.counterpartyRisks.get(counterpartyId);
    if (!risk) return;
    
    const oldScore = risk.creditScore;
    risk.creditScore = Math.max(0, Math.min(this.maxCreditScore, risk.creditScore + adjustment));
    risk.defaultProbability = this.calculateDefaultProbability(risk.creditScore);
    
    this.emit('creditScoreChanged', {
      counterpartyId,
      oldScore,
      newScore: risk.creditScore,
      adjustment
    });
    
    // Check for credit downgrade
    if (adjustment < 0 && this.categorizeRisk(oldScore) !== this.categorizeRisk(risk.creditScore)) {
      this.recordCreditEvent(counterpartyId, 'CREDIT_DOWNGRADE', 'Credit score downgraded');
    }
  }

  private normalizeCreditScore(score: number): number {
    return score / this.maxCreditScore;
  }

  private calculateExposureScore(risk: CounterpartyRisk): number {
    if (risk.exposureLimit === 0) return 1;
    
    const utilizationRate = risk.currentExposure / risk.exposureLimit;
    
    // Higher utilization = lower score
    if (utilizationRate > 0.9) return 0.2;
    if (utilizationRate > 0.7) return 0.5;
    if (utilizationRate > 0.5) return 0.7;
    return 0.9;
  }

  private calculateBehaviorScore(risk: CounterpartyRisk): number {
    const total = risk.paymentHistory.onTimePayments + 
                  risk.paymentHistory.latePayments + 
                  risk.paymentHistory.defaults;
    
    if (total === 0) return 0.5; // Neutral for new counterparties
    
    const onTimeRate = risk.paymentHistory.onTimePayments / total;
    const defaultRate = risk.paymentHistory.defaults / total;
    
    // Weighted scoring
    return Math.max(0, onTimeRate - (defaultRate * 2));
  }

  private categorizeRisk(score: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    if (score >= this.lowRiskThreshold) return 'LOW';
    if (score >= this.mediumRiskThreshold) return 'MEDIUM';
    if (score >= this.highRiskThreshold) return 'HIGH';
    return 'CRITICAL';
  }

  private generateRecommendations(risk: CounterpartyRisk, overallRisk: string): string[] {
    const recommendations: string[] = [];
    
    // Credit score recommendations
    if (risk.creditScore < this.mediumRiskThreshold) {
      recommendations.push('Require additional collateral for new positions');
      recommendations.push('Implement stricter position limits');
    }
    
    // Exposure recommendations
    if (risk.currentExposure > risk.exposureLimit * 0.8) {
      recommendations.push('Reduce exposure or increase exposure limit');
      recommendations.push('Consider position netting opportunities');
    }
    
    // Payment history recommendations
    const totalPayments = risk.paymentHistory.onTimePayments + 
                         risk.paymentHistory.latePayments + 
                         risk.paymentHistory.defaults;
    
    if (totalPayments > 0) {
      const lateRate = (risk.paymentHistory.latePayments + risk.paymentHistory.defaults) / totalPayments;
      if (lateRate > 0.1) {
        recommendations.push('Require prepayment or shorter settlement cycles');
        recommendations.push('Monitor payment patterns closely');
      }
    }
    
    // Risk-based recommendations
    switch (overallRisk) {
      case 'CRITICAL':
        recommendations.push('Consider suspending trading with this counterparty');
        recommendations.push('Require 100% collateralization');
        break;
      case 'HIGH':
        recommendations.push('Increase margin requirements by 50%');
        recommendations.push('Daily monitoring of positions required');
        break;
      case 'MEDIUM':
        recommendations.push('Regular review of credit limits');
        recommendations.push('Monitor for adverse changes');
        break;
    }
    
    return recommendations;
  }

  private recordCreditEvent(
    counterpartyId: string, 
    eventType: CreditEvent['eventType'], 
    description: string
  ): void {
    const risk = this.counterpartyRisks.get(counterpartyId);
    if (!risk) return;
    
    const severity = this.determineSeverity(eventType, risk);
    const impact = this.calculateEventImpact(eventType, severity);
    
    const event: CreditEvent = {
      id: `${counterpartyId}-${Date.now()}`,
      counterpartyId,
      eventType,
      severity,
      impact,
      description,
      timestamp: new Date()
    };
    
    this.creditEvents.push(event);
    this.emit('creditEvent', event);
  }

  private determineSeverity(
    eventType: CreditEvent['eventType'], 
    risk: CounterpartyRisk
  ): CreditEvent['severity'] {
    switch (eventType) {
      case 'DEFAULT':
        return 'CRITICAL';
      case 'MARGIN_BREACH':
        return risk.currentExposure > risk.exposureLimit * 1.5 ? 'HIGH' : 'MEDIUM';
      case 'LATE_PAYMENT':
        return risk.paymentHistory.latePayments > 5 ? 'HIGH' : 'LOW';
      case 'CREDIT_DOWNGRADE':
        return risk.creditScore < this.highRiskThreshold ? 'HIGH' : 'MEDIUM';
      default:
        return 'LOW';
    }
  }

  private calculateEventImpact(
    eventType: CreditEvent['eventType'], 
    severity: CreditEvent['severity']
  ): number {
    const baseImpact = {
      'DEFAULT': 100,
      'MARGIN_BREACH': 50,
      'LATE_PAYMENT': 25,
      'CREDIT_DOWNGRADE': 40
    };
    
    const severityMultiplier = {
      'LOW': 0.5,
      'MEDIUM': 1,
      'HIGH': 2,
      'CRITICAL': 3
    };
    
    return baseImpact[eventType] * severityMultiplier[severity];
  }

  private reassessCounterparty(counterpartyId: string): void {
    const risk = this.counterpartyRisks.get(counterpartyId);
    if (!risk) return;
    
    risk.lastAssessment = new Date();
    this.counterpartyRisks.set(counterpartyId, risk);
    
    // Trigger reassessment
    const matrix = this.assessCounterparty(counterpartyId);
    
    // Check if action needed
    if (matrix.overallRisk === 'HIGH' || matrix.overallRisk === 'CRITICAL') {
      this.emit('highRiskCounterparty', {
        counterpartyId,
        risk,
        matrix
      });
    }
  }

  private startRiskMonitoring(): void {
    // Periodic reassessment of all counterparties
    setInterval(() => {
      this.counterpartyRisks.forEach((risk, counterpartyId) => {
        // Reassess if not done in last 24 hours
        const hoursSinceAssessment = (Date.now() - risk.lastAssessment.getTime()) / (1000 * 60 * 60);
        if (hoursSinceAssessment > 24) {
          this.reassessCounterparty(counterpartyId);
        }
      });
    }, 60 * 60 * 1000); // Every hour
  }

  getCounterpartyRisk(counterpartyId: string): CounterpartyRisk | undefined {
    return this.counterpartyRisks.get(counterpartyId);
  }

  getCreditEvents(counterpartyId?: string, days: number = 30): CreditEvent[] {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    
    return this.creditEvents.filter(event => {
      const matchesCounterparty = !counterpartyId || event.counterpartyId === counterpartyId;
      const withinTimeframe = event.timestamp > cutoff;
      return matchesCounterparty && withinTimeframe;
    });
  }
}