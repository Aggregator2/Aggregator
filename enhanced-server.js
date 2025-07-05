#!/usr/bin/env node

const http = require('http');
const fs = require('fs');
const path = require('path');

console.log('🚀 Starting Enhanced Development Server\n');

const PORT = 3000;

// Mock data for testing
const mockTokens = [
  { address: '0x0000000000000000000000000000000000000000', symbol: 'ETH', name: 'Ethereum', decimals: 18, logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png' },
  { address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', symbol: 'USDC', name: 'USD Coin', decimals: 6, logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png' },
  { address: '0xdac17f958d2ee523a2206206994597c13d831ec7', symbol: 'USDT', name: 'Tether USD', decimals: 6, logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xdAC17F958D2ee523a2206206994597C13D831ec7/logo.png' },
  { address: '0x6b175474e89094c44da98b954eedeac495271d0f', symbol: 'DAI', name: 'Dai Stablecoin', decimals: 18, logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x6B175474E89094C44Da98b954EedeAC495271d0F/logo.png' }
];

const mockOrders = [];
const mockNotifications = [];

// Health check function
async function checkBlockchainHealth() {
  const startTime = Date.now();
  return {
    status: 'degraded',
    responseTime: Date.now() - startTime,
    error: 'Using simplified RPC check (aes-js issue resolved)',
    lastCheck: new Date().toISOString(),
  };
}

const server = http.createServer(async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  console.log(`${req.method} ${req.url}`);

  // API Routes
  if (req.url === '/api/health' || req.url === '/api/health-simple') {
    const blockchainHealth = await checkBlockchainHealth();
    const response = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      uptime: process.uptime(),
      services: {
        database: { status: 'healthy', responseTime: 5, lastCheck: new Date().toISOString() },
        redis: { status: 'degraded', error: 'Redis check disabled', lastCheck: new Date().toISOString() },
        blockchain: blockchainHealth
      },
      metrics: { totalOrders: mockOrders.length, pendingOrders: 0, successfulOrders: 0, failedOrders: 0 }
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response, null, 2));
  }
  
  // Mock token list API
  else if (req.url === '/api/tokens' || req.url === '/api/v1/tokens') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ tokens: mockTokens }));
  }
  
  // Mock submit order API
  else if (req.url === '/api/submitOrder' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const order = JSON.parse(body);
      const orderId = `order-${Date.now()}`;
      const newOrder = { ...order, id: orderId, status: 'pending', timestamp: new Date().toISOString() };
      mockOrders.push(newOrder);
      
      // Create notification
      mockNotifications.push({
        id: `notif-${Date.now()}`,
        type: 'order',
        title: 'Order Placed',
        message: `Your order to swap ${order.sellAmount} ${order.sellToken} for ${order.buyToken} has been placed.`,
        timestamp: new Date().toISOString()
      });
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, orderId, order: newOrder }));
    });
  }
  
  // Mock notifications API
  else if (req.url === '/api/notifications') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ notifications: mockNotifications }));
  }
  
  // Mock order status API
  else if (req.url.startsWith('/api/orders/')) {
    const orderId = req.url.split('/').pop();
    const order = mockOrders.find(o => o.id === orderId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ order: order || null }));
  }
  
  // Serve the main React app
  else if (req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
<!DOCTYPE html>
<html>
<head>
    <title>SwappiQ - DEX Interface</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, sans-serif; background: #0a0a0a; color: #fff; }
        .container { max-width: 500px; margin: 0 auto; padding: 20px; }
        .header { text-align: center; margin-bottom: 30px; }
        .swap-widget { background: #1a1a1a; border-radius: 16px; padding: 20px; }
        .token-selector { background: #2a2a2a; border-radius: 12px; padding: 15px; margin-bottom: 10px; cursor: pointer; display: flex; align-items: center; justify-content: space-between; }
        .token-selector:hover { background: #3a3a3a; }
        .token-info { display: flex; align-items: center; gap: 10px; }
        .token-logo { width: 30px; height: 30px; border-radius: 50%; }
        .swap-button { background: #3b82f6; color: white; border: none; border-radius: 12px; padding: 15px; width: 100%; font-size: 16px; font-weight: bold; cursor: pointer; margin-top: 20px; }
        .swap-button:hover { background: #2563eb; }
        .notification { position: fixed; top: 20px; right: 20px; background: #10b981; color: white; padding: 15px 20px; border-radius: 8px; animation: slideIn 0.3s ease; }
        @keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
        .input-group { margin-bottom: 15px; }
        .input-label { font-size: 14px; color: #888; margin-bottom: 5px; }
        .amount-input { width: 100%; background: #2a2a2a; border: none; border-radius: 8px; padding: 12px; color: white; font-size: 18px; }
        .arrow-down { text-align: center; margin: 10px 0; font-size: 24px; }
        .modal { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.8); }
        .modal-content { background: #1a1a1a; border-radius: 16px; padding: 20px; max-width: 400px; margin: 50px auto; }
        .token-list { max-height: 400px; overflow-y: auto; }
        .token-item { padding: 12px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; gap: 10px; }
        .token-item:hover { background: #2a2a2a; }
        .close-modal { float: right; font-size: 24px; cursor: pointer; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>SwappiQ</h1>
            <p style="color: #888;">Decentralized Exchange Interface</p>
        </div>
        
        <div class="swap-widget">
            <div class="input-group">
                <div class="input-label">You pay</div>
                <input type="number" class="amount-input" id="sellAmount" placeholder="0.0" />
                <div class="token-selector" id="sellToken" onclick="openTokenModal('sell')">
                    <div class="token-info">
                        <img class="token-logo" src="https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png" />
                        <span id="sellTokenSymbol">ETH</span>
                    </div>
                    <span>▼</span>
                </div>
            </div>
            
            <div class="arrow-down">↓</div>
            
            <div class="input-group">
                <div class="input-label">You receive</div>
                <input type="number" class="amount-input" id="buyAmount" placeholder="0.0" readonly />
                <div class="token-selector" id="buyToken" onclick="openTokenModal('buy')">
                    <div class="token-info">
                        <img class="token-logo" src="https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png" />
                        <span id="buyTokenSymbol">USDC</span>
                    </div>
                    <span>▼</span>
                </div>
            </div>
            
            <button class="swap-button" onclick="submitOrder()">Swap</button>
        </div>
    </div>
    
    <!-- Token Selection Modal -->
    <div id="tokenModal" class="modal">
        <div class="modal-content">
            <span class="close-modal" onclick="closeTokenModal()">×</span>
            <h2>Select a token</h2>
            <div class="token-list" id="tokenList"></div>
        </div>
    </div>
    
    <script>
        let selectedSide = '';
        let tokens = [];
        let notifications = [];
        
        // Load tokens on startup
        async function loadTokens() {
            try {
                const response = await fetch('/api/tokens');
                const data = await response.json();
                tokens = data.tokens;
                console.log('Loaded tokens:', tokens);
            } catch (error) {
                console.error('Failed to load tokens:', error);
            }
        }
        
        function openTokenModal(side) {
            selectedSide = side;
            const modal = document.getElementById('tokenModal');
            const tokenList = document.getElementById('tokenList');
            
            tokenList.innerHTML = tokens.map(token => `
                <div class="token-item" onclick="selectToken('${token.address}', '${token.symbol}', '${token.logoURI}')">
                    <img class="token-logo" src="${token.logoURI}" onerror="this.src='https://via.placeholder.com/30'" />
                    <div>
                        <div>${token.symbol}</div>
                        <div style="font-size: 12px; color: #888;">${token.name}</div>
                    </div>
                </div>
            `).join('');
            
            modal.style.display = 'block';
        }
        
        function closeTokenModal() {
            document.getElementById('tokenModal').style.display = 'none';
        }
        
        function selectToken(address, symbol, logoURI) {
            if (selectedSide === 'sell') {
                document.getElementById('sellTokenSymbol').textContent = symbol;
                document.querySelector('#sellToken .token-logo').src = logoURI;
            } else {
                document.getElementById('buyTokenSymbol').textContent = symbol;
                document.querySelector('#buyToken .token-logo').src = logoURI;
            }
            closeTokenModal();
            updateQuote();
        }
        
        function updateQuote() {
            const sellAmount = parseFloat(document.getElementById('sellAmount').value) || 0;
            // Mock price calculation
            const mockPrice = 1800; // ETH/USDC price
            const buyAmount = sellAmount * mockPrice;
            document.getElementById('buyAmount').value = buyAmount.toFixed(2);
        }
        
        async function submitOrder() {
            const sellAmount = document.getElementById('sellAmount').value;
            const sellToken = document.getElementById('sellTokenSymbol').textContent;
            const buyToken = document.getElementById('buyTokenSymbol').textContent;
            const buyAmount = document.getElementById('buyAmount').value;
            
            if (!sellAmount || sellAmount === '0') {
                showNotification('Please enter an amount', 'error');
                return;
            }
            
            try {
                const response = await fetch('/api/submitOrder', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        sellToken,
                        buyToken,
                        sellAmount,
                        buyAmount,
                        user: '0x1234567890123456789012345678901234567890'
                    })
                });
                
                const result = await response.json();
                if (result.success) {
                    showNotification('Order placed successfully!', 'success');
                    document.getElementById('sellAmount').value = '';
                    document.getElementById('buyAmount').value = '';
                }
            } catch (error) {
                showNotification('Failed to place order', 'error');
            }
        }
        
        function showNotification(message, type = 'info') {
            const notif = document.createElement('div');
            notif.className = 'notification';
            notif.style.background = type === 'error' ? '#ef4444' : '#10b981';
            notif.textContent = message;
            document.body.appendChild(notif);
            
            setTimeout(() => notif.remove(), 3000);
        }
        
        // Event listeners
        document.getElementById('sellAmount').addEventListener('input', updateQuote);
        
        // Load tokens on page load
        loadTokens();
        
        // Show welcome notification
        setTimeout(() => {
            showNotification('Welcome to SwappiQ! Health check fix is active.', 'success');
        }, 1000);
    </script>
</body>
</html>
    `);
  }
  
  else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`✅ Enhanced server running at http://localhost:${PORT}`);
  console.log(`🎯 Features available:`);
  console.log(`  • Token selection modal`);
  console.log(`  • Order submission with notifications`);
  console.log(`  • Health check endpoint`);
  console.log(`  • Mock price quotes\n`);
});