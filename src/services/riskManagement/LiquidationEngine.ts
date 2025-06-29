import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { Position, LiquidationEvent, RiskMetrics } from './types';
import { PositionManager } from './PositionManager';
import { MarginCalculator } from './MarginCalculator';

export interface LiquidationCandidate {
  position: Position;
  healthFactor: number;
  marginRatio: number;
  estimatedLoss: number;
  priority: number; // Higher priority = liquidate first
}

export interface LiquidationResult {
  liquidationEvent: LiquidationEvent;
  remainingPosition?: Position;
  insuranceFundImpact: number;
  socializedLoss: number;
}

export interface AutoDeleveragingEvent {
  id: string;
  positions: Position[];
  totalDeleveraged: number;
  affectedUsers: string[];
  reason: string;
  timestamp: Date;
}

export class LiquidationEngine extends EventEmitter {
  private positionManager: PositionManager;
  private marginCalculator: MarginCalculator;
  private liquidationQueue: LiquidationCandidate[] = [];
  private isProcessing = false;
  private liquidationFeeRate = 0.01; // 1% liquidation fee
  private insuranceFundContributionRate = 0.005; // 0.5% to insurance fund
  private maxSlippage = 0.02; // 2% max slippage during liquidation
  
  constructor(
    positionManager: PositionManager,
    marginCalculator: MarginCalculator
  ) {
    super();
    this.positionManager = positionManager;
    this.marginCalculator = marginCalculator;
    this.startLiquidationMonitoring();
  }

  private startLiquidationMonitoring(): void {
    // Monitor positions every 5 seconds
    setInterval(() => {
      if (!this.isProcessing) {
        this.scanForLiquidations();
      }
    }, 5000);

    // Listen for margin warnings
    this.marginCalculator.on('liquidationWarning', (data) => {
      this.addToLiquidationQueue(data);
    });
  }

  private async scanForLiquidations(): Promise<void> {
    this.emit('liquidationScanStarted');
    
    // Get all positions from position manager
    // In production, this would query from database
    const allPositions = this.getAllPositions();
    const candidates: LiquidationCandidate[] = [];

    for (const position of allPositions) {
      const riskMetrics = this.positionManager.getUserRiskMetrics(position.userId);
      const marginCalc = this.marginCalculator.calculatePositionMargin(position);
      
      const healthFactor = position.margin / marginCalc.maintenanceMargin;
      const marginRatio = marginCalc.maintenanceMargin / position.margin;

      // Check if position needs liquidation
      if (healthFactor < 1.0 || this.checkLiquidationPrice(position)) {
        const estimatedLoss = this.estimateLiquidationLoss(position);
        
        candidates.push({
          position,
          healthFactor,
          marginRatio,
          estimatedLoss,
          priority: this.calculateLiquidationPriority(healthFactor, position.size * position.markPrice)
        });
      }
    }

    // Sort by priority (highest first)
    candidates.sort((a, b) => b.priority - a.priority);
    
    // Add to queue
    this.liquidationQueue.push(...candidates);
    
    this.emit('liquidationScanCompleted', {
      candidatesFound: candidates.length,
      queueSize: this.liquidationQueue.length
    });

    // Process queue if not already processing
    if (this.liquidationQueue.length > 0 && !this.isProcessing) {
      await this.processLiquidationQueue();
    }
  }

