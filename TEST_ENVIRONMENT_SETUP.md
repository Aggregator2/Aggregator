# Test Environment Setup Guide

This guide explains how to set up and use the comprehensive test environment for the SwapIQ platform.

## Environment Files

### `.env.test` - Comprehensive Test Configuration

The `.env.test` file contains all environment variables needed for testing:

- **Application Settings**: Ports, app metadata, and basic configuration
- **Database Configuration**: SQLite for testing (no external dependencies)
- **Authentication**: Test JWT secrets and encryption keys
- **Blockchain Configuration**: Local Hardhat network settings
- **External API Keys**: Mock/test values for all third-party services
- **Feature Flags**: Control which features are enabled during testing
- **Test-Specific Variables**: Special flags for mocking and disabling rate limits

### Key Features

1. **No External Dependencies**: Uses SQLite and local services
2. **Safe Test Data**: All secrets use test/mock values
3. **Isolated Testing**: Each test run uses clean environment
4. **Mock External APIs**: Prevent hitting real APIs during tests
5. **Comprehensive Coverage**: All environment variables included

## Scripts

### `scripts/load-test-env.js`

Loads and validates test environment variables:

```bash
node scripts/load-test-env.js
```

Features:
- Loads all variables from `.env.test`
- Sets default values for critical variables
- Validates required environment variables
- Provides helpful error messages

### `scripts/run-tests.js`

Comprehensive test runner with environment loading:

```bash
# Run all tests
node scripts/run-tests.js

# Run specific test categories
node scripts/run-tests.js unit
node scripts/run-tests.js integration
node scripts/run-tests.js contracts
node scripts/run-tests.js e2e

# Multiple categories
node scripts/run-tests.js unit integration
```

## Jest Configuration

### Automatic Environment Loading

The Jest setup automatically loads test environment variables:

1. `jest.setup.js` calls `load-test-env.js`
2. Environment variables are available in all tests
3. No manual setup required in individual test files

### Test Scripts

Available npm/yarn scripts:

```bash
# Jest-based tests
npm run test:unit          # Unit tests with coverage
npm run test:integration   # Integration tests with coverage
npm run test:all           # All tests with coverage
npm run test:coverage      # Generate detailed coverage report
npm run test:watch         # Watch mode for development

# Contract tests
npm run test:contracts     # Hardhat contract tests

# End-to-end tests
npm run test:e2e          # Complete workflow tests

# Performance tests
npm run test:performance  # Load and stress tests
```

## Environment Variables Reference

### Critical Variables

These variables are required and validated:

- `NODE_ENV=test` - Ensures test environment
- `JWT_SECRET` - Test JWT signing secret
- `DATABASE_URL=file:./test.db` - SQLite test database
- `PRIVATE_KEY` - Hardhat test account private key
- `CHAIN_ID=31337` - Local Hardhat network ID

### Database Configuration

```bash
DATABASE_URL=file:./test.db
DATABASE_TYPE=sqlite
USE_IN_MEMORY_DB=false
RESET_DB_ON_START=true
```

### Authentication & Security

```bash
JWT_SECRET=test-secret-key-for-jwt-authentication-32-chars-minimum
SESSION_SECRET=test-session-secret-key-for-cookies-32-chars-minimum
ENCRYPTION_KEY=test-encryption-key-for-data-protection-32-chars-minimum
```

### Blockchain Configuration

```bash
ETHEREUM_RPC_URL=http://127.0.0.1:8545
CHAIN_ID=31337
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

### Feature Flags

```bash
MOCK_EXTERNAL_APIS=true      # Mock all external API calls
DISABLE_RATE_LIMIT=true      # Disable rate limiting in tests
DISABLE_REAL_TRANSACTIONS=true  # Prevent real blockchain transactions
ENABLE_TRADING=true          # Enable trading features
ENABLE_CROSS_CHAIN=true      # Enable cross-chain features
```

## Test Categories

### Unit Tests
- **Location**: `__tests__/`, `test/unit/`, `src/**/__tests__/`
- **Purpose**: Test individual components, utilities, pure functions
- **Environment**: jsdom (browser-like)
- **Features**: Fast execution, isolated testing, mocking

### Integration Tests
- **Location**: `tests/integration/`
- **Purpose**: Test API endpoints, database interactions, services
- **Environment**: Node.js
- **Features**: Real database, service integration, sequential execution

### Contract Tests
- **Location**: `test/` (Hardhat convention)
- **Purpose**: Test smart contracts, blockchain interactions
- **Environment**: Hardhat network
- **Features**: Blockchain simulation, gas testing, event verification

### End-to-End Tests
- **Location**: `tests/integration/end-to-end/`
- **Purpose**: Test complete user workflows, trading flows
- **Environment**: Node.js
- **Features**: Full system integration, real-world scenarios

## Best Practices

### Writing Tests

1. **Use Environment Variables**: Access config via `process.env`
2. **Mock External Services**: Use `MOCK_EXTERNAL_APIS=true`
3. **Clean State**: Tests should not depend on each other
4. **Descriptive Names**: Use clear, descriptive test names
5. **Proper Cleanup**: Clean up resources after tests

### Environment Management

1. **Never Commit Real Secrets**: Only use test/mock values
2. **Document Changes**: Update this guide when adding new variables
3. **Validate Critical Variables**: Ensure required variables are set
4. **Use Defaults**: Provide sensible defaults for optional variables

### Performance

1. **Parallel Execution**: Unit tests run in parallel
2. **Sequential Integration**: Integration tests run sequentially
3. **Resource Management**: Clean up database connections, file handles
4. **Timeout Configuration**: Set appropriate timeouts for different test types

## Troubleshooting

### Common Issues

1. **Environment Variables Not Loading**
   ```bash
   # Verify .env.test exists
   ls -la .env.test
   
   # Test environment loading
   node scripts/load-test-env.js
   ```

2. **Database Connection Issues**
   ```bash
   # Check database URL
   echo $DATABASE_URL
   
   # Verify test database exists
   ls -la test.db
   ```

3. **JWT Secret Issues**
   ```bash
   # Verify JWT secret is set
   echo $JWT_SECRET
   
   # Should be at least 32 characters for security
   ```

4. **Port Conflicts**
   ```bash
   # Check if ports are in use
   netstat -tulpn | grep :3000
   netstat -tulpn | grep :3001
   ```

### Debug Mode

Enable debug logging:

```bash
DEBUG=swapiq:* npm run test:all
```

### Verbose Output

Get detailed test output:

```bash
npm run test:all -- --verbose
```

## Security Notes

⚠️ **IMPORTANT**: The `.env.test` file contains test/mock values only!

- **Never use these values in production**
- **Private keys are Hardhat's well-known test accounts**
- **API keys are mock values that won't work with real services**
- **Secrets are designed for testing only**

## Support

For issues with the test environment:

1. Check this documentation first
2. Verify environment variables are loaded correctly
3. Run individual test categories to isolate issues
4. Check the test output for specific error messages
5. Review the Jest and Hardhat documentation for framework-specific issues