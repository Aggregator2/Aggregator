/**
 * @fileoverview Advanced Trading Bot Example using SwappiQ TypeScript SDK
 * @author SwappiQ Protocol
 * @description Comprehensive example demonstrating all SDK features in a production-like trading bot
 */

import SwappiQClient, {
  CreateOrderRequest,
  Order,
  OrderBook,
  Trade,
  UserEvent,
  MarketStats,
  Balance,
  OrderSide,
  isOrderEvent,
  isTradeEvent,
  isBalanceEvent
} from '../src/index.js';

/**
 * Advanced trading bot demonstrating comprehensive SDK usage
 */
class SwappiQTradingBot {
  private client: SwappiQClient;
  private isRunning = false;
  private tradingPair = 'ETH-USDT';
  private strategy: TradingStrategy;
  private riskManager: RiskManager;
  private portfolio: PortfolioManager;

  // Trading parameters
  private readonly config = {
    maxOrderValue: 1000, // $1000 max per order
    stopLossPercentage: 0.02, // 2% stop loss
    takeProfitPercentage: 0.05, // 5% take profit
    maxOpenOrders: 5,
    minSpread: 0.001, // 0.1% minimum spread
    orderTimeout: 300000, // 5 minutes
  };

  constructor() {
    // Initialize SDK client
    this.client = new SwappiQClient({
      apiUrl: process.env.SWAPPIQ_API_URL || 'https://api.swappiq.com',
      wsUrl: process.env.SWAPPIQ_WS_URL || 'wss://ws.swappiq.com',
      auth: {
        apiKey: process.env.SWAPPIQ_API_KEY!,
        apiSecret: process.env.SWAPPIQ_API_SECRET!,
        environment: 'production'
      },
      network: 'ethereum',
      timeout: 30000,
      retryConfig: {
        maxAttempts: 3,
        baseDelay: 1000,
        maxDelay: 10000,
        backoffFactor: 2,
        jitter: true,
        retryableErrors: ['ECONNRESET', 'TIMEOUT', 'RATE_LIMITED']
      },
      rateLimitConfig: {
        requestsPerSecond: 10,
        burstSize: 20,
        queueSize: 100
      },
      debug: process.env.NODE_ENV === 'development'
    });

    this.strategy = new MakingStrategy(this.config);
    this.riskManager = new RiskManager(this.config);
    this.portfolio = new PortfolioManager();

    this.setupEventHandlers();
  }

  /**
   * Start the trading bot
   */
  async start(): Promise<void> {
    try {
      console.log('🚀 Starting SwappiQ Trading Bot...');

      // Initialize SDK
      await this.client.initialize();
      console.log('✅ SDK initialized successfully');

      // Setup WebSocket subscriptions
      await this.setupWebSocketSubscriptions();
      console.log('✅ WebSocket subscriptions established');

      // Load initial data
      await this.loadInitialData();
      console.log('✅ Initial data loaded');

      // Start trading
      this.isRunning = true;
      await this.runTradingLoop();

    } catch (error) {
      console.error('❌ Failed to start trading bot:', error);
      throw error;
    }
  }

  /**
   * Stop the trading bot
   */
  async stop(): Promise<void> {
    console.log('🛑 Stopping trading bot...');
    
    this.isRunning = false;
    
    // Cancel all open orders
    await this.cancelAllOrders();
    
    // Shutdown SDK
    await this.client.shutdown();
    
    console.log('✅ Trading bot stopped');
  }

  /**
   * Setup event handlers for monitoring
   */
  private setupEventHandlers(): void {
    // Connection events
    this.client.on('wsConnected', () => {
      console.log('🔌 WebSocket connected');
    });

    this.client.on('wsDisconnected', (event) => {
      console.log('🔌 WebSocket disconnected:', event.reason);
    });

    this.client.on('wsReconnecting', (event) => {
      console.log(`🔄 WebSocket reconnecting (attempt ${event.attempt}/${event.maxAttempts})`);
    });

    // Trading events
    this.client.on('orderCreated', (order: Order) => {
      console.log(`📋 Order created: ${order.id} - ${order.side} ${order.quantity.value} ${order.tradingPair.symbol}`);
    });

    this.client.on('orderCancelled', (order: Order) => {
      console.log(`❌ Order cancelled: ${order.id}`);
    });

    // Error handling
    this.client.on('error', (error) => {
      console.error('💥 Client error:', error);
    });

    this.client.on('httpError', (error) => {
      console.error('🌐 HTTP error:', error);
    });

    this.client.on('wsError', (error) => {
      console.error('🔌 WebSocket error:', error);
    });
  }

