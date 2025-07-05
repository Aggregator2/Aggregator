import { ethers } from 'ethers';
import { createSettlementService, SettlementServiceConfig } from './SettlementService';
import {
  setOrchestrator as setWebhookOrchestrator
} from '../../../pages/api/settlement/webhooks';
import {
  setOrchestrator as setStatusOrchestrator
} from '../../../pages/api/settlement/status';
import {
  setOrchestrator as setEpochOrchestrator
} from '../../../pages/api/settlement/epochs';
import {
  setInstances
} from '../../../pages/api/settlement/user/[userId]/settlements';

// Example usage and initialization
async function initializeSettlementService() {
  // Configuration
  const config: SettlementServiceConfig = {
    // Provider configuration
    providerUrl: process.env.RPC_URL || 'http://localhost:8545',
    privateKey: process.env.SETTLEMENT_PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', // Default hardhat account #0
    
    // Settlement configuration
    settlementContractAddress: process.env.SETTLEMENT_CONTRACT || '0x5FbDB2315678afecb367f032d93F642f64180aa3',
    epochDuration: 300000, // 5 minutes for testing (1 hour in production)
    
    // Matching engine configuration
    matchingEngineConfig: {
      maxOrderBookDepth: 1000,
      minOrderSize: {
        'ETH/USDC': 0.001,
        'BTC/USDC': 0.00001,
        'ETH/USDT': 0.001,
        'BTC/USDT': 0.00001
      },
      maxOrderSize: {
        'ETH/USDC': 1000,
        'BTC/USDC': 100,
        'ETH/USDT': 1000,
        'BTC/USDT': 100
      },
      tickSize: {
        'ETH/USDC': 0.01,
        'BTC/USDC': 0.1,
        'ETH/USDT': 0.01,
        'BTC/USDT': 0.1
      },
      makerFeeRate: 0.001, // 0.1%
      takerFeeRate: 0.002, // 0.2%
      enableStopOrders: false,
      enableIcebergOrders: false
    },
    
    // Webhook configuration
    enableWebhooks: true,
    webhookRetryAttempts: 3,
    webhookRetryDelay: 1000,
    
    // Features
    enableAutoSettlement: true,
    enableEmergencyPause: true,
    
    // Performance
    maxTradesPerEpoch: 10000,
    maxBundleSize: 100
  };

  // Create settlement service
  const settlementService = createSettlementService(config);

  // Initialize the service
  await settlementService.initialize();

  // Set orchestrator instances for API endpoints
  const orchestrator = settlementService.getOrchestrator();
  const settlementEngine = settlementService.getSettlementEngine();
  
  setWebhookOrchestrator(orchestrator);
  setStatusOrchestrator(orchestrator);
  setEpochOrchestrator(orchestrator);
  setInstances(orchestrator, settlementEngine);

  // Set up event listeners
  settlementService.on('initialized', (data) => {
    console.log('Settlement service initialized:', data);
  });

  settlementService.on('epochStarted', (data) => {
    console.log('New epoch started:', {
      epochId: data.epochId,
      epochNumber: data.epochNumber,
      duration: `${config.epochDuration / 1000}s`
    });
  });

  settlementService.on('trade', (trade) => {
    console.log('Trade executed:', {
      id: trade.id,
      pair: trade.pair,
      price: trade.price,
      quantity: trade.quantity
    });
  });

  settlementService.on('epochFinalized', (data) => {
    console.log('Epoch finalized:', {
      epochId: data.epochId,
      tradesCount: data.tradesCount,
      status: data.status
    });
  });

  settlementService.on('settlementConfirmed', (data) => {
    console.log('Settlement confirmed on-chain:', data);
  });

  settlementService.on('webhookDelivered', (data) => {
    console.log('Webhook delivered:', data);
  });

  settlementService.on('webhookFailed', (data) => {
    console.error('Webhook delivery failed:', data);
  });

  return settlementService;
}

