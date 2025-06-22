require('dotenv').config();
const axios = require('axios');
const { ethers } = require('ethers');
const { TokenService } = require('./src/services/crossChainRouter/TokenService');

async function testTokenService() {
  console.log('Testing TokenService directly...\n');
  
  const tokenService = new TokenService();
  
  // Test cases
  const testCases = [
    { chainId: 1, address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', name: 'ETH on Ethereum' },
    { chainId: 56, address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', name: 'BNB on BSC' },
    { chainId: 137, address: '0x0000000000000000000000000000000000001010', name: 'MATIC on Polygon' },
    { chainId: 1, address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', name: 'USDC on Ethereum' },
  ];
  
  for (const test of testCases) {
    console.log(`\nTesting ${test.name}:`);
    try {
      const tokenInfo = await tokenService.getTokenInfo(test.chainId, test.address);
      console.log('✅ Success:', {
        symbol: tokenInfo.symbol,
        decimals: tokenInfo.decimals,
        priceUSD: tokenInfo.priceUSD
      });
    } catch (error) {
      console.log('❌ Error:', error.message);
    }
  }
}

async function testCrossChainAPI() {
  console.log('\n\nTesting Cross-Chain API...\n');
  
  const testCase = {
    sourceChainId: 1,
    destinationChainId: 137,
    sourceToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
    destinationToken: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', // USDC
    sourceAmount: '1000000',
    recipientAddress: '0x0000000000000000000000000000000000000001',
    slippageTolerance: 300
  };
  
  try {
    const response = await axios.post('http://localhost:3000/api/crosschain/quote', testCase);
    console.log('✅ API Success:', response.data);
  } catch (error) {
    console.log('❌ API Error:', error.response?.data || error.message);
  }
}

async function main() {
  await testTokenService();
  await testCrossChainAPI();
}

main().catch(console.error);