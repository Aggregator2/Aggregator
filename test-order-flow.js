// Test complete order flow
const fetch = require('node-fetch');

// Generate test JWT token
function generateTestJWT(walletAddress) {
  const payload = {
    userId: walletAddress.toLowerCase(),
    email: walletAddress.toLowerCase() + '@wallet.local',
    role: 'user',
    exp: Date.now() + 86400000, // 24 hours
    iat: Date.now()
  };

  const header = Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'HS256' })).toString('base64');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64');
  const signature = Buffer.from('test-signature-' + walletAddress).toString('base64');
  
  return header + '.' + payloadB64 + '.' + signature;
}

async function testOrderFlow() {
  const walletAddress = '0x742d35Cc6634C0532925a3b844Bc9e7595f8fa49';
  const token = generateTestJWT(walletAddress);
  
  // Step 1: Submit order
  console.log('Step 1: Submitting order...');
  
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
    const submitResponse = await fetch('http://localhost:3000/api/submitOrder', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify(orderData)
    });

    const submitResult = await submitResponse.json();
    
    if (!submitResponse.ok) {
      console.error('Order submission failed:', submitResult);
      return;
    }
    
    console.log('Order submitted successfully!');
    console.log('Order ID:', submitResult.orderId);
    console.log('Status:', submitResult.status);
    
    // Step 2: Check order status
    console.log('\nStep 2: Checking order status...');
    
    const orderId = submitResult.orderId;
    const statusResponse = await fetch('http://localhost:3000/api/orders/' + orderId, {
      headers: {
        'Authorization': 'Bearer ' + token
      }
    });
    
    if (!statusResponse.ok) {
      console.error('Failed to get order status:', statusResponse.status);
      return;
    }
    
    const orderDetails = await statusResponse.json();
    console.log('Order details retrieved:');
    console.log('- ID:', orderDetails.id);
    console.log('- Status:', orderDetails.status);
    console.log('- Timestamp:', orderDetails.timestamp);
    console.log('- Sell Token:', orderDetails.sellToken);
    console.log('- Buy Token:', orderDetails.buyToken);
    
    // Step 3: Wait and check if status updates
    console.log('\nStep 3: Waiting for order to be filled (simulated)...');
    
    await new Promise(resolve => setTimeout(resolve, 2500)); // Wait 2.5 seconds
    
    const updatedResponse = await fetch('http://localhost:3000/api/orders/' + orderId, {
      headers: {
        'Authorization': 'Bearer ' + token
      }
    });
    
    if (updatedResponse.ok) {
      const updatedOrder = await updatedResponse.json();
      console.log('Updated order status:', updatedOrder.status);
      
      if (updatedOrder.status === 'filled') {
        console.log('Order has been filled!');
      }
    }
    
  } catch (error) {
    console.error('Test failed:', error.message);
  }
}

// Check if server is running
fetch('http://localhost:3000/api/health')
  .then(() => {
    console.log('Server is running. Starting order flow test...\n');
    return testOrderFlow();
  })
  .catch(() => {
    console.log('Server is not running. Please start the server first.');
  });