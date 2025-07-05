import { ManipulationDetector } from './ManipulationDetector';
import { EnhancedManipulationDetector, OrderActivity } from './EnhancedManipulationDetector';
import { PriceSource } from './types';

/**
 * Example integration of spoofing detection with an order management system
 */
export class SpoofingDetectionIntegration {
  private manipulationDetector: ManipulationDetector;
  private enhancedDetector: EnhancedManipulationDetector;
  private orderTracking: Map<string, OrderActivity> = new Map();

  constructor() {
    this.manipulationDetector = new ManipulationDetector();
    this.enhancedDetector = new EnhancedManipulationDetector();
    
    // Listen for manipulation alerts
    this.manipulationDetector.on('manipulation-detected', (alert) => {
      console.log('Manipulation detected:', alert);
      this.handleManipulationAlert(alert);
    });

    this.enhancedDetector.on('manipulation-detected', (alert) => {
      console.log('Enhanced manipulation detected:', alert);
      this.handleManipulationAlert(alert);
    });
  }

  /**
   * Hook into order submission to track potential spoofing
   */
  onOrderSubmitted(order: {
    orderId: string;
    symbol: string;
    price: number;
    amount: number;
    side: 'buy' | 'sell';
    exchange: string;
  }): void {
    const orderActivity: OrderActivity = {
      ...order,
      placedAt: Date.now()
    };

    // Track order for spoofing detection
    this.orderTracking.set(order.orderId, orderActivity);
    this.enhancedDetector.trackOrderPlacement(orderActivity);
  }

  /**
   * Hook into order cancellation to detect spoofing patterns
   */
  onOrderCancelled(orderId: string, exchange: string): void {
    const order = this.orderTracking.get(orderId);
    if (order) {
      const cancelledAt = Date.now();
      const duration = cancelledAt - order.placedAt;

      // Update tracking
      order.cancelledAt = cancelledAt;
      this.enhancedDetector.trackOrderCancellation(
        orderId,
        order.symbol,
        exchange,
        cancelledAt
      );

      // Log suspicious cancellations
      if (duration < 30000 && order.amount > 10000) {
        console.warn(`Suspicious order cancellation detected:`, {
          orderId,
          exchange,
          duration: `${duration / 1000}s`,
          amount: order.amount
        });
      }
    }
  }

  /**
   * Check for spoofing on price updates
   */
  checkForSpoofing(
    symbol: string,
    sources: PriceSource[],
    currentPrice: number,
    volume24h: number
  ): void {
    // Get recent orders for this symbol
    const recentOrders: OrderActivity[] = [];
    this.orderTracking.forEach(order => {
      if (order.symbol === symbol) {
        recentOrders.push(order);
      }
    });

    // Use enhanced detector with order data
    const alerts = this.enhancedDetector.detectManipulation(
      symbol,
      {
        symbol,
        price: currentPrice,
        volume24h,
        timestamp: Date.now(),
        source: sources[0]?.exchange || 'Unknown'
      },
      sources,
      {
        orders: recentOrders,
        avgMarketPrice: currentPrice,
        volume24h
      }
    );

    // Also check with basic detector
    const basicAlerts = this.manipulationDetector.detectManipulation(
      symbol,
      {
        symbol,
        price: currentPrice,
        volume24h,
        timestamp: Date.now(),
        source: sources[0]?.exchange || 'Unknown'
      },
      sources
    );

    // Combine and process alerts
    [...alerts, ...basicAlerts].forEach(alert => {
      if (alert.type === 'spoofing') {
        this.handleSpoofingAlert(alert);
      }
    });
  }

  private handleManipulationAlert(alert: any): void {
    // Implement your alert handling logic
    switch (alert.type) {
      case 'spoofing':
        // Take action on spoofing detection
        console.error(`SPOOFING ALERT: ${alert.exchange} - ${alert.details}`);
        // Could: freeze trading, notify compliance, increase monitoring
        break;
      case 'pump':
        console.warn(`PUMP ALERT: ${alert.exchange} - ${alert.details}`);
        break;
      case 'dump':
        console.warn(`DUMP ALERT: ${alert.exchange} - ${alert.details}`);
        break;
      case 'wash_trading':
        console.warn(`WASH TRADING ALERT: ${alert.exchange} - ${alert.details}`);
        break;
    }
  }

  private handleSpoofingAlert(alert: any): void {
    // Specific handling for spoofing alerts
    console.error('🚨 SPOOFING DETECTED 🚨');
    console.error('Exchange:', alert.exchange);
    console.error('Symbol:', alert.symbol);
    console.error('Details:', alert.details);
    console.error('Severity:', alert.severity);

    // Get spoofing statistics
    const stats = this.enhancedDetector.getSpoofingStats(alert.exchange);
    console.error('Spoofing stats for', alert.exchange + ':', stats);

    // Implement actions based on severity
    if (alert.severity === 'critical') {
      // Immediate action required
      this.suspendTradingOnExchange(alert.exchange);
    } else if (alert.severity === 'high') {
      // Increase monitoring
      this.increaseMonitoring(alert.exchange);
    }
  }

  private suspendTradingOnExchange(exchange: string): void {
    console.error(`⛔ SUSPENDING TRADING on ${exchange} due to spoofing`);
    // Implement trading suspension logic
  }

  private increaseMonitoring(exchange: string): void {
    console.warn(`👁️ INCREASING MONITORING on ${exchange}`);
    // Implement enhanced monitoring logic
  }

  /**
   * Clean up old order tracking data
   */
  cleanupOldOrders(maxAge: number = 3600000): void {
    const now = Date.now();
    const toDelete: string[] = [];

    this.orderTracking.forEach((order, orderId) => {
      if (now - order.placedAt > maxAge) {
        toDelete.push(orderId);
      }
    });

    toDelete.forEach(orderId => this.orderTracking.delete(orderId));
  }
}

// Example usage
export function createSpoofingDetectionExample(): void {
  const integration = new SpoofingDetectionIntegration();

  // Simulate order flow with spoofing pattern
  const symbol = 'BTC/USD';
  const fakeExchangeOrders = [
    { orderId: 'fake-1', price: 52000, amount: 15000, side: 'sell' as const },
    { orderId: 'fake-2', price: 48000, amount: 12000, side: 'buy' as const },
    { orderId: 'fake-3', price: 53000, amount: 20000, side: 'sell' as const }
  ];

  // Submit orders
  fakeExchangeOrders.forEach(order => {
    integration.onOrderSubmitted({
      ...order,
      symbol,
      exchange: 'FakeExchange'
    });
  });

  // Cancel them quickly (spoofing pattern)
  setTimeout(() => {
    fakeExchangeOrders.forEach(order => {
      integration.onOrderCancelled(order.orderId, 'FakeExchange');
    });
  }, 5000);

  // Check for spoofing
  setTimeout(() => {
    const sources: PriceSource[] = [
      { exchange: 'Binance', price: 50000, volume: 100, weight: 1, timestamp: Date.now() },
      { exchange: 'Coinbase', price: 50100, volume: 90, weight: 1, timestamp: Date.now() },
      { exchange: 'FakeExchange', price: 51000, volume: 80, weight: 1, timestamp: Date.now() }
    ];

    integration.checkForSpoofing(symbol, sources, 50050, 1000000);
  }, 6000);
}