import { createLogger } from '../../utils/production-logger';
import { OrderWithDetails, OrderSide, PriceData } from '../../types/orderHistory';
import BigNumber from 'bignumber.js';

const logger = createLogger('PnLCalculator');

export interface Position {
  pair: string;
  side: 'LONG' | 'SHORT';
  quantity: BigNumber;
  averagePrice: BigNumber;
  totalCost: BigNumber;
  fees: BigNumber;
}

export interface PnLResult {
  realizedPnL: string;
  unrealizedPnL: string;
  totalPnL: string;
  pnlPercentage: string;
  totalFees: string;
  netPnL: string;
}

export class PnLCalculator {
  private positions: Map<string, Position> = new Map();

  /**
   * Calculate P&L for a single order
   */
  calculateOrderPnL(
    order: OrderWithDetails,
    currentPrice: string,
    baseCurrency: string = 'USD'
  ): PnLResult {
    const filledQty = new BigNumber(order.filledQuantity);
    const avgPrice = new BigNumber(order.averagePrice);
    const totalFees = new BigNumber(order.totalFees);
    
    if (filledQty.isZero()) {
      return {
        realizedPnL: '0',
        unrealizedPnL: '0',
        totalPnL: '0',
        pnlPercentage: '0',
        totalFees: totalFees.toString(),
        netPnL: totalFees.negated().toString()
      };
    }

    // Calculate based on order side
    if (order.side === OrderSide.BUY) {
      return this.calculateBuyOrderPnL(order, currentPrice, baseCurrency);
    } else {
      return this.calculateSellOrderPnL(order, currentPrice, baseCurrency);
    }
  }

  /**
   * Calculate P&L for buy orders
   */
  private calculateBuyOrderPnL(
    order: OrderWithDetails,
    currentPrice: string,
    baseCurrency: string
  ): PnLResult {
    const filledQty = new BigNumber(order.filledQuantity);
    const avgPrice = new BigNumber(order.averagePrice);
    const currentPriceBN = new BigNumber(currentPrice);
    const totalFees = new BigNumber(order.totalFees);
    const remainingQty = new BigNumber(order.remainingQuantity);

    // Cost basis including fees
    const totalCost = filledQty.multipliedBy(avgPrice).plus(totalFees);
    const currentValue = filledQty.multipliedBy(currentPriceBN);

    let realizedPnL = new BigNumber(0);
    let unrealizedPnL = new BigNumber(0);

    if (remainingQty.isZero() && order.status === 'FILLED') {
      // Fully filled - all P&L is realized
      realizedPnL = currentValue.minus(totalCost);
    } else {
      // Partially filled or open - P&L is unrealized
      unrealizedPnL = currentValue.minus(totalCost);
    }

    const totalPnL = realizedPnL.plus(unrealizedPnL);
    const pnlPercentage = totalCost.isZero() 
      ? new BigNumber(0) 
      : totalPnL.dividedBy(totalCost).multipliedBy(100);

    return {
      realizedPnL: realizedPnL.toFixed(2),
      unrealizedPnL: unrealizedPnL.toFixed(2),
      totalPnL: totalPnL.toFixed(2),
      pnlPercentage: pnlPercentage.toFixed(2),
      totalFees: totalFees.toFixed(2),
      netPnL: totalPnL.minus(totalFees).toFixed(2)
    };
  }

  /**
   * Calculate P&L for sell orders
   */
  private calculateSellOrderPnL(
    order: OrderWithDetails,
    currentPrice: string,
    baseCurrency: string
  ): PnLResult {
    const filledQty = new BigNumber(order.filledQuantity);
    const avgPrice = new BigNumber(order.averagePrice);
    const currentPriceBN = new BigNumber(currentPrice);
    const totalFees = new BigNumber(order.totalFees);

    // For sell orders, profit comes from selling at higher price than current
    const saleProceeds = filledQty.multipliedBy(avgPrice);
    const currentCost = filledQty.multipliedBy(currentPriceBN);
    
    const totalPnL = saleProceeds.minus(currentCost).minus(totalFees);
    const pnlPercentage = currentCost.isZero()
      ? new BigNumber(0)
      : totalPnL.dividedBy(currentCost).multipliedBy(100);

    return {
      realizedPnL: totalPnL.toFixed(2),
      unrealizedPnL: '0',
      totalPnL: totalPnL.toFixed(2),
      pnlPercentage: pnlPercentage.toFixed(2),
      totalFees: totalFees.toFixed(2),
      netPnL: totalPnL.toFixed(2)
    };
  }

