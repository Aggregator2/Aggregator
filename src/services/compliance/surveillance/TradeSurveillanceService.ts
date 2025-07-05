import { EventEmitter } from 'events';
import {
  SurveillanceAlert,
  AlertType,
  AlertStatus,
  AlertResolution
} from '../types';

export interface MarketData {
  pairId: string;
  price: string;
  volume: string;
  timestamp: Date;
}

export interface TradeData {
  tradeId: string;
  userId: string;
  pairId: string;
  side: 'BUY' | 'SELL';
  price: string;
  amount: string;
  timestamp: Date;
  orderId: string;
}

export interface OrderData {
  orderId: string;
  userId: string;
  pairId: string;
  side: 'BUY' | 'SELL';
  price: string;
  amount: string;
  timestamp: Date;
  status: 'PLACED' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELLED';
}

interface PatternDetector {
  type: AlertType;
  detect(context: DetectionContext): SurveillanceAlert | null;
}

interface DetectionContext {
  trade?: TradeData;
  order?: OrderData;
  userTrades: TradeData[];
  userOrders: OrderData[];
  marketData: MarketData[];
  pairVolume24h: string;
  userVolume24h: string;
}

export class TradeSurveillanceService extends EventEmitter {
  private alerts: Map<string, SurveillanceAlert> = new Map();
  private tradeHistory: Map<string, TradeData[]> = new Map();
  private orderHistory: Map<string, OrderData[]> = new Map();
  private marketData: Map<string, MarketData[]> = new Map();
  private detectors: PatternDetector[] = [];

  constructor() {
    super();
    this.initializeDetectors();
  }

  private initializeDetectors(): void {
    this.detectors = [
      new WashTradingDetector(),
      new SpoofingDetector(),
      new LayeringDetector(),
      new FrontRunningDetector(),
      new MarketManipulationDetector(),
      new UnusualVolumeDetector(),
      new RapidPriceMovementDetector(),
      new StructuringDetector()
    ];
  }

  async analyzeTrade(trade: TradeData): Promise<SurveillanceAlert[]> {
    // Store trade
    if (!this.tradeHistory.has(trade.userId)) {
      this.tradeHistory.set(trade.userId, []);
    }
    this.tradeHistory.get(trade.userId)!.push(trade);

    // Build detection context
    const context = await this.buildDetectionContext(trade.userId, trade.pairId, trade);

    // Run all detectors
    const alerts: SurveillanceAlert[] = [];
    for (const detector of this.detectors) {
      const alert = detector.detect(context);
      if (alert) {
        alert.alertId = this.generateAlertId();
        alert.timestamp = new Date();
        alert.status = AlertStatus.NEW;
        
        this.alerts.set(alert.alertId, alert);
        alerts.push(alert);
        
        this.emit('surveillance:alert:created', alert);
      }
    }

    return alerts;
  }

  async analyzeOrder(order: OrderData): Promise<SurveillanceAlert[]> {
    // Store order
    if (!this.orderHistory.has(order.userId)) {
      this.orderHistory.set(order.userId, []);
    }
    this.orderHistory.get(order.userId)!.push(order);

    // Build detection context
    const context = await this.buildDetectionContext(order.userId, order.pairId, undefined, order);

    // Run relevant detectors
    const alerts: SurveillanceAlert[] = [];
    const orderDetectors = this.detectors.filter(d => 
      [AlertType.SPOOFING, AlertType.LAYERING, AlertType.MARKET_MANIPULATION].includes(d.type)
    );

    for (const detector of orderDetectors) {
      const alert = detector.detect(context);
      if (alert) {
        alert.alertId = this.generateAlertId();
        alert.timestamp = new Date();
        alert.status = AlertStatus.NEW;
        
        this.alerts.set(alert.alertId, alert);
        alerts.push(alert);
        
        this.emit('surveillance:alert:created', alert);
      }
    }

    return alerts;
  }

  private async buildDetectionContext(
    userId: string,
    pairId: string,
    trade?: TradeData,
    order?: OrderData
  ): Promise<DetectionContext> {
    const userTrades = this.tradeHistory.get(userId) || [];
    const userOrders = this.orderHistory.get(userId) || [];
    const marketData = this.marketData.get(pairId) || [];

    // Calculate volumes
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    const recentUserTrades = userTrades.filter(t => t.timestamp > oneDayAgo && t.pairId === pairId);
    const userVolume24h = recentUserTrades.reduce((sum, t) => sum + parseFloat(t.amount), 0).toString();

    const recentMarketData = marketData.filter(m => m.timestamp > oneDayAgo);
    const pairVolume24h = recentMarketData.reduce((sum, m) => sum + parseFloat(m.volume), 0).toString();

    return {
      trade,
      order,
      userTrades: userTrades.filter(t => t.pairId === pairId),
      userOrders: userOrders.filter(o => o.pairId === pairId),
      marketData,
      pairVolume24h,
      userVolume24h
    };
  }

