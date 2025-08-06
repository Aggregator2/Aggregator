// Comprehensive test suite for swap functionality
const fetch = require('node-fetch');
const crypto = require('crypto');

// Color codes for output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

// Test utilities
function log(message, type = 'info') {
  const prefix = {
    success: `${colors.green}✅`,
    error: `${colors.red}❌`,
    warning: `${colors.yellow}⚠️`,
    info: `${colors.blue}ℹ️`
  };
  console.log(`${prefix[type] || prefix.info} ${message}${colors.reset}`);
}

function generateTestJWT(walletAddress, options = {}) {
  const payload = {
    userId: walletAddress.toLowerCase(),
    email: `${walletAddress.toLowerCase()}@wallet.local`,
    role: options.role || 'user',
    exp: options.expired ? Date.now() - 1000 : Date.now() + 86400000,
    iat: Date.now()
  };

  const header = Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'HS256' })).toString('base64');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64');
  const signature = Buffer.from('test-signature-' + walletAddress).toString('base64');
  
  return `${header}.${payloadB64}.${signature}`;
}

// Test cases
const testCases = {
  // 1. Authentication Tests
  async testAuthenticationFlow() {
    log('Testing Authentication Flow', 'info');
    
    const walletAddress = '0x742d35Cc6634C0532925a3b844Bc9e7595f8fa49';
    
    // Test 1: Valid JWT generation
    const validToken = generateTestJWT(walletAddress);
    log('Generated valid JWT token', 'success');
    
    // Test 2: Expired JWT
    const expiredToken = generateTestJWT(walletAddress, { expired: true });
    log('Generated expired JWT token', 'success');
    
    // Test 3: Invalid token format
    const invalidToken = 'invalid.token.format';
    
    // Test authentication with valid token
    try {
      const response = await fetch('http://localhost:3000/api/orders/history', {
        headers: { 'Authorization': `Bearer ${validToken}` }
      });
      
      if (response.ok) {
        log('Valid token accepted', 'success');
      } else {
        log(`Valid token rejected: ${response.status}`, 'error');
        return false;
      }
    } catch (error) {
      log(`Auth test failed: ${error.message}`, 'error');
      return false;
    }
    
    // Test with expired token
    try {
      const response = await fetch('http://localhost:3000/api/orders/history', {
        headers: { 'Authorization': `Bearer ${expiredToken}` }
      });
      
      if (!response.ok && response.status === 401) {
        log('Expired token correctly rejected', 'success');
      } else {
        log('Expired token not properly rejected', 'error');
        return false;
      }
    } catch (error) {
      log(`Expired token test failed: ${error.message}`, 'error');
      return false;
    }
    
    // Test without token
    try {
      const response = await fetch('http://localhost:3000/api/submitOrder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      
      if (!response.ok && response.status === 401) {
        log('Missing token correctly rejected', 'success');
      } else {
        log('Missing token not properly rejected', 'error');
        return false;
      }
    } catch (error) {
      log(`No token test failed: ${error.message}`, 'error');
      return false;
    }
    
    return true;
  },

  // 2. Order Submission Tests
  async testOrderSubmission() {
    log('Testing Order Submission', 'info');
    
    const walletAddress = '0x742d35Cc6634C0532925a3b844Bc9e7595f8fa49';
    const token = generateTestJWT(walletAddress);
    const results = [];
    
    // Test 1: Valid order submission
    const validOrder = {
      order: {
        sellToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        buyToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        sellAmount: '1000000000000000000',
        buyAmount: '2000000000',
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
      signature: '0x' + 'ff'.repeat(65)
    };
    
    try {
      const response = await fetch('http://localhost:3000/api/submitOrder', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(validOrder)
      });
      
      const result = await response.json();
      
      if (response.ok && result.orderId) {
        log(`Valid order submitted: ${result.orderId}`, 'success');
        results.push({ orderId: result.orderId, status: 'success' });
      } else {
        log(`Valid order submission failed: ${JSON.stringify(result)}`, 'error');
        return false;
      }
    } catch (error) {
      log(`Order submission test failed: ${error.message}`, 'error');
      return false;
    }
    
    // Test 2: Missing required fields
    const invalidOrder = {
      order: {
        sellToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        // Missing other required fields
      },
      signature: '0x' + 'ff'.repeat(65)
    };
    
    try {
      const response = await fetch('http://localhost:3000/api/submitOrder', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(invalidOrder)
      });
      
      if (!response.ok) {
        log('Invalid order correctly rejected', 'success');
      } else {
        log('Invalid order not properly rejected', 'error');
        return false;
      }
    } catch (error) {
      log(`Invalid order test failed: ${error.message}`, 'error');
      return false;
    }
    
    // Test 3: Different order types
    const buyOrder = {
      ...validOrder,
      order: {
        ...validOrder.order,
        kind: 'buy',
        nonce: Date.now() + 1
      }
    };
    
    try {
      const response = await fetch('http://localhost:3000/api/submitOrder', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(buyOrder)
      });
      
      const result = await response.json();
      
      if (response.ok && result.orderId) {
        log(`Buy order submitted: ${result.orderId}`, 'success');
        results.push({ orderId: result.orderId, status: 'success' });
      }
    } catch (error) {
      log(`Buy order test failed: ${error.message}`, 'error');
    }
    
    return results;
  },

  // 3. Order Status Tests
  async testOrderStatus(orderIds) {
    log('Testing Order Status Updates', 'info');
    
    const walletAddress = '0x742d35Cc6634C0532925a3b844Bc9e7595f8fa49';
    const token = generateTestJWT(walletAddress);
    
    if (!orderIds || orderIds.length === 0) {
      log('No orders to test status', 'warning');
      return true;
    }
    
    const orderId = orderIds[0].orderId;
    
    // Test 1: Get initial order status
    try {
      const response = await fetch(`http://localhost:3000/api/orders/${orderId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (!response.ok) {
        log(`Failed to get order status: ${response.status}`, 'error');
        return false;
      }
      
      const order = await response.json();
      log(`Initial order status: ${order.status}`, 'success');
      
      // Test 2: Wait for status update
      log('Waiting 3 seconds for order to be filled...', 'info');
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const updatedResponse = await fetch(`http://localhost:3000/api/orders/${orderId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (!updatedResponse.ok) {
        log('Failed to get updated order status', 'error');
        return false;
      }
      
      const updatedOrder = await updatedResponse.json();
      
      if (updatedOrder.status === 'filled') {
        log('Order status updated to filled', 'success');
      } else {
        log(`Order status not updated: ${updatedOrder.status}`, 'warning');
      }
      
      // Test 3: Get non-existent order
      const fakeOrderId = 'order_fake_123';
      const fakeResponse = await fetch(`http://localhost:3000/api/orders/${fakeOrderId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (!fakeResponse.ok && fakeResponse.status === 404) {
        log('Non-existent order correctly returns 404', 'success');
      } else {
        log('Non-existent order did not return 404', 'error');
        return false;
      }
      
    } catch (error) {
      log(`Order status test failed: ${error.message}`, 'error');
      return false;
    }
    
    return true;
  },

  // 4. Quote Endpoint Tests
  async testQuoteEndpoint() {
    log('Testing Quote Endpoint', 'info');
    
    // Test 1: Valid quote request
    const validQuoteRequest = {
      sellToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      buyToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      sellAmount: '1000000000000000000',
      chainId: 1,
      slippageTolerance: 0.5
    };
    
    try {
      const response = await fetch('http://localhost:3000/api/quote-profitable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validQuoteRequest)
      });
      
      if (!response.ok) {
        log(`Quote request failed: ${response.status}`, 'error');
        return false;
      }
      
      const quote = await response.json();
      
      // Validate quote response
      const requiredFields = ['sellToken', 'buyToken', 'sellAmount', 'buyAmount', 'price'];
      const missingFields = requiredFields.filter(field => !quote[field]);
      
      if (missingFields.length === 0) {
        log('Valid quote received with all required fields', 'success');
        log(`Price: ${quote.price}, Buy Amount: ${quote.buyAmount}`, 'info');
      } else {
        log(`Quote missing fields: ${missingFields.join(', ')}`, 'error');
        return false;
      }
      
    } catch (error) {
      log(`Quote test failed: ${error.message}`, 'error');
      return false;
    }
    
    // Test 2: Invalid quote request
    const invalidQuoteRequest = {
      sellToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      // Missing required fields
    };
    
    try {
      const response = await fetch('http://localhost:3000/api/quote-profitable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(invalidQuoteRequest)
      });
      
      if (!response.ok && response.status === 400) {
        log('Invalid quote request correctly rejected', 'success');
      } else {
        log('Invalid quote request not properly rejected', 'error');
        return false;
      }
      
    } catch (error) {
      log(`Invalid quote test failed: ${error.message}`, 'error');
      return false;
    }
    
    return true;
  },

  // 5. Order History Tests
  async testOrderHistory() {
    log('Testing Order History', 'info');
    
    const walletAddress = '0x742d35Cc6634C0532925a3b844Bc9e7595f8fa49';
    const token = generateTestJWT(walletAddress);
    
    try {
      const response = await fetch('http://localhost:3000/api/orders/history', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (!response.ok) {
        log(`Failed to get order history: ${response.status}`, 'error');
        return false;
      }
      
      const result = await response.json();
      
      if (result.orders && Array.isArray(result.orders)) {
        log(`Order history retrieved: ${result.orders.length} orders`, 'success');
        
        // Show recent orders
        result.orders.slice(0, 3).forEach(order => {
          log(`  - ${order.id}: ${order.status} (${new Date(order.timestamp).toLocaleTimeString()})`, 'info');
        });
      } else {
        log('Invalid order history response', 'error');
        return false;
      }
      
    } catch (error) {
      log(`Order history test failed: ${error.message}`, 'error');
      return false;
    }
    
    return true;
  },

  // 6. End-to-end Swap Flow Test
  async testFullSwapFlow() {
    log('Testing Complete Swap Flow (End-to-End)', 'info');
    
    const walletAddress = '0x742d35Cc6634C0532925a3b844Bc9e7595f8fa49';
    const token = generateTestJWT(walletAddress);
    
    try {
      // Step 1: Get quote
      log('Step 1: Getting quote...', 'info');
      
      const quoteRequest = {
        sellToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        buyToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        sellAmount: '1000000000000000000',
        chainId: 1,
        slippageTolerance: 0.5
      };
      
      const quoteResponse = await fetch('http://localhost:3000/api/quote-profitable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(quoteRequest)
      });
      
      if (!quoteResponse.ok) {
        log('Failed to get quote', 'error');
        return false;
      }
      
      const quote = await quoteResponse.json();
      log(`Quote received: 1 ETH = ${quote.buyAmount} USDC`, 'success');
      
      // Step 2: Submit order
      log('Step 2: Submitting order...', 'info');
      
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
        signature: '0x' + crypto.randomBytes(65).toString('hex')
      };
      
      const submitResponse = await fetch('http://localhost:3000/api/submitOrder', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(orderData)
      });
      
      if (!submitResponse.ok) {
        log('Failed to submit order', 'error');
        return false;
      }
      
      const submitResult = await submitResponse.json();
      log(`Order submitted: ${submitResult.orderId}`, 'success');
      
      // Step 3: Monitor order status
      log('Step 3: Monitoring order status...', 'info');
      
      let attempts = 0;
      let orderFilled = false;
      
      while (attempts < 5 && !orderFilled) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const statusResponse = await fetch(`http://localhost:3000/api/orders/${submitResult.orderId}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (statusResponse.ok) {
          const order = await statusResponse.json();
          log(`  Status check ${attempts + 1}: ${order.status}`, 'info');
          
          if (order.status === 'filled') {
            orderFilled = true;
            log('Order filled successfully!', 'success');
          }
        }
        
        attempts++;
      }
      
      if (!orderFilled) {
        log('Order was not filled within timeout', 'warning');
      }
      
      // Step 4: Verify in order history
      log('Step 4: Verifying in order history...', 'info');
      
      const historyResponse = await fetch('http://localhost:3000/api/orders/history', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (historyResponse.ok) {
        const history = await historyResponse.json();
        const ourOrder = history.orders.find(o => o.id === submitResult.orderId);
        
        if (ourOrder) {
          log('Order found in history', 'success');
          log(`  Final status: ${ourOrder.status}`, 'info');
        } else {
          log('Order not found in history', 'error');
          return false;
        }
      }
      
      log('End-to-end swap flow completed successfully!', 'success');
      return true;
      
    } catch (error) {
      log(`End-to-end test failed: ${error.message}`, 'error');
      return false;
    }
  }
};

