const { exec } = require('child_process');
const fs = require('fs');

async function runTest(name, command) {
  console.log(`\n🧪 Running ${name}...`);
  return new Promise((resolve) => {
    const child = exec(command, { timeout: 30000 });
    let output = '';
    
    child.stdout.on('data', (data) => {
      output += data;
    });
    
    child.stderr.on('data', (data) => {
      output += data;
    });
    
    child.on('exit', () => {
      // Extract key metrics
      const passMatch = output.match(/Tests:\s+(\d+)\s+passed/);
      const failMatch = output.match(/Tests:\s+(\d+)\s+failed/);
      const totalMatch = output.match(/Tests:.*,\s+(\d+)\s+total/);
      const suiteMatch = output.match(/Test Suites:\s+(\d+)\s+passed.*,\s+(\d+)\s+total/);
      
      const result = {
        name,
        passed: passMatch ? parseInt(passMatch[1]) : 0,
        failed: failMatch ? parseInt(failMatch[1]) : 0,
        total: totalMatch ? parseInt(totalMatch[1]) : 0,
        suites: suiteMatch ? `${suiteMatch[1]}/${suiteMatch[2]}` : 'N/A',
        status: failMatch && parseInt(failMatch[1]) > 0 ? '❌' : '✅'
      };
      
      resolve(result);
    });
    
    setTimeout(() => {
      child.kill();
      resolve({ name, status: '⏱️', error: 'Timeout' });
    }, 30000);
  });
}

async function runAllTests() {
  console.log('🚀 SwappiQ Comprehensive Test Report');
  console.log('=====================================\n');
  
  const tests = [
    { name: 'Auth Middleware', cmd: 'npx jest __tests__/middleware/requireAuth.test.js' },
    { name: 'Redis Tests', cmd: 'npx jest tests/redis/redis.test.ts' },
    { name: 'Matching Engine', cmd: 'npx jest tests/matching-engine' },
    { name: 'Settlement', cmd: 'npx jest tests/settlement' },
    { name: 'Integration', cmd: 'npx jest tests/integration' },
    { name: 'Unit Tests', cmd: 'npx jest src/**/*.test.ts' },
  ];
  
  const results = [];
  
  for (const test of tests) {
    const result = await runTest(test.name, test.cmd);
    results.push(result);
    
    console.log(`${result.status} ${result.name}`);
    if (result.passed || result.failed) {
      console.log(`   Tests: ${result.passed} passed, ${result.failed} failed, ${result.total} total`);
      console.log(`   Suites: ${result.suites}`);
    } else if (result.error) {
      console.log(`   Error: ${result.error}`);
    }
  }
  
  // Summary
  console.log('\n📊 Summary Report');
  console.log('=================');
  
  const totalPassed = results.reduce((sum, r) => sum + (r.passed || 0), 0);
  const totalFailed = results.reduce((sum, r) => sum + (r.failed || 0), 0);
  const totalTests = results.reduce((sum, r) => sum + (r.total || 0), 0);
  
  console.log(`\nTotal Tests Run: ${totalTests}`);
  console.log(`✅ Passed: ${totalPassed}`);
  console.log(`❌ Failed: ${totalFailed}`);
  console.log(`📈 Pass Rate: ${totalTests > 0 ? ((totalPassed / totalTests) * 100).toFixed(1) : 0}%`);
  
  // Save detailed report
  fs.writeFileSync('/workspace/TEST_RESULTS_SUMMARY.json', JSON.stringify(results, null, 2));
  console.log('\n💾 Detailed results saved to TEST_RESULTS_SUMMARY.json');
}

runAllTests().catch(console.error);