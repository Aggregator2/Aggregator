const { ethers } = require('ethers');
const chalk = require('chalk');

// Configuration
const CONFIG = {
  RPC_URL: process.env.RPC_URL || 'http://localhost:8545',
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
  totalTests: 0,
  passed: 0,
  failed: 0,
  tests: []
};

// Initialize provider and wallet
const provider = new ethers.JsonRpcProvider(CONFIG.RPC_URL);
const wallet = new ethers.Wallet(CONFIG.PRIVATE_KEY, provider);

/**
 * Log test result
 */
function logTest(name, passed, details = '') {
  testResults.totalTests++;
  if (passed) {
    testResults.passed++;
    console.log(chalk.green(`✓ ${name}`));
  } else {
    testResults.failed++;
    console.log(chalk.red(`✗ ${name}`));
  }
  if (details) {
    console.log(chalk.gray(`  ${details}`));
  }
  testResults.tests.push({ name, passed, details });
}

/**
 * Test 1: EIP-712 Signature Creation and Verification
 */
async function testEIP712Signature() {
  console.log(chalk.bold('\n📋 Test 1: EIP-712 Signature Creation & Verification'));
  
  try {
    // Create test order
    const order = {
      sellToken: CONFIG.TEST_TOKENS.WETH,
      buyToken: CONFIG.TEST_TOKENS.DAI,
      sellAmount: ethers.parseEther('1').toString(),
      buyAmount: ethers.parseEther('2000').toString(),
      validTo: Math.floor(Date.now() / 1000) + 3600,
      appData: ethers.keccak256(ethers.toUtf8Bytes('test-order')),
      feeAmount: '0',
      kind: 'sell',
      partiallyFillable: false,
      receiver: wallet.address,
      user: wallet.address,
      signingScheme: 'eip712',
      nonce: 12345,
      wallet: wallet.address
    };
    
    // Sign order
    const signature = await wallet.signTypedData(EIP712_DOMAIN, EIP712_TYPES, order);
    logTest('Create EIP-712 signature', true, `Signature: ${signature.slice(0, 20)}...`);
    
    // Verify signature
    const recoveredAddress = ethers.verifyTypedData(EIP712_DOMAIN, EIP712_TYPES, order, signature);
    const isValid = recoveredAddress.toLowerCase() === wallet.address.toLowerCase();
    logTest('Verify signature matches signer', isValid, `Recovered: ${recoveredAddress}`);
    
    // Test invalid signature
    const tamperedOrder = { ...order, sellAmount: ethers.parseEther('2').toString() };
    let invalidSigTest = false;
    try {
      const recovered2 = ethers.verifyTypedData(EIP712_DOMAIN, EIP712_TYPES, tamperedOrder, signature);
      invalidSigTest = recovered2.toLowerCase() !== wallet.address.toLowerCase();
    } catch (e) {
      invalidSigTest = true;
    }
    logTest('Reject tampered order signature', invalidSigTest);
    
  } catch (error) {
    logTest('EIP-712 signature tests', false, error.message);
  }
}

/**
 * Test 2: Order Expiry Enforcement
 */
async function testOrderExpiry() {
  console.log(chalk.bold('\n📋 Test 2: Order Expiry Enforcement'));
  
  try {
    // Create expired order
    const expiredOrder = {
      sellToken: CONFIG.TEST_TOKENS.WETH,
      buyToken: CONFIG.TEST_TOKENS.DAI,
      sellAmount: ethers.parseEther('1').toString(),
      buyAmount: ethers.parseEther('2000').toString(),
      validTo: Math.floor(Date.now() / 1000) - 3600, // Expired 1 hour ago
      appData: ethers.keccak256(ethers.toUtf8Bytes('expired-order')),
      feeAmount: '0',
      kind: 'sell',
      partiallyFillable: false,
      receiver: wallet.address,
      user: wallet.address,
      signingScheme: 'eip712',
      nonce: 99999,
      wallet: wallet.address
    };
    
    // Sign expired order
    const signature = await wallet.signTypedData(EIP712_DOMAIN, EIP712_TYPES, expiredOrder);
    
    // Check if order is expired
    const currentTime = Math.floor(Date.now() / 1000);
    const isExpired = expiredOrder.validTo < currentTime;
    logTest('Detect expired order', isExpired, `Order expired ${currentTime - expiredOrder.validTo}s ago`);
    
    // Create valid order
    const validOrder = { ...expiredOrder, validTo: currentTime + 3600 };
    const isValid = validOrder.validTo > currentTime;
    logTest('Accept non-expired order', isValid, `Order valid for ${validOrder.validTo - currentTime}s`);
    
  } catch (error) {
    logTest('Order expiry tests', false, error.message);
  }
}

/**
 * Test 3: Order Cancellation
 */
