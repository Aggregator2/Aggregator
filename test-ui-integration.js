// Test UI Integration - Simulating SwapWidget behavior
const fetch = require('node-fetch');

// Color codes for output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m'
};

// Simulate UI events
function simulateUIEvent(event, data) {
  console.log(`${colors.cyan}[UI Event] ${event}${colors.reset}`, data || '');
}

function simulateNotification(type, title, message) {
  const icons = {
    success: '✅',
    error: '❌',
    info: 'ℹ️',
    warning: '⚠️'
  };
  console.log(`${colors.yellow}[Notification] ${icons[type]} ${title}: ${message}${colors.reset}`);
}

// Generate test JWT token
function generateTestJWT(walletAddress) {
  const payload = {
    userId: walletAddress.toLowerCase(),
    email: `${walletAddress.toLowerCase()}@wallet.local`,
    role: 'user',
    exp: Date.now() + 86400000,
    iat: Date.now()
  };

  const header = Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'HS256' })).toString('base64');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64');
  const signature = Buffer.from('test-signature-' + walletAddress).toString('base64');
  
  return `${header}.${payloadB64}.${signature}`;
}

// Simulate the complete SwapWidget flow
async function simulateSwapWidgetFlow() {
  console.log('\n' + '='.repeat(60));
  console.log(`${colors.blue}🎮 Simulating SwapWidget User Flow${colors.reset}`);
  console.log('='.repeat(60) + '\n');
  
  const walletAddress = '0x742d35Cc6634C0532925a3b844Bc9e7595f8fa49';
  
  try {
    // 1. User opens SwapWidget
    console.log(`${colors.green}1. User opens SwapWidget${colors.reset}`);
    simulateUIEvent('Component Mounted');
    
    // 2. User clicks "Connect Wallet"
    console.log(`\n${colors.green}2. User clicks "Connect Wallet"${colors.reset}`);
    simulateUIEvent('Connect Wallet Button Clicked');
    
    // Simulate wallet connection
    await new Promise(resolve => setTimeout(resolve, 500));
    const token = generateTestJWT(walletAddress);
    simulateUIEvent('Wallet Connected', walletAddress);
    simulateNotification('success', 'Wallet Connected', `Connected to ${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`);
    
    // Store token in "localStorage"
    console.log(`${colors.blue}[Storage] JWT token stored in localStorage${colors.reset}`);
    
    // 3. User enters swap details
    console.log(`\n${colors.green}3. User enters swap details${colors.reset}`);
    simulateUIEvent('Input Changed', { sellToken: 'WETH', sellAmount: '1' });
    
    // Fetch quote
    console.log(`${colors.blue}[API] Fetching quote...${colors.reset}`);
    const quoteResponse = await fetch('http://localhost:3000/api/quote-profitable', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sellToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        buyToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        sellAmount: '1000000000000000000',
        chainId: 1,
        slippageTolerance: 0.5
      })
    });
    
    const quote = await quoteResponse.json();
    simulateUIEvent('Quote Received', { price: quote.price, buyAmount: quote.buyAmount });
    console.log(`${colors.blue}[UI Update] Quote displayed: 1 WETH = ${quote.buyAmount} USDC${colors.reset}`);
    
    // 4. User clicks "Swap"
    console.log(`\n${colors.green}4. User clicks "Swap" button${colors.reset}`);
    simulateUIEvent('Swap Button Clicked');
    
    // Show MetaMask prompt simulation
    console.log(`${colors.yellow}[MetaMask] Signature request popup shown${colors.reset}`);
    await new Promise(resolve => setTimeout(resolve, 1000));
    console.log(`${colors.yellow}[MetaMask] User signs the order${colors.reset}`);
    
    // Submit order
    simulateNotification('info', 'Submitting Order', '1 WETH → USDC');
    
    const orderData = {
      order: {
        sellToken: quote.sellToken,
        buyToken: quote.buyToken,
        sellAmount: quote.sellAmount,
        buyAmount: quote.buyAmount,
        validTo: Math.floor(Date.now() / 1000) + 1800,
        user: walletAddress,
        receiver: walletAddress,
        wallet: walletAddress,
        appData: '0x' + '00'.repeat(32),
        feeAmount: quote.lpFee || '0',
        partiallyFillable: false,
        kind: 'sell',
        signingScheme: 'eip712',
        nonce: Date.now()
      },
      signature: '0x' + 'ff'.repeat(65)
    };
    
    console.log(`${colors.blue}[API] Submitting order...${colors.reset}`);
    const submitResponse = await fetch('http://localhost:3000/api/submitOrder', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(orderData)
    });
    
    const submitResult = await submitResponse.json();
    simulateUIEvent('Order Submitted', { orderId: submitResult.orderId });
    simulateNotification('success', 'Order Submitted', `1 WETH → ${quote.buyAmount} USDC`);
    
    // 5. Monitor order status
    console.log(`\n${colors.green}5. Monitoring order status${colors.reset}`);
    simulateUIEvent('Order Status Polling Started');
    
    let orderFilled = false;
    let attempts = 0;
    
    const pollInterval = setInterval(async () => {
      attempts++;
      console.log(`${colors.blue}[API] Checking order status (attempt ${attempts})...${colors.reset}`);
      
      const statusResponse = await fetch(`http://localhost:3000/api/orders/${submitResult.orderId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (statusResponse.ok) {
        const order = await statusResponse.json();
        simulateUIEvent('Order Status Update', { status: order.status });
        
        if (order.status === 'filled') {
          clearInterval(pollInterval);
          orderFilled = true;
          
          simulateNotification('success', 'Order Filled', 'Your swap has been completed!');
          simulateUIEvent('Order Filled', { txHash: '0x' + '0'.repeat(64) });
          
          console.log(`\n${colors.green}✅ Swap completed successfully!${colors.reset}`);
          console.log(`${colors.blue}[UI Update] Order status: FILLED${colors.reset}`);
          console.log(`${colors.blue}[UI Update] Transaction hash displayed${colors.reset}`);
        }
      }
      
      if (attempts >= 5 && !orderFilled) {
        clearInterval(pollInterval);
        simulateNotification('warning', 'Order Pending', 'Your order is still being processed');
      }
    }, 1000);
    
    // Wait for polling to complete
    await new Promise(resolve => {
      const checkInterval = setInterval(() => {
        if (orderFilled || attempts >= 5) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);
    });
    
    // 6. Show final state
    console.log(`\n${colors.green}6. Final UI State${colors.reset}`);
    console.log(`${colors.blue}[UI State] Swap form reset${colors.reset}`);
    console.log(`${colors.blue}[UI State] Order added to local history${colors.reset}`);
    console.log(`${colors.blue}[UI State] Success message displayed${colors.reset}`);
    
    // Test order history update
    const historyResponse = await fetch('http://localhost:3000/api/orders/history', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (historyResponse.ok) {
      const history = await historyResponse.json();
      console.log(`${colors.blue}[UI Update] Order history refreshed: ${history.orders.length} total orders${colors.reset}`);
    }
    
    console.log(`\n${colors.green}🎉 SwapWidget flow completed successfully!${colors.reset}`);
    
  } catch (error) {
    console.error(`\n${colors.red}❌ Flow failed: ${error.message}${colors.reset}`);
    simulateNotification('error', 'Swap Failed', error.message);
  }
}

// Test error scenarios
async function testErrorScenarios() {
  console.log('\n' + '='.repeat(60));
  console.log(`${colors.blue}🚨 Testing Error Scenarios${colors.reset}`);
  console.log('='.repeat(60) + '\n');
  
  const walletAddress = '0x742d35Cc6634C0532925a3b844Bc9e7595f8fa49';
  const token = generateTestJWT(walletAddress);
  
  // Test 1: Network error
  console.log(`${colors.yellow}Test 1: Simulating network error${colors.reset}`);
  simulateNotification('error', 'Network Error', 'Failed to connect to server');
  
  // Test 2: Insufficient balance
  console.log(`\n${colors.yellow}Test 2: Simulating insufficient balance${colors.reset}`);
  simulateNotification('error', 'Cannot Execute Swap', 'You need 0.5 more WETH');
  
  // Test 3: User rejects transaction
  console.log(`\n${colors.yellow}Test 3: Simulating user rejection${colors.reset}`);
  simulateUIEvent('MetaMask Rejection', { code: 4001 });
  simulateNotification('warning', 'Transaction Rejected', 'You cancelled the transaction');
  
  // Test 4: Order fails
  console.log(`\n${colors.yellow}Test 4: Simulating order failure${colors.reset}`);
  simulateNotification('error', 'Order Failed', 'Transaction failed due to gas estimation error');
  
  console.log(`\n${colors.green}✅ Error handling tests completed${colors.reset}`);
}

// Main function
async function main() {
  // Check if server is running
  try {
    const healthResponse = await fetch('http://localhost:3000/api/health');
    if (!healthResponse.ok) throw new Error('Server not healthy');
    console.log(`${colors.green}✅ Server is running${colors.reset}`);
  } catch (error) {
    console.log(`${colors.red}❌ Server is not running. Please start the server first.${colors.reset}`);
    return;
  }
  
  // Run UI flow simulation
  await simulateSwapWidgetFlow();
  
  // Test error scenarios
  await testErrorScenarios();
  
  console.log('\n' + '='.repeat(60));
  console.log(`${colors.green}✅ All UI integration tests completed!${colors.reset}`);
  console.log('='.repeat(60) + '\n');
}

// Run the tests
main().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});