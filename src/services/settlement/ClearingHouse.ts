import { EventEmitter } from 'events';
import { Settlement, ClearingHouseConfig, ClearingMember } from './types';

interface RiskMetrics {
  userId: string;
  exposure: bigint;
  collateralRatio: number;
  marginUtilization: number;
  riskScore: number;
}

interface CollateralRequirement {
  userId: string;
  required: bigint;
  current: bigint;
  deficit: bigint;
}

export class ClearingHouse extends EventEmitter {
  private config: ClearingHouseConfig;
  private members: Map<string, ClearingMember> = new Map();
  private collateralPool: Map<string, bigint> = new Map();
  private defaultFund: bigint = BigInt(0);
  private pendingSettlements: Map<string, Settlement> = new Map();
  
  constructor(config?: Partial<ClearingHouseConfig>) {
    super();
    
    this.config = {
      collateralRequirement: config?.collateralRequirement || 0.1, // 10% default
      marginCallThreshold: config?.marginCallThreshold || 0.15, // 15% default
      liquidationThreshold: config?.liquidationThreshold || 0.05, // 5% default
      settlementDelay: config?.settlementDelay || 300000, // 5 minutes default
      maxBatchSize: config?.maxBatchSize || 1000
    };
  }
  
  // Process settlement through clearing house
  public async processSettlement(settlement: Settlement): Promise<void> {
    try {
      // Validate settlement
      await this.validateSettlement(settlement);
      
      // Check risk and collateral requirements
      const requirements = await this.checkCollateralRequirements(settlement);
      
      // Handle any deficits
      await this.handleCollateralDeficits(requirements);
      
      // Mark settlement as cleared
      settlement.status = 'CLEARING' as any;
      this.pendingSettlements.set(settlement.id, settlement);
      
      // Apply settlement delay for risk management
      setTimeout(() => {
        this.finalizeSettlement(settlement);
      }, this.config.settlementDelay);
      
    } catch (error) {
      this.emit('settlementRejected', { settlement, error: error.message });
      throw error;
    }
  }
  
  // Validate settlement before processing
  private async validateSettlement(settlement: Settlement): Promise<void> {
    // Check if all participants are clearing members
    const userIds = new Set<string>();
    
    for (const trade of settlement.trades) {
      userIds.add(trade.buyerId);
      userIds.add(trade.sellerId);
    }
    
    for (const userId of userIds) {
      if (!this.members.has(userId)) {
        // Auto-register new member
        await this.registerMember(userId);
      }
      
      const member = this.members.get(userId)!;
      if (member.status === 'SUSPENDED') {
        throw new Error(`Member ${userId} is suspended`);
      }
    }
    
    // Validate settlement amounts
    if (settlement.netAmounts.length === 0) {
      throw new Error('Settlement has no net amounts');
    }
  }
  
  // Check collateral requirements for settlement
  private async checkCollateralRequirements(
    settlement: Settlement
  ): Promise<CollateralRequirement[]> {
    const requirements: CollateralRequirement[] = [];
    
    for (const position of settlement.netAmounts) {
      const member = this.members.get(position.userId);
      if (!member) continue;
      
      // Calculate required collateral based on position
      const exposure = bigIntAbs(position.netAmount);
      const required = (exposure * BigInt(Math.floor(this.config.collateralRequirement * 1000))) / BigInt(1000);
      
      // Get current collateral
      const current = this.calculateTotalCollateral(member);
      
      // Check if sufficient
      if (current < required) {
        requirements.push({
          userId: position.userId,
          required,
          current,
          deficit: required - current
        });
      }
    }
    
    return requirements;
  }
  