// Example: Simulate trading activity
async function simulateTrading(settlementService: any) {
  console.log('\n--- Starting trading simulation ---\n');

  // Create some test users
  const users = ['alice', 'bob', 'charlie', 'david'];
  
  // Register webhooks for users
  for (const user of users) {
    settlementService.registerWebhook(
      user,
      `https://example.com/webhooks/${user}`,
      `secret-${user}`
    );
  }

  // Submit some orders
  const orders = [
    // Alice sells 1 ETH at 2500 USDC
    {
      userId: 'alice',
      pair: 'ETH/USDC',
      side: 'SELL',
      type: 'LIMIT',
      price: 2500,
      quantity: 1
    },
    // Bob buys 0.5 ETH at 2500 USDC
    {
      userId: 'bob',
      pair: 'ETH/USDC',
      side: 'BUY',
      type: 'LIMIT',
      price: 2500,
      quantity: 0.5
    },
    // Charlie buys 0.5 ETH at 2500 USDC
    {
      userId: 'charlie',
      pair: 'ETH/USDC',
      side: 'BUY',
      type: 'LIMIT',
      price: 2500,
      quantity: 0.5
    },
    // David sells 0.1 BTC at 45000 USDC
    {
      userId: 'david',
      pair: 'BTC/USDC',
      side: 'SELL',
      type: 'LIMIT',
      price: 45000,
      quantity: 0.1
    },
    // Alice buys 0.1 BTC at 45000 USDC
    {
      userId: 'alice',
      pair: 'BTC/USDC',
      side: 'BUY',
      type: 'LIMIT',
      price: 45000,
      quantity: 0.1
    }
  ];

  // Submit orders
  for (const order of orders) {
    try {
      const result = await settlementService.submitOrder(order);
      console.log(`Order submitted: ${result.orderId} - ${order.userId} ${order.side} ${order.quantity} ${order.pair} @ ${order.price}`);
    } catch (error) {
      console.error('Order submission failed:', error.message);
    }
  }

  // Check service status
  const status = settlementService.getStatus();
  console.log('\nService Status:', {
    initialized: status.initialized,
    currentEpoch: status.settlement?.currentEpoch,
    processedTrades: status.settlement?.processedTrades,
    activeWebhooks: status.settlement?.activeWebhooks
  });

  // Get order book
  console.log('\nETH/USDC Order Book:');
  const ethBook = settlementService.getOrderBook('ETH/USDC');
  console.log('Bids:', ethBook.bids.slice(0, 3));
  console.log('Asks:', ethBook.asks.slice(0, 3));

  // Get recent trades
  const recentTrades = settlementService.getRecentTrades('ETH/USDC', 5);
  console.log('\nRecent ETH/USDC Trades:', recentTrades);
}

// Example: Monitor settlement cycles
async function monitorSettlements(settlementService: any) {
  console.log('\n--- Monitoring settlements ---\n');

  // Monitor for 2 epochs
  let epochCount = 0;
  const maxEpochs = 2;

  settlementService.on('epochFinalized', async (data) => {
    epochCount++;
    console.log(`\nEpoch ${epochCount} finalized:`, data);

    if (epochCount >= maxEpochs) {
      console.log('\n--- Simulation complete ---');
      
      // Shutdown service
      await settlementService.shutdown();
      process.exit(0);
    }
  });
}

// Main execution
async function main() {
  try {
    // Initialize settlement service
    const settlementService = await initializeSettlementService();

    // Simulate trading
    await simulateTrading(settlementService);

    // Monitor settlements
    await monitorSettlements(settlementService);

    console.log('\n--- Settlement service is running ---');
    console.log('Epochs will finalize every 5 minutes');
    console.log('Press Ctrl+C to stop\n');

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

// Run the example
if (require.main === module) {
  main().catch(console.error);
}

export { initializeSettlementService, simulateTrading };