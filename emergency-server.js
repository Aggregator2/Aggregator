#!/usr/bin/env node

const http = require('http');
const fs = require('fs');
const path = require('path');

console.log('🚨 Starting Emergency Next.js Server...\n');

const PORT = 3000;

// HTML template for the main app
const mainAppHTML = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SwappiQ - Token Aggregator</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #0a0a0b;
            color: #fff;
            min-height: 100vh;
        }
        .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
        .header { 
            display: flex; 
            justify-content: space-between; 
            align-items: center; 
            padding: 20px 0;
            border-bottom: 1px solid rgba(255,255,255,0.1);
        }
        .logo { font-size: 24px; font-weight: bold; }
        .main { 
            display: flex; 
            justify-content: center; 
            align-items: center; 
            min-height: calc(100vh - 200px);
            padding: 40px 0;
        }
        .swap-widget {
            background: rgba(255,255,255,0.05);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 16px;
            padding: 24px;
            width: 100%;
            max-width: 480px;
        }
        .swap-header { 
            font-size: 20px; 
            margin-bottom: 20px;
            text-align: center;
        }
        .token-input {
            background: rgba(255,255,255,0.05);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 12px;
            padding: 16px;
            margin-bottom: 12px;
        }
        .token-select {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
        }
        .token-name {
            font-size: 18px;
            font-weight: 500;
        }
        .amount-input {
            background: transparent;
            border: none;
            color: #fff;
            font-size: 24px;
            width: 100%;
            outline: none;
            text-align: right;
        }
        .swap-button {
            background: #3b82f6;
            color: white;
            border: none;
            border-radius: 12px;
            padding: 16px;
            width: 100%;
            font-size: 18px;
            font-weight: 500;
            cursor: pointer;
            margin-top: 20px;
            transition: background 0.2s;
        }
        .swap-button:hover { background: #2563eb; }
        .swap-button:disabled { 
            background: rgba(59, 130, 246, 0.5); 
            cursor: not-allowed;
        }
        .status-message {
            background: rgba(34, 197, 94, 0.1);
            border: 1px solid rgba(34, 197, 94, 0.3);
            border-radius: 8px;
            padding: 12px;
            margin-top: 20px;
            text-align: center;
            color: #22c55e;
        }
        .error-message {
            background: rgba(239, 68, 68, 0.1);
            border: 1px solid rgba(239, 68, 68, 0.3);
            color: #ef4444;
        }
        .loading { animation: pulse 2s infinite; }
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }
    </style>
