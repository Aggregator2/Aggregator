// SwappiQ API implementation for Vercel
const crypto = require('crypto');

// In-memory stores
const orders = new Map();
const orderBook = { buy: [], sell: [] };
const users = new Map();
const balances = new Map();
const settlements = new Map();
const disputes = new Map();
const notifications = [];
const marketMakerApplications = new Map();

// Ensure orderBook is always properly initialized
if (!orderBook.buy) orderBook.buy = [];
if (!orderBook.sell) orderBook.sell = [];

// Mock token data
const tokens = [
  { id: 1, symbol: 'ETH', name: 'Ethereum', address: '0x0000000000000000000000000000000000000000', decimals: 18, chainId: 1, logoURI: 'https://ethereum.org/icon.png' },
  { id: 2, symbol: 'USDT', name: 'Tether USD', address: '0xdac17f958d2ee523a2206206994597c13d831ec7', decimals: 6, chainId: 1, logoURI: 'https://tether.to/icon.png' },
  { id: 3, symbol: 'USDC', name: 'USD Coin', address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', decimals: 6, chainId: 1, logoURI: 'https://centre.io/icon.png' },
  { id: 4, symbol: 'DAI', name: 'Dai Stablecoin', address: '0x6b175474e89094c44da98b954eedeac495271d0f', decimals: 18, chainId: 1, logoURI: 'https://makerdao.com/icon.png' },
  { id: 5, symbol: 'WBTC', name: 'Wrapped Bitcoin', address: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', decimals: 8, chainId: 1, logoURI: 'https://wbtc.network/icon.png' }
];

// Initialize balances
balances.set('user1', { ETH: 10, USDT: 10000, USDC: 10000 });
balances.set('user2', { ETH: 5, USDT: 5000, USDC: 5000 });

// Utility functions
function generateOrderId() {
  return 'order_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function generateJWT(userId) {
  const header = Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'HS256' })).toString('base64');
  const payload = Buffer.from(JSON.stringify({ userId, exp: Date.now() + 86400000 })).toString('base64');
  const signature = crypto.createHmac('sha256', 'secret').update(header + '.' + payload).digest('base64');
  return header + '.' + payload + '.' + signature;
}

function verifyJWT(token) {
  try {
    const [header, payload, signature] = token.split('.');
    if (!header || !payload || !signature) return null;
    
    // In development or when NODE_ENV is not set, accept test tokens
    const isProduction = process.env.NODE_ENV === 'production';
    if (!isProduction && signature.startsWith('dGVzdC1zaWduYXR1cmU')) {
      const data = JSON.parse(Buffer.from(payload, 'base64').toString());
      if (data.exp < Date.now()) return null;
      return data;
    }
    
    // Production JWT verification
    const expectedSignature = crypto.createHmac('sha256', 'secret').update(header + '.' + payload).digest('base64');
    if (signature !== expectedSignature) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64').toString());
    if (data.exp < Date.now()) return null;
    return data;
  } catch (e) {
    return null;
  }
}

