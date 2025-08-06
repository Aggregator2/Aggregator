# Data Consistency Framework Documentation

## Overview

The SwappiQ Protocol Data Consistency Framework provides comprehensive data integrity guarantees across the trading platform. It implements foreign key constraints, check constraints, audit log triggers, and two-phase commit protocols for critical operations.

## Components

### 1. Foreign Key Constraints with Cascades
- **Location**: `/workspace/database/scripts/data-consistency-constraints.sql`
- **Features**:
  - Proper CASCADE and RESTRICT rules for data relationships
  - DEFERRABLE constraints for complex transactions
  - Referential integrity across all tables

### 2. Check Constraints for Business Rules
- **Location**: `/workspace/database/scripts/data-consistency-constraints.sql`
- **Validations**:
  - Wallet address format validation
  - Price and quantity positivity checks
  - Balance consistency (total = available + locked)
  - Order quantity validation
  - Trading pair limits enforcement
  - OHLC price consistency

### 3. Audit Log Triggers
- **Location**: `/workspace/database/scripts/audit-log-triggers.sql`
- **Features**:
  - Comprehensive audit trail for all critical tables
  - Before/after value tracking
  - User session context recording
  - High-value transaction alerts
  - Security event monitoring
  - Compliance reporting functions

### 4. Two-Phase Commit Manager
- **Location**: `/workspace/lib/data-consistency/TwoPhaseCommitManager.js`
- **Capabilities**:
  - Distributed transaction coordination
  - Automatic failure recovery
  - Participant state tracking
  - Dead coordinator takeover
  - Transaction persistence in Redis

### 5. Data Consistency Framework
- **Location**: `/workspace/lib/data-consistency/DataConsistencyFramework.js`
- **Features**:
  - Multiple consistency levels (STRONG, EVENTUAL, CAUSAL)
  - Automated validation and repair
  - Snapshot creation and restoration
  - Cross-entity consistency checks
  - Performance monitoring

## Usage Examples

### Executing a Two-Phase Commit Transaction

```javascript
const { TwoPhaseCommitManager } = require('./lib/data-consistency/TwoPhaseCommitManager');

const twoPhaseCommit = new TwoPhaseCommitManager({
    databases: {
        main: { /* connection config */ },
        blockchain: { /* connection config */ }
    },
    redis: {
        host: 'localhost',
        port: 6379
    }
});

await twoPhaseCommit.initialize();

// Execute order matching with 2PC
const result = await twoPhaseCommit.executeOrderMatch(
    buyOrder,
    sellOrder,
    {
        price: 1500.00,
        quantity: 0.5,
        pair: 'ETH/USDT',
        baseAsset: 'ETH',
        quoteAsset: 'USDT'
    }
);
```

### Validating Data Consistency

```javascript
const { DataConsistencyFramework } = require('./lib/data-consistency/DataConsistencyFramework');

const framework = new DataConsistencyFramework({
    consistency: {
        level: 'STRONG',
        readPreference: 'PRIMARY'
    },
    validation: {
        enabled: true,
        periodicChecks: true,
        checkInterval: 300000 // 5 minutes
    }
});

await framework.initialize();

// Validate consistency
const validation = await framework.validateConsistency([
    { type: 'balance', data: balanceRecord },
    { type: 'order', data: orderRecord },
    { type: 'cross-entity' }
]);

if (!validation.valid) {
    // Repair inconsistencies
    const repairs = await framework.repairInconsistencies(validation.issues);
}
```

### Creating and Restoring Snapshots

```javascript
// Create snapshot
const snapshot = await framework.createSnapshot({
    includeMetadata: true
});

// Restore from snapshot
await framework.restoreFromSnapshot(snapshot.snapshotId, {
    validateIntegrity: true
});
```

## Database Constraints

### Check Constraints Examples

```sql
-- Wallet address format
CHECK (LENGTH("walletAddress") = 42 AND "walletAddress" ~ '^0x[a-fA-F0-9]{40}$')

-- Balance consistency
CHECK (total = available + locked)

-- Order price limits
CHECK ("minOrderValue" > 0 AND "minOrderValue" < "maxOrderValue")

-- OHLC price consistency
CHECK (high >= open AND high >= close AND low <= open AND low <= close)
```

### Foreign Key Cascades

