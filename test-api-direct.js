// Test the API directly without HTTP
const { swappiqStandalone } = require('./lib/swappiq-api');

// Mock request and response objects
const mockReq = {
  method: 'POST',
  query: { path: ['submitOrder'] },
  headers: {
    authorization: 'Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiIweDc0MmQzNWNjNjYzNGMwNTMyOTI1YTNiODQ0YmM5ZTc1OTVmOGZhNDkiLCJlbWFpbCI6IjB4NzQyZDM1Y2M2NjM0YzA1MzI5MjVhM2I4NDRiYzllNzU5NWY4ZmE0OUB3YWxsZXQubG9jYWwiLCJyb2xlIjoidXNlciIsImV4cCI6MTc1MjMzNzQwODU2NSwiaWF0IjoxNzUyMjUxMDA4NTY1fQ==.dGVzdC1zaWduYXR1cmUtMHg3NDJkMzVDYzY2MzRDMDUzMjkyNWEzYjg0NEJjOWU3NTk1ZjhmYTQ5'
  },
  body: {
    order: {
      sellToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      buyToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      sellAmount: '1000000000000000000',
      buyAmount: '2000000000',
      validTo: Math.floor(Date.now() / 1000) + 1800,
      user: '0x742d35Cc6634C0532925a3b844Bc9e7595f8fa49',
      receiver: '0x742d35Cc6634C0532925a3b844Bc9e7595f8fa49',
      wallet: '0x742d35Cc6634C0532925a3b844Bc9e7595f8fa49',
      appData: '0x' + '00'.repeat(32),
      feeAmount: '0',
      partiallyFillable: false,
      kind: 'sell',
      signingScheme: 'eip712',
      nonce: Date.now()
    },
    signature: '0x' + 'ff'.repeat(65)
  }
};

let responseData = null;
const mockRes = {
  statusCode: 200,
  json: (data) => {
    responseData = data;
    console.log('Response:', JSON.stringify(data, null, 2));
  },
  status: function(code) {
    this.statusCode = code;
    return this;
  },
  setHeader: () => {},
  send: (data) => {
    responseData = data;
    console.log('Response:', data);
  }
};

console.log('Testing submitOrder API directly...\n');

try {
  swappiqStandalone(mockReq, mockRes);
  
  // Wait a bit for async operations
  setTimeout(() => {
    if (responseData) {
      console.log('\n✅ Order submitted successfully!');
    } else {
      console.log('\n❌ No response received');
    }
  }, 100);
} catch (error) {
  console.error('\n❌ Error:', error.message);
  console.error(error.stack);
}