#!/usr/bin/env node

/**
 * Test script for revenue accumulation system
 * 
 * This script simulates quote generation to test the revenue accumulation
 * and automatic transfer mechanism.
 */

const { ethers } = require('ethers');
const fetch = require('node-fetch');

// Test configuration
const API_BASE_URL = process.env.API_URL || 'http://localhost:3000';
const TEST_ITERATIONS = 20; // Number of test quotes to generate
const DELAY_BETWEEN_QUOTES = 2000; // 2 seconds

// Test token pairs
const TEST_PAIRS = [
  {
    sellToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
    buyToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
    sellAmount: ethers.parseEther('1').toString(),
    expectedFee: 0.003, // 0.3% spread
  },
  {
    sellToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
    buyToken: '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT
    sellAmount: ethers.parseUnits('1000', 6).toString(),
    expectedFee: 0.003,
  },
  {
    sellToken: '0x6B175474E89094C44Da98b954EedeAC495271d0F', // DAI
    buyToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
    sellAmount: ethers.parseEther('2000').toString(),
    expectedFee: 0.003,
  },
];

async function generateQuote(pair) {
  try {
    const response = await fetch(`${API_BASE_URL}/api/quote-profitable`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sellToken: pair.sellToken,
        buyToken: pair.buyToken,
        sellAmount: pair.sellAmount,
        user: '0x0000000000000000000000000000000000000001',
        chainId: 1,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Quote failed: ${error.error || response.statusText}`);
    }

    const quote = await response.json();
    console.log(`✓ Generated quote: ${pair.sellAmount} ${pair.sellToken} → ${quote.buyAmount} ${pair.buyToken}`);
    
    return quote;
  } catch (error) {
    console.error(`✗ Quote generation failed:`, error.message);
    return null;
  }
}

async function checkRevenueStatus() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/revenue/status`);
    
    if (!response.ok) {
      throw new Error(`Status check failed: ${response.statusText}`);
    }

    const status = await response.json();
    
    console.log('\n📊 Revenue Status:');
    console.log(`   Total Revenue: $${status.summary.totalRevenueUSD}`);
    console.log(`   Total Fees Collected: ${status.summary.totalFees}`);
    console.log(`   Progress to Transfer: ${status.summary.percentageToThreshold}%`);
    console.log(`   Will Auto-Transfer: ${status.summary.willAutoTransfer ? 'Yes' : 'No'}`);
    
    if (status.summary.lastTransferTimestamp) {
      console.log(`   Last Transfer: ${status.summary.lastTransferTimestamp}`);
    }
    
    console.log('\n   Fees by Token:');
    Object.entries(status.feesByToken).forEach(([key, data]) => {
      console.log(`   - ${key}: ${data.count} fees, $${data.totalUSD.toFixed(2)}`);
    });
    
    return status;
  } catch (error) {
    console.error('✗ Status check failed:', error.message);
    return null;
  }
}

async function runTest() {
  console.log('🚀 Starting Revenue Accumulator Test\n');
  console.log(`   API URL: ${API_BASE_URL}`);
  console.log(`   Test Iterations: ${TEST_ITERATIONS}`);
  console.log(`   Expected threshold for transfer: $50\n`);
  
  // Check initial status
  console.log('📍 Initial Status:');
  await checkRevenueStatus();
  
  // Generate test quotes
  console.log('\n🔄 Generating test quotes...\n');
  
  for (let i = 0; i < TEST_ITERATIONS; i++) {
    const pair = TEST_PAIRS[i % TEST_PAIRS.length];
    console.log(`\n[${i + 1}/${TEST_ITERATIONS}] Generating quote...`);
    
    await generateQuote(pair);
    
    // Check status every 5 quotes
    if ((i + 1) % 5 === 0) {
      await checkRevenueStatus();
    }
    
    // Wait before next quote
    if (i < TEST_ITERATIONS - 1) {
      await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_QUOTES));
    }
  }
  
  // Final status check
  console.log('\n\n📍 Final Status:');
  const finalStatus = await checkRevenueStatus();
  
  if (finalStatus && finalStatus.summary.totalRevenueUSD >= 50) {
    console.log('\n✅ Revenue threshold reached! Automatic transfer should trigger.');
  } else if (finalStatus) {
    console.log(`\n⏳ Revenue at $${finalStatus.summary.totalRevenueUSD}. Need $${(50 - finalStatus.summary.totalRevenueUSD).toFixed(2)} more for automatic transfer.`);
  }
  
  console.log('\n✨ Test completed!');
}

// Run the test
runTest().catch(error => {
  console.error('\n❌ Test failed:', error);
  process.exit(1);
});