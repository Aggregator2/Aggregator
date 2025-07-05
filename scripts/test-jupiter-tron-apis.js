const axios = require('axios');
require('dotenv').config();

// Test Jupiter API
async function testJupiterAPI() {
  console.log('🚀 Testing Jupiter API...');
  try {
    // Test 1: Get token list
    const tokenResponse = await axios.get('https://token.jup.ag/all');
    console.log(`✅ Jupiter Token List: ${tokenResponse.data.length} tokens found`);
    
    // Test 2: Get a quote (SOL to USDC)
    const quoteResponse = await axios.get('https://quote-api.jup.ag/v6/quote', {
      params: {
        inputMint: 'So11111111111111111111111111111111111111112', // SOL
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
        amount: '1000000000', // 1 SOL
        slippageBps: 50
      }
    });
    console.log('✅ Jupiter Quote API working');
    console.log(`  SOL → USDC Quote: ${quoteResponse.data.outAmount / 1e6} USDC for 1 SOL`);
    
  } catch (error) {
    console.error('❌ Jupiter API Error:', error.message);
  }
}

// Test Tron API
async function testTronAPI() {
  console.log('\n🔗 Testing Tron API...');
  try {
    const headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'TRON-PRO-API-KEY': process.env.TRON_API_KEY || '5b324f5c-6644-48e7-b492-84285a6c97b8'
    };
    
    // Test 1: Try public endpoint first
    try {
      const publicResponse = await axios.get(
        'https://api.trongrid.io/v1/assets/TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE/list',
        { timeout: 5000 }
      );
      console.log('✅ TronGrid public API accessible');
    } catch (e) {
      console.log('⚠️  TronGrid public API error:', e.message);
    }
    
    // Test 2: Get TRC20 tokens with auth
    const tokensResponse = await axios.get(
      'https://apilist.tronscanapi.com/api/tokens/overview',
      {
        headers,
        params: {
          start: 0,
          limit: 10,
          filter: 'trc20'
        },
        timeout: 10000
      }
    );
    console.log(`✅ Tron API: ${tokensResponse.data.total} TRC20 tokens found`);
    console.log(`  Top tokens: ${tokensResponse.data.tokens.slice(0, 3).map(t => t.abbr).join(', ')}`);
    
  } catch (error) {
    console.error('❌ Tron API Error:', error.message);
  }
}

// Run tests
async function runTests() {
  console.log('🧪 Testing External APIs...\n');
  await testJupiterAPI();
  await testTronAPI();
  console.log('\n✨ API Tests Complete!');
}

runTests();