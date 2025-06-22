import { ethers } from 'ethers';

// Error types enum
export enum ErrorType {
  NETWORK_ERROR = 'NETWORK_ERROR',
  USER_REJECTED = 'USER_REJECTED',
  INSUFFICIENT_FUNDS = 'INSUFFICIENT_FUNDS',
  INSUFFICIENT_ALLOWANCE = 'INSUFFICIENT_ALLOWANCE',
  SLIPPAGE_EXCEEDED = 'SLIPPAGE_EXCEEDED',
  GAS_ESTIMATION_FAILED = 'GAS_ESTIMATION_FAILED',
  INVALID_INPUT = 'INVALID_INPUT',
  TOKEN_NOT_FOUND = 'TOKEN_NOT_FOUND',
  QUOTE_EXPIRED = 'QUOTE_EXPIRED',
  WALLET_NOT_CONNECTED = 'WALLET_NOT_CONNECTED',
  CHAIN_MISMATCH = 'CHAIN_MISMATCH',
  API_ERROR = 'API_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

// Error severity levels
export enum ErrorSeverity {
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  CRITICAL = 'critical'
}

// Structured error interface
export interface AppError {
  type: ErrorType;
  severity: ErrorSeverity;
  message: string;
  userMessage: string;
  details?: any;
  timestamp: Date;
  context?: string;
  recoverable: boolean;
}

// Error context for better debugging
interface ErrorContext {
  component?: string;
  action?: string;
  userId?: string;
  walletAddress?: string;
  chainId?: number;
  tokenPair?: { sellToken: string; buyToken: string };
  amount?: string;
}

class ErrorHandler {
  private static instance: ErrorHandler;
  private errorLog: AppError[] = [];
  private maxLogSize = 100;
  private errorCallbacks: Map<string, (error: AppError) => void> = new Map();
  private context: ErrorContext = {};

  private constructor() {
    // Set up global error handlers
    if (typeof window !== 'undefined') {
      window.addEventListener('unhandledrejection', this.handleUnhandledRejection.bind(this));
      window.addEventListener('error', this.handleGlobalError.bind(this));
    }
  }

  static getInstance(): ErrorHandler {
    if (!ErrorHandler.instance) {
      ErrorHandler.instance = new ErrorHandler();
    }
    return ErrorHandler.instance;
  }

  // Set context for better error tracking
  setContext(context: Partial<ErrorContext>) {
    this.context = { ...this.context, ...context };
  }

  // Clear specific context
  clearContext(keys?: (keyof ErrorContext)[]) {
    if (keys) {
      keys.forEach(key => delete this.context[key]);
    } else {
      this.context = {};
    }
  }

  // Main error handling method
  handleError(error: any, context?: string): AppError {
    const appError = this.parseError(error, context);
    this.logError(appError);
    this.notifyListeners(appError);
    
    // Send to analytics/monitoring service in production
    if (process.env.NODE_ENV === 'production') {
      this.sendToMonitoring(appError);
    }
    
    return appError;
  }

  // Parse different error types into structured format
  private parseError(error: any, context?: string): AppError {
    let type = ErrorType.UNKNOWN_ERROR;
    let severity = ErrorSeverity.ERROR;
    let message = 'An unexpected error occurred';
    let userMessage = 'Something went wrong. Please try again.';
    let recoverable = true;
    let details = {};

    // MetaMask/Wallet errors
    if (error.code === 4001 || error.message?.includes('User rejected')) {
      type = ErrorType.USER_REJECTED;
      severity = ErrorSeverity.INFO;
      message = 'User rejected the transaction';
      userMessage = 'Transaction cancelled';
      recoverable = true;
    } 
    // Insufficient funds
    else if (
      error.code === -32000 || 
      error.message?.toLowerCase().includes('insufficient funds') ||
      error.message?.toLowerCase().includes('insufficient balance')
    ) {
      type = ErrorType.INSUFFICIENT_FUNDS;
      severity = ErrorSeverity.WARNING;
      message = 'Insufficient funds for transaction';
      userMessage = 'Insufficient balance. Please add funds to your wallet.';
      recoverable = false;
    }
    // Gas estimation errors
    else if (
      error.message?.includes('gas required exceeds') ||
      error.message?.includes('execution reverted')
    ) {
      type = ErrorType.GAS_ESTIMATION_FAILED;
      severity = ErrorSeverity.ERROR;
      message = 'Gas estimation failed';
      userMessage = 'Transaction would fail. Please check your input amounts.';
      recoverable = true;
    }
    // Network errors
    else if (
      error.code === 'NETWORK_ERROR' ||
      error.message?.includes('network') ||
      error.message?.includes('timeout') ||
      error.message?.includes('fetch')
    ) {
      type = ErrorType.NETWORK_ERROR;
      severity = ErrorSeverity.WARNING;
      message = 'Network connection error';
      userMessage = 'Network error. Please check your connection and try again.';
      recoverable = true;
    }
    // Chain mismatch
    else if (error.message?.includes('chain') || error.message?.includes('network mismatch')) {
      type = ErrorType.CHAIN_MISMATCH;
      severity = ErrorSeverity.WARNING;
      message = 'Wrong network selected';
      userMessage = 'Please switch to the correct network in your wallet.';
      recoverable = true;
    }
    // Quote expired
    else if (error.message?.includes('quote expired') || error.message?.includes('stale')) {
      type = ErrorType.QUOTE_EXPIRED;
      severity = ErrorSeverity.INFO;
      message = 'Quote has expired';
      userMessage = 'Price quote expired. Refreshing...';
      recoverable = true;
    }
    // API errors
    else if (error.response || error.status) {
      type = ErrorType.API_ERROR;
      severity = ErrorSeverity.ERROR;
      message = `API error: ${error.status || error.response?.status}`;
      userMessage = 'Service temporarily unavailable. Please try again.';
      details = { 
        status: error.status || error.response?.status,
        data: error.data || error.response?.data 
      };
      recoverable = true;
    }
    // Invalid input
    else if (error.message?.includes('invalid') || error.message?.includes('Invalid')) {
      type = ErrorType.INVALID_INPUT;
      severity = ErrorSeverity.WARNING;
      message = error.message;
      userMessage = 'Please check your input and try again.';
      recoverable = true;
    }
    // Ethers.js specific errors
    else if (error.code && ethers.isError(error.code, 'CALL_EXCEPTION')) {
      type = ErrorType.GAS_ESTIMATION_FAILED;
      severity = ErrorSeverity.ERROR;
      message = 'Contract call failed';
      userMessage = 'Transaction would fail. Please try a different amount.';
      recoverable = true;
    }
    // Generic error handling
    else {
      message = error.message || error.toString();
      details = { 
        stack: error.stack,
        code: error.code,
        data: error.data 
      };
    }

    return {
      type,
      severity,
      message,
      userMessage,
      details: { ...details, originalError: error },
      timestamp: new Date(),
      context: context || this.context.component,
      recoverable
    };
  }

