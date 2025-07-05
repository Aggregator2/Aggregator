import { EventEmitter } from 'events';
import {
  ComplianceRule,
  RuleCategory,
  RuleCondition,
  RuleAction,
  KYCData,
  KYCStatus,
  KYCLevel,
  AMLCheck,
  AMLCheckStatus
} from '../types';

export interface RuleContext {
  userId?: string;
  action: string; // e.g., 'TRADE', 'WITHDRAW', 'DEPOSIT'
  amount?: string;
  currency?: string;
  pairId?: string;
  userKYC?: KYCData;
  userAML?: AMLCheck;
  metadata?: Record<string, any>;
}

export interface RuleResult {
  ruleId: string;
  ruleName: string;
  matched: boolean;
  actions: RuleAction[];
  reason?: string;
}

export interface ComplianceCheckResult {
  allowed: boolean;
  results: RuleResult[];
  requiredActions: RuleAction[];
  blockedBy?: string[];
  warnings?: string[];
}

export class ComplianceRulesEngine extends EventEmitter {
  private rules: Map<string, ComplianceRule> = new Map();
  private rulesByCategory: Map<RuleCategory, ComplianceRule[]> = new Map();

  constructor() {
    super();
    this.initializeDefaultRules();
  }

  private initializeDefaultRules(): void {
    // KYC Rules
    this.addRule({
      ruleId: 'KYC_REQUIRED_LARGE_TRADE',
      name: 'KYC Required for Large Trades',
      description: 'Enhanced KYC required for trades over $10,000',
      category: RuleCategory.KYC,
      enabled: true,
      conditions: [
        { field: 'action', operator: 'EQ', value: 'TRADE' },
        { field: 'amount', operator: 'GTE', value: '10000', combineWith: 'AND' }
      ],
      actions: [
        { type: 'REQUIRE_APPROVAL', params: { kycLevel: KYCLevel.ENHANCED } }
      ],
      priority: 100,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    this.addRule({
      ruleId: 'KYC_EXPIRED_BLOCK',
      name: 'Block Expired KYC',
      description: 'Block all actions for users with expired KYC',
      category: RuleCategory.KYC,
      enabled: true,
      conditions: [
        { field: 'userKYC.status', operator: 'EQ', value: KYCStatus.EXPIRED }
      ],
      actions: [
        { type: 'BLOCK', params: { reason: 'KYC verification expired' } }
      ],
      priority: 200,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    // AML Rules
    this.addRule({
      ruleId: 'AML_BLOCKED_USER',
      name: 'Block AML Flagged Users',
      description: 'Block all actions for users flagged by AML',
      category: RuleCategory.AML,
      enabled: true,
      conditions: [
        { field: 'userAML.status', operator: 'EQ', value: AMLCheckStatus.BLOCKED }
      ],
      actions: [
        { type: 'BLOCK', params: { reason: 'User blocked by AML check' } },
        { type: 'NOTIFY', params: { team: 'compliance', priority: 'HIGH' } }
      ],
      priority: 300,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    this.addRule({
      ruleId: 'AML_HIGH_RISK_APPROVAL',
      name: 'High Risk Transaction Approval',
      description: 'Require approval for high risk users',
      category: RuleCategory.AML,
      enabled: true,
      conditions: [
        { field: 'userAML.riskScore', operator: 'GTE', value: 70 },
        { field: 'amount', operator: 'GTE', value: '5000', combineWith: 'AND' }
      ],
      actions: [
        { type: 'REQUIRE_APPROVAL', params: { approver: 'compliance_team' } },
        { type: 'LOG', params: { level: 'WARNING' } }
      ],
      priority: 150,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    // Trading Rules
    this.addRule({
      ruleId: 'TRADE_VELOCITY_LIMIT',
      name: 'Trade Velocity Limit',
      description: 'Limit number of trades per hour',
      category: RuleCategory.TRADING,
      enabled: true,
      conditions: [
        { field: 'action', operator: 'EQ', value: 'TRADE' },
        { field: 'metadata.tradesLastHour', operator: 'GTE', value: 100, combineWith: 'AND' }
      ],
      actions: [
        { type: 'BLOCK', params: { reason: 'Trade velocity limit exceeded' } },
        { type: 'FLAG', params: { type: 'UNUSUAL_ACTIVITY' } }
      ],
      priority: 50,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    // Withdrawal Rules
    this.addRule({
      ruleId: 'WITHDRAWAL_DAILY_LIMIT',
      name: 'Daily Withdrawal Limit',
      description: 'Enforce daily withdrawal limits',
      category: RuleCategory.WITHDRAWAL,
      enabled: true,
      conditions: [
        { field: 'action', operator: 'EQ', value: 'WITHDRAW' },
        { field: 'metadata.dailyWithdrawalTotal', operator: 'GTE', value: '100000', combineWith: 'AND' }
      ],
      actions: [
        { type: 'BLOCK', params: { reason: 'Daily withdrawal limit exceeded' } },
        { type: 'NOTIFY', params: { user: true, message: 'Daily limit reached' } }
      ],
      priority: 100,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    this.addRule({
      ruleId: 'WITHDRAWAL_PATTERN_CHECK',
      name: 'Suspicious Withdrawal Pattern',
      description: 'Flag unusual withdrawal patterns',
      category: RuleCategory.WITHDRAWAL,
      enabled: true,
      conditions: [
        { field: 'action', operator: 'EQ', value: 'WITHDRAW' },
        { field: 'metadata.withdrawalsLast24h', operator: 'GTE', value: 5, combineWith: 'AND' }
      ],
      actions: [
        { type: 'FLAG', params: { type: 'SUSPICIOUS_PATTERN' } },
        { type: 'REQUIRE_APPROVAL', params: { delay: '30m' } }
      ],
      priority: 75,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    // Deposit Rules
    this.addRule({
      ruleId: 'DEPOSIT_SOURCE_CHECK',
      name: 'Deposit Source Verification',
      description: 'Verify source of large deposits',
      category: RuleCategory.DEPOSIT,
      enabled: true,
      jurisdiction: ['US', 'EU'],
      conditions: [
        { field: 'action', operator: 'EQ', value: 'DEPOSIT' },
        { field: 'amount', operator: 'GTE', value: '50000', combineWith: 'AND' }
      ],
      actions: [
        { type: 'REQUIRE_APPROVAL', params: { document: 'SOURCE_OF_FUNDS' } },
        { type: 'LOG', params: { level: 'INFO' } }
      ],
      priority: 80,
      createdAt: new Date(),
      updatedAt: new Date()
    });
  }

  async checkCompliance(context: RuleContext): Promise<ComplianceCheckResult> {
    const applicableRules = this.getApplicableRules(context);
    const results: RuleResult[] = [];
    const blockedBy: string[] = [];
    const requiredActions: RuleAction[] = [];
    const warnings: string[] = [];

    for (const rule of applicableRules) {
      const result = this.evaluateRule(rule, context);
      results.push(result);

      if (result.matched) {
        for (const action of result.actions) {
          if (action.type === 'BLOCK') {
            blockedBy.push(rule.name);
          } else if (action.type === 'REQUIRE_APPROVAL') {
            requiredActions.push(action);
          } else if (action.type === 'FLAG' || action.type === 'LOG') {
            warnings.push(`${rule.name}: ${action.params?.reason || 'Flagged for review'}`);
          }

          // Execute action
          await this.executeAction(action, context, rule);
        }
      }
    }

    const allowed = blockedBy.length === 0;

    const checkResult: ComplianceCheckResult = {
      allowed,
      results,
      requiredActions,
      blockedBy: blockedBy.length > 0 ? blockedBy : undefined,
      warnings: warnings.length > 0 ? warnings : undefined
    };

    this.emit('compliance:check:completed', { context, result: checkResult });

    return checkResult;
  }

  private getApplicableRules(context: RuleContext): ComplianceRule[] {
    let rules: ComplianceRule[] = [];

    // Get rules by action category
    if (context.action === 'TRADE') {
      rules.push(...(this.rulesByCategory.get(RuleCategory.TRADING) || []));
    } else if (context.action === 'WITHDRAW') {
      rules.push(...(this.rulesByCategory.get(RuleCategory.WITHDRAWAL) || []));
    } else if (context.action === 'DEPOSIT') {
      rules.push(...(this.rulesByCategory.get(RuleCategory.DEPOSIT) || []));
    }

    // Always include KYC and AML rules
    rules.push(...(this.rulesByCategory.get(RuleCategory.KYC) || []));
    rules.push(...(this.rulesByCategory.get(RuleCategory.AML) || []));

    // Filter by enabled and jurisdiction
    rules = rules.filter(rule => {
      if (!rule.enabled) return false;
      
      if (rule.jurisdiction && context.metadata?.jurisdiction) {
        return rule.jurisdiction.includes(context.metadata.jurisdiction);
      }
      
      return true;
    });

    // Sort by priority (higher priority first)
    return rules.sort((a, b) => b.priority - a.priority);
  }

  private evaluateRule(rule: ComplianceRule, context: RuleContext): RuleResult {
    let matched = true;
    let currentResult = true;

    for (let i = 0; i < rule.conditions.length; i++) {
      const condition = rule.conditions[i];
      const conditionResult = this.evaluateCondition(condition, context);

      if (i === 0) {
        currentResult = conditionResult;
      } else {
        const combineWith = rule.conditions[i - 1].combineWith || 'AND';
        if (combineWith === 'AND') {
          currentResult = currentResult && conditionResult;
        } else {
          currentResult = currentResult || conditionResult;
        }
      }
    }

    matched = currentResult;

    return {
      ruleId: rule.ruleId,
      ruleName: rule.name,
      matched,
      actions: matched ? rule.actions : [],
      reason: matched ? rule.description : undefined
    };
  }

  private evaluateCondition(condition: RuleCondition, context: RuleContext): boolean {
    const value = this.getFieldValue(context, condition.field);
    const conditionValue = condition.value;

    switch (condition.operator) {
      case 'EQ':
        return value == conditionValue;
      case 'NE':
        return value != conditionValue;
      case 'GT':
        return parseFloat(value) > parseFloat(conditionValue);
      case 'GTE':
        return parseFloat(value) >= parseFloat(conditionValue);
      case 'LT':
        return parseFloat(value) < parseFloat(conditionValue);
      case 'LTE':
        return parseFloat(value) <= parseFloat(conditionValue);
      case 'IN':
        return Array.isArray(conditionValue) && conditionValue.includes(value);
      case 'NOT_IN':
        return Array.isArray(conditionValue) && !conditionValue.includes(value);
      case 'CONTAINS':
        return String(value).includes(String(conditionValue));
      default:
        return false;
    }
  }

  private getFieldValue(context: RuleContext, field: string): any {
    const fields = field.split('.');
    let value: any = context;

    for (const f of fields) {
      if (value && typeof value === 'object' && f in value) {
        value = value[f];
      } else {
        return undefined;
      }
    }

    return value;
  }

  private async executeAction(
    action: RuleAction,
    context: RuleContext,
    rule: ComplianceRule
  ): Promise<void> {
    switch (action.type) {
      case 'BLOCK':
        this.emit('compliance:action:block', {
          userId: context.userId,
          action: context.action,
          reason: action.params?.reason || rule.description
        });
        break;

      case 'FLAG':
        this.emit('compliance:action:flag', {
          userId: context.userId,
          action: context.action,
          flagType: action.params?.type,
          rule: rule.name
        });
        break;

      case 'REQUIRE_APPROVAL':
        this.emit('compliance:action:approval', {
          userId: context.userId,
          action: context.action,
          approvalType: action.params,
          rule: rule.name
        });
        break;

      case 'NOTIFY':
        this.emit('compliance:action:notify', {
          recipient: action.params?.team || action.params?.user,
          message: action.params?.message || `Rule triggered: ${rule.name}`,
          priority: action.params?.priority || 'MEDIUM'
        });
        break;

      case 'LOG':
        this.emit('compliance:action:log', {
          level: action.params?.level || 'INFO',
          message: `Compliance rule triggered: ${rule.name}`,
          context
        });
        break;

      case 'ESCALATE':
        this.emit('compliance:action:escalate', {
          userId: context.userId,
          action: context.action,
          rule: rule.name,
          escalationLevel: action.params?.level || 1
        });
        break;
    }
  }

  // Rule Management
  addRule(rule: ComplianceRule): void {
    this.rules.set(rule.ruleId, rule);
    
    if (!this.rulesByCategory.has(rule.category)) {
      this.rulesByCategory.set(rule.category, []);
    }
    this.rulesByCategory.get(rule.category)!.push(rule);
    
    this.emit('rule:added', rule);
  }

  updateRule(ruleId: string, updates: Partial<ComplianceRule>): void {
    const rule = this.rules.get(ruleId);
    if (!rule) {
      throw new Error('Rule not found');
    }

    const updatedRule = {
      ...rule,
      ...updates,
      updatedAt: new Date()
    };

    this.rules.set(ruleId, updatedRule);
    
    // Update category index
    this.rebuildCategoryIndex();
    
    this.emit('rule:updated', updatedRule);
  }

  deleteRule(ruleId: string): void {
    const rule = this.rules.get(ruleId);
    if (!rule) {
      throw new Error('Rule not found');
    }

    this.rules.delete(ruleId);
    this.rebuildCategoryIndex();
    
    this.emit('rule:deleted', rule);
  }

  private rebuildCategoryIndex(): void {
    this.rulesByCategory.clear();
    
    for (const rule of this.rules.values()) {
      if (!this.rulesByCategory.has(rule.category)) {
        this.rulesByCategory.set(rule.category, []);
      }
      this.rulesByCategory.get(rule.category)!.push(rule);
    }
  }

  getRules(filters?: {
    category?: RuleCategory;
    enabled?: boolean;
    jurisdiction?: string;
  }): ComplianceRule[] {
    let rules = Array.from(this.rules.values());

    if (filters) {
      if (filters.category !== undefined) {
        rules = rules.filter(r => r.category === filters.category);
      }
      if (filters.enabled !== undefined) {
        rules = rules.filter(r => r.enabled === filters.enabled);
      }
      if (filters.jurisdiction) {
        rules = rules.filter(r => 
          !r.jurisdiction || r.jurisdiction.includes(filters.jurisdiction)
        );
      }
    }

    return rules.sort((a, b) => b.priority - a.priority);
  }

  // Bulk operations
  async bulkCheck(contexts: RuleContext[]): Promise<ComplianceCheckResult[]> {
    const results: ComplianceCheckResult[] = [];
    
    for (const context of contexts) {
      results.push(await this.checkCompliance(context));
    }
    
    return results;
  }

  // Testing and simulation
  async simulateRule(rule: ComplianceRule, context: RuleContext): Promise<RuleResult> {
    return this.evaluateRule(rule, context);
  }

  async testRules(testCases: Array<{ context: RuleContext; expectedResult: boolean }>): Promise<Array<{ passed: boolean; details: any }>> {
    const results = [];
    
    for (const testCase of testCases) {
      const result = await this.checkCompliance(testCase.context);
      const passed = result.allowed === testCase.expectedResult;
      
      results.push({
        passed,
        details: {
          context: testCase.context,
          expected: testCase.expectedResult,
          actual: result.allowed,
          rules: result.results
        }
      });
    }
    
    return results;
  }
}