  /**
   * Calculate P&L for multiple orders considering FIFO
   */
  calculatePortfolioPnL(
    orders: OrderWithDetails[],
    prices: Record<string, PriceData>
  ): Map<string, PnLResult> {
    const results = new Map<string, PnLResult>();
    
    // Sort orders by timestamp for FIFO calculation
    const sortedOrders = [...orders].sort((a, b) => 
      a.createdAt.getTime() - b.createdAt.getTime()
    );

    // Process each order
    for (const order of sortedOrders) {
      const priceData = prices[order.pair];
      if (!priceData) {
        logger.warn('No price data for pair', { pair: order.pair });
        continue;
      }

      const pnl = this.calculateOrderPnL(order, priceData.currentPrice, 'USD');
      results.set(order.id, pnl);

      // Update position tracking for cross-order P&L
      this.updatePosition(order);
    }

    return results;
  }

  /**
   * Update position tracking for FIFO calculation
   */
  private updatePosition(order: OrderWithDetails): void {
    const pair = order.pair;
    const position = this.positions.get(pair) || {
      pair,
      side: order.side === OrderSide.BUY ? 'LONG' : 'SHORT',
      quantity: new BigNumber(0),
      averagePrice: new BigNumber(0),
      totalCost: new BigNumber(0),
      fees: new BigNumber(0)
    };

    const filledQty = new BigNumber(order.filledQuantity);
    const avgPrice = new BigNumber(order.averagePrice);
    const fees = new BigNumber(order.totalFees);

    if (order.side === OrderSide.BUY) {
      // Adding to position
      const newTotalCost = position.totalCost.plus(filledQty.multipliedBy(avgPrice));
      const newQuantity = position.quantity.plus(filledQty);
      
      position.quantity = newQuantity;
      position.averagePrice = newQuantity.isZero() 
        ? new BigNumber(0) 
        : newTotalCost.dividedBy(newQuantity);
      position.totalCost = newTotalCost;
      position.fees = position.fees.plus(fees);
    } else {
      // Reducing position
      position.quantity = position.quantity.minus(filledQty);
      
      if (position.quantity.isLessThanOrEqualTo(0)) {
        // Position closed or reversed
        this.positions.delete(pair);
        return;
      }
      
      position.fees = position.fees.plus(fees);
    }

    this.positions.set(pair, position);
  }

  /**
   * Calculate aggregate P&L statistics
   */
  static calculateAggregateStats(
    orders: OrderWithDetails[],
    pnlResults: Map<string, PnLResult>
  ): {
    totalRealizedPnL: string;
    totalUnrealizedPnL: string;
    totalFees: string;
    netPnL: string;
    winRate: string;
    averageWin: string;
    averageLoss: string;
    profitFactor: string;
  } {
    let totalRealized = new BigNumber(0);
    let totalUnrealized = new BigNumber(0);
    let totalFees = new BigNumber(0);
    let wins = 0;
    let losses = 0;
    let totalWins = new BigNumber(0);
    let totalLosses = new BigNumber(0);

    for (const [orderId, pnl] of pnlResults) {
      const realized = new BigNumber(pnl.realizedPnL);
      const unrealized = new BigNumber(pnl.unrealizedPnL);
      const fees = new BigNumber(pnl.totalFees);

      totalRealized = totalRealized.plus(realized);
      totalUnrealized = totalUnrealized.plus(unrealized);
      totalFees = totalFees.plus(fees);

      // Count wins/losses (only on realized P&L)
      if (realized.isGreaterThan(0)) {
        wins++;
        totalWins = totalWins.plus(realized);
      } else if (realized.isLessThan(0)) {
        losses++;
        totalLosses = totalLosses.plus(realized.abs());
      }
    }

    const totalTrades = wins + losses;
    const winRate = totalTrades === 0 ? 0 : (wins / totalTrades) * 100;
    const averageWin = wins === 0 ? new BigNumber(0) : totalWins.dividedBy(wins);
    const averageLoss = losses === 0 ? new BigNumber(0) : totalLosses.dividedBy(losses);
    const profitFactor = totalLosses.isZero() 
      ? totalWins.isZero() ? new BigNumber(0) : new BigNumber(Infinity)
      : totalWins.dividedBy(totalLosses);

    return {
      totalRealizedPnL: totalRealized.toFixed(2),
      totalUnrealizedPnL: totalUnrealized.toFixed(2),
      totalFees: totalFees.toFixed(2),
      netPnL: totalRealized.plus(totalUnrealized).minus(totalFees).toFixed(2),
      winRate: winRate.toFixed(2),
      averageWin: averageWin.toFixed(2),
      averageLoss: averageLoss.toFixed(2),
      profitFactor: profitFactor.isFinite() ? profitFactor.toFixed(2) : 'N/A'
    };
  }

  /**
   * Reset position tracking
   */
  reset(): void {
    this.positions.clear();
  }
}