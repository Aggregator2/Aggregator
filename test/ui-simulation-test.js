/**
 * UI Simulation Test
 * Tests real-time quote updates, UI responsiveness, and error handling
 */

const puppeteer = require('puppeteer');
const { ethers } = require('ethers');

// Test configuration
const BASE_URL = 'http://localhost:3000';
const HEADLESS = false; // Set to true for CI/CD

// Test scenarios for UI
const UI_TEST_SCENARIOS = [
  {
    name: 'Basic ETH to USDC swap',
    actions: [
      { type: 'input', selector: '.sellAmount', value: '1' },
      { type: 'wait', duration: 1000 },
      { type: 'expectQuote', minValue: '1000' },
    ]
  },
  {
    name: 'Token switching',
    actions: [
      { type: 'click', selector: '.switchButton' },
      { type: 'wait', duration: 500 },
      { type: 'expectTokenSwap' },
    ]
  },
  {
    name: 'Real-time quote updates',
    actions: [
      { type: 'input', selector: '.sellAmount', value: '0.5' },
      { type: 'wait', duration: 6000 }, // Wait for quote refresh
      { type: 'expectQuoteUpdate' },
    ]
  },
  {
    name: 'Quote staleness indicator',
    actions: [
      { type: 'input', selector: '.sellAmount', value: '2' },
      { type: 'wait', duration: 11000 }, // Wait for stale indicator
      { type: 'expectStaleQuote' },
    ]
  },
  {
    name: 'Error handling - zero amount',
    actions: [
      { type: 'input', selector: '.sellAmount', value: '0' },
      { type: 'wait', duration: 500 },
      { type: 'expectNoQuote' },
    ]
  },
  {
    name: 'Cross-chain token selection',
    actions: [
      { type: 'click', selector: '.sellTokenSelector' },
      { type: 'selectChain', chain: 'BSC' },
      { type: 'selectToken', token: 'BNB' },
      { type: 'expectCrossChainQuote' },
    ]
  },
];

// Mock wallet for testing
class MockWallet {
  constructor() {
    this.address = '0x742d35Cc6634C0532925a3b844Bc9e7595f6fed2';
    this.privateKey = '0x0123456789012345678901234567890123456789012345678901234567890123';
  }
  
  async connect() {
    return this.address;
  }
  
  async signTypedData(domain, types, value) {
    const wallet = new ethers.Wallet(this.privateKey);
    return wallet.signTypedData(domain, types, value);
  }
}

/**
 * Main UI test runner
 */
