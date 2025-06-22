const { ethers } = require('ethers');
const axios = require('axios');
const WebSocket = require('ws');
const chalk = require('chalk');

// Configuration
const CONFIG = {
  RPC_URL: process.env.RPC_URL || 'http://localhost:8545',
  API_BASE_URL: process.env.API_BASE_URL || 'http://localhost:3000/api',
  WS_URL: process.env.WS_URL || 'ws://localhost:3001',
  PRIVATE_KEY: process.env.PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  ESCROW_ADDRESS: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
  TEST_TOKENS: {
    WETH: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1',
    DAI: '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1',
    USDC: '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8',
    WBTC: '0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f'
  }
};

// EIP-712 domain and types
const EIP712_DOMAIN = {
  name: 'MetaAggregator',
  version: '1',
  chainId: 31337,
  verifyingContract: CONFIG.ESCROW_ADDRESS
};

const EIP712_TYPES = {
  Order: [
    { name: 'sellToken', type: 'address' },
    { name: 'buyToken', type: 'address' },
    { name: 'sellAmount', type: 'uint256' },
    { name: 'buyAmount', type: 'uint256' },
    { name: 'validTo', type: 'uint32' },
    { name: 'appData', type: 'bytes32' },
    { name: 'feeAmount', type: 'uint256' },
    { name: 'kind', type: 'string' },
    { name: 'partiallyFillable', type: 'bool' },
    { name: 'receiver', type: 'address' },
    { name: 'user', type: 'address' },
    { name: 'signingScheme', type: 'string' },
    { name: 'nonce', type: 'uint256' },
    { name: 'wallet', type: 'address' }
  ]
};

// Test results tracking
const testResults = {
  totalOrders: 0,
  successfulOrders: 0,
  failedOrders: 0,
  cancelledOrders: 0,
  expiredOrders: 0,
  escrowTriggered: 0,
  settlementMismatches: 0,
  averageExecutionTime: 0,
  orderDetails: []
};

// Initialize provider and wallet
const provider = new ethers.JsonRpcProvider(CONFIG.RPC_URL);
const wallet = new ethers.Wallet(CONFIG.PRIVATE_KEY, provider);

// WebSocket connection for real-time updates
let ws;

/**
 * Connect to WebSocket for real-time order updates
 */
async function connectWebSocket() {
  return new Promise((resolve, reject) => {
    ws = new WebSocket(CONFIG.WS_URL);
    
    ws.on('open', () => {
      console.log(chalk.green('✓ Connected to WebSocket for real-time updates'));
      resolve();
    });
    
    ws.on('error', (error) => {
      console.error(chalk.red('WebSocket error:'), error);
      reject(error);
    });
    
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data);
        handleOrderUpdate(message);
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    });
  });
}

/**
 * Handle real-time order status updates
 */
function handleOrderUpdate(update) {
  console.log(chalk.blue(`[Order Update] ${update.orderId}: ${update.status}`));
  
  // Update order tracking
  const order = testResults.orderDetails.find(o => o.orderId === update.orderId);
  if (order) {
    order.status = update.status;
    order.lastUpdate = Date.now();
    
    if (update.txHash) {
      order.settlementTxHash = update.txHash;
    }
  }
}

/**
 * Create a test order with EIP-712 signature
 */
async function createOrder(sellToken, buyToken, sellAmount, buyAmount) {
  const validTo = Math.floor(Date.now() / 1000) + 3600; // Valid for 1 hour
  const nonce = Math.floor(Math.random() * 1000000);
  
  const order = {
    sellToken,
    buyToken,
    sellAmount: sellAmount.toString(),
    buyAmount: buyAmount.toString(),
    validTo,
    appData: ethers.keccak256(ethers.toUtf8Bytes('test-order')),
    feeAmount: '0',
    kind: 'sell',
    partiallyFillable: false,
    receiver: wallet.address,
    user: wallet.address,
    signingScheme: 'eip712',
    nonce,
    wallet: wallet.address
  };
  
  // Sign order with EIP-712
  const signature = await wallet.signTypedData(EIP712_DOMAIN, EIP712_TYPES, order);
  
  return { order, signature };
}

/**
 * Verify EIP-712 signature
 */
async function verifySignature(order, signature) {
  try {
    const recoveredAddress = ethers.verifyTypedData(
      EIP712_DOMAIN,
      EIP712_TYPES,
      order,
      signature
    );
    
    return recoveredAddress.toLowerCase() === order.user.toLowerCase();
  } catch (error) {
    console.error(chalk.red('Signature verification failed:'), error);
    return false;
  }
}

/**
 * Submit order to solver network
 */
