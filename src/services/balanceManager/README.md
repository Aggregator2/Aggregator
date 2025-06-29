# Balance Manager

Off-chain balance tracking system with comprehensive audit trails, emergency withdrawals, and on-chain reconciliation.

## Features

- **Balance Tracking**: Track user deposits, withdrawals, and virtual balance updates
- **Trade Processing**: Atomic balance updates for trades with rollback support
- **Balance Verification**: Verify balance integrity through transaction history
- **Merkle Proofs**: Generate balance proofs using Merkle trees
- **Emergency Withdrawals**: Allow users to withdraw all funds in emergency situations
- **On-Chain Reconciliation**: Compare and reconcile off-chain balances with on-chain state
- **Audit System**: Comprehensive audit trails with suspicious activity detection
- **Persistent Storage**: Save and restore balance data with automatic backups

## Usage

```typescript
import { BalanceSystem } from './services/balanceManager';

// Initialize the balance system
const balanceSystem = new BalanceSystem({
  enableAudit: true,
  storage: {
    dataDir: './data/balances',
    backupInterval: 60, // minutes
    compressionEnabled: false,
  }
});

// Access components
const { balanceManager, auditService, storage } = balanceSystem;

// Process a deposit
await balanceManager.processDeposit(
  userId,
  tokenAddress,
  amount,
  txHash
);

// Process a trade
await balanceManager.processTrade(
  buyerId,
  sellerId,
  baseToken,
  quoteToken,
  baseAmount,
  quoteAmount,
  tradeId
);

// Create withdrawal request
const withdrawal = await balanceManager.createWithdrawalRequest(
  userId,
  tokenAddress,
  amount
);

// Emergency withdrawal
const emergencyWithdrawal = await balanceManager.processEmergencyWithdrawal(
  userId,
  tokenAddress
);

// Generate balance proof
const proof = await balanceManager.generateBalanceProof(userId, tokenAddress);

// Reconcile with on-chain
const result = await balanceManager.reconcileWithOnChain(
  userId,
  tokenAddress,
  onChainBalance
);

// Get audit report
const report = await auditService.generateAuditReport(startDate, endDate);
```

## Architecture

### BalanceManager
Core component that handles:
- Balance updates (deposits, withdrawals, trades)
- Balance locking/unlocking for trades
- Balance verification
- Merkle proof generation
- Emergency withdrawals

### AuditService
Monitors all balance activities:
- Logs all balance updates
- Detects suspicious activities
- Generates audit reports
- Tracks integrity violations

### BalanceStorage
Handles persistence:
- Saves balances, updates, and snapshots
- Automatic backups
- Data export functionality

## Security Features

1. **Balance Verification**: Ensures computed balance matches stored balance
2. **Atomic Updates**: Trade updates are atomic with rollback on failure
3. **Audit Trails**: Every balance change is logged with full context
4. **Suspicious Activity Detection**: Monitors for unusual patterns
5. **Emergency Withdrawals**: Users can withdraw all funds in emergencies
6. **Reconciliation**: Regular checks against on-chain state

## Events

The system emits events for monitoring:
- `balanceUpdate`: When any balance changes
- `balanceLocked`/`balanceUnlocked`: During trade processing
- `withdrawalRequested`: When withdrawal is created
- `reconciliationCompleted`: After reconciliation
- `suspiciousActivity`: When unusual activity detected
- `integrityCheckFailed`: When balance verification fails