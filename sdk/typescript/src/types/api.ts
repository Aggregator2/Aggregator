/**
 * @fileoverview Type definitions for SwappiQ Protocol API
 * @author SwappiQ Protocol
 * @description Comprehensive type-safe definitions for all API endpoints and data structures
 */

// ========== CORE TYPES ==========

export interface Address {
  readonly value: string;
  readonly network: Network;
}

export type Network = 'ethereum' | 'polygon' | 'bsc' | 'arbitrum' | 'optimism';

export type OrderSide = 'buy' | 'sell';
export type OrderType = 'market' | 'limit' | 'stop' | 'stop_limit';
export type OrderStatus = 'pending' | 'open' | 'partially_filled' | 'filled' | 'cancelled' | 'expired' | 'rejected';
export type TimeInForce = 'GTC' | 'IOC' | 'FOK' | 'GTD';

// ========== DECIMAL HANDLING ==========

export interface Decimal {
  readonly value: string;
  readonly decimals: number;
}

export interface TokenAmount {
  readonly token: Address;
  readonly amount: Decimal;
  readonly usdValue?: Decimal;
}

// ========== ORDER TYPES ==========

export interface BaseOrder {
  readonly id: string;
  readonly userId: string;
  readonly tradingPair: TradingPair;
  readonly side: OrderSide;
  readonly type: OrderType;
  readonly quantity: Decimal;
  readonly status: OrderStatus;
  readonly timeInForce: TimeInForce;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly expiresAt?: string;
  readonly clientOrderId?: string;
  readonly metadata?: Record<string, any>;
}

export interface LimitOrder extends BaseOrder {
  readonly type: 'limit';
  readonly price: Decimal;
  readonly stopPrice?: never;
}

export interface MarketOrder extends BaseOrder {
  readonly type: 'market';
  readonly price?: never;
  readonly stopPrice?: never;
}

export interface StopOrder extends BaseOrder {
  readonly type: 'stop';
  readonly price?: never;
  readonly stopPrice: Decimal;
}

export interface StopLimitOrder extends BaseOrder {
  readonly type: 'stop_limit';
  readonly price: Decimal;
  readonly stopPrice: Decimal;
}

export type Order = LimitOrder | MarketOrder | StopOrder | StopLimitOrder;

// ========== ORDER CREATION TYPES ==========

export interface CreateOrderRequest {
  readonly tradingPair: string;
  readonly side: OrderSide;
  readonly type: OrderType;
  readonly quantity: string;
  readonly price?: string;
  readonly stopPrice?: string;
  readonly timeInForce?: TimeInForce;
  readonly clientOrderId?: string;
  readonly metadata?: Record<string, any>;
  readonly signature?: string;
}

export interface CreateOrderResponse {
  readonly success: boolean;
  readonly order?: Order;
  readonly error?: ApiError;
  readonly estimatedGas?: string;
  readonly executionReport?: ExecutionReport;
}

// ========== TRADING PAIR TYPES ==========

export interface TradingPair {
  readonly symbol: string;
  readonly baseToken: TokenInfo;
  readonly quoteToken: TokenInfo;
  readonly minOrderSize: Decimal;
  readonly maxOrderSize: Decimal;
  readonly priceIncrement: Decimal;
  readonly quantityIncrement: Decimal;
  readonly makerFee: Decimal;
  readonly takerFee: Decimal;
  readonly status: 'active' | 'inactive' | 'delisted';
  readonly metadata?: Record<string, any>;
}

export interface TokenInfo {
  readonly address: Address;
  readonly symbol: string;
  readonly name: string;
  readonly decimals: number;
  readonly logoUrl?: string;
  readonly verified: boolean;
  readonly metadata?: Record<string, any>;
}

// ========== ORDER BOOK TYPES ==========

export interface OrderBookLevel {
  readonly price: Decimal;
  readonly quantity: Decimal;
  readonly orderCount: number;
}

export interface OrderBook {
  readonly tradingPair: string;
  readonly bids: readonly OrderBookLevel[];
  readonly asks: readonly OrderBookLevel[];
  readonly sequence: number;
  readonly timestamp: string;
  readonly spread?: Decimal;
  readonly midPrice?: Decimal;
}