async function submitOrderToSolver(order, signature) {
  try {
    const response = await axios.post(`${CONFIG.API_BASE_URL}/submitOrder`, {
      order,
      signature
    });
    
    return response.data;
  } catch (error) {
    console.error(chalk.red('Failed to submit order:'), error.response?.data || error.message);
    throw error;
  }
}

/**
 * Monitor order status
 */
async function monitorOrderStatus(orderId, timeout = 120000) {
  const startTime = Date.now();
  
  return new Promise((resolve, reject) => {
    const checkInterval = setInterval(async () => {
      try {
        // Check if we have real-time update
        const order = testResults.orderDetails.find(o => o.orderId === orderId);
        if (order && ['completed', 'failed', 'cancelled'].includes(order.status)) {
          clearInterval(checkInterval);
          resolve(order);
          return;
        }
        
        // Timeout check
        if (Date.now() - startTime > timeout) {
          clearInterval(checkInterval);
          reject(new Error('Order monitoring timeout'));
        }
        
        // Poll API for status
        const response = await axios.get(`${CONFIG.API_BASE_URL}/orders/${orderId}`);
        if (response.data && ['completed', 'failed', 'cancelled'].includes(response.data.status)) {
          clearInterval(checkInterval);
          resolve(response.data);
        }
      } catch (error) {
        // Continue monitoring unless critical error
        console.warn('Status check error:', error.message);
      }
    }, 2000); // Check every 2 seconds
  });
}

/**
 * Test order cancellation
 */
async function testOrderCancellation(order, signature) {
  try {
    // Submit cancellation request
    const response = await axios.post(`${CONFIG.API_BASE_URL}/cancelOrder`, {
      orderId: order.orderId,
      signature: await wallet.signMessage(`Cancel order ${order.orderId}`)
    });
    
    return response.data.success;
  } catch (error) {
    console.error(chalk.red('Order cancellation failed:'), error.message);
    return false;
  }
}

/**
 * Test order with expired validity
 */
async function testExpiredOrder() {
  const expiredOrder = await createOrder(
    CONFIG.TEST_TOKENS.WETH,
    CONFIG.TEST_TOKENS.DAI,
    ethers.parseEther('1'),
    ethers.parseEther('2000')
  );
  
  // Set validTo to past timestamp
  expiredOrder.order.validTo = Math.floor(Date.now() / 1000) - 3600;
  
  // Re-sign with expired timestamp
  const signature = await wallet.signTypedData(
    EIP712_DOMAIN,
    EIP712_TYPES,
    expiredOrder.order
  );
  
  try {
    await submitOrderToSolver(expiredOrder.order, signature);
    return false; // Should not succeed
  } catch (error) {
    return error.response?.status === 400; // Should be rejected
  }
}

/**
 * Verify on-chain settlement
 */
async function verifySettlement(order, txHash) {
  try {
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt || receipt.status === 0) {
      return { success: false, reason: 'Transaction failed' };
    }
    
    // Parse logs for transfer events
    const transferTopic = ethers.id('Transfer(address,address,uint256)');
    const transferLogs = receipt.logs.filter(log => log.topics[0] === transferTopic);
    
    // Verify amounts match order
    let sellTokenTransferred = false;
    let buyTokenReceived = false;
    
    for (const log of transferLogs) {
      if (log.address.toLowerCase() === order.sellToken.toLowerCase()) {
        const amount = ethers.toBigInt(log.data);
        if (amount === ethers.toBigInt(order.sellAmount)) {
          sellTokenTransferred = true;
        }
      }
      
      if (log.address.toLowerCase() === order.buyToken.toLowerCase()) {
        const amount = ethers.toBigInt(log.data);
        // Allow for small slippage (0.1%)
        const minAmount = (ethers.toBigInt(order.buyAmount) * 999n) / 1000n;
        if (amount >= minAmount) {
          buyTokenReceived = true;
        }
      }
    }
    
    return {
      success: sellTokenTransferred && buyTokenReceived,
      sellTokenTransferred,
      buyTokenReceived,
      receipt
    };
  } catch (error) {
    console.error(chalk.red('Settlement verification error:'), error);
    return { success: false, reason: error.message };
  }
}

/**
 * Test escrow fallback for failed orders
 */
async function testEscrowFallback() {
  // Create order that will fail (invalid amounts)
  const failOrder = await createOrder(
    CONFIG.TEST_TOKENS.WETH,
    CONFIG.TEST_TOKENS.DAI,
    ethers.parseEther('1000000'), // Unrealistic amount
    ethers.parseEther('1')
  );
  
  try {
    const response = await submitOrderToSolver(failOrder.order, failOrder.signature);
    
    // Monitor for escrow trigger
    const escrowContract = new ethers.Contract(
      CONFIG.ESCROW_ADDRESS,
      ['event OrderDeposited(bytes32 indexed orderHash, address indexed user, uint256 amount)'],
      provider
    );
    
    const orderHash = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['tuple(address,address,uint256,uint256,uint32,bytes32,uint256,string,bool,address,address,string,uint256,address)'],
        [failOrder.order]
      )
    );
    
    return new Promise((resolve) => {
      escrowContract.once('OrderDeposited', (hash, user, amount) => {
        if (hash === orderHash) {
          resolve(true);
        }
      });
      
      // Timeout after 30 seconds
      setTimeout(() => resolve(false), 30000);
    });
  } catch (error) {
    return false;
  }
}