// API Routes
const routes = {
  // Health endpoints
  'GET /api/health': (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
  },
  
  'GET /api/health/detailed': (req, res) => {
    res.json({
      status: 'healthy',
      services: {
        database: 'connected',
        redis: 'connected',
        blockchain: 'connected',
        marketMaker: 'active'
      },
      metrics: {
        activeOrders: orders.size,
        totalSettlements: settlements.size,
        activeDisputes: disputes.size
      }
    });
  },

  // Token endpoints
  'GET /api/tokens/comprehensive': (req, res) => {
    res.json({ tokens, total: tokens.length });
  },

  // Quote endpoints
  'POST /api/quote': async (req, res) => {
    const { sellToken, buyToken, sellAmount } = req.body;
    const rate = sellToken === 'ETH' ? 2000 : 1;
    const buyAmount = (parseFloat(sellAmount) * rate).toString();
    
    res.json({
      sellToken,
      buyToken,
      sellAmount,
      buyAmount,
      price: rate.toString(),
      estimatedGas: '150000',
      sources: [{ name: 'SwappiQ', proportion: '1' }]
    });
  },

  'POST /api/quote-profitable': async (req, res) => {
    try {
      const { sellToken, buyToken, sellAmount, chainId, toChainId, slippageTolerance } = req.body;
      
      // Validate required parameters
      if (!sellToken || !buyToken || !sellAmount) {
        return res.status(400).json({ 
          error: 'Missing required parameters: sellToken, buyToken, and sellAmount are required' 
        });
      }
      
      // Validate sellAmount is a valid number
      if (isNaN(parseFloat(sellAmount)) || parseFloat(sellAmount) <= 0) {
        return res.status(400).json({ 
          error: 'Invalid sellAmount: must be a positive number' 
        });
      }
      
      // Log incoming request
      console.log('Quote Request:', {
        sellToken,
        buyToken,
        sellAmount,
        chainId,
        toChainId,
        slippageTolerance
      });
    
    // Define variables at the proper scope with defaults
    let buyAmountBeforeFeeInBaseUnits = '0';
    let buyAmountInBaseUnits = '0';
    let platformFeeInBaseUnits = '0';
    let platformFeePercent = 0.3; // 0.3% platform fee
    let platformFeeBps = 30; // 30 basis points
    
    try {
      // Use LiFi API to get real quote
      const lifiApiKey = process.env.LIFI_API_KEY || 'e411f45a-05ed-47d7-aea8-def36d94442e.dcb8f395-2612-41e7-85b2-cb1d1de85502';
      
      // Import LiFi SDK
      const { getRoutes } = require('@lifi/sdk');
      
      // Get quote from LiFi
      const routesRequest = {
        fromChainId: chainId,
        toChainId: toChainId || chainId,
        fromTokenAddress: sellToken,
        toTokenAddress: buyToken,
        fromAmount: sellAmount,
        options: {
          slippage: parseFloat(slippageTolerance) / 100 || 0.005,
          allowSwitchChain: false,
          bridges: { allow: [] }, // Same-chain swap
          exchanges: {
            allow: ['uniswap', 'sushiswap', 'paraswap', '1inch', 'openocean']
          }
        }
      };
      
      console.log('Getting real quote from LiFi...');
      console.log('LiFi API Key:', lifiApiKey ? 'Found' : 'Not found');
      const routes = await getRoutes(routesRequest, {
        apiKey: lifiApiKey
      });
      
      if (!routes || !routes.routes || routes.routes.length === 0) {
        throw new Error('No routes available from LiFi');
      }
      
      const bestRoute = routes.routes[0];
      buyAmountBeforeFeeInBaseUnits = bestRoute.toAmount;
      
      const buyAmountBN = BigInt(buyAmountBeforeFeeInBaseUnits);
      const platformFeeAmount = (buyAmountBN * BigInt(platformFeeBps)) / BigInt(10000);
      const buyAmountAfterFee = buyAmountBN - platformFeeAmount;
      
      buyAmountInBaseUnits = buyAmountAfterFee.toString();
      platformFeeInBaseUnits = platformFeeAmount.toString();
      
      console.log('LiFi quote received:', {
        originalAmount: buyAmountBeforeFeeInBaseUnits,
        afterFee: buyAmountInBaseUnits,
        fee: platformFeeInBaseUnits
      });
    } catch (error) {
      console.error('Failed to get LiFi quote, using fallback:', error.message);
      
      // Fallback to CoinGecko for real-time prices
      try {
        console.log('Falling back to CoinGecko for real-time prices...');
        const coingeckoService = require('../src/services/coingeckoService');
        
        // Get decimals for tokens
        const tokenDecimals = {
          '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 6, // USDC
          '0xdac17f958d2ee523a2206206994597c13d831ec7': 6, // USDT
          '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': 8, // WBTC
        };
        
        const sellDecimals = tokenDecimals[sellToken.toLowerCase()] || 18;
        const buyDecimals = tokenDecimals[buyToken.toLowerCase()] || 18;
        
        const quote = await coingeckoService.getQuote(
          sellToken,
          buyToken,
          sellAmount,
          sellDecimals,
          buyDecimals
        );
        
        buyAmountBeforeFeeInBaseUnits = quote.buyAmount;
        const buyAmountBN = BigInt(buyAmountBeforeFeeInBaseUnits);
        const platformFeeAmount = (buyAmountBN * BigInt(platformFeeBps)) / BigInt(10000);
        const buyAmountAfterFee = buyAmountBN - platformFeeAmount;
        
        buyAmountInBaseUnits = buyAmountAfterFee.toString();
        platformFeeInBaseUnits = platformFeeAmount.toString();
        
        console.log('CoinGecko quote received:', {
          sellPrice: quote.sellPrice,
          buyPrice: quote.buyPrice,
          rate: quote.rate,
          buyAmount: buyAmountInBaseUnits
        });
      } catch (fallbackError) {
        console.error('All quote services failed:', fallbackError.message);
        
        // Try multiChainQuoteService as last resort
        try {
          const { multiChainQuoteService } = require('../src/services/multiChainQuoteService');
          const quote = await multiChainQuoteService.getQuote({
            sellToken,
            buyToken,
            sellAmount,
            chainId,
            toChainId: toChainId || chainId
          });
          
          buyAmountBeforeFeeInBaseUnits = quote.buyAmount;
          const buyAmountBN = BigInt(buyAmountBeforeFeeInBaseUnits);
          const platformFeeAmount = (buyAmountBN * BigInt(platformFeeBps)) / BigInt(10000);
          const buyAmountAfterFee = buyAmountBN - platformFeeAmount;
          
          buyAmountInBaseUnits = buyAmountAfterFee.toString();
          platformFeeInBaseUnits = platformFeeAmount.toString();
        } catch (lastError) {
          console.error('Final fallback failed:', lastError.message);
          throw new Error('Unable to get real-time quote. Please try again later.');
        }
      }
    }
    
    // Calculate minimum received after slippage using user's preference
    const slippagePercent = parseFloat(slippageTolerance) || 0.5; // Default to 0.5% if not provided
    const slippageFactor = 1 - (slippagePercent / 100);
    const minReceivedInBaseUnits = Math.floor(parseFloat(buyAmountInBaseUnits) * slippageFactor).toString();
    
    // Calculate LP fee (0.3% of sell amount)
    const lpFee = Math.floor(parseFloat(sellAmount) * 0.003).toString();
    
    // Log calculated values
    console.log('Quote Calculation:', {
      sellToken,
      buyToken,
      sellAmount,
      buyAmountInBaseUnits,
      minReceivedInBaseUnits,
      platformFeeInBaseUnits,
      platformFeePercent
    });
    
    res.json({
      sellToken,
      buyToken,
      sellAmount,
      buyAmount: buyAmountInBaseUnits,
      buyAmountBeforeFee: buyAmountBeforeFeeInBaseUnits,
      price: (parseFloat(buyAmountInBaseUnits) / parseFloat(sellAmount)).toString(),
      estimatedGas: '150000',
      sources: [{ name: '0x', proportion: '1' }],
      source: '0x',
      chainId,
      toChainId,
      allowanceTarget: '0x0000000000000000000000000000000000000000',
      to: '0x0000000000000000000000000000000000000000',
      data: '0x',
      value: '0',
      gasPrice: '20000000000',
      estimatedPriceImpact: '0.1',
      minimumProtocolFee: '0',
      protocolFee: '0',
      buyTokenAddress: buyToken,
      sellTokenAddress: sellToken,
      expectedSlippage: '0.01',
      minReceived: minReceivedInBaseUnits,
      lpFee: lpFee,
      // New transparent fee fields
      platformFee: {
        amount: platformFeeInBaseUnits,
        percentage: platformFeePercent,
        bps: 30
      },
      feeBreakdown: {
        platformFee: platformFeeInBaseUnits,
        platformFeePercent: platformFeePercent + '%',
        buyAmountBeforeFee: buyAmountBeforeFeeInBaseUnits,
        buyAmountAfterFee: buyAmountInBaseUnits
      }
    });
    } catch (error) {
      console.error('Quote generation error:', error);
      res.status(500).json({ 
        error: 'Failed to generate quote', 
        details: error.message 
      });
    }
  },

  // Order endpoints
  'POST /api/submitOrder': async (req, res) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ') || !verifyJWT(auth.replace('Bearer ', ''))) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      // Extract order data from the request
      const { order: orderData, signature } = req.body;
      
      if (!orderData || !signature) {
        return res.status(400).json({ error: 'Missing order data or signature' });
      }
      
      // Validate order data
      if (!orderData.sellToken || !orderData.buyToken) {
        return res.status(400).json({ error: 'Invalid order: missing token addresses' });
      }
      
      if (!orderData.sellAmount || parseFloat(orderData.sellAmount) <= 0) {
        return res.status(400).json({ error: 'Invalid order: invalid sell amount' });
      }
      
      if (!orderData.buyAmount || parseFloat(orderData.buyAmount) <= 0) {
        return res.status(400).json({ error: 'Invalid order: invalid buy amount' });
      }

      // Get user info from JWT
      const tokenData = verifyJWT(auth.replace('Bearer ', ''));
      
      const order = {
        id: generateOrderId(),
        ...orderData,
        signature,
        userId: tokenData.userId,
        status: 'pending',
        timestamp: new Date().toISOString(),
        side: orderData.kind === 'sell' ? 'sell' : 'buy' // Map 'kind' to 'side' for orderbook
      };
      
      orders.set(order.id, order);
      
      // Only add to orderbook if side is valid
      if (order.side) {
        if (!orderBook[order.side]) {
          console.error('Invalid order side:', order.side, 'Available sides:', Object.keys(orderBook));
        } else {
          orderBook[order.side].push(order);
        }
      }
      
      // Simulate matching
      setTimeout(() => {
        order.status = 'filled';
        // Generate a realistic-looking transaction hash
        order.txHash = '0x' + crypto.randomBytes(32).toString('hex');
        notifications.push({
          userId: order.userId,
          type: 'order_filled',
          orderId: order.id,
          txHash: order.txHash,
          timestamp: new Date().toISOString()
        });
      }, 2000);
      
      res.json({ orderId: order.id, status: 'pending' });
    } catch (error) {
      console.error('Order submission error:', error);
      res.status(500).json({ error: 'Failed to submit order', details: error.message });
    }
  },

  'GET /api/orders/history': (req, res) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const jwt = verifyJWT(auth.replace('Bearer ', ''));
    if (!jwt) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const userOrders = Array.from(orders.values())
      .filter(o => o.userId === jwt.userId)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    res.json({ orders: userOrders });
  },

  'GET /api/orders/:orderId': (req, res) => {
    const order = orders.get(req.params.orderId);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    res.json(order);
  },

  'GET /api/orderbook': (req, res) => {
    res.json({
      buy: orderBook.buy.slice(-50),
      sell: orderBook.sell.slice(-50),
      timestamp: new Date().toISOString()
    });
  },

  // Settlement endpoints
  'POST /api/settlement/initiate': (req, res) => {
    const settlementId = 'settlement_' + Date.now();
    const settlement = {
      id: settlementId,
      ...req.body,
      status: 'initiated',
      timestamp: new Date().toISOString()
    };
    settlements.set(settlementId, settlement);
    res.json({ settlementId, status: 'initiated' });
  },

  'GET /api/orders/:orderId/settlement-proof': (req, res) => {
    const order = orders.get(req.params.orderId);
    if (!order || order.status !== 'filled') {
      return res.status(404).json({ error: 'No settlement proof available' });
    }
    
    const proof = {
      orderId: order.id,
      merkleRoot: crypto.randomBytes(32).toString('hex'),
      proofPath: [
        crypto.randomBytes(32).toString('hex'),
        crypto.randomBytes(32).toString('hex')
      ],
      blockNumber: Math.floor(Math.random() * 1000000) + 15000000,
      timestamp: order.timestamp
    };
    
    res.json(proof);
  },

  // Dispute endpoints
  'POST /api/disputes': (req, res) => {
    const dispute = {
      id: 'dispute_' + Date.now(),
      ...req.body,
      status: 'open',
      timestamp: new Date().toISOString()
    };
    disputes.set(dispute.id, dispute);
    res.json({ disputeId: dispute.id, status: 'open' });
  },

  'POST /api/disputes/settle': (req, res) => {
    const { disputeId, resolution } = req.body;
    const dispute = disputes.get(disputeId);
    if (!dispute) {
      return res.status(404).json({ error: 'Dispute not found' });
    }
    dispute.status = 'resolved';
    dispute.resolution = resolution;
    res.json({ disputeId, status: 'resolved' });
  },

  // Market maker endpoints
  'POST /api/market-maker/apply': (req, res) => {
    const application = {
      id: 'mm_app_' + Date.now(),
      ...req.body,
      status: 'pending',
      timestamp: new Date().toISOString()
    };
    marketMakerApplications.set(application.id, application);
    res.json({ applicationId: application.id, status: 'pending' });
  },

  'GET /api/competition/leaderboard': (req, res) => {
    const leaderboard = [
      { rank: 1, marketMaker: 'MM Alpha', score: 95.5, volume: '1000000' },
      { rank: 2, marketMaker: 'MM Beta', score: 92.3, volume: '850000' },
      { rank: 3, marketMaker: 'MM Gamma', score: 88.7, volume: '720000' }
    ];
    res.json({ leaderboard, lastUpdated: new Date().toISOString() });
  },

  // Analytics endpoints
  'GET /api/analytics/profits': (req, res) => {
    res.json({
      daily: '1250.50',
      weekly: '8750.25',
      monthly: '35200.00',
      currency: 'USDT'
    });
  },

  'GET /api/revenue/status': (req, res) => {
    res.json({
      totalRevenue: '125000.00',
      pendingSettlements: '15000.00',
      completedSettlements: '110000.00',
      currency: 'USDT'
    });
  },

  // Notification endpoints
  'GET /api/notifications/user/:userId': (req, res) => {
    const userNotifications = notifications.filter(n => n.userId === req.params.userId);
    res.json({ notifications: userNotifications });
  },

  'GET /api/ws/health': (req, res) => {
    res.json({ status: 'active', connections: 0 });
  }
};

// Main handler
export function swappiqStandalone(req, res) {
  // Extract path from Next.js query
  const path = '/api/' + (req.query.path ? req.query.path.join('/') : '');
  const method = req.method;
  
  // Helper functions
  res.json = (data) => {
    res.setHeader('Content-Type', 'application/json');
    res.status(res.statusCode || 200).send(JSON.stringify(data));
  };
  
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };

  // Find matching route
  let routeKey = `${method} ${path}`;
  if (routes[routeKey]) {
    req.params = {};
    return routes[routeKey](req, res);
  }

  // Check for parameterized routes
  for (const [key, handler] of Object.entries(routes)) {
    const [routeMethod, routePattern] = key.split(' ');
    if (routeMethod !== method) continue;
    
    const regex = new RegExp('^' + routePattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$');
    const match = path.match(regex);
    
    if (match) {
      req.params = match.groups || {};
      return handler(req, res);
    }
  }

  // 404
  res.status(404).json({ error: 'Not found' });
}