  // Handle collateral deficits
  private async handleCollateralDeficits(
    requirements: CollateralRequirement[]
  ): Promise<void> {
    for (const req of requirements) {
      const member = this.members.get(req.userId)!;
      
      // Calculate margin utilization
      const utilization = Number(req.current) / Number(req.required);
      
      if (utilization < this.config.liquidationThreshold) {
        // Trigger liquidation
        await this.liquidateMember(member);
        throw new Error(`Member ${req.userId} liquidated due to insufficient collateral`);
        
      } else if (utilization < this.config.marginCallThreshold) {
        // Issue margin call
        member.status = 'MARGIN_CALL';
        this.emit('marginCall', {
          member,
          deficit: req.deficit,
          deadline: Date.now() + 3600000 // 1 hour
        });
      }
    }
  }
  
  // Register new clearing member
  public async registerMember(
    userId: string,
    initialCollateral?: Map<string, bigint>
  ): Promise<ClearingMember> {
    const member: ClearingMember = {
      userId,
      collateral: initialCollateral || new Map(),
      margin: BigInt(0),
      positions: new Map(),
      status: 'ACTIVE'
    };
    
    this.members.set(userId, member);
    
    // Add to default fund
    if (initialCollateral) {
      for (const [token, amount] of initialCollateral) {
        const contribution = amount / BigInt(10); // 10% to default fund
        this.defaultFund += contribution;
      }
    }
    
    this.emit('memberRegistered', member);
    return member;
  }
  
  // Deposit collateral
  public async depositCollateral(
    userId: string,
    token: string,
    amount: bigint
  ): Promise<void> {
    const member = this.members.get(userId);
    if (!member) {
      throw new Error(`Member ${userId} not found`);
    }
    
    const current = member.collateral.get(token) || BigInt(0);
    member.collateral.set(token, current + amount);
    
    // Update collateral pool
    const poolAmount = this.collateralPool.get(token) || BigInt(0);
    this.collateralPool.set(token, poolAmount + amount);
    
    // Check if this resolves margin call
    if (member.status === 'MARGIN_CALL') {
      const requirements = await this.checkMemberRequirements(member);
      if (requirements.length === 0) {
        member.status = 'ACTIVE';
        this.emit('marginCallResolved', member);
      }
    }
    
    this.emit('collateralDeposited', { userId, token, amount });
  }
  
  // Withdraw collateral
  public async withdrawCollateral(
    userId: string,
    token: string,
    amount: bigint
  ): Promise<void> {
    const member = this.members.get(userId);
    if (!member) {
      throw new Error(`Member ${userId} not found`);
    }
    
    const current = member.collateral.get(token) || BigInt(0);
    if (current < amount) {
      throw new Error('Insufficient collateral');
    }
    
    // Check if withdrawal would violate requirements
    const tempCollateral = new Map(member.collateral);
    tempCollateral.set(token, current - amount);
    
    const tempMember = { ...member, collateral: tempCollateral };
    const requirements = await this.checkMemberRequirements(tempMember);
    
    if (requirements.length > 0) {
      throw new Error('Withdrawal would violate collateral requirements');
    }
    
    // Process withdrawal
    member.collateral.set(token, current - amount);
    
    const poolAmount = this.collateralPool.get(token) || BigInt(0);
    this.collateralPool.set(token, poolAmount - amount);
    
    this.emit('collateralWithdrawn', { userId, token, amount });
  }
  
  // Calculate risk metrics for a member
  public calculateRiskMetrics(member: ClearingMember): RiskMetrics {
    const exposure = this.calculateExposure(member);
    const totalCollateral = this.calculateTotalCollateral(member);
    const collateralRatio = totalCollateral > 0 
      ? Number(totalCollateral) / Number(exposure)
      : 0;
    
    const marginUtilization = member.margin > 0
      ? Number(exposure) / Number(member.margin)
      : 0;
    
    // Calculate risk score (0-100, higher is riskier)
    let riskScore = 0;
    
    if (collateralRatio < this.config.collateralRequirement) {
      riskScore += 50;
    }
    
    if (marginUtilization > 0.8) {
      riskScore += 30;
    }
    
    if (member.status === 'MARGIN_CALL') {
      riskScore += 20;
    }
    
    return {
      userId: member.userId,
      exposure,
      collateralRatio,
      marginUtilization,
      riskScore
    };
  }
  
