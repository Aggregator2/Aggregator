#!/usr/bin/env node
import { config } from 'dotenv';
import { resolve } from 'path';
import { ethers } from 'ethers';
import * as fs from 'fs';

// Load test environment
config({ path: resolve(__dirname, '../.env.test') });

// Import services
import { db } from '../src/database/connection';
import { getMatchingEngine } from '../src/services/matchingEngine/singleton';
import { getWebSocketServer } from '../src/websocket/server';
import { createSettlementService } from '../src/services/settlement/settlementService';
import { OrderType, OrderSide, TimeInForce } from '../src/services/matchingEngine/types';

// Test results
const testResults: { test: string; status: 'PASS' | 'FAIL'; error?: string }[] = [];

function logTest(test: string, passed: boolean, error?: any) {
  const status = passed ? 'PASS' : 'FAIL';
  console.log(`${passed ? '✅' : '❌'} ${test}: ${status}`);
  if (error) console.error(`   Error: ${error.message || error}`);
  testResults.push({ test, status, error: error?.message });
}

async function testDatabaseConnection() {
  console.log('\n🔧 Testing Database Connection...');
  try {
    await db.connect();
    const result = await db.query('SELECT NOW() as time');
    logTest('Database connection', true);
    logTest('Database query', result.rows.length > 0);
    return true;
  } catch (error) {
    logTest('Database connection', false, error);
    return false;
  }
}

async function testMatchingEngine() {
  console.log('\n🔧 Testing Matching Engine...');
  try {
    const engine = getMatchingEngine();
    logTest('Matching engine initialization', true);
    
    // Test order submission
    const testOrder = {
      userId: 'test_user_1',
      pair: 'ETH/USDC',
      side: OrderSide.BUY,
      type: OrderType.LIMIT,
      price: 2000,
      quantity: 1,
      timeInForce: TimeInForce.GTC
    };
    
    const result = await engine.submitOrder(testOrder);
    logTest('Order submission', result.orderId !== undefined, result);
    
    // Test order book
    const orderBook = engine.getOrderBook('ETH/USDC');
    logTest('Order book retrieval', orderBook !== null);
    
    return true;
  } catch (error) {
    logTest('Matching engine test', false, error);
    return false;
  }
}

async function testWebSocketServer() {
  console.log('\n🔧 Testing WebSocket Server...');
  try {
    const wsServer = getWebSocketServer();
    logTest('WebSocket server initialization', true);
    
    // Test WebSocket connection
    const io = require('socket.io-client');
    const socket = io('http://localhost:3001', {
      transports: ['websocket'],
      reconnection: false
    });
    
    return new Promise((resolve) => {
      socket.on('connect', () => {
        logTest('WebSocket client connection', true);
        socket.disconnect();
        resolve(true);
      });
      
      socket.on('connect_error', (error: any) => {
        logTest('WebSocket client connection', false, error);
        resolve(false);
      });
      
      // Timeout after 5 seconds
      setTimeout(() => {
        logTest('WebSocket client connection', false, 'Connection timeout');
        socket.disconnect();
        resolve(false);
      }, 5000);
    });
  } catch (error) {
    logTest('WebSocket server test', false, error);
    return false;
  }
}

async function testSettlementEngine() {
  console.log('\n🔧 Testing Settlement Engine...');
  try {
    // Mock provider for testing
    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
    
    const settlementConfig = {
      providerUrl: process.env.RPC_URL || 'http://localhost:8545',
      privateKey: process.env.SETTLEMENT_PRIVATE_KEY || '0x' + '0'.repeat(64),
      settlementContractAddress: process.env.SETTLEMENT_CONTRACT_ADDRESS || '0x' + '0'.repeat(40),
      epochDuration: 30000, // 30 seconds for testing
      matchingEngineConfig: {
        maxOrderBookDepth: 100,
        minOrderSize: { 'ETH/USDC': 0.001 },
        maxOrderSize: { 'ETH/USDC': 1000 },
        tickSize: { 'ETH/USDC': 0.01 },
        makerFeeRate: 0.001,
        takerFeeRate: 0.002,
        enableStopOrders: false,
        enableIcebergOrders: false
      },
      enableWebhooks: true,
      enableAutoSettlement: true,
      enableEmergencyPause: true
    };
    
    const settlementService = createSettlementService(settlementConfig);
    
    // Don't initialize if no valid contract
    if (settlementConfig.settlementContractAddress === '0x' + '0'.repeat(40)) {
      logTest('Settlement service creation', true);
      logTest('Settlement initialization skipped', true);
      console.log('   ⚠️  No settlement contract address configured');
    } else {
      await settlementService.initialize();
      logTest('Settlement service initialization', true);
    }
    
    return true;
  } catch (error) {
    logTest('Settlement engine test', false, error);
    return false;
  }
}

