import { EventEmitter } from 'events';
import { PositionManager } from './PositionManager';
import { TradeSurveillanceService, TradeData, OrderData } from '../compliance/surveillance/TradeSurveillanceService';
import { 
  RiskConfig, 
  RiskAlert, 
  PositionLimit, 
  RiskMetrics,
  Position 
} from './types';
import { Order, Trade } from '../matchingEngine/types';

export enum RiskCheckResult {
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  REQUIRES_REVIEW = 'REQUIRES_REVIEW'
}

export interface RiskCheckError {
  code: string;
  message: string;
  details?: Record<string, any>;
}

export interface OrderRiskCheck {
  result: RiskCheckResult;
  errors: RiskCheckError[];
  warnings: RiskCheckError[];
  metrics?: RiskMetrics;
  timestamp: Date;
}

export interface RiskLimits {
  // Position limits
  maxPositionSize: number;
  maxLeverage: number;
  maxOpenPositions: number;
  maxNotionalValue: number;
  
  // Order limits
  maxOrderSize: number;
  minOrderSize: number;
  maxOrderValue: number;
  
  // Daily limits
  maxDailyVolume: number;
  maxDailyTrades: number;
  maxDailyLoss: number;
  
  // Concentration limits
  maxConcentrationPerSymbol: number; // % of total portfolio
  maxConcentrationPerSector: number;
}

export interface SuspiciousPattern {
  type: 'WASH_TRADING' | 'SPOOFING' | 'LAYERING' | 'PUMP_AND_DUMP' | 'FRONT_RUNNING';
  confidence: number; // 0-1
  description: string;
  evidence: Record<string, any>;
}

export class RiskManagementService extends EventEmitter {
  private positionManager: PositionManager;
  private surveillanceService: TradeSurveillanceService;
  private config: RiskConfig;
  private userLimits: Map<string, RiskLimits> = new Map();
  private userMetrics: Map<string, RiskMetrics> = new Map();
  private userTradeHistory: Map<string, Trade[]> = new Map();
  private blacklistedUsers: Set<string> = new Set();
  private suspiciousUsers: Map<string, SuspiciousPattern[]> = new Map();
  private globalRiskScore: number = 0;

  constructor(
    config: RiskConfig,
    positionManager?: PositionManager,
    surveillanceService?: TradeSurveillanceService
  ) {
    super();
    this.config = config;
    this.positionManager = positionManager || new PositionManager();
    this.surveillanceService = surveillanceService || new TradeSurveillanceService();
    
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // Listen to surveillance alerts
    this.surveillanceService.on('surveillance:alert:created', (alert) => {
      this.handleSurveillanceAlert(alert);
    });

    // Listen to position events
    this.positionManager.on('positionCreated', (position) => {
      this.updateUserMetrics(position.userId);
    });

    this.positionManager.on('positionClosed', (position) => {
      this.updateUserMetrics(position.userId);
    });
  }