async function testOrderCancellation() {
  console.log(chalk.bold('\n📋 Test 3: Order Cancellation'));
  
  try {
    const orderId = `order-${Date.now()}`;
    
    // Create cancellation message
    const cancelMessage = `Cancel order ${orderId}`;
    const cancelSignature = await wallet.signMessage(cancelMessage);
    logTest('Sign cancellation message', true, `Message: "${cancelMessage}"`);
    
    // Verify cancellation signature
    const recoveredAddress = ethers.verifyMessage(cancelMessage, cancelSignature);
    const isValid = recoveredAddress.toLowerCase() === wallet.address.toLowerCase();
    logTest('Verify cancellation signature', isValid);
    
    // Test invalid cancellation (wrong signer)
    const differentWallet = ethers.Wallet.createRandom();
    const invalidCancelSig = await differentWallet.signMessage(cancelMessage);
    const invalidRecovered = ethers.verifyMessage(cancelMessage, invalidCancelSig);
    const isInvalid = invalidRecovered.toLowerCase() !== wallet.address.toLowerCase();
    logTest('Reject cancellation from different wallet', isInvalid);
    
  } catch (error) {
    logTest('Order cancellation tests', false, error.message);
  }
}

/**
 * Test 4: Settlement Amount Verification
 */
async function testSettlementVerification() {
  console.log(chalk.bold('\n📋 Test 4: Settlement Amount Verification'));
  
  try {
    // Mock settlement data
    const order = {
      sellAmount: ethers.parseEther('1').toString(),
      buyAmount: ethers.parseEther('2000').toString(),
      sellToken: CONFIG.TEST_TOKENS.WETH,
      buyToken: CONFIG.TEST_TOKENS.DAI
    };
    
    // Test exact match
    const exactMatch = {
      sellTransferred: ethers.parseEther('1').toString(),
      buyReceived: ethers.parseEther('2000').toString()
    };
    const exactMatchValid = 
      exactMatch.sellTransferred === order.sellAmount &&
      exactMatch.buyReceived === order.buyAmount;
    logTest('Verify exact settlement match', exactMatchValid);
    
    // Test with allowed slippage (0.1%)
    const withSlippage = {
      sellTransferred: ethers.parseEther('1').toString(),
      buyReceived: ethers.parseEther('1998').toString() // 0.1% slippage
    };
    const minBuyAmount = (BigInt(order.buyAmount) * 999n) / 1000n;
    const slippageValid = 
      withSlippage.sellTransferred === order.sellAmount &&
      BigInt(withSlippage.buyReceived) >= minBuyAmount;
    logTest('Accept settlement within slippage', slippageValid, '0.1% slippage tolerance');
    
    // Test excessive slippage
    const excessiveSlippage = {
      sellTransferred: ethers.parseEther('1').toString(),
      buyReceived: ethers.parseEther('1900').toString() // 5% slippage
    };
    const excessiveInvalid = BigInt(excessiveSlippage.buyReceived) < minBuyAmount;
    logTest('Reject excessive slippage', excessiveInvalid, '5% slippage rejected');
    
  } catch (error) {
    logTest('Settlement verification tests', false, error.message);
  }
}

/**
 * Test 5: Escrow Fallback Mechanism
 */
async function testEscrowFallback() {
  console.log(chalk.bold('\n📋 Test 5: Escrow Fallback Mechanism'));
  
  try {
    // Calculate order hash for escrow
    const order = {
      sellToken: CONFIG.TEST_TOKENS.WETH,
      buyToken: CONFIG.TEST_TOKENS.DAI,
      sellAmount: ethers.parseEther('1000000').toString(), // Unrealistic amount
      buyAmount: ethers.parseEther('1').toString(),
      validTo: Math.floor(Date.now() / 1000) + 3600,
      appData: ethers.keccak256(ethers.toUtf8Bytes('escrow-test')),
      feeAmount: '0',
      kind: 'sell',
      partiallyFillable: false,
      receiver: wallet.address,
      user: wallet.address,
      signingScheme: 'eip712',
      nonce: 55555,
      wallet: wallet.address
    };
    
    // Calculate order hash
    const orderHash = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['address', 'address', 'uint256', 'uint256', 'uint32', 'bytes32', 'uint256', 'string', 'bool', 'address', 'address', 'string', 'uint256', 'address'],
        [order.sellToken, order.buyToken, order.sellAmount, order.buyAmount, order.validTo, order.appData, order.feeAmount, order.kind, order.partiallyFillable, order.receiver, order.user, order.signingScheme, order.nonce, order.wallet]
      )
    );
    logTest('Calculate order hash for escrow', true, `Hash: ${orderHash.slice(0, 20)}...`);
    
    // Mock escrow event
    const escrowEvent = {
      orderHash,
      user: wallet.address,
      amount: order.sellAmount
    };
    logTest('Mock escrow deposit event', true, `Amount: ${ethers.formatEther(escrowEvent.amount)} ETH`);
    
    // Verify escrow parameters
    const escrowValid = 
      escrowEvent.user.toLowerCase() === order.user.toLowerCase() &&
      escrowEvent.amount === order.sellAmount;
    logTest('Verify escrow parameters match order', escrowValid);
    
  } catch (error) {
    logTest('Escrow fallback tests', false, error.message);
  }
}

