import { RiskAwareMatchingEngine } from '../matchingEngine/RiskAwareMatchingEngine';
import { RiskManagementService } from './RiskManagementService';
import { PositionManager } from './PositionManager';
import { TradeSurveillanceService } from '../compliance/surveillance/TradeSurveillanceService';
import { RiskConfig } from './types';
import { OrderSide, OrderType, TimeInForce } from '../matchingEngine/types';

// Example setup for Risk-Aware Trading System
async function setupRiskAwareTradingSystem() {
  // 1. Configure risk management
  const riskConfig: RiskConfig = {
    globalMaxLeverage: 10,
    defaultInitialMarginRate: 0.1, // 10%
    defaultMaintenanceMarginRate: 0.05, // 5%
    liquidationFeeRate: 0.002, // 0.2%
    insuranceFundContributionRate: 0.001, // 0.1%
    circuitBreakerEnabled: true,
    autoDeleveragingEnabled: true,
    marginCallWarningThreshold: 0.7, // 70%
    maxDrawdownPerUser: 0.5, // 50%
    riskFreeRate: 0.02 // 2%
  };

  // 2. Create risk management components
  const positionManager = new PositionManager();
  const surveillanceService = new TradeSurveillanceService();
  const riskService = new RiskManagementService(
    riskConfig,
    positionManager,
    surveillanceService
  );

  // 3. Create risk-aware matching engine
  const matchingEngine = new RiskAwareMatchingEngine(
    {
      // Matching engine config
      maxOrderBookDepth: 1000,
      minOrderSize: {
        'ETH/USDC': 0.001,
        'BTC/USDC': 0.00001
      },
      maxOrderSize: {
        'ETH/USDC': 1000,
        'BTC/USDC': 100
      },
      tickSize: {
        'ETH/USDC': 0.01,
        'BTC/USDC': 0.1
      },
      makerFeeRate: 0.001,
      takerFeeRate: 0.002,
      enableStopOrders: false,
      enableIcebergOrders: false,
      
      // Risk config
      riskCheckEnabled: true,
      blockOnRejection: true,
      allowReviewOrders: true,
      riskCheckTimeout: 3000 // 3 seconds
    },
    riskService
  );

  // 4. Initialize trading pairs
  matchingEngine.initializePair('ETH/USDC', 0.01);
  matchingEngine.initializePair('BTC/USDC', 0.1);

  // 5. Set up event listeners
  setupEventListeners(matchingEngine, riskService);

  return { matchingEngine, riskService };
}

// Set up event listeners for monitoring
function setupEventListeners(matchingEngine: RiskAwareMatchingEngine, riskService: RiskManagementService) {
  // Order events
  matchingEngine.on('orderRejected', (data) => {
    console.log('❌ Order Rejected:', {
      orderId: data.order.id,
      userId: data.order.userId,
      reason: data.reason,
      errors: data.riskErrors
    });
  });

  matchingEngine.on('orderPendingReview', (data) => {
    console.log('⚠️  Order Pending Review:', {
      orderId: data.order.id,
      userId: data.order.userId,
      warnings: data.riskWarnings
    });
  });

  matchingEngine.on('orderReviewApproved', (data) => {
    console.log('✅ Order Review Approved:', {
      orderId: data.order.id,
      approverId: data.approverId
    });
  });

  // Risk alerts
  matchingEngine.on('riskAlert', (alert) => {
    console.log('🚨 Risk Alert:', {
      type: alert.type,
      severity: alert.severity,
      userId: alert.userId,
      message: alert.message
    });
  });

  // User events
  matchingEngine.on('userOrdersCancelled', (data) => {
    console.log('🚫 User Orders Cancelled:', {
      userId: data.userId,
      orderCount: data.orderCount
    });
  });

  riskService.on('userBlacklisted', (data) => {
    console.log('⛔ User Blacklisted:', {
      userId: data.userId,
      reason: data.reason
    });
  });
}

// Example: Configure user-specific risk limits
async function configureUserRiskLimits(riskService: RiskManagementService) {
  // Conservative user
  riskService.setUserLimits('conservative-user', {
    maxPositionSize: 10000,
    maxLeverage: 3,
    maxOpenPositions: 5,
    maxNotionalValue: 50000,
    maxOrderSize: 1000,
    minOrderSize: 0.01,
    maxOrderValue: 10000,
    maxDailyVolume: 100000,
    maxDailyTrades: 20,
    maxDailyLoss: 5000,
    maxConcentrationPerSymbol: 0.2,
    maxConcentrationPerSector: 0.4
  });

  // Aggressive trader
  riskService.setUserLimits('aggressive-trader', {
    maxPositionSize: 100000,
    maxLeverage: 10,
    maxOpenPositions: 20,
    maxNotionalValue: 1000000,
    maxOrderSize: 10000,
    minOrderSize: 0.001,
    maxOrderValue: 100000,
    maxDailyVolume: 5000000,
    maxDailyTrades: 100,
    maxDailyLoss: 50000,
    maxConcentrationPerSymbol: 0.5,
    maxConcentrationPerSector: 0.7
  });

  // Market maker
  riskService.setUserLimits('market-maker', {
    maxPositionSize: 50000,
    maxLeverage: 5,
    maxOpenPositions: 50,
    maxNotionalValue: 500000,
    maxOrderSize: 5000,
    minOrderSize: 0.001,
    maxOrderValue: 50000,
    maxDailyVolume: 10000000,
    maxDailyTrades: 500,
    maxDailyLoss: 25000,
    maxConcentrationPerSymbol: 0.3,
    maxConcentrationPerSector: 0.5
  });
}