  // Main method to validate order before execution
  async validateOrder(order: Order): Promise<OrderRiskCheck> {
    const errors: RiskCheckError[] = [];
    const warnings: RiskCheckError[] = [];
    const startTime = Date.now();

    try {
      // 1. Check if user is blacklisted
      if (this.blacklistedUsers.has(order.userId)) {
        errors.push({
          code: 'USER_BLACKLISTED',
          message: 'User is blacklisted and cannot place orders',
          details: { userId: order.userId }
        });
      }

      // 2. Validate order size limits
      const sizeCheckResult = await this.checkOrderSize(order);
      errors.push(...sizeCheckResult.errors);
      warnings.push(...sizeCheckResult.warnings);

      // 3. Check position limits
      const positionCheckResult = await this.checkPositionLimits(order);
      errors.push(...positionCheckResult.errors);
      warnings.push(...positionCheckResult.warnings);

      // 4. Check wash trading
      const washTradingResult = await this.checkWashTrading(order);
      errors.push(...washTradingResult.errors);
      warnings.push(...washTradingResult.warnings);

      // 5. Check suspicious patterns
      const patternResult = await this.checkSuspiciousPatterns(order);
      errors.push(...patternResult.errors);
      warnings.push(...patternResult.warnings);

      // 6. Check daily limits
      const dailyLimitResult = await this.checkDailyLimits(order);
      errors.push(...dailyLimitResult.errors);
      warnings.push(...dailyLimitResult.warnings);

      // 7. Check market manipulation patterns
      const manipulationResult = await this.checkMarketManipulation(order);
      errors.push(...manipulationResult.errors);
      warnings.push(...manipulationResult.warnings);

      // 8. Get updated risk metrics
      const metrics = await this.calculateUserRiskMetrics(order.userId);

      // Determine result
      let result: RiskCheckResult;
      if (errors.length > 0) {
        result = RiskCheckResult.REJECTED;
      } else if (warnings.length > 0 && warnings.some(w => w.code.includes('HIGH_RISK'))) {
        result = RiskCheckResult.REQUIRES_REVIEW;
      } else {
        result = RiskCheckResult.APPROVED;
      }

      const check: OrderRiskCheck = {
        result,
        errors,
        warnings,
        metrics,
        timestamp: new Date()
      };

      // Emit event
      this.emit('orderRiskChecked', {
        orderId: order.id,
        userId: order.userId,
        result,
        duration: Date.now() - startTime
      });

      // Log if rejected or requires review
      if (result !== RiskCheckResult.APPROVED) {
        this.logRiskEvent(order, check);
      }

      return check;

    } catch (error) {
      errors.push({
        code: 'RISK_CHECK_ERROR',
        message: 'Risk check failed due to system error',
        details: { error: error.message }
      });

      return {
        result: RiskCheckResult.REJECTED,
        errors,
        warnings,
        timestamp: new Date()
      };
    }
  }

  // Check order size limits
  private async checkOrderSize(order: Order): Promise<{ errors: RiskCheckError[], warnings: RiskCheckError[] }> {
    const errors: RiskCheckError[] = [];
    const warnings: RiskCheckError[] = [];
    
    const limits = this.getUserLimits(order.userId);
    const orderValue = order.price * order.quantity;

    // Check minimum order size
    if (order.quantity < limits.minOrderSize) {
      errors.push({
        code: 'ORDER_TOO_SMALL',
        message: `Order size ${order.quantity} is below minimum ${limits.minOrderSize}`,
        details: { 
          orderSize: order.quantity, 
          minSize: limits.minOrderSize 
        }
      });
    }

    // Check maximum order size
    if (order.quantity > limits.maxOrderSize) {
      errors.push({
        code: 'ORDER_TOO_LARGE',
        message: `Order size ${order.quantity} exceeds maximum ${limits.maxOrderSize}`,
        details: { 
          orderSize: order.quantity, 
          maxSize: limits.maxOrderSize 
        }
      });
    }

    // Check maximum order value
    if (orderValue > limits.maxOrderValue) {
      errors.push({
        code: 'ORDER_VALUE_TOO_HIGH',
        message: `Order value ${orderValue} exceeds maximum ${limits.maxOrderValue}`,
        details: { 
          orderValue, 
          maxValue: limits.maxOrderValue 
        }
      });
    }

    // Warning for large orders
    if (order.quantity > limits.maxOrderSize * 0.8) {
      warnings.push({
        code: 'LARGE_ORDER_WARNING',
        message: 'Order size is approaching maximum limit',
        details: { 
          orderSize: order.quantity, 
          maxSize: limits.maxOrderSize,
          percentage: (order.quantity / limits.maxOrderSize) * 100
        }
      });
    }

    return { errors, warnings };
  }

