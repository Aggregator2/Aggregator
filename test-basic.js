const { ethers } = require('ethers');

console.log('🔍 Basic System Test\n');

// Test 1: Environment
console.log('1. Environment Check:');
console.log('   NODE_ENV:', process.env.NODE_ENV || 'not set');
console.log('   Port:', process.env.PORT || '3000');
console.log('');

// Test 2: Database connection
console.log('2. Database Connection:');
const testDb = async () => {
  try {
    const { Pool } = require('pg');
    const pool = new Pool({
      host: 'localhost',
      port: 5432,
      database: 'trading_platform_test',
      user: 'postgres',
      password: 'password123'
    });
    
    const result = await pool.query('SELECT NOW()');
    console.log('   ✅ Connected successfully');
    console.log('   Time:', result.rows[0].now);
    await pool.end();
  } catch (error) {
    console.log('   ❌ Connection failed:', error.message);
    console.log('   Make sure PostgreSQL is running');
  }
};

// Test 3: Check if server can start
console.log('\n3. Server Check:');
const testServer = async () => {
  try {
    // Check if Next.js server is running
    const response = await fetch('http://localhost:3000/api/hello');
    if (response.ok) {
      console.log('   ✅ Next.js server is running');
    } else {
      console.log('   ⚠️  Next.js server returned:', response.status);
    }
  } catch (error) {
    console.log('   ❌ Next.js server not running');
    console.log('   Run: npm run dev');
  }
};

// Run tests
(async () => {
  await testDb();
  await testServer();
  console.log('\n✨ Basic test complete!');
})();