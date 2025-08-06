// Test JWT authentication flow
const crypto = require('crypto');

// Test token generation (mimics client-side)
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

// Test token verification (server-side)
function verifyJWT(token) {
  try {
    const [header, payload, signature] = token.split('.');
    if (!header || !payload || !signature) return null;
    
    // In development, accept test tokens
    if (process.env.NODE_ENV !== 'production' && signature.startsWith('dGVzdC1zaWduYXR1cmU')) {
      const data = JSON.parse(Buffer.from(payload, 'base64').toString());
      if (data.exp < Date.now()) return null;
      return data;
    }
    
    // Production JWT verification
    const expectedSignature = crypto.createHmac('sha256', 'secret').update(header + '.' + payload).digest('base64');
    if (signature !== expectedSignature) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64').toString());
    if (data.exp < Date.now()) return null;
    return data;
  } catch (e) {
    return null;
  }
}

// Test the flow
const testAddress = '0x742d35Cc6634C0532925a3b844Bc9e7595f8fa49';
console.log('Testing JWT authentication flow...\n');

// Generate token
const token = generateTestJWT(testAddress);
console.log('Generated token:', token);
console.log('\n');

// Verify token
const decoded = verifyJWT(token);
console.log('Decoded payload:', decoded);
console.log('\n');

// Test authorization header format
console.log('Authorization header format:');
console.log(`Authorization: Bearer ${token}`);
console.log('\n');

// Test API call
console.log('Test submitOrder API call:');
console.log(`curl -X POST http://localhost:3000/api/submitOrder \\
  -H "Authorization: Bearer ${token}" \\
  -H "Content-Type: application/json" \\
  -d '{"sellToken": "WETH", "buyToken": "USDC", "sellAmount": "1000000000000000000"}'`);