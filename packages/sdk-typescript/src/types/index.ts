// Core types
export interface ClientOptions {
  baseUrl?: string;
  testnet?: boolean;
  timeout?: number;
  retryAttempts?: number;
  retryDelay?: number;
  rateLimitRetry?: boolean;
  websocketUrl?: string;
  headers?: Record<string, string>;
}

// Order types
export enum OrderSide {
  BUY = 'buy',
  SELL = 'sell'
}

export enum OrderType {
  MARKET = 'market',
  LIMIT = 'limit',
  STOP = 'stop',
  STOP_LIMIT = 'stop_limit'
}

export enum OrderStatus {
  PENDING = 'pending',
  OPEN = 'open',
  PARTIALLY_FILLED = 'partially_filled',
  FILLED = 'filled',
  CANCELLED = 'cancelled',
  REJECTED = 'rejected',
  EXPIRED = 'expired'
}

export enum TimeInForce {
  GTC = 'gtc', // Good Till Cancelled
  IOC = 'ioc', // Immediate Or Cancel
  FOK = 'fok', // Fill Or Kill
  GTT = 'gtt'  // Good Till Time
}

export interface Order {
  id: string;
  userId: string;
  pair: string;
  side: OrderSide;
  type: OrderType;
  price: string;
  quantity: string;
  filledQuantity: string;
  status: OrderStatus;
  timeInForce: TimeInForce;
  stopPrice?: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
  metadata?: Record<string, any>;
}

export interface CreateOrderRequest {
  pair: string;
  side: OrderSide;
  type: OrderType;
  quantity: string;
  price?: string; // Required for limit orders
  stopPrice?: string; // Required for stop orders
  timeInForce?: TimeInForce;
  expiresAt?: Date;
  metadata?: Record<string, any>;
}

export interface UpdateOrderRequest {
  price?: string;
  quantity?: string;
  stopPrice?: string;
}

export interface OrderFilter {
  pair?: string;
  side?: OrderSide;
  status?: OrderStatus | OrderStatus[];
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

// Order Book types
export interface OrderBookLevel {
  price: string;
  quantity: string;
  orderCount: number;
}

export interface OrderBook {
  pair: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  timestamp: Date;
  sequenceNumber: number;
}

export interface OrderBookUpdate {
  pair: string;
  side: OrderSide;
  price: string;
  quantity: string;
  action: 'add' | 'update' | 'remove';
  timestamp: Date;
  sequenceNumber: number;
}

// Trade types
export interface Trade {
  id: string;
  pair: string;
  price: string;
  quantity: string;
  side: OrderSide; // Taker side
  buyOrderId: string;
  sellOrderId: string;
  buyerUserId: string;
  sellerUserId: string;
  fee: string;
  timestamp: Date;
}

export interface TradeFilter {
  pair?: string;
  userId?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

// Settlement types
export enum SettlementStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed'
}

export interface Settlement {
  id: string;
  epochId: string;
  userId: string;
  currency: string;
  amount: string;
  status: SettlementStatus;
  txHash?: string;
  blockNumber?: number;
  merkleProof?: string[];
  createdAt: Date;
  completedAt?: Date;
}

export interface SettlementProof {
  epochId: string;
  userId: string;
  currency: string;
  amount: string;
  merkleProof: string[];
  merkleRoot: string;
  leafIndex: number;
}

// Market Data types
export interface Ticker {
  pair: string;
  lastPrice: string;
  bidPrice: string;
  askPrice: string;
  baseVolume24h: string;
  quoteVolume24h: string;
  priceChange24h: string;
  priceChangePercent24h: string;
  high24h: string;
  low24h: string;
  openPrice24h: string;
  trades24h: number;
  timestamp: Date;
}

export interface Candle {
  pair: string;
  interval: CandleInterval;
  openTime: Date;
  closeTime: Date;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  quoteVolume: string;
  trades: number;
}

export enum CandleInterval {
  ONE_MINUTE = '1m',
  FIVE_MINUTES = '5m',
  FIFTEEN_MINUTES = '15m',
  THIRTY_MINUTES = '30m',
  ONE_HOUR = '1h',
  FOUR_HOURS = '4h',
  ONE_DAY = '1d',
  ONE_WEEK = '1w'
}

// WebSocket types
export interface WebSocketOptions {
  autoReconnect?: boolean;
  reconnectInterval?: number;
  heartbeatInterval?: number;
  maxReconnectAttempts?: number;
}

export enum WebSocketEvent {
  CONNECTED = 'connected',
  DISCONNECTED = 'disconnected',
  ERROR = 'error',
  ORDER_UPDATE = 'order:update',
  ORDER_FILLED = 'order:filled',
  ORDER_CANCELLED = 'order:cancelled',
  TRADE = 'trade',
  ORDERBOOK_UPDATE = 'orderbook:update',
  ORDERBOOK_SNAPSHOT = 'orderbook:snapshot',
  TICKER = 'ticker',
  NOTIFICATION = 'notification'
}

export interface WebSocketMessage<T = any> {
  event: string;
  data: T;
  timestamp: Date;
  sequenceNumber?: number;
}

// API Response types
export interface ApiResponse<T> {
  data: T;
  success: boolean;
  timestamp: Date;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: {
    limit: number;
    offset: number;
    total: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

export interface ApiError {
  code: string;
  message: string;
  details?: any;
  timestamp: Date;
}

// Rate Limit types
export interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: Date;
  retryAfter?: number;
}

// Authentication types
export interface AuthCredentials {
  apiKey: string;
  apiSecret?: string;
}

export interface SignedRequest {
  timestamp: number;
  nonce: string;
  signature: string;
}

// Notification types (for WebSocket)
export interface Notification {
  id: string;
  type: 'order' | 'trade' | 'settlement' | 'system';
  title: string;
  message: string;
  data?: any;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  timestamp: Date;
}

// Export all types
export * from './errors';