// Main test runner
async function runAllTests() {
  console.log('\n' + '='.repeat(60));
  console.log(`${colors.blue}🧪 Comprehensive Swap Widget Test Suite${colors.reset}`);
  console.log('='.repeat(60) + '\n');
  
  const results = {
    passed: 0,
    failed: 0,
    total: 0
  };
  
  // Check if server is running
  try {
    const healthResponse = await fetch('http://localhost:3000/api/health');
    if (!healthResponse.ok) throw new Error('Server not healthy');
    log('Server is running and healthy', 'success');
  } catch (error) {
    log('Server is not running. Please start the server first.', 'error');
    return;
  }
  
  // Run all tests
  const testOrder = [
    'testAuthenticationFlow',
    'testQuoteEndpoint',
    'testOrderSubmission',
    'testOrderStatus',
    'testOrderHistory',
    'testFullSwapFlow'
  ];
  
  let orderIds = [];
  
  for (const testName of testOrder) {
    console.log('\n' + '-'.repeat(40));
    results.total++;
    
    try {
      let success = false;
      
      if (testName === 'testOrderStatus') {
        success = await testCases[testName](orderIds);
      } else if (testName === 'testOrderSubmission') {
        const submissionResults = await testCases[testName]();
        success = submissionResults !== false;
        if (success && Array.isArray(submissionResults)) {
          orderIds = submissionResults;
        }
      } else {
        success = await testCases[testName]();
      }
      
      if (success) {
        results.passed++;
        log(`${testName} PASSED`, 'success');
      } else {
        results.failed++;
        log(`${testName} FAILED`, 'error');
      }
    } catch (error) {
      results.failed++;
      log(`${testName} FAILED: ${error.message}`, 'error');
    }
  }
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log(`${colors.blue}📊 Test Results Summary${colors.reset}`);
  console.log('='.repeat(60));
  console.log(`Total Tests: ${results.total}`);
  console.log(`${colors.green}Passed: ${results.passed}${colors.reset}`);
  console.log(`${colors.red}Failed: ${results.failed}${colors.reset}`);
  console.log(`Success Rate: ${((results.passed / results.total) * 100).toFixed(1)}%`);
  
  if (results.failed === 0) {
    console.log(`\n${colors.green}🎉 All tests passed! The swap flow is working perfectly!${colors.reset}`);
  } else {
    console.log(`\n${colors.red}⚠️  Some tests failed. Please check the logs above.${colors.reset}`);
  }
  
  console.log('\n' + '='.repeat(60) + '\n');
}

// Run the tests
runAllTests().catch(error => {
  console.error('Test suite failed:', error);
  process.exit(1);
});