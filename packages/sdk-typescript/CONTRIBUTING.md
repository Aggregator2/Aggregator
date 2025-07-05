# Contributing to Offchain Protocol TypeScript SDK

We welcome contributions to the Offchain Protocol TypeScript SDK! This document provides guidelines for contributing to the project.

## Development Setup

### Prerequisites

- Node.js 16.x or higher
- npm or yarn
- Git

### Getting Started

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/your-username/offchain-sdk-typescript.git
   cd offchain-sdk-typescript
   ```

3. Install dependencies:
   ```bash
   npm install
   ```

4. Build the project:
   ```bash
   npm run build
   ```

5. Run tests:
   ```bash
   npm test
   ```

## Development Workflow

### Code Style

We use ESLint and Prettier for code formatting. Run these before committing:

```bash
npm run lint
npm run format
```

### Testing

All code changes should include tests. We use Jest for testing:

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

### Building

```bash
# Build the project
npm run build

# Build in watch mode
npm run build:watch
```

### Type Checking

```bash
npm run type-check
```

## Pull Request Process

1. Update the README.md with details of changes if applicable
2. Add tests for any new functionality
3. Ensure all tests pass
4. Update the documentation
5. Create a Pull Request with a clear title and description

### Commit Messages

Follow the conventional commits specification:

- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation changes
- `style:` Code style changes (formatting, etc)
- `refactor:` Code refactoring
- `test:` Test changes
- `chore:` Build process or auxiliary tool changes

Examples:
```
feat: add support for stop-limit orders
fix: handle rate limit errors in websocket client
docs: update examples for new order types
```

## API Guidelines

### Error Handling

Always throw specific error types:

```typescript
import { ValidationError, OrderNotFoundError } from './errors';

// Good
if (!order) {
  throw new OrderNotFoundError(orderId);
}

// Bad
if (!order) {
  throw new Error('Order not found');
}
```

### Type Safety

Always use TypeScript types:

```typescript
// Good
async function getOrder(id: string): Promise<Order> {
  // ...
}

// Bad
async function getOrder(id: any): Promise<any> {
  // ...
}
```

### Async/Await

Use async/await instead of callbacks:

```typescript
// Good
async function fetchData() {
  const data = await api.get('/data');
  return data;
}

// Bad
function fetchData(callback) {
  api.get('/data', callback);
}
```

## Testing Guidelines

### Unit Tests

```typescript
describe('OrdersAPI', () => {
  it('should create an order', async () => {
    const order = await client.orders.create({
      pair: 'BTC/USDT',
      side: OrderSide.BUY,
      type: OrderType.LIMIT,
      quantity: '0.1',
      price: '45000'
    });
    
    expect(order).toBeDefined();
    expect(order.id).toBeTruthy();
    expect(order.status).toBe(OrderStatus.OPEN);
  });
});
```

### Integration Tests

```typescript
describe('WebSocket Integration', () => {
  it('should receive order updates', async (done) => {
    await client.connect();
    client.websocket.subscribeOrders();
    
    client.websocket.on('order:update', (order) => {
      expect(order).toBeDefined();
      done();
    });
    
    // Trigger an order update
    await client.orders.create(testOrder);
  });
});
```

## Documentation

### Code Comments

Use JSDoc for public APIs:

```typescript
/**
 * Creates a new order
 * @param request - The order creation request
 * @returns The created order
 * @throws {ValidationError} If the order parameters are invalid
 * @throws {InsufficientBalanceError} If the user has insufficient balance
 * @example
 * ```typescript
 * const order = await client.orders.create({
 *   pair: 'BTC/USDT',
 *   side: OrderSide.BUY,
 *   type: OrderType.LIMIT,
 *   quantity: '0.1',
 *   price: '45000'
 * });
 * ```
 */
async create(request: CreateOrderRequest): Promise<Order> {
  // ...
}
```

### README Updates

Update the README.md when adding new features or changing APIs.

## Release Process

1. Update version in package.json
2. Update CHANGELOG.md
3. Create a git tag
4. Push to GitHub
5. GitHub Actions will automatically publish to npm

## Questions?

Feel free to open an issue or reach out to the maintainers:

- GitHub Issues: https://github.com/offchain-protocol/sdk-typescript/issues
- Discord: https://discord.gg/offchain
- Email: sdk@offchain.finance