  updateMarketData(data: MarketData): void {
    if (!this.marketData.has(data.pairId)) {
      this.marketData.set(data.pairId, []);
    }
    this.marketData.get(data.pairId)!.push(data);

    // Keep only last 24 hours
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const filtered = this.marketData.get(data.pairId)!.filter(m => m.timestamp > cutoff);
    this.marketData.set(data.pairId, filtered);
  }

  async investigateAlert(alertId: string, assignTo: string): Promise<void> {
    const alert = this.alerts.get(alertId);
    if (!alert) {
      throw new Error('Alert not found');
    }

    alert.status = AlertStatus.INVESTIGATING;
    alert.assignedTo = assignTo;
    
    this.emit('surveillance:alert:assigned', { alertId, assignTo });
  }

  async resolveAlert(
    alertId: string,
    resolution: AlertResolution
  ): Promise<void> {
    const alert = this.alerts.get(alertId);
    if (!alert) {
      throw new Error('Alert not found');
    }

    alert.status = AlertStatus.RESOLVED;
    alert.resolution = resolution;
    
    this.emit('surveillance:alert:resolved', { alertId, resolution });

    // Take automated actions if needed
    if (resolution.outcome === 'VIOLATION' && alert.userId) {
      this.emit('surveillance:violation:confirmed', {
        userId: alert.userId,
        alertType: alert.type,
        severity: alert.severity
      });
    }
  }

