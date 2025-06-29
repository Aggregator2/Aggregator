import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import { Position, PositionLimit, RiskMetrics, MarginRequirement } from './types';

export class PositionManager extends EventEmitter {
  private positions: Map<string, Position> = new Map();
  private userPositions: Map<string, Set<string>> = new Map();
  private positionLimits: Map<string, PositionLimit[]> = new Map();
  private marginRequirements: Map<string, MarginRequirement> = new Map();
  private marketPrices: Map<string, number> = new Map();

  constructor() {
    super();
  }

  async createPosition(params: {
    userId: string;
    symbol: string;
    side: 'LONG' | 'SHORT';
    size: number;
    entryPrice: number;
    leverage: number;
    margin: number;
  }): Promise<Position> {
    // Validate position against limits
    await this.validatePositionLimits(params.userId, params.symbol, params.size, params.leverage);

    const position: Position = {
      id: uuidv4(),
      userId: params.userId,
      symbol: params.symbol,
      side: params.side,
      size: params.size,
      entryPrice: params.entryPrice,
      markPrice: params.entryPrice,
      unrealizedPnL: 0,
      realizedPnL: 0,
      margin: params.margin,
      leverage: params.leverage,
      liquidationPrice: this.calculateLiquidationPrice(params),
      lastUpdated: new Date(),
      createdAt: new Date()
    };

    this.positions.set(position.id, position);
    
    if (!this.userPositions.has(params.userId)) {
      this.userPositions.set(params.userId, new Set());
    }
    this.userPositions.get(params.userId)!.add(position.id);

    this.emit('positionCreated', position);
    return position;
  }

  async updatePosition(positionId: string, updates: Partial<Position>): Promise<Position> {
    const position = this.positions.get(positionId);
    if (!position) {
      throw new Error('Position not found');
    }

    const updatedPosition = {
      ...position,
      ...updates,
      lastUpdated: new Date()
    };

    // Recalculate derived values
    if (updates.markPrice || updates.size) {
      updatedPosition.unrealizedPnL = this.calculateUnrealizedPnL(updatedPosition);
      updatedPosition.liquidationPrice = this.calculateLiquidationPrice(updatedPosition);
    }

    this.positions.set(positionId, updatedPosition);
    this.emit('positionUpdated', updatedPosition);
    
    return updatedPosition;
  }

  async closePosition(positionId: string, exitPrice: number): Promise<Position> {
    const position = this.positions.get(positionId);
    if (!position) {
      throw new Error('Position not found');
    }

    const realizedPnL = this.calculateRealizedPnL(position, exitPrice);
    
    const closedPosition = {
      ...position,
      size: 0,
      realizedPnL: position.realizedPnL + realizedPnL,
      unrealizedPnL: 0,
      lastUpdated: new Date()
    };

    this.positions.delete(positionId);
    this.userPositions.get(position.userId)?.delete(positionId);
    
    this.emit('positionClosed', closedPosition);
    return closedPosition;
  }

  getUserPositions(userId: string): Position[] {
    const positionIds = this.userPositions.get(userId);
    if (!positionIds) return [];
    
    return Array.from(positionIds)
      .map(id => this.positions.get(id))
      .filter((p): p is Position => p !== undefined);
  }

  getUserRiskMetrics(userId: string): RiskMetrics {
    const positions = this.getUserPositions(userId);
    
    let totalCollateral = 0;
    let usedCollateral = 0;
    let totalExposure = 0;
    let totalUnrealizedPnL = 0;
    let totalRealizedPnL = 0;

    positions.forEach(position => {
      totalCollateral += position.margin;
      usedCollateral += position.margin;
      totalExposure += Math.abs(position.size * position.markPrice);
      totalUnrealizedPnL += position.unrealizedPnL;
      totalRealizedPnL += position.realizedPnL;
    });

    const marginRatio = totalCollateral > 0 ? usedCollateral / totalCollateral : 0;
    const requiredMargin = this.calculateRequiredMargin(positions);
    const healthFactor = requiredMargin > 0 ? totalCollateral / requiredMargin : 1;
    
    return {
      userId,
      totalCollateral,
      usedCollateral,
      availableCollateral: totalCollateral - usedCollateral,
      totalExposure,
      marginRatio,
      healthFactor,
      netOpenPositions: positions.length,
      totalUnrealizedPnL,
      totalRealizedPnL,
      riskScore: this.calculateRiskScore(marginRatio, healthFactor, positions.length),
      lastCalculated: new Date()
    };
  }

