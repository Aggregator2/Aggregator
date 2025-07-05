#!/usr/bin/env node

import { createServer } from 'http';
import { Server } from 'socket.io';
import Redis from 'ioredis';

async function checkSetup() {
  console.log('🔍 Checking WebSocket and Redis setup...\n');

  // Check Redis
  console.log('1. Checking Redis connection...');
  try {
    const redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      connectTimeout: 5000
    });

    await redis.ping();
    console.log('✅ Redis is running and accessible');
    
    const info = await redis.info('server');
    const version = info.match(/redis_version:(.+)/)?.[1];
    console.log(`   Version: ${version}`);
    
    await redis.quit();
  } catch (error) {
    console.log('❌ Redis is not accessible');
    console.log(`   Error: ${error.message}`);
    console.log('   Make sure Redis is installed and running: redis-server');
  }

  // Check WebSocket port availability
  console.log('\n2. Checking WebSocket port availability...');
  const wsPort = parseInt(process.env.WS_PORT || '3001');
  
  try {
    await new Promise((resolve, reject) => {
      const testServer = createServer();
      testServer.once('error', reject);
      testServer.once('listening', () => {
        testServer.close();
        resolve(undefined);
      });
      testServer.listen(wsPort);
    });
    
    console.log(`✅ Port ${wsPort} is available for WebSocket server`);
  } catch (error: any) {
    if (error.code === 'EADDRINUSE') {
      console.log(`⚠️  Port ${wsPort} is already in use`);
      console.log('   This might mean the WebSocket server is already running');
    } else {
      console.log(`❌ Error checking port: ${error.message}`);
    }
  }

  // Check main API
  console.log('\n3. Checking main API server...');
  try {
    const response = await fetch('http://localhost:3000/api/health');
    if (response.ok) {
      console.log('✅ Main API server is running');
    } else {
      console.log(`⚠️  Main API server responded with status: ${response.status}`);
    }
  } catch (error) {
    console.log('❌ Main API server is not accessible');
    console.log('   Make sure to run: npm run dev');
  }

  // Check WebSocket endpoint
  console.log('\n4. Checking WebSocket endpoint...');
  try {
    const response = await fetch('http://localhost:3000/api/websocket');
    if (response.ok) {
      const data = await response.json();
      console.log('✅ WebSocket endpoint is configured');
      console.log(`   Status: ${data.status}`);
      console.log(`   URL: ${data.url}`);
    } else {
      console.log(`⚠️  WebSocket endpoint responded with status: ${response.status}`);
    }
  } catch (error) {
    console.log('❌ WebSocket endpoint is not accessible');
  }

  // Environment check
  console.log('\n5. Checking environment variables...');
  const envVars = {
    'REDIS_HOST': process.env.REDIS_HOST || 'localhost (default)',
    'REDIS_PORT': process.env.REDIS_PORT || '6379 (default)',
    'WS_PORT': process.env.WS_PORT || '3001 (default)',
    'FRONTEND_URL': process.env.FRONTEND_URL || 'http://localhost:3000 (default)',
    'NODE_ENV': process.env.NODE_ENV || 'development (default)'
  };

  Object.entries(envVars).forEach(([key, value]) => {
    console.log(`   ${key}: ${value}`);
  });

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('SETUP SUMMARY');
  console.log('='.repeat(50));
  console.log('\nTo run the tests:');
  console.log('1. Make sure Redis is running: redis-server');
  console.log('2. Start the main application: npm run dev');
  console.log('3. Run tests: cd tests && npm test');
  console.log('\nFor detailed testing:');
  console.log('- Health check: npm run health');
  console.log('- Full report: npm run test:report');
}

checkSetup().catch(console.error);