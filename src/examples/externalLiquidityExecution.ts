import { ethers } from 'ethers';
import { liquidityAggregator } from '../services/liquidityAggregator';
import { OrderSide } from '../services/matchingEngine/types';

/**
 * Example: Execute external trade with LiFi SDK integration
 * 
 * This example demonstrates:
 * 1. Getting quotes from LiFi
 * 2. Building and signing transactions
 * 3. Submitting to blockchain
 * 4. Monitoring confirmation
 * 5. Handling failures with retries
 */
async function executeExternalTradeExample() {
  try {
    // 1. Setup provider and signer (in production, use user's wallet)
    const provider = new ethers.JsonRpcProvider(
      process.env.RPC_URL || 'https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY'
    );
    
    // Example private key - NEVER use in production!
    const privateKey = process.env.PRIVATE_KEY || '0x...';
    const signer = new ethers.Wallet(privateKey, provider);
    
    console.log('🔐 Using wallet:', await signer.getAddress());
    
    // 2. Trade parameters
    const tradeParams = {
      userId: 'user123',
      pair: 'ETH/USDC',
      side: OrderSide.BUY, // Buy ETH with USDC
      quantity: 1.5, // Buy 1.5 ETH
      options: {
        maxSlippage: 0.02, // 2% slippage tolerance
        maxRetries: 3,
        dexName: 'LiFi Aggregator'
      }
    };
    
    console.log('📊 Trade Parameters:', tradeParams);
    
    // 3. Listen to events for real-time updates
    setupEventListeners();
    
    // 4. Execute external trade
    console.log('\n🚀 Executing external trade...');
    const result = await liquidityAggregator.executeExternalTrade(
      tradeParams.userId,
      tradeParams.pair,
      tradeParams.side,
      tradeParams.quantity,
      signer,
      tradeParams.options
    );
    
    console.log('\n✅ Trade executed successfully!');
    console.log('📝 Result:', {
      orderId: result.orderId,
      txHash: result.txHash,
      status: result.status,
      filledQuantity: result.filledQuantity,
      averagePrice: result.averagePrice,
      gasUsed: result.gasUsed,
      dex: result.dex
    });
    
    // 5. Get final trade status
    const finalStatus = liquidityAggregator.getExternalTradeStatus(result.orderId);
    console.log('\n📊 Final Trade Status:', finalStatus);
    
  } catch (error) {
    console.error('❌ Trade execution failed:', error);
    handleTradeError(error);
  }
}

/**
 * Setup event listeners for real-time updates
 */
function setupEventListeners() {
  // Trade lifecycle events
  liquidityAggregator.on('trade:initiated', (data) => {
    console.log('🔄 Trade initiated:', data);
  });
  
  liquidityAggregator.on('quote:requesting', (data) => {
    console.log('🔍 Requesting quote...', {
      orderId: data.orderId,
      from: data.request.fromToken.slice(0, 10) + '...',
      to: data.request.toToken.slice(0, 10) + '...',
      amount: data.request.fromAmount
    });
  });
  
  liquidityAggregator.on('quote:received', (data) => {
    console.log('💰 Quote received:', {
      orderId: data.orderId,
      routes: data.routeCount,
      estimatedOutput: data.estimatedOutput,
      estimatedGas: data.estimatedGas
    });
  });
  
  liquidityAggregator.on('signature:required', (data) => {
    console.log('✍️ Signature required for order:', data.orderId);
    console.log('⏳ Waiting for user to sign transaction...');
  });
  
  liquidityAggregator.on('transaction:building', (data) => {
    console.log('🔨 Building transaction for order:', data.orderId);
  });
  
  liquidityAggregator.on('transaction:submitted', (data) => {
    console.log('📤 Transaction submitted!');
    console.log(`🔗 TX Hash: ${data.txHash}`);
    console.log(`🔍 View on Etherscan: https://etherscan.io/tx/${data.txHash}`);
  });
  
  liquidityAggregator.on('transaction:confirmed', (data) => {
    console.log('✅ Transaction confirmed!');
    console.log(`📦 Confirmations: ${data.confirmations}`);
  });
  
  liquidityAggregator.on('transaction:failed', (data) => {
    console.error('❌ Transaction failed:', data);
  });
  
  liquidityAggregator.on('transaction:timeout', (data) => {
    console.error('⏱️ Transaction timeout:', data);
  });
  
  // Execution updates from LiFi
  liquidityAggregator.on('execution:update', (data) => {
    console.log('📊 Execution update:', {
      orderId: data.orderId,
      type: data.type
    });
  });
  
  liquidityAggregator.on('action:required', (data) => {
    console.log('⚠️ Action required:', data.message);
  });
  
  // Retry events
  liquidityAggregator.on('transaction:retrying', (data) => {
    console.log(`🔄 Retrying transaction (attempt ${data.attempt})...`);
  });
  
  // Fallback events
  liquidityAggregator.on('fallback:trying', (data) => {
    console.log(`🔀 Trying fallback DEX: ${data.dex}`);
  });
  
  liquidityAggregator.on('fallback:success', (data) => {
    console.log(`✅ Fallback DEX ${data.dex} succeeded!`);
  });
  
  // Record updates
  liquidityAggregator.on('records:updated', (data) => {
    console.log('📝 Internal records updated:', {
      userId: data.userId,
      pair: data.pair,
      txHash: data.txHash
    });
  });
}

