# Risk Management Integration

This document describes the comprehensive risk management system integrated into the matching engine.

## Overview

The Risk Management Service provides real-time validation of orders before execution, protecting the system and users from various risks including:

- **Position Limits**: Maximum position sizes, leverage, and concentration limits
- **Order Size Validation**: Minimum and maximum order sizes
- **Wash Trading Detection**: Prevents self-trading and market manipulation
- **Suspicious Pattern Detection**: Identifies spoofing, layering, and other manipulative behaviors
- **Daily Limits**: Volume, trade count, and loss limits
- **User Blacklisting**: Blocks orders from restricted users

## Architecture

```
Order Flow:
User → Order Request → RiskAwareMatchingEngine → RiskManagementService → Risk Checks
                                                                              ↓
                     ← ExecutionReport ← Order Processing ← APPROVED/REJECTED/REVIEW
```

## Risk Check Categories

### 1. User Status Checks
- **Blacklist Check**: Immediately rejects orders from blacklisted users
- **Suspicious User Check**: Flags users with multiple suspicious patterns

### 2. Order Size Validation
```typescript
// Checks performed:
- Minimum order size (per symbol)
- Maximum order size (per symbol)
- Maximum order value (notional)
```

### 3. Position Limit Checks
```typescript
// Limits enforced:
- Maximum position size per symbol
- Maximum leverage
- Maximum open positions
- Maximum total notional value
- Concentration limits (% per symbol/sector)
```

### 4. Wash Trading Detection
- Detects trading on both sides within 5 minutes
- Checks for similar prices (within 1%)
- Monitors rapid trading patterns
- Flags potential self-trading

### 5. Market Manipulation Detection
- **Spoofing**: Large orders far from market price
- **Layering**: Multiple orders at different price levels
- **Price Manipulation**: Abnormal price movements
- **Volume Manipulation**: Unusual volume spikes

### 6. Daily Limits
- Maximum daily trading volume
- Maximum daily trade count
- Maximum daily loss
- P&L tracking

## Configuration

### Risk Configuration
```typescript
const riskConfig: RiskConfig = {
  globalMaxLeverage: 10,
  defaultInitialMarginRate: 0.1,        // 10%
  defaultMaintenanceMarginRate: 0.05,   // 5%
  liquidationFeeRate: 0.002,            // 0.2%
  insuranceFundContributionRate: 0.001, // 0.1%
  circuitBreakerEnabled: true,
  autoDeleveragingEnabled: true,
  marginCallWarningThreshold: 0.7,      // 70%
  maxDrawdownPerUser: 0.5,             // 50%
  riskFreeRate: 0.02                   // 2%
};
```

### User-Specific Limits
```typescript
riskService.setUserLimits('userId', {
  maxPositionSize: 100000,
  maxLeverage: 5,
  maxOpenPositions: 10,
  maxNotionalValue: 500000,
  maxOrderSize: 10000,
  minOrderSize: 0.001,
  maxOrderValue: 100000,
  maxDailyVolume: 1000000,
  maxDailyTrades: 100,
  maxDailyLoss: 50000,
  maxConcentrationPerSymbol: 0.3,
  maxConcentrationPerSector: 0.5
});
```

## Risk Check Results

Orders can receive one of three results:

### 1. APPROVED
- All risk checks passed
- Order proceeds to matching engine

### 2. REJECTED
- One or more critical risk checks failed
- Order is immediately cancelled
- User receives detailed error message

### 3. REQUIRES_REVIEW
- Warning-level issues detected
- Order held for manual review (if enabled)
- Risk manager can approve or reject

## Error Codes and Messages

| Error Code | User Message | Description |
|------------|--------------|-------------|
| USER_BLACKLISTED | Your account is restricted from trading | User on blacklist |
| ORDER_TOO_SMALL | Order size is below minimum | Below min order size |
| ORDER_TOO_LARGE | Order size exceeds maximum | Above max order size |
| MAX_POSITIONS_EXCEEDED | Maximum open positions reached | Position count limit |
| WASH_TRADING_DETECTED | Trading pattern violates market rules | Self-trading detected |
| DAILY_VOLUME_EXCEEDED | Daily trading volume limit reached | Volume limit hit |
| CONCENTRATION_LIMIT_EXCEEDED | Position concentration too high | Over-concentrated |