  // Log error internally
  private logError(error: AppError) {
    // Add to error log
    this.errorLog.push(error);
    
    // Maintain max log size
    if (this.errorLog.length > this.maxLogSize) {
      this.errorLog.shift();
    }
    
    // Console logging based on environment and severity
    const logData = {
      ...error,
      context: { ...this.context, specificContext: error.context }
    };

    switch (error.severity) {
      case ErrorSeverity.CRITICAL:
        console.error('🚨 CRITICAL ERROR:', logData);
        break;
      case ErrorSeverity.ERROR:
        console.error('❌ ERROR:', logData);
        break;
      case ErrorSeverity.WARNING:
        console.warn('⚠️ WARNING:', logData);
        break;
      case ErrorSeverity.INFO:
        console.info('ℹ️ INFO:', logData);
        break;
    }
  }

  // Notify registered listeners
  private notifyListeners(error: AppError) {
    this.errorCallbacks.forEach(callback => {
      try {
        callback(error);
      } catch (e) {
        console.error('Error in error callback:', e);
      }
    });
  }

  // Register error callback
  onError(id: string, callback: (error: AppError) => void) {
    this.errorCallbacks.set(id, callback);
    
    // Return unsubscribe function
    return () => {
      this.errorCallbacks.delete(id);
    };
  }

  // Send to monitoring service (e.g., Sentry, DataDog)
  private sendToMonitoring(error: AppError) {
    // Implementation would depend on monitoring service
    // Example for Sentry:
    // if (window.Sentry) {
    //   window.Sentry.captureException(error.details.originalError, {
    //     level: error.severity,
    //     tags: {
    //       errorType: error.type,
    //       component: error.context
    //     },
    //     extra: {
    //       ...this.context,
    //       userMessage: error.userMessage
    //     }
    //   });
    // }
  }

  // Handle unhandled promise rejections
  private handleUnhandledRejection(event: PromiseRejectionEvent) {
    console.error('Unhandled promise rejection:', event.reason);
    this.handleError(event.reason, 'unhandledRejection');
  }

  // Handle global errors
  private handleGlobalError(event: ErrorEvent) {
    console.error('Global error:', event.error);
    this.handleError(event.error, 'globalError');
  }

  // Get error statistics
  getErrorStats() {
    const stats = {
      total: this.errorLog.length,
      byType: {} as Record<ErrorType, number>,
      bySeverity: {} as Record<ErrorSeverity, number>,
      recent: this.errorLog.slice(-10)
    };

    this.errorLog.forEach(error => {
      stats.byType[error.type] = (stats.byType[error.type] || 0) + 1;
      stats.bySeverity[error.severity] = (stats.bySeverity[error.severity] || 0) + 1;
    });

    return stats;
  }

  // Clear error log
  clearErrorLog() {
    this.errorLog = [];
  }

  // Get recent errors
  getRecentErrors(count: number = 10): AppError[] {
    return this.errorLog.slice(-count);
  }

  // Check if error is recoverable
  isRecoverable(error: AppError): boolean {
    return error.recoverable;
  }

  // Get user-friendly message
  getUserMessage(error: any): string {
    if (typeof error === 'string') return error;
    if (error.userMessage) return error.userMessage;
    
    const parsed = this.parseError(error);
    return parsed.userMessage;
  }
}

// Export singleton instance
export const errorHandler = ErrorHandler.getInstance();

// Utility functions for common error scenarios
export const ErrorUtils = {
  // Handle async errors with proper typing
  async handleAsync<T>(
    promise: Promise<T>,
    context?: string
  ): Promise<[T | null, AppError | null]> {
    try {
      const result = await promise;
      return [result, null];
    } catch (error) {
      const appError = errorHandler.handleError(error, context);
      return [null, appError];
    }
  },

  // Create custom error
  createError(
    type: ErrorType,
    message: string,
    userMessage: string,
    details?: any
  ): AppError {
    return {
      type,
      severity: ErrorSeverity.ERROR,
      message,
      userMessage,
      details,
      timestamp: new Date(),
      context: errorHandler['context'].component,
      recoverable: true
    };
  },

  // Check if error is of specific type
  isErrorType(error: any, type: ErrorType): boolean {
    if (error?.type === type) return true;
    const parsed = errorHandler['parseError'](error);
    return parsed.type === type;
  },

  // Format error for display
  formatError(error: any): string {
    return errorHandler.getUserMessage(error);
  }
};