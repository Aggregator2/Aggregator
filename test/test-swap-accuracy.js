const { ethers } = require('ethers');
const fetch = require('node-fetch');
const { SpecialTokenService } = require('../src/services/specialTokenService');

// Test configuration
const API_BASE_URL = 'http://localhost:3000/api';

// Test tokens for each type
const testTokens = [
  {
    name: 'USDC (6 decimals)',
    sellToken: {
      address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      symbol: 'USDC',
      decimals: 6,
      chainId: 1
    },
    buyToken: {
      address: '0x6b175474e89094c44da98b954eedeac495271d0f',
      symbol: 'DAI',
      decimals: 18,
      chainId: 1
    },
    sellAmount: '100', // 100 USDC
    expectedType: 'standard'
  },
  {
    name: 'WBTC (8 decimals)',
    sellToken: {
      address: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
      symbol: 'WBTC',
      decimals: 8,
      chainId: 1
    },
    buyToken: {
      address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      symbol: 'WETH',
      decimals: 18,
      chainId: 1
    },
    sellAmount: '0.01', // 0.01 WBTC
    expectedType: 'standard'
  },
  {
    name: 'stETH (rebasing)',
    sellToken: {
      address: '0xae7ab96520de3a18e5e111b5eaab095312d7fe84',
      symbol: 'stETH',
      decimals: 18,
      chainId: 1
    },
    buyToken: {
      address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      symbol: 'WETH',
      decimals: 18,
      chainId: 1
    },
    sellAmount: '1', // 1 stETH
    expectedType: 'rebasing'
  },
  {
    name: 'USDT (non-standard approval)',
    sellToken: {
      address: '0xdac17f958d2ee523a2206206994597c13d831ec7',
      symbol: 'USDT',
      decimals: 6,
      chainId: 1
    },
    buyToken: {
      address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      symbol: 'USDC',
      decimals: 6,
      chainId: 1
    },
    sellAmount: '100', // 100 USDT
    expectedType: 'non-standard-approval'
  }
];

