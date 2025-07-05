/**
 * Base error class for SDK errors
 */
export class OffchainError extends Error {
  public readonly code: string;
  public readonly statusCode?: number;
  public readonly details?: any;

  constructor(message: string, code: string, statusCode?: number, details?: any) {
    super(message);
    this.name = 'OffchainError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    
    // Maintains proper stack trace for where our error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, OffchainError);
    }
  }
}

/**
 * Authentication error
 */
export class AuthenticationError extends OffchainError {
  constructor(message = 'Authentication failed', details?: any) {
    super(message, 'AUTHENTICATION_ERROR', 401, details);
    this.name = 'AuthenticationError';
  }
}

/**
 * API request error
 */
export class ApiError extends OffchainError {
  constructor(message: string, code: string, statusCode: number, details?: any) {
    super(message, code, statusCode, details);
    this.name = 'ApiError';
  }
}

/**
 * Rate limit error
 */
export class RateLimitError extends OffchainError {
  public readonly retryAfter: number;
  
  constructor(message = 'Rate limit exceeded', retryAfter: number, details?: any) {
    super(message, 'RATE_LIMIT_ERROR', 429, details);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

/**
 * Validation error
 */
export class ValidationError extends OffchainError {
  constructor(message: string, details?: any) {
    super(message, 'VALIDATION_ERROR', 400, details);
    this.name = 'ValidationError';
  }
}

/**
 * Network error
 */
export class NetworkError extends OffchainError {
  constructor(message = 'Network error', details?: any) {
    super(message, 'NETWORK_ERROR', undefined, details);
    this.name = 'NetworkError';
  }
}

/**
 * WebSocket error
 */
export class WebSocketError extends OffchainError {
  constructor(message: string, details?: any) {
    super(message, 'WEBSOCKET_ERROR', undefined, details);
    this.name = 'WebSocketError';
  }
}

/**
 * Timeout error
 */
export class TimeoutError extends OffchainError {
  constructor(message = 'Request timeout', details?: any) {
    super(message, 'TIMEOUT_ERROR', 408, details);
    this.name = 'TimeoutError';
  }
}

/**
 * Insufficient balance error
 */
export class InsufficientBalanceError extends OffchainError {
  constructor(message = 'Insufficient balance', details?: any) {
    super(message, 'INSUFFICIENT_BALANCE', 400, details);
    this.name = 'InsufficientBalanceError';
  }
}

/**
 * Order not found error
 */
export class OrderNotFoundError extends OffchainError {
  constructor(orderId: string, details?: any) {
    super(`Order ${orderId} not found`, 'ORDER_NOT_FOUND', 404, details);
    this.name = 'OrderNotFoundError';
  }
}

/**
 * Invalid order error
 */
export class InvalidOrderError extends OffchainError {
  constructor(message: string, details?: any) {
    super(message, 'INVALID_ORDER', 400, details);
    this.name = 'InvalidOrderError';
  }
}