  // Check position limits
  private async checkPositionLimits(order: Order): Promise<{ errors: RiskCheckError[], warnings: RiskCheckError[] }> {
    const errors: RiskCheckError[] = [];
    const warnings: RiskCheckError[] = [];
    
    const limits = this.getUserLimits(order.userId);
    const positions = await this.positionManager.getUserPositions(order.userId);
    const symbolPositions = positions.filter(p => p.symbol === order.pair);

    // Check max open positions
    if (positions.length >= limits.maxOpenPositions) {
      errors.push({
        code: 'MAX_POSITIONS_EXCEEDED',
        message: `User has reached maximum open positions limit of ${limits.maxOpenPositions}`,
        details: { 
          currentPositions: positions.length, 
          maxPositions: limits.maxOpenPositions 
        }
      });
    }

    // Calculate total exposure
    let totalExposure = 0;
    let symbolExposure = 0;
    
    for (const position of positions) {
      const positionValue = position.size * position.markPrice;
      totalExposure += positionValue;
      
      if (position.symbol === order.pair) {
        symbolExposure += position.side === order.side ? positionValue : -positionValue;
      }
    }

    // Add new order exposure
    const newOrderExposure = order.quantity * order.price;
    const newTotalExposure = totalExposure + newOrderExposure;
    const newSymbolExposure = Math.abs(symbolExposure + (order.side === 'BUY' ? newOrderExposure : -newOrderExposure));

    // Check total notional value
    if (newTotalExposure > limits.maxNotionalValue) {
      errors.push({
        code: 'MAX_NOTIONAL_EXCEEDED',
        message: `Total exposure ${newTotalExposure} would exceed maximum ${limits.maxNotionalValue}`,
        details: { 
          currentExposure: totalExposure,
          orderExposure: newOrderExposure,
          maxNotional: limits.maxNotionalValue 
        }
      });
    }

    // Check concentration limits
    const concentration = newSymbolExposure / newTotalExposure;
    if (concentration > limits.maxConcentrationPerSymbol) {
      errors.push({
        code: 'CONCENTRATION_LIMIT_EXCEEDED',
        message: `Symbol concentration ${(concentration * 100).toFixed(2)}% exceeds maximum ${(limits.maxConcentrationPerSymbol * 100)}%`,
        details: { 
          symbol: order.pair,
          concentration: concentration * 100,
          maxConcentration: limits.maxConcentrationPerSymbol * 100
        }
      });
    }

    // Check position size for the symbol
    const currentSymbolSize = symbolPositions.reduce((sum, p) => sum + p.size, 0);
    const newSymbolSize = currentSymbolSize + order.quantity;
    
    if (newSymbolSize > limits.maxPositionSize) {
      errors.push({
        code: 'MAX_POSITION_SIZE_EXCEEDED',
        message: `Position size for ${order.pair} would exceed maximum ${limits.maxPositionSize}`,
        details: { 
          currentSize: currentSymbolSize,
          orderSize: order.quantity,
          maxSize: limits.maxPositionSize 
        }
      });
    }

    // Warnings
    if (newTotalExposure > limits.maxNotionalValue * 0.8) {
      warnings.push({
        code: 'HIGH_EXPOSURE_WARNING',
        message: 'Total exposure is approaching maximum limit',
        details: { 
          exposure: newTotalExposure,
          maxNotional: limits.maxNotionalValue,
          percentage: (newTotalExposure / limits.maxNotionalValue) * 100
        }
      });
    }

    return { errors, warnings };
  }

