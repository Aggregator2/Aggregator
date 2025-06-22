const { getChains, getTokens, getQuote } = require('@lifi/sdk');

async function testLiFi() {
  console.log('Testing LiFi SDK directly...\n');
  
  try {
    // Test 1: Get chains
    console.log('1. Testing getChains()...');
    const chains = await getChains();
    console.log(`✅ Found ${chains.length} chains`);
    console.log('Sample chains:', chains.slice(0, 3).map(c => ({ id: c.id, name: c.name })));
    
    // Test 2: Get tokens for Ethereum
    console.log('\n2. Testing getTokens() for Ethereum (chainId: 1)...');
    const tokensResponse = await getTokens({ chains: [1] });
    const ethTokens = tokensResponse.tokens[1] || [];
    console.log(`✅ Found ${ethTokens.length} tokens on Ethereum`);
    
    // Find WETH and USDC
    const weth = ethTokens.find(t => t.symbol === 'WETH');
    const usdc = ethTokens.find(t => t.symbol === 'USDC');
    
    console.log('\nWETH:', weth ? { 
      symbol: weth.symbol, 
      address: weth.address,
      decimals: weth.decimals 
    } : 'NOT FOUND');
    
    console.log('USDC:', usdc ? { 
      symbol: usdc.symbol, 
      address: usdc.address,
      decimals: usdc.decimals 
    } : 'NOT FOUND');
    
    // Test 3: Get quote
    if (weth && usdc) {
      console.log('\n3. Testing getQuote() for WETH -> USDC...');
      
      const quoteRequest = {
        fromChain: '1',
        toChain: '1',
        fromToken: weth.address,
        toToken: usdc.address,
        fromAmount: '1000000000000000000', // 1 WETH
        fromAddress: '0x0000000000000000000000000000000000000001',
        toAddress: '0x0000000000000000000000000000000000000001',
        slippage: 0.005, // 0.5%
        integrator: 'test-integration'
      };
      
      console.log('Quote request:', quoteRequest);
      
      try {
        const quoteResponse = await getQuote(quoteRequest);
        console.log('✅ Quote received!');
        
        if (quoteResponse.routes && quoteResponse.routes.length > 0) {
          const route = quoteResponse.routes[0];
          console.log('\nBest route:');
          console.log('- From amount:', route.fromAmount);
          console.log('- To amount:', route.toAmount);
          console.log('- To amount min:', route.toAmountMin);
          console.log('- Steps:', route.steps.length);
          console.log('- Gas cost USD:', route.gasCostUSD || 'N/A');
          
          // Show steps
          route.steps.forEach((step, i) => {
            console.log(`\nStep ${i + 1}:`, {
              type: step.type,
              tool: step.tool,
              fromToken: step.action?.fromToken?.symbol,
              toToken: step.action?.toToken?.symbol,
              fromAmount: step.action?.fromAmount,
              toAmount: step.estimate?.toAmount
            });
          });
        } else {
          console.log('❌ No routes found in response');
        }
      } catch (quoteError) {
        console.log('❌ Quote error:', quoteError.message);
        if (quoteError.response?.data) {
          console.log('Error details:', JSON.stringify(quoteError.response.data, null, 2));
        }
      }
    }
    
    // Test 4: Try with token addresses from the test
    console.log('\n4. Testing with exact addresses from the failing test...');
    const testQuoteRequest = {
      fromChain: '1',
      toChain: '1',
      fromToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      toToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      fromAmount: '1000000000000000000',
      fromAddress: '0x0000000000000000000000000000000000000001',
      toAddress: '0x0000000000000000000000000000000000000001',
      slippage: 0.005,
      integrator: 'test-integration'
    };
    
    try {
      const testQuote = await getQuote(testQuoteRequest);
      if (testQuote.routes && testQuote.routes.length > 0) {
        console.log('✅ Quote works with test addresses!');
        console.log('To amount:', testQuote.routes[0].toAmount);
      } else {
        console.log('❌ No routes with test addresses');
      }
    } catch (error) {
      console.log('❌ Error with test addresses:', error.message);
    }
    
  } catch (error) {
    console.error('Error:', error.message);
    if (error.response?.data) {
      console.error('Response data:', error.response.data);
    }
  }
}

testLiFi().catch(console.error);