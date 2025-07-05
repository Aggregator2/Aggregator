#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// List of endpoints that should remain public
const PUBLIC_ENDPOINTS = [
  'health/index.ts',
  'health/detailed.ts',
  'websocket/status.js',
  'health-check.js',
  'chains.ts',
  'supported-tokens.ts',
  'tokens/comprehensive.ts',
  'tokens/comprehensive-v2.ts',
  'tokens/search.ts',
  'tokens/simple-search.ts',
  'tokens/popular.ts',
  'tokens/simple-popular.ts',
  'tokens/[chainId].ts',
  'quote.ts',
  'quote-profitable.ts',
  'unified-quote.ts',
  'unified-quote-simple.ts',
  'unified-swap-quote.ts',
  'tokenPrice.ts'
];

// Files to process
const filesToProcess = [
  // Order management
  'orders/history.js',
  'orders/[orderId].ts',
  'orders/status/[orderId].js',
  'orders/external/[orderId].js',
  'orders/external/pending.js',
  'orders/user/[userId].js',
  'orders/stream.js',
  'orders/settlement-proof/[orderId].js',
  'orderStatus/[orderId].ts',
  'seedOrders.js',
  
  // Trading
  'orderbook/[pair].js',
  'trades/[pair].js',
  'trading/quote.ts',
  
  // Settlement
  'settlement/epochs.ts',
  'settlement/status.ts',
  'settlement/proof/[tradeId].js',
  'settlement/proof/claim.js',
  'settlement/proof/user/[userId].js',
  'settlement/proof/verify.js',
  'settlement/user/[userId]/settlements.ts',
  'settlement/webhooks.ts',
  
  // Notifications
  'notifications/index.ts',
  'notifications/[id].ts',
  'notifications/read.ts',
  'notifications/read-all.ts',
  'notifications/batch-read.ts',
  'notifications/preferences.ts',
  'notifications/stats.ts',
  'notifications/webhook-test.ts',
  
  // Market maker
  'market-maker/apply.ts',
  
  // Channels
  'channels/create.js',
  'channels/[channelId]/state.js',
  'channels/[channelId]/trade.js',
  'channels/[channelId]/settle.js',
  'channels/metrics.js',
  
  // WebSocket
  'websocket.ts',
  'websocket/connections.js',
  'websocket/notifications.ts',
  'websocket/rate-limits.js',
  'ws/v1/orderbook/[pair].js',
  
  // Misc
  'markEscrowDeposit.ts',
  'releaseFund.ts',
  'signRelease.ts',
  'validate-order.ts',
  'submitOrder-validated.ts',
  'submitOrderV2.ts',
  
  // Competition
  'competition/leaderboard.ts',
  
  // Revenue
  'revenue/status.ts',
  'revenue/crosschain-status.ts',
  
  // Disputes
  'disputes/index.ts',
  'disputes/settle.ts',
  'disputes/return.ts',
  
  // Analytics
  'analytics/profits.ts',
  
  // Crosschain
  'crosschain/execute.ts',
  'crosschain/quote.ts',
  'crosschain/routes.ts',
  'crosschain/status.ts',
  'crosschain/check-token.ts',
  'crosschain/config.ts',
  'crosschain-test/quote.ts',
  'crosschain-test/routes.ts',
  'crosschain-test/simulate.ts',
  'crosschain-test/config.ts',
  
  // Collections
  'collections/postman.js',
  'collections/insomnia.js',
  'collections/curl.js',
  
  // Developers
  'developers/keys/index.ts',
  'developers/keys/[id]/index.ts'
];

// Note: The following files already have auth or are being handled separately:
// - All v1 API endpoints (already have auth)
// - submitOrder.js (already updated)
// - submitOrderHybrid.js (already updated)
// - cancelOrder.js (already updated)
// - execute.js (already updated)
// - auction endpoints (already have auth)
// - rfq endpoints (already have auth)
// - market-maker inventory endpoints (already have auth)

console.log(`Found ${filesToProcess.length} files to process for authentication`);

// Export for verification
module.exports = { filesToProcess, PUBLIC_ENDPOINTS };