  // Check for wash trading
  private async checkWashTrading(order: Order): Promise<{ errors: RiskCheckError[], warnings: RiskCheckError[] }> {
    const errors: RiskCheckError[] = [];
    const warnings: RiskCheckError[] = [];
    
    // Get user's recent trades
    const userTrades = this.getUserTradeHistory(order.userId);
    const recentTrades = userTrades.filter(t => 
      t.pair === order.pair && 
      Date.now() - t.timestamp < 5 * 60 * 1000 // Last 5 minutes
    );

    // Check for opposite side trades
    const oppositeSideTrades = recentTrades.filter(t => 
      (order.side === 'BUY' && t.takerSide === 'SELL') ||
      (order.side === 'SELL' && t.takerSide === 'BUY')
    );

    if (oppositeSideTrades.length > 0) {
      // Check if prices are similar (within 1%)
      for (const trade of oppositeSideTrades) {
        const priceDiff = Math.abs(order.price - trade.price) / trade.price;
        
        if (priceDiff < 0.01) { // Within 1%
          errors.push({
            code: 'WASH_TRADING_DETECTED',
            message: 'Potential wash trading detected - trading on both sides with similar prices',
            details: {
              previousTrade: trade.id,
              previousSide: trade.takerSide,
              previousPrice: trade.price,
              currentPrice: order.price,
              priceDifference: `${(priceDiff * 100).toFixed(2)}%`,
              timeGap: `${Math.floor((Date.now() - trade.timestamp) / 1000)}s`
            }
          });
          
          // Mark user as suspicious
          this.addSuspiciousPattern(order.userId, {
            type: 'WASH_TRADING',
            confidence: 0.8,
            description: 'User trading on both sides with similar prices',
            evidence: {
              orderId: order.id,
              tradeId: trade.id,
              priceDiff,
              timeGap: Date.now() - trade.timestamp
            }
          });
          
          break; // One detection is enough
        }
      }
    }

    // Check for self-trading patterns
    const rapidTrades = recentTrades.filter(t => 
      Date.now() - t.timestamp < 30000 // Last 30 seconds
    );

    if (rapidTrades.length >= 3) {
      warnings.push({
        code: 'RAPID_TRADING_WARNING',
        message: 'Rapid trading detected - may indicate automated wash trading',
        details: {
          tradesIn30s: rapidTrades.length,
          trades: rapidTrades.map(t => ({
            id: t.id,
            side: t.takerSide,
            price: t.price,
            time: new Date(t.timestamp).toISOString()
          }))
        }
      });
    }

    return { errors, warnings };
  }

  // Check for suspicious trading patterns
  private async checkSuspiciousPatterns(order: Order): Promise<{ errors: RiskCheckError[], warnings: RiskCheckError[] }> {
    const errors: RiskCheckError[] = [];
    const warnings: RiskCheckError[] = [];
    
    const suspiciousPatterns = this.suspiciousUsers.get(order.userId) || [];
    
    // Check if user has multiple suspicious patterns
    if (suspiciousPatterns.length >= 3) {
      errors.push({
        code: 'SUSPICIOUS_USER',
        message: 'User has multiple suspicious trading patterns',
        details: {
          patterns: suspiciousPatterns.map(p => ({
            type: p.type,
            confidence: p.confidence,
            description: p.description
          }))
        }
      });
    }

    // Check for specific pattern types with high confidence
    const highConfidencePatterns = suspiciousPatterns.filter(p => p.confidence > 0.7);
    
    for (const pattern of highConfidencePatterns) {
      if (pattern.type === 'PUMP_AND_DUMP' || pattern.type === 'FRONT_RUNNING') {
        errors.push({
          code: `${pattern.type}_SUSPECTED`,
          message: `Suspected ${pattern.type.replace('_', ' ').toLowerCase()} activity`,
          details: {
            confidence: pattern.confidence,
            evidence: pattern.evidence
          }
        });
      }
    }

    // Check order price against market
    const marketPrice = await this.getMarketPrice(order.pair);
    if (marketPrice) {
      const priceDeviation = Math.abs(order.price - marketPrice) / marketPrice;
      
      if (priceDeviation > 0.1) { // More than 10% from market
        warnings.push({
          code: 'PRICE_DEVIATION_WARNING',
          message: 'Order price significantly deviates from market price',
          details: {
            orderPrice: order.price,
            marketPrice,
            deviation: `${(priceDeviation * 100).toFixed(2)}%`
          }
        });
        
        // Could be spoofing if limit order far from market
        if (order.type === 'LIMIT' && priceDeviation > 0.2) {
          this.addSuspiciousPattern(order.userId, {
            type: 'SPOOFING',
            confidence: 0.6,
            description: 'Limit order placed far from market price',
            evidence: {
              orderId: order.id,
              orderPrice: order.price,
              marketPrice,
              deviation: priceDeviation
            }
          });
        }
      }
    }

    return { errors, warnings };
  }

