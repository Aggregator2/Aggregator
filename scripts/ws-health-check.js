#!/usr/bin/env node

const WebSocket = require('ws');

const wsUrl = `ws://localhost:${process.env.WS_PORT || 3001}/health`;
const timeout = 5000;

const ws = new WebSocket(wsUrl);
let timeoutId;

timeoutId = setTimeout(() => {
  console.error('WebSocket health check timeout');
  ws.terminate();
  process.exit(1);
}, timeout);

ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'ping' }));
});

ws.on('message', (data) => {
  clearTimeout(timeoutId);
  try {
    const message = JSON.parse(data);
    if (message.type === 'pong') {
      ws.close();
      process.exit(0);
    } else {
      console.error('Unexpected response:', message);
      process.exit(1);
    }
  } catch (error) {
    console.error('Invalid response:', error.message);
    process.exit(1);
  }
});

ws.on('error', (error) => {
  clearTimeout(timeoutId);
  console.error('WebSocket health check error:', error.message);
  process.exit(1);
});

ws.on('close', () => {
  clearTimeout(timeoutId);
});