import { createLogger } from '../../utils/production-logger';
import { getPrismaClient } from '../../config/database.config';
import { CursorPagination } from '../../utils/cursorPagination';
import { PnLCalculator } from './PnLCalculator';
import BigNumber from 'bignumber.js';
import {
  OrderHistoryRequest,
  OrderHistoryResponse,
  OrderWithDetails,
  OrderFilter,
  PaginationOptions,
  OrderSummaryStatistics,
  TradeExecution,
  PriceData,
  OrderHistoryError,
  OrderSortField,
  OrderStatus,
  CursorData
} from '../../types/orderHistory';

const logger = createLogger('OrderHistoryService');
const prisma = getPrismaClient();

export class OrderHistoryService {
  private pnlCalculator: PnLCalculator;

  constructor() {
    this.pnlCalculator = new PnLCalculator();
  }

  /**
   * Get order history with pagination and filters
   */
  async getOrderHistory(
    userId: string,
    request: OrderHistoryRequest
  ): Promise<OrderHistoryResponse> {
    const startTime = Date.now();
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    try {
      logger.info('Processing order history request', { userId, requestId, request });

      // Validate and prepare request
      const validatedRequest = this.validateRequest(request);
      const { filter, paginationOptions } = this.prepareQuery(userId, validatedRequest);

      // Fetch orders with trades
      const orders = await this.fetchOrdersWithTrades(filter, paginationOptions);

      // Fetch current prices for P&L calculation
      const prices = await this.fetchCurrentPrices(orders);

      // Calculate P&L for each order
      const ordersWithPnL = this.calculateOrdersPnL(orders, prices);

      // Calculate summary statistics
      const summary = await this.calculateSummaryStatistics(
        userId,
        filter,
        ordersWithPnL,
        prices
      );

      // Generate pagination cursors
      const cursor = this.generateCursors(
        ordersWithPnL,
        paginationOptions,
        validatedRequest.cursor
      );

      const executionTime = Date.now() - startTime;

      return {
        cursor,
        orders: ordersWithPnL,
        summary,
        prices,
        requestId,
        timestamp: new Date(),
        executionTime
      };

    } catch (error) {
      logger.error('Order history request failed', error, { userId, requestId });
      
      if (error instanceof OrderHistoryError) {
        throw error;
      }
      
      throw new OrderHistoryError(
        'Failed to fetch order history',
        'INTERNAL_ERROR',
        500,
        { originalError: error.message }
      );
    }
  }

  /**
   * Validate request parameters
   */
  private validateRequest(request: OrderHistoryRequest): OrderHistoryRequest {
    const validated: OrderHistoryRequest = {
      limit: Math.min(request.limit || 50, 100),
      sortBy: request.sortBy || OrderSortField.TIMESTAMP,
      sortOrder: request.sortOrder || 'desc'
    };

    // Validate cursor
    if (request.cursor && !CursorPagination.isValidCursor(request.cursor)) {
      throw new OrderHistoryError('Invalid cursor', 'INVALID_CURSOR', 400);
    }
    validated.cursor = request.cursor;

    // Validate date range
    if (request.dateFrom) {
      const dateFrom = new Date(request.dateFrom);
      if (isNaN(dateFrom.getTime())) {
        throw new OrderHistoryError('Invalid dateFrom', 'INVALID_DATE', 400);
      }
      validated.dateFrom = request.dateFrom;
    }

    if (request.dateTo) {
      const dateTo = new Date(request.dateTo);
      if (isNaN(dateTo.getTime())) {
        throw new OrderHistoryError('Invalid dateTo', 'INVALID_DATE', 400);
      }
      validated.dateTo = request.dateTo;
    }

    // Validate pair format
    if (request.pair && !/^[A-Z]+\/[A-Z]+$/.test(request.pair)) {
      throw new OrderHistoryError('Invalid pair format', 'INVALID_PAIR', 400);
    }
    validated.pair = request.pair;

    // Validate status
    if (request.status) {
      const statuses = Array.isArray(request.status) ? request.status : [request.status];
      const validStatuses = Object.values(OrderStatus);
      for (const status of statuses) {
        if (!validStatuses.includes(status)) {
          throw new OrderHistoryError('Invalid status', 'INVALID_STATUS', 400);
        }
      }
      validated.status = request.status;
    }

    validated.side = request.side;

    return validated;
  }

