const jwt = require('jsonwebtoken');
require('dotenv').config({ path: '.env.local' });

// Parse command line arguments
const args = process.argv.slice(2);

if (args.length < 2) {
  console.log('Usage: node generate-jwt-token.js <userId> <email> [role] [expiresIn]');
  console.log('Example: node generate-jwt-token.js 123 user@example.com admin 7d');
  process.exit(1);
}

const [userId, email, role = 'user', expiresIn = '24h'] = args;

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.error('JWT_SECRET not found in environment variables');
  process.exit(1);
}

const payload = {
  userId,
  email,
  role,
  createdAt: new Date().toISOString()
};

try {
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn });
  
  console.log('\n=== JWT Token Generated Successfully ===\n');
  console.log('Payload:', JSON.stringify(payload, null, 2));
  console.log('\nExpires In:', expiresIn);
  console.log('\nToken:');
  console.log(token);
  console.log('\nCurl command to test:');
  console.log(`curl -X GET http://localhost:3000/api/test-auth \\
  -H "Authorization: Bearer ${token}" \\
  -H "Content-Type: application/json"`);
  
} catch (error) {
  console.error('Error generating token:', error.message);
  process.exit(1);
}