## Integration Example

```typescript
// Create risk-aware matching engine
const matchingEngine = new RiskAwareMatchingEngine(
  {
    // Standard matching engine config
    maxOrderBookDepth: 1000,
    minOrderSize: { 'ETH/USDC': 0.001 },
    // ... other config
    
    // Risk configuration
    riskCheckEnabled: true,
    blockOnRejection: true,
    allowReviewOrders: true,
    riskCheckTimeout: 3000 // 3 seconds
  },
  riskService
);

// Submit order (risk checks happen automatically)
try {
  const result = await matchingEngine.submitOrder({
    userId: 'trader123',
    pair: 'ETH/USDC',
    side: 'BUY',
    type: 'LIMIT',
    price: 2500,
    quantity: 1
  });
  
  console.log('Order accepted:', result.orderId);
} catch (error) {
  console.log('Order rejected:', error.message);
}
```

## Manual Review Process

For orders flagged for review:

```typescript
// Get pending review orders
const pendingOrders = matchingEngine.getPendingReviewOrders();

// Approve order
await matchingEngine.approveReviewOrder(orderId, 'risk-manager-id');

// Reject order
await matchingEngine.rejectReviewOrder(
  orderId, 
  'risk-manager-id',
  'Suspicious trading pattern'
);
```

## Event Monitoring

The system emits various events for monitoring:

```typescript
// Order rejected
matchingEngine.on('orderRejected', (data) => {
  console.log('Order rejected:', data.reason, data.riskErrors);
});

// Order pending review
matchingEngine.on('orderPendingReview', (data) => {
  console.log('Review required:', data.order.id, data.riskWarnings);
});

// Risk alert
matchingEngine.on('riskAlert', (alert) => {
  console.log('Risk alert:', alert.type, alert.severity);
});

// User blacklisted
riskService.on('userBlacklisted', (data) => {
  console.log('User blacklisted:', data.userId, data.reason);
});
```

## Performance Considerations

1. **Risk Check Timeout**: Default 3 seconds, configurable
2. **Caching**: User limits and metrics cached in memory
3. **Trade History**: Last 1000 trades per user kept in memory
4. **Suspicious Patterns**: Expire after 24 hours

## Best Practices

1. **Configure Appropriate Limits**: Set limits based on user types (retail, institutional, market maker)
2. **Monitor Rejection Rates**: High rejection rates may indicate overly strict limits
3. **Review Patterns Regularly**: Update detection algorithms based on new manipulation techniques
4. **Implement Gradual Restrictions**: Warn before blocking for minor violations
5. **Maintain Audit Trail**: Log all risk decisions for compliance

## Troubleshooting

### Common Issues

1. **"Risk check timeout"**
   - Increase `riskCheckTimeout` configuration
   - Check system performance

2. **"Order rejected: Multiple errors"**
   - Review user's risk profile
   - Check if limits need adjustment

3. **False positive wash trading**
   - Adjust time window or price threshold
   - Consider user's trading strategy

## API Reference

### RiskManagementService Methods

```typescript
// Validate an order
validateOrder(order: Order): Promise<OrderRiskCheck>

// Set user limits
setUserLimits(userId: string, limits: Partial<RiskLimits>): void

// Blacklist/unblacklist user
blacklistUser(userId: string, reason: string): void
unblacklistUser(userId: string): void

// Get user risk profile
getUserRiskProfile(userId: string): RiskProfile
```

### RiskAwareMatchingEngine Methods

```typescript
// Submit order with risk checks
submitOrder(order: Partial<Order>): Promise<ExecutionReport>

// Manual review
approveReviewOrder(orderId: string, approverId: string): Promise<ExecutionReport>
rejectReviewOrder(orderId: string, rejectorId: string, reason: string): Promise<ExecutionReport>

// Get pending reviews
getPendingReviewOrders(): Order[]

// Get rejected orders
getRejectedOrders(userId?: string, limit?: number): any[]
```