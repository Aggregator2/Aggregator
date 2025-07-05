import { ethers } from 'ethers';
import { BalanceCheckService } from './BalanceCheckService';
import { BalanceAwareMatchingEngine } from '../matchingEngine/BalanceAwareMatchingEngine';
import { RiskManagementService } from '../riskManagement/RiskManagementService';
import { PositionManager } from '../riskManagement/PositionManager';
import { TradeSurveillanceService } from '../compliance/surveillance/TradeSurveillanceService';
import { OrderSide, OrderType, TimeInForce } from '../matchingEngine/types';

// Example setup for balance-aware trading system
async function setupBalanceAwareTradingSystem() {
  // 1. Configure provider and contracts
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || 'http://localhost:8545');
  const settlementContract = process.env.SETTLEMENT_CONTRACT || '0x1234567890123456789012345678901234567890';
  
  // 2. Create risk management service
  const positionManager = new PositionManager();
  const surveillanceService = new TradeSurveillanceService();
  const riskService = new RiskManagementService(
    {
      globalMaxLeverage: 10,
      defaultInitialMarginRate: 0.1,
      defaultMaintenanceMarginRate: 0.05,
      liquidationFeeRate: 0.002,
      insuranceFundContributionRate: 0.001,
      circuitBreakerEnabled: true,
      autoDeleveragingEnabled: true,
      marginCallWarningThreshold: 0.7,
      maxDrawdownPerUser: 0.5,
      riskFreeRate: 0.02
    },
    positionManager,
    surveillanceService
  );

  // 3. Configure token mappings
  const tokenMapping = {
    'ETH/USDC': {
      baseToken: 'NATIVE',
      quoteToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
      baseIsNative: true,
      quoteIsNative: false
    },
    'BTC/USDC': {
      baseToken: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', // WBTC
      quoteToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
      baseIsNative: false,
      quoteIsNative: false
    },
    'ETH/USDT': {
      baseToken: 'NATIVE',
      quoteToken: '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT
      baseIsNative: true,
      quoteIsNative: false
    }
  };

  // 4. Create balance-aware matching engine
  const matchingEngine = new BalanceAwareMatchingEngine(
    {
      // Matching engine config
      maxOrderBookDepth: 1000,
      minOrderSize: {
        'ETH/USDC': 0.001,
        'BTC/USDC': 0.00001,
        'ETH/USDT': 0.001
      },
      maxOrderSize: {
        'ETH/USDC': 1000,
        'BTC/USDC': 100,
        'ETH/USDT': 1000
      },
      tickSize: {
        'ETH/USDC': 0.01,
        'BTC/USDC': 0.1,
        'ETH/USDT': 0.01
      },
      makerFeeRate: 0.001,
      takerFeeRate: 0.002,
      enableStopOrders: false,
      enableIcebergOrders: false,
      
      // Risk config
      riskCheckEnabled: true,
      blockOnRejection: true,
      allowReviewOrders: true,
      riskCheckTimeout: 3000,
      
      // Balance config
      balanceCheckEnabled: true,
      rejectInsufficientBalance: true,
      rejectInsufficientAllowance: true,
      balanceCheckTimeout: 5000,
      settlementContract,
      tokenMapping
    },
    riskService,
    provider
  );

  // 5. Initialize trading pairs
  for (const pair of Object.keys(tokenMapping)) {
    matchingEngine.initializePair(pair, tokenMapping[pair].tickSize || 0.01);
  }

  // 6. Set up event listeners
  setupEventListeners(matchingEngine);

  return { matchingEngine, provider };
}

// Set up event listeners
function setupEventListeners(matchingEngine: BalanceAwareMatchingEngine) {
  // Balance events
  matchingEngine.on('balanceChecked', (data) => {
    console.log('💰 Balance checked:', {
      user: data.userAddress.slice(0, 8),
      token: data.validation.symbol,
      hasBalance: data.validation.hasBalance,
      hasAllowance: data.validation.hasAllowance
    });
  });

  matchingEngine.on('userBalanceChanged', (data) => {
    console.log('💱 Balance changed:', {
      user: data.userAddress.slice(0, 8),
      token: data.symbol,
      oldBalance: ethers.formatUnits(data.oldBalance, 18),
      newBalance: ethers.formatUnits(data.newBalance, 18)
    });
  });

  matchingEngine.on('orderAutoCancelled', (data) => {
    console.log('🚫 Order auto-cancelled:', {
      orderId: data.orderId,
      reason: data.reason,
      errors: data.errors
    });
  });

  // Order events
  matchingEngine.on('orderRejected', (data) => {
    console.log('❌ Order rejected:', {
      orderId: data.order.id,
      reason: data.reason,
      balanceErrors: data.balanceErrors
    });
  });

  matchingEngine.on('trade', (data) => {
    console.log('✅ Trade executed:', {
      id: data.trade.id,
      pair: data.trade.pair,
      price: data.trade.price,
      quantity: data.trade.quantity
    });
  });
}

