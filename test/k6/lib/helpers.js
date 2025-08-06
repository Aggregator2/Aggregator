/**
 * K6 Test Helpers and Utilities
 */

import { check, fail } from 'k6';
import { Rate, Trend, Counter, Gauge } from 'k6/metrics';
import encoding from 'k6/encoding';

// Custom metrics
export const orderPlacementDuration = new Trend('order_placement_duration');
export const orderMatchingDuration = new Trend('order_matching_duration');
export const orderbookFetchDuration = new Trend('orderbook_fetch_duration');
export const tradeExecutionDuration = new Trend('trade_execution_duration');
export const successfulOrders = new Counter('successful_orders');
export const failedOrders = new Counter('failed_orders');
export const activeConnections = new Gauge('active_connections');

// Generate random Ethereum address
export function generateAddress() {
  const chars = '0123456789abcdef';
  let address = '0x';
  for (let i = 0; i < 40; i++) {
    address += chars[Math.floor(Math.random() * chars.length)];
  }
  return address;
}

// Generate random order data
export function generateOrder(pair = 'ETH-USDC', userId = null) {
  const side = Math.random() > 0.5 ? 'buy' : 'sell';
  const basePrice = 1850; // ETH price
  const priceVariation = basePrice * 0.01; // 1% variation
  
  return {
    id: `order_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    userId: userId || generateAddress(),
    pair: pair,
    side: side,
    type: Math.random() > 0.8 ? 'market' : 'limit',
    price: basePrice + (Math.random() - 0.5) * priceVariation,
    amount: Math.random() * 5 + 0.1, // 0.1 to 5.1 ETH
    timestamp: Date.now()
  };
}

// Generate signature for order (mock)
export function generateSignature(order) {
  const message = JSON.stringify({
    pair: order.pair,
    side: order.side,
    price: order.price,
    amount: order.amount,
    nonce: Date.now()
  });
  
  // Mock signature - in real tests, use actual signing
  return {
    r: '0x' + encoding.b64encode(message).substring(0, 64),
    s: '0x' + encoding.b64encode(message).substring(64, 128),
    v: 27
  };
}

// Check response and record metrics
export function checkResponse(res, metricName = null, expectedStatus = 200) {
  const checks = check(res, {
    [`status is ${expectedStatus}`]: (r) => r.status === expectedStatus,
    'response time < 500ms': (r) => r.timings.duration < 500,
    'has valid JSON body': (r) => {
      try {
        if (r.body) JSON.parse(r.body);
        return true;
      } catch (e) {
        return false;
      }
    }
  });
  
  if (metricName && res.timings) {
    metricName.add(res.timings.duration);
  }
  
  if (!checks && res.status !== expectedStatus) {
    console.error(`Request failed: ${res.status} - ${res.body}`);
  }
  
  return checks;
}

// WebSocket message handler
export function handleWebSocketMessage(msg, socket) {
  try {
    const data = JSON.parse(msg);
    
    switch (data.type) {
      case 'orderbook_update':
        // Handle orderbook updates
        console.log(`Orderbook update for ${data.pair}: ${data.bids.length} bids, ${data.asks.length} asks`);
        break;
        
      case 'trade_execution':
        // Handle trade execution
        console.log(`Trade executed: ${data.amount} @ ${data.price}`);
        break;
        
      case 'order_status':
        // Handle order status updates
        console.log(`Order ${data.orderId} status: ${data.status}`);
        break;
        
      default:
        console.log(`Unknown message type: ${data.type}`);
    }
  } catch (e) {
    console.error('Failed to parse WebSocket message:', e);
  }
}

// Gradually increase load
export function calculateVUs(currentTime, rampUpTime, maxVUs) {
  if (currentTime >= rampUpTime) {
    return maxVUs;
  }
  return Math.floor((currentTime / rampUpTime) * maxVUs);
}

// Generate trading pairs
export function getTradingPairs() {
  return [
    'ETH-USDC',
    'BTC-USDC',
    'SOL-USDC',
    'MATIC-USDC',
    'LINK-USDC',
    'UNI-USDC',
    'AAVE-USDC',
    'CRV-USDC'
  ];
}

// Get random trading pair
export function getRandomPair() {
  const pairs = getTradingPairs();
  return pairs[Math.floor(Math.random() * pairs.length)];
}

// Sleep with jitter
export function sleepWithJitter(baseTime, jitterPercent = 0.2) {
  const jitter = baseTime * jitterPercent;
  const actualTime = baseTime + (Math.random() - 0.5) * jitter;
  return Math.max(0, actualTime);
}

// Format number with commas
export function formatNumber(num) {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// Calculate percentiles from array
export function calculatePercentiles(values, percentiles = [50, 90, 95, 99]) {
  if (!values || values.length === 0) return {};
  
  const sorted = values.slice().sort((a, b) => a - b);
  const result = {};
  
  percentiles.forEach(p => {
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    result[`p${p}`] = sorted[Math.max(0, index)];
  });
  
  return result;
}

// Create batch of orders for bulk testing
export function createOrderBatch(size, pair = null) {
  const orders = [];
  for (let i = 0; i < size; i++) {
    orders.push(generateOrder(pair || getRandomPair()));
  }
  return orders;
}

// Monitor system resources (mock - would integrate with actual monitoring)
export function checkSystemResources() {
  // In real implementation, this would query monitoring endpoints
  return {
    cpu: Math.random() * 100,
    memory: Math.random() * 100,
    connections: Math.floor(Math.random() * 1000),
    queueDepth: Math.floor(Math.random() * 100)
  };
}