  /**
   * Setup WebSocket subscriptions for real-time data
   */
  private async setupWebSocketSubscriptions(): Promise<void> {
    // Subscribe to order book updates
    await this.client.subscribeToOrderBook(this.tradingPair);
    this.client.onOrderBookUpdate((orderBook: OrderBook) => {
      this.handleOrderBookUpdate(orderBook);
    });

    // Subscribe to trade updates
    await this.client.subscribeToTrades(this.tradingPair);
    this.client.onTradeUpdate((trade: Trade) => {
      this.handleTradeUpdate(trade);
    });

    // Subscribe to user events
    await this.client.subscribeToUserEvents();
    this.client.onUserEvent((event: UserEvent) => {
      this.handleUserEvent(event);
    });
  }

  /**
   * Load initial market and account data
   */
  private async loadInitialData(): Promise<void> {
    try {
      // Load trading pairs
      const tradingPairs = await this.client.getTradingPairs();
      console.log(`📊 Loaded ${tradingPairs.length} trading pairs`);

      // Load order book
      const orderBook = await this.client.getOrderBook(this.tradingPair, 20);
      this.strategy.updateOrderBook(orderBook);
      console.log(`📈 Loaded order book for ${this.tradingPair}`);

      // Load market stats
      const marketStats = await this.client.getMarketStats(this.tradingPair);
      this.strategy.updateMarketStats(marketStats[0]);
      console.log(`📊 Loaded market stats for ${this.tradingPair}`);

      // Load balances
      const balances = await this.client.getBalances();
      this.portfolio.updateBalances(balances);
      console.log(`💰 Loaded ${balances.length} token balances`);

      // Load portfolio
      const portfolio = await this.client.getPortfolio();
      this.portfolio.updatePortfolio(portfolio);
      console.log(`📊 Portfolio value: $${portfolio.totalUsdValue.value}`);

      // Load order history
      const orderHistory = await this.client.getOrderHistory({ limit: 50 });
      console.log(`📋 Loaded ${orderHistory.items.length} recent orders`);

    } catch (error) {
      console.error('Failed to load initial data:', error);
      throw error;
    }
  }

  /**
   * Main trading loop
   */
  private async runTradingLoop(): Promise<void> {
    console.log('🔄 Starting trading loop...');

    while (this.isRunning) {
      try {
        // Check if we should trade
        if (!this.shouldTrade()) {
          await this.sleep(5000); // Wait 5 seconds
          continue;
        }

        // Generate trading signals
        const signals = await this.strategy.generateSignals();
        
        if (signals.length === 0) {
          await this.sleep(1000); // Wait 1 second
          continue;
        }

        // Process each signal
        for (const signal of signals) {
          if (!this.isRunning) break;

          try {
            await this.processSignal(signal);
          } catch (error) {
            console.error('Error processing signal:', error);
          }
        }

        await this.sleep(100); // Brief pause between iterations

      } catch (error) {
        console.error('Error in trading loop:', error);
        await this.sleep(5000); // Wait longer on error
      }
    }
  }

  /**
   * Process a trading signal
   */
  private async processSignal(signal: TradingSignal): Promise<void> {
    console.log(`🎯 Processing ${signal.action} signal for ${signal.tradingPair} at ${signal.price}`);

    // Create order request
    const orderRequest: CreateOrderRequest = {
      tradingPair: signal.tradingPair,
      side: signal.action,
      type: 'limit',
      quantity: signal.quantity.toString(),
      price: signal.price.toString(),
      timeInForce: 'GTC',
      clientOrderId: this.generateClientOrderId()
    };

    try {
      // Validate order locally first
      const validation = await this.client.validateOrder(orderRequest);
      
      if (!validation.balanceSufficient) {
        console.warn('❌ Insufficient balance for order');
        return;
      }

      if (validation.errors.length > 0) {
        console.warn('❌ Order validation failed:', validation.errors[0].message);
        return;
      }

      // Check risk limits
      if (!this.riskManager.isOrderAllowed(orderRequest, this.portfolio.getCurrentPortfolio())) {
        console.warn('❌ Order rejected by risk manager');
        return;
      }

      // Submit order
      const response = await this.client.createOrder(orderRequest);
      
      if (response.success && response.order) {
        console.log(`✅ Order submitted: ${response.order.id}`);
        
        // Schedule order monitoring
        this.scheduleOrderMonitoring(response.order);
      } else {
        console.error('❌ Order submission failed:', response.error?.message);
      }

    } catch (error) {
      console.error('Error submitting order:', error);
    }
  }