async function testSwapAccuracy(token) {
  console.log(`\n🔄 Testing ${token.name}`);
  console.log('=====================================');
  
  try {
    // 1. Parse sell amount with correct decimals
    const parsedSellAmount = SpecialTokenService.parseTokenAmount(
      token.sellToken.address,
      token.sellToken.chainId,
      token.sellAmount,
      token.sellToken.decimals
    );
    
    console.log(`📊 Sell Amount: ${token.sellAmount} ${token.sellToken.symbol}`);
    console.log(`📊 Parsed Amount: ${parsedSellAmount} (raw units)`);
    
    // 2. Get quote from API
    const quoteResponse = await fetch(`${API_BASE_URL}/quote-profitable`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sellToken: token.sellToken.address,
        buyToken: token.buyToken.address,
        sellAmount: parsedSellAmount,
        chainId: token.sellToken.chainId
      })
    });
    
    if (!quoteResponse.ok) {
      const error = await quoteResponse.text();
      throw new Error(`Quote failed: ${error}`);
    }
    
    const quote = await quoteResponse.json();
    
    // 3. Format buy amount with correct decimals
    const formattedBuyAmount = SpecialTokenService.formatTokenAmount(
      token.buyToken.address,
      token.buyToken.chainId,
      quote.buyAmount,
      token.buyToken.decimals
    );
    
    console.log(`💰 Buy Amount: ${formattedBuyAmount} ${token.buyToken.symbol}`);
    
    // 4. Check for fee-on-transfer adjustments
    const feeCalc = SpecialTokenService.calculateFeeOnTransferAmount(
      token.buyToken.address,
      token.buyToken.chainId,
      quote.buyAmount,
      token.buyToken.decimals
    );
    
    if (feeCalc.feePercentage > 0) {
      const netAmount = SpecialTokenService.formatTokenAmount(
        token.buyToken.address,
        token.buyToken.chainId,
        feeCalc.netAmount,
        token.buyToken.decimals
      );
      console.log(`⚡ Fee-on-transfer: ${feeCalc.feePercentage}%`);
      console.log(`⚡ Net Amount: ${netAmount} ${token.buyToken.symbol}`);
    }
    
    // 5. Calculate exchange rate
    const sellAmountFloat = parseFloat(token.sellAmount);
    const buyAmountFloat = parseFloat(formattedBuyAmount);
    const rate = buyAmountFloat / sellAmountFloat;
    
    console.log(`📈 Exchange Rate: 1 ${token.sellToken.symbol} = ${rate.toFixed(6)} ${token.buyToken.symbol}`);
    
    // 6. Verify quote details
    console.log(`\n📋 Quote Details:`);
    console.log(`  - LP Fee: ${quote.lpFee || 0}`);
    console.log(`  - Price Impact: ${quote.priceImpact || 0}%`);
    console.log(`  - Gas Estimate: ${quote.estimatedGas || 'N/A'}`);
    console.log(`  - Source: ${quote.source || 'Unknown'}`);
    
    // 7. Test slippage calculation
    const slippageTolerance = 0.5; // 0.5%
    const minAmount = buyAmountFloat * (1 - slippageTolerance / 100);
    console.log(`  - Min Amount (0.5% slippage): ${minAmount.toFixed(6)} ${token.buyToken.symbol}`);
    
    // 8. Verify decimal precision
    const sellDecimals = token.sellToken.decimals;
    const buyDecimals = token.buyToken.decimals;
    const sellPrecision = Math.pow(10, -sellDecimals);
    const buyPrecision = Math.pow(10, -buyDecimals);
    
    console.log(`\n🔍 Precision Check:`);
    console.log(`  - Sell Token Precision: ${sellPrecision} ${token.sellToken.symbol}`);
    console.log(`  - Buy Token Precision: ${buyPrecision} ${token.buyToken.symbol}`);
    
    // Verify amounts are rounded correctly
    const sellRemainder = parseFloat(parsedSellAmount) % 1;
    const buyRemainder = parseFloat(quote.buyAmount) % 1;
    
    if (sellRemainder !== 0 || buyRemainder !== 0) {
      console.log(`  ⚠️ Warning: Non-integer amounts detected`);
    } else {
      console.log(`  ✅ Amounts are properly rounded`);
    }
    
    return {
      success: true,
      token: token.name,
      rate,
      buyAmount: formattedBuyAmount,
      precision: { sell: sellPrecision, buy: buyPrecision }
    };
    
  } catch (error) {
    console.error(`❌ Error testing ${token.name}:`, error.message);
    return {
      success: false,
      token: token.name,
      error: error.message
    };
  }
}

async function runAllTests() {
  console.log('🧪 Starting Swap Accuracy Tests');
  console.log('================================\n');
  
  const results = [];
  
  for (const token of testTokens) {
    const result = await testSwapAccuracy(token);
    results.push(result);
    
    // Add delay between tests to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  // Summary
  console.log('\n\n📊 Test Summary');
  console.log('=====================================');
  
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  console.log(`✅ Successful: ${successful.length}/${results.length}`);
  console.log(`❌ Failed: ${failed.length}/${results.length}`);
  
  if (successful.length > 0) {
    console.log('\nSuccessful swaps:');
    successful.forEach(r => {
      console.log(`  - ${r.token}: 1 token = ${r.rate.toFixed(6)} (${r.buyAmount} received)`);
    });
  }
  
  if (failed.length > 0) {
    console.log('\nFailed swaps:');
    failed.forEach(r => {
      console.log(`  - ${r.token}: ${r.error}`);
    });
  }
  
  // Decimal precision summary
  console.log('\n🔢 Decimal Precision Summary:');
  results.forEach(r => {
    if (r.success && r.precision) {
      console.log(`  - ${r.token}: Sell=${r.precision.sell}, Buy=${r.precision.buy}`);
    }
  });
}

// Run tests if this file is executed directly
if (require.main === module) {
  runAllTests().catch(console.error);
}

module.exports = { testSwapAccuracy, runAllTests };