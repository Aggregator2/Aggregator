# Development Logging Guide

## Overview

This project uses a custom development-only logging utility (`devLogger`) for consistent, environment-aware logging across the application. All direct `console.log` statements have been replaced with structured logging that only outputs in development mode.

## Logger Location

The main logger utility is located at:
```
/workspace/src/utils/devLogger.ts
```

## Features

### Environment-Aware Logging
- Logs are **only enabled in development** by default (`process.env.NODE_ENV === 'development'`)
- Debug logs require an additional flag (`process.env.DEBUG === 'true'`)
- No logs are output in production builds

### Log Levels
- `log()` - General logging
- `info()` - Informational messages with ℹ️ prefix
- `warn()` - Warning messages with ⚠️ prefix  
- `error()` - Error messages with ❌ prefix
- `debug()` - Debug messages with 🔍 prefix (requires DEBUG=true)

### Advanced Features
- **Timestamps**: Automatic timestamp prefixing
- **Module Prefixes**: Each logger instance can have a custom prefix
- **Grouping**: Support for `group()` and `groupEnd()`
- **Tables**: Support for `table()` to display structured data
- **Performance**: Built-in `time()` and `timeEnd()` for performance measurement

## Usage

### Import the Logger

```typescript
// Use a pre-configured logger
import { tokenLogger, swapLogger, lifiLogger } from '../src/utils/devLogger';

// Or create a custom logger
import DevLogger from '../src/utils/devLogger';
const myLogger = new DevLogger({ prefix: '[MyModule]' });
```

### Basic Logging

```typescript
// Instead of console.log
swapLogger.info('Wallet connected:', address);

// Instead of console.error  
swapLogger.error('Failed to fetch quote:', error);

// Instead of console.warn
swapLogger.warn('Quote fetch failed, retrying...');

// Debug logging (only when DEBUG=true)
swapLogger.debug('Request payload:', requestBody);
```

### Performance Measurement

```typescript
tokenLogger.time('Token fetch');
// ... async operation ...
tokenLogger.timeEnd('Token fetch'); // Outputs: [TokenPicker] Token fetch: 123ms
```

### Structured Data

```typescript
tokenLogger.table([
  { chain: 'Ethereum', tokens: 2560 },
  { chain: 'Polygon', tokens: 1677 },
  { chain: 'Arbitrum', tokens: 925 }
]);
```

## Pre-configured Loggers

The following module-specific loggers are available:

- `tokenLogger` - For TokenPicker component (`[TokenPicker]` prefix)
- `swapLogger` - For SwapWidget component (`[SwapWidget]` prefix)
- `lifiLogger` - For LI.FI service (`[LiFi]` prefix)
- `cacheLogger` - For caching operations (`[Cache]` prefix)
- `logger` - Default logger (`[App]` prefix)

## Environment Variables

### Enable/Disable Logging
```bash
# Development (logging enabled by default)
NODE_ENV=development

# Production (logging disabled)
NODE_ENV=production
```

### Enable Debug Logs
```bash
# Enable debug level logging
DEBUG=true
```

## Migration Guide

### Before (Direct console usage):
```typescript
console.log('Quote request:', requestBody);
console.error('Failed to parse amount:', error);
console.warn(`Retry attempt ${attempt}`);
```

### After (Using devLogger):
```typescript
swapLogger.debug('Quote request:', requestBody);
swapLogger.error('Failed to parse amount:', error);
swapLogger.warn(`Retry attempt ${attempt}`);
```

## Best Practices

1. **Use appropriate log levels**: 
   - `debug` for detailed debugging info
   - `info` for general flow information
   - `warn` for recoverable issues
   - `error` for actual errors

2. **Use module-specific loggers**: This helps filter logs by component

3. **Include context**: Always log relevant data that helps debugging
   ```typescript
   tokenLogger.info(`Loaded ${tokens.length} tokens from ${chains.length} chains`);
   ```

4. **Avoid logging sensitive data**: Never log private keys, full addresses, or user credentials

5. **Use structured logging for complex data**:
   ```typescript
   lifiLogger.group('Quote Response');
   lifiLogger.info('Source:', quote.source);
   lifiLogger.info('Amount:', quote.amount);
   lifiLogger.groupEnd();
   ```

## Adding New Loggers

To create a logger for a new module:

```typescript
// In src/utils/devLogger.ts
export const myModuleLogger = new DevLogger({ prefix: '[MyModule]' });

// In your module
import { myModuleLogger } from '../utils/devLogger';
myModuleLogger.info('Module initialized');
```

## Testing

The logger automatically disables itself during tests (`process.env.NODE_ENV === 'test'`), preventing test output pollution.

## Production Considerations

- All logging is automatically disabled in production builds
- The logger checks `process.env.NODE_ENV` at runtime
- No performance impact in production as logging methods return early
- The code is tree-shakeable, so unused loggers can be removed by bundlers