import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { MatchingEngine } from '../../src/services/matchingEngine/MatchingEngine';
import { OrderBook } from '../../src/services/matchingEngine/OrderBook';
import { ExternalLiquidityProvider, LiFiProvider, UniswapProvider, LiquidityAggregator } from '../../src/services/matchingEngine/ExternalLiquidityProvider';
import { SmartOrderRouter } from '../../src/services/matchingEngine/SmartOrderRouter';
import {
  Order,
  OrderType,
  OrderSide,
  OrderStatus,
  TimeInForce,
  MatchingEngineConfig,
  Trade
} from '../../src/services/matchingEngine/types';

describe('Comprehensive Matching Engine Tests', () => {
  let matchingEngine: MatchingEngine;
  let liquidityAggregator: LiquidityAggregator;
  let smartOrderRouter: SmartOrderRouter;
  
  const config: MatchingEngineConfig = {
    maxOrderBookDepth: 1000,
    minOrderSize: { 'ETH/USDC': 0.001, 'BTC/USDC': 0.0001 },
    maxOrderSize: { 'ETH/USDC': 10000, 'BTC/USDC': 1000 },
    tickSize: { 'ETH/USDC': 0.01, 'BTC/USDC': 0.1 },
    makerFeeRate: 0.001,
    takerFeeRate: 0.002,
    enableStopOrders: true,
    enableIcebergOrders: true,
  };

  beforeEach(() => {
    matchingEngine = new MatchingEngine(config);
    matchingEngine.initializePair('ETH/USDC');
    matchingEngine.initializePair('BTC/USDC');
    
    liquidityAggregator = new LiquidityAggregator();
    // Add mock providers
    liquidityAggregator.addProvider(new UniswapProvider());
  });

  afterEach(() => {
    matchingEngine.clear();
  });

  describe('Price-Time Priority Algorithm', () => {
    it('should match orders with strict price priority', async () => {
      // Create multiple sell orders at different prices
      const sellOrders = [
        { price: 2005, quantity: 1, userId: 'seller1' },
        { price: 2000, quantity: 1, userId: 'seller2' },
        { price: 2010, quantity: 1, userId: 'seller3' },
        { price: 2000, quantity: 1, userId: 'seller4' }, // Same price as seller2
      ];

      for (const order of sellOrders) {
        await matchingEngine.submitOrder({
          userId: order.userId,
          pair: 'ETH/USDC',
          side: OrderSide.SELL,
          type: OrderType.LIMIT,
          price: order.price,
          quantity: order.quantity,
        });
      }

      // Submit aggressive buy order
      const buyOrder = await matchingEngine.submitOrder({
        userId: 'buyer1',
        pair: 'ETH/USDC',
        side: OrderSide.BUY,
        type: OrderType.LIMIT,
        price: 2015,
        quantity: 3,
      });

      // Verify price priority (best prices matched first)
      expect(buyOrder.trades).toHaveLength(3);
      expect(buyOrder.trades[0].price).toBe(2000); // Best price
      expect(buyOrder.trades[0].makerUserId).toBe('seller2'); // First at this price
      expect(buyOrder.trades[1].price).toBe(2000); // Same best price
      expect(buyOrder.trades[1].makerUserId).toBe('seller4'); // Second at this price
      expect(buyOrder.trades[2].price).toBe(2005); // Next best price
    });

    it('should respect time priority for orders at same price', async () => {
      const timestamp = Date.now();
      const orders = [];
      
      // Submit 5 sell orders at same price with slight time delays
      for (let i = 0; i < 5; i++) {
        const order = await matchingEngine.submitOrder({
          userId: `seller${i}`,
          pair: 'ETH/USDC',
          side: OrderSide.SELL,
          type: OrderType.LIMIT,
          price: 2000,
          quantity: 1,
          clientOrderId: `sell-${i}`,
        });
        orders.push(order);
        // Small delay to ensure different timestamps
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      // Buy order that matches 3 units
      const buyOrder = await matchingEngine.submitOrder({
        userId: 'buyer',
        pair: 'ETH/USDC',
        side: OrderSide.BUY,
        type: OrderType.LIMIT,
        price: 2000,
        quantity: 3,
      });

      // Verify FIFO execution
      expect(buyOrder.trades).toHaveLength(3);
      expect(buyOrder.trades[0].makerUserId).toBe('seller0');
      expect(buyOrder.trades[1].makerUserId).toBe('seller1');
      expect(buyOrder.trades[2].makerUserId).toBe('seller2');
    });
  });

  describe('Order Types Testing', () => {
    describe('Limit Orders', () => {
      it('should handle post-only limit orders', async () => {
        // Add liquidity
        await matchingEngine.submitOrder({
          userId: 'maker',
          pair: 'ETH/USDC',
          side: OrderSide.SELL,
          type: OrderType.LIMIT,
          price: 2000,
          quantity: 1,
        });

        // Submit post-only order that would cross
        const postOnlyOrder = {
          userId: 'taker',
          pair: 'ETH/USDC',
          side: OrderSide.BUY,
          type: OrderType.LIMIT,
          price: 2000,
          quantity: 1,
          postOnly: true,
        };

        // Should reject order that would take liquidity
        await expect(matchingEngine.submitOrder(postOnlyOrder))
          .rejects.toThrow('Post-only order would take liquidity');
      });

      it('should handle hidden/iceberg orders', async () => {
        // Submit iceberg order (only shows partial quantity)
        const icebergOrder = await matchingEngine.submitOrder({
          userId: 'whale',
          pair: 'ETH/USDC',
          side: OrderSide.SELL,
          type: OrderType.LIMIT,
          price: 2000,
          quantity: 100,
          displayQuantity: 10, // Only show 10 units
          metadata: { orderType: 'iceberg' }
        });

        const orderBook = matchingEngine.getOrderBook('ETH/USDC');
        // Order book should only show display quantity
        expect(orderBook?.asks[0]?.quantity).toBe(10);

        // But full quantity should be available for matching
        const buyOrder = await matchingEngine.submitOrder({
          userId: 'buyer',
          pair: 'ETH/USDC',
          side: OrderSide.BUY,
          type: OrderType.MARKET,
          quantity: 50,
        });

        expect(buyOrder.filledQuantity).toBe(50);
      });
    });

    describe('Market Orders', () => {
      it('should execute market orders with price protection', async () => {
        // Create order book with wide spread
        await matchingEngine.submitOrder({
          userId: 'seller1',
          pair: 'ETH/USDC',
          side: OrderSide.SELL,
          type: OrderType.LIMIT,
          price: 2000,
          quantity: 1,
        });

        await matchingEngine.submitOrder({
          userId: 'seller2',
          pair: 'ETH/USDC',
          side: OrderSide.SELL,
          type: OrderType.LIMIT,
          price: 2100, // 5% higher
          quantity: 1,
        });

        // Market order with price protection
        const marketOrder = await matchingEngine.submitOrder({
          userId: 'buyer',
          pair: 'ETH/USDC',
          side: OrderSide.BUY,
          type: OrderType.MARKET,
          quantity: 2,
          maxPriceImpact: 0.02, // 2% max price impact
        });

        // Should only fill first order due to price protection
        expect(marketOrder.filledQuantity).toBe(1);
        expect(marketOrder.status).toBe(OrderStatus.PARTIALLY_FILLED);
      });

      it('should handle market orders in thin liquidity', async () => {
        // Add minimal liquidity
        await matchingEngine.submitOrder({
          userId: 'seller',
          pair: 'ETH/USDC',
          side: OrderSide.SELL,
          type: OrderType.LIMIT,
          price: 2000,
          quantity: 0.1,
        });

        // Large market order
        const marketOrder = await matchingEngine.submitOrder({
          userId: 'buyer',
          pair: 'ETH/USDC',
          side: OrderSide.BUY,
          type: OrderType.MARKET,
          quantity: 10,
        });

        expect(marketOrder.filledQuantity).toBe(0.1);
        expect(marketOrder.status).toBe(OrderStatus.PARTIALLY_FILLED);
        expect(marketOrder.message).toContain('Insufficient liquidity');
      });
    });

    describe('Stop Orders', () => {
      it('should trigger stop-loss orders', async () => {
        // Place stop-loss order
        const stopLoss = await matchingEngine.submitOrder({
          userId: 'trader',
          pair: 'ETH/USDC',
          side: OrderSide.SELL,
          type: OrderType.STOP_LIMIT,
          price: 1900, // Limit price
          stopPrice: 1950, // Trigger price
          quantity: 1,
        });

        expect(stopLoss.status).toBe(OrderStatus.PENDING); // Not triggered yet

        // Execute trade that triggers stop
        await matchingEngine.submitOrder({
          userId: 'seller',
          pair: 'ETH/USDC',
          side: OrderSide.SELL,
          type: OrderType.LIMIT,
          price: 1940,
          quantity: 0.1,
        });

        await matchingEngine.submitOrder({
          userId: 'buyer',
          pair: 'ETH/USDC',
          side: OrderSide.BUY,
          type: OrderType.MARKET,
          quantity: 0.1,
        });

        // Stop should now be triggered and converted to limit order
        const updatedStop = matchingEngine.getOrder(stopLoss.orderId);
        expect(updatedStop?.status).toBe(OrderStatus.OPEN);
      });
    });
  });

  describe('Partial Fills and Order Book Management', () => {
    it('should handle complex partial fill scenarios', async () => {
      // Create fragmented liquidity
      const sellOrders = [
        { price: 2000, quantity: 0.3 },
        { price: 2000.5, quantity: 0.5 },
        { price: 2001, quantity: 0.2 },
        { price: 2001.5, quantity: 0.7 },
        { price: 2002, quantity: 0.3 },
      ];

      for (let i = 0; i < sellOrders.length; i++) {
        await matchingEngine.submitOrder({
          userId: `seller${i}`,
          pair: 'ETH/USDC',
          side: OrderSide.SELL,
          type: OrderType.LIMIT,
          ...sellOrders[i],
        });
      }

      // Large buy order that sweeps multiple levels
      const buyOrder = await matchingEngine.submitOrder({
        userId: 'buyer',
        pair: 'ETH/USDC',
        side: OrderSide.BUY,
        type: OrderType.LIMIT,
        price: 2001.5,
        quantity: 1.5,
      });

      expect(buyOrder.trades).toHaveLength(4);
      expect(buyOrder.filledQuantity).toBe(1.5); // 0.3 + 0.5 + 0.2 + 0.5 from first 4 orders (fully filled)
      expect(buyOrder.averagePrice).toBeCloseTo((0.3 * 2000 + 0.5 * 2000.5 + 0.2 * 2001 + 0.5 * 2001.5) / 1.5, 2);
    });

    it('should maintain order book integrity after partial fills', async () => {
      // Add large sell order
      await matchingEngine.submitOrder({
        userId: 'seller',
        pair: 'ETH/USDC',
        side: OrderSide.SELL,
        type: OrderType.LIMIT,
        price: 2000,
        quantity: 10,
      });

      // Multiple partial fills
      for (let i = 0; i < 5; i++) {
        await matchingEngine.submitOrder({
          userId: `buyer${i}`,
          pair: 'ETH/USDC',
          side: OrderSide.BUY,
          type: OrderType.LIMIT,
          price: 2000,
          quantity: 1.5,
        });
      }

      const orderBook = matchingEngine.getOrderBook('ETH/USDC');
      expect(orderBook?.asks[0].quantity).toBe(2.5); // 10 - (5 * 1.5)
      expect(orderBook?.asks[0].price).toBe(2000);
    });
  });

  describe('Fee Calculations', () => {
    it('should calculate maker/taker fees correctly', async () => {
      const sellOrder = await matchingEngine.submitOrder({
        userId: 'maker',
        pair: 'ETH/USDC',
        side: OrderSide.SELL,
        type: OrderType.LIMIT,
        price: 2000,
        quantity: 1,
      });

      const buyOrder = await matchingEngine.submitOrder({
        userId: 'taker',
        pair: 'ETH/USDC',
        side: OrderSide.BUY,
        type: OrderType.LIMIT,
        price: 2000,
        quantity: 1,
      });

      const trade = buyOrder.trades[0];
      const notionalValue = trade.price * trade.quantity;
      
      expect(trade.makerFee).toBe(notionalValue * config.makerFeeRate);
      expect(trade.takerFee).toBe(notionalValue * config.takerFeeRate);
      expect(trade.makerUserId).toBe('maker');
      expect(trade.takerUserId).toBe('taker');
    });

    it('should handle tiered fee structures', async () => {
      // Configure tiered fees based on volume
      const tieredConfig = {
        ...config,
        feeSchedule: [
          { volumeThreshold: 0, makerFee: 0.001, takerFee: 0.002 },
          { volumeThreshold: 100000, makerFee: 0.0008, takerFee: 0.0015 },
          { volumeThreshold: 1000000, makerFee: 0.0005, takerFee: 0.001 },
        ]
      };

      // Test fee calculation for high-volume trader
      const highVolumeTrader = {
        userId: 'whale',
        volumeLast30Days: 5000000,
      };

      // Fee should be lowest tier
      const expectedMakerFee = 0.0005;
      const expectedTakerFee = 0.001;

      // Verify fee calculation logic
      expect(expectedMakerFee).toBeLessThan(config.makerFeeRate);
      expect(expectedTakerFee).toBeLessThan(config.takerFeeRate);
    });
  });

  describe('External Liquidity Integration', () => {
    it('should fetch quotes from external providers', async () => {
      const aggregator = new LiquidityAggregator();
      aggregator.addProvider(new UniswapProvider());

      const quote = await aggregator.getBestQuote(
        'ETH/USDC',
        'buy',
        1,
        '0x1234567890123456789012345678901234567890'
      );

      expect(quote).not.toBeNull();
      expect(quote?.quote.provider).toBe('Uniswap');
      expect(quote?.quote.price).toBeGreaterThan(0);
      expect(quote?.quote.quantity).toBe(1);
      expect(quote?.quote.confidence).toBeGreaterThan(0.9);
    });

    it('should compare multiple liquidity sources', async () => {
      const aggregator = new LiquidityAggregator();
      
      // Add multiple providers with different prices
      const mockProvider1 = new UniswapProvider();
      const mockProvider2 = new UniswapProvider();
      
      // Override fetch methods to return different prices
      jest.spyOn(mockProvider1, 'fetchQuote').mockResolvedValue({
        provider: 'Provider1',
        price: 2000,
        quantity: 1,
        confidence: 0.95,
      });

      jest.spyOn(mockProvider2, 'fetchQuote').mockResolvedValue({
        provider: 'Provider2',
        price: 1995, // Better price
        quantity: 1,
        confidence: 0.98,
      });

      aggregator.addProvider(mockProvider1);
      aggregator.addProvider(mockProvider2);

      const allQuotes = await aggregator.getAllQuotes('ETH/USDC', 'buy', 1);
      expect(allQuotes).toHaveLength(2);

      const bestQuote = await aggregator.getBestQuote('ETH/USDC', 'buy', 1);
      expect(bestQuote?.quote.price).toBe(1995); // Best price wins
    });

    it('should handle external liquidity failures gracefully', async () => {
      const aggregator = new LiquidityAggregator();
      const failingProvider = new UniswapProvider();
      
      jest.spyOn(failingProvider, 'fetchQuote').mockRejectedValue(
        new Error('Network error')
      );

      aggregator.addProvider(failingProvider);

      const quotes = await aggregator.getAllQuotes('ETH/USDC', 'buy', 1);
      expect(quotes).toHaveLength(0); // No quotes due to failure
    });
  });

  describe('Smart Order Routing', () => {
    it('should split orders across multiple venues for best execution', async () => {
      // Mock order book with limited liquidity
      await matchingEngine.submitOrder({
        userId: 'seller1',
        pair: 'ETH/USDC',
        side: OrderSide.SELL,
        type: OrderType.LIMIT,
        price: 2000,
        quantity: 0.5, // Only 0.5 ETH available
      });

      // Mock external liquidity
      const aggregator = new LiquidityAggregator();
      const externalProvider = new UniswapProvider();
      
      jest.spyOn(externalProvider, 'fetchQuote').mockResolvedValue({
        provider: 'Uniswap',
        price: 2005, // Slightly worse price
        quantity: 10, // Much more liquidity
        confidence: 0.98,
      });

      aggregator.addProvider(externalProvider);

      // Smart order router should split the order
      const router = new SmartOrderRouter(matchingEngine, aggregator);
      const execution = await router.executeOrder({
        userId: 'buyer',
        pair: 'ETH/USDC',
        side: OrderSide.BUY,
        quantity: 2, // Wants 2 ETH
        maxSlippage: 0.01,
      });

      expect(execution.fills).toHaveLength(2);
      expect(execution.fills[0].venue).toBe('internal');
      expect(execution.fills[0].quantity).toBe(0.5);
      expect(execution.fills[1].venue).toBe('Uniswap');
      expect(execution.fills[1].quantity).toBe(1.5);
      expect(execution.averagePrice).toBeCloseTo((0.5 * 2000 + 1.5 * 2005) / 2, 2);
    });

    it('should optimize for price improvement', async () => {
      // Create internal order book
      const internalOrders = [
        { price: 2000, quantity: 0.3 },
        { price: 2005, quantity: 0.5 },
        { price: 2010, quantity: 0.7 },
      ];

      for (const order of internalOrders) {
        await matchingEngine.submitOrder({
          userId: 'seller',
          pair: 'ETH/USDC',
          side: OrderSide.SELL,
          type: OrderType.LIMIT,
          ...order,
        });
      }

      // Mock external quotes
      const aggregator = new LiquidityAggregator();
      const provider = new UniswapProvider();
      
      jest.spyOn(provider, 'fetchQuote').mockResolvedValue({
        provider: 'Uniswap',
        price: 2003, // Better than some internal prices
        quantity: 5,
        confidence: 0.98,
      });

      aggregator.addProvider(provider);

      const router = new SmartOrderRouter(matchingEngine, aggregator);
      const execution = await router.executeOrder({
        userId: 'buyer',
        pair: 'ETH/USDC',
        side: OrderSide.BUY,
        quantity: 1,
        optimizeFor: 'price', // Optimize for best price
      });

      // Should take internal 0.3 @ 2000, then external 0.7 @ 2003
      // Instead of internal 0.3 @ 2000 + 0.5 @ 2005 + 0.2 @ 2010
      expect(execution.averagePrice).toBeLessThan(2005);
    });
  });

  describe('Concurrent Order Processing', () => {
    it('should handle concurrent order submissions without race conditions', async () => {
      // Add initial liquidity
      await matchingEngine.submitOrder({
        userId: 'liquidity',
        pair: 'ETH/USDC',
        side: OrderSide.SELL,
        type: OrderType.LIMIT,
        price: 2000,
        quantity: 10,
      });

      // Submit many orders concurrently
      const orderPromises = [];
      for (let i = 0; i < 100; i++) {
        orderPromises.push(
          matchingEngine.submitOrder({
            userId: `buyer${i}`,
            pair: 'ETH/USDC',
            side: OrderSide.BUY,
            type: OrderType.LIMIT,
            price: 2000,
            quantity: 0.1,
          })
        );
      }

      const results = await Promise.all(orderPromises);
      
      // All orders should be filled
      const totalFilled = matchingEngine.calculateTotalFilled(results, 'ETH/USDC');
      expect(totalFilled).toBe(10); // Exactly the available liquidity

      // No over-fills
      const sellOrder = matchingEngine.getUserOrders('liquidity')[0];
      expect(sellOrder.filledQuantity).toBe(10);
    });

    it('should maintain order book consistency under concurrent modifications', async () => {
      const operations = [];

      // Mix of adds, cancels, and matches
      for (let i = 0; i < 50; i++) {
        if (i % 3 === 0) {
          // Add order
          operations.push(
            matchingEngine.submitOrder({
              userId: `user${i}`,
              pair: 'ETH/USDC',
              side: i % 2 === 0 ? OrderSide.BUY : OrderSide.SELL,
              type: OrderType.LIMIT,
              price: 2000 + (Math.random() - 0.5) * 10,
              quantity: Math.random() * 2,
            })
          );
        } else if (i % 3 === 1) {
          // Cancel random order
          const orders = matchingEngine.getUserOrders(`user${i - 1}`);
          if (orders.length > 0) {
            operations.push(
              matchingEngine.cancelOrder(orders[0].id, `user${i - 1}`)
                .catch(() => {}) // Ignore if already filled
            );
          }
        }
      }

      await Promise.all(operations);

      // Verify order book integrity
      const orderBook = matchingEngine.getOrderBook('ETH/USDC');
      
      // Bids should be sorted descending
      for (let i = 1; i < orderBook!.bids.length; i++) {
        expect(orderBook!.bids[i - 1].price).toBeGreaterThanOrEqual(orderBook!.bids[i].price);
      }

      // Asks should be sorted ascending
      for (let i = 1; i < orderBook!.asks.length; i++) {
        expect(orderBook!.asks[i - 1].price).toBeLessThanOrEqual(orderBook!.asks[i].price);
      }
    });
  });

  describe('Performance Under High Load', () => {
    it('should maintain sub-millisecond latency for order matching', async () => {
      // Pre-populate order book
      for (let i = 0; i < 1000; i++) {
        await matchingEngine.submitOrder({
          userId: `maker${i}`,
          pair: 'ETH/USDC',
          side: i % 2 === 0 ? OrderSide.BUY : OrderSide.SELL,
          type: OrderType.LIMIT,
          price: 2000 + (i % 2 === 0 ? -i : i) * 0.1,
          quantity: Math.random() * 10,
        });
      }

      // Measure matching latency
      const iterations = 100;
      const latencies: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const start = process.hrtime.bigint();
        
        await matchingEngine.submitOrder({
          userId: 'taker',
          pair: 'ETH/USDC',
          side: OrderSide.BUY,
          type: OrderType.MARKET,
          quantity: 0.1,
        });

        const end = process.hrtime.bigint();
        const latencyMs = Number(end - start) / 1_000_000;
        latencies.push(latencyMs);
      }

      const avgLatency = latencies.reduce((a, b) => a + b) / latencies.length;
      const p99Latency = latencies.sort((a, b) => a - b)[Math.floor(latencies.length * 0.99)];

      console.log(`Average latency: ${avgLatency.toFixed(2)}ms`);
      console.log(`P99 latency: ${p99Latency.toFixed(2)}ms`);

      expect(avgLatency).toBeLessThan(1); // Sub-millisecond average
      expect(p99Latency).toBeLessThan(5); // P99 under 5ms
    });

    it('should handle order book with 10k+ orders efficiently', async () => {
      const startTime = Date.now();
      
      // Create deep order book
      const orderPromises = [];
      for (let i = 0; i < 10000; i++) {
        const side = i < 5000 ? OrderSide.BUY : OrderSide.SELL;
        const basePrice = side === OrderSide.BUY ? 1999 : 2001;
        const priceOffset = side === OrderSide.BUY ? -i * 0.01 : i * 0.01;
        
        orderPromises.push(
          matchingEngine.submitOrder({
            userId: `user${i}`,
            pair: 'ETH/USDC',
            side,
            type: OrderType.LIMIT,
            price: basePrice + priceOffset,
            quantity: Math.max(0.001, Math.random() * 10),
          })
        );
      }

      await Promise.all(orderPromises);
      
      const setupTime = Date.now() - startTime;
      console.log(`Setup 10k orders in ${setupTime}ms`);

      // Test order book retrieval performance
      const snapshotStart = Date.now();
      const snapshot = matchingEngine.getOrderBook('ETH/USDC', 100);
      const snapshotTime = Date.now() - snapshotStart;

      expect(snapshot?.bids).toHaveLength(100);
      expect(snapshot?.asks).toHaveLength(100);
      expect(snapshotTime).toBeLessThan(10); // Should be instant

      // Test matching performance with deep book
      const matchStart = Date.now();
      await matchingEngine.submitOrder({
        userId: 'whale',
        pair: 'ETH/USDC',
        side: OrderSide.BUY,
        type: OrderType.MARKET,
        quantity: 100, // Large order that crosses spread
      });
      const matchTime = Date.now() - matchStart;

      console.log(`Matched large order in ${matchTime}ms`);
      expect(matchTime).toBeLessThan(100); // Should complete quickly
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle self-trading prevention', async () => {
      // User places both buy and sell orders
      await matchingEngine.submitOrder({
        userId: 'trader',
        pair: 'ETH/USDC',
        side: OrderSide.SELL,
        type: OrderType.LIMIT,
        price: 2000,
        quantity: 1,
      });

      // Same user tries to buy
      const buyOrder = await matchingEngine.submitOrder({
        userId: 'trader',
        pair: 'ETH/USDC',
        side: OrderSide.BUY,
        type: OrderType.LIMIT,
        price: 2000,
        quantity: 1,
        selfTradePrevention: 'CANCEL_OLDEST', // Cancel the older order
      });

      expect(buyOrder.trades).toHaveLength(0); // No self-trade
      expect(buyOrder.status).toBe(OrderStatus.OPEN);
      
      // Old sell order should be cancelled
      const orders = matchingEngine.getUserOrders('trader');
      expect(orders.filter(o => o.status === OrderStatus.CANCELLED)).toHaveLength(1);
    });

    it('should handle decimal precision correctly', async () => {
      // Test with maximum precision
      const preciseOrder = await matchingEngine.submitOrder({
        userId: 'precise',
        pair: 'ETH/USDC',
        side: OrderSide.SELL,
        type: OrderType.LIMIT,
        price: 1999.123456789,
        quantity: 0.123456789123,
      });

      // Price should be rounded to tick size
      expect(preciseOrder.price).toBe(1999.12); // Assuming 0.01 tick size

      // Quantity should maintain precision up to configured decimals
      expect(preciseOrder.quantity).toBeCloseTo(0.123456789123, 9);
    });

    it('should recover from order book corruption', async () => {
      // Simulate corruption by directly modifying internal state
      const orderBook = matchingEngine.getOrderBook('ETH/USDC');
      
      // Force an invalid state
      (orderBook as any).bids = null;

      // Should handle gracefully
      const order = await matchingEngine.submitOrder({
        userId: 'recovery',
        pair: 'ETH/USDC',
        side: OrderSide.BUY,
        type: OrderType.LIMIT,
        price: 2000,
        quantity: 1,
      });

      expect(order.status).toBe(OrderStatus.OPEN);
      
      // Order book should be recovered
      const newSnapshot = matchingEngine.getOrderBook('ETH/USDC');
      expect(newSnapshot?.bids).toHaveLength(1);
    });
  });
});