  // Check daily trading limits
  private async checkDailyLimits(order: Order): Promise<{ errors: RiskCheckError[], warnings: RiskCheckError[] }> {
    const errors: RiskCheckError[] = [];
    const warnings: RiskCheckError[] = [];
    
    const limits = this.getUserLimits(order.userId);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    
    // Get today's trades
    const userTrades = this.getUserTradeHistory(order.userId);
    const todayTrades = userTrades.filter(t => t.timestamp >= todayStart.getTime());
    
    // Calculate daily volume
    const dailyVolume = todayTrades.reduce((sum, t) => sum + (t.price * t.quantity), 0);
    const newDailyVolume = dailyVolume + (order.price * order.quantity);
    
    // Check daily volume limit
    if (newDailyVolume > limits.maxDailyVolume) {
      errors.push({
        code: 'DAILY_VOLUME_EXCEEDED',
        message: `Daily trading volume would exceed limit of ${limits.maxDailyVolume}`,
        details: {
          currentVolume: dailyVolume,
          orderVolume: order.price * order.quantity,
          limit: limits.maxDailyVolume
        }
      });
    }

    // Check daily trade count
    if (todayTrades.length >= limits.maxDailyTrades) {
      errors.push({
        code: 'DAILY_TRADE_COUNT_EXCEEDED',
        message: `Daily trade count has reached limit of ${limits.maxDailyTrades}`,
        details: {
          tradeCount: todayTrades.length,
          limit: limits.maxDailyTrades
        }
      });
    }

    // Calculate daily P&L
    const metrics = await this.calculateUserRiskMetrics(order.userId);
    const dailyPnL = this.calculateDailyPnL(order.userId);
    
    if (dailyPnL < -limits.maxDailyLoss) {
      errors.push({
        code: 'DAILY_LOSS_LIMIT_EXCEEDED',
        message: `Daily loss of ${Math.abs(dailyPnL)} exceeds limit of ${limits.maxDailyLoss}`,
        details: {
          dailyLoss: Math.abs(dailyPnL),
          limit: limits.maxDailyLoss
        }
      });
    }

    // Warnings
    if (newDailyVolume > limits.maxDailyVolume * 0.8) {
      warnings.push({
        code: 'APPROACHING_DAILY_VOLUME_LIMIT',
        message: 'Approaching daily volume limit',
        details: {
          currentVolume: dailyVolume,
          limit: limits.maxDailyVolume,
          percentage: (newDailyVolume / limits.maxDailyVolume) * 100
        }
      });
    }

    return { errors, warnings };
  }

  // Check for market manipulation
  private async checkMarketManipulation(order: Order): Promise<{ errors: RiskCheckError[], warnings: RiskCheckError[] }> {
    const errors: RiskCheckError[] = [];
    const warnings: RiskCheckError[] = [];
    
    // Convert order to format expected by surveillance service
    const orderData: OrderData = {
      orderId: order.id,
      userId: order.userId,
      pairId: order.pair,
      side: order.side,
      price: order.price.toString(),
      amount: order.quantity.toString(),
      timestamp: new Date(),
      status: 'PLACED'
    };

    // Run surveillance checks
    const alerts = await this.surveillanceService.analyzeOrder(orderData);
    
    for (const alert of alerts) {
      if (alert.severity === 'CRITICAL' || alert.severity === 'HIGH') {
        errors.push({
          code: `MARKET_MANIPULATION_${alert.type}`,
          message: alert.pattern,
          details: alert.details
        });
      } else if (alert.severity === 'MEDIUM') {
        warnings.push({
          code: `MARKET_MANIPULATION_WARNING_${alert.type}`,
          message: alert.pattern,
          details: alert.details
        });
      }
    }

    return { errors, warnings };
  }

