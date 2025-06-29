import { EventEmitter } from 'events';
import { Position, MarginRequirement, RiskMetrics } from './types';

export interface MarginCalculation {
  userId: string;
  symbol: string;
  initialMargin: number;
  maintenanceMargin: number;
  availableMargin: number;
  marginRatio: number;
  excessMargin: number;
  marginCall: boolean;
  liquidationWarning: boolean;
  timestamp: Date;
}

export interface CrossMarginAccount {
  userId: string;
  totalCollateral: number;
  totalInitialMargin: number;
  totalMaintenanceMargin: number;
  marginLevel: number; // totalCollateral / totalInitialMargin
  isHealthy: boolean;
}

export class MarginCalculator extends EventEmitter {
  private marginRequirements: Map<string, MarginRequirement> = new Map();
  private userCollateral: Map<string, number> = new Map();
  private marginCalculations: Map<string, MarginCalculation[]> = new Map();
  private marginCallThreshold = 1.2; // 120% of maintenance margin
  private liquidationThreshold = 1.0; // 100% of maintenance margin

  constructor() {
    super();
    this.startMarginMonitoring();
  }

  setMarginRequirement(requirement: MarginRequirement): void {
    this.marginRequirements.set(requirement.symbol, requirement);
    this.emit('marginRequirementUpdated', requirement);
  }

  updateUserCollateral(userId: string, collateral: number): void {
    this.userCollateral.set(userId, collateral);
    this.emit('collateralUpdated', { userId, collateral });
  }

  calculatePositionMargin(position: Position): {
    initialMargin: number;
    maintenanceMargin: number;
    marginRequirement: MarginRequirement | undefined;
  } {
    const requirement = this.marginRequirements.get(position.symbol);
    if (!requirement) {
      // Default margin requirements
      return {
        initialMargin: position.size * position.markPrice * 0.1,
        maintenanceMargin: position.size * position.markPrice * 0.05,
        marginRequirement: undefined
      };
    }

    const notionalValue = Math.abs(position.size * position.markPrice);
    const initialMargin = notionalValue * requirement.initialMarginRate;
    const maintenanceMargin = notionalValue * requirement.maintenanceMarginRate;

    return {
      initialMargin,
      maintenanceMargin,
      marginRequirement: requirement
    };
  }

  calculateUserMargin(userId: string, positions: Position[]): MarginCalculation[] {
    const calculations: MarginCalculation[] = [];
    const totalCollateral = this.userCollateral.get(userId) || 0;
    let totalInitialMargin = 0;
    let totalMaintenanceMargin = 0;

    // Calculate margin for each position
    positions.forEach(position => {
      const { initialMargin, maintenanceMargin } = this.calculatePositionMargin(position);
      totalInitialMargin += initialMargin;
      totalMaintenanceMargin += maintenanceMargin;

      const marginRatio = position.margin > 0 ? maintenanceMargin / position.margin : 0;
      const excessMargin = position.margin - maintenanceMargin;
      const marginCall = marginRatio > this.marginCallThreshold;
      const liquidationWarning = marginRatio > this.liquidationThreshold;

      const calculation: MarginCalculation = {
        userId,
        symbol: position.symbol,
        initialMargin,
        maintenanceMargin,
        availableMargin: position.margin - initialMargin,
        marginRatio,
        excessMargin,
        marginCall,
        liquidationWarning,
        timestamp: new Date()
      };

      calculations.push(calculation);

      // Emit warnings
      if (liquidationWarning) {
        this.emit('liquidationWarning', {
          userId,
          positionId: position.id,
          symbol: position.symbol,
          marginRatio,
          calculation
        });
      } else if (marginCall) {
        this.emit('marginCall', {
          userId,
          positionId: position.id,
          symbol: position.symbol,
          marginRatio,
          calculation
        });
      }
    });

    // Store calculations for history
    if (!this.marginCalculations.has(userId)) {
      this.marginCalculations.set(userId, []);
    }
    this.marginCalculations.get(userId)!.push(...calculations);

    return calculations;
  }

  calculateCrossMargin(userId: string, positions: Position[]): CrossMarginAccount {
    const totalCollateral = this.userCollateral.get(userId) || 0;
    let totalInitialMargin = 0;
    let totalMaintenanceMargin = 0;
    let totalUnrealizedPnL = 0;

    positions.forEach(position => {
      const { initialMargin, maintenanceMargin } = this.calculatePositionMargin(position);
      totalInitialMargin += initialMargin;
      totalMaintenanceMargin += maintenanceMargin;
      totalUnrealizedPnL += position.unrealizedPnL;
    });

    // Include unrealized P&L in cross margin calculation
    const effectiveCollateral = totalCollateral + totalUnrealizedPnL;
    const marginLevel = totalInitialMargin > 0 ? effectiveCollateral / totalInitialMargin : Infinity;
    const isHealthy = marginLevel > 1.0;

    const account: CrossMarginAccount = {
      userId,
      totalCollateral: effectiveCollateral,
      totalInitialMargin,
      totalMaintenanceMargin,
      marginLevel,
      isHealthy
    };

    // Check for margin issues
    if (!isHealthy) {
      this.emit('crossMarginDeficit', account);
    }

    return account;
  }