async function testOrderFlow() {
  console.log('\n🔧 Testing Complete Order Flow...');
  try {
    const engine = getMatchingEngine();
    
    // Create two test users
    const buyer = {
      userId: 'test_buyer',
      pair: 'ETH/USDC',
      side: OrderSide.BUY,
      type: OrderType.LIMIT,
      price: 2000,
      quantity: 1,
      timeInForce: TimeInForce.GTC
    };
    
    const seller = {
      userId: 'test_seller',
      pair: 'ETH/USDC',
      side: OrderSide.SELL,
      type: OrderType.LIMIT,
      price: 1999,
      quantity: 1,
      timeInForce: TimeInForce.GTC
    };
    
    // Submit buy order
    const buyResult = await engine.submitOrder(buyer);
    logTest('Buy order submission', buyResult.status === 'OPEN');
    
    // Submit sell order (should match)
    const sellResult = await engine.submitOrder(seller);
    logTest('Sell order submission', sellResult.status === 'FILLED');
    logTest('Order matching', sellResult.trades.length > 0);
    
    if (sellResult.trades.length > 0) {
      const trade = sellResult.trades[0];
      logTest('Trade execution', trade.price === 2000); // Should match at buyer's price
    }
    
    return true;
  } catch (error) {
    logTest('Order flow test', false, error);
    return false;
  }
}

async function checkEnvironment() {
  console.log('\n🔧 Checking Environment...');
  
  const requiredEnvVars = [
    'DATABASE_URL',
    'JWT_SECRET',
    'SETTLEMENT_PRIVATE_KEY',
    'RPC_URL'
  ];
  
  let allPresent = true;
  for (const envVar of requiredEnvVars) {
    const isPresent = !!process.env[envVar];
    logTest(`Environment: ${envVar}`, isPresent);
    if (!isPresent) allPresent = false;
  }
  
  return allPresent;
}

async function runAllTests() {
  console.log('🚀 Starting System Tests...');
  console.log('========================\n');
  
  // Check environment first
  await checkEnvironment();
  
  // Run tests in sequence
  const dbOk = await testDatabaseConnection();
  if (!dbOk) {
    console.log('\n⚠️  Skipping remaining tests due to database connection failure');
    console.log('   Make sure PostgreSQL is running and database exists');
    printSummary();
    return;
  }
  
  await testMatchingEngine();
  await testWebSocketServer();
  await testSettlementEngine();
  await testOrderFlow();
  
  printSummary();
}

function printSummary() {
  console.log('\n📊 Test Summary:');
  console.log('================');
  
  const passed = testResults.filter(r => r.status === 'PASS').length;
  const failed = testResults.filter(r => r.status === 'FAIL').length;
  
  console.log(`Total: ${testResults.length}`);
  console.log(`Passed: ${passed} ✅`);
  console.log(`Failed: ${failed} ❌`);
  
  if (failed > 0) {
    console.log('\nFailed Tests:');
    testResults
      .filter(r => r.status === 'FAIL')
      .forEach(r => {
        console.log(`  - ${r.test}: ${r.error || 'Unknown error'}`);
      });
  }
  
  // Save results to file
  const resultsPath = resolve(__dirname, '../test-results.json');
  fs.writeFileSync(resultsPath, JSON.stringify(testResults, null, 2));
  console.log(`\nDetailed results saved to: ${resultsPath}`);
  
  // Exit with appropriate code
  process.exit(failed > 0 ? 1 : 0);
}

// Handle errors
process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
  process.exit(1);
});

// Run tests
runAllTests().catch(error => {
  console.error('Test execution failed:', error);
  process.exit(1);
});