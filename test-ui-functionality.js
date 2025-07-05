#!/usr/bin/env node

const http = require('http');

const BASE_URL = 'http://localhost:3000';

// Helper to fetch the UI
async function fetchUI() {
  return new Promise((resolve, reject) => {
    http.get(BASE_URL, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

// Test UI elements
async function testUI() {
  console.log('🎨 Testing SwappiQ UI Functionality');
  console.log('===================================\n');
  
  try {
    const html = await fetchUI();
    
    const tests = [
      {
        name: 'Page Title',
        check: () => html.includes('<title>SwappiQ - Cross-Chain Trading Platform</title>'),
        error: 'Missing or incorrect page title'
      },
      {
        name: 'Header Logo',
        check: () => html.includes('<div class="logo">SwappiQ</div>'),
        error: 'Missing logo'
      },
      {
        name: 'Navigation Menu',
        check: () => html.includes('Swap') && html.includes('Orders') && html.includes('Markets') && html.includes('Analytics'),
        error: 'Missing navigation items'
      },
      {
        name: 'Swap Widget',
        check: () => html.includes('<h2>Swap Tokens</h2>') && html.includes('id="swapForm"'),
        error: 'Missing swap widget'
      },
      {
        name: 'Token Selectors',
        check: () => html.includes('id="fromToken"') && html.includes('id="toToken"'),
        error: 'Missing token selectors'
      },
      {
        name: 'Token Options',
        check: () => html.includes('ETH - Ethereum') && html.includes('USDT - Tether') && html.includes('USDC - USD Coin'),
        error: 'Missing token options'
      },
      {
        name: 'Amount Input',
        check: () => html.includes('id="fromAmount"') && html.includes('id="toAmount"'),
        error: 'Missing amount inputs'
      },
      {
        name: 'Swap Button',
        check: () => html.includes('<button type="submit" class="button-full">Swap</button>'),
        error: 'Missing swap button'
      },
      {
        name: 'Order Book',
        check: () => html.includes('<h2>Order Book</h2>') && html.includes('Buy Orders') && html.includes('Sell Orders'),
        error: 'Missing order book'
      },
      {
        name: 'Statistics Display',
        check: () => html.includes('Total Value Locked') && html.includes('24h Volume') && html.includes('Total Trades'),
        error: 'Missing statistics'
      },
      {
        name: 'Recent Orders',
        check: () => html.includes('<h2>Recent Orders</h2>'),
        error: 'Missing recent orders section'
      },
      {
        name: 'System Status',
        check: () => html.includes('<h2>System Status</h2>'),
        error: 'Missing system status section'
      },
      {
        name: 'JavaScript Functions',
        check: () => html.includes('fetchSystemStatus') && html.includes('updateStats') && html.includes('swapForm'),
        error: 'Missing JavaScript functionality'
      },
      {
        name: 'API Integration',
        check: () => html.includes("const API_URL = 'http://localhost:3000'"),
        error: 'Missing API URL configuration'
      },
      {
        name: 'Real-time Updates',
        check: () => html.includes('setInterval(fetchSystemStatus') && html.includes('setInterval(updateStats'),
        error: 'Missing real-time update intervals'
      },
      {
        name: 'CSS Styling',
        check: () => html.includes(':root {') && html.includes('--primary:') && html.includes('--success:'),
        error: 'Missing CSS variables'
      },
      {
        name: 'Responsive Grid',
        check: () => html.includes('grid-template-columns: repeat(auto-fit, minmax(300px, 1fr))'),
        error: 'Missing responsive grid'
      },
      {
        name: 'Status Indicators',
        check: () => html.includes('status-healthy') && html.includes('status-pending') && html.includes('status-error'),
        error: 'Missing status indicator classes'
      },
      {
        name: 'Loading Animation',
        check: () => html.includes('@keyframes pulse') && html.includes('.loading'),
        error: 'Missing loading animation'
      },
      {
        name: 'Event Listeners',
        check: () => html.includes("addEventListener('input'") && html.includes("addEventListener('submit'"),
        error: 'Missing event listeners'
      }
    ];
    
    let passed = 0;
    let failed = 0;
    
    console.log('🔍 Checking UI Components...\n');
    
    for (const test of tests) {
      try {
        if (test.check()) {
          console.log(`✅ ${test.name}`);
          passed++;
        } else {
          console.log(`❌ ${test.name}: ${test.error}`);
          failed++;
        }
      } catch (e) {
        console.log(`❌ ${test.name}: Error - ${e.message}`);
        failed++;
      }
    }
    
    console.log('\n📊 UI Test Summary');
    console.log('==================');
    console.log(`Total Tests: ${tests.length}`);
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`Success Rate: ${((passed / tests.length) * 100).toFixed(1)}%`);
    
    // Test JavaScript execution
    console.log('\n🚀 Testing Dynamic Functionality...\n');
    
    // Check if the API endpoints are accessible from UI
    const apiTests = [
      { endpoint: '/api/health', description: 'Health check from UI' },
      { endpoint: '/api/tokens/comprehensive', description: 'Token list for dropdowns' },
      { endpoint: '/api/orderbook', description: 'Order book data' }
    ];
    
    for (const test of apiTests) {
      const result = await testAPIFromUI(test.endpoint);
      console.log(`${result ? '✅' : '❌'} ${test.description}`);
    }
    
    return failed === 0;
    
  } catch (error) {
    console.error('❌ Failed to fetch UI:', error.message);
    return false;
  }
}

// Test API endpoint accessibility
function testAPIFromUI(endpoint) {
  return new Promise((resolve) => {
    http.get(BASE_URL + endpoint, (res) => {
      resolve(res.statusCode === 200);
    }).on('error', () => resolve(false));
  });
}

// Run the tests
testUI().then(success => {
  console.log(success ? '\n✅ All UI tests passed!' : '\n❌ Some UI tests failed');
  process.exit(success ? 0 : 1);
});