export interface OrderBookUpdate {
  readonly tradingPair: string;
  readonly side: OrderSide;
  readonly price: Decimal;
  readonly quantity: Decimal;
  readonly sequence: number;
  readonly timestamp: string;
  readonly type: 'add' | 'update' | 'remove';
}

// ========== TRADE TYPES ==========

export interface Trade {
  readonly id: string;
  readonly tradingPair: string;
  readonly price: Decimal;
  readonly quantity: Decimal;
  readonly side: OrderSide;
  readonly timestamp: string;
  readonly buyOrderId: string;
  readonly sellOrderId: string;
  readonly fees: readonly TradeFee[];
  readonly blockNumber?: number;
  readonly transactionHash?: string;
}

export interface TradeFee {
  readonly token: Address;
  readonly amount: Decimal;
  readonly type: 'maker' | 'taker' | 'gas';
}

export interface UserTrade extends Trade {
  readonly userSide: OrderSide;
  readonly orderId: string;
  readonly feesPaid: readonly TradeFee[];
  readonly realizedPnl?: Decimal;
}

// ========== BALANCE TYPES ==========

export interface Balance {
  readonly token: Address;
  readonly available: Decimal;
  readonly locked: Decimal;
  readonly total: Decimal;
  readonly usdValue?: Decimal;
  readonly lastUpdated: string;
}

export interface Portfolio {
  readonly userId: string;
  readonly balances: readonly Balance[];
  readonly totalUsdValue: Decimal;
  readonly network: Network;
  readonly lastUpdated: string;
}

// ========== EXECUTION REPORT TYPES ==========

export interface ExecutionReport {
  readonly orderId: string;
  readonly executionId: string;
  readonly tradingPair: string;
  readonly side: OrderSide;
  readonly executedQuantity: Decimal;
  readonly executedPrice: Decimal;
  readonly remainingQuantity: Decimal;
  readonly status: OrderStatus;
  readonly fees: readonly TradeFee[];
  readonly timestamp: string;
  readonly counterpartyOrderId?: string;
}

// ========== MARKET DATA TYPES ==========

export interface MarketStats {
  readonly tradingPair: string;
  readonly lastPrice: Decimal;
  readonly priceChange24h: Decimal;
  readonly priceChangePercent24h: Decimal;
  readonly high24h: Decimal;
  readonly low24h: Decimal;
  readonly volume24h: Decimal;
  readonly quoteVolume24h: Decimal;
  readonly timestamp: string;
}

export interface Ticker {
  readonly tradingPair: string;
  readonly price: Decimal;
  readonly timestamp: string;
  readonly source: string;
}

export interface Candle {
  readonly tradingPair: string;
  readonly interval: string;
  readonly openTime: string;
  readonly closeTime: string;
  readonly open: Decimal;
  readonly high: Decimal;
  readonly low: Decimal;
  readonly close: Decimal;
  readonly volume: Decimal;
  readonly quoteVolume: Decimal;
  readonly trades: number;
}

// ========== AUTHENTICATION TYPES ==========

export interface AuthCredentials {
  readonly apiKey: string;
  readonly apiSecret: string;
  readonly passphrase?: string;
  readonly environment?: 'sandbox' | 'production';
}

export interface SignedRequest {
  readonly method: string;
  readonly path: string;
  readonly body: string;
  readonly timestamp: string;
  readonly signature: string;
  readonly headers: Record<string, string>;
}

// ========== WEBSOCKET TYPES ==========

export interface WebSocketMessage<T = any> {
  readonly type: string;
  readonly channel: string;
  readonly data: T;
  readonly timestamp: string;
  readonly sequence?: number;
}

export interface SubscriptionRequest {
  readonly type: 'subscribe' | 'unsubscribe';
  readonly channels: readonly string[];
  readonly tradingPairs?: readonly string[];
  readonly auth?: boolean;
}

export interface WebSocketConfig {
  readonly url: string;
  readonly reconnectInterval: number;
  readonly maxReconnectAttempts: number;
  readonly pingInterval: number;
  readonly auth?: AuthCredentials;
}

// ========== API RESPONSE TYPES ==========

export interface ApiResponse<T = any> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: ApiError;
  readonly timestamp: string;
  readonly requestId: string;
}

export interface ApiError {
  readonly code: string;
  readonly message: string;
  readonly details?: Record<string, any>;
  readonly retryable: boolean;
}

export interface PaginatedResponse<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly page: number;
  readonly limit: number;
  readonly hasNext: boolean;
  readonly hasPrevious: boolean;
}