  // Helper methods
  private getUserLimits(userId: string): RiskLimits {
    return this.userLimits.get(userId) || this.getDefaultLimits();
  }

  private getDefaultLimits(): RiskLimits {
    return {
      maxPositionSize: 1000000,
      maxLeverage: this.config.globalMaxLeverage,
      maxOpenPositions: 10,
      maxNotionalValue: 5000000,
      maxOrderSize: 100000,
      minOrderSize: 0.001,
      maxOrderValue: 1000000,
      maxDailyVolume: 10000000,
      maxDailyTrades: 100,
      maxDailyLoss: 100000,
      maxConcentrationPerSymbol: 0.3,
      maxConcentrationPerSector: 0.5
    };
  }

  private getUserTradeHistory(userId: string): Trade[] {
    return this.userTradeHistory.get(userId) || [];
  }

  private addSuspiciousPattern(userId: string, pattern: SuspiciousPattern): void {
    if (!this.suspiciousUsers.has(userId)) {
      this.suspiciousUsers.set(userId, []);
    }
    
    const patterns = this.suspiciousUsers.get(userId)!;
    patterns.push(pattern);
    
    // Keep only recent patterns (last 24 hours)
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    this.suspiciousUsers.set(
      userId,
      patterns.filter(p => !p.evidence.timestamp || p.evidence.timestamp > oneDayAgo)
    );
  }

  private async getMarketPrice(pair: string): Promise<number | null> {
    // This should connect to your price feed service
    // For now, return null to skip price checks
    return null;
  }

  private calculateDailyPnL(userId: string): number {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    
    const trades = this.getUserTradeHistory(userId);
    const todayTrades = trades.filter(t => t.timestamp >= todayStart.getTime());
    
    // Simplified P&L calculation
    let pnl = 0;
    for (const trade of todayTrades) {
      // This is simplified - real implementation would track actual P&L
      pnl += trade.takerFee + trade.makerFee;
    }
    
    return pnl;
  }

  private async calculateUserRiskMetrics(userId: string): Promise<RiskMetrics> {
    const positions = await this.positionManager.getUserPositions(userId);
    
    let totalCollateral = 0;
    let usedCollateral = 0;
    let totalExposure = 0;
    let totalUnrealizedPnL = 0;
    let totalRealizedPnL = 0;
    
    for (const position of positions) {
      usedCollateral += position.margin;
      totalExposure += position.size * position.markPrice;
      totalUnrealizedPnL += position.unrealizedPnL;
      totalRealizedPnL += position.realizedPnL;
    }
    
    const availableCollateral = totalCollateral - usedCollateral;
    const marginRatio = totalCollateral > 0 ? usedCollateral / totalCollateral : 0;
    const healthFactor = usedCollateral > 0 ? totalCollateral / usedCollateral : 999;
    
    const metrics: RiskMetrics = {
      userId,
      totalCollateral,
      usedCollateral,
      availableCollateral,
      totalExposure,
      marginRatio,
      healthFactor,
      netOpenPositions: positions.length,
      totalUnrealizedPnL,
      totalRealizedPnL,
      riskScore: this.calculateRiskScore(marginRatio, healthFactor, positions.length),
      lastCalculated: new Date()
    };
    
    this.userMetrics.set(userId, metrics);
    return metrics;
  }

