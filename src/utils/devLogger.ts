/**
 * Development-only logger utility for client-side code
 * Provides consistent logging with environment checks
 */

type LogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

interface LoggerOptions {
  prefix?: string;
  showTimestamp?: boolean;
  enabled?: boolean;
}

class DevLogger {
  private prefix: string;
  private showTimestamp: boolean;
  private enabled: boolean;

  constructor(options: LoggerOptions = {}) {
    this.prefix = options.prefix || '[App]';
    this.showTimestamp = options.showTimestamp ?? true;
    this.enabled = options.enabled ?? (process.env.NODE_ENV === 'development');
  }

  private formatMessage(level: LogLevel, message: string, ...args: any[]): void {
    if (!this.enabled) return;

    const timestamp = this.showTimestamp ? new Date().toISOString() : '';
    const formattedPrefix = `${this.prefix} ${timestamp}`.trim();

    switch (level) {
      case 'log':
        console.log(`${formattedPrefix}`, message, ...args);
        break;
      case 'info':
        console.info(`ℹ️ ${formattedPrefix}`, message, ...args);
        break;
      case 'warn':
        console.warn(`⚠️ ${formattedPrefix}`, message, ...args);
        break;
      case 'error':
        console.error(`❌ ${formattedPrefix}`, message, ...args);
        break;
      case 'debug':
        if (process.env.DEBUG === 'true') {
          console.debug(`🔍 ${formattedPrefix}`, message, ...args);
        }
        break;
    }
  }

  log(message: string, ...args: any[]): void {
    this.formatMessage('log', message, ...args);
  }

  info(message: string, ...args: any[]): void {
    this.formatMessage('info', message, ...args);
  }

  warn(message: string, ...args: any[]): void {
    this.formatMessage('warn', message, ...args);
  }

  error(message: string, ...args: any[]): void {
    this.formatMessage('error', message, ...args);
  }

  debug(message: string, ...args: any[]): void {
    this.formatMessage('debug', message, ...args);
  }

  // Group related logs
  group(label: string): void {
    if (this.enabled) {
      console.group(`${this.prefix} ${label}`);
    }
  }

  groupEnd(): void {
    if (this.enabled) {
      console.groupEnd();
    }
  }

  // Table logging for structured data
  table(data: any): void {
    if (this.enabled) {
      console.table(data);
    }
  }

  // Performance timing
  time(label: string): void {
    if (this.enabled) {
      console.time(`${this.prefix} ${label}`);
    }
  }

  timeEnd(label: string): void {
    if (this.enabled) {
      console.timeEnd(`${this.prefix} ${label}`);
    }
  }
}

// Create specific loggers for different modules
export const tokenLogger = new DevLogger({ prefix: '[TokenPicker]' });
export const swapLogger = new DevLogger({ prefix: '[SwapWidget]' });
export const lifiLogger = new DevLogger({ prefix: '[LiFi]' });
export const cacheLogger = new DevLogger({ prefix: '[Cache]' });

// Default logger
export const logger = new DevLogger();

// Export the class for custom loggers
export default DevLogger;