// ========== REQUEST TYPES ==========

export interface PaginationParams {
  readonly page?: number;
  readonly limit?: number;
  readonly sortBy?: string;
  readonly sortOrder?: 'asc' | 'desc';
}

export interface OrderHistoryParams extends PaginationParams {
  readonly tradingPair?: string;
  readonly status?: OrderStatus[];
  readonly side?: OrderSide;
  readonly startTime?: string;
  readonly endTime?: string;
}

export interface TradeHistoryParams extends PaginationParams {
  readonly tradingPair?: string;
  readonly startTime?: string;
  readonly endTime?: string;
}

export interface CandleParams {
  readonly tradingPair: string;
  readonly interval: '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d' | '1w';
  readonly startTime?: string;
  readonly endTime?: string;
  readonly limit?: number;
}

// ========== VALIDATION TYPES ==========

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ValidationError[];
}

export interface ValidationError {
  readonly field: string;
  readonly code: string;
  readonly message: string;
  readonly value?: any;
}

export interface OrderValidation {
  readonly balanceSufficient: boolean;
  readonly priceValid: boolean;
  readonly quantityValid: boolean;
  readonly tradingPairActive: boolean;
  readonly withinLimits: boolean;
  readonly estimatedFees: readonly TradeFee[];
  readonly estimatedGas?: string;
}

// ========== EVENT TYPES ==========

export interface OrderEvent {
  readonly type: 'order_created' | 'order_updated' | 'order_filled' | 'order_cancelled';
  readonly order: Order;
  readonly timestamp: string;
}

export interface TradeEvent {
  readonly type: 'trade_executed';
  readonly trade: UserTrade;
  readonly timestamp: string;
}

export interface BalanceEvent {
  readonly type: 'balance_updated';
  readonly balance: Balance;
  readonly timestamp: string;
}

export type UserEvent = OrderEvent | TradeEvent | BalanceEvent;

// ========== CONFIGURATION TYPES ==========

export interface SDKConfig {
  readonly apiUrl: string;
  readonly wsUrl: string;
  readonly auth?: AuthCredentials;
  readonly network: Network;
  readonly timeout: number;
  readonly retryConfig: RetryConfig;
  readonly rateLimitConfig?: RateLimitConfig;
  readonly debug?: boolean;
}

export interface RetryConfig {
  readonly maxAttempts: number;
  readonly baseDelay: number;
  readonly maxDelay: number;
  readonly backoffFactor: number;
  readonly jitter: boolean;
  readonly retryableErrors: readonly string[];
}

export interface RateLimitConfig {
  readonly requestsPerSecond: number;
  readonly burstSize: number;
  readonly queueSize: number;
}

// ========== UTILITY TYPES ==========

export type Mutable<T> = {
  -readonly [P in keyof T]: T[P];
};

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export type RequireAtLeastOne<T, Keys extends keyof T = keyof T> = 
  Pick<T, Exclude<keyof T, Keys>> & 
  { [K in Keys]-?: Required<Pick<T, K>> & Partial<Pick<T, Exclude<Keys, K>>> }[Keys];

// ========== BRANDED TYPES ==========

declare const __brand: unique symbol;
type Brand<T, TBrand> = T & { [__brand]: TBrand };

export type OrderId = Brand<string, 'OrderId'>;
export type TradeId = Brand<string, 'TradeId'>;
export type UserId = Brand<string, 'UserId'>;
export type TransactionHash = Brand<string, 'TransactionHash'>;

// ========== TYPE GUARDS ==========

export const isLimitOrder = (order: Order): order is LimitOrder => order.type === 'limit';
export const isMarketOrder = (order: Order): order is MarketOrder => order.type === 'market';
export const isStopOrder = (order: Order): order is StopOrder => order.type === 'stop';
export const isStopLimitOrder = (order: Order): order is StopLimitOrder => order.type === 'stop_limit';

export const isOrderEvent = (event: UserEvent): event is OrderEvent => 
  ['order_created', 'order_updated', 'order_filled', 'order_cancelled'].includes(event.type);

export const isTradeEvent = (event: UserEvent): event is TradeEvent => 
  event.type === 'trade_executed';

export const isBalanceEvent = (event: UserEvent): event is BalanceEvent => 
  event.type === 'balance_updated';