// Example: Test balance validation scenarios
async function testBalanceValidationScenarios(
  matchingEngine: BalanceAwareMatchingEngine,
  provider: ethers.Provider
) {
  console.log('\n=== Testing Balance Validation Scenarios ===\n');

  // Test users
  const users = {
    alice: '0x1234567890123456789012345678901234567890',
    bob: '0x0987654321098765432109876543210987654321',
    charlie: '0x1111111111111111111111111111111111111111'
  };

  // Scenario 1: Sufficient balance and allowance
  console.log('1. Testing order with sufficient balance...');
  try {
    const result1 = await matchingEngine.submitOrder({
      userId: users.alice,
      pair: 'ETH/USDC',
      side: OrderSide.SELL,
      type: OrderType.LIMIT,
      price: 2500,
      quantity: 0.1, // Selling 0.1 ETH
      timeInForce: TimeInForce.GTC
    });
    console.log('✅ Order accepted:', result1.orderId);
  } catch (error) {
    console.log('❌ Order failed:', error.message);
  }

  // Scenario 2: Insufficient balance
  console.log('\n2. Testing order with insufficient balance...');
  try {
    const result2 = await matchingEngine.submitOrder({
      userId: users.bob,
      pair: 'ETH/USDC',
      side: OrderSide.BUY,
      type: OrderType.LIMIT,
      price: 2500,
      quantity: 1000, // Trying to buy 1000 ETH (needs 2.5M USDC)
      timeInForce: TimeInForce.GTC
    });
    console.log('Order result:', result2.message);
  } catch (error) {
    console.log('Expected rejection:', error.message);
  }

  // Scenario 3: Insufficient allowance
  console.log('\n3. Testing order with insufficient allowance...');
  try {
    const result3 = await matchingEngine.submitOrder({
      userId: users.charlie,
      pair: 'BTC/USDC',
      side: OrderSide.SELL,
      type: OrderType.LIMIT,
      price: 45000,
      quantity: 0.5, // Selling 0.5 BTC (needs allowance)
      timeInForce: TimeInForce.GTC
    });
    console.log('Order result:', result3.message);
  } catch (error) {
    console.log('Expected rejection:', error.message);
  }

  // Scenario 4: Market order with balance check
  console.log('\n4. Testing market order with balance check...');
  try {
    const result4 = await matchingEngine.submitOrder({
      userId: users.alice,
      pair: 'ETH/USDT',
      side: OrderSide.BUY,
      type: OrderType.MARKET,
      quantity: 0.05, // Buying 0.05 ETH at market price
      timeInForce: TimeInForce.IOC
    });
    console.log('✅ Market order result:', result4.orderId, result4.status);
  } catch (error) {
    console.log('Market order failed:', error.message);
  }
}

// Example: Demonstrate balance monitoring
async function demonstrateBalanceMonitoring(
  matchingEngine: BalanceAwareMatchingEngine,
  userAddress: string
) {
  console.log('\n=== Balance Monitoring Demo ===\n');

  // Get initial balances
  const balances = await matchingEngine.getUserBalances(userAddress, 'ETH/USDC');
  if (balances) {
    console.log('Initial balances:');
    console.log(`- ${balances.baseToken.symbol}: ${ethers.formatUnits(balances.baseToken.balance, balances.baseToken.decimals)}`);
    console.log(`- ${balances.quoteToken.symbol}: ${ethers.formatUnits(balances.quoteToken.balance, balances.quoteToken.decimals)}`);
  }

  // Start monitoring balances
  console.log('\nStarting balance monitoring (60s interval)...');
  const monitoringInterval = await matchingEngine.startBalanceMonitoring(
    userAddress,
    ['ETH/USDC', 'BTC/USDC'],
    60000 // Check every minute
  );

  // Simulate balance change after 5 seconds
  setTimeout(async () => {
    console.log('\nRefreshing balances...');
    await matchingEngine.refreshUserBalance(userAddress, 'NATIVE', true);
  }, 5000);

  // Stop monitoring after 2 minutes
  setTimeout(() => {
    clearInterval(monitoringInterval);
    console.log('\nStopped balance monitoring');
  }, 120000);
}

