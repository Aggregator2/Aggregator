const fetch = require('node-fetch');

async function test0xDirect() {
  console.log('Testing 0x API directly...\n');
  
  const params = new URLSearchParams({
    sellToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
    buyToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',  // USDC
    sellAmount: '1000000000000000000', // 1 WETH
    slippagePercentage: '1',
  });

  const headers = {
    'Accept': 'application/json',
  };
  
  // Add API key if available
  if (process.env.ZEROX_API_KEY) {
    headers['0x-api-key'] = process.env.ZEROX_API_KEY;
    console.log('Using 0x API key:', process.env.ZEROX_API_KEY.substring(0, 8) + '...');
  }

  try {
    const url = `https://api.0x.org/swap/v1/quote?${params}`;
    console.log('Calling:', url);
    
    const response = await fetch(url, { headers });
    
    console.log('Response status:', response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.log('Error response:', errorText);
    } else {
      const data = await response.json();
      console.log('Success! Buy amount:', data.buyAmount);
      console.log('Price:', data.price);
    }
  } catch (error) {
    console.error('Request failed:', error.message);
  }
}

test0xDirect().catch(console.error);