/**
 * Handle different types of trade errors
 */
function handleTradeError(error: any) {
  if (error.message?.includes('insufficient funds')) {
    console.error('💸 Error: Insufficient funds in wallet');
    console.log('💡 Tip: Ensure you have enough tokens and ETH for gas');
  } else if (error.message?.includes('slippage')) {
    console.error('📈 Error: Slippage tolerance exceeded');
    console.log('💡 Tip: Try increasing slippage tolerance or reducing trade size');
  } else if (error.message?.includes('No routes available')) {
    console.error('🚫 Error: No liquidity routes found');
    console.log('💡 Tip: Check if the token pair is supported');
  } else if (error.message?.includes('rate limit')) {
    console.error('⏱️ Error: API rate limit exceeded');
    console.log('💡 Tip: Wait before retrying');
  } else if (error.message?.includes('reverted')) {
    console.error('❌ Error: Transaction reverted on-chain');
    console.log('💡 Tip: Check token approvals and balances');
  }
}

/**
 * Example: Monitor multiple external trades
 */
async function monitorExternalTrades() {
  // Get all pending trades
  const pendingTrades = liquidityAggregator.getPendingExternalTrades();
  
  console.log(`\n📊 Monitoring ${pendingTrades.length} pending trades...`);
  
  for (const trade of pendingTrades) {
    console.log(`\n🔍 Trade ${trade.orderId}:`);
    console.log(`  Status: ${trade.status}`);
    console.log(`  TX Hash: ${trade.txHash || 'Not submitted yet'}`);
    console.log(`  Confirmations: ${trade.confirmations || 0}`);
    console.log(`  Created: ${new Date(trade.timestamp).toLocaleString()}`);
    
    if (trade.error) {
      console.log(`  ❌ Error: ${trade.error}`);
    }
  }
}

/**
 * Example: Execute trade with fallback DEXs
 */
async function executeWithFallbackDEXs() {
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const signer = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);
  
  try {
    // Try with primary DEX first
    const result = await liquidityAggregator.executeExternalTrade(
      'user123',
      'ETH/USDC',
      OrderSide.SELL,
      0.5,
      signer,
      {
        maxSlippage: 0.01,
        dexName: 'LiFi',
        fallbackDEXs: ['Uniswap', '1inch', '0x'] // Fallback options
      }
    );
    
    console.log('✅ Trade executed:', result);
    
  } catch (error) {
    console.error('❌ All DEX attempts failed:', error);
  }
}

/**
 * Example: Execute trade with custom gas settings
 */
async function executeWithCustomGas() {
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const signer = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);
  
  // Override gas settings
  const signerWithGasOverride = signer.connect(provider);
  
  // Get current gas prices
  const feeData = await provider.getFeeData();
  console.log('⛽ Current gas prices:', {
    gasPrice: ethers.formatUnits(feeData.gasPrice || 0, 'gwei') + ' gwei',
    maxFeePerGas: ethers.formatUnits(feeData.maxFeePerGas || 0, 'gwei') + ' gwei',
    maxPriorityFeePerGas: ethers.formatUnits(feeData.maxPriorityFeePerGas || 0, 'gwei') + ' gwei'
  });
  
  const result = await liquidityAggregator.executeExternalTrade(
    'user123',
    'WBTC/USDT',
    OrderSide.BUY,
    0.1, // Buy 0.1 WBTC
    signerWithGasOverride,
    {
      maxSlippage: 0.03, // 3% for less liquid pairs
      maxRetries: 5 // More retries for important trades
    }
  );
  
  console.log('✅ Trade executed with custom gas:', result);
}

/**
 * Example: Get trade history for a user
 */
async function getUserTradeHistory(userId: string) {
  const trades = liquidityAggregator.getOrdersByUser(userId);
  
  console.log(`\n📜 Trade history for user ${userId}:`);
  console.log(`Total trades: ${trades.length}\n`);
  
  trades.forEach((trade, index) => {
    console.log(`${index + 1}. Order ${trade.orderId}`);
    console.log(`   Status: ${trade.status}`);
    console.log(`   Created: ${new Date(trade.timestamp).toLocaleString()}`);
    if (trade.txHash) {
      console.log(`   TX: ${trade.txHash}`);
    }
    if (trade.error) {
      console.log(`   Error: ${trade.error}`);
    }
    console.log('');
  });
}

// Run examples
if (require.main === module) {
  (async () => {
    console.log('🚀 LiFi External Trade Execution Examples\n');
    
    // Check environment
    if (!process.env.PRIVATE_KEY || !process.env.RPC_URL) {
      console.error('❌ Please set PRIVATE_KEY and RPC_URL environment variables');
      process.exit(1);
    }
    
    // Run main example
    await executeExternalTradeExample();
    
    // Monitor trades
    await monitorExternalTrades();
    
    // Get trade history
    await getUserTradeHistory('user123');
  })().catch(console.error);
}

export {
  executeExternalTradeExample,
  monitorExternalTrades,
  executeWithFallbackDEXs,
  executeWithCustomGas,
  getUserTradeHistory
};