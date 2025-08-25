// Debug script to test the quote-profitable endpoint directly
import { swappiqStandalone } from './lib/swappiq-api.js';

// Create mock request and response objects
const req = {
  method: 'POST',
  query: { path: ['quote-profitable'] },
  body: {
    sellToken: '0x111111111117dc0aa78b770fa6a738034120c302',
    buyToken: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    sellAmount: '1000000000000000000',
    chainId: 1,
    slippageTolerance: '0.5'
  }
};

const res = {
  statusCode: 200,
  json: (data) => {
    console.log('Response:', JSON.stringify(data, null, 2));
  },
  status: (code) => {
    res.statusCode = code;
    return res;
  },
  setHeader: () => {},
  send: (data) => {
    console.log('Raw response:', data);
  }
};

// Call the handler
console.log('Testing quote-profitable endpoint...\n');
swappiqStandalone(req, res);