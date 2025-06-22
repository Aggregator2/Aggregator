#!/usr/bin/env node

/**
 * Test the updated quote system with fixes
 */

const fetch = require('node-fetch');
const { ethers } = require('ethers');

const BASE_URL = 'http://localhost:3000';

async function testQuotes() {
  console.log('🧪 Testing Updated Quote System\n');
  
  // Test 1: Normal quote with reasonable amount
  console.log('1. Testing normal quote (1 WETH to DAI)...');
  try {
    const response = await fetch(`${BASE_URL}/api/quote-profitable`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sellToken: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', // WETH
        buyToken: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', // DAI
        sellAmount: ethers.parseEther('1').toString(), // 1 WETH
        chainId: 1,
      }),
    });
    
    const data = await response.json();
    if (response.ok) {
      console.log(`✅ Success: Got quote from ${data.source}`);
      console.log(`   Buy amount: ${data.buyAmount}`);
      console.log(`   Price: ${data.price}`);
    } else {
      console.log(`❌ Error: ${data.error}`);
    }
  } catch (error) {
    console.log(`💥 Network error: ${error.message}`);
  }
  
  // Test 2: Quote with too large amount
  console.log('\n2. Testing quote with too large amount...');
  try {
    const response = await fetch(`${BASE_URL}/api/quote-profitable`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sellToken: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
        buyToken: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
        sellAmount: '1000000000000000000000000000000000000', // Way too large
        chainId: 1,
      }),
    });
    
    const data = await response.json();
    if (!response.ok && data.error === 'Sell amount is too large') {
      console.log('✅ Correctly rejected large amount');
    } else {
      console.log(`❌ Unexpected response: ${JSON.stringify(data)}`);
    }
  } catch (error) {
    console.log(`💥 Network error: ${error.message}`);
  }
  
  // Test 3: Test fallback mechanism
  console.log('\n3. Testing fallback mechanism (obscure token pair)...');
  try {
    const response = await fetch(`${BASE_URL}/api/quote-profitable`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sellToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
        buyToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
        sellAmount: ethers.parseEther('0.1').toString(),
        chainId: 1,
      }),
    });
    
    const data = await response.json();
    if (response.ok) {
      console.log(`✅ Got quote from ${data.source}`);
      if (data.source === 'fallback') {
        console.log('   ⚠️ Using fallback pricing');
      }
    } else {
      console.log(`❌ Error: ${data.error}`);
    }
  } catch (error) {
    console.log(`💥 Network error: ${error.message}`);
  }
  
  // Test 4: Multiple quick requests (should stop after failures)
  console.log('\n4. Testing multiple requests to check failure limiting...');
  let successCount = 0;
  let failureCount = 0;
  
  for (let i = 0; i < 5; i++) {
    try {
      const response = await fetch(`${BASE_URL}/api/quote-profitable`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sellToken: '0x1234567890123456789012345678901234567890', // Invalid
          buyToken: '0x0987654321098765432109876543210987654321', // Invalid
          sellAmount: ethers.parseEther('1').toString(),
          chainId: 1,
        }),
      });
      
      const data = await response.json();
      if (response.ok) {
        successCount++;
        console.log(`   Request ${i + 1}: ✓ ${data.source}`);
      } else {
        failureCount++;
        console.log(`   Request ${i + 1}: ✗ ${data.error}`);
      }
      
      // Small delay between requests
      await new Promise(resolve => setTimeout(resolve, 500));
      
    } catch (error) {
      failureCount++;
      console.log(`   Request ${i + 1}: 💥 Network error`);
    }
  }
  
  console.log(`\n   Summary: ${successCount} successes, ${failureCount} failures`);
  if (failureCount >= 3) {
    console.log('   ✅ System correctly limiting fallback attempts');
  }
  
  console.log('\n✅ All tests completed!');
}

// Run tests
testQuotes().catch(console.error);