const WebSocket = require('ws');

// Create WebSocket server
const wss = new WebSocket.Server({ port: 3001 });

console.log('WebSocket server running on ws://localhost:3001');

// Store connected clients
const clients = new Set();

wss.on('connection', (ws) => {
  console.log('New client connected');
  clients.add(ws);

  // Send welcome message
  ws.send(JSON.stringify({
    type: 'connected',
    message: 'Connected to order status WebSocket'
  }));

  ws.on('message', (message) => {
    console.log('Received:', message.toString());
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    clients.delete(ws);
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

// Simulate order updates
function simulateOrderUpdate(orderId, status, txHash = null) {
  const update = {
    orderId,
    status,
    timestamp: Date.now(),
    txHash
  };

  const message = JSON.stringify(update);
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// Export for external use
module.exports = { simulateOrderUpdate };

// Simulate some test updates if running standalone
if (require.main === module) {
  console.log('Running in standalone mode - will simulate updates');
  
  // Simulate order updates every 5 seconds
  let orderCounter = 1;
  setInterval(() => {
    const orderId = `test-order-${orderCounter++}`;
    const statuses = ['submitted', 'processing', 'completed', 'failed'];
    const status = statuses[Math.floor(Math.random() * statuses.length)];
    
    console.log(`Simulating update: ${orderId} -> ${status}`);
    simulateOrderUpdate(orderId, status);
  }, 5000);
}