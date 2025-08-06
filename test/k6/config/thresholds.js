/**
 * K6 Performance Thresholds Configuration
 * Defines success criteria for different test scenarios
 */

export const thresholds = {
  // HTTP request duration thresholds
  http_req_duration: [
    'p(50)<100',   // 50% of requests should be below 100ms
    'p(90)<200',   // 90% of requests should be below 200ms
    'p(95)<500',   // 95% of requests should be below 500ms
    'p(99)<1000',  // 99% of requests should be below 1000ms
  ],
  
  // HTTP request failure rate
  http_req_failed: ['rate<0.01'], // Error rate should be less than 1%
  
  // WebSocket thresholds
  ws_connecting: ['p(95)<500'],    // WebSocket connection time
  ws_msgs_received: ['count>0'],   // Should receive messages
  ws_msgs_sent: ['count>0'],       // Should send messages
  
  // Custom metrics thresholds
  order_placement_duration: ['p(95)<200'],
  order_matching_duration: ['p(95)<50'],
  orderbook_fetch_duration: ['p(95)<100'],
  trade_execution_duration: ['p(95)<300'],
};

export const breakpointThresholds = {
  // Stricter thresholds for breakpoint testing
  http_req_duration: ['p(95)<500'], // Stop when 95th percentile exceeds 500ms
  http_req_failed: ['rate<0.05'],   // Stop when error rate exceeds 5%
};

export const stressThresholds = {
  // Relaxed thresholds for stress testing
  http_req_duration: ['p(95)<2000'], // Allow up to 2s for 95th percentile
  http_req_failed: ['rate<0.1'],     // Allow up to 10% error rate
};

export const soakThresholds = {
  // Thresholds for long-running soak tests
  http_req_duration: [
    'p(50)<150',   // Slightly relaxed for sustained load
    'p(95)<750',   
    'p(99)<1500',
  ],
  http_req_failed: ['rate<0.02'], // 2% error rate for soak test
  
  // Memory and resource thresholds (custom metrics)
  memory_usage: ['value<90'],      // Memory usage should stay below 90%
  cpu_usage: ['value<80'],         // CPU usage should stay below 80%
  connection_pool_usage: ['value<85'], // Connection pool usage below 85%
};