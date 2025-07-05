#!/usr/bin/env node

const http = require('http');

const options = {
  hostname: 'localhost',
  port: process.env.PORT || 3000,
  path: '/health',
  method: 'GET',
  timeout: 5000
};

const req = http.request(options, (res) => {
  let data = '';
  
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    if (res.statusCode === 200) {
      try {
        const health = JSON.parse(data);
        if (health.status === 'healthy' || health.status === 'degraded') {
          process.exit(0);
        } else {
          console.error('Unhealthy status:', health.status);
          process.exit(1);
        }
      } catch (error) {
        console.error('Invalid health response');
        process.exit(1);
      }
    } else {
      console.error('Health check failed with status:', res.statusCode);
      process.exit(1);
    }
  });
});

req.on('error', (error) => {
  console.error('Health check error:', error.message);
  process.exit(1);
});

req.on('timeout', () => {
  console.error('Health check timeout');
  req.destroy();
  process.exit(1);
});

req.end();