  private async processLiquidationQueue(): Promise<void> {
    this.isProcessing = true;
    
    while (this.liquidationQueue.length > 0) {
      const candidate = this.liquidationQueue.shift()!;
      
      try {
        const result = await this.liquidatePosition(candidate);
        this.emit('positionLiquidated', result);
      } catch (error) {
        this.emit('liquidationError', {
          candidate,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
    
    this.isProcessing = false;
  }

  async liquidatePosition(candidate: LiquidationCandidate): Promise<LiquidationResult> {
    const { position } = candidate;
    
    // Calculate liquidation price with slippage
    const liquidationPrice = this.calculateLiquidationExecutionPrice(position);
    
    // Calculate losses
    const grossLoss = Math.abs(
      position.side === 'LONG' 
        ? position.size * (position.entryPrice - liquidationPrice)
        : position.size * (liquidationPrice - position.entryPrice)
    );
    
    const liquidationFee = position.size * liquidationPrice * this.liquidationFeeRate;
    const insuranceFundContribution = position.size * liquidationPrice * this.insuranceFundContributionRate;
    const netLoss = grossLoss + liquidationFee;
    
    // Check if loss exceeds margin (socialized loss scenario)
    const socializedLoss = Math.max(0, netLoss - position.margin);
    
    // Create liquidation event
    const liquidationEvent: LiquidationEvent = {
      id: uuidv4(),
      positionId: position.id,
      userId: position.userId,
      symbol: position.symbol,
      side: position.side,
      size: position.size,
      liquidationPrice: position.liquidationPrice,
      executionPrice: liquidationPrice,
      loss: netLoss,
      insuranceFundContribution,
      timestamp: new Date(),
      reason: this.determineLiquidationReason(candidate)
    };

    // Close the position
    await this.positionManager.closePosition(position.id, liquidationPrice);
    
    // Handle partial liquidation if enabled
    const remainingPosition = await this.handlePartialLiquidation(position, candidate);
    
    return {
      liquidationEvent,
      remainingPosition,
      insuranceFundImpact: insuranceFundContribution - socializedLoss,
      socializedLoss
    };
  }

  private async handlePartialLiquidation(
    position: Position, 
    candidate: LiquidationCandidate
  ): Promise<Position | undefined> {
    // Check if partial liquidation is beneficial
    const partialSize = this.calculatePartialLiquidationSize(position, candidate);
    
    if (partialSize > 0 && partialSize < position.size) {
      const remainingSize = position.size - partialSize;
      const remainingMargin = position.margin * (remainingSize / position.size);
      
      // Create new position with remaining size
      const remainingPosition = await this.positionManager.createPosition({
        userId: position.userId,
        symbol: position.symbol,
        side: position.side,
        size: remainingSize,
        entryPrice: position.entryPrice,
        leverage: position.leverage,
        margin: remainingMargin
      });
      
      return remainingPosition;
    }
    
    return undefined;
  }

  async triggerAutoDeleveraging(symbol: string): Promise<AutoDeleveragingEvent> {
    // Get all profitable positions in opposite direction
    const positions = this.getAllPositions().filter(p => 
      p.symbol === symbol && p.unrealizedPnL > 0
    );
    
    // Sort by PnL ranking (most profitable first)
    positions.sort((a, b) => {
      const aPnlRatio = a.unrealizedPnL / (a.size * a.markPrice);
      const bPnlRatio = b.unrealizedPnL / (b.size * b.markPrice);
      return bPnlRatio - aPnlRatio;
    });
    
    let totalDeleveraged = 0;
    const affectedUsers: string[] = [];
    const deleveragedPositions: Position[] = [];
    
    // Deleverage positions until system is stable
    for (const position of positions) {
      const deleverageAmount = Math.min(
        position.size * 0.5, // Max 50% deleverage per position
        this.calculateRequiredDeleverageAmount(symbol)
      );
      
      if (deleverageAmount > 0) {
        await this.positionManager.updatePosition(position.id, {
          size: position.size - deleverageAmount
        });
        
        totalDeleveraged += deleverageAmount;
        affectedUsers.push(position.userId);
        deleveragedPositions.push(position);
      }
      
      if (this.isSystemStable(symbol)) {
        break;
      }
    }
    
    const event: AutoDeleveragingEvent = {
      id: uuidv4(),
      positions: deleveragedPositions,
      totalDeleveraged,
      affectedUsers,
      reason: 'System risk threshold exceeded',
      timestamp: new Date()
    };
    
    this.emit('autoDeleveragingTriggered', event);
    return event;
  }

  private checkLiquidationPrice(position: Position): boolean {
    if (position.side === 'LONG') {
      return position.markPrice <= position.liquidationPrice;
    } else {
      return position.markPrice >= position.liquidationPrice;
    }
  }

  private calculateLiquidationPriority(healthFactor: number, notionalValue: number): number {
    // Lower health factor = higher priority
    // Larger position = higher priority
    const healthScore = (1 - healthFactor) * 100;
    const sizeScore = Math.log10(notionalValue) * 10;
    return healthScore + sizeScore;
  }

  private calculateLiquidationExecutionPrice(position: Position): number {
    // Account for slippage during liquidation
    const slippage = this.maxSlippage * (position.size * position.markPrice / 1000000); // Size impact
    
    if (position.side === 'LONG') {
      return position.markPrice * (1 - slippage);
    } else {
      return position.markPrice * (1 + slippage);
    }
  }

  private estimateLiquidationLoss(position: Position): number {
    const executionPrice = this.calculateLiquidationExecutionPrice(position);
    
    if (position.side === 'LONG') {
      return Math.max(0, position.size * (position.entryPrice - executionPrice));
    } else {
      return Math.max(0, position.size * (executionPrice - position.entryPrice));
    }
  }

  private calculatePartialLiquidationSize(position: Position, candidate: LiquidationCandidate): number {
    // Liquidate enough to bring health factor back to safe levels
    const targetHealthFactor = 1.5;
    const currentHealthFactor = candidate.healthFactor;
    
    if (currentHealthFactor >= targetHealthFactor) {
      return 0;
    }
    
    // Calculate size needed to reach target health factor
    const marginNeeded = candidate.marginRatio * targetHealthFactor;
    const sizeRatio = position.margin / marginNeeded;
    
    return position.size * (1 - sizeRatio);
  }

  private determineLiquidationReason(candidate: LiquidationCandidate): LiquidationEvent['reason'] {
    if (candidate.healthFactor < 0.5) {
      return 'FORCED';
    } else if (candidate.marginRatio > 1.0) {
      return 'MARGIN_CALL';
    } else {
      return 'STOP_LOSS';
    }
  }

  private calculateRequiredDeleverageAmount(symbol: string): number {
    // Placeholder - calculate based on system risk metrics
    return 1000;
  }

  private isSystemStable(symbol: string): boolean {
    // Placeholder - check overall system health
    return true;
  }

  private getAllPositions(): Position[] {
    // Placeholder - in production, query from database
    return [];
  }

  private addToLiquidationQueue(data: any): void {
    // Add position to liquidation queue from margin warning
    const position = this.positionManager.getUserPositions(data.userId)
      .find(p => p.id === data.positionId);
      
    if (position) {
      this.liquidationQueue.push({
        position,
        healthFactor: data.calculation.marginRatio,
        marginRatio: data.marginRatio,
        estimatedLoss: this.estimateLiquidationLoss(position),
        priority: this.calculateLiquidationPriority(data.calculation.marginRatio, position.size * position.markPrice)
      });
    }
  }

  getLiquidationQueue(): LiquidationCandidate[] {
    return [...this.liquidationQueue];
  }

  clearLiquidationQueue(): void {
    this.liquidationQueue = [];
  }
}