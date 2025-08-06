/**
 * @fileoverview SwappiQ Protocol TypeScript SDK - Main Entry Point
 * @author SwappiQ Protocol
 * @description Production-ready TypeScript SDK for SwappiQ decentralized exchange
 */

import { EventEmitter } from 'events';
import { HttpClient, RequestOptions } from './client/http-client.js';
import { SwappiQWebSocket } from './websocket/websocket-client.js';
import { OrderValidator, ValidationContext, OrderValidationOptions } from './validation/order-validator.js';
import { RequestSigner } from './utils/request-signer.js';
import { RateLimiter } from './utils/rate-limiter.js';
import {
  SDKConfig,
  AuthCredentials,
  ApiResponse,
  CreateOrderRequest,
  CreateOrderResponse,
  Order,
  TradingPair,
  OrderBook,
  Trade,
  Balance,
  Portfolio,
  MarketStats,
  Ticker,
  Candle,
  CandleParams,
  OrderHistoryParams,
  TradeHistoryParams,
  PaginatedResponse,
  UserEvent,
  OrderValidation,
  Network
} from './types/api.js';

export interface SwappiQClientConfig extends Partial<SDKConfig> {
  apiUrl: string;
  wsUrl?: string;
  auth?: AuthCredentials;
  network?: Network;
}

/**
 * Main SwappiQ Protocol SDK Client
 * Provides comprehensive access to trading, market data, and account management APIs
 */
export class SwappiQClient extends EventEmitter {
  private readonly config: SDKConfig;
  private readonly httpClient: HttpClient;
  private readonly wsClient?: SwappiQWebSocket;
  private readonly orderValidator: OrderValidator;
  private readonly requestSigner?: RequestSigner;

  private tradingPairs: Map<string, TradingPair> = new Map();
  private balances: Map<string, Balance> = new Map();
  private initialized = false;

  constructor(config: SwappiQClientConfig) {
    super();

    // Set up default configuration
    this.config = {
      apiUrl: config.apiUrl,
      wsUrl: config.wsUrl || config.apiUrl.replace('http', 'ws'),
      auth: config.auth,
      network: config.network || 'ethereum',
      timeout: config.timeout || 30000,
      retryConfig: {
        maxAttempts: 3,
        baseDelay: 1000,
        maxDelay: 10000,
        backoffFactor: 2,
        jitter: true,
        retryableErrors: ['ECONNRESET', 'ENOTFOUND', 'TIMEOUT'],
        ...config.retryConfig
      },
      rateLimitConfig: config.rateLimitConfig,
      debug: config.debug || false
    };

    // Initialize HTTP client
    this.httpClient = new HttpClient(this.config);

    // Initialize WebSocket client if URL provided
    if (this.config.wsUrl) {
      this.wsClient = new SwappiQWebSocket({
        url: this.config.wsUrl,
        auth: this.config.auth,
        reconnectInterval: 5000,
        maxReconnectAttempts: 10,
        pingInterval: 30000
      });

      this.setupWebSocketEventHandlers();
    }

    // Initialize request signer
    if (this.config.auth) {
      this.requestSigner = new RequestSigner(this.config.auth);
    }

    // Initialize order validator with empty context (will be populated on init)
    this.orderValidator = new OrderValidator({
      tradingPairs: this.tradingPairs,
      balances: this.balances,
      networkFees: {
        gasPrice: '20000000000', // 20 gwei default
        gasLimit: '100000'
      },
      riskLimits: {
        maxOrderValue: '100000', // $100k default
        maxDailyVolume: '1000000', // $1M default
        maxOpenOrders: 50
      }
    });

    this.setupEventHandlers();
  }