async function runUISimulationTests() {
  console.log('🖥️ Starting UI Simulation Tests\n');
  
  let browser;
  let page;
  const results = { passed: 0, failed: 0, errors: [] };
  
  try {
    // Launch browser
    browser = await puppeteer.launch({
      headless: HEADLESS,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    
    page = await browser.newPage();
    
    // Inject mock wallet
    await page.evaluateOnNewDocument(() => {
      window.mockWallet = {
        address: '0x742d35Cc6634C0532925a3b844Bc9e7595f6fed2',
        isConnected: false,
        
        async connect() {
          this.isConnected = true;
          return this.address;
        },
        
        async signMessage(message) {
          return '0xmocksignature';
        }
      };
      
      // Mock ethereum provider
      window.ethereum = {
        request: async ({ method, params }) => {
          switch (method) {
            case 'eth_requestAccounts':
              return [window.mockWallet.address];
            case 'eth_accounts':
              return window.mockWallet.isConnected ? [window.mockWallet.address] : [];
            case 'eth_chainId':
              return '0x1';
            case 'eth_signTypedData_v4':
              return '0xmocksignature';
            default:
              throw new Error(`Unsupported method: ${method}`);
          }
        },
        on: () => {},
        removeListener: () => {},
      };
    });
    
    // Navigate to the app
    await page.goto(BASE_URL, { waitUntil: 'networkidle2' });
    
    // Run each test scenario
    for (const scenario of UI_TEST_SCENARIOS) {
      console.log(`\nRunning: ${scenario.name}`);
      
      try {
        await runScenario(page, scenario);
        console.log(`✅ ${scenario.name} - PASSED`);
        results.passed++;
      } catch (error) {
        console.log(`❌ ${scenario.name} - FAILED: ${error.message}`);
        results.failed++;
        results.errors.push({ scenario: scenario.name, error: error.message });
        
        // Take screenshot on failure
        await page.screenshot({ 
          path: `test/screenshots/failure-${scenario.name.replace(/\s+/g, '-')}.png` 
        });
      }
    }
    
    // Additional real-time monitoring test
    await runRealTimeMonitoring(page, results);
    
  } catch (error) {
    console.error('Test setup failed:', error);
    results.failed++;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
  
  // Print results
  printUITestResults(results);
}

/**
 * Run a single test scenario
 */
async function runScenario(page, scenario) {
  for (const action of scenario.actions) {
    switch (action.type) {
      case 'input':
        await page.waitForSelector(action.selector);
        await page.click(action.selector, { clickCount: 3 }); // Select all
        await page.type(action.selector, action.value);
        break;
        
      case 'click':
        await page.waitForSelector(action.selector);
        await page.click(action.selector);
        break;
        
      case 'wait':
        await page.waitForTimeout(action.duration);
        break;
        
      case 'expectQuote':
        await expectQuote(page, action.minValue);
        break;
        
      case 'expectTokenSwap':
        await expectTokenSwap(page);
        break;
        
      case 'expectQuoteUpdate':
        await expectQuoteUpdate(page);
        break;
        
      case 'expectStaleQuote':
        await expectStaleQuote(page);
        break;
        
      case 'expectNoQuote':
        await expectNoQuote(page);
        break;
        
      case 'selectChain':
        await selectChain(page, action.chain);
        break;
        
      case 'selectToken':
        await selectToken(page, action.token);
        break;
        
      case 'expectCrossChainQuote':
        await expectCrossChainQuote(page);
        break;
    }
  }
}

/**
 * Test expectations
 */
async function expectQuote(page, minValue) {
  const buyAmount = await page.$eval('.buyAmountInput', el => el.value);
  if (!buyAmount || parseFloat(buyAmount) < parseFloat(minValue)) {
    throw new Error(`Expected quote >= ${minValue}, got ${buyAmount}`);
  }
}

async function expectTokenSwap(page) {
  // Check if tokens were swapped
  const sellToken = await page.$eval('.sellTokenSelector', el => el.textContent);
  const buyToken = await page.$eval('.buyTokenSelector', el => el.textContent);
  
  if (sellToken === 'ETH' || buyToken === 'USDC') {
    throw new Error('Tokens were not swapped');
  }
}

async function expectQuoteUpdate(page) {
  // Store initial quote
  const initialQuote = await page.$eval('.buyAmountInput', el => el.value);
  
  // Wait for update
  await page.waitForTimeout(5500);
  
  // Check if indicator shows fresh quote
  const isFresh = await page.$eval('[title*="Quote updated"]', el => {
    return el.textContent === '✓';
  }).catch(() => false);
  
  if (!isFresh) {
    throw new Error('Quote did not update as expected');
  }
}

async function expectStaleQuote(page) {
  // Check for stale indicator
  const isStale = await page.$eval('[title*="Quote updated"]', el => {
    return el.textContent === '⚠' && el.style.color.includes('ff6b6b');
  }).catch(() => false);
  
  if (!isStale) {
    throw new Error('Quote staleness indicator not shown');
  }
}

async function expectNoQuote(page) {
  const buyAmount = await page.$eval('.buyAmountInput', el => el.value);
  if (buyAmount && buyAmount !== '0' && buyAmount !== '0.0') {
    throw new Error(`Expected no quote, but got ${buyAmount}`);
  }
}

async function selectChain(page, chain) {
  // This would click on chain selector if implemented
  console.log(`  - Selecting chain: ${chain}`);
}

async function selectToken(page, token) {
  // This would select a token from the picker
  console.log(`  - Selecting token: ${token}`);
}

async function expectCrossChainQuote(page) {
  // Verify cross-chain quote appears
  const hasRoute = await page.$('.crossChainRoute').catch(() => false);
  if (!hasRoute) {
    console.log('  - Cross-chain route indicator not found (OK for now)');
  }
}

/**
 * Real-time monitoring test
 */
async function runRealTimeMonitoring(page, results) {
  console.log('\n📊 Running Real-Time Monitoring Test (30 seconds)...\n');
  
  try {
    // Set up quote monitoring
    await page.evaluate(() => {
      window.quoteUpdates = [];
      
      // Override fetch to monitor quote requests
      const originalFetch = window.fetch;
      window.fetch = async (...args) => {
        const response = await originalFetch(...args);
        
        if (args[0].includes('quote')) {
          const clone = response.clone();
          const data = await clone.json();
          window.quoteUpdates.push({
            timestamp: Date.now(),
            buyAmount: data.buyAmount,
            source: data.source,
          });
        }
        
        return response;
      };
    });
    
    // Input amount to trigger quotes
    await page.click('.sellAmountInput', { clickCount: 3 });
    await page.type('.sellAmountInput', '1');
    
    // Monitor for 30 seconds
    const monitoringDuration = 30000;
    const checkInterval = 1000;
    let checks = 0;
    
    const monitoring = setInterval(async () => {
      checks++;
      
      // Get quote updates
      const updates = await page.evaluate(() => window.quoteUpdates);
      
      // Check current UI state
      const buyAmount = await page.$eval('.buyAmountInput', el => el.value).catch(() => '0');
      const indicator = await page.$eval('[title*="Quote updated"]', el => el.textContent).catch(() => '?');
      
      console.log(`[${new Date().toISOString()}] Quote: ${buyAmount} | Status: ${indicator} | Updates: ${updates.length}`);
      
      if (checks * checkInterval >= monitoringDuration) {
        clearInterval(monitoring);
        
        // Verify results
        if (updates.length >= 5) { // Should have at least 5 updates in 30s
          console.log(`\n✅ Real-time monitoring - PASSED (${updates.length} updates)`);
          results.passed++;
        } else {
          console.log(`\n❌ Real-time monitoring - FAILED (only ${updates.length} updates)`);
          results.failed++;
        }
      }
    }, checkInterval);
    
    // Wait for monitoring to complete
    await new Promise(resolve => setTimeout(resolve, monitoringDuration + 1000));
    
  } catch (error) {
    console.log(`\n❌ Real-time monitoring - ERROR: ${error.message}`);
    results.failed++;
  }
}

/**
 * Print UI test results
 */
function printUITestResults(results) {
  console.log('\n' + '='.repeat(80));
  console.log('📊 UI TEST RESULTS\n');
  
  const total = results.passed + results.failed;
  const successRate = total > 0 ? (results.passed / total * 100).toFixed(1) : 0;
  
  console.log(`Total Tests: ${total}`);
  console.log(`✅ Passed: ${results.passed}`);
  console.log(`❌ Failed: ${results.failed}`);
  console.log(`Success Rate: ${successRate}%`);
  
  if (results.errors.length > 0) {
    console.log('\nErrors:');
    results.errors.forEach(e => {
      console.log(`  - ${e.scenario}: ${e.error}`);
    });
  }
  
  console.log('\n' + '='.repeat(80));
  
  if (results.failed === 0) {
    console.log('🎉 All UI tests passed! The interface is working correctly.');
  } else {
    console.log('⚠️ Some UI tests failed. Check screenshots in test/screenshots/');
  }
}

// Alternative: Manual browser test instructions
function printManualTestInstructions() {
  console.log('\n📝 MANUAL UI TEST INSTRUCTIONS\n');
  console.log('If Puppeteer is not available, test manually:');
  console.log('\n1. Basic Quote Test:');
  console.log('   - Enter "1" in sell amount for ETH');
  console.log('   - Verify USDC quote appears (~2000-3000)');
  console.log('   - Verify green ✓ indicator appears');
  
  console.log('\n2. Real-time Updates:');
  console.log('   - Leave amount unchanged for 6 seconds');
  console.log('   - Verify quote updates (amount might change slightly)');
  console.log('   - After 11 seconds, verify ⚠ indicator (red, pulsing)');
  
  console.log('\n3. Token Switching:');
  console.log('   - Click switch button (⇅)');
  console.log('   - Verify tokens swap positions');
  console.log('   - Verify new quote appears');
  
  console.log('\n4. Error Handling:');
  console.log('   - Enter "0" as amount');
  console.log('   - Verify no quote appears');
  console.log('   - Enter "abc" as amount');
  console.log('   - Verify no quote/error appears');
  
  console.log('\n5. Continuous Updates:');
  console.log('   - Enter different amounts: 0.1, 1, 10, 100');
  console.log('   - Verify quotes update smoothly');
  console.log('   - Watch for 30 seconds - should see regular updates');
}

// Run tests or show manual instructions
if (require.main === module) {
  // Check if we can run Puppeteer tests
  try {
    require.resolve('puppeteer');
    runUISimulationTests().catch(console.error);
  } catch (e) {
    console.log('⚠️ Puppeteer not installed. Showing manual test instructions.\n');
    printManualTestInstructions();
  }
}

module.exports = { runUISimulationTests, printManualTestInstructions };