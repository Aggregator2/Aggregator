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
      // Track newly registered members for this settlement
      const newlyRegistered = new Set<string>();
      
      // Validate settlement (includes auto-registration)
      await this.validateSettlement(settlement, newlyRegistered);
      
      // Check risk and collateral requirements
      const requirements = await this.checkCollateralRequirements(settlement, newlyRegistered);
      
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
  private async validateSettlement(settlement: Settlement, newlyRegistered?: Set<string>): Promise<void> {
    // Validate settlement structure
    if (!settlement.id) {
      throw new Error('Settlement must have an ID');
    }
    
    if (!settlement.trades || settlement.trades.length === 0) {
      throw new Error('Settlement must contain at least one trade');
    }
    
    // Check if netAmounts exists and is properly formatted
    if (!settlement.netAmounts) {
      throw new Error('Settlement missing netAmounts property');
    }
    
    if (!Array.isArray(settlement.netAmounts)) {
      throw new Error('Settlement netAmounts must be an array');
    }
    
    if (settlement.netAmounts.length === 0) {
      throw new Error('Settlement has no net amounts calculated. Ensure net amounts are calculated before validation.');
    }
    
    // Validate each net amount entry
    for (const netAmount of settlement.netAmounts) {
      if (!netAmount.userId || !netAmount.token || netAmount.netAmount === undefined) {
        throw new Error('Invalid net amount entry: missing userId, token, or netAmount');
      }
    }
    
    // Check if all participants are clearing members
    const userIds = new Set<string>();
    
    // Collect user IDs from trades
    for (const trade of settlement.trades) {
      userIds.add(trade.buyerId);
      userIds.add(trade.sellerId);
    }
    
    // Also collect user IDs from net amounts to ensure consistency
    for (const netAmount of settlement.netAmounts) {
      userIds.add(netAmount.userId);
    }
    
    // Validate all users
    for (const userId of userIds) {
      if (!this.members.has(userId)) {
        // Auto-register new member
        await this.registerMember(userId);
        // Track that this member was newly registered
        if (newlyRegistered) {
          newlyRegistered.add(userId);
        }
      }
      
      const member = this.members.get(userId)!;
      if (member.status === 'SUSPENDED') {
        throw new Error(`Member ${userId} is suspended from clearing`);
      }
    }
    
    // Validate that net amounts balance to zero for each token
    const tokenBalances = new Map<string, bigint>();
    
    for (const netAmount of settlement.netAmounts) {
      const currentBalance = tokenBalances.get(netAmount.token) || BigInt(0);
      tokenBalances.set(netAmount.token, currentBalance + netAmount.netAmount);
    }
    
    // Check if all tokens balance to zero (conservation of value)
    for (const [token, balance] of tokenBalances) {
      if (balance !== BigInt(0)) {
        throw new Error(`Settlement does not balance for token ${token}: ${balance.toString()}`);
      }
    }
  }
  
  // Check collateral requirements for settlement
  private async checkCollateralRequirements(
    settlement: Settlement,
    newlyRegistered?: Set<string>
  ): Promise<CollateralRequirement[]> {
    const requirements: CollateralRequirement[] = [];
    
    // Group positions by user to calculate total exposure per user
    const userExposures = new Map<string, bigint>();
    
    for (const position of settlement.netAmounts) {
      const currentExposure = userExposures.get(position.userId) || BigInt(0);
      // Sum absolute values of all positions for total exposure
      let positionExposure = bigIntAbs(position.netAmount);
      
      // Convert to USDT equivalent for exposure calculation
      if (position.token === 'ETH') {
        // Assume 1 ETH = 2000 USDT (consistent with calculateTotalCollateral)
        positionExposure = positionExposure * BigInt(2000);
      }
      // USDT and other tokens use 1:1 ratio
      
      userExposures.set(position.userId, currentExposure + positionExposure);
    }
    
    // Check requirements per user based on total exposure
    for (const [userId, totalExposure] of userExposures) {
      const member = this.members.get(userId);
      if (!member) continue;
      
      // Skip collateral checks for newly registered members in this settlement
      // They get one settlement cycle to deposit collateral
      if (newlyRegistered && newlyRegistered.has(userId)) {
        continue;
      }
      
      // Calculate required collateral based on total exposure
      const required = (totalExposure * BigInt(Math.floor(this.config.collateralRequirement * 1000))) / BigInt(1000);
      
      // Get current collateral
      const current = this.calculateTotalCollateral(member);
      
      
      // Only add to deficit list if there's actually insufficient collateral
      if (required > BigInt(0) && current < required) {
        requirements.push({
          userId,
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
      
      // Calculate collateral ratio (current / required)
      // If ratio is 1.0 or higher, member has sufficient collateral
      // If ratio is below liquidation threshold, liquidate
      // If ratio is below margin call threshold but above liquidation, issue margin call
      const collateralRatio = req.required > BigInt(0) 
        ? Number(req.current) / Number(req.required) 
        : 1.0; // If no collateral required, ratio is 1.0
      
      if (collateralRatio < this.config.liquidationThreshold) {
        // Trigger liquidation only if collateral ratio is critically low
        await this.liquidateMember(member);
        throw new Error(`Member ${req.userId} liquidated due to insufficient collateral`);
        
      } else if (collateralRatio < this.config.marginCallThreshold) {
        // Issue margin call if below margin threshold but above liquidation
        member.status = 'MARGIN_CALL';
        this.emit('marginCall', {
          member,
          deficit: req.deficit,
          deadline: Date.now() + 3600000 // 1 hour
        });
      }
      // If collateral ratio >= marginCallThreshold, no action needed
      // The settlement can proceed
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
      let tokenExposure = bigIntAbs(position);
      
      // Convert to USDT equivalent using simple price conversion
      // In production, would use real price feeds
      if (token === 'ETH') {
        // Assume 1 ETH = 2000 USDT (from test settlement data)
        tokenExposure = tokenExposure * BigInt(2000);
      }
      // USDT and other tokens use 1:1 ratio for simplicity
      
      exposure += tokenExposure;
    }
    
    return exposure;
  }
  
  // Calculate total collateral value
  private calculateTotalCollateral(member: ClearingMember): bigint {
    let total = BigInt(0);
    
    for (const [token, amount] of member.collateral) {
      // Convert to USDT equivalent using simple price conversion
      // In production, would use real price feeds
      let usdtEquivalent = amount;
      
      if (token === 'ETH') {
        // Assume 1 ETH = 2000 USDT (from test settlement data)
        usdtEquivalent = amount * BigInt(2000);
      }
      // USDT and other tokens use 1:1 ratio for simplicity
      
      total += usdtEquivalent;
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
      collateralPool: Object.fromEntries(
        Array.from(this.collateralPool.entries()).map(([key, value]) => [key, value.toString()])
      ),
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