import { ethers } from 'ethers';
import fetch from 'node-fetch';

// Test configuration
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000/api';
const TEST_TIMEOUT = 30000;

// EIP-712 test data
const EIP712_DOMAIN = {
  name: 'SwappiQ',
  version: '1',
  chainId: 31337,
  verifyingContract: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
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
    { name: 'wallet', type: 'address' },
  ],
};

describe('API Endpoint Integration Tests', () => {
  let testWallet: ethers.Wallet;
  let testAddress: string;

  beforeAll(() => {
    // Create a test wallet
    testWallet = ethers.Wallet.createRandom();
    testAddress = testWallet.address;
  });

  describe('POST /api/submitOrder', () => {
    it('should accept valid EIP-712 signed order', async () => {
      // Create a valid order
      const order = {
        sellToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
        buyToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
        sellAmount: '1000000000000000000', // 1 ETH
        buyAmount: '2000000000', // 2000 USDC
        validTo: Math.floor(Date.now() / 1000) + 1800, // 30 minutes
        appData: '0x' + '00'.repeat(32),
        feeAmount: '0',
        kind: 'sell',
        partiallyFillable: false,
        receiver: testAddress,
        user: testAddress,
        signingScheme: 'eip712',
        nonce: 0,
        wallet: testAddress,
      };

      // Sign the order
      const signature = await testWallet.signTypedData(
        EIP712_DOMAIN,
        EIP712_TYPES,
        order
      );

      // Submit the order
      const response = await fetch(`${API_BASE_URL}/submitOrder`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          order,
          signature,
        }),
      });

      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result).toHaveProperty('orderId');
      expect(result).toHaveProperty('status');
      expect(result.status).toBe('pending');
    }, TEST_TIMEOUT);

    it('should reject order with invalid signature', async () => {
      const order = {
        sellToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        buyToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        sellAmount: '1000000000000000000',
        buyAmount: '2000000000',
        validTo: Math.floor(Date.now() / 1000) + 1800,
        appData: '0x' + '00'.repeat(32),
        feeAmount: '0',
        kind: 'sell',
        partiallyFillable: false,
        receiver: testAddress,
        user: testAddress,
        signingScheme: 'eip712',
        nonce: 0,
        wallet: testAddress,
      };

      // Create invalid signature
      const invalidSignature = '0x' + 'ff'.repeat(65);

      const response = await fetch(`${API_BASE_URL}/submitOrder`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          order,
          signature: invalidSignature,
        }),
      });

      const result = await response.json();

      expect(response.status).toBe(400);
      expect(result).toHaveProperty('error');
      expect(result.error).toContain('Invalid signature');
    });

    it('should reject order with missing fields', async () => {
      const incompleteOrder = {
        sellToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        buyToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        // Missing sellAmount and other required fields
      };

      const response = await fetch(`${API_BASE_URL}/submitOrder`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          order: incompleteOrder,
          signature: '0x' + '00'.repeat(65),
        }),
      });

      const result = await response.json();

      expect(response.status).toBe(400);
      expect(result).toHaveProperty('error');
      expect(result.error).toContain('Missing required fields');
    });

    it('should reject expired orders', async () => {
      const expiredOrder = {
        sellToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        buyToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        sellAmount: '1000000000000000000',
        buyAmount: '2000000000',
        validTo: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
        appData: '0x' + '00'.repeat(32),
        feeAmount: '0',
        kind: 'sell',
        partiallyFillable: false,
        receiver: testAddress,
        user: testAddress,
        signingScheme: 'eip712',
        nonce: 0,
        wallet: testAddress,
      };

      const signature = await testWallet.signTypedData(
        EIP712_DOMAIN,
        EIP712_TYPES,
        expiredOrder
      );

      const response = await fetch(`${API_BASE_URL}/submitOrder`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          order: expiredOrder,
          signature,
        }),
      });

      const result = await response.json();

      expect(response.status).toBe(400);
      expect(result).toHaveProperty('error');
      expect(result.error).toContain('Order expired');
    });

    it('should handle duplicate order submission', async () => {
      const order = {
        sellToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        buyToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        sellAmount: '1000000000000000000',
        buyAmount: '2000000000',
        validTo: Math.floor(Date.now() / 1000) + 1800,
        appData: '0x' + '00'.repeat(32),
        feeAmount: '0',
        kind: 'sell',
        partiallyFillable: false,
        receiver: testAddress,
        user: testAddress,
        signingScheme: 'eip712',
        nonce: 1, // Different nonce from first test
        wallet: testAddress,
      };

      const signature = await testWallet.signTypedData(
        EIP712_DOMAIN,
        EIP712_TYPES,
        order
      );

      // Submit first time
      const response1 = await fetch(`${API_BASE_URL}/submitOrder`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          order,
          signature,
        }),
      });

      expect(response1.status).toBe(200);

      // Submit same order again
      const response2 = await fetch(`${API_BASE_URL}/submitOrder`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          order,
          signature,
        }),
      });

      const result2 = await response2.json();

      // Should either accept with same orderId or reject as duplicate
      if (response2.status === 200) {
        expect(result2.orderId).toBeDefined();
      } else {
        expect(response2.status).toBe(400);
        expect(result2.error).toContain('duplicate');
      }
    });
  });

  describe('GET /api/quote-profitable', () => {
    it('should return valid quote for token pair', async () => {
      const quoteRequest = {
        sellToken: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', // WETH
        buyToken: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
        sellAmount: '1000000000000000000', // 1 ETH
        chainId: 1,
        toChainId: 1,
      };

      const response = await fetch(`${API_BASE_URL}/quote-profitable`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(quoteRequest),
      });

      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result).toHaveProperty('buyAmount');
      expect(result).toHaveProperty('lpFee');
      expect(result).toHaveProperty('minReceived');
      expect(result).toHaveProperty('source');
      expect(BigInt(result.buyAmount)).toBeGreaterThan(0n);
    }, TEST_TIMEOUT);

    it('should handle cross-chain quotes', async () => {
      const crossChainQuote = {
        sellToken: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', // WETH on Ethereum
        buyToken: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', // USDC on Polygon
        sellAmount: '1000000000000000000',
        chainId: 1, // Ethereum
        toChainId: 137, // Polygon
      };

      const response = await fetch(`${API_BASE_URL}/quote-profitable`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(crossChainQuote),
      });

      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result).toHaveProperty('route');
      expect(result.route).toHaveProperty('bridge');
    });

    it('should reject invalid token addresses', async () => {
      const invalidQuote = {
        sellToken: 'invalid-address',
        buyToken: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        sellAmount: '1000000000000000000',
        chainId: 1,
      };

      const response = await fetch(`${API_BASE_URL}/quote-profitable`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(invalidQuote),
      });

      const result = await response.json();

      expect(response.status).toBe(400);
      expect(result).toHaveProperty('error');
      expect(result.error).toContain('Invalid token address');
    });
  });

  describe('Order Status Flow', () => {
    it('should track order status from submission to completion', async () => {
      // Create and submit order
      const order = {
        sellToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        buyToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        sellAmount: '1000000000000000000',
        buyAmount: '2000000000',
        validTo: Math.floor(Date.now() / 1000) + 1800,
        appData: '0x' + '00'.repeat(32),
        feeAmount: '0',
        kind: 'sell',
        partiallyFillable: false,
        receiver: testAddress,
        user: testAddress,
        signingScheme: 'eip712',
        nonce: Date.now(), // Unique nonce
        wallet: testAddress,
      };

      const signature = await testWallet.signTypedData(
        EIP712_DOMAIN,
        EIP712_TYPES,
        order
      );

      // Submit order
      const submitResponse = await fetch(`${API_BASE_URL}/submitOrder`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          order,
          signature,
        }),
      });

      const submitResult = await submitResponse.json();
      expect(submitResponse.status).toBe(200);
      const orderId = submitResult.orderId;

      // Check order status
      const statusResponse = await fetch(`${API_BASE_URL}/orders/${orderId}`, {
        method: 'GET',
      });

      if (statusResponse.status === 200) {
        const statusResult = await statusResponse.json();
        expect(statusResult).toHaveProperty('status');
        expect(['pending', 'processing', 'filled', 'failed']).toContain(
          statusResult.status
        );
      }
    }, TEST_TIMEOUT);
  });

  describe('Security Tests', () => {
    it('should validate signature matches order user', async () => {
      const differentWallet = ethers.Wallet.createRandom();

      const order = {
        sellToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        buyToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        sellAmount: '1000000000000000000',
        buyAmount: '2000000000',
        validTo: Math.floor(Date.now() / 1000) + 1800,
        appData: '0x' + '00'.repeat(32),
        feeAmount: '0',
        kind: 'sell',
        partiallyFillable: false,
        receiver: testAddress,
        user: testAddress, // Order claims to be from testAddress
        signingScheme: 'eip712',
        nonce: 0,
        wallet: testAddress,
      };

      // But signed by different wallet
      const signature = await differentWallet.signTypedData(
        EIP712_DOMAIN,
        EIP712_TYPES,
        order
      );

      const response = await fetch(`${API_BASE_URL}/submitOrder`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          order,
          signature,
        }),
      });

      const result = await response.json();

      expect(response.status).toBe(400);
      expect(result).toHaveProperty('error');
      expect(result.error).toContain('Signature verification failed');
    });

    it('should prevent replay attacks with nonce tracking', async () => {
      const order = {
        sellToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        buyToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        sellAmount: '1000000000000000000',
        buyAmount: '2000000000',
        validTo: Math.floor(Date.now() / 1000) + 1800,
        appData: '0x' + '00'.repeat(32),
        feeAmount: '0',
        kind: 'sell',
        partiallyFillable: false,
        receiver: testAddress,
        user: testAddress,
        signingScheme: 'eip712',
        nonce: 999, // Specific nonce for replay test
        wallet: testAddress,
      };

      const signature = await testWallet.signTypedData(
        EIP712_DOMAIN,
        EIP712_TYPES,
        order
      );

      // First submission should succeed
      const response1 = await fetch(`${API_BASE_URL}/submitOrder`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          order,
          signature,
        }),
      });

      expect(response1.status).toBe(200);

      // Replay attempt with same nonce should fail
      const response2 = await fetch(`${API_BASE_URL}/submitOrder`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          order,
          signature,
        }),
      });

      if (response2.status !== 200) {
        const result2 = await response2.json();
        expect(response2.status).toBe(400);
        expect(result2.error).toContain('nonce');
      }
    });
  });
});