  /**
   * Prepare database query filters and pagination
   */
  private prepareQuery(
    userId: string,
    request: OrderHistoryRequest
  ): { filter: OrderFilter; paginationOptions: PaginationOptions } {
    const filter: OrderFilter = { userId };

    // Date range filter
    if (request.dateFrom || request.dateTo) {
      filter.createdAt = {};
      if (request.dateFrom) {
        filter.createdAt.gte = new Date(request.dateFrom);
      }
      if (request.dateTo) {
        filter.createdAt.lte = new Date(request.dateTo);
      }
    }

    // Other filters
    if (request.pair) {
      filter.pair = request.pair;
    }

    if (request.status) {
      filter.status = {
        in: Array.isArray(request.status) ? request.status : [request.status]
      };
    }

    if (request.side) {
      filter.side = request.side;
    }

    // Pagination options
    const cursorData = request.cursor 
      ? CursorPagination.decodeCursor(request.cursor) 
      : null;

    const paginationOptions: PaginationOptions = {
      cursor: cursorData,
      limit: request.limit!,
      sortBy: request.sortBy!,
      sortOrder: request.sortOrder!
    };

    return { filter, paginationOptions };
  }

  /**
   * Fetch orders with trade execution details
   */
  private async fetchOrdersWithTrades(
    filter: OrderFilter,
    pagination: PaginationOptions
  ): Promise<OrderWithDetails[]> {
    // Build cursor condition
    const cursorCondition = CursorPagination.buildCursorCondition(
      pagination.cursor,
      pagination.sortBy,
      pagination.sortOrder
    );

    // Combine filters
    const where = {
      ...filter,
      ...cursorCondition
    };

    // Build order by clause
    const orderBy = this.buildOrderByClause(pagination.sortBy, pagination.sortOrder);

    // Fetch orders
    const orders = await prisma.order.findMany({
      where,
      orderBy,
      take: pagination.limit + 1, // Fetch one extra to check if there are more
      include: {
        trades: {
          orderBy: { createdAt: 'asc' }
        }
      }
    });

    // Convert to OrderWithDetails format
    return orders.slice(0, pagination.limit).map(order => this.mapOrderToDetails(order));
  }

  /**
   * Build order by clause for different sort fields
   */
  private buildOrderByClause(sortBy: OrderSortField, sortOrder: 'asc' | 'desc'): any {
    const baseOrder = [
      { createdAt: sortOrder },
      { id: sortOrder }
    ];

    switch (sortBy) {
      case OrderSortField.TIMESTAMP:
        return baseOrder;
      
      case OrderSortField.VOLUME:
        return [
          { totalVolume: sortOrder },
          ...baseOrder
        ];
      
      case OrderSortField.FILLED_QUANTITY:
        return [
          { filledQuantity: sortOrder },
          ...baseOrder
        ];
      
      case OrderSortField.PRICE:
        return [
          { price: sortOrder },
          ...baseOrder
        ];
      
      case OrderSortField.PNL:
        // P&L is calculated post-query, so we sort by volume as proxy
        return [
          { totalVolume: sortOrder },
          ...baseOrder
        ];
      
      default:
        return baseOrder;
    }
  }

