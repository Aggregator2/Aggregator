// Simple WebSocket test to verify module loading
const io = require('socket.io-client');

console.log('Testing WebSocket connection...');

const socket = io('http://localhost:3001', {
  transports: ['websocket'],
  reconnection: false
});

socket.on('connect', () => {
  console.log('✅ Connected to WebSocket server');
  socket.disconnect();
  process.exit(0);
});

socket.on('connect_error', (error) => {
  console.log('❌ WebSocket connection failed:', error.message);
  process.exit(1);
});

setTimeout(() => {
  console.log('❌ Connection timeout');
  process.exit(1);
}, 5000);