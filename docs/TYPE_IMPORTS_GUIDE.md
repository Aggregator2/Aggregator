# Type Imports Guide

This guide shows how to properly import types throughout the project.

## Basic Imports from types/wallet.ts

For components that need basic wallet-related types:

```typescript
import type { Order, Quote, Token, WalletState } from '../types/wallet';
```

## Comprehensive Imports from types/index.ts

For components that need multiple types:

```typescript
import type { 
  Order, 
  Quote, 
  Token,
  WalletState,
  SwapFormState,
  ApiResponse,
  TransactionStatus,
  ChainConfig,
  PriceData,
  OrderStatusType
} from '../types';
```

## Extended Token Types from src/types/token.ts

For services that need the extended token interface with all metadata:

```typescript
import type { Token, TokenType, TokenBalance, ChainConfig } from '../src/types/token';
```

## Service-Specific Types

### For Quote Services:
```typescript
import type { Quote } from '../types/wallet';
import type { QuoteRequest, QuoteResponse } from '../src/services/multiChainQuoteService';
```

### For Token Services:
```typescript
import type { Token } from '../types/wallet'; // Basic token interface
import type { Token as ExtendedToken } from '../src/types/token'; // Extended interface
```

### For Wallet Components:
```typescript
import type { Order, Token, WalletState } from '../types/wallet';
import type { OrderWithStatus } from '../components/WalletHeader'; // If needed
```

## Type Guards

Always import type guards when you need runtime type checking:

```typescript
import { isOrder, isOrderArray, isQuote } from '../types/wallet';

// Usage
if (isOrder(data)) {
  // TypeScript now knows data is an Order
}
```

## Constants and Enums

Import constants for better type safety:

```typescript
import { 
  NATIVE_TOKEN_ADDRESS, 
  ZERO_ADDRESS,
  OrderStatus,
  TransactionType 
} from '../types';

// Usage
if (token.address === NATIVE_TOKEN_ADDRESS) {
  // Handle native token
}

const status: OrderStatusType = OrderStatus.PENDING;
```

## Best Practices

1. **Use Type-Only Imports**: Always use `import type` for type imports to reduce bundle size:
   ```typescript
   import type { Token } from '../types/wallet'; // ✅
   import { Token } from '../types/wallet'; // ❌ (unless you need runtime values)
   ```

2. **Import from the Most Specific Location**: 
   - Use `types/wallet.ts` for basic types
   - Use `src/types/token.ts` for extended token types
   - Use `types/index.ts` for multiple types

3. **Avoid Circular Dependencies**: Don't import from files that import from your file

4. **Use Type Aliases for Complex Types**:
   ```typescript
   import type { Token, Quote } from '../types/wallet';
   
   type TokenPair = {
     sellToken: Token;
     buyToken: Token;
   };
   ```

## Migration Guide

To update existing imports:

1. **Replace `any` types**:
   ```typescript
   // Before
   quote: any
   
   // After
   import type { Quote } from '../types/wallet';
   quote: Quote | null
   ```

2. **Use proper Order types**:
   ```typescript
   // Before
   orders?: Array<{ id: string; status: string; ... }>
   
   // After
   import type { Order } from '../types/wallet';
   interface OrderWithStatus extends Order {
     status: 'pending' | 'filled' | 'failed';
     timestamp: Date;
   }
   orders?: OrderWithStatus[]
   ```

3. **Import Token types consistently**:
   ```typescript
   // UI Components
   import type { Token } from '../types/wallet';
   
   // Backend Services  
   import type { Token } from '../src/types/token';
   ```