/**
 * Execute a single order test
 */
async function executeOrderTest(sellToken, buyToken, sellAmount, buyAmount, testType = 'normal') {
  const startTime = Date.now();
  const orderId = `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  const orderDetail = {
    orderId,
    sellToken,
    buyToken,
    sellAmount: sellAmount.toString(),
    buyAmount: buyAmount.toString(),
    testType,
    startTime,
    status: 'created'
  };
  
  testResults.orderDetails.push(orderDetail);
  
  try {
    // Step 1: Create and sign order
    console.log(chalk.cyan(`\n[${orderId}] Creating order...`));
    const { order, signature } = await createOrder(sellToken, buyToken, sellAmount, buyAmount);
    order.orderId = orderId;
    
    // Step 2: Verify signature
    console.log(chalk.cyan(`[${orderId}] Verifying signature...`));
    const isValid = await verifySignature(order, signature);
    if (!isValid) {
      throw new Error('Invalid signature');
    }
    console.log(chalk.green(`✓ Signature valid`));
    
    // Step 3: Submit to solver network
    console.log(chalk.cyan(`[${orderId}] Submitting to solver network...`));
    const submission = await submitOrderToSolver(order, signature);
    console.log(chalk.green(`✓ Order accepted: ${submission.status}`));
    orderDetail.status = 'submitted';
    
    // Step 4: Test cancellation (if specified)
    if (testType === 'cancel') {
      console.log(chalk.cyan(`[${orderId}] Testing cancellation...`));
      const cancelled = await testOrderCancellation(order, signature);
      if (cancelled) {
        orderDetail.status = 'cancelled';
        testResults.cancelledOrders++;
        console.log(chalk.yellow(`✓ Order cancelled successfully`));
        return;
      }
    }
    
    // Step 5: Monitor execution
    console.log(chalk.cyan(`[${orderId}] Monitoring execution...`));
    const finalStatus = await monitorOrderStatus(orderId);
    orderDetail.status = finalStatus.status;
    
    if (finalStatus.status === 'completed' && finalStatus.txHash) {
      // Step 6: Verify settlement
      console.log(chalk.cyan(`[${orderId}] Verifying settlement...`));
      const settlement = await verifySettlement(order, finalStatus.txHash);
      
      if (settlement.success) {
        console.log(chalk.green(`✓ Settlement verified`));
        testResults.successfulOrders++;
      } else {
        console.log(chalk.red(`✗ Settlement mismatch`));
        testResults.settlementMismatches++;
      }
      
      orderDetail.settlementVerified = settlement.success;
    } else if (finalStatus.status === 'failed') {
      testResults.failedOrders++;
      
      // Check if escrow was triggered
      if (finalStatus.escrowTriggered) {
        testResults.escrowTriggered++;
        console.log(chalk.yellow(`⚠ Escrow fallback triggered`));
      }
    }
    
    orderDetail.executionTime = Date.now() - startTime;
    console.log(chalk.gray(`Execution time: ${orderDetail.executionTime}ms`));
    
  } catch (error) {
    console.error(chalk.red(`[${orderId}] Test failed:`), error.message);
    orderDetail.status = 'error';
    orderDetail.error = error.message;
    testResults.failedOrders++;
  }
  
  testResults.totalOrders++;
}

/**
 * Run comprehensive order flow tests
 */
async function runTests() {
  console.log(chalk.bold.cyan('\n🚀 Starting Comprehensive Order Flow Tests\n'));
  
  try {
    // Connect to WebSocket for real-time updates
    await connectWebSocket();
    
    // Test 1: Expired order rejection
    console.log(chalk.bold('\n📋 Test 1: Order Expiry Enforcement'));
    const expiredRejected = await testExpiredOrder();
    if (expiredRejected) {
      console.log(chalk.green('✓ Expired orders are properly rejected'));
      testResults.expiredOrders++;
    } else {
      console.log(chalk.red('✗ Expired order was not rejected'));
    }
    
    // Test 2: Normal orders with different token pairs
    console.log(chalk.bold('\n📋 Test 2: Normal Order Execution (10 orders)'));
    const tokenPairs = [
      { sell: 'WETH', buy: 'DAI', sellAmount: '1', buyAmount: '2000' },
      { sell: 'DAI', buy: 'USDC', sellAmount: '1000', buyAmount: '1000' },
      { sell: 'USDC', buy: 'WETH', sellAmount: '2000', buyAmount: '1' },
      { sell: 'WETH', buy: 'WBTC', sellAmount: '10', buyAmount: '0.5' },
      { sell: 'WBTC', buy: 'DAI', sellAmount: '0.1', buyAmount: '4000' }
    ];
    
    for (let i = 0; i < 10; i++) {
      const pair = tokenPairs[i % tokenPairs.length];
      await executeOrderTest(
        CONFIG.TEST_TOKENS[pair.sell],
        CONFIG.TEST_TOKENS[pair.buy],
        ethers.parseEther(pair.sellAmount),
        ethers.parseEther(pair.buyAmount),
        'normal'
      );
      
      // Small delay between orders
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    // Test 3: Order cancellation
    console.log(chalk.bold('\n📋 Test 3: Order Cancellation (3 orders)'));
    for (let i = 0; i < 3; i++) {
      await executeOrderTest(
        CONFIG.TEST_TOKENS.WETH,
        CONFIG.TEST_TOKENS.DAI,
        ethers.parseEther('0.5'),
        ethers.parseEther('1000'),
        'cancel'
      );
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Test 4: Failed orders with escrow fallback
    console.log(chalk.bold('\n📋 Test 4: Escrow Fallback Test'));
    const escrowTriggered = await testEscrowFallback();
    if (escrowTriggered) {
      console.log(chalk.green('✓ Escrow fallback works correctly'));
      testResults.escrowTriggered++;
    } else {
      console.log(chalk.yellow('⚠ Escrow fallback not triggered (might be disabled)'));
    }
    
    // Test 5: High-frequency orders
    console.log(chalk.bold('\n📋 Test 5: High-Frequency Orders (7 orders)'));
    const promises = [];
    for (let i = 0; i < 7; i++) {
      promises.push(
        executeOrderTest(
          CONFIG.TEST_TOKENS.DAI,
          CONFIG.TEST_TOKENS.USDC,
          ethers.parseEther('100'),
          ethers.parseEther('100'),
          'normal'
        )
      );
    }
    await Promise.all(promises);
    
  } catch (error) {
    console.error(chalk.red('Test suite error:'), error);
  }
  
  // Calculate statistics
  const successRate = (testResults.successfulOrders / testResults.totalOrders * 100).toFixed(2);
  const avgExecutionTime = testResults.orderDetails
    .filter(o => o.executionTime)
    .reduce((sum, o) => sum + o.executionTime, 0) / testResults.totalOrders;
  
  // Print results summary
  console.log(chalk.bold.cyan('\n📊 Test Results Summary\n'));
  console.log(chalk.white('Total Orders:'), testResults.totalOrders);
  console.log(chalk.green('Successful Orders:'), testResults.successfulOrders);
  console.log(chalk.red('Failed Orders:'), testResults.failedOrders);
  console.log(chalk.yellow('Cancelled Orders:'), testResults.cancelledOrders);
  console.log(chalk.yellow('Expired Orders Rejected:'), testResults.expiredOrders);
  console.log(chalk.blue('Escrow Fallbacks:'), testResults.escrowTriggered);
  console.log(chalk.red('Settlement Mismatches:'), testResults.settlementMismatches);
  console.log(chalk.white('Success Rate:'), `${successRate}%`);
  console.log(chalk.white('Avg Execution Time:'), `${avgExecutionTime.toFixed(0)}ms`);
  
  // Detailed order breakdown
  console.log(chalk.bold.cyan('\n📋 Detailed Order Results\n'));
  const ordersByStatus = {
    completed: [],
    failed: [],
    cancelled: [],
    error: []
  };
  
  testResults.orderDetails.forEach(order => {
    if (ordersByStatus[order.status]) {
      ordersByStatus[order.status].push(order);
    }
  });
  
  Object.entries(ordersByStatus).forEach(([status, orders]) => {
    if (orders.length > 0) {
      console.log(chalk.bold(`\n${status.toUpperCase()} (${orders.length}):`));
      orders.forEach(order => {
        console.log(`- ${order.orderId}: ${order.sellToken.slice(-6)} → ${order.buyToken.slice(-6)}`);
        if (order.error) {
          console.log(`  Error: ${order.error}`);
        }
        if (order.executionTime) {
          console.log(`  Time: ${order.executionTime}ms`);
        }
      });
    }
  });
  
  // Close WebSocket
  if (ws) {
    ws.close();
  }
  
  // Exit with appropriate code
  process.exit(testResults.failedOrders > 0 ? 1 : 0);
}

// Run tests
runTests().catch(console.error);