  /**
   * Initialize the SDK client
   */
  async initialize(): Promise<void> {
    try {
      // Load initial data
      await Promise.all([
        this.loadTradingPairs(),
        this.loadUserBalances()
      ]);

      // Connect WebSocket if available
      if (this.wsClient) {
        await this.wsClient.connect();
      }

      this.initialized = true;
      this.emit('initialized');

    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  // ========== TRADING METHODS ==========

  /**
   * Create a new order
   */
  async createOrder(request: CreateOrderRequest, options: OrderValidationOptions = {}): Promise<CreateOrderResponse> {
    this.ensureInitialized();

    // Validate order locally first
    const validation = await this.orderValidator.validateCreateOrder(request, options);
    
    if (!validation.balanceSufficient && !options.skipBalanceCheck) {
      throw new Error('Insufficient balance for order');
    }

    if (validation.errors.length > 0) {
      throw new Error(`Order validation failed: ${validation.errors[0].message}`);
    }

    // Submit order to API
    const response = await this.httpClient.request<CreateOrderResponse>({
      method: 'POST',
      path: '/orders',
      body: request,
      auth: true
    });

    if (response.success && response.data?.order) {
      this.emit('orderCreated', response.data.order);
    }

    return response.data!;
  }

  /**
   * Cancel an existing order
   */
  async cancelOrder(orderId: string): Promise<ApiResponse<Order>> {
    this.ensureInitialized();

    const response = await this.httpClient.request<Order>({
      method: 'DELETE',
      path: `/orders/${orderId}`,
      auth: true
    });

    if (response.success && response.data) {
      this.emit('orderCancelled', response.data);
    }

    return response;
  }

  /**
   * Get order by ID
   */
  async getOrder(orderId: string): Promise<Order> {
    this.ensureInitialized();

    const response = await this.httpClient.request<Order>({
      method: 'GET',
      path: `/orders/${orderId}`,
      auth: true
    });

    if (!response.success || !response.data) {
      throw new Error(`Failed to get order: ${response.error?.message}`);
    }

    return response.data;
  }

  /**
   * Get order history
   */
  async getOrderHistory(params: OrderHistoryParams = {}): Promise<PaginatedResponse<Order>> {
    this.ensureInitialized();

    const queryParams = new URLSearchParams();
    if (params.tradingPair) queryParams.set('tradingPair', params.tradingPair);
    if (params.status) queryParams.set('status', params.status.join(','));
    if (params.side) queryParams.set('side', params.side);
    if (params.startTime) queryParams.set('startTime', params.startTime);
    if (params.endTime) queryParams.set('endTime', params.endTime);
    if (params.page) queryParams.set('page', params.page.toString());
    if (params.limit) queryParams.set('limit', params.limit.toString());

    const response = await this.httpClient.request<PaginatedResponse<Order>>({
      method: 'GET',
      path: `/orders?${queryParams.toString()}`,
      auth: true
    });

    if (!response.success || !response.data) {
      throw new Error(`Failed to get order history: ${response.error?.message}`);
    }

    return response.data;
  }

  /**
   * Get trade history
   */
  async getTradeHistory(params: TradeHistoryParams = {}): Promise<PaginatedResponse<Trade>> {
    this.ensureInitialized();

    const queryParams = new URLSearchParams();
    if (params.tradingPair) queryParams.set('tradingPair', params.tradingPair);
    if (params.startTime) queryParams.set('startTime', params.startTime);
    if (params.endTime) queryParams.set('endTime', params.endTime);
    if (params.page) queryParams.set('page', params.page.toString());
    if (params.limit) queryParams.set('limit', params.limit.toString());

    const response = await this.httpClient.request<PaginatedResponse<Trade>>({
      method: 'GET',
      path: `/trades?${queryParams.toString()}`,
      auth: true
    });

    if (!response.success || !response.data) {
      throw new Error(`Failed to get trade history: ${response.error?.message}`);
    }

    return response.data;
  }

  // ========== MARKET DATA METHODS ==========

  /**
   * Get all trading pairs
   */
  async getTradingPairs(): Promise<TradingPair[]> {
    const response = await this.httpClient.request<TradingPair[]>({
      method: 'GET',
      path: '/trading-pairs'
    });

    if (!response.success || !response.data) {
      throw new Error(`Failed to get trading pairs: ${response.error?.message}`);
    }

    return response.data;
  }

  /**
   * Get order book for trading pair
   */
  async getOrderBook(tradingPair: string, depth = 20): Promise<OrderBook> {
    const response = await this.httpClient.request<OrderBook>({
      method: 'GET',
      path: `/orderbook/${tradingPair}?depth=${depth}`
    });

    if (!response.success || !response.data) {
      throw new Error(`Failed to get order book: ${response.error?.message}`);
    }

    return response.data;
  }

  /**
   * Get market statistics
   */
  async getMarketStats(tradingPair?: string): Promise<MarketStats[]> {
    const path = tradingPair ? `/market/stats/${tradingPair}` : '/market/stats';
    
    const response = await this.httpClient.request<MarketStats[]>({
      method: 'GET',
      path
    });

    if (!response.success || !response.data) {
      throw new Error(`Failed to get market stats: ${response.error?.message}`);
    }

    return response.data;
  }

  /**
   * Get price ticker
   */
  async getTicker(tradingPair: string): Promise<Ticker> {
    const response = await this.httpClient.request<Ticker>({
      method: 'GET',
      path: `/ticker/${tradingPair}`
    });

    if (!response.success || !response.data) {
      throw new Error(`Failed to get ticker: ${response.error?.message}`);
    }

    return response.data;
  }

  /**
   * Get candlestick data
   */
  async getCandles(params: CandleParams): Promise<Candle[]> {
    const queryParams = new URLSearchParams();
    queryParams.set('interval', params.interval);
    if (params.startTime) queryParams.set('startTime', params.startTime);
    if (params.endTime) queryParams.set('endTime', params.endTime);
    if (params.limit) queryParams.set('limit', params.limit.toString());

    const response = await this.httpClient.request<Candle[]>({
      method: 'GET',
      path: `/candles/${params.tradingPair}?${queryParams.toString()}`
    });

    if (!response.success || !response.data) {
      throw new Error(`Failed to get candles: ${response.error?.message}`);
    }

    return response.data;
  }

  // ========== ACCOUNT METHODS ==========

  /**
   * Get user balances
   */
  async getBalances(): Promise<Balance[]> {
    this.ensureInitialized();

    const response = await this.httpClient.request<Balance[]>({
      method: 'GET',
      path: '/account/balances',
      auth: true
    });

    if (!response.success || !response.data) {
      throw new Error(`Failed to get balances: ${response.error?.message}`);
    }

    // Update local cache
    this.balances.clear();
    response.data.forEach(balance => {
      this.balances.set(balance.token.value, balance);
    });

    return response.data;
  }

  /**
   * Get portfolio summary
   */
  async getPortfolio(): Promise<Portfolio> {
    this.ensureInitialized();

    const response = await this.httpClient.request<Portfolio>({
      method: 'GET',
      path: '/account/portfolio',
      auth: true
    });

    if (!response.success || !response.data) {
      throw new Error(`Failed to get portfolio: ${response.error?.message}`);
    }

    return response.data;
  }

  // ========== WEBSOCKET METHODS ==========

  /**
   * Subscribe to order book updates
   */
  async subscribeToOrderBook(tradingPairs: string | string[]): Promise<void> {
    if (!this.wsClient) {
      throw new Error('WebSocket client not available');
    }

    await this.wsClient.subscribeToOrderBook(tradingPairs);
  }

  /**
   * Subscribe to trade updates
   */
  async subscribeToTrades(tradingPairs: string | string[]): Promise<void> {
    if (!this.wsClient) {
      throw new Error('WebSocket client not available');
    }

    await this.wsClient.subscribeToTrades(tradingPairs);
  }

  /**
   * Subscribe to user events
   */
  async subscribeToUserEvents(): Promise<void> {
    if (!this.wsClient) {
      throw new Error('WebSocket client not available');
    }

    await this.wsClient.subscribeToUserEvents();
  }

  /**
   * Handle order book updates
   */
  onOrderBookUpdate(handler: (orderBook: OrderBook) => void): void {
    if (!this.wsClient) {
      throw new Error('WebSocket client not available');
    }

    this.wsClient.onOrderBookUpdate(handler);
  }

  /**
   * Handle trade updates
   */
  onTradeUpdate(handler: (trade: Trade) => void): void {
    if (!this.wsClient) {
      throw new Error('WebSocket client not available');
    }

    this.wsClient.onTradeUpdate(handler);
  }

  /**
   * Handle user events
   */
  onUserEvent(handler: (event: UserEvent) => void): void {
    if (!this.wsClient) {
      throw new Error('WebSocket client not available');
    }

    this.wsClient.onUserEvent(handler);
  }

  // ========== VALIDATION METHODS ==========

  /**
   * Validate order before submission
   */
  async validateOrder(request: CreateOrderRequest, options?: OrderValidationOptions): Promise<OrderValidation> {
    return this.orderValidator.validateCreateOrder(request, options);
  }

  /**
   * Update validation context with fresh data
   */
  async updateValidationContext(): Promise<void> {
    await Promise.all([
      this.loadTradingPairs(),
      this.loadUserBalances()
    ]);
  }

  // ========== UTILITY METHODS ==========

  /**
   * Get client statistics
   */
  getStats(): {
    http: any;
    websocket?: any;
    tradingPairs: number;
    balances: number;
  } {
    return {
      http: this.httpClient.getStats(),
      websocket: this.wsClient?.getStats(),
      tradingPairs: this.tradingPairs.size,
      balances: this.balances.size
    };
  }

  /**
   * Check if client is healthy
   */
  isHealthy(): boolean {
    const httpHealthy = this.httpClient.getStats().successRate > 0.95;
    const wsHealthy = this.wsClient ? this.wsClient.isHealthy() : true;
    
    return this.initialized && httpHealthy && wsHealthy;
  }

  /**
   * Gracefully shutdown the client
   */
  async shutdown(): Promise<void> {
    if (this.wsClient) {
      await this.wsClient.shutdown();
    }
    
    await this.httpClient.shutdown();
    this.removeAllListeners();
  }

  // ========== PRIVATE METHODS ==========

  /**
   * Load trading pairs and update local cache
   */
  private async loadTradingPairs(): Promise<void> {
    try {
      const tradingPairs = await this.getTradingPairs();
      
      this.tradingPairs.clear();
      tradingPairs.forEach(pair => {
        this.tradingPairs.set(pair.symbol, pair);
      });

      this.orderValidator.updateContext({ tradingPairs: this.tradingPairs });
      
    } catch (error) {
      console.warn('Failed to load trading pairs:', error);
    }
  }

  /**
   * Load user balances if authenticated
   */
  private async loadUserBalances(): Promise<void> {
    if (!this.config.auth) {
      return;
    }

    try {
      await this.getBalances();
      this.orderValidator.updateContext({ balances: this.balances });
      
    } catch (error) {
      console.warn('Failed to load user balances:', error);
    }
  }

  /**
   * Set up event handlers
   */
  private setupEventHandlers(): void {
    this.httpClient.on('retry', (event) => {
      this.emit('httpRetry', event);
    });

    this.httpClient.on('error', (error) => {
      this.emit('httpError', error);
    });
  }

  /**
   * Set up WebSocket event handlers
   */
  private setupWebSocketEventHandlers(): void {
    if (!this.wsClient) return;

    this.wsClient.on('connected', () => {
      this.emit('wsConnected');
    });

    this.wsClient.on('disconnected', (event) => {
      this.emit('wsDisconnected', event);
    });

    this.wsClient.on('error', (error) => {
      this.emit('wsError', error);
    });

    this.wsClient.on('reconnecting', (event) => {
      this.emit('wsReconnecting', event);
    });
  }

  /**
   * Ensure client is initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('Client not initialized. Call initialize() first.');
    }
  }
}

// ========== EXPORTS ==========

export * from './types/api.js';
export * from './client/http-client.js';
export * from './websocket/websocket-client.js';
export * from './validation/order-validator.js';
export * from './utils/request-signer.js';
export * from './utils/rate-limiter.js';

// Default export
export default SwappiQClient;