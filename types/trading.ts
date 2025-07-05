/**
 * Trading-related type definitions
 * These types cover Order, Trade, OrderBook, and related entities
 */

// ==================== ORDER TYPES ====================

export interface BaseOrder {
  id: string;
  clientOrderId?: string;
  user: string;
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  buyAmount: string;
  price?: number;
  side: OrderSide;
  type: OrderType;
  status: OrderStatus;
  validTo?: number;
  createdAt: Date;
  updatedAt?: Date;
  chainId: number;
  signature?: string;
  nonce?: string | number;
}

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
  FAILED = 'failed',
  EXPIRED = 'expired'
}

export interface LimitOrder extends BaseOrder {
  type: OrderType.LIMIT;
  limitPrice: number;
  timeInForce?: TimeInForce;
}

export interface MarketOrder extends BaseOrder {
  type: OrderType.MARKET;
}

export interface StopOrder extends BaseOrder {
  type: OrderType.STOP | OrderType.STOP_LIMIT;
  stopPrice: number;
  limitPrice?: number;
}

export type Order = LimitOrder | MarketOrder | StopOrder;

export enum TimeInForce {
  GTC = 'GTC', // Good Till Cancelled
  IOC = 'IOC', // Immediate Or Cancel
  FOK = 'FOK', // Fill Or Kill
  GTT = 'GTT'  // Good Till Time
}

// ==================== TRADE TYPES ====================

export interface Trade {
  id: string;
  orderId: string;
  executionId: string;
  user: string;
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  buyAmount: string;
  price: number;
  side: OrderSide;
  fee?: TradeFee;
  timestamp: Date;
  txHash?: string;
  blockNumber?: number;
  chainId: number;
  maker?: string;
  taker?: string;
  status: TradeStatus;
}

export enum TradeStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  FAILED = 'failed',
  REVERTED = 'reverted'
}

export interface TradeFee {
  amount: string;
  token: string;
  type: FeeType;
}

export enum FeeType {
  TAKER = 'taker',
  MAKER = 'maker',
  NETWORK = 'network'
}

// ==================== ORDERBOOK TYPES ====================

export interface OrderBookEntry {
  price: number;
  amount: string;
  total: string;
  orders: string[]; // Order IDs
}

export interface OrderBook {
  sellToken: string;
  buyToken: string;
  chainId: number;
  bids: OrderBookEntry[];
  asks: OrderBookEntry[];
  lastUpdateTime: Date;
  midPrice?: number;
  spread?: number;
  depth?: OrderBookDepth;
}

export interface OrderBookDepth {
  bids: {
    [price: string]: string; // price -> total amount
  };
  asks: {
    [price: string]: string;
  };
}

export interface OrderBookUpdate {
  type: 'snapshot' | 'update';
  sellToken: string;
  buyToken: string;
  chainId: number;
  bids?: OrderBookEntry[];
  asks?: OrderBookEntry[];
  removedBids?: string[]; // prices to remove
  removedAsks?: string[];
  timestamp: Date;
}

// ==================== MARKET DATA TYPES ====================

export interface MarketTicker {
  symbol: string;
  sellToken: string;
  buyToken: string;
  lastPrice: number;
  bidPrice: number;
  askPrice: number;
  volume24h: string;
  volumeUsd24h: string;
  high24h: number;
  low24h: number;
  priceChange24h: number;
  priceChangePercent24h: number;
  timestamp: Date;
}

export interface CandleData {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: string;
  volumeUsd: string;
  trades: number;
}

export enum CandleInterval {
  ONE_MIN = '1m',
  FIVE_MIN = '5m',
  FIFTEEN_MIN = '15m',
  THIRTY_MIN = '30m',
  ONE_HOUR = '1h',
  FOUR_HOUR = '4h',
  ONE_DAY = '1d',
  ONE_WEEK = '1w'
}

// ==================== LIQUIDITY TYPES ====================

export interface LiquiditySource {
  name: string;
  type: LiquidityType;
  address?: string;
  chainId: number;
}

export enum LiquidityType {
  AMM = 'amm',
  ORDER_BOOK = 'order_book',
  RFQ = 'rfq',
  AGGREGATOR = 'aggregator'
}

export interface LiquidityQuote {
  source: LiquiditySource;
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  buyAmount: string;
  price: number;
  priceImpact: number;
  fee?: TradeFee;
  gas?: string;
  validUntil?: Date;
}

// ==================== SETTLEMENT TYPES ====================

export interface Settlement {
  id: string;
  orderId: string;
  tradeId: string;
  user: string;
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  buyAmount: string;
  status: SettlementStatus;
  txHash?: string;
  blockNumber?: number;
  gasUsed?: string;
  effectiveGasPrice?: string;
  timestamp: Date;
  error?: string;
}

export enum SettlementStatus {
  PENDING = 'pending',
  SUBMITTED = 'submitted',
  CONFIRMED = 'confirmed',
  FAILED = 'failed',
  REVERTED = 'reverted'
}

// ==================== MATCHING ENGINE TYPES ====================

export interface MatchingResult {
  matches: Match[];
  remainingOrder?: Partial<Order>;
  totalSellAmount: string;
  totalBuyAmount: string;
  averagePrice: number;
}

export interface Match {
  takerOrderId: string;
  makerOrderId: string;
  sellAmount: string;
  buyAmount: string;
  price: number;
  makerFee?: TradeFee;
  takerFee?: TradeFee;
}

// ==================== VALIDATION TYPES ====================

export interface OrderValidation {
  isValid: boolean;
  errors: ValidationError[];
  warnings?: ValidationWarning[];
}

export interface ValidationError {
  field: string;
  message: string;
  code: string;
}

export interface ValidationWarning {
  field: string;
  message: string;
  code: string;
}

// ==================== TYPE GUARDS ====================

export function isLimitOrder(order: Order): order is LimitOrder {
  return order.type === OrderType.LIMIT;
}

export function isMarketOrder(order: Order): order is MarketOrder {
  return order.type === OrderType.MARKET;
}

export function isStopOrder(order: Order): order is StopOrder {
  return order.type === OrderType.STOP || order.type === OrderType.STOP_LIMIT;
}

export function isOpenOrder(order: Order): boolean {
  return order.status === OrderStatus.OPEN || 
         order.status === OrderStatus.PARTIALLY_FILLED;
}

export function isCompletedOrder(order: Order): boolean {
  return order.status === OrderStatus.FILLED || 
         order.status === OrderStatus.CANCELLED ||
         order.status === OrderStatus.FAILED ||
         order.status === OrderStatus.EXPIRED;
}