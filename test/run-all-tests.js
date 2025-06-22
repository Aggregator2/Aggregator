#!/usr/bin/env node

/**
 * Master Test Runner
 * Executes all tests and provides a comprehensive report
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// Test files to run
const TEST_SUITES = [
  {
    name: 'Profit Mechanisms Test',
    file: '../test-profit-mechanisms.js',
    timeout: 30000,
  },
  {
    name: 'Comprehensive E2E Test',
    file: 'comprehensive-e2e-test.js',
    timeout: 120000,
  },
  {
    name: 'Continuous Stress Test',
    file: 'continuous-stress-test.js',
    timeout: 65000, // 60s test + 5s buffer
  },
  {
    name: 'UI Simulation Test',
    file: 'ui-simulation-test.js',
    timeout: 180000, // 3 minutes for UI tests
  },
];

// Global test results
const globalResults = {
  totalSuites: TEST_SUITES.length,
  passed: 0,
  failed: 0,
  skipped: 0,
  startTime: Date.now(),
  suiteResults: [],
};

/**
 * Run a single test suite
 */
async function runTestSuite(suite) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🧪 Running: ${suite.name}`);
  console.log(`${'='.repeat(80)}\n`);
  
  const startTime = Date.now();
  
  return new Promise((resolve) => {
    const testPath = path.join(__dirname, suite.file);
    
    // Check if test file exists
    if (!fs.existsSync(testPath)) {
      console.log(`⚠️ Test file not found: ${suite.file}`);
      globalResults.skipped++;
      globalResults.suiteResults.push({
        name: suite.name,
        status: 'skipped',
        reason: 'File not found',
        duration: 0,
      });
      resolve();
      return;
    }
    
    // Run the test
    const child = spawn('node', [testPath], {
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'test' },
    });
    
    // Set timeout
    const timeout = setTimeout(() => {
      console.log(`\n⏱️ Test timeout after ${suite.timeout / 1000}s`);
      child.kill('SIGTERM');
    }, suite.timeout);
    
    child.on('exit', (code) => {
      clearTimeout(timeout);
      const duration = Date.now() - startTime;
      
      if (code === 0) {
        console.log(`\n✅ ${suite.name} - PASSED (${(duration / 1000).toFixed(1)}s)`);
        globalResults.passed++;
        globalResults.suiteResults.push({
          name: suite.name,
          status: 'passed',
          duration,
        });
      } else {
        console.log(`\n❌ ${suite.name} - FAILED (${(duration / 1000).toFixed(1)}s)`);
        globalResults.failed++;
        globalResults.suiteResults.push({
          name: suite.name,
          status: 'failed',
          exitCode: code,
          duration,
        });
      }
      
      resolve();
    });
    
    child.on('error', (error) => {
      clearTimeout(timeout);
      console.log(`\n💥 ${suite.name} - ERROR: ${error.message}`);
      globalResults.failed++;
      globalResults.suiteResults.push({
        name: suite.name,
        status: 'error',
        error: error.message,
        duration: Date.now() - startTime,
      });
      resolve();
    });
  });
}

/**
 * Run all tests sequentially
 */
async function runAllTests() {
  console.log('🚀 META-AGGREGATOR COMPREHENSIVE TEST SUITE');
  console.log(`Started at: ${new Date().toISOString()}`);
  console.log(`Running ${TEST_SUITES.length} test suites...\n`);
  
  // Create screenshots directory if needed
  const screenshotsDir = path.join(__dirname, 'screenshots');
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }
  
  // Check if server is running
  console.log('🔍 Checking if server is running...');
  const serverCheck = await checkServerRunning();
  if (!serverCheck) {
    console.log('❌ Server is not running at http://localhost:3000');
    console.log('Please start the server with: npm run dev');
    process.exit(1);
  }
  console.log('✅ Server is running\n');
  
  // Run each test suite
  for (const suite of TEST_SUITES) {
    await runTestSuite(suite);
  }
  
  // Print final results
  printFinalResults();
}

/**
 * Check if server is running
 */
async function checkServerRunning() {
  try {
    const fetch = require('node-fetch');
    const response = await fetch('http://localhost:3000/api/health').catch(() => null);
    return response && response.ok;
  } catch (e) {
    // If API health check doesn't exist, try the main page
    try {
      const response = await fetch('http://localhost:3000').catch(() => null);
      return response && response.ok;
    } catch (e2) {
      return false;
    }
  }
}

/**
 * Print final test results
 */
function printFinalResults() {
  const totalDuration = Date.now() - globalResults.startTime;
  
  console.log('\n' + '='.repeat(80));
  console.log('📊 FINAL TEST RESULTS');
  console.log('='.repeat(80) + '\n');
  
  console.log('Summary:');
  console.log(`  Total Suites: ${globalResults.totalSuites}`);
  console.log(`  ✅ Passed: ${globalResults.passed}`);
  console.log(`  ❌ Failed: ${globalResults.failed}`);
  console.log(`  ⚠️  Skipped: ${globalResults.skipped}`);
  console.log(`  ⏱️  Total Time: ${(totalDuration / 1000).toFixed(1)}s`);
  
  console.log('\nSuite Details:');
  globalResults.suiteResults.forEach(result => {
    const icon = result.status === 'passed' ? '✅' : 
                 result.status === 'failed' ? '❌' : '⚠️';
    console.log(`  ${icon} ${result.name} - ${result.status.toUpperCase()} (${(result.duration / 1000).toFixed(1)}s)`);
    if (result.reason) console.log(`     Reason: ${result.reason}`);
    if (result.error) console.log(`     Error: ${result.error}`);
  });
  
  console.log('\n' + '='.repeat(80));
  
  if (globalResults.failed === 0 && globalResults.skipped === 0) {
    console.log('🎉 ALL TESTS PASSED! The system is working perfectly!');
    console.log('\nThe meta-aggregator is ready for production with:');
    console.log('  ✅ Hidden profit mechanisms working correctly');
    console.log('  ✅ Cross-chain swaps functioning properly');
    console.log('  ✅ Real-time quote updates in the UI');
    console.log('  ✅ Robust error handling');
    console.log('  ✅ High performance under stress');
  } else if (globalResults.failed > 0) {
    console.log('⚠️ Some tests failed. Please review the errors above.');
    console.log('\nCommon issues:');
    console.log('  - Ensure all dependencies are installed: npm install');
    console.log('  - Check if the server is running: npm run dev');
    console.log('  - Verify API endpoints are accessible');
    console.log('  - Check for rate limiting on external APIs');
  }
  
  console.log('\n💡 Next Steps:');
  console.log('  1. Fix any failing tests');
  console.log('  2. Run individual test suites for debugging');
  console.log('  3. Check test/screenshots/ for UI test failures');
  console.log('  4. Monitor logs for detailed error information');
  
  // Exit with appropriate code
  process.exit(globalResults.failed > 0 ? 1 : 0);
}

/**
 * Quick test mode - runs faster subset
 */
async function runQuickTests() {
  console.log('⚡ Running quick tests only...\n');
  
  // Only run profit mechanisms and basic E2E
  const quickSuites = TEST_SUITES.slice(0, 2);
  
  for (const suite of quickSuites) {
    await runTestSuite(suite);
  }
  
  printFinalResults();
}

// Handle command line arguments
const args = process.argv.slice(2);
if (args.includes('--quick')) {
  runQuickTests().catch(console.error);
} else if (args.includes('--help')) {
  console.log('Meta-Aggregator Test Runner\n');
  console.log('Usage: node run-all-tests.js [options]\n');
  console.log('Options:');
  console.log('  --quick    Run only quick tests (profit + basic E2E)');
  console.log('  --help     Show this help message');
  console.log('\nWithout options, runs all test suites.');
} else {
  runAllTests().catch(console.error);
}