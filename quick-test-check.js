const { execSync } = require('child_process');

console.log('🧪 Quick Test Status Check\n');

// Test 1: Can we run ANY Jest test?
try {
  console.log('1. Testing Jest basic functionality...');
  execSync('npx jest --version', { stdio: 'inherit' });
  console.log('✅ Jest is installed\n');
} catch (e) {
  console.log('❌ Jest not working\n');
}

// Test 2: Simple inline test
try {
  console.log('2. Running inline test...');
  const testCode = `
    test('simple test', () => {
      expect(1 + 1).toBe(2);
    });
  `;
  require('fs').writeFileSync('/tmp/simple.test.js', testCode);
  const result = execSync('npx jest /tmp/simple.test.js --no-coverage', { encoding: 'utf8' });
  if (result.includes('1 passed')) {
    console.log('✅ Jest can run tests\n');
  }
} catch (e) {
  console.log('❌ Jest cannot run tests\n');
}

// Test 3: Check test file count
try {
  console.log('3. Counting available test files...');
  const files = execSync('find . -name "*.test.js" -o -name "*.test.ts" | grep -v node_modules | wc -l', { encoding: 'utf8' });
  console.log(`✅ Found ${files.trim()} test files\n`);
} catch (e) {
  console.log('❌ Cannot find test files\n');
}

// Test 4: Auth test specifically
try {
  console.log('4. Running Auth middleware test (max 10s)...');
  const result = execSync('timeout 10 npx jest __tests__/middleware/requireAuth.test.js --verbose 2>&1 | tail -20', { encoding: 'utf8' });
  const passed = result.match(/(\d+) passed/);
  if (passed) {
    console.log(`✅ Auth tests: ${passed[1]} tests passed\n`);
  }
} catch (e) {
  console.log('❌ Auth test timed out or failed\n');
}

console.log('📊 Summary: Jest is installed but tests are hanging');
console.log('This might be due to:');
console.log('- Open database connections');
console.log('- Redis connections not closing');
console.log('- WebSocket listeners');
console.log('\nRecommendation: Use --forceExit flag');