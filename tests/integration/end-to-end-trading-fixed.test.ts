import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, jest } from '@jest/globals';
import { ethers } from 'ethers';
import { MatchingEngine } from '../../src/services/matchingEngine/MatchingEngine';
import { FinalSettlementEngine } from '../../src/services/settlement/FinalSettlementEngine';
import { ExternalLiquidityProvider, LiquidityAggregator } from '../../src/services/matchingEngine/ExternalLiquidityProvider';
import { SmartOrderRouter } from '../../src/services/matchingEngine/SmartOrderRouter';
import { BalanceCheckService } from '../../src/services/balanceManager/BalanceCheckService';
import {
  OrderType,
  OrderSide,
  OrderStatus,
  TimeInForce,
  MatchingEngineConfig,
} from '../../src/services/matchingEngine/types';
import { 
  setupTestInfrastructure, 
  deployMockSettlementContract,
  mockBalance,
  TestInfrastructure 
} from '../setup/testHelpers';

describe('End-to-End Trading Integration Tests (Fixed)', () => {
  let infrastructure: TestInfrastructure;
  let matchingEngine: MatchingEngine;
  let settlementEngine: FinalSettlementEngine;
  let liquidityAggregator: LiquidityAggregator;
  let smartOrderRouter: SmartOrderRouter;
  let balanceService: BalanceCheckService;
  let settlementContractAddress: string;
  
  const matchingConfig: MatchingEngineConfig = {
    maxOrderBookDepth: 1000,
    minOrderSize: { 'ETH/USDC': 0.001 },
    maxOrderSize: { 'ETH/USDC': 1000 },
    tickSize: { 'ETH/USDC': 0.01 },
    makerFeeRate: 0.001,
    takerFeeRate: 0.002,
    enableStopOrders: true,
    enableIcebergOrders: true,
  };

  beforeAll(async () => {
    // Setup test infrastructure once
    infrastructure = await setupTestInfrastructure();
    
    // Deploy mock settlement contract
    settlementContractAddress = await deployMockSettlementContract(infrastructure.signer);
  });

  beforeEach(async () => {
    // Initialize all services
    matchingEngine = new MatchingEngine(matchingConfig);
    matchingEngine.initializePair('ETH/USDC');
    
    settlementEngine = new FinalSettlementEngine(
      infrastructure.provider,
      infrastructure.signer.privateKey,
      settlementContractAddress,
      60000 // 1 minute epochs
    );
    
    liquidityAggregator = new LiquidityAggregator();
    smartOrderRouter = new SmartOrderRouter(matchingEngine, liquidityAggregator);
    
    // Create a mock balance service that returns test balances
    balanceService = {
      checkBalance: jest.fn().mockImplementation(async (userId: string, token: string, address: string) => {
        return mockBalance(token, userId);
      }),
      getBalances: jest.fn().mockImplementation(async (userId: string, tokens: string[], address: string) => {
        const balances: Record<string, bigint> = {};
        for (const token of tokens) {
          balances[token] = mockBalance(token, userId);
        }
        return balances;
      })
    } as any;
    
    // Set up proper error handling
    matchingEngine.on('error', (error) => {
      console.error('MatchingEngine error in test:', error);
    });
    
    settlementEngine.on('error', (error) => {
      console.error('SettlementEngine error in test:', error);
    });
    
    settlementEngine.on('systemFailure', (data) => {
      console.error('SettlementEngine system failure in test:', data);
    });
    
    // Connect services with error handling
    matchingEngine.on('trade', (trade) => {
      try {
        settlementEngine.addTrade(trade);
      } catch (error) {
        console.error('Failed to add trade to settlement engine:', error);
      }
    });
    
    // Wait for services to be ready
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  afterEach(async () => {
    try {
      // Graceful shutdown of services
      await settlementEngine.shutdown();
      matchingEngine.clear();
      
      // Clear aggregator providers
      if (liquidityAggregator.clearProviders) {
        liquidityAggregator.clearProviders();
      }
      
      // Wait for cleanup to complete
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      console.error('Error during test cleanup:', error);
    }
  });

  afterAll(async () => {
    // Cleanup infrastructure
    await infrastructure.cleanup();
  });

  describe('Complete Trade Lifecycle', () => {
    it('should execute order → match → settle flow successfully', async () => {
      // Step 1: Check balances (mocked)
      const user1Balance = await balanceService.checkBalance(
        'user1',
        'USDC',
        '0x1234567890123456789012345678901234567890'
      );
      expect(user1Balance).toBeGreaterThanOrEqual(2000e6); // Needs 2000 USDC

      const user2Balance = await balanceService.checkBalance(
        'user2',
        'ETH',
        '0x2345678901234567890123456789012345678901'
      );
      expect(user2Balance).toBeGreaterThanOrEqual(1e18); // Needs 1 ETH

      // Step 2: Submit orders
      const sellOrder = await matchingEngine.submitOrder({
        userId: 'user2',
        pair: 'ETH/USDC',
        side: OrderSide.SELL,
        type: OrderType.LIMIT,
        price: 2000,
        quantity: 1,
      });

      expect(sellOrder.status).toBe(OrderStatus.OPEN);

      const buyOrder = await matchingEngine.submitOrder({
        userId: 'user1',
        pair: 'ETH/USDC',
        side: OrderSide.BUY,
        type: OrderType.LIMIT,
        price: 2000,
        quantity: 1,
      });

      // Step 3: Verify matching
      expect(buyOrder.status).toBe(OrderStatus.FILLED);
      expect(buyOrder.trades).toHaveLength(1);
      expect(buyOrder.trades[0].price).toBe(2000);
      expect(buyOrder.trades[0].quantity).toBe(1);

      // Step 4: Get current epoch ID and wait for settlement
      const currentState = settlementEngine.getState();
      const currentEpochId = currentState.currentEpoch?.id;
      expect(currentEpochId).toBeDefined();

      // Force finalize the current epoch for testing
      const finalizedEpoch = await settlementEngine.forceFinalize();
      expect(finalizedEpoch).toBeDefined();

      // Wait for epoch completion with timeout
      const completedEpoch = await settlementEngine.waitForEpochCompletion(
        finalizedEpoch!.id, 
        30000 // 30 second timeout
      );

      // Step 5: Verify settlement
      expect(completedEpoch).toBeDefined();
      expect(completedEpoch.status).toBe('COMPLETED');
      expect(completedEpoch.trades).toHaveLength(1);
      expect(completedEpoch.settlementBatch).toBeDefined();
      
      // Verify net positions
      const netPositions = completedEpoch.settlementBatch!.netPositions;
      expect(netPositions.has('user1')).toBe(true);
      expect(netPositions.has('user2')).toBe(true);
      
      // Check individual net positions
      const user1Positions = netPositions.get('user1');
      const user2Positions = netPositions.get('user2');
      
      expect(user1Positions?.has('ETH')).toBe(true);
      expect(user1Positions?.has('USDC')).toBe(true);
      expect(user2Positions?.has('ETH')).toBe(true);
      expect(user2Positions?.has('USDC')).toBe(true);
    });

    it('should handle complex multi-user trading session', async () => {
      const users = ['alice', 'bob', 'charlie', 'david', 'eve'];
      const orders = [];
      const trades = [];

      // Create a trading session with multiple orders
      // Alice and Bob provide liquidity
      orders.push(await matchingEngine.submitOrder({
        userId: 'alice',
        pair: 'ETH/USDC',
        side: OrderSide.SELL,
        type: OrderType.LIMIT,
        price: 2010,
        quantity: 5,
      }));

      orders.push(await matchingEngine.submitOrder({
        userId: 'bob',
        pair: 'ETH/USDC',
        side: OrderSide.BUY,
        type: OrderType.LIMIT,
        price: 1990,
        quantity: 5,
      }));

      // Charlie takes liquidity from Alice
      const charlieOrder = await matchingEngine.submitOrder({
        userId: 'charlie',
        pair: 'ETH/USDC',
        side: OrderSide.BUY,
        type: OrderType.LIMIT,
        price: 2010,
        quantity: 2,
      });

      expect(charlieOrder.status).toBe(OrderStatus.FILLED);
      trades.push(...charlieOrder.trades);

      // David takes liquidity from Bob
      const davidOrder = await matchingEngine.submitOrder({
        userId: 'david',
        pair: 'ETH/USDC',
        side: OrderSide.SELL,
        type: OrderType.LIMIT,
        price: 1990,
        quantity: 3,
      });

      expect(davidOrder.status).toBe(OrderStatus.FILLED);
      trades.push(...davidOrder.trades);

      // Eve places market order
      const eveOrder = await matchingEngine.submitOrder({
        userId: 'eve',
        pair: 'ETH/USDC',
        side: OrderSide.BUY,
        type: OrderType.MARKET,
        quantity: 1,
      });

      expect(eveOrder.status).toBe(OrderStatus.FILLED);
      trades.push(...eveOrder.trades);

      // Verify all trades
      expect(trades.length).toBeGreaterThan(0);
      
      // Check order book state
      const orderBook = matchingEngine.getOrderBook('ETH/USDC');
      expect(orderBook).toBeDefined();
      
      // Alice should have 2 ETH left to sell (5 - 2 - 1)
      const aliceRemainingOrders = matchingEngine.getUserOrders('alice', 'ETH/USDC', OrderStatus.PARTIALLY_FILLED);
      expect(aliceRemainingOrders[0]?.quantity - aliceRemainingOrders[0]?.filledQuantity).toBe(2);

      // Bob should have 2 ETH left to buy (5 - 3)
      const bobRemainingOrders = matchingEngine.getUserOrders('bob', 'ETH/USDC', OrderStatus.PARTIALLY_FILLED);
      expect(bobRemainingOrders[0]?.quantity - bobRemainingOrders[0]?.filledQuantity).toBe(2);
    });
  });

  describe('External Liquidity Fallback', () => {
    it('should use external liquidity when internal liquidity insufficient', async () => {
      // Mock external provider
      const mockProvider = {
        getName: () => 'MockDEX',
        supportsPair: () => true,
        fetchQuote: jest.fn().mockResolvedValue({
          provider: 'MockDEX',
          price: 2005,
          quantity: 10,
          confidence: 0.95,
        }),
        execute: jest.fn().mockResolvedValue({
          provider: 'MockDEX',
          status: 'completed',
          txHash: '0xmocktx',
          executedQuantity: 3,
          executedPrice: 2005,
        }),
        getQuote: jest.fn().mockImplementation(async (pair, side, quantity) => {
          return {
            provider: 'MockDEX',
            price: 2005,
            quantity: quantity,
            confidence: 0.95,
          };
        }),
        on: jest.fn(),
        removeAllListeners: jest.fn(),
      };

      liquidityAggregator.addProvider(mockProvider as any);

      // Add limited internal liquidity
      await matchingEngine.submitOrder({
        userId: 'seller',
        pair: 'ETH/USDC',
        side: OrderSide.SELL,
        type: OrderType.LIMIT,
        price: 2000,
        quantity: 1, // Only 1 ETH available internally
      });

      // Try to buy more than available
      const routerExecution = await smartOrderRouter.executeOrder({
        userId: 'buyer',
        pair: 'ETH/USDC',
        side: OrderSide.BUY,
        quantity: 4, // Want 4 ETH total
        maxSlippage: 0.01,
      });

      expect(routerExecution.fills).toHaveLength(2);
      expect(routerExecution.fills[0].venue).toBe('internal');
      expect(routerExecution.fills[0].quantity).toBe(1);
      expect(routerExecution.fills[1].venue).toBe('MockDEX');
      expect(routerExecution.fills[1].quantity).toBe(3);
      expect(routerExecution.totalQuantity).toBe(4);
    });

    it('should handle external liquidity provider failures', async () => {
      const failingProvider = {
        getName: () => 'FailingDEX',
        supportsPair: () => true,
        fetchQuote: jest.fn().mockRejectedValue(new Error('API timeout')),
        getQuote: jest.fn().mockRejectedValue(new Error('API timeout')),
        on: jest.fn(),
        removeAllListeners: jest.fn(),
      };

      const workingProvider = {
        getName: () => 'WorkingDEX',
        supportsPair: () => true,
        fetchQuote: jest.fn().mockResolvedValue({
          provider: 'WorkingDEX',
          price: 2010,
          quantity: 5,
          confidence: 0.9,
        }),
        execute: jest.fn().mockResolvedValue({
          provider: 'WorkingDEX',
          status: 'completed',
          executedQuantity: 2,
          executedPrice: 2010,
        }),
        getQuote: jest.fn().mockImplementation(async (pair, side, quantity) => {
          return {
            provider: 'WorkingDEX',
            price: 2010,
            quantity: quantity,
            confidence: 0.9,
          };
        }),
        on: jest.fn(),
        removeAllListeners: jest.fn(),
      };

      liquidityAggregator.addProvider(failingProvider as any);
      liquidityAggregator.addProvider(workingProvider as any);

      // No internal liquidity
      const routerExecution = await smartOrderRouter.executeOrder({
        userId: 'buyer',
        pair: 'ETH/USDC',
        side: OrderSide.BUY,
        quantity: 2,
        maxSlippage: 0.02,
      });

      // Should use working provider despite one failure
      expect(routerExecution.fills).toHaveLength(1);
      expect(routerExecution.fills[0].venue).toBe('WorkingDEX');
      expect(failingProvider.getQuote).toHaveBeenCalled();
      expect(workingProvider.execute).toHaveBeenCalled();
    });
  });

  describe('Error Recovery', () => {
    it('should recover from matching engine failures', async () => {
      // Simulate order book corruption
      const corruptOrder = {
        userId: 'hacker',
        pair: 'ETH/USDC',
        side: 'INVALID_SIDE' as any,
        type: OrderType.LIMIT,
        price: -1000, // Invalid price
        quantity: 0, // Invalid quantity
      };

      await expect(matchingEngine.submitOrder(corruptOrder))
        .rejects.toThrow();

      // Engine should still be functional
      const validOrder = await matchingEngine.submitOrder({
        userId: 'valid_user',
        pair: 'ETH/USDC',
        side: OrderSide.BUY,
        type: OrderType.LIMIT,
        price: 2000,
        quantity: 1,
      });

      expect(validOrder.status).toBe(OrderStatus.OPEN);
    });
  });
});