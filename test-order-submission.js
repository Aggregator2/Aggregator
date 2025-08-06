// Test order submission with JWT auth
const fetch = require('node-fetch');

// Generate test JWT token
function generateTestJWT(walletAddress) {
  const payload = {
    userId: walletAddress.toLowerCase(),
    email: `${walletAddress.toLowerCase()}@wallet.local`,
    role: 'user',
    exp: Date.now() + 86400000, // 24 hours
    iat: Date.now()
  };

  const header = Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'HS256' })).toString('base64');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64');
  const signature = Buffer.from('test-signature-' + walletAddress).toString('base64');
  
  return `${header}.${payloadB64}.${signature}`;
}

async function testOrderSubmission() {
  const walletAddress = '0x742d35Cc6634C0532925a3b844Bc9e7595f8fa49';
  const token = generateTestJWT(walletAddress);
  
  // Sample order data matching what SwapWidget sends
  const orderData = {
    order: {
      sellToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
      buyToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
      sellAmount: '1000000000000000000', // 1 ETH
      buyAmount: '2000000000', // 2000 USDC
      validTo: Math.floor(Date.now() / 1000) + 1800,
      user: walletAddress,
      receiver: walletAddress,
      wallet: walletAddress,
      appData: '0x' + '00'.repeat(32),
      feeAmount: '0',
      partiallyFillable: false,
      kind: 'sell',
      signingScheme: 'eip712',
      nonce: Date.now()
    },
    signature: '0x' + 'ff'.repeat(65) // Mock signature
  };

  try {
    console.log('Testing order submission...\n');
    console.log('JWT Token:', token);
    console.log('\nOrder Data:', JSON.stringify(orderData, null, 2));
    
    const response = await fetch('http://localhost:3000/api/submitOrder', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(orderData)
    });

    const responseText = await response.text();
    let result;
    try {
      result = JSON.parse(responseText);
    } catch (e) {
      console.log('Raw response:', responseText);
      throw new Error('Failed to parse JSON response');
    }
    
    console.log('\nResponse Status:', response.status);
    console.log('Response:', JSON.stringify(result, null, 2));
    
    if (response.ok) {
      console.log('\n✅ Order submitted successfully!');
      console.log('Order ID:', result.orderId);
    } else {
      console.log('\n❌ Order submission failed!');
      console.log('Error:', result.error);
    }
  } catch (error) {
    console.error('\n❌ Request failed:', error.message);
  }
}

// Check if server is running
fetch('http://localhost:3000/api/health')
  .then(() => {
    console.log('Server is running. Testing order submission...\n');
    return testOrderSubmission();
  })
  .catch(() => {
    console.log('Server is not running. Please start the server first.');
  });