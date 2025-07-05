import winston from 'winston';
import 'winston-daily-rotate-file';
import { Request } from 'express';

// Define log levels
const logLevels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  verbose: 4,
  debug: 5,
  silly: 6,
};

// Define log colors
const logColors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  verbose: 'cyan',
  debug: 'blue',
  silly: 'gray',
};

// Add colors to winston
winston.addColors(logColors);

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json(),
);

// Console format for development
const consoleFormat = winston.format.combine(
  winston.format.colorize({ all: true }),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let metaStr = '';
    if (Object.keys(meta).length > 0) {
      metaStr = '\n' + JSON.stringify(meta, null, 2);
    }
    return `${timestamp} [${level}]: ${message}${metaStr}`;
  }),
);

// Get transports based on environment
const getTransports = (): winston.transport[] => {
  const transports: winston.transport[] = [];
  const isProduction = process.env.NODE_ENV === 'production';
  
  // Console transport
  if (!isProduction || process.env.LOG_TO_CONSOLE === 'true') {
    transports.push(
      new winston.transports.Console({
        format: isProduction ? logFormat : consoleFormat,
      })
    );
  }
  
  // File transports for production
  if (isProduction && process.env.LOG_TO_FILE === 'true') {
    const logDir = process.env.LOG_FILE_PATH || '/var/log/aggregator';
    
    // Rotating file transport for all logs
    transports.push(
      new winston.transports.DailyRotateFile({
        filename: `${logDir}/app-%DATE%.log`,
        datePattern: 'YYYY-MM-DD',
        maxSize: process.env.LOG_MAX_SIZE || '100m',
        maxFiles: process.env.LOG_MAX_FILES || '14d',
        zippedArchive: process.env.LOG_COMPRESSION === 'true',
        format: logFormat,
      })
    );
    
    // Separate file for errors
    transports.push(
      new winston.transports.DailyRotateFile({
        filename: `${logDir}/error-%DATE%.log`,
        datePattern: 'YYYY-MM-DD',
        maxSize: process.env.LOG_MAX_SIZE || '100m',
        maxFiles: process.env.LOG_MAX_FILES || '14d',
        zippedArchive: process.env.LOG_COMPRESSION === 'true',
        level: 'error',
        format: logFormat,
      })
    );
  }
  
  return transports;
};

// Create logger instance
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  levels: logLevels,
  format: logFormat,
  transports: getTransports(),
  exitOnError: false,
});

// Stream for Morgan HTTP logging
export const httpLogStream = {
  write: (message: string) => {
    logger.http(message.trim());
  },
};

// Request logger middleware
export const requestLogger = (req: Request, res: any, next: any) => {
  const start = Date.now();
  
  // Log request
  logger.http('Incoming request', {
    method: req.method,
    url: req.url,
    ip: req.ip,
    userAgent: req.get('user-agent'),
  });
  
  // Log response
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.http('Request completed', {
      method: req.method,
      url: req.url,
      status: res.statusCode,
      duration: `${duration}ms`,
    });
  });
  
  next();
};

// Structured logging helpers
export class Logger {
  private context: string;
  private metadata: Record<string, any>;
  
  constructor(context: string, metadata?: Record<string, any>) {
    this.context = context;
    this.metadata = metadata || {};
  }
  
  private log(level: string, message: string, meta?: Record<string, any>) {
    logger.log(level, message, {
      context: this.context,
      ...this.metadata,
      ...meta,
    });
  }
  
  error(message: string, error?: Error | any, meta?: Record<string, any>) {
    this.log('error', message, {
      error: error instanceof Error ? {
        message: error.message,
        stack: error.stack,
        name: error.name,
      } : error,
      ...meta,
    });
  }
  
  warn(message: string, meta?: Record<string, any>) {
    this.log('warn', message, meta);
  }
  
  info(message: string, meta?: Record<string, any>) {
    this.log('info', message, meta);
  }
  
  debug(message: string, meta?: Record<string, any>) {
    this.log('debug', message, meta);
  }
  
  verbose(message: string, meta?: Record<string, any>) {
    this.log('verbose', message, meta);
  }
  
  // Performance logging
  startTimer(operation: string): () => void {
    const start = Date.now();
    return () => {
      const duration = Date.now() - start;
      this.info(`${operation} completed`, { duration: `${duration}ms` });
    };
  }
  
  // Metric logging
  metric(name: string, value: number, unit?: string, tags?: Record<string, string>) {
    this.info('Metric', {
      metric: name,
      value,
      unit,
      tags,
    });
  }
  
  // Audit logging
  audit(action: string, userId: string, details: Record<string, any>) {
    this.info('Audit', {
      action,
      userId,
      timestamp: new Date().toISOString(),
      ...details,
    });
  }
  
  // Security logging
  security(event: string, severity: 'low' | 'medium' | 'high' | 'critical', details: Record<string, any>) {
    const level = severity === 'critical' || severity === 'high' ? 'error' : 'warn';
    this.log(level, `Security event: ${event}`, {
      severity,
      ...details,
    });
  }
  
  // Transaction logging
  transaction(txHash: string, status: 'pending' | 'success' | 'failed', details: Record<string, any>) {
    this.info('Transaction', {
      txHash,
      status,
      ...details,
    });
  }
  
  // Order logging
  order(orderId: string, action: string, details: Record<string, any>) {
    this.info('Order', {
      orderId,
      action,
      ...details,
    });
  }
  
  // Settlement logging
  settlement(settlementId: string, status: string, details: Record<string, any>) {
    this.info('Settlement', {
      settlementId,
      status,
      ...details,
    });
  }
  
  // WebSocket logging
  websocket(clientId: string, event: string, details?: Record<string, any>) {
    this.debug('WebSocket', {
      clientId,
      event,
      ...details,
    });
  }
  
  // Database logging
  database(operation: string, duration: number, details?: Record<string, any>) {
    this.debug('Database', {
      operation,
      duration: `${duration}ms`,
      ...details,
    });
  }
  
  // API call logging
  apiCall(service: string, endpoint: string, duration: number, status: number, details?: Record<string, any>) {
    this.info('API Call', {
      service,
      endpoint,
      duration: `${duration}ms`,
      status,
      ...details,
    });
  }
  
  // Create child logger with additional context
  child(additionalContext: string, additionalMetadata?: Record<string, any>): Logger {
    return new Logger(
      `${this.context}:${additionalContext}`,
      { ...this.metadata, ...additionalMetadata }
    );
  }
}

// Factory function to create logger instances
export const createLogger = (context: string, metadata?: Record<string, any>): Logger => {
  return new Logger(context, metadata);
};

// Global error handler
export const logUnhandledErrors = () => {
  process.on('uncaughtException', (error: Error) => {
    logger.error('Uncaught Exception', {
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name,
      },
    });
    process.exit(1);
  });
  
  process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
    logger.error('Unhandled Rejection', {
      reason,
      promise,
    });
  });
};

// Export default logger instance
export default logger;