</head>
<body>
    <div class="container">
        <header class="header">
            <div class="logo">🚀 SwappiQ</div>
            <nav>
                <button onclick="connectWallet()" id="walletBtn">Connect Wallet</button>
            </nav>
        </header>
        
        <main class="main">
            <div class="swap-widget">
                <h2 class="swap-header">Swap Tokens</h2>
                
                <div class="token-input">
                    <div class="token-select">
                        <span class="token-name">ETH</span>
                        <span>Balance: 0.0</span>
                    </div>
                    <input type="number" class="amount-input" placeholder="0.0" id="fromAmount">
                </div>
                
                <div style="text-align: center; margin: 10px 0;">↓</div>
                
                <div class="token-input">
                    <div class="token-select">
                        <span class="token-name">USDC</span>
                        <span>Balance: 0.0</span>
                    </div>
                    <input type="number" class="amount-input" placeholder="0.0" id="toAmount" readonly>
                </div>
                
                <button class="swap-button" onclick="performSwap()" disabled id="swapBtn">
                    Connect Wallet to Swap
                </button>
                
                <div id="statusMessage"></div>
            </div>
        </main>
    </div>
    
    <script>
        let connected = false;
        
        async function connectWallet() {
            const btn = document.getElementById('walletBtn');
            const swapBtn = document.getElementById('swapBtn');
            
            btn.textContent = 'Connecting...';
            
            // Simulate wallet connection
            setTimeout(() => {
                connected = true;
                btn.textContent = '0x1234...5678';
                swapBtn.textContent = 'Swap';
                swapBtn.disabled = false;
                showStatus('Wallet connected successfully!', false);
            }, 1000);
        }
        
        async function performSwap() {
            const fromAmount = document.getElementById('fromAmount').value;
            if (!fromAmount || parseFloat(fromAmount) <= 0) {
                showStatus('Please enter an amount', true);
                return;
            }
            
            const swapBtn = document.getElementById('swapBtn');
            swapBtn.disabled = true;
            swapBtn.textContent = 'Swapping...';
            swapBtn.classList.add('loading');
            
            // Get quote from LiFi
            try {
                showStatus('Fetching best quote...', false);
                
                // Simulate API call
                setTimeout(() => {
                    const toAmount = parseFloat(fromAmount) * 1800; // Mock ETH/USDC rate
                    document.getElementById('toAmount').value = toAmount.toFixed(2);
                    
                    swapBtn.disabled = false;
                    swapBtn.textContent = 'Swap';
                    swapBtn.classList.remove('loading');
                    showStatus('Quote received! Ready to swap.', false);
                }, 2000);
                
            } catch (error) {
                swapBtn.disabled = false;
                swapBtn.textContent = 'Swap';
                swapBtn.classList.remove('loading');
                showStatus('Error fetching quote. Please try again.', true);
            }
        }
        
        function showStatus(message, isError) {
            const statusDiv = document.getElementById('statusMessage');
            statusDiv.textContent = message;
            statusDiv.className = isError ? 'status-message error-message' : 'status-message';
            statusDiv.style.display = 'block';
            
            setTimeout(() => {
                statusDiv.style.display = 'none';
            }, 5000);
        }
        
        // Update quote when amount changes
        document.getElementById('fromAmount').addEventListener('input', (e) => {
            const amount = parseFloat(e.target.value) || 0;
            if (amount > 0) {
                document.getElementById('toAmount').value = (amount * 1800).toFixed(2);
            } else {
                document.getElementById('toAmount').value = '';
            }
        });
    </script>
</body>
</html>
`;

const server = http.createServer(async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  console.log(`${req.method} ${req.url}`);

  // Main app route
  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(mainAppHTML);
    return;
  }

  // API endpoints
  if (req.url === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      message: 'Emergency server running - full Next.js app pending dependency installation'
    }));
    return;
  }

  if (req.url === '/api/quote') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      fromToken: 'ETH',
      toToken: 'USDC',
      fromAmount: '1',
      toAmount: '1800',
      rate: 1800,
      provider: 'LiFi (Mock)',
      timestamp: new Date().toISOString()
    }));
    return;
  }

  if (req.url === '/api/supported-tokens') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      tokens: [
        { symbol: 'ETH', name: 'Ethereum', address: '0x0', decimals: 18 },
        { symbol: 'USDC', name: 'USD Coin', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
        { symbol: 'DAI', name: 'Dai Stablecoin', address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', decimals: 18 },
        { symbol: 'WBTC', name: 'Wrapped Bitcoin', address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', decimals: 8 }
      ]
    }));
    return;
  }

  // 404 for other routes
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('404 Not Found');
});

server.listen(PORT, () => {
  console.log(`✅ Emergency server running at http://localhost:${PORT}`);
  console.log(`\n📋 Available endpoints:`);
  console.log(`  - http://localhost:${PORT}/ - Main swap interface`);
  console.log(`  - http://localhost:${PORT}/api/health - Health check`);
  console.log(`  - http://localhost:${PORT}/api/quote - Get swap quote`);
  console.log(`  - http://localhost:${PORT}/api/supported-tokens - List tokens`);
  console.log(`\n⚠️  Note: This is a minimal server. Full Next.js app requires:`);
  console.log(`  - Complete npm install`);
  console.log(`  - LiFi SDK integration`);
  console.log(`  - Database connections`);
  console.log(`\nPress Ctrl+C to stop the server`);
});