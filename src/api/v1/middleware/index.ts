// Export all middleware modules
export * from './auth';
export * from './errorHandler';
export * from './pagination';
export * from './rateLimiter';
export * from './validation';

import { Request, Response, NextFunction } from 'express';
import morgan from 'morgan';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { v4 as uuidv4 } from 'uuid';

// Request ID middleware
export const requestId = (req: Request, res: Response, next: NextFunction): void => {
  req.id = req.headers['x-request-id'] as string || uuidv4();
  res.setHeader('x-request-id', req.id);
  next();
};

// CORS configuration
export const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',');
    
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) {
      callback(null, true);
      return;
    }
    
    // Check if origin is allowed
    if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'x-request-id'],
  exposedHeaders: ['x-request-id', 'x-rate-limit-remaining', 'x-rate-limit-reset']
};

// Request logging format
export const requestLogger = morgan(
  ':method :url :status :res[content-length] - :response-time ms',
  {
    skip: (req: Request) => req.path === '/health' || req.path === '/metrics'
  }
);

// Security headers
export const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"]
    }
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
});

// Response compression
export const responseCompression = compression({
  filter: (req: Request, res: Response) => {
    // Don't compress responses with this request header
    if (req.headers['x-no-compression']) {
      return false;
    }
    // Use compression filter function
    return compression.filter(req, res);
  },
  level: 6 // Compression level (0-9)
});

// Response time tracking
export const responseTime = (req: Request, res: Response, next: NextFunction): void => {
  const startTime = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    res.setHeader('x-response-time', `${duration}ms`);
  });
  
  next();
};

// Extend Express types
declare global {
  namespace Express {
    interface Request {
      id?: string;
      startTime?: number;
    }
  }
}