  private calculateRiskScore(marginRatio: number, healthFactor: number, openPositions: number): number {
    // Simple risk score calculation (0-100)
    let score = 0;
    
    // Margin usage (0-40 points)
    score += Math.min(marginRatio * 40, 40);
    
    // Health factor (0-40 points)
    if (healthFactor < 1.5) score += 40;
    else if (healthFactor < 2) score += 30;
    else if (healthFactor < 3) score += 20;
    else if (healthFactor < 5) score += 10;
    
    // Number of positions (0-20 points)
    score += Math.min(openPositions * 2, 20);
    
    return Math.min(score, 100);
  }

  private async updateUserMetrics(userId: string): Promise<void> {
    await this.calculateUserRiskMetrics(userId);
  }

  private handleSurveillanceAlert(alert: any): void {
    // Add to suspicious patterns
    this.addSuspiciousPattern(alert.userId, {
      type: alert.type,
      confidence: alert.severity === 'CRITICAL' ? 0.9 : alert.severity === 'HIGH' ? 0.7 : 0.5,
      description: alert.pattern,
      evidence: alert.details
    });
    
    // Create risk alert
    const riskAlert: RiskAlert = {
      id: `risk_${Date.now()}`,
      userId: alert.userId,
      type: 'SYSTEM_RISK',
      severity: alert.severity,
      message: `Surveillance alert: ${alert.pattern}`,
      metadata: alert.details,
      isResolved: false,
      createdAt: new Date()
    };
    
    this.emit('riskAlert', riskAlert);
  }

  private logRiskEvent(order: Order, check: OrderRiskCheck): void {
    console.log('[RISK] Order rejected or flagged:', {
      orderId: order.id,
      userId: order.userId,
      pair: order.pair,
      result: check.result,
      errors: check.errors,
      warnings: check.warnings,
      timestamp: check.timestamp
    });
  }

  // Public methods for managing risk parameters
  public setUserLimits(userId: string, limits: Partial<RiskLimits>): void {
    const currentLimits = this.getUserLimits(userId);
    this.userLimits.set(userId, { ...currentLimits, ...limits });
    this.emit('limitsUpdated', { userId, limits });
  }

  public blacklistUser(userId: string, reason: string): void {
    this.blacklistedUsers.add(userId);
    this.emit('userBlacklisted', { userId, reason, timestamp: new Date() });
  }

  public unblacklistUser(userId: string): void {
    this.blacklistedUsers.delete(userId);
    this.emit('userUnblacklisted', { userId, timestamp: new Date() });
  }

  public getUserRiskProfile(userId: string): {
    metrics: RiskMetrics | undefined;
    limits: RiskLimits;
    suspiciousPatterns: SuspiciousPattern[];
    isBlacklisted: boolean;
  } {
    return {
      metrics: this.userMetrics.get(userId),
      limits: this.getUserLimits(userId),
      suspiciousPatterns: this.suspiciousUsers.get(userId) || [],
      isBlacklisted: this.blacklistedUsers.has(userId)
    };
  }

  public addTradeToHistory(trade: Trade): void {
    // Add trade to both buyer and seller history
    const buyerId = trade.takerSide === 'BUY' ? trade.takerOrderId : trade.makerOrderId;
    const sellerId = trade.takerSide === 'SELL' ? trade.takerOrderId : trade.makerOrderId;
    
    // For simplicity, using order IDs as user IDs - in real implementation,
    // you'd need to map order IDs to user IDs
    this.addUserTrade(buyerId, trade);
    this.addUserTrade(sellerId, trade);
  }

  private addUserTrade(userId: string, trade: Trade): void {
    if (!this.userTradeHistory.has(userId)) {
      this.userTradeHistory.set(userId, []);
    }
    
    const trades = this.userTradeHistory.get(userId)!;
    trades.push(trade);
    
    // Keep only last 1000 trades per user
    if (trades.length > 1000) {
      this.userTradeHistory.set(userId, trades.slice(-1000));
    }
  }
}