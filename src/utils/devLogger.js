"use strict";
/**
 * Development-only logger utility for client-side code
 * Provides consistent logging with environment checks
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = exports.cacheLogger = exports.lifiLogger = exports.swapLogger = exports.tokenLogger = void 0;
class DevLogger {
    constructor(options = {}) {
        this.prefix = options.prefix || '[App]';
        this.showTimestamp = options.showTimestamp ?? true;
        this.enabled = options.enabled ?? (process.env.NODE_ENV === 'development');
    }
    formatMessage(level, message, ...args) {
        if (!this.enabled)
            return;
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
    log(message, ...args) {
        this.formatMessage('log', message, ...args);
    }
    info(message, ...args) {
        this.formatMessage('info', message, ...args);
    }
    warn(message, ...args) {
        this.formatMessage('warn', message, ...args);
    }
    error(message, ...args) {
        this.formatMessage('error', message, ...args);
    }
    debug(message, ...args) {
        this.formatMessage('debug', message, ...args);
    }
    // Group related logs
    group(label) {
        if (this.enabled) {
            console.group(`${this.prefix} ${label}`);
        }
    }
    groupEnd() {
        if (this.enabled) {
            console.groupEnd();
        }
    }
    // Table logging for structured data
    table(data) {
        if (this.enabled) {
            console.table(data);
        }
    }
    // Performance timing
    time(label) {
        if (this.enabled) {
            console.time(`${this.prefix} ${label}`);
        }
    }
    timeEnd(label) {
        if (this.enabled) {
            console.timeEnd(`${this.prefix} ${label}`);
        }
    }
}
// Create specific loggers for different modules
exports.tokenLogger = new DevLogger({ prefix: '[TokenPicker]' });
exports.swapLogger = new DevLogger({ prefix: '[SwapWidget]' });
exports.lifiLogger = new DevLogger({ prefix: '[LiFi]' });
exports.cacheLogger = new DevLogger({ prefix: '[Cache]' });
// Default logger
exports.logger = new DevLogger();
// Export the class for custom loggers
exports.default = DevLogger;
