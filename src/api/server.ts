import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { DatabaseMatchingEngine } from '../services/matchingEngine/DatabaseMatchingEngine';
import { EnhancedFinalSettlementEngine } from '../services/settlement/EnhancedFinalSettlementEngine';
import { OrderWebSocketService } from './websocket/OrderWebSocketService';
import { initializeDatabase } from '../database/config';
import { logger } from '../utils/logger';

// Import routers
import orderRoutes from './orders';

const app = express();
const server = createServer(app);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, {
    query: req.query,
    body: req.body,
    ip: req.ip,
  });
  next();
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    services: {
      database: 'connected',
      matchingEngine: 'running',
      settlementEngine: 'running',
      websocket: 'active',
    },
  });
});

// API routes
app.use('/api', orderRoutes);

// Initialize services
let matchingEngine: DatabaseMatchingEngine;
let settlementEngine: EnhancedFinalSettlementEngine;
let wsService: OrderWebSocketService;

async function initializeServices() {
  try {
    // Initialize database
    logger.info('Initializing database...');
    await initializeDatabase();
    
    // Initialize matching engine
    logger.info('Initializing matching engine...');
    matchingEngine = new DatabaseMatchingEngine({
      maxOrderBookDepth: 100,
      minOrderSize: {
        'ETH/USDC': 0.001,
        'BTC/USDC': 0.00001,
        'ETH/BTC': 0.001,
      },
      maxOrderSize: {
        'ETH/USDC': 1000,
        'BTC/USDC': 100,
        'ETH/BTC': 1000,
      },
      tickSize: {
        'ETH/USDC': 0.01,
        'BTC/USDC': 0.01,
        'ETH/BTC': 0.00001,
      },
      makerFeeRate: 0.001, // 0.1%
      takerFeeRate: 0.002, // 0.2%
      enableStopOrders: false,
      enableIcebergOrders: false,
    });
    await matchingEngine.initialize();
    
    // Initialize settlement engine
    logger.info('Initializing settlement engine...');
    settlementEngine = new EnhancedFinalSettlementEngine({
      epochDuration: 3600000, // 1 hour
      crossChainEnabled: true,
      supportedChains: [1, 137, 42161, 10, 56],
    });
    await settlementEngine.initialize();
    
    // Initialize WebSocket service
    logger.info('Initializing WebSocket service...');
    wsService = new OrderWebSocketService(server, matchingEngine);
    
    // Make services available to routes
    app.locals.matchingEngine = matchingEngine;
    app.locals.settlementEngine = settlementEngine;
    app.locals.wsService = wsService;
    
    logger.info('All services initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize services', error);
    throw error;
  }
}

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
  });
  
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    timestamp: new Date().toISOString(),
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    path: req.path,
    timestamp: new Date().toISOString(),
  });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully...');
  
  server.close(() => {
    logger.info('HTTP server closed');
  });
  
  if (wsService) await wsService.shutdown();
  if (matchingEngine) await matchingEngine.shutdown();
  if (settlementEngine) await settlementEngine.shutdown();
  
  process.exit(0);
});

// Start server
const PORT = process.env.PORT || 3000;

initializeServices()
  .then(() => {
    server.listen(PORT, () => {
      logger.info(`API server running on port ${PORT}`);
      logger.info(`WebSocket server available at ws://localhost:${PORT}/ws/orders`);
    });
  })
  .catch(error => {
    logger.error('Failed to start server', error);
    process.exit(1);
  });

export { app, server };