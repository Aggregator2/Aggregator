import { config } from 'dotenv';
import { resolve } from 'path';

// Load test environment
config({ path: resolve(__dirname, '../.env.test') });

async function quickTest() {
  console.log('🔍 Quick System Check\n');
  
  // 1. Check environment
  console.log('Environment variables:');
  console.log('- NODE_ENV:', process.env.NODE_ENV);
  console.log('- DATABASE_URL:', process.env.DATABASE_URL ? '✅ Set' : '❌ Missing');
  console.log('- RPC_URL:', process.env.RPC_URL || 'Missing');
  console.log('- WS_PORT:', process.env.WS_PORT || '3001');
  
  // 2. Check if we can import modules
  console.log('\n📦 Module imports:');
  try {
    const { db } = await import('../src/database/connection');
    console.log('✅ Database module loaded');
  } catch (error: any) {
    console.log('❌ Database module error:', error.message);
  }
  
  try {
    const { getMatchingEngine } = await import('../src/services/matchingEngine/singleton');
    console.log('✅ Matching engine module loaded');
  } catch (error: any) {
    console.log('❌ Matching engine error:', error.message);
  }
  
  try {
    const { getWebSocketServer } = await import('../src/websocket/server');
    console.log('✅ WebSocket module loaded');
  } catch (error: any) {
    console.log('❌ WebSocket module error:', error.message);
  }
  
  console.log('\n✨ Quick check complete!');
}

quickTest().catch(console.error);