// Order types and enums
export enum OrderType {
  LIMIT = 'LIMIT',
  MARKET = 'MARKET',
  STOP_LIMIT = 'STOP_LIMIT',
  STOP_MARKET = 'STOP_MARKET',
}

export enum OrderSide {
  BUY = 'BUY',
  SELL = 'SELL',
}

export enum OrderStatus {
  PENDING = 'PENDING',
  OPEN = 'OPEN',
  PARTIALLY_FILLED = 'PARTIALLY_FILLED',
  FILLED = 'FILLED',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
}

export enum TimeInForce {
  GTC = 'GTC', // Good Till Cancelled
  IOC = 'IOC', // Immediate Or Cancel
  FOK = 'FOK', // Fill Or Kill
  DAY = 'DAY', // Day Order
}

// Base order interface
export interface Order {
  id: string;
  userId: string;
  pair: string; // e.g., "ETH/USDC"
  side: OrderSide;
  type: OrderType;
  price: number; // For limit orders
  quantity: number;
  filledQuantity: number;
  status: OrderStatus;
  timeInForce: TimeInForce;
  timestamp: number;
  lastUpdateTime: number;
  clientOrderId?: string;
  stopPrice?: number; // For stop orders
  metadata?: Record<string, any>;
  displayQuantity?: number; // For iceberg orders
  postOnly?: boolean;
  selfTradePrevention?: 'CANCEL_OLDEST' | 'CANCEL_NEWEST' | 'CANCEL_BOTH';
  maxPriceImpact?: number;
}

// Trade execution interface
export interface Trade {
  id: string;
  pair: string;
  takerOrderId: string;
  makerOrderId: string;
  takerUserId?: string;
  makerUserId?: string;
  price: number;
  quantity: number;
  takerSide: OrderSide;
  timestamp: number;
  takerFee: number;
  makerFee: number;
  settlementStatus?: 'pending' | 'settled' | 'failed';
}

// Order book level
export interface OrderBookLevel {
  price: number;
  quantity: number;
  orders: Order[];
}

// Order book snapshot
export interface OrderBookSnapshot {
  pair: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  lastUpdateTime: number;
  sequenceNumber: number;
}

// Trade execution report
export interface ExecutionReport {
  orderId: string;
  clientOrderId?: string;
  executionId: string;
  status: OrderStatus;
  side: OrderSide;
  pair: string;
  price: number;
  quantity: number;
  filledQuantity: number;
  remainingQuantity: number;
  averagePrice: number;
  trades: Trade[];
  timestamp: number;
  message?: string;
}

// Matching engine configuration
export interface MatchingEngineConfig {
  maxOrderBookDepth: number;
  minOrderSize: Record<string, number>; // Min size per pair
  maxOrderSize: Record<string, number>; // Max size per pair
  tickSize: Record<string, number>; // Price increment per pair
  makerFeeRate: number;
  takerFeeRate: number;
  enableStopOrders: boolean;
  enableIcebergOrders: boolean;
}

// Order book update events
export interface OrderBookUpdate {
  type: 'ADD' | 'UPDATE' | 'REMOVE';
  side: OrderSide;
  price: number;
  quantity: number;
  orderId: string;
  timestamp: number;
  sequenceNumber: number;
}

// Market data
export interface MarketData {
  pair: string;
  lastPrice: number;
  bidPrice: number;
  askPrice: number;
  bidQuantity: number;
  askQuantity: number;
  volume24h: number;
  high24h: number;
  low24h: number;
  openPrice24h: number;
  lastUpdateTime: number;
}