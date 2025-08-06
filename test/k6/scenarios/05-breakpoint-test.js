/**
 * K6 Breakpoint Test
 * Gradually increases load until 95th percentile response time exceeds 500ms
 * Automatically stops when threshold is breached
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { breakpointThresholds } from '../config/thresholds.js';
import { 
  generateOrder,
  checkResponse,
  getRandomPair,
  formatNumber,
  calculatePercentiles
} from '../lib/helpers.js';
import { Rate, Trend, Counter, Gauge } from 'k6/metrics';
import exec from 'k6/execution';

// Custom metrics
const responseTimeP95 = new Gauge('response_time_p95_current');
const currentRPS = new Gauge('current_rps');
const breakpointReached = new Counter('breakpoint_reached');

// Response time tracking
let responseTimesWindow = [];
const WINDOW_SIZE = 1000; // Track last 1000 requests

// Test configuration
export const options = {
  scenarios: {
    breakpoint_test: {
      executor: 'ramping-arrival-rate',
      startRate: 50,
      timeUnit: '1s',
      preAllocatedVUs: 100,
      maxVUs: 10000,
      stages: [
        { duration: '30s', target: 100 },    // Warm up
        { duration: '1m', target: 500 },     // 500 RPS
        { duration: '1m', target: 1000 },    // 1k RPS
        { duration: '1m', target: 2000 },    // 2k RPS
        { duration: '1m', target: 3000 },    // 3k RPS
        { duration: '1m', target: 5000 },    // 5k RPS
        { duration: '1m', target: 7500 },    // 7.5k RPS
        { duration: '1m', target: 10000 },   // 10k RPS
        { duration: '1m', target: 15000 },   // 15k RPS
        { duration: '1m', target: 20000 },   // 20k RPS
      ],
    },
  },
  thresholds: {
    ...breakpointThresholds,
    // Custom threshold that will stop the test
    'response_time_p95_current': [{
      threshold: 'value<500',
      abortOnFail: true,
      delayAbortEval: '10s'
    }],
  },
};

// Environment configuration
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

// Breakpoint tracking
const breakpointData = {
  detected: false,
  timestamp: 0,
  rps: 0,
  vus: 0,
  p95: 0,
  p99: 0,
  errorRate: 0,
  requestsAtBreakpoint: 0
};

// Test setup
export function setup() {
  console.log('=== Breakpoint Test ===');
  console.log(`Target: ${BASE_URL}`);
  console.log('Threshold: 95th percentile > 500ms');
  console.log('Auto-stop: Enabled');
  console.log('======================\n');
  
  return {
    startTime: Date.now(),
    testType: 'breakpoint',
    threshold: 500
  };
}

// Main test scenario
export default function (data) {
  const userId = `breakpoint_user_${__VU}_${__ITER}`;
  
  // Mix of operations to simulate real load
  const operations = [
    () => testOrderPlacement(userId),
    () => testOrderbookFetch(),
    () => testMarketData(),
    () => testUserOperations(userId),
    () => testComplexQuery()
  ];
  
  // Execute random operation
  const operation = operations[Math.floor(Math.random() * operations.length)];
  const result = operation();
  
  // Track response time
  if (result && result.responseTime) {
    trackResponseTime(result.responseTime);
  }
  
  // Check if we've hit the breakpoint
  if (!breakpointData.detected) {
    checkBreakpoint(data.threshold);
  }
}

// Test operations
function testOrderPlacement(userId) {
  const order = generateOrder(getRandomPair(), userId);
  
  const startTime = Date.now();
  const res = http.post(
    `${BASE_URL}/api/orders`,
    JSON.stringify(order),
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { operation: 'order_placement' },
      timeout: '10s'
    }
  );
  const responseTime = Date.now() - startTime;
  
  checkResponse(res, null, 201);
  
  return { responseTime, success: res.status === 201 };
}

function testOrderbookFetch() {
  const pair = getRandomPair();
  
  const startTime = Date.now();
  const res = http.get(
    `${BASE_URL}/api/orderbook/${pair}?depth=50`,
    {
      tags: { operation: 'orderbook_fetch' },
      timeout: '5s'
    }
  );
  const responseTime = Date.now() - startTime;
  
  checkResponse(res);
  
  return { responseTime, success: res.status === 200 };
}

function testMarketData() {
  const pair = getRandomPair();
  
  const startTime = Date.now();
  const res = http.get(
    `${BASE_URL}/api/market/${pair}/stats`,
    {
      tags: { operation: 'market_stats' },
      timeout: '5s'
    }
  );
  const responseTime = Date.now() - startTime;
  
  checkResponse(res);
  
  return { responseTime, success: res.status === 200 };
}

function testUserOperations(userId) {
  // Batch multiple user operations
  const batch = http.batch([
    ['GET', `${BASE_URL}/api/users/${userId}/orders`],
    ['GET', `${BASE_URL}/api/users/${userId}/balances`],
    ['GET', `${BASE_URL}/api/users/${userId}/trades?limit=10`]
  ]);
  
  // Get max response time from batch
  const responseTimes = batch.map(res => res.timings.duration);
  const maxResponseTime = Math.max(...responseTimes);
  
  return { responseTime: maxResponseTime, success: true };
}

function testComplexQuery() {
  const pair = getRandomPair();
  
  const startTime = Date.now();
  const res = http.get(
    `${BASE_URL}/api/candles/${pair}?interval=1m&limit=500`,
    {
      tags: { operation: 'complex_query' },
      timeout: '10s'
    }
  );
  const responseTime = Date.now() - startTime;
  
  checkResponse(res);
  
  return { responseTime, success: res.status === 200 };
}

// Response time tracking
function trackResponseTime(responseTime) {
  // Add to sliding window
  responseTimesWindow.push(responseTime);
  
  // Maintain window size
  if (responseTimesWindow.length > WINDOW_SIZE) {
    responseTimesWindow.shift();
  }
  
  // Calculate percentiles every 10 requests
  if (responseTimesWindow.length % 10 === 0) {
    updatePercentiles();
  }
}

function updatePercentiles() {
  if (responseTimesWindow.length < 100) return; // Need enough data
  
  const percentiles = calculatePercentiles(responseTimesWindow, [50, 90, 95, 99]);
  
  // Update metric for threshold checking
  responseTimeP95.add(percentiles.p95);
  
  // Update current RPS
  const state = exec.scenario.state;
  if (state && state.data) {
    currentRPS.add(state.data.rate || 0);
  }
  
  // Log current status every 100 requests
  if (responseTimesWindow.length % 100 === 0) {
    console.log(`RPS: ${getCurrentRPS()}, P95: ${percentiles.p95.toFixed(0)}ms, P99: ${percentiles.p99.toFixed(0)}ms`);
  }
}

function checkBreakpoint(threshold) {
  const percentiles = calculatePercentiles(responseTimesWindow, [50, 90, 95, 99]);
  
  if (percentiles.p95 > threshold && responseTimesWindow.length >= 100) {
    breakpointData.detected = true;
    breakpointData.timestamp = Date.now();
    breakpointData.rps = getCurrentRPS();
    breakpointData.vus = __VU;
    breakpointData.p95 = percentiles.p95;
    breakpointData.p99 = percentiles.p99;
    breakpointData.requestsAtBreakpoint = responseTimesWindow.length;
    
    breakpointReached.add(1);
    
    console.log('\n🚨 BREAKPOINT REACHED! 🚨');
    console.log(`P95 Response Time: ${percentiles.p95.toFixed(0)}ms (threshold: ${threshold}ms)`);
    console.log(`Current RPS: ${formatNumber(breakpointData.rps)}`);
    console.log(`Active VUs: ${formatNumber(breakpointData.vus)}`);
    console.log(`Timestamp: ${new Date(breakpointData.timestamp).toISOString()}\n`);
  }
}

function getCurrentRPS() {
  // Get current arrival rate from execution context
  try {
    const scenario = exec.scenario;
    const currentTime = (Date.now() - scenario.startTime) / 1000;
    
    // Estimate based on stage configuration
    let targetRPS = 50; // Start rate
    let elapsedInStage = currentTime;
    
    for (const stage of options.scenarios.breakpoint_test.stages) {
      const stageDuration = parseInt(stage.duration);
      if (elapsedInStage <= stageDuration) {
        // Interpolate within this stage
        const stageProgress = elapsedInStage / stageDuration;
        const previousTarget = targetRPS;
        targetRPS = previousTarget + (stage.target - previousTarget) * stageProgress;
        break;
      }
      elapsedInStage -= stageDuration;
      targetRPS = stage.target;
    }
    
    return Math.floor(targetRPS);
  } catch (e) {
    return 0;
  }
}

// Test teardown
export function teardown(data) {
  const duration = (Date.now() - data.startTime) / 1000;
  
  console.log('\n=== Breakpoint Test Results ===');
  console.log(`Test Duration: ${duration.toFixed(1)}s`);
  console.log(`Threshold: P95 < ${data.threshold}ms`);
  
  if (breakpointData.detected) {
    console.log('\n📊 Breakpoint Details:');
    console.log(`- RPS at breakpoint: ${formatNumber(breakpointData.rps)}`);
    console.log(`- Active VUs: ${formatNumber(breakpointData.vus)}`);
    console.log(`- P95 Response Time: ${breakpointData.p95.toFixed(0)}ms`);
    console.log(`- P99 Response Time: ${breakpointData.p99.toFixed(0)}ms`);
    console.log(`- Time to breakpoint: ${((breakpointData.timestamp - data.startTime) / 1000).toFixed(1)}s`);
    
    // Performance classification
    console.log('\n🏆 Performance Rating:');
    if (breakpointData.rps < 1000) {
      console.log('⚠️ Low - System breaks under light load');
      console.log('Recommendation: Urgent optimization needed');
    } else if (breakpointData.rps < 5000) {
      console.log('📊 Moderate - Acceptable for small-scale operations');
      console.log('Recommendation: Optimize for growth');
    } else if (breakpointData.rps < 10000) {
      console.log('✅ Good - Handles significant load');
      console.log('Recommendation: Fine-tune specific bottlenecks');
    } else {
      console.log('🌟 Excellent - High-performance system');
      console.log('Recommendation: Monitor and maintain');
    }
    
    // Bottleneck analysis
    console.log('\n🔍 Potential Bottlenecks:');
    if (breakpointData.p95 > 1000) {
      console.log('- Database query optimization needed');
    }
    if (breakpointData.p99 > breakpointData.p95 * 2) {
      console.log('- High variance indicates instability');
    }
    if (breakpointData.rps < breakpointData.vus) {
      console.log('- Connection pooling or queuing issues');
    }
  } else {
    console.log('\n✅ Breakpoint NOT reached!');
    console.log('System maintained P95 < 500ms throughout the test');
    console.log(`Maximum tested RPS: ${formatNumber(getCurrentRPS())}`);
  }
  
  console.log('==============================');
}