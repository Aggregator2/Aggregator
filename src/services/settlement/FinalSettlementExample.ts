import { ethers } from 'ethers';
import { FinalSettlementEngine } from './FinalSettlementEngine';
import { Trade, OrderType } from '../matchingEngine/types';

// Example usage of the FinalSettlementEngine
async function runSettlementExample() {
  // Initialize provider and wallet
  const provider = new ethers.JsonRpcProvider('http://localhost:8545');
  const privateKey = process.env.SETTLEMENT_PRIVATE_KEY || '0x...';
  const settlementContractAddress = process.env.SETTLEMENT_CONTRACT || '0x...';
  
  // Create settlement engine with 1-hour epochs
  const settlementEngine = new FinalSettlementEngine(
    provider,
    privateKey,
    settlementContractAddress,
    3600000 // 1 hour in milliseconds
  );
  
  // Configure settlement parameters
  settlementEngine.setMaxBundleSize(50); // Max 50 instructions per bundle
  
  // Listen to settlement events
  settlementEngine.on('epochStarted', (epoch) => {
    console.log(`New epoch started: ${epoch.id}`);
    console.log(`Epoch number: ${epoch.epochNumber}`);
    console.log(`Start time: ${new Date(epoch.startTime).toISOString()}`);
    console.log(`End time: ${new Date(epoch.endTime).toISOString()}`);
  });
  
  settlementEngine.on('tradeAdded', ({ epochId, trade }) => {
    console.log(`Trade ${trade.id} added to epoch ${epochId}`);
  });
  
  settlementEngine.on('epochFinalized', (epoch) => {
    console.log(`\nEpoch ${epoch.id} finalized!`);
    console.log(`Total trades: ${epoch.trades.length}`);
    console.log(`Status: ${epoch.status}`);
    
    if (epoch.settlementBatch) {
      console.log(`\nSettlement batch created:`);
      console.log(`- Batch ID: ${epoch.settlementBatch.id}`);
      console.log(`- Total settlements: ${epoch.settlementBatch.settlements.length}`);
      console.log(`- Net positions: ${epoch.settlementBatch.netPositions.size} users`);
    }
    
    if (epoch.transactionBundles) {
      console.log(`\nTransaction bundles:`);
      epoch.transactionBundles.forEach((bundle, index) => {
        console.log(`- Bundle ${index + 1}: ${bundle.instructions.length} instructions`);
        console.log(`  Gas estimate: ${ethers.formatUnits(bundle.totalGasEstimate, 'gwei')} gwei`);
        console.log(`  Status: ${bundle.status}`);
        if (bundle.transactionHash) {
          console.log(`  Tx hash: ${bundle.transactionHash}`);
        }
      });
    }
  });
  
  settlementEngine.on('bundleExecuted', ({ bundleId, transactionHash, gasUsed }) => {
    console.log(`\nBundle ${bundleId} executed successfully!`);
    console.log(`Transaction: ${transactionHash}`);
    console.log(`Gas used: ${gasUsed}`);
  });
  
  settlementEngine.on('bundleFailed', ({ bundleId, error, retries }) => {
    console.error(`\nBundle ${bundleId} failed after ${retries} retries`);
    console.error(`Error: ${error}`);
  });
  
  settlementEngine.on('verificationSucceeded', ({ epochId }) => {
    console.log(`\n✓ Settlement verification passed for epoch ${epochId}`);
  });
  
  settlementEngine.on('verificationFailed', ({ epochId, discrepancies }) => {
    console.error(`\n✗ Settlement verification failed for epoch ${epochId}`);
    console.error(`Found ${discrepancies.length} discrepancies:`);
    discrepancies.forEach((d: any) => {
      console.error(`- User ${d.userId}, Token ${d.token}: expected ${d.expected}, actual ${d.actual}`);
    });
  });
  
  // Simulate adding trades to the current epoch
  const simulateTrades = () => {
    const trades: Trade[] = [
      // User1 buys 1 ETH for 2000 USDC from User2
      {
        id: `trade_${Date.now()}_1`,
        pair: 'ETH/USDC',
        price: 2000,
        quantity: 1,
        filledQuantity: 1,
        side: 'BUY',
        type: OrderType.LIMIT,
        status: 'FILLED',
        timestamp: Date.now(),
        buyerId: 'user1',
        sellerId: 'user2',
        buyOrderId: 'order1',
        sellOrderId: 'order2',
        buyerFee: 2, // 2 USDC fee
        sellerFee: 0.001 // 0.001 ETH fee
      },
      // User3 buys 0.5 ETH for 1010 USDC from User1
      {
        id: `trade_${Date.now()}_2`,
        pair: 'ETH/USDC',
        price: 2020,
        quantity: 0.5,
        filledQuantity: 0.5,
        side: 'BUY',
        type: OrderType.MARKET,
        status: 'FILLED',
        timestamp: Date.now() + 1000,
        buyerId: 'user3',
        sellerId: 'user1',
        buyOrderId: 'order3',
        sellOrderId: 'order4',
        buyerFee: 1.01, // 1.01 USDC fee
        sellerFee: 0.0005 // 0.0005 ETH fee
      },
      // User2 buys 2 ETH for 4100 USDC from User4
      {
        id: `trade_${Date.now()}_3`,
        pair: 'ETH/USDC',
        price: 2050,
        quantity: 2,
        filledQuantity: 2,
        side: 'BUY',
        type: OrderType.LIMIT,
        status: 'FILLED',
        timestamp: Date.now() + 2000,
        buyerId: 'user2',
        sellerId: 'user4',
        buyOrderId: 'order5',
        sellOrderId: 'order6',
        buyerFee: 4.1, // 4.1 USDC fee
        sellerFee: 0.002 // 0.002 ETH fee
      },
      // User1 buys 1000 DAI for 1000 USDC from User4
      {
        id: `trade_${Date.now()}_4`,
        pair: 'DAI/USDC',
        price: 1,
        quantity: 1000,
        filledQuantity: 1000,
        side: 'BUY',
        type: OrderType.LIMIT,
        status: 'FILLED',
        timestamp: Date.now() + 3000,
        buyerId: 'user1',
        sellerId: 'user4',
        buyOrderId: 'order7',
        sellOrderId: 'order8',
        buyerFee: 1, // 1 USDC fee
        sellerFee: 1 // 1 DAI fee
      }
    ];
    
    // Add trades to the settlement engine
    trades.forEach(trade => {
      settlementEngine.addTrade(trade);
    });
    
    console.log(`\nAdded ${trades.length} trades to current epoch`);
    
    // Show current epoch status
    const currentEpoch = settlementEngine.getCurrentEpoch();
    if (currentEpoch) {
      console.log(`\nCurrent epoch status:`);
      console.log(`- Epoch ID: ${currentEpoch.id}`);
      console.log(`- Trade count: ${currentEpoch.trades.length}`);
      console.log(`- Time remaining: ${Math.round((currentEpoch.endTime - Date.now()) / 1000)}s`);
    }
  };
  
  // Simulate multiple trading sessions
  console.log('Starting settlement engine example...\n');
  
  // Add trades immediately
  simulateTrades();
  
  // Add more trades after 30 seconds
  setTimeout(() => {
    console.log('\n--- Adding more trades ---');
    simulateTrades();
  }, 30000);
  
  // Check pending bundles periodically
  setInterval(() => {
    const pendingBundles = settlementEngine.getPendingBundles();
    if (pendingBundles.length > 0) {
      console.log(`\nPending bundles: ${pendingBundles.length}`);
      pendingBundles.forEach(bundle => {
        console.log(`- Bundle ${bundle.id}: ${bundle.status}`);
      });
    }
  }, 10000);
  
  // Emergency pause example (uncomment to test)
  // setTimeout(async () => {
  //   console.log('\n!!! EMERGENCY PAUSE !!!');
  //   await settlementEngine.emergencyPause();
  // }, 120000);
}

