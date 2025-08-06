/**
 * K6 Stress Test
 * Gradually increases load until system failure to find breaking point
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { stressThresholds } from '../config/thresholds.js';
import { 
  generateOrder,
  checkResponse,
  getRandomPair,
  orderPlacementDuration,
  successfulOrders,
  failedOrders,
  formatNumber
} from '../lib/helpers.js';
import { Rate, Trend, Gauge } from 'k6/metrics';

// Custom metrics for stress testing
const errorRate = new Rate('error_rate');
const systemLoad = new Gauge('system_load');
const responseTimeP95 = new Trend('response_time_p95');

// Test configuration
export const options = {
  scenarios: {
    stress_test: {
      executor: 'ramping-arrival-rate',
      startRate: 100,
      timeUnit: '1s',
      preAllocatedVUs: 500,
      maxVUs: 20000, // Allow up to 20k VUs
      stages: [
        { duration: '2m', target: 500 },    // 500 RPS
        { duration: '2m', target: 1000 },   // 1k RPS
        { duration: '2m', target: 2000 },   // 2k RPS
        { duration: '2m', target: 5000 },   // 5k RPS
        { duration: '2m', target: 10000 },  // 10k RPS
        { duration: '2m', target: 15000 },  // 15k RPS
        { duration: '2m', target: 20000 },  // 20k RPS
        { duration: '2m', target: 25000 },  // 25k RPS
        { duration: '2m', target: 30000 },  // 30k RPS - likely breaking point
      ],
    },
  },
  thresholds: stressThresholds,
};

// Environment configuration
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

// Tracking breaking point
let breakingPoint = {
  rps: 0,
  vus: 0,
  responseTime: 0,
  errorRate: 0,
  timestamp: 0,
  symptoms: []
};

// Test setup
export function setup() {
  console.log('=== Stress Test ===');
  console.log(`Target: ${BASE_URL}`);
  console.log('Goal: Find system breaking point');
  console.log('Max RPS: 30,000');
  console.log('===================\n');
  
  return {
    startTime: Date.now(),
    testType: 'stress',
    healthEndpoint: `${BASE_URL}/api/health`
  };
}

// Main test scenario
export default function (data) {
  const userId = `stress_user_${__VU}_${__ITER}`;
  const scenario = Math.floor(Math.random() * 4);
  
  // Execute different load patterns
  switch (scenario) {
    case 0:
      executeOrderFlow(userId);
      break;
    case 1:
      executeQueryFlow(userId);
      break;
    case 2:
      executeHeavyFlow(userId);
      break;
    case 3:
      executeMixedFlow(userId);
      break;
  }
  
  // Monitor system health periodically
  if (__ITER % 100 === 0) {
    checkSystemHealth(data.healthEndpoint);
  }
}

// Order placement flow - tests write capacity
function executeOrderFlow(userId) {
  const requests = [];
  const batchSize = 5;
  
  // Batch order placement
  for (let i = 0; i < batchSize; i++) {
    const order = generateOrder(getRandomPair(), userId);
    
    const startTime = Date.now();
    const res = http.post(
      `${BASE_URL}/api/orders`,
      JSON.stringify(order),
      {
        headers: { 'Content-Type': 'application/json' },
        tags: { flow: 'order_placement' },
        timeout: '10s'
      }
    );
    
    const duration = Date.now() - startTime;
    requests.push({ res, duration });
    
    // Track metrics
    orderPlacementDuration.add(duration);
    errorRate.add(res.status !== 201);
    
    if (res.status === 201) {
      successfulOrders.add(1);
    } else {
      failedOrders.add(1);
      detectBreakingPoint('order_placement', res.status, duration);
    }
  }
  
  // Analyze batch performance
  analyzeBatchPerformance(requests);
}

// Query flow - tests read capacity
function executeQueryFlow(userId) {
  const queries = [
    { path: `/api/orderbook/${getRandomPair()}`, tag: 'orderbook' },
    { path: `/api/market/${getRandomPair()}/stats`, tag: 'stats' },
    { path: `/api/trades/${getRandomPair()}/recent`, tag: 'trades' },
    { path: `/api/users/${userId}/orders`, tag: 'user_orders' }
  ];
  
  queries.forEach(query => {
    const startTime = Date.now();
    const res = http.get(BASE_URL + query.path, {
      tags: { flow: 'query', type: query.tag },
      timeout: '5s'
    });
    
    const duration = Date.now() - startTime;
    errorRate.add(res.status !== 200);
    
    if (res.status !== 200) {
      detectBreakingPoint(query.tag, res.status, duration);
    }
    
    sleep(0.1); // Small delay between queries
  });
}

// Heavy flow - resource intensive operations
function executeHeavyFlow(userId) {
  // Large orderbook fetch
  const pairs = ['ETH-USDC', 'BTC-USDC', 'SOL-USDC'];
  
  pairs.forEach(pair => {
    const res = http.get(
      `${BASE_URL}/api/orderbook/${pair}?depth=1000`,
      {
        tags: { flow: 'heavy', type: 'deep_orderbook' },
        timeout: '15s'
      }
    );
    
    errorRate.add(res.status !== 200);
    
    if (res.status !== 200) {
      detectBreakingPoint('deep_orderbook', res.status, res.timings.duration);
    }
  });
  
  // Historical data query
  const historyRes = http.get(
    `${BASE_URL}/api/candles/${getRandomPair()}?interval=1m&limit=1000`,
    {
      tags: { flow: 'heavy', type: 'historical' },
      timeout: '15s'
    }
  );
  
  errorRate.add(historyRes.status !== 200);
}

// Mixed flow - realistic user behavior
function executeMixedFlow(userId) {
  const pair = getRandomPair();
  
  // 1. Check market conditions
  const statsRes = http.get(`${BASE_URL}/api/market/${pair}/stats`, {
    tags: { flow: 'mixed', step: 'market_check' }
  });
  
  if (statsRes.status === 200) {
    // 2. Fetch orderbook
    const orderbookRes = http.get(`${BASE_URL}/api/orderbook/${pair}`, {
      tags: { flow: 'mixed', step: 'orderbook' }
    });
    
    if (orderbookRes.status === 200) {
      // 3. Place order based on market data
      const order = generateOrder(pair, userId);
      const orderRes = http.post(
        `${BASE_URL}/api/orders`,
        JSON.stringify(order),
        {
          headers: { 'Content-Type': 'application/json' },
          tags: { flow: 'mixed', step: 'place_order' }
        }
      );
      
      errorRate.add(orderRes.status !== 201);
      
      // 4. Check order status if successful
      if (orderRes.status === 201) {
        sleep(0.5);
        http.get(`${BASE_URL}/api/orders/${order.id}`, {
          tags: { flow: 'mixed', step: 'check_order' }
        });
      }
    }
  }
}

// System health monitoring
function checkSystemHealth(healthEndpoint) {
  const res = http.get(healthEndpoint + '/detailed', {
    tags: { type: 'health_monitoring' },
    timeout: '3s'
  });
  
  if (res.status === 200) {
    try {
      const health = JSON.parse(res.body);
      systemLoad.add(health.load || 0);
      
      // Check for degradation symptoms
      if (health.responseTimeP95 > 2000) {
        breakingPoint.symptoms.push('High response time');
      }
      if (health.errorRate > 0.1) {
        breakingPoint.symptoms.push('High error rate');
      }
      if (health.queueDepth > 5000) {
        breakingPoint.symptoms.push('Queue overflow');
      }
      if (health.connectionPoolUsage > 0.95) {
        breakingPoint.symptoms.push('Connection pool exhaustion');
      }
    } catch (e) {
      // System might be failing
    }
  } else if (res.status === 503) {
    breakingPoint.symptoms.push('Service unavailable');
  }
}

// Detect system breaking point
function detectBreakingPoint(operation, status, responseTime) {
  const currentRPS = __ENV.RPS || 0;
  const currentVUs = __VU;
  const currentErrorRate = errorRate.rate;
  
  // Check if this is a breaking point indicator
  if (status === 503 || status === 0 || responseTime > 10000) {
    if (currentRPS > breakingPoint.rps) {
      breakingPoint = {
        rps: currentRPS,
        vus: currentVUs,
        responseTime: responseTime,
        errorRate: currentErrorRate,
        timestamp: Date.now(),
        symptoms: [...breakingPoint.symptoms, `${operation} failed`]
      };
      
      console.log(`⚠️ Potential breaking point detected at ${formatNumber(currentRPS)} RPS`);
    }
  }
}

// Analyze batch performance
function analyzeBatchPerformance(requests) {
  const responseTimes = requests.map(r => r.duration);
  const avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
  const maxResponseTime = Math.max(...responseTimes);
  
  responseTimeP95.add(maxResponseTime);
  
  // Log performance degradation
  if (avgResponseTime > 1000) {
    console.log(`Performance degradation: Avg ${avgResponseTime.toFixed(0)}ms, Max ${maxResponseTime}ms`);
  }
}

// Test teardown
export function teardown(data) {
  const duration = (Date.now() - data.startTime) / 1000 / 60; // minutes
  
  console.log('\n=== Stress Test Results ===');
  console.log(`Test Duration: ${duration.toFixed(1)} minutes`);
  console.log(`Total Requests: ${formatNumber(successfulOrders.value + failedOrders.value)}`);
  console.log(`Successful: ${formatNumber(successfulOrders.value || 0)}`);
  console.log(`Failed: ${formatNumber(failedOrders.value || 0)}`);
  
  if (breakingPoint.rps > 0) {
    console.log('\n🔥 Breaking Point Identified:');
    console.log(`- RPS: ${formatNumber(breakingPoint.rps)}`);
    console.log(`- Active VUs: ${formatNumber(breakingPoint.vus)}`);
    console.log(`- Response Time: ${breakingPoint.responseTime}ms`);
    console.log(`- Error Rate: ${(breakingPoint.errorRate * 100).toFixed(2)}%`);
    console.log(`- Symptoms: ${breakingPoint.symptoms.join(', ')}`);
  } else {
    console.log('\n✅ System handled all load levels without breaking!');
  }
  
  // Performance recommendations
  console.log('\n📊 Performance Analysis:');
  if (breakingPoint.rps < 5000) {
    console.log('- System needs significant scaling improvements');
    console.log('- Consider horizontal scaling and caching');
  } else if (breakingPoint.rps < 15000) {
    console.log('- System shows moderate performance');
    console.log('- Optimize database queries and connection pooling');
  } else {
    console.log('- System demonstrates good scalability');
    console.log('- Fine-tune for specific bottlenecks');
  }
  
  console.log('==========================');
}