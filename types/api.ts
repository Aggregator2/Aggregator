/**
 * API Request and Response type definitions
 */

// ==================== BASE API TYPES ====================

export interface ApiRequest<T = any> {
  method: HttpMethod;
  endpoint: string;
  params?: Record<string, any>;
  query?: Record<string, any>;
  body?: T;
  headers?: Record<string, string>;
}

export enum HttpMethod {
  GET = 'GET',
  POST = 'POST',
  PUT = 'PUT',
  PATCH = 'PATCH',
  DELETE = 'DELETE'
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: ApiError;
  metadata?: ResponseMetadata;
}

export interface ApiError {
  code: string;
  message: string;
  details?: any;
  timestamp?: Date;
  path?: string;
}

export interface ResponseMetadata {
  timestamp: Date;
  requestId?: string;
  version?: string;
  pagination?: PaginationMetadata;
}

export interface PaginationMetadata {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

// ==================== ORDER API TYPES ====================

export interface CreateOrderRequest {
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  buyAmount?: string;
  price?: number;
  side: 'buy' | 'sell';
  type: 'market' | 'limit';
  timeInForce?: 'GTC' | 'IOC' | 'FOK';
  clientOrderId?: string;
}

export interface CreateOrderResponse {
  orderId: string;
  clientOrderId?: string;
  status: string;
  createdAt: Date;
}

export interface GetOrderRequest {
  orderId: string;
}

export interface GetOrdersRequest {
  user?: string;
  status?: string | string[];
  sellToken?: string;
  buyToken?: string;
  side?: 'buy' | 'sell';
  type?: 'market' | 'limit';
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface CancelOrderRequest {
  orderId: string;
  reason?: string;
}

export interface CancelOrderResponse {
  orderId: string;
  status: 'cancelled';
  cancelledAt: Date;
}

export interface UpdateOrderRequest {
  orderId: string;
  price?: number;
  amount?: string;
}

// ==================== QUOTE API TYPES ====================

export interface GetQuoteRequest {
  sellToken: string;
  buyToken: string;
  sellAmount?: string;
  buyAmount?: string;
  slippageTolerance?: number;
  excludeSources?: string[];
  includeSources?: string[];
  userAddress?: string;
  skipValidation?: boolean;
}

export interface QuoteResponse {
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  buyAmount: string;
  price: number;
  priceImpact: number;
  minReceived: string;
  maxSent: string;
  sources: QuoteSource[];
  fees: QuoteFee[];
  estimatedGas: string;
  validUntil: Date;
  warnings?: string[];
}

export interface QuoteSource {
  name: string;
  proportion: number;
  sellAmount: string;
  buyAmount: string;
}

export interface QuoteFee {
  type: 'network' | 'protocol' | 'liquidity';
  amount: string;
  token: string;
  amountUsd?: string;
}

// ==================== TRADE API TYPES ====================

export interface GetTradesRequest {
  user?: string;
  orderId?: string;
  sellToken?: string;
  buyToken?: string;
  fromDate?: Date;
  toDate?: Date;
  page?: number;
  pageSize?: number;
}

export interface TradeResponse {
  id: string;
  orderId: string;
  user: string;
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  buyAmount: string;
  price: number;
  fee: TradeFeeResponse;
  timestamp: Date;
  txHash: string;
  status: string;
}

export interface TradeFeeResponse {
  amount: string;
  token: string;
  type: string;
  amountUsd?: string;
}

// ==================== MARKET DATA API TYPES ====================

export interface GetOrderBookRequest {
  sellToken: string;
  buyToken: string;
  depth?: number;
  aggregationLevel?: number;
}

export interface OrderBookResponse {
  sellToken: string;
  buyToken: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  lastUpdateTime: Date;
  midPrice: number;
  spread: number;
}

export interface OrderBookLevel {
  price: number;
  amount: string;
  total: string;
  orderCount?: number;
}

export interface GetTickerRequest {
  sellToken: string;
  buyToken: string;
}

export interface TickerResponse {
  symbol: string;
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

export interface GetCandlesRequest {
  sellToken: string;
  buyToken: string;
  interval: '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d' | '1w';
  fromTime?: Date;
  toTime?: Date;
  limit?: number;
}

export interface CandleResponse {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: string;
  volumeUsd: string;
  trades: number;
}

// ==================== TOKEN API TYPES ====================

export interface GetTokensRequest {
  chainId?: number;
  search?: string;
  symbols?: string[];
  addresses?: string[];
  page?: number;
  pageSize?: number;
}

export interface TokenResponse {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  chainId: number;
  logoURI?: string;
  priceUsd?: number;
  volumeUsd24h?: string;
  marketCapUsd?: string;
  tags?: string[];
}

export interface GetTokenBalanceRequest {
  userAddress: string;
  tokenAddresses?: string[];
  chainId?: number;
}

export interface TokenBalanceResponse {
  token: string;
  balance: string;
  balanceUsd?: string;
  allowances?: Record<string, string>;
}

// ==================== HEALTH CHECK API TYPES ====================

export interface HealthCheckResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: Date;
  version: string;
  services: ServiceHealth[];
}

export interface ServiceHealth {
  name: string;
  status: 'up' | 'down' | 'degraded';
  latency?: number;
  error?: string;
  lastCheck: Date;
}

// ==================== NOTIFICATION API TYPES ====================

export interface CreateNotificationRequest {
  type: 'order_filled' | 'order_cancelled' | 'price_alert' | 'system';
  title: string;
  message: string;
  userId: string;
  data?: any;
}

export interface NotificationResponse {
  id: string;
  type: string;
  title: string;
  message: string;
  userId: string;
  read: boolean;
  createdAt: Date;
  data?: any;
}

export interface GetNotificationsRequest {
  userId: string;
  type?: string;
  read?: boolean;
  fromDate?: Date;
  toDate?: Date;
  page?: number;
  pageSize?: number;
}

// ==================== WEBHOOK API TYPES ====================

export interface RegisterWebhookRequest {
  url: string;
  events: string[];
  secret?: string;
  active?: boolean;
}

export interface WebhookResponse {
  id: string;
  url: string;
  events: string[];
  secret?: string;
  active: boolean;
  createdAt: Date;
  lastTriggered?: Date;
}

export interface WebhookEvent {
  id: string;
  type: string;
  data: any;
  timestamp: Date;
  signature?: string;
}

// ==================== ERROR CODES ====================

export enum ApiErrorCode {
  // General errors
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  AUTHENTICATION_ERROR = 'AUTHENTICATION_ERROR',
  AUTHORIZATION_ERROR = 'AUTHORIZATION_ERROR',
  RATE_LIMIT_ERROR = 'RATE_LIMIT_ERROR',
  NOT_FOUND = 'NOT_FOUND',
  
  // Order errors
  INVALID_ORDER = 'INVALID_ORDER',
  ORDER_NOT_FOUND = 'ORDER_NOT_FOUND',
  ORDER_ALREADY_FILLED = 'ORDER_ALREADY_FILLED',
  ORDER_CANCELLED = 'ORDER_CANCELLED',
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
  
  // Market errors
  MARKET_CLOSED = 'MARKET_CLOSED',
  NO_LIQUIDITY = 'NO_LIQUIDITY',
  PRICE_IMPACT_TOO_HIGH = 'PRICE_IMPACT_TOO_HIGH',
  
  // Token errors
  TOKEN_NOT_SUPPORTED = 'TOKEN_NOT_SUPPORTED',
  INVALID_TOKEN_PAIR = 'INVALID_TOKEN_PAIR',
}

// ==================== TYPE GUARDS ====================

export function isApiError(response: any): response is ApiError {
  return response && 
         typeof response.code === 'string' && 
         typeof response.message === 'string';
}

export function isApiResponse<T>(response: any): response is ApiResponse<T> {
  return response && 
         typeof response.success === 'boolean';
}