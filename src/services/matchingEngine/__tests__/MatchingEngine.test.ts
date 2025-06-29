import { MatchingEngine } from '../MatchingEngine';
import {
  OrderType,
  OrderSide,
  OrderStatus,
  TimeInForce,
  MatchingEngineConfig,
  Order,
  ExecutionReport,
} from '../types';

describe('MatchingEngine', () => {
  let matchingEngine: MatchingEngine;
  const config: MatchingEngineConfig = {
    maxOrderBookDepth: 100,
    minOrderSize: { 'ETH/USDC': 0.01 },
    maxOrderSize: { 'ETH/USDC': 1000 },
    tickSize: { 'ETH/USDC': 0.01 },
    makerFeeRate: 0.001, // 0.1%
    takerFeeRate: 0.002, // 0.2%
    enableStopOrders: false,
    enableIcebergOrders: false,
  };

  beforeEach(() => {
    matchingEngine = new MatchingEngine(config);
    matchingEngine.initializePair('ETH/USDC');
  });

  afterEach(() => {
    matchingEngine.clear();
  });

  describe('Order Submission', () => {
    it('should submit a limit buy order', async () => {
      const order = {
        userId: 'user1',
        pair: 'ETH/USDC',
        side: OrderSide.BUY,
        type: OrderType.LIMIT,
        price: 2000,
        quantity: 1,
        timeInForce: TimeInForce.GTC,
      };

      const report = await matchingEngine.submitOrder(order);

      expect(report.status).toBe(OrderStatus.OPEN);
      expect(report.filledQuantity).toBe(0);
      expect(report.remainingQuantity).toBe(1);
      expect(report.trades).toHaveLength(0);
    });

    it('should submit a limit sell order', async () => {
      const order = {
        userId: 'user1',
        pair: 'ETH/USDC',
        side: OrderSide.SELL,
        type: OrderType.LIMIT,
        price: 2100,
        quantity: 1,
        timeInForce: TimeInForce.GTC,
      };

      const report = await matchingEngine.submitOrder(order);

      expect(report.status).toBe(OrderStatus.OPEN);
      expect(report.filledQuantity).toBe(0);
      expect(report.remainingQuantity).toBe(1);
    });

    it('should reject order with invalid quantity', async () => {
      const order = {
        userId: 'user1',
        pair: 'ETH/USDC',
        side: OrderSide.BUY,
        type: OrderType.LIMIT,
        price: 2000,
        quantity: 0,
      };

      await expect(matchingEngine.submitOrder(order)).rejects.toThrow('Invalid quantity');
    });

    it('should reject order below minimum size', async () => {
      const order = {
        userId: 'user1',
        pair: 'ETH/USDC',
        side: OrderSide.BUY,
        type: OrderType.LIMIT,
        price: 2000,
        quantity: 0.005, // Below min size of 0.01
      };

      await expect(matchingEngine.submitOrder(order)).rejects.toThrow('Order size below minimum');
    });
  });

  describe('Order Matching', () => {
    it('should match buy and sell orders at same price', async () => {
      // Submit sell order first
      const sellOrder = await matchingEngine.submitOrder({
        userId: 'user1',
        pair: 'ETH/USDC',
        side: OrderSide.SELL,
        type: OrderType.LIMIT,
        price: 2000,
        quantity: 1,
      });

      expect(sellOrder.status).toBe(OrderStatus.OPEN);

      // Submit matching buy order
      const buyOrder = await matchingEngine.submitOrder({
        userId: 'user2',
        pair: 'ETH/USDC',
        side: OrderSide.BUY,
        type: OrderType.LIMIT,
        price: 2000,
        quantity: 1,
      });

      expect(buyOrder.status).toBe(OrderStatus.FILLED);
      expect(buyOrder.filledQuantity).toBe(1);
      expect(buyOrder.trades).toHaveLength(1);
      expect(buyOrder.trades[0].price).toBe(2000);
      expect(buyOrder.trades[0].quantity).toBe(1);
    });

    it('should partially fill orders', async () => {
      // Submit large sell order
      await matchingEngine.submitOrder({
        userId: 'user1',
        pair: 'ETH/USDC',
        side: OrderSide.SELL,
        type: OrderType.LIMIT,
        price: 2000,
        quantity: 10,
      });

      // Submit smaller buy order
      const buyOrder = await matchingEngine.submitOrder({
        userId: 'user2',
        pair: 'ETH/USDC',
        side: OrderSide.BUY,
        type: OrderType.LIMIT,
        price: 2000,
        quantity: 3,
      });

      expect(buyOrder.status).toBe(OrderStatus.FILLED);
      expect(buyOrder.filledQuantity).toBe(3);

      // Check sell order is partially filled
      const sellOrder = matchingEngine.getUserOrders('user1')[0];
      expect(sellOrder.status).toBe(OrderStatus.PARTIALLY_FILLED);
      expect(sellOrder.filledQuantity).toBe(3);
    });

    it('should match at best available price', async () => {
      // Submit multiple sell orders at different prices
      await matchingEngine.submitOrder({
        userId: 'user1',
        pair: 'ETH/USDC',
        side: OrderSide.SELL,
        type: OrderType.LIMIT,
        price: 2010,
        quantity: 1,
      });

      await matchingEngine.submitOrder({
        userId: 'user2',
        pair: 'ETH/USDC',
        side: OrderSide.SELL,
        type: OrderType.LIMIT,
        price: 2000,
        quantity: 1,
      });

      await matchingEngine.submitOrder({
        userId: 'user3',
        pair: 'ETH/USDC',
        side: OrderSide.SELL,
        type: OrderType.LIMIT,
        price: 2005,
        quantity: 1,
      });

      // Submit buy order at higher price
      const buyOrder = await matchingEngine.submitOrder({
        userId: 'user4',
        pair: 'ETH/USDC',
        side: OrderSide.BUY,
        type: OrderType.LIMIT,
        price: 2015,
        quantity: 2,
      });

      expect(buyOrder.status).toBe(OrderStatus.FILLED);
      expect(buyOrder.filledQuantity).toBe(2);
      expect(buyOrder.trades).toHaveLength(2);
      
      // Should match at best prices first (2000, then 2005)
      expect(buyOrder.trades[0].price).toBe(2000);
      expect(buyOrder.trades[1].price).toBe(2005);
      expect(buyOrder.averagePrice).toBe(2002.5);
    });

    it('should respect price-time priority', async () => {
      // Submit two sell orders at same price
      const sellOrder1 = await matchingEngine.submitOrder({
        userId: 'user1',
        pair: 'ETH/USDC',
        side: OrderSide.SELL,
        type: OrderType.LIMIT,
        price: 2000,
        quantity: 1,
        clientOrderId: 'sell1',
      });

      const sellOrder2 = await matchingEngine.submitOrder({
        userId: 'user2',
        pair: 'ETH/USDC',
        side: OrderSide.SELL,
        type: OrderType.LIMIT,
        price: 2000,
        quantity: 1,
        clientOrderId: 'sell2',
      });

      // Submit buy order for 1 unit
      const buyOrder = await matchingEngine.submitOrder({
        userId: 'user3',
        pair: 'ETH/USDC',
        side: OrderSide.BUY,
        type: OrderType.LIMIT,
        price: 2000,
        quantity: 1,
      });

      expect(buyOrder.trades).toHaveLength(1);
      // Should match with first order (FIFO)
      expect(buyOrder.trades[0].makerOrderId).toBe(sellOrder1.orderId);
    });
  });

  describe('Market Orders', () => {
    it('should execute market buy order at best ask', async () => {
      // Create order book
      await matchingEngine.submitOrder({
        userId: 'user1',
        pair: 'ETH/USDC',
        side: OrderSide.SELL,
        type: OrderType.LIMIT,
        price: 2000,
        quantity: 1,
      });

      await matchingEngine.submitOrder({
        userId: 'user2',
        pair: 'ETH/USDC',
        side: OrderSide.SELL,
        type: OrderType.LIMIT,
        price: 2010,
        quantity: 1,
      });

      // Submit market buy
      const marketBuy = await matchingEngine.submitOrder({
        userId: 'user3',
        pair: 'ETH/USDC',
        side: OrderSide.BUY,
        type: OrderType.MARKET,
        quantity: 1.5,
      });

      expect(marketBuy.status).toBe(OrderStatus.FILLED);
      expect(marketBuy.filledQuantity).toBe(1.5);
      expect(marketBuy.trades).toHaveLength(2);
      expect(marketBuy.trades[0].price).toBe(2000);
      expect(marketBuy.trades[0].quantity).toBe(1);
      expect(marketBuy.trades[1].price).toBe(2010);
      expect(marketBuy.trades[1].quantity).toBe(0.5);
    });

    it('should cancel market order if no liquidity', async () => {
      const marketBuy = await matchingEngine.submitOrder({
        userId: 'user1',
        pair: 'ETH/USDC',
        side: OrderSide.BUY,
        type: OrderType.MARKET,
        quantity: 1,
      });

      expect(marketBuy.status).toBe(OrderStatus.CANCELLED);
      expect(marketBuy.filledQuantity).toBe(0);
    });
  });

  describe('Time in Force', () => {
    it('should handle IOC orders', async () => {
      // Add partial liquidity
      await matchingEngine.submitOrder({
        userId: 'user1',
        pair: 'ETH/USDC',
        side: OrderSide.SELL,
        type: OrderType.LIMIT,
        price: 2000,
        quantity: 0.5,
      });

      // Submit IOC buy for more than available
      const iocOrder = await matchingEngine.submitOrder({
        userId: 'user2',
        pair: 'ETH/USDC',
        side: OrderSide.BUY,
        type: OrderType.LIMIT,
        price: 2000,
        quantity: 1,
        timeInForce: TimeInForce.IOC,
      });

      expect(iocOrder.status).toBe(OrderStatus.CANCELLED);
      expect(iocOrder.filledQuantity).toBe(0.5);
      expect(iocOrder.remainingQuantity).toBe(0.5);
    });

    it('should handle FOK orders - fill completely', async () => {
      // Add exact liquidity
      await matchingEngine.submitOrder({
        userId: 'user1',
        pair: 'ETH/USDC',
        side: OrderSide.SELL,
        type: OrderType.LIMIT,
        price: 2000,
        quantity: 1,
      });

      // Submit FOK order
      const fokOrder = await matchingEngine.submitOrder({
        userId: 'user2',
        pair: 'ETH/USDC',
        side: OrderSide.BUY,
        type: OrderType.LIMIT,
        price: 2000,
        quantity: 1,
        timeInForce: TimeInForce.FOK,
      });

      expect(fokOrder.status).toBe(OrderStatus.FILLED);
      expect(fokOrder.filledQuantity).toBe(1);
    });

    it('should handle FOK orders - cancel if cannot fill', async () => {
      // Add insufficient liquidity
      await matchingEngine.submitOrder({
        userId: 'user1',
        pair: 'ETH/USDC',
        side: OrderSide.SELL,
        type: OrderType.LIMIT,
        price: 2000,
        quantity: 0.5,
      });

      // Submit FOK order for more
      const fokOrder = await matchingEngine.submitOrder({
        userId: 'user2',
        pair: 'ETH/USDC',
        side: OrderSide.BUY,
        type: OrderType.LIMIT,
        price: 2000,
        quantity: 1,
        timeInForce: TimeInForce.FOK,
      });

      expect(fokOrder.status).toBe(OrderStatus.CANCELLED);
      expect(fokOrder.filledQuantity).toBe(0);
      expect(fokOrder.trades).toHaveLength(0);
    });
  });

  describe('Order Cancellation', () => {
    it('should cancel open order', async () => {
      const order = await matchingEngine.submitOrder({
        userId: 'user1',
        pair: 'ETH/USDC',
        side: OrderSide.BUY,
        type: OrderType.LIMIT,
        price: 2000,
        quantity: 1,
      });

      const cancelReport = await matchingEngine.cancelOrder(order.orderId, 'user1');
      
      expect(cancelReport.status).toBe(OrderStatus.CANCELLED);
      expect(cancelReport.orderId).toBe(order.orderId);

      // Order should be removed from book
      const orderBook = matchingEngine.getOrderBook('ETH/USDC');
      expect(orderBook?.bids).toHaveLength(0);
    });

    it('should not allow cancelling filled order', async () => {
      // Create and fill an order
      await matchingEngine.submitOrder({
        userId: 'user1',
        pair: 'ETH/USDC',
        side: OrderSide.SELL,
        type: OrderType.LIMIT,
        price: 2000,
        quantity: 1,
      });

      const buyOrder = await matchingEngine.submitOrder({
        userId: 'user2',
        pair: 'ETH/USDC',
        side: OrderSide.BUY,
        type: OrderType.LIMIT,
        price: 2000,
        quantity: 1,
      });

      await expect(
        matchingEngine.cancelOrder(buyOrder.orderId, 'user2')
      ).rejects.toThrow('already FILLED');
    });

    it('should enforce user authorization for cancellation', async () => {
      const order = await matchingEngine.submitOrder({
        userId: 'user1',
        pair: 'ETH/USDC',
        side: OrderSide.BUY,
        type: OrderType.LIMIT,
        price: 2000,
        quantity: 1,
      });

      await expect(
        matchingEngine.cancelOrder(order.orderId, 'user2')
      ).rejects.toThrow('Unauthorized');
    });
  });

  describe('Fee Calculation', () => {
    it('should calculate maker and taker fees', async () => {
      await matchingEngine.submitOrder({
        userId: 'user1',
        pair: 'ETH/USDC',
        side: OrderSide.SELL,
        type: OrderType.LIMIT,
        price: 2000,
        quantity: 1,
      });

      const buyOrder = await matchingEngine.submitOrder({
        userId: 'user2',
        pair: 'ETH/USDC',
        side: OrderSide.BUY,
        type: OrderType.LIMIT,
        price: 2000,
        quantity: 1,
      });

      const trade = buyOrder.trades[0];
      expect(trade.takerFee).toBe(2000 * 1 * 0.002); // 4 USDC
      expect(trade.makerFee).toBe(2000 * 1 * 0.001); // 2 USDC
    });
  });

  describe('Order Book and Market Data', () => {
    it('should provide order book snapshot', async () => {
      // Add multiple orders
      await matchingEngine.submitOrder({
        userId: 'user1',
        pair: 'ETH/USDC',
        side: OrderSide.BUY,
        type: OrderType.LIMIT,
        price: 1990,
        quantity: 1,
      });

      await matchingEngine.submitOrder({
        userId: 'user2',
        pair: 'ETH/USDC',
        side: OrderSide.BUY,
        type: OrderType.LIMIT,
        price: 1995,
        quantity: 2,
      });

      await matchingEngine.submitOrder({
        userId: 'user3',
        pair: 'ETH/USDC',
        side: OrderSide.SELL,
        type: OrderType.LIMIT,
        price: 2005,
        quantity: 1.5,
      });

      await matchingEngine.submitOrder({
        userId: 'user4',
        pair: 'ETH/USDC',
        side: OrderSide.SELL,
        type: OrderType.LIMIT,
        price: 2010,
        quantity: 3,
      });

      const snapshot = matchingEngine.getOrderBook('ETH/USDC', 10);
      
      expect(snapshot).toBeTruthy();
      expect(snapshot!.bids).toHaveLength(2);
      expect(snapshot!.asks).toHaveLength(2);
      expect(snapshot!.bids[0].price).toBe(1995); // Best bid
      expect(snapshot!.asks[0].price).toBe(2005); // Best ask
    });

    it('should update market data on trades', async () => {
      // Execute a trade
      await matchingEngine.submitOrder({
        userId: 'user1',
        pair: 'ETH/USDC',
        side: OrderSide.SELL,
        type: OrderType.LIMIT,
        price: 2000,
        quantity: 1,
      });

      await matchingEngine.submitOrder({
        userId: 'user2',
        pair: 'ETH/USDC',
        side: OrderSide.BUY,
        type: OrderType.LIMIT,
        price: 2000,
        quantity: 1,
      });

      const marketData = matchingEngine.getMarketData('ETH/USDC');
      
      expect(marketData).toBeTruthy();
      expect(marketData!.lastPrice).toBe(2000);
      expect(marketData!.volume24h).toBeGreaterThan(0);
      expect(marketData!.high24h).toBe(2000);
      expect(marketData!.low24h).toBe(2000);
    });
  });

  describe('User Order Management', () => {
    it('should retrieve user orders', async () => {
      // Submit multiple orders for different users
      await matchingEngine.submitOrder({
        userId: 'user1',
        pair: 'ETH/USDC',
        side: OrderSide.BUY,
        type: OrderType.LIMIT,
        price: 2000,
        quantity: 1,
      });

      await matchingEngine.submitOrder({
        userId: 'user1',
        pair: 'ETH/USDC',
        side: OrderSide.SELL,
        type: OrderType.LIMIT,
        price: 2100,
        quantity: 0.5,
      });

      await matchingEngine.submitOrder({
        userId: 'user2',
        pair: 'ETH/USDC',
        side: OrderSide.BUY,
        type: OrderType.LIMIT,
        price: 1990,
        quantity: 2,
      });

      const user1Orders = matchingEngine.getUserOrders('user1');
      expect(user1Orders).toHaveLength(2);
      expect(user1Orders.every(o => o.userId === 'user1')).toBe(true);

      const user1BuyOrders = matchingEngine.getUserOrders('user1', 'ETH/USDC', OrderStatus.OPEN);
      expect(user1BuyOrders.every(o => o.status === OrderStatus.OPEN)).toBe(true);
    });
  });

  describe('Recent Trades', () => {
    it('should retrieve recent trades for a pair', async () => {
      // Execute multiple trades
      for (let i = 0; i < 5; i++) {
        await matchingEngine.submitOrder({
          userId: 'maker',
          pair: 'ETH/USDC',
          side: OrderSide.SELL,
          type: OrderType.LIMIT,
          price: 2000 + i,
          quantity: 1,
        });

        await matchingEngine.submitOrder({
          userId: 'taker',
          pair: 'ETH/USDC',
          side: OrderSide.BUY,
          type: OrderType.LIMIT,
          price: 2000 + i,
          quantity: 1,
        });
      }

      const recentTrades = matchingEngine.getRecentTrades('ETH/USDC', 3);
      expect(recentTrades).toHaveLength(3);
      expect(recentTrades[0].price).toBe(2004); // Most recent
      expect(recentTrades[2].price).toBe(2002); // Oldest of the 3
    });
  });
});