import { Request, Response, NextFunction } from 'express';
import { ValidationError } from 'joi';
import { logger } from '../../../utils/logger';

// Custom error classes
export class ApiError extends Error {
  statusCode: number;
  isOperational: boolean;
  code?: string;

  constructor(
    statusCode: number,
    message: string,
    code?: string,
    isOperational = true,
    stack = ''
  ) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.code = code;

    if (stack) {
      this.stack = stack;
    } else {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

export class BadRequestError extends ApiError {
  constructor(message: string, code?: string) {
    super(400, message, code || 'BAD_REQUEST');
  }
}

export class UnauthorizedError extends ApiError {
  constructor(message = 'Unauthorized', code?: string) {
    super(401, message, code || 'UNAUTHORIZED');
  }
}

export class ForbiddenError extends ApiError {
  constructor(message = 'Forbidden', code?: string) {
    super(403, message, code || 'FORBIDDEN');
  }
}

export class NotFoundError extends ApiError {
  constructor(message = 'Resource not found', code?: string) {
    super(404, message, code || 'NOT_FOUND');
  }
}

export class ConflictError extends ApiError {
  constructor(message: string, code?: string) {
    super(409, message, code || 'CONFLICT');
  }
}

export class InternalServerError extends ApiError {
  constructor(message = 'Internal server error', code?: string) {
    super(500, message, code || 'INTERNAL_SERVER_ERROR', false);
  }
}

// Error response interface
interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: any;
    timestamp: string;
    path: string;
    requestId?: string;
  };
}

// Convert error to response format
const createErrorResponse = (
  err: ApiError | Error,
  req: Request
): ErrorResponse => {
  const error = err as ApiError;
  
  return {
    error: {
      code: error.code || 'UNKNOWN_ERROR',
      message: error.message || 'An unexpected error occurred',
      timestamp: new Date().toISOString(),
      path: req.path,
      requestId: req.id,
      ...(process.env.NODE_ENV === 'development' && {
        details: {
          stack: error.stack,
          ...(error instanceof ValidationError && { validation: error.details })
        }
      })
    }
  };
};

// Global error handler middleware
export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // Log error
  logger.error('Error caught by global handler:', {
    error: err,
    request: {
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: req.body,
      params: req.params,
      query: req.query
    }
  });

  // Handle validation errors from Joi
  if (err instanceof ValidationError) {
    const apiError = new BadRequestError(
      'Validation failed',
      'VALIDATION_ERROR'
    );
    res.status(400).json(createErrorResponse(apiError, req));
    return;
  }

  // Handle known operational errors
  if (err instanceof ApiError && err.isOperational) {
    res.status(err.statusCode).json(createErrorResponse(err, req));
    return;
  }

  // Handle unknown errors
  const internalError = new InternalServerError();
  res.status(500).json(createErrorResponse(internalError, req));
};

// Async error wrapper
export const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// 404 handler
export const notFoundHandler = (req: Request, res: Response): void => {
  const error = new NotFoundError(`Route ${req.method} ${req.path} not found`);
  res.status(404).json(createErrorResponse(error, req));
};