```sql
-- User deletion cascades to sessions
FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE CASCADE

-- Order deletion restricted if trades exist
FOREIGN KEY ("buyOrderId") REFERENCES "Order"(id) ON DELETE RESTRICT

-- Balance updates cascade to user
FOREIGN KEY ("userId") REFERENCES "User"(id) ON UPDATE CASCADE
```

## Audit Log System

### Automatic Tracking
- All INSERT, UPDATE, DELETE operations
- User context from session
- Changed fields identification
- Before/after values for updates

### Compliance Reporting

```sql
-- Generate compliance report
SELECT * FROM generate_compliance_report('2024-01-01', '2024-01-31');

-- Get user activity trail
SELECT * FROM get_audit_trail('Order', 'order-uuid-here');

-- View high-value transactions
SELECT * FROM v_high_value_audit WHERE created_at > NOW() - INTERVAL '24 hours';
```

## Two-Phase Commit Protocol

### Supported Operations
1. **Order Matching**: Atomic updates to orders, trades, and balances
2. **Withdrawals**: Balance locking, transaction creation, blockchain queueing
3. **Cross-database Operations**: Coordinated updates across multiple databases

### Failure Recovery
- Automatic transaction recovery on coordinator failure
- Prepared transaction persistence
- Configurable retry strategies
- Dead node detection and takeover

## Monitoring and Metrics

### Available Metrics
- Transaction success/failure rates
- Average transaction duration
- Validation failure rates
- Inconsistency detection rates
- Pending operation counts

### Alerts
- High inconsistency rate alerts
- Transaction timeout warnings
- Validation failure notifications
- Coordinator failure alerts

## Best Practices

### 1. Transaction Design
- Keep transactions small and focused
- Use appropriate consistency levels
- Set reasonable timeouts
- Handle partial failures gracefully

### 2. Validation Strategy
- Enable periodic validation checks
- Set appropriate check intervals
- Configure auto-repair for known issues
- Monitor validation metrics

### 3. Performance Optimization
- Use deferred constraints for bulk operations
- Batch validations when possible
- Configure appropriate snapshot intervals
- Monitor and tune check frequencies

### 4. Security Considerations
- Always use prepared statements
- Validate input at constraint level
- Monitor audit logs for suspicious activity
- Regularly review compliance reports

## Troubleshooting

### Common Issues

1. **Constraint Violations**
   - Check error messages for specific constraint names
   - Review business logic for edge cases
   - Use deferred constraints for complex operations

2. **2PC Transaction Failures**
   - Check participant connectivity
   - Verify transaction timeout settings
   - Review prepared transaction states
   - Check coordinator health

3. **Validation Failures**
   - Review validation rules
   - Check for race conditions
   - Verify data migration completeness
   - Analyze repair action logs

### Recovery Procedures

1. **Manual Transaction Recovery**
   ```sql
   -- List prepared transactions
   SELECT * FROM pg_prepared_xacts;
   
   -- Manually commit/rollback
   COMMIT PREPARED 'transaction-id';
   ROLLBACK PREPARED 'transaction-id';
   ```

2. **Snapshot Recovery**
   ```javascript
   // List available snapshots
   const snapshots = await framework.listSnapshots();
   
   // Restore specific snapshot
   await framework.restoreFromSnapshot(snapshots[0].id);
   ```

## Configuration Reference

### TwoPhaseCommitManager Options
```javascript
{
    transaction: {
        timeout: 30000,              // Transaction timeout (ms)
        maxRetries: 3,               // Retry attempts
        isolationLevel: 'SERIALIZABLE'
    },
    coordinator: {
        heartbeatInterval: 5000,     // Heartbeat frequency
        deadNodeTimeout: 15000       // Dead node detection
    },
    recovery: {
        enabled: true,               // Auto-recovery
        checkInterval: 60000         // Recovery check frequency
    }
}
```

### DataConsistencyFramework Options
```javascript
{
    consistency: {
        level: 'STRONG',             // STRONG, EVENTUAL, CAUSAL
        replicationFactor: 3         // Replication factor
    },
    validation: {
        periodicChecks: true,        // Enable periodic validation
        checkInterval: 300000        // Check frequency (ms)
    },
    recovery: {
        snapshotInterval: 3600000,   // Snapshot frequency
        retentionPeriod: 604800000   // 7 days retention
    }
}
```