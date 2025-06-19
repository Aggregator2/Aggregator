import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (res.headersSent) {
    return next(err);
  }

  const errorContext = {
    path: req.path,
    method: req.method,
    body: req.body,
    params: req.params,
    query: req.query,
    headers: {
      'user-agent': req.headers['user-agent'],
      'x-forwarded-for': req.headers['x-forwarded-for'],
      'content-type': req.headers['content-type']
    },
    userId: (req as any).user?.userId,
    timestamp: new Date().toISOString()
  };

  if (err instanceof AppError) {
    logger.error('Operational error', {
      error: {
        message: err.message,
        statusCode: err.statusCode,
        details: err.details,
        stack: err.stack
      },
      context: errorContext
    });

    return res.status(err.statusCode).json({
      error: {
        message: err.message,
        statusCode: err.statusCode,
        details: err.details
      }
    });
  }

  logger.error('Unexpected error', {
    error: {
      message: err.message,
      stack: err.stack
    },
    context: errorContext
  });

  const isProd = process.env.NODE_ENV === 'production';
  
  res.status(500).json({
    error: {
      message: isProd ? 'Internal server error' : err.message,
      statusCode: 500,
      stack: isProd ? undefined : err.stack
    }
  });
};

export const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};