  setPositionLimit(limit: PositionLimit): void {
    const key = limit.userId;
    if (!this.positionLimits.has(key)) {
      this.positionLimits.set(key, []);
    }
    this.positionLimits.get(key)!.push(limit);
  }

  setMarginRequirement(requirement: MarginRequirement): void {
    this.marginRequirements.set(requirement.symbol, requirement);
  }

  updateMarketPrice(symbol: string, price: number): void {
    this.marketPrices.set(symbol, price);
    
    // Update all positions with this symbol
    this.positions.forEach(position => {
      if (position.symbol === symbol) {
        this.updatePosition(position.id, { markPrice: price });
      }
    });
  }

  private async validatePositionLimits(
    userId: string,
    symbol: string,
    size: number,
    leverage: number
  ): Promise<void> {
    const limits = this.positionLimits.get(userId) || [];
    const userPositions = this.getUserPositions(userId);
    
    for (const limit of limits) {
      // Check if limit applies to this symbol
      if (limit.symbol && limit.symbol !== symbol) continue;
      
      // Check max position size
      if (size > limit.maxPositionSize) {
        throw new Error(`Position size ${size} exceeds limit ${limit.maxPositionSize}`);
      }
      
      // Check max leverage
      if (leverage > limit.maxLeverage) {
        throw new Error(`Leverage ${leverage} exceeds limit ${limit.maxLeverage}`);
      }
      
      // Check max open positions
      if (userPositions.length >= limit.maxOpenPositions) {
        throw new Error(`User already has ${userPositions.length} open positions (max: ${limit.maxOpenPositions})`);
      }
      
      // Check max notional value
      const price = this.marketPrices.get(symbol) || 0;
      const notionalValue = size * price;
      const totalNotional = userPositions.reduce((sum, p) => {
        return sum + Math.abs(p.size * p.markPrice);
      }, 0) + notionalValue;
      
      if (totalNotional > limit.maxNotionalValue) {
        throw new Error(`Total notional value ${totalNotional} exceeds limit ${limit.maxNotionalValue}`);
      }
    }
  }

  private calculateLiquidationPrice(position: Position | any): number {
    const maintenanceMargin = this.getMaintenanceMarginRate(position.symbol);
    const { side, entryPrice, leverage } = position;
    
    if (side === 'LONG') {
      return entryPrice * (1 - (1 / leverage) + maintenanceMargin);
    } else {
      return entryPrice * (1 + (1 / leverage) - maintenanceMargin);
    }
  }

  private calculateUnrealizedPnL(position: Position): number {
    const { side, size, entryPrice, markPrice } = position;
    
    if (side === 'LONG') {
      return size * (markPrice - entryPrice);
    } else {
      return size * (entryPrice - markPrice);
    }
  }

  private calculateRealizedPnL(position: Position, exitPrice: number): number {
    const { side, size, entryPrice } = position;
    
    if (side === 'LONG') {
      return size * (exitPrice - entryPrice);
    } else {
      return size * (entryPrice - exitPrice);
    }
  }

  private calculateRequiredMargin(positions: Position[]): number {
    return positions.reduce((total, position) => {
      const marginReq = this.marginRequirements.get(position.symbol);
      const maintenanceRate = marginReq?.maintenanceMarginRate || 0.05;
      return total + Math.abs(position.size * position.markPrice * maintenanceRate);
    }, 0);
  }

  private calculateRiskScore(marginRatio: number, healthFactor: number, positionCount: number): number {
    // Simple risk scoring algorithm (0-100)
    let score = 100;
    
    // Penalize high margin usage
    score -= marginRatio * 40;
    
    // Penalize low health factor
    if (healthFactor < 2) {
      score -= (2 - healthFactor) * 30;
    }
    
    // Penalize too many open positions
    if (positionCount > 10) {
      score -= (positionCount - 10) * 2;
    }
    
    return Math.max(0, Math.min(100, score));
  }

  private getMaintenanceMarginRate(symbol: string): number {
    const requirement = this.marginRequirements.get(symbol);
    return requirement?.maintenanceMarginRate || 0.05; // Default 5%
  }
}