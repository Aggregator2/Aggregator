import { EventEmitter } from 'events';
import {
  AMLCheck,
  AMLCheckType,
  AMLCheckStatus,
  AMLProvider,
  AMLHit,
  TransactionData
} from '../types';

export interface AMLServiceConfig {
  providers: AMLProvider[];
  riskThresholds: {
    low: number;
    medium: number;
    high: number;
  };
  autoBlock: boolean;
  recheckIntervalDays: number;
  transactionMonitoring: {
    enabled: boolean;
    thresholds: {
      singleTransaction: string;
      dailyVolume: string;
      monthlyVolume: string;
    };
  };
}

export class AMLService extends EventEmitter {
  private providers: Map<string, AMLProvider> = new Map();
  private checks: Map<string, AMLCheck[]> = new Map();
  private config: AMLServiceConfig;
  private transactionHistory: Map<string, TransactionData[]> = new Map();

  constructor(config: AMLServiceConfig) {
    super();
    this.config = config;
    config.providers.forEach(provider => {
      this.providers.set(provider.name, provider);
    });
  }

  async performCheck(
    userId: string,
    name: string,
    checkTypes: AMLCheckType[] = [
      AMLCheckType.SANCTIONS,
      AMLCheckType.PEP,
      AMLCheckType.ADVERSE_MEDIA
    ],
    country?: string
  ): Promise<AMLCheck[]> {
    const results: AMLCheck[] = [];
    const primaryProvider = Array.from(this.providers.values())[0];

    if (!primaryProvider) {
      throw new Error('No AML provider configured');
    }

    for (const checkType of checkTypes) {
      try {
        let check: AMLCheck;

        switch (checkType) {
          case AMLCheckType.SANCTIONS:
            check = await primaryProvider.checkSanctions(name, country);
            break;
          case AMLCheckType.PEP:
            check = await primaryProvider.checkPEP(name);
            break;
          default:
            // For other types, use generic sanctions check as fallback
            check = await primaryProvider.checkSanctions(name, country);
            check.type = checkType;
        }

        check.userId = userId;
        check.timestamp = new Date();
        check.checkId = this.generateCheckId();

        // Calculate next check date
        check.nextCheckDate = new Date(
          Date.now() + this.config.recheckIntervalDays * 24 * 60 * 60 * 1000
        );

        // Apply risk scoring
        this.applyRiskScoring(check);

        results.push(check);
        this.storeCheck(userId, check);

        // Emit events based on status
        if (check.status === AMLCheckStatus.BLOCKED && this.config.autoBlock) {
          this.emit('aml:user:blocked', { userId, check });
        } else if (check.status === AMLCheckStatus.FLAGGED) {
          this.emit('aml:user:flagged', { userId, check });
        }
      } catch (error) {
        this.emit('aml:check:error', { userId, checkType, error: error.message });
        
        // Create error check record
        const errorCheck: AMLCheck = {
          userId,
          checkId: this.generateCheckId(),
          timestamp: new Date(),
          type: checkType,
          status: AMLCheckStatus.PENDING_REVIEW,
          riskScore: 0,
          hits: []
        };
        results.push(errorCheck);
      }
    }

    this.emit('aml:check:completed', { userId, results });
    return results;
  }

