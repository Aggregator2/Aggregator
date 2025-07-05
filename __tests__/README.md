# API Test Suite

This directory contains comprehensive tests for the API endpoints and middleware.

## Test Structure

```
__tests__/
├── api/
│   ├── submitOrder.test.js      # Tests for order submission endpoint
│   └── orderFlow.integration.test.js  # Full order lifecycle tests
├── middleware/
│   └── requireAuth.test.js      # Authentication middleware tests
└── setup.js                     # Jest setup and global utilities
```

## Running Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test submitOrder.test.js

# Run with coverage
npm run test:coverage

# Run in watch mode
npm run test:watch

# Run only API tests
npm test -- --testPathPattern="api"

# Run only middleware tests
npm test -- --testPathPattern="middleware"
```

## Test Coverage

### `/api/submitOrder` Tests
- ✅ Authentication validation (401 scenarios)
- ✅ Input validation (400/422 scenarios)
- ✅ Successful order submission (200)
- ✅ Balance validation
- ✅ Database error handling (500)
- ✅ Concurrent order handling
- ✅ Edge cases

### Integration Tests
- ✅ Complete order lifecycle (submit → view → cancel)
- ✅ Multiple orders from same user
- ✅ Authorization checks (users can't cancel others' orders)
- ✅ Token expiration handling
- ✅ Balance checks across multiple orders

### `requireAuth` Middleware Tests
- ✅ No token scenarios
- ✅ Invalid token formats
- ✅ Expired tokens
- ✅ Wrong secret tokens
- ✅ Valid token processing
- ✅ Custom claims handling
- ✅ Error handling
- ✅ Security (no sensitive data leaks)

## Test Utilities

The `setup.js` file provides global utilities:

```javascript
// Wait for async operations
await testUtils.wait(100);

// Create mock request
const req = testUtils.createMockReq({
  method: 'POST',
  headers: { authorization: 'Bearer token' },
  body: { data: 'test' }
});

// Create mock response
const res = testUtils.createMockRes();
```

## Mocking Strategy

### Database Mocks
- Uses in-memory store for integration tests
- Mocks Prisma client methods
- Maintains state between related operations

### External Services
- Balance validation service mocked
- JWT signing/verification uses test secret
- No real blockchain interactions

## Adding New Tests

1. **Create test file** in appropriate directory
2. **Import required mocks** at the top
3. **Use faker** for generating test data
4. **Follow existing patterns** for consistency
5. **Test both success and failure paths**
6. **Include edge cases**

## Example Test Structure

```javascript
describe('Endpoint Name', () => {
  beforeAll(() => {
    // Setup
  });

  beforeEach(() => {
    // Reset mocks
  });

  describe('Scenario Group', () => {
    it('should handle specific case', async () => {
      // Arrange
      const testData = generateTestData();
      
      // Act
      const response = await request(server)
        .post('/api/endpoint')
        .send(testData);
      
      // Assert
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({...});
    });
  });
});
```

## Best Practices

1. **Isolation**: Each test should be independent
2. **Clarity**: Test names should describe what they test
3. **Coverage**: Test success, failure, and edge cases
4. **Speed**: Mock external dependencies
5. **Maintenance**: Keep tests simple and focused

## Next Steps

To complete the test suite:

1. Add tests for `/api/cancelOrder`
2. Add tests for `/api/orders` (GET)
3. Add tests for other unprotected endpoints
4. Add performance tests for high-load scenarios
5. Add security tests for SQL injection, XSS, etc.
6. Add WebSocket connection tests
7. Add state channel operation tests

## Troubleshooting

If tests fail:

1. Check environment variables in `setup.js`
2. Ensure all dependencies are installed
3. Clear Jest cache: `npx jest --clearCache`
4. Check for port conflicts (test server)
5. Verify mock implementations match actual services