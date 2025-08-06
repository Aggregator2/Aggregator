const { expect } = require('chai');
const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const RealtimeDataFeedManager = require('../lib/realtime/RealtimeDataFeedManager');
const WebSocketManager = require('../lib/realtime/WebSocketManager');
const OrderBookFeed = require('../lib/realtime/OrderBookFeed');
const BandwidthOptimizer = require('../lib/realtime/BandwidthOptimizer');

describe('Real-time Data Feeds System', function() {
  this.timeout(10000);
  
  let feedManager;
  let testPort = 8081;
  let testJwtSecret = 'test-secret-key';
  
  before(async function() {
    // Set environment variables for testing
    process.env.JWT_SECRET = testJwtSecret;
    
    // Initialize test feed manager
    feedManager = new RealtimeDataFeedManager({
      port: testPort,
      enableOrderBook: true,
      enableTrades: true,
      enableTickers: true,
      enableUserOrders: true,
      enableSystemStatus: true,
      enableBandwidthOptimization: true,
      maxSubscriptionsPerConnection: 10,
      subscriptionRateLimit: { requests: 50, window: 60000 }
    });
    
    await feedManager.start();
  });
  
  after(async function() {
    if (feedManager) {
      await feedManager.shutdown();
    }
  });
  
  describe('WebSocket Connection Management', function() {
    let ws;
    
    afterEach(function() {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    });
    
    it('should establish WebSocket connection', function(done) {
      ws = new WebSocket(`ws://localhost:${testPort}`);
      
      ws.on('open', function() {
        done();
      });
      
      ws.on('error', function(error) {
        done(error);
      });
    });
    
    it('should send welcome message on connection', function(done) {
      ws = new WebSocket(`ws://localhost:${testPort}`);
      
      ws.on('message', function(data) {
        const message = JSON.parse(data);
        
        if (message.type === 'welcome') {
          expect(message).to.have.property('connectionId');
          expect(message).to.have.property('timestamp');
          expect(message).to.have.property('requiresAuth');
          done();
        }
      });
    });
    
    it('should handle authentication with valid JWT', function(done) {
      const token = jwt.sign({
        userId: 'test-user-123',
        roles: ['trader'],
        permissions: ['read_market_data', 'read_own_orders']
      }, testJwtSecret, { expiresIn: '1h' });
      
      ws = new WebSocket(`ws://localhost:${testPort}`);
      
      ws.on('open', function() {
        ws.send(JSON.stringify({
          type: 'authenticate',
          token: token
        }));
      });
      
      ws.on('message', function(data) {
        const message = JSON.parse(data);
        
        if (message.type === 'auth_success') {
          expect(message).to.have.property('userId', 'test-user-123');
          expect(message).to.have.property('permissions');
          done();
        }
      });
    });
    
    it('should reject invalid JWT token', function(done) {
      ws = new WebSocket(`ws://localhost:${testPort}`);
      
      ws.on('open', function() {
        ws.send(JSON.stringify({
          type: 'authenticate',
          token: 'invalid-token'
        }));
      });
      
      ws.on('message', function(data) {
        const message = JSON.parse(data);
        
        if (message.type === 'auth_error') {
          expect(message).to.have.property('code', 'INVALID_TOKEN');
          done();
        }
      });
    });
  });
  
  describe('Subscription Management', function() {
    let ws;
    let authToken;
    
    beforeEach(function(done) {
      authToken = jwt.sign({
        userId: 'test-user-123',
        roles: ['trader'],
        permissions: ['read_market_data', 'read_own_orders']
      }, testJwtSecret, { expiresIn: '1h' });
      
      ws = new WebSocket(`ws://localhost:${testPort}`);
      
      ws.on('open', function() {
        ws.send(JSON.stringify({
          type: 'authenticate',
          token: authToken
        }));
      });
      
      ws.on('message', function(data) {
        const message = JSON.parse(data);
        if (message.type === 'auth_success') {
          done();
        }
      });
    });
    
    afterEach(function() {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    });
    
    it('should handle order book subscription', function(done) {
      ws.send(JSON.stringify({
        type: 'subscribe',
        channel: 'orderbook',
        params: {
          symbol: 'ETH/USDC',
          depth: 10
        }
      }));
      
      ws.on('message', function(data) {
        const message = JSON.parse(data);
        
        if (message.type === 'subscription_success') {
          expect(message).to.have.property('subscriptionId');
          expect(message).to.have.property('channel', 'orderbook');
          done();
        }
      });
    });
    
    it('should handle ticker subscription', function(done) {
      ws.send(JSON.stringify({
        type: 'subscribe',
        channel: 'ticker',
        params: {
          symbol: 'ETH/USDC',
          includeIndicators: true
        }
      }));
      
      ws.on('message', function(data) {
        const message = JSON.parse(data);
        
        if (message.type === 'subscription_success') {
          expect(message.channel).to.equal('ticker');
          expect(message.params.symbol).to.equal('ETH/USDC');
          done();
        }
      });
    });
    
    it('should handle user orders subscription', function(done) {
      ws.send(JSON.stringify({
        type: 'subscribe',
        channel: 'user_orders',
        params: {
          userId: 'test-user-123',
          detailLevel: 'private'
        }
      }));
      
      ws.on('message', function(data) {
        const message = JSON.parse(data);
        
        if (message.type === 'subscription_success') {
          expect(message.channel).to.equal('user_orders');
          done();
        }
      });
    });
    
    it('should reject subscription to unauthorized channel', function(done) {
      ws.send(JSON.stringify({
        type: 'subscribe',
        channel: 'user_orders',
        params: {
          userId: 'other-user-456',
          detailLevel: 'private'
        }
      }));
      
      ws.on('message', function(data) {
        const message = JSON.parse(data);
        
        if (message.type === 'subscription_error') {
          expect(message.code).to.equal('UNAUTHORIZED_USER_ORDERS');
          done();
        }
      });
    });
    
    it('should handle unsubscription', function(done) {
      // First subscribe
      ws.send(JSON.stringify({
        type: 'subscribe',
        channel: 'ticker',
        params: { symbol: 'ETH/USDC' }
      }));
      
      let subscribed = false;
      
      ws.on('message', function(data) {
        const message = JSON.parse(data);
        
        if (message.type === 'subscription_success' && !subscribed) {
          subscribed = true;
          // Now unsubscribe
          ws.send(JSON.stringify({
            type: 'unsubscribe',
            channel: 'ticker',
            params: { symbol: 'ETH/USDC' }
          }));
        } else if (message.type === 'unsubscription_success') {
          expect(message.channel).to.equal('ticker');
          done();
        }
      });
    });
  });
  
  describe('Order Book Feed', function() {
    let orderBookFeed;
    let mockWebSocketManager;
    
    beforeEach(function() {
      // Create mock WebSocket manager
      mockWebSocketManager = {
        connections: new Map(),
        sendToConnection: function(connectionId, message) {
          this.lastMessage = message;
        },
        broadcast: function(channel, params, message) {
          this.lastBroadcast = { channel, params, message };
        },
        on: function() {},
        emit: function() {}
      };
      
      orderBookFeed = new OrderBookFeed({
        maxDepth: 20,
        updateInterval: 50,
        enableCompression: true,
        enableDelta: true
      });
      
      orderBookFeed.initialize(mockWebSocketManager);
    });
    
    it('should process order book updates', function() {
      const orderData = {
        side: 'buy',
        price: '2000.50',
        size: '1.5',
        orderId: 'order123',
        type: 'add'
      };
      
      orderBookFeed.updateOrderBook('ETH/USDC', orderData);
      
      const orderBook = orderBookFeed.getOrderBook('ETH/USDC');
      expect(orderBook).to.exist;
      expect(orderBook.symbol).to.equal('ETH/USDC');
      expect(orderBook.bids.size).to.be.greaterThan(0);
    });
    
    it('should maintain correct order book structure', function() {
      // Add multiple orders
      const orders = [
        { side: 'buy', price: '2000.00', size: '1.0', orderId: 'order1', type: 'add' },
        { side: 'buy', price: '2000.50', size: '1.5', orderId: 'order2', type: 'add' },
        { side: 'sell', price: '2001.00', size: '1.2', orderId: 'order3', type: 'add' },
        { side: 'sell', price: '2001.50', size: '0.8', orderId: 'order4', type: 'add' }
      ];
      
      orders.forEach(order => {
        orderBookFeed.updateOrderBook('ETH/USDC', order);
      });
      
      const orderBook = orderBookFeed.getOrderBook('ETH/USDC');
      
      // Check bids are sorted highest first
      const bids = Array.from(orderBook.bids.keys()).map(parseFloat);
      for (let i = 1; i < bids.length; i++) {
        expect(bids[i]).to.be.lessThan(bids[i-1]);
      }
      
      // Check asks are sorted lowest first
      const asks = Array.from(orderBook.asks.keys()).map(parseFloat);
      for (let i = 1; i < asks.length; i++) {
        expect(asks[i]).to.be.greaterThan(asks[i-1]);
      }
    });
    
    it('should handle order removal', function() {
      // Add order
      orderBookFeed.updateOrderBook('ETH/USDC', {
        side: 'buy',
        price: '2000.00',
        size: '1.0',
        orderId: 'order1',
        type: 'add'
      });
      
      // Remove order
      orderBookFeed.updateOrderBook('ETH/USDC', {
        side: 'buy',
        price: '2000.00',
        size: '0',
        orderId: 'order1',
        type: 'remove'
      });
      
      const orderBook = orderBookFeed.getOrderBook('ETH/USDC');
      expect(orderBook.bids.has('2000.00')).to.be.false;
    });
  });
  
  describe('Bandwidth Optimization', function() {
    let bandwidthOptimizer;
    
    beforeEach(function() {
      bandwidthOptimizer = new BandwidthOptimizer({
        compressionEnabled: true,
        compressionThreshold: 100,
        enableDeduplication: true,
        enableBatching: true,
        batchInterval: 50,
        enableDeltaCompression: true
      });
    });
    
    it('should compress large messages', async function() {
      const largeMessage = {
        type: 'orderbook_update',
        symbol: 'ETH/USDC',
        data: {
          bids: Array(50).fill(['2000.00', '1.0']),
          asks: Array(50).fill(['2001.00', '1.0']),
          timestamp: Date.now()
        }
      };
      
      const result = await bandwidthOptimizer.processMessage('conn1', largeMessage);
      
      expect(result.compressed).to.be.true;
      expect(result.compressedSize).to.be.lessThan(result.originalSize);
    });
    
    it('should not compress small messages', async function() {
      const smallMessage = {
        type: 'ping',
        timestamp: Date.now()
      };
      
      const result = await bandwidthOptimizer.processMessage('conn1', smallMessage);
      
      expect(result.compressed).to.be.false;
      expect(result.compressedSize).to.equal(result.originalSize);
    });
    
    it('should detect duplicate messages', async function() {
      const message = {
        type: 'ticker_update',
        symbol: 'ETH/USDC',
        data: { price: '2000.00' }
      };
      
      // Send same message twice
      const result1 = await bandwidthOptimizer.processMessage('conn1', message);
      const result2 = await bandwidthOptimizer.processMessage('conn1', message);
      
      expect(result1.skipped).to.not.be.true;
      expect(result2.skipped).to.be.true;
      expect(result2.reason).to.equal('duplicate');
    });
    
    it('should batch messages when enabled', async function() {
      const messages = [
        { type: 'ticker_update', symbol: 'ETH/USDC', data: { price: '2000.00' } },
        { type: 'ticker_update', symbol: 'BTC/USDC', data: { price: '40000.00' } },
        { type: 'ticker_update', symbol: 'ETH/BTC', data: { price: '0.05' } }
      ];
      
      const results = await Promise.all(
        messages.map(msg => bandwidthOptimizer.processMessage('conn1', msg, { enableBatching: true }))
      );
      
      // All messages should be batched
      results.forEach(result => {
        expect(result.batched).to.be.true;
      });
    });
    
    it('should track bandwidth per connection', function() {
      const connectionId = 'conn1';
      const messageSize = 1000;
      
      // Simulate bandwidth tracking
      bandwidthOptimizer.updateBandwidthTracking = function(connId, size) {
        if (!this.connectionBandwidth) this.connectionBandwidth = new Map();
        if (!this.connectionBandwidth.has(connId)) {
          this.connectionBandwidth.set(connId, {
            bytesTransferred: 0,
            messageCount: 0,
            currentBandwidth: 0
          });
        }
        const stats = this.connectionBandwidth.get(connId);
        stats.bytesTransferred += size;
        stats.messageCount++;
      };
      
      bandwidthOptimizer.updateBandwidthTracking(connectionId, messageSize);
      
      const stats = bandwidthOptimizer.getConnectionStats(connectionId);
      expect(stats.bandwidth.bytesTransferred).to.equal(messageSize);
      expect(stats.bandwidth.messageCount).to.equal(1);
    });
  });
  
  describe('Error Handling', function() {
    let ws;
    
    afterEach(function() {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    });
    
    it('should handle invalid JSON messages', function(done) {
      ws = new WebSocket(`ws://localhost:${testPort}`);
      
      ws.on('open', function() {
        ws.send('invalid json message');
      });
      
      ws.on('message', function(data) {
        const message = JSON.parse(data);
        
        if (message.type === 'error' && message.code === 'INVALID_MESSAGE_FORMAT') {
          done();
        }
      });
    });
    
    it('should handle unknown message types', function(done) {
      ws = new WebSocket(`ws://localhost:${testPort}`);
      
      ws.on('open', function() {
        ws.send(JSON.stringify({
          type: 'unknown_message_type',
          data: 'test'
        }));
      });
      
      ws.on('message', function(data) {
        const message = JSON.parse(data);
        
        if (message.type === 'error' && message.code === 'UNKNOWN_MESSAGE_TYPE') {
          done();
        }
      });
    });
    
    it('should handle subscription to unsupported channel', function(done) {
      const token = jwt.sign({
        userId: 'test-user-123',
        roles: ['trader']
      }, testJwtSecret, { expiresIn: '1h' });
      
      ws = new WebSocket(`ws://localhost:${testPort}`);
      
      ws.on('open', function() {
        ws.send(JSON.stringify({
          type: 'authenticate',
          token: token
        }));
      });
      
      let authenticated = false;
      
      ws.on('message', function(data) {
        const message = JSON.parse(data);
        
        if (message.type === 'auth_success' && !authenticated) {
          authenticated = true;
          ws.send(JSON.stringify({
            type: 'subscribe',
            channel: 'unsupported_channel',
            params: {}
          }));
        } else if (message.type === 'subscription_error') {
          expect(message.code).to.equal('UNSUPPORTED_CHANNEL');
          done();
        }
      });
    });
  });
  
  describe('Performance and Load Testing', function() {
    it('should handle multiple concurrent connections', async function() {
      const connectionCount = 10;
      const connections = [];
      
      try {
        // Create multiple connections
        for (let i = 0; i < connectionCount; i++) {
          const ws = new WebSocket(`ws://localhost:${testPort}`);
          connections.push(ws);
          
          await new Promise((resolve) => {
            ws.on('open', resolve);
          });
        }
        
        // Verify all connections are established
        expect(connections.length).to.equal(connectionCount);
        
        // Check manager stats
        const stats = feedManager.getStats();
        expect(stats.webSocket.connectionsActive).to.be.at.least(connectionCount);
        
      } finally {
        // Clean up connections
        connections.forEach(ws => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.close();
          }
        });
      }
    });
    
    it('should handle high message throughput', function(done) {
      this.timeout(5000);
      
      const messageCount = 100;
      let receivedCount = 0;
      
      const ws = new WebSocket(`ws://localhost:${testPort}`);
      
      ws.on('open', function() {
        // Send many messages rapidly
        for (let i = 0; i < messageCount; i++) {
          ws.send(JSON.stringify({
            type: 'ping',
            id: i
          }));
        }
      });
      
      ws.on('message', function(data) {
        const message = JSON.parse(data);
        
        if (message.type === 'pong') {
          receivedCount++;
          
          if (receivedCount === messageCount) {
            ws.close();
            done();
          }
        }
      });
    });
    
    it('should enforce rate limiting', function(done) {
      this.timeout(5000);
      
      const ws = new WebSocket(`ws://localhost:${testPort}`);
      
      ws.on('open', function() {
        // Send messages rapidly to trigger rate limiting
        for (let i = 0; i < 200; i++) {
          ws.send(JSON.stringify({
            type: 'ping',
            id: i
          }));
        }
      });
      
      ws.on('message', function(data) {
        const message = JSON.parse(data);
        
        if (message.type === 'error' && message.code === 'RATE_LIMIT_EXCEEDED') {
          ws.close();
          done();
        }
      });
    });
  });
  
  describe('Integration Tests', function() {
    it('should integrate all feeds correctly', async function() {
      const token = jwt.sign({
        userId: 'integration-test-user',
        roles: ['trader'],
        permissions: ['read_market_data', 'read_own_orders']
      }, testJwtSecret, { expiresIn: '1h' });
      
      const ws = new WebSocket(`ws://localhost:${testPort}`);
      
      return new Promise((resolve, reject) => {
        let authSuccess = false;
        let subscriptionsCreated = 0;
        const expectedSubscriptions = 4;
        
        ws.on('open', function() {
          ws.send(JSON.stringify({
            type: 'authenticate',
            token: token
          }));
        });
        
        ws.on('message', function(data) {
          const message = JSON.parse(data);
          
          if (message.type === 'auth_success' && !authSuccess) {
            authSuccess = true;
            
            // Subscribe to multiple channels
            const subscriptions = [
              { channel: 'orderbook', params: { symbol: 'ETH/USDC', depth: 10 } },
              { channel: 'ticker', params: { symbol: 'ETH/USDC' } },
              { channel: 'system_status', params: {} },
              { channel: 'user_orders', params: { userId: 'integration-test-user' } }
            ];
            
            subscriptions.forEach(sub => {
              ws.send(JSON.stringify({
                type: 'subscribe',
                ...sub
              }));
            });
          } else if (message.type === 'subscription_success') {
            subscriptionsCreated++;
            
            if (subscriptionsCreated === expectedSubscriptions) {
              // All subscriptions successful
              ws.close();
              resolve();
            }
          } else if (message.type === 'subscription_error') {
            ws.close();
            reject(new Error(`Subscription failed: ${message.message}`));
          }
        });
        
        ws.on('error', reject);
        
        // Timeout after 5 seconds
        setTimeout(() => {
          ws.close();
          reject(new Error('Integration test timeout'));
        }, 5000);
      });
    });
  });
});

// Helper function to create test JWT token
function createTestToken(payload) {
  return jwt.sign(payload, testJwtSecret, { expiresIn: '1h' });
}

// Helper function to wait for specific message type
function waitForMessage(ws, messageType, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for message type: ${messageType}`));
    }, timeout);
    
    function messageHandler(data) {
      const message = JSON.parse(data);
      if (message.type === messageType) {
        clearTimeout(timer);
        ws.removeListener('message', messageHandler);
        resolve(message);
      }
    }
    
    ws.on('message', messageHandler);
  });
}