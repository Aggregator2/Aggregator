// Common types for the API v1

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  meta?: any;
}

// Order types
export interface Order {
  id: string;
  userId: string;
  pair: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit' | 'stop_loss' | 'take_profit';
  status: 'pending' | 'open' | 'partially_filled' | 'filled' | 'cancelled' | 'expired';
  amount: string;
  remainingAmount: string;
  price?: string;
  stopPrice?: string;
  averagePrice?: string;
  timeInForce: 'GTC' | 'IOC' | 'FOK';
  postOnly: boolean;
  fees: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
}

// Trade types
export interface Trade {
  id: string;
  orderId: string;
  userId: string;
  pair: string;
  side: 'buy' | 'sell';
  price: string;
  amount: string;
  fee: string;
  feeAsset: string;
  timestamp: Date;
  isMaker: boolean;
  settlementStatus: 'pending' | 'settled';
  txHash?: string;
}

// Order book types
export interface OrderBookLevel {
  price: string;
  amount: string;
  total: string;
  orderCount: number;
}

export interface OrderBook {
  pair: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  timestamp: Date;
  sequenceNumber: number;
}

// Settlement types
export interface Settlement {
  id: string;
  userId: string;
  tradeIds: string[];
  status: 'pending' | 'processing' | 'completed' | 'failed';
  amount: string;
  asset: string;
  settlementAddress: string;
  txHash?: string;
  fee?: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  failureReason?: string;
}

// Account types
export interface Account {
  id: string;
  userId: string;
  email: string;
  status: 'active' | 'suspended' | 'inactive';
  kycStatus: 'none' | 'pending' | 'approved' | 'rejected';
  defaultSettlementAddress?: string;
  tradingPreferences: {
    defaultSlippage: number;
    autoSettlement: boolean;
    notifications: {
      orderFilled: boolean;
      orderCancelled: boolean;
      settlementCompleted: boolean;
    };
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface Balance {
  asset: string;
  available: string;
  locked: string;
  total: string;
  lastUpdated: Date;
}

// WebSocket message types
export interface WebSocketMessage {
  type: string;
  channel: string;
  data: any;
  timestamp: Date;
  sequenceNumber?: number;
}

export interface OrderUpdate extends WebSocketMessage {
  type: 'order.created' | 'order.updated' | 'order.filled' | 'order.cancelled';
  data: Order;
}

export interface TradeUpdate extends WebSocketMessage {
  type: 'trade.executed';
  data: Trade;
}

export interface OrderBookUpdate extends WebSocketMessage {
  type: 'orderbook.update' | 'orderbook.snapshot';
  data: {
    pair: string;
    bids?: OrderBookLevel[];
    asks?: OrderBookLevel[];
    changes?: {
      side: 'bid' | 'ask';
      price: string;
      amount: string;
      action: 'add' | 'update' | 'remove';
    }[];
  };
}

// Market data types
export interface Ticker {
  pair: string;
  lastPrice: string;
  bidPrice: string;
  askPrice: string;
  volume24h: string;
  high24h: string;
  low24h: string;
  change24h: string;
  changePercent24h: string;
  timestamp: Date;
}

export interface Candle {
  timestamp: Date;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  trades: number;
}

// Error codes
export enum ErrorCode {
  // General errors
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  NOT_FOUND = 'NOT_FOUND',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  
  // Order errors
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
  INVALID_ORDER_TYPE = 'INVALID_ORDER_TYPE',
  INVALID_ORDER_SIDE = 'INVALID_ORDER_SIDE',
  ORDER_NOT_FOUND = 'ORDER_NOT_FOUND',
  ORDER_ALREADY_FILLED = 'ORDER_ALREADY_FILLED',
  ORDER_ALREADY_CANCELLED = 'ORDER_ALREADY_CANCELLED',
  MINIMUM_ORDER_SIZE = 'MINIMUM_ORDER_SIZE',
  MAXIMUM_ORDER_SIZE = 'MAXIMUM_ORDER_SIZE',
  
  // Trading errors
  MARKET_CLOSED = 'MARKET_CLOSED',
  PAIR_NOT_FOUND = 'PAIR_NOT_FOUND',
  INVALID_PRICE = 'INVALID_PRICE',
  INVALID_AMOUNT = 'INVALID_AMOUNT',
  
  // Settlement errors
  SETTLEMENT_FAILED = 'SETTLEMENT_FAILED',
  INVALID_SETTLEMENT_ADDRESS = 'INVALID_SETTLEMENT_ADDRESS',
  SETTLEMENT_ALREADY_PROCESSED = 'SETTLEMENT_ALREADY_PROCESSED',
  
  // Account errors
  ACCOUNT_SUSPENDED = 'ACCOUNT_SUSPENDED',
  KYC_REQUIRED = 'KYC_REQUIRED',
  WITHDRAWAL_LIMIT_EXCEEDED = 'WITHDRAWAL_LIMIT_EXCEEDED'
}