  /**
   * Map database order to OrderWithDetails
   */
  private mapOrderToDetails(order: any): OrderWithDetails {
    const trades: TradeExecution[] = (order.trades || []).map((trade: any) => ({
      id: trade.id,
      orderId: trade.orderId,
      tradeId: trade.tradeId,
      price: trade.price.toString(),
      quantity: trade.quantity.toString(),
      fee: trade.fee.toString(),
      feeToken: trade.feeToken,
      timestamp: trade.createdAt,
      counterpartyOrderId: trade.counterpartyOrderId,
      liquidityType: trade.liquidityType
    }));

    // Calculate aggregate values
    const filledQuantity = new BigNumber(order.filledQuantity || 0);
    const totalVolume = trades.reduce((sum, trade) => {
      return sum.plus(new BigNumber(trade.price).multipliedBy(trade.quantity));
    }, new BigNumber(0));

    const totalFees = trades.reduce((sum, trade) => {
      return sum.plus(trade.fee);
    }, new BigNumber(0));

    const averagePrice = filledQuantity.isZero() 
      ? new BigNumber(0)
      : totalVolume.dividedBy(filledQuantity);

    return {
      id: order.id,
      userId: order.userId,
      pair: order.pair,
      side: order.side,
      type: order.type,
      status: order.status,
      price: order.price.toString(),
      quantity: order.quantity.toString(),
      filledQuantity: filledQuantity.toString(),
      remainingQuantity: new BigNumber(order.quantity).minus(filledQuantity).toString(),
      averagePrice: averagePrice.toString(),
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      lastFilledAt: order.lastFilledAt,
      cancelledAt: order.cancelledAt,
      trades,
      tradesCount: trades.length,
      totalVolume: totalVolume.toString(),
      totalFees: totalFees.toString(),
      clientOrderId: order.clientOrderId,
      metadata: order.metadata
    };
  }

  /**
   * Fetch current prices for P&L calculation
   */
  private async fetchCurrentPrices(
    orders: OrderWithDetails[]
  ): Promise<Record<string, PriceData>> {
    const pairs = [...new Set(orders.map(o => o.pair))];
    const prices: Record<string, PriceData> = {};

    // In production, this would fetch from a price service
    // For now, using mock data
    for (const pair of pairs) {
      prices[pair] = {
        pair,
        currentPrice: '2000.00', // Mock current price
        price24hAgo: '1950.00',
        priceChange24h: '50.00',
        priceChangePercent24h: '2.56'
      };
    }

    return prices;
  }

  /**
   * Calculate P&L for orders
   */
  private calculateOrdersPnL(
    orders: OrderWithDetails[],
    prices: Record<string, PriceData>
  ): OrderWithDetails[] {
    const pnlResults = this.pnlCalculator.calculatePortfolioPnL(orders, prices);

    return orders.map(order => {
      const pnl = pnlResults.get(order.id);
      if (!pnl) return order;

      return {
        ...order,
        realizedPnL: pnl.realizedPnL,
        unrealizedPnL: pnl.unrealizedPnL,
        pnlPercentage: pnl.pnlPercentage
      };
    });
  }

