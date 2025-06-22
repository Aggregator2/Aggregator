const { ethers } = require('ethers');
const axios = require('axios');
const chalk = require('chalk');

// Configuration
const CONFIG = {
  API_BASE_URL: 'http://localhost:3000/api',
  PRIVATE_KEY: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  ESCROW_ADDRESS: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512'
};

// EIP-712 configuration
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

const wallet = new ethers.Wallet(CONFIG.PRIVATE_KEY);

/**
 * Test API integration
 */
async function testAPIIntegration() {
  console.log(chalk.bold.cyan('\n🚀 Testing Order API Integration\n'));
  
  try {
    // Test 1: Submit valid order
    console.log(chalk.bold('1. Testing Valid Order Submission'));
    const validOrder = {
      sellToken: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1', // WETH
      buyToken: '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1', // DAI
      sellAmount: ethers.parseEther('1').toString(),
      buyAmount: ethers.parseEther('2000').toString(),
      validTo: Math.floor(Date.now() / 1000) + 3600,
      appData: ethers.keccak256(ethers.toUtf8Bytes('api-test')),
      feeAmount: '0',
      kind: 'sell',
      partiallyFillable: false,
      receiver: wallet.address,
      user: wallet.address,
      signingScheme: 'eip712',
      nonce: Date.now(),
      wallet: wallet.address
    };
    
    const signature = await wallet.signTypedData(EIP712_DOMAIN, EIP712_TYPES, validOrder);
    
    try {
      const response = await axios.post(`${CONFIG.API_BASE_URL}/submitOrder`, {
        order: validOrder,
        signature
      });
      
      console.log(chalk.green('✓ Valid order accepted'));
      console.log(chalk.gray(`  Status: ${response.data.status}`));
      console.log(chalk.gray(`  Message: ${response.data.message}`));
    } catch (error) {
      if (error.response?.status === 200) {
        console.log(chalk.green('✓ Valid order accepted'));
      } else {
        console.log(chalk.red('✗ Valid order rejected'));
        console.log(chalk.gray(`  Error: ${error.response?.data?.error || error.message}`));
      }
    }
    
    // Test 2: Submit expired order
    console.log(chalk.bold('\n2. Testing Expired Order Rejection'));
    const expiredOrder = {
      ...validOrder,
      validTo: Math.floor(Date.now() / 1000) - 3600, // Expired
      nonce: Date.now() + 1
    };
    
    const expiredSignature = await wallet.signTypedData(EIP712_DOMAIN, EIP712_TYPES, expiredOrder);
    
    try {
      await axios.post(`${CONFIG.API_BASE_URL}/submitOrder`, {
        order: expiredOrder,
        signature: expiredSignature
      });
      console.log(chalk.red('✗ Expired order was accepted (should be rejected)'));
    } catch (error) {
      console.log(chalk.green('✓ Expired order properly rejected'));
      console.log(chalk.gray(`  Error: ${error.response?.data?.error || error.message}`));
    }
    
    // Test 3: Submit order with invalid signature
    console.log(chalk.bold('\n3. Testing Invalid Signature Rejection'));
    const invalidSigOrder = {
      ...validOrder,
      nonce: Date.now() + 2
    };
    
    try {
      await axios.post(`${CONFIG.API_BASE_URL}/submitOrder`, {
        order: invalidSigOrder,
        signature: '0x' + '00'.repeat(65) // Invalid signature
      });
      console.log(chalk.red('✗ Invalid signature was accepted (should be rejected)'));
    } catch (error) {
      console.log(chalk.green('✓ Invalid signature properly rejected'));
      console.log(chalk.gray(`  Error: ${error.response?.data?.error || error.message}`));
    }
    
    // Test 4: Check order status endpoint
    console.log(chalk.bold('\n4. Testing Order Status Endpoint'));
    const testOrderId = 'test-order-123';
    
    try {
      const response = await axios.get(`${CONFIG.API_BASE_URL}/orders/${testOrderId}`);
      console.log(chalk.yellow('⚠ Order status endpoint exists but returned:'));
      console.log(chalk.gray(`  Status: ${response.status}`));
      console.log(chalk.gray(`  Data: ${JSON.stringify(response.data)}`));
    } catch (error) {
      if (error.response?.status === 404) {
        console.log(chalk.yellow('⚠ Order status endpoint not found (404)'));
        console.log(chalk.gray('  This endpoint needs to be implemented for real-time tracking'));
      } else {
        console.log(chalk.red('✗ Order status endpoint error'));
        console.log(chalk.gray(`  Error: ${error.message}`));
      }
    }
    
    // Test 5: Test quote endpoint integration
    console.log(chalk.bold('\n5. Testing Quote Endpoint'));
    
    try {
      const quoteResponse = await axios.post(`${CONFIG.API_BASE_URL}/unified-quote-simple`, {
        sellToken: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1',
        buyToken: '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1',
        sellAmount: ethers.parseEther('1').toString(),
        chainId: 1
      });
      
      console.log(chalk.green('✓ Quote endpoint working'));
      console.log(chalk.gray(`  Buy amount: ${ethers.formatEther(quoteResponse.data.buyAmount || '0')} tokens`));
      console.log(chalk.gray(`  Source: ${quoteResponse.data.source || 'unknown'}`));
    } catch (error) {
      console.log(chalk.red('✗ Quote endpoint error'));
      console.log(chalk.gray(`  Error: ${error.response?.data?.error || error.message}`));
    }
    
  } catch (error) {
    console.error(chalk.red('\nUnexpected error:'), error.message);
  }
}

// Run test
testAPIIntegration().catch(console.error);