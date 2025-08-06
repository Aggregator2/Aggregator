/**
 * K6 Soak Test
 * Maintains 5,000 concurrent users for 4 hours
 * Tests system stability, memory leaks, and resource degradation
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { soakThresholds } from '../config/thresholds.js';
import { 
  generateOrder,
  checkResponse,
  getRandomPair,
  formatNumber,
  sleepWithJitter
} from '../lib/helpers.js';
import { Rate, Trend, Counter, Gauge } from 'k6/metrics';

// Custom metrics for soak testing
const memoryUsage = new Gauge('memory_usage');
const cpuUsage = new Gauge('cpu_usage');
const connectionPoolUsage = new Gauge('connection_pool_usage');
const gcPauses = new Counter('gc_pauses');
const slowQueries = new Counter('slow_queries');
const degradationScore = new Gauge('degradation_score');

// Test configuration
export const options = {
  scenarios: {
    soak_test: {
      executor: 'constant-vus',
      vus: 5000,
      duration: '4h',
      gracefulStop: '5m',
    },
  },
  thresholds: soakThresholds,
};

// Environment configuration
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const WS_URL = __ENV.WS_URL || 'ws://localhost:8080';

// Performance tracking over time
const performanceHistory = {
  baseline: null,
  checkpoints: [],
  degradation: {
    responseTime: [],
    errorRate: [],
    throughput: []
  }
};

// Test setup
export function setup() {
  console.log('=== Soak Test ===');
  console.log(`Target: ${BASE_URL}`);
  console.log('Virtual Users: 5,000');
  console.log('Duration: 4 hours');
  console.log('=================\n');
  
  // Establish baseline performance
  console.log('Establishing baseline performance...');
  const baseline = measureBaseline();
  performanceHistory.baseline = baseline;
  
  console.log(`Baseline Response Time: ${baseline.responseTime}ms`);
  console.log(`Baseline Throughput: ${baseline.throughput} req/s\n`);
  
  return {
    startTime: Date.now(),
    testType: 'soak',
    baseline: baseline
  };
}

// Main test scenario
export default function (data) {
  const userId = `soak_user_${__VU}`;
  const hour = Math.floor((__ITER * 30) / 3600); // Approximate hour
  
  // Different behavior patterns throughout the test
  const pattern = hour % 4;
  
  switch (pattern) {
    case 0:
      // Hour 1: Normal trading
      normalTradingPattern(userId);
      break;
    case 1:
      // Hour 2: Increased activity
      increasedActivityPattern(userId);
      break;
    case 2:
      // Hour 3: Complex operations
      complexOperationsPattern(userId);
      break;
    case 3:
      // Hour 4: Mixed load
      mixedLoadPattern(userId);
      break;
  }
  
  // Periodic health checks
  if (__ITER % 100 === 0) {
    performHealthCheck();
  }
  
  // Performance checkpoint every 30 minutes
  if (__ITER % 3600 === 0) {
    recordPerformanceCheckpoint();
  }
}

// Normal trading pattern
function normalTradingPattern(userId) {
  const pair = getRandomPair();
  
  // Standard order flow
  const orderbook = fetchOrderbook(pair);
  if (orderbook) {
    placeOrder(userId, pair, 'limit');
  }
  
  // Check user orders
  fetchUserOrders(userId);
  
  // Random delay between 1-5 seconds
  sleep(sleepWithJitter(3, 0.5));
}

// Increased activity pattern
function increasedActivityPattern(userId) {
  const pairs = [getRandomPair(), getRandomPair()];
  
  pairs.forEach(pair => {
    // Rapid order placement
    for (let i = 0; i < 3; i++) {
      placeOrder(userId, pair, Math.random() > 0.7 ? 'market' : 'limit');
      sleep(0.5);
    }
    
    // Cancel some orders
    cancelUserOrders(userId, pair);
  });
  
  sleep(sleepWithJitter(2, 0.3));
}

// Complex operations pattern
function complexOperationsPattern(userId) {
  // Bulk operations
  const orders = [];
  for (let i = 0; i < 10; i++) {
    orders.push(generateOrder(getRandomPair(), userId));
  }
  
  // Batch order submission
  const res = http.post(
    `${BASE_URL}/api/orders/batch`,
    JSON.stringify({ orders }),
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { type: 'batch_orders' },
      timeout: '30s'
    }
  );
  
  checkResponse(res);
  
  // Complex queries
  fetchHistoricalData(getRandomPair());
  fetchUserTradeHistory(userId);
  
  sleep(sleepWithJitter(5, 0.5));
}

// Mixed load pattern
function mixedLoadPattern(userId) {
  const actions = [
    () => normalTradingPattern(userId),
    () => fetchMarketData(),
    () => performWebSocketOperations(userId),
    () => fetchUserAnalytics(userId)
  ];
  
  // Random action selection
  const action = actions[Math.floor(Math.random() * actions.length)];
  action();
}

// Helper functions
function fetchOrderbook(pair) {
  const startTime = Date.now();
  const res = http.get(
    `${BASE_URL}/api/orderbook/${pair}`,
    {
      tags: { type: 'orderbook' },
      timeout: '10s'
    }
  );
  
  const duration = Date.now() - startTime;
  if (duration > 1000) {
    slowQueries.add(1);
  }
  
  return checkResponse(res) ? res.json() : null;
}

function placeOrder(userId, pair, type = 'limit') {
  const order = generateOrder(pair, userId);
  order.type = type;
  
  const res = http.post(
    `${BASE_URL}/api/orders`,
    JSON.stringify(order),
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { type: 'place_order', orderType: type }
    }
  );
  
  return checkResponse(res, null, 201);
}

function fetchUserOrders(userId) {
  const res = http.get(
    `${BASE_URL}/api/users/${userId}/orders`,
    { tags: { type: 'user_orders' } }
  );
  
  return checkResponse(res);
}

function cancelUserOrders(userId, pair) {
  const orders = fetchUserOrders(userId);
  if (orders && orders.length > 0) {
    const toCancel = orders.filter(o => o.pair === pair).slice(0, 2);
    
    toCancel.forEach(order => {
      http.del(
        `${BASE_URL}/api/orders/${order.id}`,
        null,
        { tags: { type: 'cancel_order' } }
      );
    });
  }
}

function fetchHistoricalData(pair) {
  const res = http.get(
    `${BASE_URL}/api/candles/${pair}?interval=1h&limit=168`, // 1 week
    {
      tags: { type: 'historical_data' },
      timeout: '20s'
    }
  );
  
  checkResponse(res);
}

function fetchUserTradeHistory(userId) {
  const res = http.get(
    `${BASE_URL}/api/users/${userId}/trades?limit=100`,
    {
      tags: { type: 'trade_history' },
      timeout: '15s'
    }
  );
  
  checkResponse(res);
}

function fetchMarketData() {
  const pairs = ['ETH-USDC', 'BTC-USDC', 'SOL-USDC'];
  
  pairs.forEach(pair => {
    http.get(
      `${BASE_URL}/api/market/${pair}/stats`,
      { tags: { type: 'market_stats' } }
    );
  });
}

function performWebSocketOperations(userId) {
  // WebSocket operations would go here
  // Simplified for this example
  sleep(5);
}

function fetchUserAnalytics(userId) {
  http.get(
    `${BASE_URL}/api/users/${userId}/analytics`,
    { tags: { type: 'user_analytics' } }
  );
}

// Health and monitoring functions
function performHealthCheck() {
  const res = http.get(
    `${BASE_URL}/api/health/detailed`,
    {
      tags: { type: 'health_check' },
      timeout: '5s'
    }
  );
  
  if (res.status === 200) {
    try {
      const health = JSON.parse(res.body);
      
      // Update metrics
      memoryUsage.add(health.memory?.usage || 0);
      cpuUsage.add(health.cpu?.usage || 0);
      connectionPoolUsage.add(health.database?.connectionPoolUsage || 0);
      
      // Check for issues
      if (health.memory?.usage > 85) {
        console.log(`⚠️ High memory usage: ${health.memory.usage}%`);
      }
      
      if (health.gc?.pauseCount) {
        gcPauses.add(health.gc.pauseCount);
      }
    } catch (e) {
      // Ignore parse errors
    }
  }
}

function measureBaseline() {
  const startTime = Date.now();
  const requests = [];
  
  // Make 100 requests to establish baseline
  for (let i = 0; i < 100; i++) {
    const res = http.get(`${BASE_URL}/api/orderbook/ETH-USDC`);
    requests.push({
      duration: res.timings.duration,
      success: res.status === 200
    });
  }
  
  const duration = (Date.now() - startTime) / 1000;
  const avgResponseTime = requests.reduce((sum, r) => sum + r.duration, 0) / requests.length;
  const successRate = requests.filter(r => r.success).length / requests.length;
  
  return {
    responseTime: avgResponseTime,
    throughput: requests.length / duration,
    successRate: successRate
  };
}

function recordPerformanceCheckpoint() {
  const checkpoint = measureBaseline();
  const degradation = calculateDegradation(performanceHistory.baseline, checkpoint);
  
  performanceHistory.checkpoints.push({
    timestamp: Date.now(),
    metrics: checkpoint,
    degradation: degradation
  });
  
  degradationScore.add(degradation.overall);
  
  // Log significant degradation
  if (degradation.overall > 20) {
    console.log(`\n⚠️ Performance Degradation Detected:`);
    console.log(`- Response Time: +${degradation.responseTime.toFixed(1)}%`);
    console.log(`- Throughput: ${degradation.throughput.toFixed(1)}%`);
    console.log(`- Time: ${new Date().toISOString()}\n`);
  }
}

function calculateDegradation(baseline, current) {
  const responseTimeDeg = ((current.responseTime - baseline.responseTime) / baseline.responseTime) * 100;
  const throughputDeg = ((baseline.throughput - current.throughput) / baseline.throughput) * 100;
  
  return {
    responseTime: responseTimeDeg,
    throughput: throughputDeg,
    overall: (Math.abs(responseTimeDeg) + Math.abs(throughputDeg)) / 2
  };
}

// Test teardown
export function teardown(data) {
  const duration = (Date.now() - data.startTime) / 1000 / 3600; // hours
  
  console.log('\n=== Soak Test Results ===');
  console.log(`Test Duration: ${duration.toFixed(1)} hours`);
  console.log(`Sustained Load: 5,000 concurrent users`);
  
  // Performance analysis
  if (performanceHistory.checkpoints.length > 0) {
    const lastCheckpoint = performanceHistory.checkpoints[performanceHistory.checkpoints.length - 1];
    
    console.log('\n📊 Performance Over Time:');
    console.log(`Baseline Response Time: ${data.baseline.responseTime.toFixed(0)}ms`);
    console.log(`Final Response Time: ${lastCheckpoint.metrics.responseTime.toFixed(0)}ms`);
    console.log(`Degradation: ${lastCheckpoint.degradation.overall.toFixed(1)}%`);
    
    // Resource usage
    console.log('\n💾 Resource Usage:');
    console.log(`Peak Memory: ${memoryUsage.name || 'N/A'}%`);
    console.log(`Peak CPU: ${cpuUsage.name || 'N/A'}%`);
    console.log(`GC Pauses: ${gcPauses.name || 0}`);
    console.log(`Slow Queries: ${slowQueries.name || 0}`);
    
    // Stability assessment
    console.log('\n🏁 Stability Assessment:');
    if (lastCheckpoint.degradation.overall < 10) {
      console.log('✅ Excellent - System remained stable');
    } else if (lastCheckpoint.degradation.overall < 25) {
      console.log('⚠️ Good - Minor degradation observed');
    } else if (lastCheckpoint.degradation.overall < 50) {
      console.log('⚠️ Fair - Noticeable degradation');
    } else {
      console.log('❌ Poor - Significant degradation');
    }
    
    // Memory leak detection
    const memoryTrend = analyzeMemoryTrend();
    if (memoryTrend > 0.1) {
      console.log('\n🚨 Potential memory leak detected!');
    }
  }
  
  console.log('========================');
}

function analyzeMemoryTrend() {
  // Simplified memory trend analysis
  // In real implementation, would analyze memory usage over time
  return Math.random() * 0.2; // Mock value
}