  /**
   * Calculate summary statistics
   */
  private async calculateSummaryStatistics(
    userId: string,
    filter: OrderFilter,
    orders: OrderWithDetails[],
    prices: Record<string, PriceData>
  ): Promise<OrderSummaryStatistics> {
    // Get aggregate stats from filtered results
    const stats = await prisma.order.aggregate({
      where: filter,
      _count: true,
      _sum: {
        quantity: true,
        filledQuantity: true,
        totalVolume: true
      }
    });

    // Get status counts
    const statusCounts = await prisma.order.groupBy({
      by: ['status'],
      where: filter,
      _count: true
    });

    const statusMap = statusCounts.reduce((acc, curr) => {
      acc[curr.status] = curr._count;
      return acc;
    }, {} as Record<string, number>);

    // Calculate P&L statistics
    const pnlStats = PnLCalculator.calculateAggregateStats(
      orders,
      this.pnlCalculator.calculatePortfolioPnL(orders, prices)
    );

    // Calculate pair distribution
    const pairStats = await prisma.order.groupBy({
      by: ['pair'],
      where: filter,
      _count: true,
      _sum: {
        totalVolume: true
      },
      orderBy: {
        _sum: {
          totalVolume: 'desc'
        }
      }
    });

    const totalVolumeAllPairs = pairStats.reduce(
      (sum, p) => sum.plus(p._sum.totalVolume || 0),
      new BigNumber(0)
    );

    const pairDistribution = pairStats.map(p => ({
      pair: p.pair,
      orderCount: p._count,
      volume: (p._sum.totalVolume || 0).toString(),
      percentage: totalVolumeAllPairs.isZero()
        ? '0'
        : new BigNumber(p._sum.totalVolume || 0)
            .dividedBy(totalVolumeAllPairs)
            .multipliedBy(100)
            .toFixed(2)
    }));

    // Time-based metrics
    const now = new Date();
    const todayStart = new Date(now.setHours(0, 0, 0, 0));
    const weekStart = new Date(now.setDate(now.getDate() - now.getDay()));
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [ordersToday, ordersThisWeek, ordersThisMonth] = await Promise.all([
      prisma.order.count({ where: { ...filter, createdAt: { gte: todayStart } } }),
      prisma.order.count({ where: { ...filter, createdAt: { gte: weekStart } } }),
      prisma.order.count({ where: { ...filter, createdAt: { gte: monthStart } } })
    ]);

    return {
      totalVolume: (stats._sum.totalVolume || 0).toString(),
      totalVolumeUSD: (stats._sum.totalVolume || 0).toString(), // In production, convert to USD
      volumeByPair: pairStats.reduce((acc, p) => {
        acc[p.pair] = (p._sum.totalVolume || 0).toString();
        return acc;
      }, {} as Record<string, string>),
      totalTrades: orders.reduce((sum, o) => sum + o.tradesCount, 0),
      totalOrders: stats._count,
      completedOrders: statusMap[OrderStatus.FILLED] || 0,
      cancelledOrders: statusMap[OrderStatus.CANCELLED] || 0,
      winRate: pnlStats.winRate,
      totalRealizedPnL: pnlStats.totalRealizedPnL,
      totalUnrealizedPnL: pnlStats.totalUnrealizedPnL,
      totalFees: pnlStats.totalFees,
      netPnL: pnlStats.netPnL,
      averageTradeSize: stats._count === 0 
        ? '0' 
        : new BigNumber(stats._sum.totalVolume || 0)
            .dividedBy(stats._count)
            .toFixed(2),
      averageOrderSize: stats._count === 0
        ? '0'
        : new BigNumber(stats._sum.quantity || 0)
            .dividedBy(stats._count)
            .toFixed(2),
      averageWinAmount: pnlStats.averageWin,
      averageLossAmount: pnlStats.averageLoss,
      profitFactor: pnlStats.profitFactor,
      ordersToday,
      ordersThisWeek,
      ordersThisMonth,
      mostTradedPair: pairDistribution[0]?.pair || '',
      pairDistribution: pairDistribution.slice(0, 10) // Top 10 pairs
    };
  }

  /**
   * Generate pagination cursors
   */
  private generateCursors(
    orders: OrderWithDetails[],
    pagination: PaginationOptions,
    currentCursor?: string
  ): {
    next?: string;
    previous?: string;
    hasMore: boolean;
    total?: number;
  } {
    const hasMore = orders.length > pagination.limit;
    
    const next = orders.length > 0
      ? CursorPagination.generateNextCursor(
          orders[orders.length - 1],
          pagination.sortBy
        )
      : undefined;

    // Previous cursor only if we're not on the first page
    const previous = currentCursor && orders.length > 0
      ? CursorPagination.generatePreviousCursor(
          orders[0],
          pagination.sortBy
        )
      : undefined;

    return {
      next,
      previous,
      hasMore
    };
  }
}