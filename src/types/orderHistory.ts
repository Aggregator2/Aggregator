// Order History Types and Interfaces

export interface OrderHistoryRequest {
  // Pagination
  cursor?: string;
  limit?: number; // Default: 50, Max: 100
  
  // Filters
  dateFrom?: string; // ISO 8601 date string
  dateTo?: string; // ISO 8601 date string
  pair?: string;
  status?: OrderStatus | OrderStatus[];
  side?: OrderSide;
  
  // Sorting
  sortBy?: OrderSortField;
  sortOrder?: 'asc' | 'desc'; // Default: desc
}

export enum OrderStatus {
  PENDING = 'PENDING',
  OPEN = 'OPEN',
  PARTIALLY_FILLED = 'PARTIALLY_FILLED',
  FILLED = 'FILLED',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
  FAILED = 'FAILED'
}

export enum OrderSide {
  BUY = 'BUY',
  SELL = 'SELL'
}

export enum OrderType {
  MARKET = 'MARKET',
  LIMIT = 'LIMIT',
  STOP = 'STOP',
  STOP_LIMIT = 'STOP_LIMIT'
}

export enum OrderSortField {
  TIMESTAMP = 'timestamp',
  PNL = 'pnl',
  VOLUME = 'volume',
  PRICE = 'price',
  FILLED_QUANTITY = 'filledQuantity'
}

export interface TradeExecution {
  id: string;
  orderId: string;
  tradeId: string;
  price: string;
  quantity: string;
  fee: string;
  feeToken: string;
  timestamp: Date;
  counterpartyOrderId?: string;
  liquidityType: 'MAKER' | 'TAKER';
}

export interface OrderWithDetails {
  // Order fields
  id: string;
  userId: string;
  pair: string;
  side: OrderSide;
  type: OrderType;
  status: OrderStatus;
  price: string;
  quantity: string;
  filledQuantity: string;
  remainingQuantity: string;
  averagePrice: string;
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
  lastFilledAt?: Date;
  cancelledAt?: Date;
  
  // Trade details
  trades: TradeExecution[];
  tradesCount: number;
  
  // Financial metrics
  totalVolume: string; // filledQuantity * averagePrice
  totalFees: string;
  realizedPnL?: string; // Calculated if position closed
  unrealizedPnL?: string; // For open positions
  pnlPercentage?: string;
  
  // Additional metadata
  clientOrderId?: string;
  metadata?: Record<string, any>;
}

export interface PriceData {
  pair: string;
  currentPrice: string;
  price24hAgo: string;
  priceChange24h: string;
  priceChangePercent24h: string;
}

export interface OrderSummaryStatistics {
  // Volume statistics
  totalVolume: string;
  totalVolumeUSD: string;
  volumeByPair: Record<string, string>;
  
  // Trade statistics
  totalTrades: number;
  totalOrders: number;
  completedOrders: number;
  cancelledOrders: number;
  
  // Performance metrics
  winRate: string; // Percentage of profitable trades
  totalRealizedPnL: string;
  totalUnrealizedPnL: string;
  totalFees: string;
  netPnL: string; // realizedPnL - fees
  
  // Average metrics
  averageTradeSize: string;
  averageOrderSize: string;
  averageWinAmount: string;
  averageLossAmount: string;
  profitFactor: string; // Total wins / Total losses
  
  // Time-based metrics
  ordersToday: number;
  ordersThisWeek: number;
  ordersThisMonth: number;
  
  // Pair distribution
  mostTradedPair: string;
  pairDistribution: Array<{
    pair: string;
    orderCount: number;
    volume: string;
    percentage: string;
  }>;
}

export interface OrderHistoryResponse {
  // Pagination info
  cursor: {
    next?: string;
    previous?: string;
    hasMore: boolean;
    total?: number; // Optional, expensive to calculate
  };
  
  // Data
  orders: OrderWithDetails[];
  
  // Summary statistics (calculated from filtered results)
  summary: OrderSummaryStatistics;
  
  // Current prices for P&L calculation
  prices: Record<string, PriceData>;
  
  // Metadata
  requestId: string;
  timestamp: Date;
  executionTime: number; // milliseconds
}

export interface CursorData {
  timestamp: Date;
  orderId: string;
  sortValue?: string | number; // Value of the sort field
}

export class OrderHistoryError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 400,
    public details?: any
  ) {
    super(message);
    this.name = 'OrderHistoryError';
  }
}

// Validation schemas
export const OrderHistoryRequestSchema = {
  cursor: { type: 'string', optional: true, maxLength: 200 },
  limit: { type: 'number', optional: true, min: 1, max: 100, default: 50 },
  dateFrom: { type: 'string', optional: true, format: 'date-time' },
  dateTo: { type: 'string', optional: true, format: 'date-time' },
  pair: { type: 'string', optional: true, pattern: '^[A-Z]+/[A-Z]+$' },
  status: { 
    type: 'string', 
    optional: true, 
    enum: Object.values(OrderStatus),
    array: true 
  },
  side: { type: 'string', optional: true, enum: Object.values(OrderSide) },
  sortBy: { 
    type: 'string', 
    optional: true, 
    enum: Object.values(OrderSortField),
    default: OrderSortField.TIMESTAMP 
  },
  sortOrder: { type: 'string', optional: true, enum: ['asc', 'desc'], default: 'desc' }
};

// Helper types for internal use
export interface OrderFilter {
  userId: string;
  createdAt?: {
    gte?: Date;
    lte?: Date;
  };
  pair?: string;
  status?: {
    in?: OrderStatus[];
  };
  side?: OrderSide;
}

export interface PaginationOptions {
  cursor?: CursorData;
  limit: number;
  sortBy: OrderSortField;
  sortOrder: 'asc' | 'desc';
}