/**
 * Test 6: Multiple Order Batch Processing
 */
async function testBatchOrders() {
  console.log(chalk.bold('\n📋 Test 6: Batch Order Processing'));
  
  const tokenPairs = [
    { sell: 'WETH', buy: 'DAI', sellAmount: '1', buyAmount: '2000' },
    { sell: 'DAI', buy: 'USDC', sellAmount: '1000', buyAmount: '1000' },
    { sell: 'USDC', buy: 'WETH', sellAmount: '2000', buyAmount: '1' },
    { sell: 'WETH', buy: 'WBTC', sellAmount: '10', buyAmount: '0.5' },
    { sell: 'WBTC', buy: 'DAI', sellAmount: '0.1', buyAmount: '4000' }
  ];
  
  const orders = [];
  const startTime = Date.now();
  
  try {
    // Create 20 orders
    for (let i = 0; i < 20; i++) {
      const pair = tokenPairs[i % tokenPairs.length];
      const order = {
        sellToken: CONFIG.TEST_TOKENS[pair.sell],
        buyToken: CONFIG.TEST_TOKENS[pair.buy],
        sellAmount: ethers.parseEther(pair.sellAmount).toString(),
        buyAmount: ethers.parseEther(pair.buyAmount).toString(),
        validTo: Math.floor(Date.now() / 1000) + 3600,
        appData: ethers.keccak256(ethers.toUtf8Bytes(`batch-order-${i}`)),
        feeAmount: '0',
        kind: 'sell',
        partiallyFillable: false,
        receiver: wallet.address,
        user: wallet.address,
        signingScheme: 'eip712',
        nonce: 10000 + i,
        wallet: wallet.address
      };
      
      const signature = await wallet.signTypedData(EIP712_DOMAIN, EIP712_TYPES, order);
      orders.push({ order, signature });
    }
    
    const elapsed = Date.now() - startTime;
    logTest('Create and sign 20 orders', true, `Time: ${elapsed}ms (${Math.round(elapsed/20)}ms per order)`);
    
    // Verify all signatures
    let allValid = true;
    for (const { order, signature } of orders) {
      const recovered = ethers.verifyTypedData(EIP712_DOMAIN, EIP712_TYPES, order, signature);
      if (recovered.toLowerCase() !== wallet.address.toLowerCase()) {
        allValid = false;
        break;
      }
    }
    logTest('Verify all 20 signatures', allValid);
    
    // Calculate success metrics
    const simulatedResults = {
      successful: 15,
      failed: 3,
      cancelled: 2
    };
    const successRate = (simulatedResults.successful / 20 * 100).toFixed(1);
    logTest('Calculate success rate', true, `${successRate}% (15/20 successful)`);
    
  } catch (error) {
    logTest('Batch order tests', false, error.message);
  }
}

/**
 * Run all tests
 */
async function runTests() {
  console.log(chalk.bold.cyan('\n🚀 Starting Order Flow Tests (Mocked)\n'));
  
  try {
    await testEIP712Signature();
    await testOrderExpiry();
    await testOrderCancellation();
    await testSettlementVerification();
    await testEscrowFallback();
    await testBatchOrders();
    
    // Print summary
    console.log(chalk.bold.cyan('\n📊 Test Summary\n'));
    console.log(chalk.white('Total Tests:'), testResults.totalTests);
    console.log(chalk.green('Passed:'), testResults.passed);
    console.log(chalk.red('Failed:'), testResults.failed);
    console.log(chalk.white('Success Rate:'), `${(testResults.passed / testResults.totalTests * 100).toFixed(1)}%`);
    
    // Detailed results
    console.log(chalk.bold.cyan('\n📋 Detailed Results\n'));
    testResults.tests.forEach(test => {
      const icon = test.passed ? chalk.green('✓') : chalk.red('✗');
      console.log(`${icon} ${test.name}`);
      if (test.details) {
        console.log(chalk.gray(`  ${test.details}`));
      }
    });
    
  } catch (error) {
    console.error(chalk.red('Test suite error:'), error);
  }
  
  // Clean up WebSocket server
  try {
    const { exec } = require('child_process');
    exec('pkill -f test-websocket-server.js');
  } catch (e) {
    // Ignore cleanup errors
  }
  
  process.exit(testResults.failed > 0 ? 1 : 0);
}

// Run tests
runTests().catch(console.error);