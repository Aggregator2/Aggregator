import express from 'express';
import http from 'http';
import https from 'https';
import fs from 'fs';
import cluster from 'cluster';
import os from 'os';
import { createLogger, logUnhandledErrors, requestLogger } from './utils/production-logger';
import { closeDatabaseConnections } from './config/database.config';
import { getWebSocketManager } from './config/websocket.config';
import { metricsMiddleware } from './monitoring/metrics';
import { getAlertManager } from './monitoring/alerts';
import healthRoutes from './api/health';
import { applyRateLimiting } from './middleware/applyRateLimiting';

const logger = createLogger('Server');

// Initialize server
const initializeServer = async () => {
  const app = express();
  const isProduction = process.env.NODE_ENV === 'production';
  
  // Trust proxy
  if (isProduction) {
    app.set('trust proxy', 1);
  }
  
  // Basic middleware
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  
  // Security headers
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });
  
  // CORS
  if (process.env.CORS_ORIGIN) {
    const cors = require('cors');
    app.use(cors({
      origin: process.env.CORS_ORIGIN.split(','),
      credentials: process.env.CORS_CREDENTIALS === 'true',
    }));
  }
  
  // Logging middleware
  app.use(requestLogger);
  
  // Metrics middleware
  app.use(metricsMiddleware);
  
  // Apply rate limiting
  applyRateLimiting(app);
  
  // Health check routes (before auth)
  app.use('/', healthRoutes);
  
  // API routes
  const apiRoutes = require('./routes').default;
  app.use('/api', apiRoutes);
  
  // Error handling
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    logger.error('Unhandled error', err, {
      method: req.method,
      url: req.url,
      ip: req.ip,
    });
    
    res.status(err.status || 500).json({
      error: isProduction ? 'Internal server error' : err.message,
    });
  });
  
  // 404 handler
  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
  });
  
  // Create HTTP/HTTPS server
  let server: http.Server | https.Server;
  
  if (isProduction && process.env.WS_SSL_ENABLED === 'true') {
    // HTTPS server for production
    const sslOptions = {
      cert: fs.readFileSync(process.env.WS_SSL_CERT_PATH!),
      key: fs.readFileSync(process.env.WS_SSL_KEY_PATH!),
    };
    server = https.createServer(sslOptions, app);
  } else {
    // HTTP server for development
    server = http.createServer(app);
  }
  
  // Initialize WebSocket server
  const wsManager = getWebSocketManager();
  await wsManager.initialize(server);
  
  // Start server
  const port = process.env.PORT || 3000;
  server.listen(port, () => {
    logger.info(`Server started on port ${port}`, {
      environment: process.env.NODE_ENV,
      pid: process.pid,
      nodeVersion: process.version,
    });
  });
  
  // Graceful shutdown
  const gracefulShutdown = async (signal: string) => {
    logger.info(`Received ${signal}, starting graceful shutdown...`);
    
    // Stop accepting new connections
    server.close(() => {
      logger.info('HTTP server closed');
    });
    
    // Close WebSocket connections
    await wsManager.shutdown();
    
    // Close database connections
    await closeDatabaseConnections();
    
    // Wait for pending operations
    setTimeout(() => {
      logger.info('Graceful shutdown complete');
      process.exit(0);
    }, 5000);
  };
  
  // Handle shutdown signals
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  
  return server;
};

// Cluster setup for production
const startCluster = () => {
  const numCPUs = process.env.CLUSTER_WORKERS 
    ? parseInt(process.env.CLUSTER_WORKERS) 
    : os.cpus().length;
  
  if (cluster.isPrimary) {
    logger.info(`Master ${process.pid} is running`);
    logger.info(`Starting ${numCPUs} workers...`);
    
    // Fork workers
    for (let i = 0; i < numCPUs; i++) {
      cluster.fork();
    }
    
    // Handle worker events
    cluster.on('exit', (worker, code, signal) => {
      logger.error(`Worker ${worker.process.pid} died`, {
        code,
        signal,
      });
      
      // Restart worker
      logger.info('Starting a new worker...');
      cluster.fork();
    });
    
    cluster.on('online', (worker) => {
      logger.info(`Worker ${worker.process.pid} is online`);
    });
    
    // Monitor system health from master
    setInterval(async () => {
      const alertManager = getAlertManager();
      
      // Check CPU usage
      const cpuUsage = process.cpuUsage();
      const cpuPercent = (cpuUsage.user + cpuUsage.system) / 1000000; // Convert to percentage
      await alertManager.checkRule('cpu-usage', cpuPercent);
      
      // Check memory usage
      const memUsage = process.memoryUsage();
      const memPercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
      await alertManager.checkRule('memory-usage', memPercent);
    }, 60000); // Every minute
    
  } else {
    // Worker process
    initializeServer().catch((error) => {
      logger.error('Failed to initialize server', error);
      process.exit(1);
    });
  }
};

// Main entry point
const main = async () => {
  try {
    // Set up global error handlers
    logUnhandledErrors();
    
    // Check if clustering is enabled
    if (process.env.CLUSTER_ENABLED === 'true' && process.env.NODE_ENV === 'production') {
      startCluster();
    } else {
      // Single process mode
      await initializeServer();
    }
  } catch (error) {
    logger.error('Failed to start application', error);
    process.exit(1);
  }
};

// Start the application
main();