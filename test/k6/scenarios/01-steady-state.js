/**
 * K6 Steady State Load Test
 * Maintains 1,000 concurrent users for extended period
 */

import http from 'k6/http';
import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { thresholds } from '../config/thresholds.js';
import { 
  generateOrder, 
  generateSignature, 
  checkResponse,
  handleWebSocketMessage,
  getRandomPair,
  sleepWithJitter,
  orderPlacementDuration,
  orderbookFetchDuration,
  successfulOrders,
  failedOrders
} from '../lib/helpers.js';

// Test configuration
export const options = {
  scenarios: {
    steady_state: {
      executor: 'constant-vus',
      vus: 1000,
      duration: '30m',
    },
  },
  thresholds: thresholds,
  setupTimeout: '30s',
  teardownTimeout: '30s',
};

// Environment configuration
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const WS_URL = __ENV.WS_URL || 'ws://localhost:8080';

// Test setup
export function setup() {
  console.log('=== Steady State Load Test ===');
  console.log(`Target: ${BASE_URL}`);
  console.log('Virtual Users: 1,000');
  console.log('Duration: 30 minutes');
  console.log('=============================\n');
  
  // Verify endpoints are accessible
  const healthCheck = http.get(`${BASE_URL}/api/health`);
  check(healthCheck, {
    'API is healthy': (r) => r.status === 200,
  });
  
  if (healthCheck.status !== 200) {
    throw new Error('API health check failed');
  }
  
  return {
    startTime: Date.now(),
    testType: 'steady_state'
  };
}

// Main test scenario
export default function (data) {
  // Each VU represents a trader with different behavior patterns
  const userId = `user_${__VU}_${Date.now()}`;
  const traderType = __VU % 4; // 4 different trader types
  
  // Execute different trading patterns based on trader type
  switch (traderType) {
    case 0:
      marketMakerBehavior(userId);
      break;
    case 1:
      dayTraderBehavior(userId);
      break;
    case 2:
      arbitrageurBehavior(userId);
      break;
    case 3:
      casualTraderBehavior(userId);
      break;
  }
}

// Market maker - places many limit orders
function marketMakerBehavior(userId) {
  const pair = getRandomPair();
  const wsUrl = `${WS_URL}/orderbook/${pair}`;
  
  // Connect to WebSocket for real-time updates
  ws.connect(wsUrl, { tags: { type: 'market_maker' } }, function (socket) {
    socket.on('open', () => {
      socket.send(JSON.stringify({ 
        type: 'subscribe', 
        pairs: [pair],
        userId: userId 
      }));
    });
    
    socket.on('message', (msg) => handleWebSocketMessage(msg, socket));
    
    // Place multiple limit orders around the spread
    socket.setTimeout(() => {
      for (let i = 0; i < 10; i++) {
        placeLimitOrder(userId, pair, 'buy');
        placeLimitOrder(userId, pair, 'sell');
        sleep(sleepWithJitter(0.5)); // 500ms between orders
      }
    }, 1000);
    
    // Keep connection alive for 30 seconds
    socket.setTimeout(() => {
      socket.close();
    }, 30000);
  });
  
  // Continue placing orders via REST API
  for (let i = 0; i < 5; i++) {
    fetchOrderbook(pair);
    placeLimitOrder(userId, pair);
    cancelRandomOrder(userId);
    sleep(sleepWithJitter(2));
  }
}

// Day trader - frequent trades, follows momentum
function dayTraderBehavior(userId) {
  const pairs = [getRandomPair(), getRandomPair()];
  
  pairs.forEach(pair => {
    // Check market conditions
    fetchOrderbook(pair);
    fetchMarketStats(pair);
    
    // Place market orders based on "momentum"
    if (Math.random() > 0.5) {
      placeMarketOrder(userId, pair, 'buy');
    } else {
      placeMarketOrder(userId, pair, 'sell');
    }
    
    sleep(sleepWithJitter(1));
  });
  
  // Check positions
  fetchUserOrders(userId);
  fetchUserBalances(userId);
  
  sleep(sleepWithJitter(5));
}

// Arbitrageur - monitors multiple pairs for opportunities
function arbitrageurBehavior(userId) {
  const pairs = getTradingPairs();
  const opportunities = [];
  
  // Scan all pairs for arbitrage opportunities
  pairs.forEach(pair => {
    const orderbook = fetchOrderbook(pair);
    if (orderbook && Math.random() > 0.8) {
      opportunities.push(pair);
    }
  });
  
  // Execute arbitrage trades
  opportunities.forEach(pair => {
    placeMarketOrder(userId, pair, 'buy');
    sleep(0.1);
    placeMarketOrder(userId, pair, 'sell');
  });
  
  sleep(sleepWithJitter(3));
}