// Example: Test various risk scenarios
async function testRiskScenarios(matchingEngine: RiskAwareMatchingEngine) {
  console.log('\n=== Testing Risk Scenarios ===\n');

  // Scenario 1: Normal order (should pass)
  console.log('1. Testing normal order...');
  try {
    const result1 = await matchingEngine.submitOrder({
      userId: 'normal-user',
      pair: 'ETH/USDC',
      side: OrderSide.BUY,
      type: OrderType.LIMIT,
      price: 2500,
      quantity: 0.1,
      timeInForce: TimeInForce.GTC
    });
    console.log('✅ Normal order accepted:', result1.orderId);
  } catch (error) {
    console.log('❌ Normal order failed:', error.message);
  }

  // Scenario 2: Order too large (should be rejected)
  console.log('\n2. Testing oversized order...');
  try {
    const result2 = await matchingEngine.submitOrder({
      userId: 'conservative-user',
      pair: 'ETH/USDC',
      side: OrderSide.BUY,
      type: OrderType.LIMIT,
      price: 2500,
      quantity: 2000, // Way over limit
      timeInForce: TimeInForce.GTC
    });
    console.log('Order result:', result2.message);
  } catch (error) {
    console.log('Expected rejection:', error.message);
  }

  // Scenario 3: Wash trading attempt (should be rejected)
  console.log('\n3. Testing wash trading detection...');
  
  // First trade - buy
  await matchingEngine.submitOrder({
    userId: 'wash-trader',
    pair: 'ETH/USDC',
    side: OrderSide.BUY,
    type: OrderType.MARKET,
    quantity: 1
  });

  // Immediate opposite trade - sell (should be flagged)
  try {
    const result3 = await matchingEngine.submitOrder({
      userId: 'wash-trader',
      pair: 'ETH/USDC',
      side: OrderSide.SELL,
      type: OrderType.MARKET,
      quantity: 1
    });
    console.log('Order result:', result3.message);
  } catch (error) {
    console.log('Expected wash trading detection:', error.message);
  }

  // Scenario 4: Suspicious price (should get warning)
  console.log('\n4. Testing price deviation warning...');
  try {
    const result4 = await matchingEngine.submitOrder({
      userId: 'suspicious-user',
      pair: 'ETH/USDC',
      side: OrderSide.BUY,
      type: OrderType.LIMIT,
      price: 5000, // 100% above market
      quantity: 0.1,
      timeInForce: TimeInForce.GTC
    });
    console.log('Order result:', result4.orderId, result4.message);
  } catch (error) {
    console.log('Order failed:', error.message);
  }

  // Scenario 5: Blacklisted user (should be rejected)
  console.log('\n5. Testing blacklisted user...');
  matchingEngine.getRiskService().blacklistUser('bad-actor', 'Market manipulation');
  
  try {
    const result5 = await matchingEngine.submitOrder({
      userId: 'bad-actor',
      pair: 'ETH/USDC',
      side: OrderSide.BUY,
      type: OrderType.LIMIT,
      price: 2500,
      quantity: 0.1,
      timeInForce: TimeInForce.GTC
    });
    console.log('Order result:', result5.message);
  } catch (error) {
    console.log('Expected blacklist rejection:', error.message);
  }
}

// Example: Manual review workflow
async function demonstrateManualReview(matchingEngine: RiskAwareMatchingEngine) {
  console.log('\n=== Manual Review Workflow ===\n');

  // Submit an order that requires review
  const orderResult = await matchingEngine.submitOrder({
    userId: 'high-risk-user',
    pair: 'BTC/USDC',
    side: OrderSide.BUY,
    type: OrderType.LIMIT,
    price: 45000,
    quantity: 5, // Large order
    timeInForce: TimeInForce.GTC
  });

  console.log('Order status:', orderResult.status);

  // Get pending review orders
  const pendingOrders = matchingEngine.getPendingReviewOrders();
  console.log('Pending review orders:', pendingOrders.length);

  if (pendingOrders.length > 0) {
    const orderToReview = pendingOrders[0];
    
    // Simulate review decision
    if (Math.random() > 0.5) {
      // Approve
      console.log('Approving order...');
      const approved = await matchingEngine.approveReviewOrder(
        orderToReview.id,
        'risk-manager-1'
      );
      console.log('Order approved:', approved.orderId);
    } else {
      // Reject
      console.log('Rejecting order...');
      const rejected = await matchingEngine.rejectReviewOrder(
        orderToReview.id,
        'risk-manager-1',
        'Suspicious trading pattern detected'
      );
      console.log('Order rejected:', rejected.message);
    }
  }
}

// Main execution
async function main() {
  try {
    // Set up the system
    const { matchingEngine, riskService } = await setupRiskAwareTradingSystem();
    
    // Configure user limits
    await configureUserRiskLimits(riskService);
    
    // Run test scenarios
    await testRiskScenarios(matchingEngine);
    
    // Demonstrate manual review
    await demonstrateManualReview(matchingEngine);
    
    // Show risk profiles
    console.log('\n=== Risk Profiles ===\n');
    
    const users = ['conservative-user', 'aggressive-trader', 'market-maker'];
    for (const userId of users) {
      const profile = await matchingEngine.getUserRiskProfile(userId);
      console.log(`${userId}:`, {
        limits: profile.limits.maxPositionSize,
        leverage: profile.limits.maxLeverage,
        isBlacklisted: profile.isBlacklisted
      });
    }
    
  } catch (error) {
    console.error('System error:', error);
  }
}

// Export for use in other modules
export {
  setupRiskAwareTradingSystem,
  configureUserRiskLimits,
  testRiskScenarios
};

// Run if executed directly
if (require.main === module) {
  main().catch(console.error);
}