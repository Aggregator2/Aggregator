/**
 * Example: How to use the comprehensive test suite
 * 
 * This file demonstrates how to write and run tests for the trading system
 */

import { MatchingEngine } from '../src/services/matchingEngine/MatchingEngine';
import { FinalSettlementEngine } from '../src/services/settlement/FinalSettlementEngine';
import { OrderType, OrderSide, OrderStatus } from '../src/services/matchingEngine/types';
import { ethers } from 'ethers';

// Example 1: Testing order matching
async function testOrderMatching() {
  const config = {
    maxOrderBookDepth: 1000,
    minOrderSize: { 'ETH/USDC': 0.001 },
    maxOrderSize: { 'ETH/USDC': 1000 },
    tickSize: { 'ETH/USDC': 0.01 },
    makerFeeRate: 0.001,
    takerFeeRate: 0.002,
    enableStopOrders: true,
    enableIcebergOrders: true,
  };

  const engine = new MatchingEngine(config);
  engine.initializePair('ETH/USDC');

  // Submit a sell order
  const sellOrder = await engine.submitOrder({
    userId: 'alice',
    pair: 'ETH/USDC',
    side: OrderSide.SELL,
    type: OrderType.LIMIT,
    price: 2000,
    quantity: 1,
  });

  console.log('Sell order placed:', sellOrder);

  // Submit a matching buy order
  const buyOrder = await engine.submitOrder({
    userId: 'bob',
    pair: 'ETH/USDC',
    side: OrderSide.BUY,
    type: OrderType.LIMIT,
    price: 2000,
    quantity: 1,
  });

  console.log('Buy order matched:', buyOrder);
  console.log('Trade details:', buyOrder.trades[0]);
}

// Example 2: Testing settlement
async function testSettlement() {
  const provider = new ethers.JsonRpcProvider('http://localhost:8545');
  const privateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  
  const settlementEngine = new FinalSettlementEngine(
    provider,
    privateKey,
    '0x5FbDB2315678afecb367f032d93F642f64180aa3',
    60000 // 1 minute epochs
  );

  // Add a trade
  const trade = {
    id: 'trade1',
    pair: 'ETH/USDC',
    price: 2000,
    quantity: 1,
    filledQuantity: 1,
    side: OrderSide.BUY,
    type: OrderType.LIMIT,
    status: OrderStatus.FILLED,
    timestamp: Date.now(),
    buyerId: 'alice',
    sellerId: 'bob',
    buyOrderId: 'buy1',
    sellOrderId: 'sell1',
    buyerFee: 2, // 0.1% of 2000
    sellerFee: 4, // 0.2% of 2000
    makerOrderId: 'sell1',
    takerOrderId: 'buy1',
    makerUserId: 'bob',
    takerUserId: 'alice',
    makerFee: 2,
    takerFee: 4,
  };

  settlementEngine.addTrade(trade);
  console.log('Trade added to settlement engine');

  // Listen for settlement events
  settlementEngine.on('epochFinalized', (epoch) => {
    console.log('Epoch finalized:', epoch);
  });
}

// Example 3: Running performance tests
async function runPerformanceTest() {
  const { TradingSystemStressTest } = require('./performance/stress-test');
  const stressTest = new TradingSystemStressTest();

  console.log('Running performance test...');
  
  const result = await stressTest.runStressTest({
    duration: 10, // 10 seconds
    ordersPerSecond: 100,
    userCount: 50,
    orderDistribution: {
      market: 20,
      limit: 75,
      stop: 5,
    },
  });

  console.log('Performance test results:', result);
}

// Example 4: Testing external liquidity
async function testExternalLiquidity() {
  const { LiquidityAggregator, UniswapProvider } = require('../src/services/matchingEngine/ExternalLiquidityProvider');
  
  const aggregator = new LiquidityAggregator();
  aggregator.addProvider(new UniswapProvider());

  const quote = await aggregator.getBestQuote(
    'ETH/USDC',
    'buy',
    1,
    '0x1234567890123456789012345678901234567890'
  );

  console.log('Best external quote:', quote);
}

// Main execution
if (require.main === module) {
  (async () => {
    console.log('=== Trading System Test Examples ===\n');
    
    console.log('1. Testing Order Matching...');
    await testOrderMatching();
    
    console.log('\n2. Testing Settlement...');
    await testSettlement();
    
    console.log('\n3. Running Performance Test...');
    await runPerformanceTest();
    
    console.log('\n4. Testing External Liquidity...');
    await testExternalLiquidity();
    
    console.log('\n=== Tests Complete ===');
  })().catch(console.error);
}

export { testOrderMatching, testSettlement, runPerformanceTest, testExternalLiquidity };