// Casual trader - infrequent trades
function casualTraderBehavior(userId) {
  const pair = getRandomPair();
  
  // Browse market data
  fetchMarketStats(pair);
  fetchOrderbook(pair);
  fetchRecentTrades(pair);
  
  // Occasionally place an order
  if (Math.random() > 0.7) {
    if (Math.random() > 0.5) {
      placeLimitOrder(userId, pair);
    } else {
      placeMarketOrder(userId, pair);
    }
  }
  
  sleep(sleepWithJitter(10)); // Longer pause between actions
}

// Helper functions for API calls
function placeLimitOrder(userId, pair, side = null) {
  const order = generateOrder(pair, userId);
  order.type = 'limit';
  if (side) order.side = side;
  order.signature = generateSignature(order);
  
  const startTime = Date.now();
  const res = http.post(
    `${BASE_URL}/api/orders`,
    JSON.stringify(order),
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { type: 'place_order', orderType: 'limit' }
    }
  );
  
  const duration = Date.now() - startTime;
  orderPlacementDuration.add(duration);
  
  if (checkResponse(res, null, 201)) {
    successfulOrders.add(1);
  } else {
    failedOrders.add(1);
  }
  
  return res;
}

function placeMarketOrder(userId, pair, side = null) {
  const order = generateOrder(pair, userId);
  order.type = 'market';
  if (side) order.side = side;
  delete order.price; // Market orders don't have price
  order.signature = generateSignature(order);
  
  const startTime = Date.now();
  const res = http.post(
    `${BASE_URL}/api/orders`,
    JSON.stringify(order),
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { type: 'place_order', orderType: 'market' }
    }
  );
  
  const duration = Date.now() - startTime;
  orderPlacementDuration.add(duration);
  
  if (checkResponse(res, null, 201)) {
    successfulOrders.add(1);
  } else {
    failedOrders.add(1);
  }
  
  return res;
}

function fetchOrderbook(pair) {
  const startTime = Date.now();
  const res = http.get(
    `${BASE_URL}/api/orderbook/${pair}`,
    { tags: { type: 'fetch_orderbook' } }
  );
  
  const duration = Date.now() - startTime;
  orderbookFetchDuration.add(duration);
  
  checkResponse(res);
  return res.json();
}

function fetchMarketStats(pair) {
  const res = http.get(
    `${BASE_URL}/api/market/${pair}/stats`,
    { tags: { type: 'fetch_stats' } }
  );
  
  checkResponse(res);
  return res.json();
}

function fetchRecentTrades(pair) {
  const res = http.get(
    `${BASE_URL}/api/trades/${pair}/recent`,
    { tags: { type: 'fetch_trades' } }
  );
  
  checkResponse(res);
  return res.json();
}

function fetchUserOrders(userId) {
  const res = http.get(
    `${BASE_URL}/api/users/${userId}/orders`,
    { tags: { type: 'fetch_user_orders' } }
  );
  
  checkResponse(res);
  return res.json();
}

function fetchUserBalances(userId) {
  const res = http.get(
    `${BASE_URL}/api/users/${userId}/balances`,
    { tags: { type: 'fetch_balances' } }
  );
  
  checkResponse(res);
  return res.json();
}

function cancelRandomOrder(userId) {
  // Fetch user orders first
  const orders = fetchUserOrders(userId);
  
  if (orders && orders.length > 0) {
    const orderToCancel = orders[Math.floor(Math.random() * orders.length)];
    
    const res = http.del(
      `${BASE_URL}/api/orders/${orderToCancel.id}`,
      null,
      { tags: { type: 'cancel_order' } }
    );
    
    checkResponse(res);
  }
}

function getTradingPairs() {
  return ['ETH-USDC', 'BTC-USDC', 'SOL-USDC', 'MATIC-USDC'];
}

// Test teardown
export function teardown(data) {
  const duration = (Date.now() - data.startTime) / 1000;
  console.log('\n=== Test Complete ===');
  console.log(`Duration: ${duration}s`);
  console.log(`Successful Orders: ${successfulOrders.value}`);
  console.log(`Failed Orders: ${failedOrders.value}`);
  console.log('====================');
}