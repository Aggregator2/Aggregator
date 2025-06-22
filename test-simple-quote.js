#!/usr/bin/env node

/**
 * Simple test for quote generation
 */

const fetch = require('node-fetch');
const { ethers } = require('ethers');

const BASE_URL = 'http://localhost:3000';

async function testSimpleQuote() {
  console.log('🧪 Testing Simple Quote\n');
  
  // Test with known good tokens
  const tests = [
    {
      name: 'WETH to USDC',
      sellToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH on Ethereum
      buyToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC on Ethereum
      amount: '1', // 1 WETH
      decimals: 18,
      chain: 1
    },
    {
      name: 'USDC to DAI',
      sellToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
      buyToken: '0x6B175474E89094C44Da98b954EedeAC495271d0F', // DAI
      amount: '100', // 100 USDC
      decimals: 6,
      chain: 1
    },
    {
      name: 'ETH to USDC',
      sellToken: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', // ETH
      buyToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
      amount: '0.1', // 0.1 ETH
      decimals: 18,
      chain: 1
    }
  ];
  
  for (const test of tests) {
    console.log(`\nTesting ${test.name}...`);
    
    try {
      const sellAmount = ethers.parseUnits(test.amount, test.decimals).toString();
      
      const response = await fetch(`${BASE_URL}/api/quote-profitable`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sellToken: test.sellToken,
          buyToken: test.buyToken,
          sellAmount: sellAmount,
          chainId: test.chain,
        }),
      });
      
      const data = await response.json();
      
      if (response.ok) {
        console.log(`✅ Success!`);
        console.log(`   Source: ${data.source}`);
        console.log(`   Buy Amount: ${data.buyAmount}`);
        console.log(`   Price: ${data.price}`);
        
        // Check if transaction data is available
        if (data.to && data.data) {
          console.log(`   ✓ Transaction data available`);
        }
      } else {
        console.log(`❌ Error: ${data.error}`);
        if (data.details) {
          console.log(`   Details: ${data.details}`);
        }
      }
      
    } catch (error) {
      console.log(`💥 Network error: ${error.message}`);
    }
    
    // Small delay between tests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log('\n✅ Test completed!');
}

// Run test
testSimpleQuote().catch(console.error);