// Example: Auto-cancel orders with insufficient balance
async function demonstrateAutoCancellation(matchingEngine: BalanceAwareMatchingEngine) {
  console.log('\n=== Auto-Cancellation Demo ===\n');

  const userAddress = '0x1234567890123456789012345678901234567890';

  // Submit multiple orders
  const orderIds = [];
  for (let i = 0; i < 3; i++) {
    try {
      const result = await matchingEngine.submitOrder({
        userId: userAddress,
        pair: 'ETH/USDC',
        side: OrderSide.BUY,
        type: OrderType.LIMIT,
        price: 2400 + i * 10, // Different prices
        quantity: 0.1,
        timeInForce: TimeInForce.GTC
      });
      orderIds.push(result.orderId);
      console.log(`Order ${i + 1} submitted:`, result.orderId);
    } catch (error) {
      console.error('Failed to submit order:', error.message);
    }
  }

  // Simulate balance change (user spends their USDC elsewhere)
  console.log('\nSimulating balance reduction...');
  
  // Check and cancel orders with insufficient balance
  const cancelledOrders = await matchingEngine.checkAndCancelInsufficientOrders(userAddress);
  console.log(`\nAuto-cancelled ${cancelledOrders.length} orders:`, cancelledOrders);
}

// Example: Balance caching demonstration
async function demonstrateBalanceCaching(provider: ethers.Provider) {
  console.log('\n=== Balance Caching Demo ===\n');

  const balanceService = new BalanceCheckService({
    provider,
    settlementContract: '0x1234567890123456789012345678901234567890',
    cacheTTL: 30000 // 30 seconds
  });

  const userAddress = '0x1234567890123456789012345678901234567890';
  const usdcAddress = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

  // First call - hits the blockchain
  console.time('First balance check');
  const balance1 = await balanceService.getTokenBalance(userAddress, usdcAddress);
  console.timeEnd('First balance check');
  console.log('Balance:', ethers.formatUnits(balance1.balance, balance1.decimals), balance1.symbol);

  // Second call - uses cache
  console.time('Second balance check (cached)');
  const balance2 = await balanceService.getTokenBalance(userAddress, usdcAddress);
  console.timeEnd('Second balance check (cached)');

  // Check cache stats
  const cacheStats = balanceService.getCacheStats();
  console.log('\nCache stats:', {
    size: cacheStats.size,
    entries: cacheStats.entries.map(e => ({
      key: e.key,
      age: `${(e.age / 1000).toFixed(1)}s`
    }))
  });

  // Wait for cache to expire
  console.log('\nWaiting 31 seconds for cache to expire...');
  await new Promise(resolve => setTimeout(resolve, 31000));

  // Third call - cache expired, hits blockchain again
  console.time('Third balance check (cache expired)');
  const balance3 = await balanceService.getTokenBalance(userAddress, usdcAddress);
  console.timeEnd('Third balance check (cache expired)');
}

// Main execution
async function main() {
  try {
    // Set up the system
    const { matchingEngine, provider } = await setupBalanceAwareTradingSystem();
    
    // Run test scenarios
    await testBalanceValidationScenarios(matchingEngine, provider);
    
    // Demonstrate balance monitoring
    const testUser = '0x1234567890123456789012345678901234567890';
    await demonstrateBalanceMonitoring(matchingEngine, testUser);
    
    // Demonstrate auto-cancellation
    await demonstrateAutoCancellation(matchingEngine);
    
    // Demonstrate caching
    await demonstrateBalanceCaching(provider);
    
  } catch (error) {
    console.error('System error:', error);
  }
}

// Export for use in other modules
export {
  setupBalanceAwareTradingSystem,
  testBalanceValidationScenarios,
  demonstrateBalanceMonitoring,
  demonstrateAutoCancellation,
  demonstrateBalanceCaching
};

// Run if executed directly
if (require.main === module) {
  main().catch(console.error);
}