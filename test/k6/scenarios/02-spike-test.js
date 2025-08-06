/**
 * K6 Spike Test
 * Rapidly increases from 0 to 10,000 users in 2 minutes
 * Tests system's ability to handle sudden traffic spikes
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { thresholds } from '../config/thresholds.js';
import { 
  generateOrder,
  checkResponse,
  getRandomPair,
  orderPlacementDuration,
  orderbookFetchDuration,
  successfulOrders,
  failedOrders,
  activeConnections
} from '../lib/helpers.js';

// Test configuration
export const options = {
  scenarios: {
    spike_test: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 100 },    // Warm up
        { duration: '2m', target: 10000 },   // Spike to 10k users
        { duration: '5m', target: 10000 },   // Stay at 10k
        { duration: '2m', target: 100 },     // Ramp down
        { duration: '30s', target: 0 },      // Cool down
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    ...thresholds,
    // Additional thresholds for spike testing
    'http_req_duration{scenario:spike_test}': ['p(95)<1000'],
    'http_req_failed{scenario:spike_test}': ['rate<0.05'],
  },
};

// Environment configuration
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const WS_URL = __ENV.WS_URL || 'ws://localhost:8080';

// Metrics tracking
let peakResponseTime = 0;
let peakErrorRate = 0;
let peakTimestamp = 0;

// Test setup
export function setup() {
  console.log('=== Spike Test ===');
  console.log(`Target: ${BASE_URL}`);
  console.log('Pattern: 0 → 10,000 users in 2 minutes');
  console.log('Peak Duration: 5 minutes');
  console.log('==================\n');
  
  // Warm up the system
  const warmupRequests = 10;
  for (let i = 0; i < warmupRequests; i++) {
    http.get(`${BASE_URL}/api/health`);
  }
  
  return {
    startTime: Date.now(),
    testType: 'spike',
    targetVUs: 10000
  };
}

// Main test scenario
export default function (data) {
  const userId = `spike_user_${__VU}_${__ITER}`;
  const currentVUs = __VU;
  
  // Update active connections metric
  activeConnections.add(currentVUs);
  
  // Simulate panic behavior during spike
  if (currentVUs > 5000) {
    // High load - users are more aggressive
    panicTradingBehavior(userId);
  } else if (currentVUs > 1000) {
    // Medium load - mixed behavior
    normalTradingBehavior(userId);
  } else {
    // Low load - regular behavior
    lightTradingBehavior(userId);
  }
  
  // Track peak metrics
  if (currentVUs > 8000) {
    monitorPeakConditions();
  }
}

// Panic trading - aggressive behavior during spike
function panicTradingBehavior(userId) {
  const iterations = 5;
  
  for (let i = 0; i < iterations; i++) {
    const pair = getRandomPair();
    
    // Rapid market orders
    const marketOrder = {
      userId: userId,
      pair: pair,
      side: Math.random() > 0.5 ? 'buy' : 'sell',
      type: 'market',
      amount: Math.random() * 10 + 1,
      timestamp: Date.now()
    };
    
    const startTime = Date.now();
    const res = http.post(
      `${BASE_URL}/api/orders`,
      JSON.stringify(marketOrder),
      {
        headers: { 'Content-Type': 'application/json' },
        tags: { type: 'panic_order', load: 'high' },
        timeout: '5s'
      }
    );
    
    const duration = Date.now() - startTime;
    orderPlacementDuration.add(duration);
    
    if (res.status === 201) {
      successfulOrders.add(1);
    } else {
      failedOrders.add(1);
      
      // Log errors during spike
      if (res.status === 503) {
        console.log(`Service overloaded at ${__VU} VUs`);
      }
    }
    
    // Minimal delay between requests
    sleep(Math.random() * 0.5);
  }
  
  // Check orderbook rapidly
  const res = http.get(
    `${BASE_URL}/api/orderbook/${getRandomPair()}`,
    {
      tags: { type: 'orderbook_check', load: 'high' },
      timeout: '3s'
    }
  );
  
  checkResponse(res);
}

// Normal trading during medium load
function normalTradingBehavior(userId) {
  const pair = getRandomPair();
  
  // Fetch orderbook
  const orderbookStart = Date.now();
  const orderbookRes = http.get(
    `${BASE_URL}/api/orderbook/${pair}`,
    {
      tags: { type: 'orderbook_fetch', load: 'medium' },
      timeout: '5s'
    }
  );
  orderbookFetchDuration.add(Date.now() - orderbookStart);
  
  if (orderbookRes.status === 200) {
    // Place limit order based on orderbook
    const order = generateOrder(pair, userId);
    order.type = 'limit';
    
    const orderStart = Date.now();
    const orderRes = http.post(
      `${BASE_URL}/api/orders`,
      JSON.stringify(order),
      {
        headers: { 'Content-Type': 'application/json' },
        tags: { type: 'limit_order', load: 'medium' }
      }
    );
    orderPlacementDuration.add(Date.now() - orderStart);
    
    if (orderRes.status === 201) {
      successfulOrders.add(1);
      
      // Check order status
      sleep(1);
      http.get(
        `${BASE_URL}/api/orders/${order.id}`,
        { tags: { type: 'order_status', load: 'medium' } }
      );
    } else {
      failedOrders.add(1);
    }
  }
  
  sleep(Math.random() * 2 + 1);
}

// Light trading during low load
function lightTradingBehavior(userId) {
  const pair = getRandomPair();
  
  // Browse market data
  http.get(
    `${BASE_URL}/api/market/${pair}/stats`,
    { tags: { type: 'market_stats', load: 'low' } }
  );
  
  sleep(1);
  
  // Occasionally place order
  if (Math.random() > 0.5) {
    const order = generateOrder(pair, userId);
    
    const res = http.post(
      `${BASE_URL}/api/orders`,
      JSON.stringify(order),
      {
        headers: { 'Content-Type': 'application/json' },
        tags: { type: 'order', load: 'low' }
      }
    );
    
    checkResponse(res, orderPlacementDuration, 201);
  }
  
  sleep(Math.random() * 3 + 2);
}

// Monitor system during peak load
function monitorPeakConditions() {
  const timestamp = Date.now();
  
  // Sample system health during peak
  const healthRes = http.get(
    `${BASE_URL}/api/health/detailed`,
    {
      tags: { type: 'health_check', load: 'peak' },
      timeout: '2s'
    }
  );
  
  if (healthRes.status === 200) {
    try {
      const health = JSON.parse(healthRes.body);
      
      // Track peak metrics
      if (health.responseTime > peakResponseTime) {
        peakResponseTime = health.responseTime;
        peakTimestamp = timestamp;
      }
      
      if (health.errorRate > peakErrorRate) {
        peakErrorRate = health.errorRate;
      }
      
      // Log critical conditions
      if (health.queueDepth > 1000) {
        console.log(`WARNING: Queue depth ${health.queueDepth} at ${__VU} VUs`);
      }
      
      if (health.activeConnections > 9000) {
        console.log(`WARNING: ${health.activeConnections} active connections`);
      }
    } catch (e) {
      // Ignore parsing errors during high load
    }
  }
}

// Test teardown
export function teardown(data) {
  const duration = (Date.now() - data.startTime) / 1000;
  
  console.log('\n=== Spike Test Results ===');
  console.log(`Total Duration: ${duration}s`);
  console.log(`Peak Users: ${data.targetVUs}`);
  console.log(`Successful Orders: ${successfulOrders.value || 0}`);
  console.log(`Failed Orders: ${failedOrders.value || 0}`);
  console.log(`Success Rate: ${((successfulOrders.value || 0) / ((successfulOrders.value || 0) + (failedOrders.value || 0)) * 100).toFixed(2)}%`);
  
  if (peakResponseTime > 0) {
    console.log(`\nPeak Metrics:`);
    console.log(`- Response Time: ${peakResponseTime}ms`);
    console.log(`- Error Rate: ${(peakErrorRate * 100).toFixed(2)}%`);
    console.log(`- Timestamp: ${new Date(peakTimestamp).toISOString()}`);
  }
  
  // Determine if system handled the spike
  const successRate = (successfulOrders.value || 0) / ((successfulOrders.value || 0) + (failedOrders.value || 0));
  if (successRate > 0.95 && peakResponseTime < 1000) {
    console.log('\n✅ System successfully handled the spike!');
  } else if (successRate > 0.90) {
    console.log('\n⚠️ System handled the spike with some degradation');
  } else {
    console.log('\n❌ System struggled under spike load');
  }
  
  console.log('========================');
}