  /**
   * Handle real-time order book updates
   */
  private handleOrderBookUpdate(orderBook: OrderBook): void {
    this.strategy.updateOrderBook(orderBook);
    
    // Log best bid/ask if significant change
    if (orderBook.bids.length > 0 && orderBook.asks.length > 0) {
      const bestBid = orderBook.bids[0].price.value;
      const bestAsk = orderBook.asks[0].price.value;
      const spread = ((parseFloat(bestAsk) - parseFloat(bestBid)) / parseFloat(bestBid) * 100).toFixed(3);
      
      console.log(`📈 ${orderBook.tradingPair}: ${bestBid} / ${bestAsk} (spread: ${spread}%)`);
    }
  }

  /**
   * Handle real-time trade updates
   */
  private handleTradeUpdate(trade: Trade): void {
    console.log(`💱 Trade: ${trade.quantity.value} ${trade.tradingPair} at ${trade.price.value}`);
    this.strategy.updateTrade(trade);
  }

  /**
   * Handle user events (orders, trades, balances)
   */
  private handleUserEvent(event: UserEvent): void {
    if (isOrderEvent(event)) {
      console.log(`📋 Order ${event.type}: ${event.order.id} - ${event.order.status}`);
      this.portfolio.updateFromOrderEvent(event);
    } else if (isTradeEvent(event)) {
      console.log(`💱 Trade executed: ${event.trade.id} - ${event.trade.quantity.value} at ${event.trade.price.value}`);
      this.portfolio.updateFromTradeEvent(event);
    } else if (isBalanceEvent(event)) {
      console.log(`💰 Balance updated: ${event.balance.token.value} - ${event.balance.available.value}`);
      this.portfolio.updateFromBalanceEvent(event);
    }
  }

  /**
   * Check if trading conditions are met
   */
  private shouldTrade(): boolean {
    // Check if market is open and liquid
    const marketStats = this.strategy.getCurrentMarketStats();
    if (!marketStats || parseFloat(marketStats.volume24h.value) < 1000) {
      return false;
    }

    // Check if we have sufficient balance
    const portfolio = this.portfolio.getCurrentPortfolio();
    if (!portfolio || parseFloat(portfolio.totalUsdValue.value) < 100) {
      return false;
    }

    // Check connection health
    if (!this.client.isHealthy()) {
      console.warn('⚠️ Client unhealthy, pausing trading');
      return false;
    }

    return true;
  }

  /**
   * Schedule order monitoring for timeout and fill tracking
   */
  private scheduleOrderMonitoring(order: Order): void {
    setTimeout(async () => {
      try {
        const currentOrder = await this.client.getOrder(order.id);
        
        if (currentOrder.status === 'open') {
          console.log(`⏰ Order ${order.id} still open after timeout, considering cancellation`);
          
          // Cancel if market has moved significantly
          if (this.shouldCancelOrder(currentOrder)) {
            await this.client.cancelOrder(order.id);
            console.log(`❌ Cancelled order ${order.id} due to timeout`);
          }
        }
      } catch (error) {
        console.error('Error monitoring order:', error);
      }
    }, this.config.orderTimeout);
  }

  /**
   * Check if an order should be cancelled
   */
  private shouldCancelOrder(order: Order): boolean {
    // Simple logic: cancel if market moved away from our order
    const orderBook = this.strategy.getCurrentOrderBook();
    if (!orderBook) return false;

    const orderPrice = 'price' in order ? parseFloat((order as any).price.value) : 0;
    
    if (order.side === 'buy' && orderBook.bids.length > 0) {
      const bestBid = parseFloat(orderBook.bids[0].price.value);
      return orderPrice < bestBid * 0.99; // Cancel if 1% below market
    } else if (order.side === 'sell' && orderBook.asks.length > 0) {
      const bestAsk = parseFloat(orderBook.asks[0].price.value);
      return orderPrice > bestAsk * 1.01; // Cancel if 1% above market
    }

    return false;
  }

  /**
   * Cancel all open orders
   */
  private async cancelAllOrders(): Promise<void> {
    try {
      const orders = await this.client.getOrderHistory({ 
        status: ['open', 'partially_filled'],
        limit: 100 
      });

      for (const order of orders.items) {
        try {
          await this.client.cancelOrder(order.id);
          console.log(`❌ Cancelled order ${order.id}`);
        } catch (error) {
          console.error(`Failed to cancel order ${order.id}:`, error);
        }
      }
    } catch (error) {
      console.error('Failed to cancel all orders:', error);
    }
  }