  calculatePortfolioMargin(userId: string, positions: Position[]): {
    portfolioMargin: number;
    standardMargin: number;
    marginSavings: number;
    correlationBenefit: number;
  } {
    // Standard margin calculation
    let standardMargin = 0;
    positions.forEach(position => {
      const { initialMargin } = this.calculatePositionMargin(position);
      standardMargin += initialMargin;
    });

    // Portfolio margin with correlation benefits
    // Group positions by correlation
    const correlationGroups = this.groupPositionsByCorrelation(positions);
    let portfolioMargin = 0;

    correlationGroups.forEach(group => {
      // Calculate net exposure for correlated positions
      const netExposure = this.calculateNetExposure(group);
      const groupMargin = this.calculateGroupMargin(netExposure);
      portfolioMargin += groupMargin;
    });

    const marginSavings = standardMargin - portfolioMargin;
    const correlationBenefit = marginSavings / standardMargin;

    return {
      portfolioMargin,
      standardMargin,
      marginSavings,
      correlationBenefit
    };
  }

  getMarginHistory(userId: string, hours: number = 24): MarginCalculation[] {
    const calculations = this.marginCalculations.get(userId) || [];
    const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000);
    
    return calculations.filter(calc => calc.timestamp > cutoffTime);
  }

  private startMarginMonitoring(): void {
    // Real-time margin monitoring every 30 seconds
    setInterval(() => {
      this.emit('marginMonitoringCycle');
    }, 30000);
  }

  private groupPositionsByCorrelation(positions: Position[]): Position[][] {
    // Simplified correlation grouping
    // In production, use actual correlation matrix
    const groups: Map<string, Position[]> = new Map();
    
    // Group by base asset (simplified)
    positions.forEach(position => {
      const baseAsset = position.symbol.split('/')[0];
      if (!groups.has(baseAsset)) {
        groups.set(baseAsset, []);
      }
      groups.get(baseAsset)!.push(position);
    });

    return Array.from(groups.values());
  }

  private calculateNetExposure(positions: Position[]): number {
    let longExposure = 0;
    let shortExposure = 0;

    positions.forEach(position => {
      const exposure = position.size * position.markPrice;
      if (position.side === 'LONG') {
        longExposure += exposure;
      } else {
        shortExposure += exposure;
      }
    });

    return Math.abs(longExposure - shortExposure);
  }

  private calculateGroupMargin(netExposure: number): number {
    // Simplified group margin calculation
    // Apply portfolio margin benefits
    const baseRate = 0.08; // 8% for portfolio margin vs 10% standard
    return netExposure * baseRate;
  }

  calculateMaxLeverage(symbol: string): number {
    const requirement = this.marginRequirements.get(symbol);
    if (!requirement) {
      return 10; // Default max leverage
    }
    return Math.min(requirement.maxLeverage, 1 / requirement.initialMarginRate);
  }

  isMarginAdequate(userId: string, newPosition: {
    symbol: string;
    size: number;
    price: number;
    leverage: number;
  }): { adequate: boolean; reason?: string } {
    const collateral = this.userCollateral.get(userId) || 0;
    const requirement = this.marginRequirements.get(newPosition.symbol);
    
    if (!requirement) {
      return { adequate: false, reason: 'No margin requirement configured for symbol' };
    }

    const requiredMargin = newPosition.size * newPosition.price * requirement.initialMarginRate;
    
    if (requiredMargin > collateral) {
      return { 
        adequate: false, 
        reason: `Insufficient collateral. Required: ${requiredMargin}, Available: ${collateral}` 
      };
    }

    if (newPosition.leverage > requirement.maxLeverage) {
      return { 
        adequate: false, 
        reason: `Leverage ${newPosition.leverage}x exceeds maximum ${requirement.maxLeverage}x` 
      };
    }

    const notionalValue = newPosition.size * newPosition.price;
    if (notionalValue < requirement.minNotionalValue) {
      return { 
        adequate: false, 
        reason: `Notional value ${notionalValue} below minimum ${requirement.minNotionalValue}` 
      };
    }

    return { adequate: true };
  }
}