// Example: Manual epoch finalization
async function manualSettlementExample() {
  const provider = new ethers.JsonRpcProvider('http://localhost:8545');
  const privateKey = process.env.SETTLEMENT_PRIVATE_KEY || '0x...';
  
  // Create engine without automatic epochs
  const settlementEngine = new FinalSettlementEngine(
    provider,
    privateKey,
    undefined, // No settlement contract
    Number.MAX_SAFE_INTEGER // Very long epoch, effectively manual
  );
  
  // Add some trades
  const trades: Trade[] = [
    {
      id: 'manual_trade_1',
      pair: 'ETH/USDC',
      price: 2000,
      quantity: 1,
      filledQuantity: 1,
      side: 'BUY',
      type: OrderType.LIMIT,
      status: 'FILLED',
      timestamp: Date.now(),
      buyerId: 'alice',
      sellerId: 'bob',
      buyOrderId: 'order_a1',
      sellOrderId: 'order_b1',
      buyerFee: 2,
      sellerFee: 0.001
    }
  ];
  
  trades.forEach(trade => settlementEngine.addTrade(trade));
  
  // Manually trigger epoch finalization
  console.log('Manually finalizing epoch...');
  await (settlementEngine as any).finalizeCurrentEpoch();
}

// Run the example
if (require.main === module) {
  runSettlementExample().catch(console.error);
  
  // Keep the process running
  process.on('SIGINT', () => {
    console.log('\nShutting down settlement engine...');
    process.exit(0);
  });
}