  async monitorTransaction(transaction: TransactionData): Promise<AMLCheck | null> {
    if (!this.config.transactionMonitoring.enabled) {
      return null;
    }

    const { userId } = transaction;
    
    // Store transaction
    if (!this.transactionHistory.has(userId)) {
      this.transactionHistory.set(userId, []);
    }
    this.transactionHistory.get(userId)!.push(transaction);

    // Check thresholds
    const hits: AMLHit[] = [];
    const amount = parseFloat(transaction.amount);
    const singleThreshold = parseFloat(this.config.transactionMonitoring.thresholds.singleTransaction);

    if (amount >= singleThreshold) {
      hits.push({
        source: 'TRANSACTION_MONITORING',
        matchScore: 100,
        matchedName: userId,
        reason: 'Large transaction detected',
        details: { amount: transaction.amount, threshold: singleThreshold },
        severity: 'HIGH'
      });
    }

    // Check velocity
    const velocityHit = await this.checkVelocity(userId, transaction);
    if (velocityHit) {
      hits.push(velocityHit);
    }

    // Check patterns
    const patternHits = await this.checkPatterns(userId, transaction);
    hits.push(...patternHits);

    if (hits.length === 0) {
      return null;
    }

    const check: AMLCheck = {
      userId,
      checkId: this.generateCheckId(),
      timestamp: new Date(),
      type: AMLCheckType.TRANSACTION_MONITORING,
      status: this.determineStatus(hits),
      riskScore: this.calculateRiskScore(hits),
      hits
    };

    this.storeCheck(userId, check);
    this.emit('aml:transaction:flagged', { userId, transaction, check });

    return check;
  }

  private async checkVelocity(userId: string, transaction: TransactionData): Promise<AMLHit | null> {
    const history = this.transactionHistory.get(userId) || [];
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Daily volume
    const dailyTransactions = history.filter(t => t.timestamp > oneDayAgo);
    const dailyVolume = dailyTransactions.reduce((sum, t) => sum + parseFloat(t.amount), 0);
    const dailyThreshold = parseFloat(this.config.transactionMonitoring.thresholds.dailyVolume);

    if (dailyVolume > dailyThreshold) {
      return {
        source: 'VELOCITY_CHECK',
        matchScore: 90,
        matchedName: userId,
        reason: 'Daily volume threshold exceeded',
        details: { 
          dailyVolume, 
          dailyThreshold, 
          transactionCount: dailyTransactions.length 
        },
        severity: 'HIGH'
      };
    }

    // Monthly volume
    const monthlyTransactions = history.filter(t => t.timestamp > oneMonthAgo);
    const monthlyVolume = monthlyTransactions.reduce((sum, t) => sum + parseFloat(t.amount), 0);
    const monthlyThreshold = parseFloat(this.config.transactionMonitoring.thresholds.monthlyVolume);

    if (monthlyVolume > monthlyThreshold) {
      return {
        source: 'VELOCITY_CHECK',
        matchScore: 80,
        matchedName: userId,
        reason: 'Monthly volume threshold exceeded',
        details: { 
          monthlyVolume, 
          monthlyThreshold, 
          transactionCount: monthlyTransactions.length 
        },
        severity: 'MEDIUM'
      };
    }

    return null;
  }

  private async checkPatterns(userId: string, transaction: TransactionData): Promise<AMLHit[]> {
    const hits: AMLHit[] = [];
    const history = this.transactionHistory.get(userId) || [];
    
    // Structuring detection (multiple transactions just below reporting threshold)
    const structuringThreshold = parseFloat(this.config.transactionMonitoring.thresholds.singleTransaction) * 0.9;
    const recentTransactions = history.slice(-10);
    const suspiciousTransactions = recentTransactions.filter(
      t => parseFloat(t.amount) > structuringThreshold && 
          parseFloat(t.amount) < parseFloat(this.config.transactionMonitoring.thresholds.singleTransaction)
    );

    if (suspiciousTransactions.length >= 3) {
      hits.push({
        source: 'PATTERN_DETECTION',
        matchScore: 85,
        matchedName: userId,
        reason: 'Potential structuring detected',
        details: { 
          suspiciousCount: suspiciousTransactions.length,
          amounts: suspiciousTransactions.map(t => t.amount)
        },
        severity: 'HIGH'
      });
    }

    // Rapid-fire transactions
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentHourTransactions = history.filter(t => t.timestamp > oneHourAgo);
    
    if (recentHourTransactions.length > 10) {
      hits.push({
        source: 'PATTERN_DETECTION',
        matchScore: 70,
        matchedName: userId,
        reason: 'Unusual transaction frequency',
        details: { 
          transactionCount: recentHourTransactions.length,
          timeWindow: '1 hour'
        },
        severity: 'MEDIUM'
      });
    }

    return hits;
  }