  getAlerts(filters?: {
    status?: AlertStatus;
    type?: AlertType;
    severity?: string;
    userId?: string;
    dateFrom?: Date;
    dateTo?: Date;
  }): SurveillanceAlert[] {
    let alerts = Array.from(this.alerts.values());

    if (filters) {
      if (filters.status) {
        alerts = alerts.filter(a => a.status === filters.status);
      }
      if (filters.type) {
        alerts = alerts.filter(a => a.type === filters.type);
      }
      if (filters.severity) {
        alerts = alerts.filter(a => a.severity === filters.severity);
      }
      if (filters.userId) {
        alerts = alerts.filter(a => a.userId === filters.userId);
      }
      if (filters.dateFrom) {
        alerts = alerts.filter(a => a.timestamp >= filters.dateFrom!);
      }
      if (filters.dateTo) {
        alerts = alerts.filter(a => a.timestamp <= filters.dateTo!);
      }
    }

    return alerts.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  private generateAlertId(): string {
    return `ALERT_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Pattern Detectors
class WashTradingDetector implements PatternDetector {
  type = AlertType.WASH_TRADING;

  detect(context: DetectionContext): SurveillanceAlert | null {
    const { userTrades } = context;
    if (userTrades.length < 2) return null;

    // Look for trades where user is on both sides within short time
    const recentTrades = userTrades.slice(-20);
    const fiveMinutes = 5 * 60 * 1000;

    for (let i = 0; i < recentTrades.length - 1; i++) {
      for (let j = i + 1; j < recentTrades.length; j++) {
        const trade1 = recentTrades[i];
        const trade2 = recentTrades[j];

        if (
          trade1.side !== trade2.side &&
          Math.abs(trade1.timestamp.getTime() - trade2.timestamp.getTime()) < fiveMinutes &&
          Math.abs(parseFloat(trade1.price) - parseFloat(trade2.price)) < parseFloat(trade1.price) * 0.01
        ) {
          return {
            alertId: '',
            timestamp: new Date(),
            type: this.type,
            severity: 'HIGH',
            userId: context.userTrades[0].userId,
            pairId: context.userTrades[0].pairId,
            pattern: 'Potential wash trading detected',
            details: {
              trade1: trade1.tradeId,
              trade2: trade2.tradeId,
              timeDiff: Math.abs(trade1.timestamp.getTime() - trade2.timestamp.getTime()),
              priceDiff: Math.abs(parseFloat(trade1.price) - parseFloat(trade2.price))
            },
            status: AlertStatus.NEW
          };
        }
      }
    }

    return null;
  }
}

class SpoofingDetector implements PatternDetector {
  type = AlertType.SPOOFING;

  detect(context: DetectionContext): SurveillanceAlert | null {
    const { userOrders } = context;
    
    // Look for large orders that are quickly cancelled
    const recentOrders = userOrders.slice(-50);
    const cancelledLargeOrders = recentOrders.filter(o => {
      if (o.status !== 'CANCELLED') return false;
      
      const placedTime = o.timestamp.getTime();
      const cancelledOrder = userOrders.find(co => 
        co.orderId === o.orderId && co.status === 'CANCELLED'
      );
      
      if (!cancelledOrder) return false;
      
      const cancelTime = cancelledOrder.timestamp.getTime();
      const duration = cancelTime - placedTime;
      
      // Large order cancelled within 30 seconds
      return duration < 30000 && parseFloat(o.amount) > parseFloat(context.pairVolume24h) * 0.01;
    });

    if (cancelledLargeOrders.length >= 3) {
      return {
        alertId: '',
        timestamp: new Date(),
        type: this.type,
        severity: 'HIGH',
        userId: userOrders[0].userId,
        pairId: userOrders[0].pairId,
        pattern: 'Potential spoofing detected',
        details: {
          cancelledOrders: cancelledLargeOrders.map(o => o.orderId),
          count: cancelledLargeOrders.length
        },
        status: AlertStatus.NEW
      };
    }

    return null;
  }
}

class LayeringDetector implements PatternDetector {
  type = AlertType.LAYERING;

  detect(context: DetectionContext): SurveillanceAlert | null {
    const { userOrders } = context;
    
    // Look for multiple orders at different price levels
    const activeOrders = userOrders.filter(o => o.status === 'PLACED');
    if (activeOrders.length < 5) return null;

    // Group by side
    const buyOrders = activeOrders.filter(o => o.side === 'BUY');
    const sellOrders = activeOrders.filter(o => o.side === 'SELL');

    // Check for layering pattern (multiple orders at incrementing prices)
    const checkLayering = (orders: OrderData[]): boolean => {
      if (orders.length < 4) return false;
      
      const prices = orders.map(o => parseFloat(o.price)).sort((a, b) => a - b);
      let isLayered = true;
      
      for (let i = 1; i < prices.length; i++) {
        const priceDiff = (prices[i] - prices[i-1]) / prices[i-1];
        if (priceDiff > 0.02) { // More than 2% gap
          isLayered = false;
          break;
        }
      }
      
      return isLayered;
    };

    if (checkLayering(buyOrders) || checkLayering(sellOrders)) {
      return {
        alertId: '',
        timestamp: new Date(),
        type: this.type,
        severity: 'MEDIUM',
        userId: userOrders[0].userId,
        pairId: userOrders[0].pairId,
        pattern: 'Potential layering detected',
        details: {
          buyOrderCount: buyOrders.length,
          sellOrderCount: sellOrders.length,
          orderIds: activeOrders.map(o => o.orderId)
        },
        status: AlertStatus.NEW
      };
    }

    return null;
  }
}

class FrontRunningDetector implements PatternDetector {
  type = AlertType.FRONT_RUNNING;

  detect(context: DetectionContext): SurveillanceAlert | null {
    // This would require access to pending transactions or order book data
    // Simplified implementation
    const { userTrades, marketData } = context;
    if (userTrades.length < 2 || marketData.length < 2) return null;

    // Look for trades just before significant price movements
    const recentTrade = userTrades[userTrades.length - 1];
    const tradeTime = recentTrade.timestamp.getTime();
    
    const priceMovement = marketData.find(m => {
      const timeDiff = m.timestamp.getTime() - tradeTime;
      return timeDiff > 0 && timeDiff < 60000; // Within 1 minute
    });

    if (priceMovement) {
      const priceDiff = Math.abs(parseFloat(priceMovement.price) - parseFloat(recentTrade.price)) / parseFloat(recentTrade.price);
      
      if (priceDiff > 0.05) { // 5% price movement
        return {
          alertId: '',
          timestamp: new Date(),
          type: this.type,
          severity: 'CRITICAL',
          userId: recentTrade.userId,
          pairId: recentTrade.pairId,
          pattern: 'Potential front-running detected',
          details: {
            tradeId: recentTrade.tradeId,
            tradePrice: recentTrade.price,
            subsequentPrice: priceMovement.price,
            priceMovement: priceDiff * 100 + '%'
          },
          status: AlertStatus.NEW
        };
      }
    }

    return null;
  }
}

class MarketManipulationDetector implements PatternDetector {
  type = AlertType.MARKET_MANIPULATION;

  detect(context: DetectionContext): SurveillanceAlert | null {
    const { userVolume24h, pairVolume24h, userTrades } = context;
    
    if (parseFloat(pairVolume24h) === 0) return null;
    
    const userVolumePercent = parseFloat(userVolume24h) / parseFloat(pairVolume24h);
    
    // User controls more than 25% of volume
    if (userVolumePercent > 0.25) {
      return {
        alertId: '',
        timestamp: new Date(),
        type: this.type,
        severity: 'HIGH',
        userId: userTrades[0]?.userId,
        pairId: userTrades[0]?.pairId,
        pattern: 'Potential market manipulation - high volume concentration',
        details: {
          userVolume: userVolume24h,
          marketVolume: pairVolume24h,
          percentageControl: (userVolumePercent * 100).toFixed(2) + '%'
        },
        status: AlertStatus.NEW
      };
    }

    return null;
  }
}

class UnusualVolumeDetector implements PatternDetector {
  type = AlertType.UNUSUAL_VOLUME;

  detect(context: DetectionContext): SurveillanceAlert | null {
    const { trade, userVolume24h } = context;
    
    if (!trade) return null;
    
    const tradeAmount = parseFloat(trade.amount);
    const avgTradeSize = parseFloat(userVolume24h) / Math.max(context.userTrades.length, 1);
    
    // Trade is 10x larger than average
    if (tradeAmount > avgTradeSize * 10) {
      return {
        alertId: '',
        timestamp: new Date(),
        type: this.type,
        severity: 'MEDIUM',
        userId: trade.userId,
        pairId: trade.pairId,
        pattern: 'Unusually large trade detected',
        details: {
          tradeAmount: trade.amount,
          averageTradeSize: avgTradeSize.toString(),
          multiple: (tradeAmount / avgTradeSize).toFixed(2) + 'x'
        },
        status: AlertStatus.NEW
      };
    }

    return null;
  }
}

class RapidPriceMovementDetector implements PatternDetector {
  type = AlertType.RAPID_PRICE_MOVEMENT;

  detect(context: DetectionContext): SurveillanceAlert | null {
    const { marketData, userTrades } = context;
    
    if (marketData.length < 2) return null;
    
    // Check for rapid price movements
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const recentData = marketData.filter(m => m.timestamp > fiveMinutesAgo);
    
    if (recentData.length >= 2) {
      const startPrice = parseFloat(recentData[0].price);
      const endPrice = parseFloat(recentData[recentData.length - 1].price);
      const priceChange = Math.abs(endPrice - startPrice) / startPrice;
      
      if (priceChange > 0.1) { // 10% in 5 minutes
        // Check if user traded during this period
        const userTradesDuringMovement = userTrades.filter(t => 
          t.timestamp > fiveMinutesAgo
        );
        
        if (userTradesDuringMovement.length > 0) {
          return {
            alertId: '',
            timestamp: new Date(),
            type: this.type,
            severity: 'HIGH',
            userId: userTradesDuringMovement[0].userId,
            pairId: recentData[0].pairId,
            pattern: 'User traded during rapid price movement',
            details: {
              priceChange: (priceChange * 100).toFixed(2) + '%',
              startPrice: startPrice.toString(),
              endPrice: endPrice.toString(),
              userTrades: userTradesDuringMovement.length
            },
            status: AlertStatus.NEW
          };
        }
      }
    }

    return null;
  }
}

class StructuringDetector implements PatternDetector {
  type = AlertType.STRUCTURING;

  detect(context: DetectionContext): SurveillanceAlert | null {
    const { userTrades } = context;
    
    // Look for multiple similar-sized trades
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentTrades = userTrades.filter(t => t.timestamp > oneHourAgo);
    
    if (recentTrades.length < 3) return null;
    
    // Calculate trade amounts
    const amounts = recentTrades.map(t => parseFloat(t.amount));
    const avgAmount = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    
    // Check if amounts are suspiciously similar (within 5% of each other)
    const similarAmounts = amounts.filter(amount => 
      Math.abs(amount - avgAmount) / avgAmount < 0.05
    );
    
    if (similarAmounts.length >= 3 && similarAmounts.length === amounts.length) {
      return {
        alertId: '',
        timestamp: new Date(),
        type: this.type,
        severity: 'MEDIUM',
        userId: userTrades[0].userId,
        pairId: userTrades[0].pairId,
        pattern: 'Potential structuring - multiple similar-sized trades',
        details: {
          tradeCount: recentTrades.length,
          amounts: amounts.map(a => a.toString()),
          averageAmount: avgAmount.toString()
        },
        status: AlertStatus.NEW
      };
    }

    return null;
  }
}