  /**
   * Generate unique client order ID
   */
  private generateClientOrderId(): string {
    return `bot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Utility method for delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ========== SUPPORTING CLASSES ==========

interface TradingSignal {
  tradingPair: string;
  action: OrderSide;
  price: number;
  quantity: number;
  confidence: number;
  reason: string;
}

/**
 * Market making trading strategy
 */
class MakingStrategy {
  private currentOrderBook?: OrderBook;
  private currentMarketStats?: MarketStats;
  private recentTrades: Trade[] = [];

  constructor(private config: any) {}

  updateOrderBook(orderBook: OrderBook): void {
    this.currentOrderBook = orderBook;
  }

  updateMarketStats(stats: MarketStats): void {
    this.currentMarketStats = stats;
  }

  updateTrade(trade: Trade): void {
    this.recentTrades.push(trade);
    // Keep only last 100 trades
    if (this.recentTrades.length > 100) {
      this.recentTrades.shift();
    }
  }

  async generateSignals(): Promise<TradingSignal[]> {
    if (!this.currentOrderBook || !this.currentMarketStats) {
      return [];
    }

    const signals: TradingSignal[] = [];
    const { bids, asks } = this.currentOrderBook;

    if (bids.length === 0 || asks.length === 0) {
      return signals;
    }

    const bestBid = parseFloat(bids[0].price.value);
    const bestAsk = parseFloat(asks[0].price.value);
    const spread = (bestAsk - bestBid) / bestBid;

    // Only trade if spread is wide enough
    if (spread < this.config.minSpread) {
      return signals;
    }

    // Market making: place orders inside the spread
    const midPrice = (bestBid + bestAsk) / 2;
    const orderSize = Math.min(100, parseFloat(bids[0].quantity.value) * 0.1);

    // Buy signal (place bid)
    signals.push({
      tradingPair: this.currentOrderBook.tradingPair,
      action: 'buy',
      price: bestBid + (midPrice - bestBid) * 0.5,
      quantity: orderSize,
      confidence: 0.7,
      reason: 'Market making - buy side'
    });

    // Sell signal (place ask)
    signals.push({
      tradingPair: this.currentOrderBook.tradingPair,
      action: 'sell',
      price: bestAsk - (bestAsk - midPrice) * 0.5,
      quantity: orderSize,
      confidence: 0.7,
      reason: 'Market making - sell side'
    });

    return signals;
  }

  getCurrentOrderBook(): OrderBook | undefined {
    return this.currentOrderBook;
  }

  getCurrentMarketStats(): MarketStats | undefined {
    return this.currentMarketStats;
  }
}

/**
 * Risk management system
 */
class RiskManager {
  constructor(private config: any) {}

  isOrderAllowed(order: CreateOrderRequest, portfolio: any): boolean {
    // Check maximum order value
    if (order.price) {
      const orderValue = parseFloat(order.quantity) * parseFloat(order.price);
      if (orderValue > this.config.maxOrderValue) {
        return false;
      }
    }

    // Add more risk checks here
    return true;
  }
}

/**
 * Portfolio management system
 */
class PortfolioManager {
  private currentPortfolio: any;
  private balances: Map<string, Balance> = new Map();

  updatePortfolio(portfolio: any): void {
    this.currentPortfolio = portfolio;
  }

  updateBalances(balances: Balance[]): void {
    this.balances.clear();
    balances.forEach(balance => {
      this.balances.set(balance.token.value, balance);
    });
  }

  updateFromOrderEvent(event: any): void {
    // Update portfolio from order events
  }

  updateFromTradeEvent(event: any): void {
    // Update portfolio from trade events
  }

  updateFromBalanceEvent(event: any): void {
    // Update portfolio from balance events
    this.balances.set(event.balance.token.value, event.balance);
  }

  getCurrentPortfolio(): any {
    return this.currentPortfolio;
  }
}

// ========== MAIN EXECUTION ==========

async function main() {
  const bot = new SwappiQTradingBot();

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n🛑 Received SIGINT, shutting down gracefully...');
    await bot.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
    await bot.stop();
    process.exit(0);
  });

  try {
    await bot.start();
  } catch (error) {
    console.error('💥 Bot crashed:', error);
    process.exit(1);
  }
}

// Run the bot if this file is executed directly
if (require.main === module) {
  main().catch(console.error);
}

export { SwappiQTradingBot };