  private applyRiskScoring(check: AMLCheck): void {
    let riskScore = 0;
    
    for (const hit of check.hits) {
      const severityScore = {
        LOW: 10,
        MEDIUM: 30,
        HIGH: 60,
        CRITICAL: 100
      }[hit.severity];

      riskScore = Math.max(riskScore, (hit.matchScore / 100) * severityScore);
    }

    check.riskScore = riskScore;

    // Determine status based on risk score
    if (riskScore >= this.config.riskThresholds.high) {
      check.status = AMLCheckStatus.BLOCKED;
    } else if (riskScore >= this.config.riskThresholds.medium) {
      check.status = AMLCheckStatus.FLAGGED;
    } else if (riskScore >= this.config.riskThresholds.low) {
      check.status = AMLCheckStatus.PENDING_REVIEW;
    } else {
      check.status = AMLCheckStatus.CLEAR;
    }
  }

  private determineStatus(hits: AMLHit[]): AMLCheckStatus {
    const hasCritical = hits.some(h => h.severity === 'CRITICAL');
    const hasHigh = hits.some(h => h.severity === 'HIGH');
    
    if (hasCritical) return AMLCheckStatus.BLOCKED;
    if (hasHigh) return AMLCheckStatus.FLAGGED;
    if (hits.length > 0) return AMLCheckStatus.PENDING_REVIEW;
    return AMLCheckStatus.CLEAR;
  }

  private calculateRiskScore(hits: AMLHit[]): number {
    if (hits.length === 0) return 0;
    
    const scores = hits.map(hit => {
      const severityMultiplier = {
        LOW: 0.25,
        MEDIUM: 0.5,
        HIGH: 0.75,
        CRITICAL: 1
      }[hit.severity];
      
      return hit.matchScore * severityMultiplier;
    });
    
    return Math.max(...scores);
  }

  private storeCheck(userId: string, check: AMLCheck): void {
    if (!this.checks.has(userId)) {
      this.checks.set(userId, []);
    }
    this.checks.get(userId)!.push(check);
  }

  private generateCheckId(): string {
    return `CHK_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  getChecks(userId: string): AMLCheck[] {
    return this.checks.get(userId) || [];
  }

  getLatestCheck(userId: string, type?: AMLCheckType): AMLCheck | null {
    const userChecks = this.getChecks(userId);
    const filtered = type 
      ? userChecks.filter(c => c.type === type)
      : userChecks;
    
    return filtered.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())[0] || null;
  }

  isCleared(userId: string): boolean {
    const latestCheck = this.getLatestCheck(userId);
    return latestCheck ? latestCheck.status === AMLCheckStatus.CLEAR : false;
  }

  async reviewCheck(checkId: string, status: AMLCheckStatus, notes?: string): Promise<void> {
    let found = false;
    
    for (const [userId, checks] of this.checks.entries()) {
      const check = checks.find(c => c.checkId === checkId);
      if (check) {
        check.status = status;
        this.emit('aml:check:reviewed', { userId, checkId, status, notes });
        found = true;
        break;
      }
    }
    
    if (!found) {
      throw new Error('Check not found');
    }
  }

  // Batch operations
  async batchCheck(entities: Array<{ userId: string; name: string; country?: string }>): Promise<Map<string, AMLCheck[]>> {
    const results = new Map<string, AMLCheck[]>();
    
    for (const entity of entities) {
      try {
        const checks = await this.performCheck(entity.userId, entity.name, undefined, entity.country);
        results.set(entity.userId, checks);
      } catch (error) {
        this.emit('aml:batch:error', { entity, error: error.message });
        results.set(entity.userId, []);
      }
    }
    
    return results;
  }

  // Get users requiring recheck
  getUsersForRecheck(): string[] {
    const now = new Date();
    const usersToRecheck: string[] = [];

    for (const [userId, checks] of this.checks.entries()) {
      const latestCheck = this.getLatestCheck(userId);
      if (latestCheck && latestCheck.nextCheckDate && latestCheck.nextCheckDate < now) {
        usersToRecheck.push(userId);
      }
    }

    return usersToRecheck;
  }
}