  // Calculate total exposure for a member
  private calculateExposure(member: ClearingMember): bigint {
    let exposure = BigInt(0);
    
    for (const [token, position] of member.positions) {
      exposure += bigIntAbs(position);
    }
    
    return exposure;
  }
  
  // Calculate total collateral value
  private calculateTotalCollateral(member: ClearingMember): bigint {
    let total = BigInt(0);
    
    for (const [token, amount] of member.collateral) {
      // In production, would convert to common denomination using price feeds
      total += amount;
    }
    
    return total;
  }
  
  // Check member requirements
  private async checkMemberRequirements(
    member: ClearingMember
  ): Promise<CollateralRequirement[]> {
    const exposure = this.calculateExposure(member);
    const required = (exposure * BigInt(Math.floor(this.config.collateralRequirement * 1000))) / BigInt(1000);
    const current = this.calculateTotalCollateral(member);
    
    if (current < required) {
      return [{
        userId: member.userId,
        required,
        current,
        deficit: required - current
      }];
    }
    
    return [];
  }
  
  // Liquidate member position
  private async liquidateMember(member: ClearingMember): Promise<void> {
    member.status = 'SUSPENDED';
    
    // Transfer positions to default fund or other members
    // In production, would implement sophisticated liquidation logic
    
    this.emit('memberLiquidated', member);
  }
  
  // Finalize settlement after delay
  private finalizeSettlement(settlement: Settlement): void {
    this.pendingSettlements.delete(settlement.id);
    this.emit('settlementCleared', settlement);
  }
  
  // Handle default scenarios
  public async handleDefault(
    userId: string,
    defaultAmount: bigint
  ): Promise<void> {
    // Use default fund to cover losses
    if (this.defaultFund >= defaultAmount) {
      this.defaultFund -= defaultAmount;
      this.emit('defaultCovered', { userId, amount: defaultAmount });
    } else {
      // Mutualize losses among members
      await this.mutualizeDefault(defaultAmount - this.defaultFund);
    }
  }
  
  // Mutualize default among members
  private async mutualizeDefault(amount: bigint): Promise<void> {
    const activeMembers = Array.from(this.members.values())
      .filter(m => m.status === 'ACTIVE');
    
    if (activeMembers.length === 0) {
      throw new Error('No active members to mutualize default');
    }
    
    const perMemberLoss = amount / BigInt(activeMembers.length);
    
    for (const member of activeMembers) {
      // Deduct from collateral
      for (const [token, collateral] of member.collateral) {
        if (collateral >= perMemberLoss) {
          member.collateral.set(token, collateral - perMemberLoss);
          break;
        }
      }
    }
    
    this.emit('defaultMutualized', { amount, memberCount: activeMembers.length });
  }
  
  // Get clearing house statistics
  public getStatistics(): any {
    return {
      totalMembers: this.members.size,
      activeMembers: Array.from(this.members.values())
        .filter(m => m.status === 'ACTIVE').length,
      defaultFundSize: this.defaultFund,
      collateralPool: Object.fromEntries(this.collateralPool),
      pendingSettlements: this.pendingSettlements.size,
      config: this.config
    };
  }
  
  // Update configuration
  public updateConfig(config: Partial<ClearingHouseConfig>): void {
    this.config = { ...this.config, ...config };
    this.emit('configUpdated', this.config);
  }
  
  // Get member information
  public getMember(userId: string): ClearingMember | undefined {
    return this.members.get(userId);
  }
  
  // Get all members
  public getAllMembers(): ClearingMember[] {
    return Array.from(this.members.values());
  }
}

// Helper function
function bigIntAbs(a: bigint): bigint {
  return a < 0 ? -a : a;
}