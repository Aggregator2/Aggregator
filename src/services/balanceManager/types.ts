import { Address } from 'viem';

export interface Balance {
  userId: string;
  address: Address;
  tokenAddress: Address;
  available: bigint;
  locked: bigint;
  lastUpdated: Date;
  nonce: number;
}

export interface BalanceUpdate {
  id: string;
  userId: string;
  tokenAddress: Address;
  amount: bigint;
  type: BalanceUpdateType;
  reason: BalanceUpdateReason;
  referenceId?: string; // Trade ID, withdrawal ID, etc.
  previousBalance: bigint;
  newBalance: bigint;
  timestamp: Date;
  metadata?: Record<string, any>;
}

export enum BalanceUpdateType {
  CREDIT = 'CREDIT',
  DEBIT = 'DEBIT',
}

export enum BalanceUpdateReason {
  DEPOSIT = 'DEPOSIT',
  WITHDRAWAL = 'WITHDRAWAL',
  TRADE_BUY = 'TRADE_BUY',
  TRADE_SELL = 'TRADE_SELL',
  FEE = 'FEE',
  EMERGENCY_WITHDRAWAL = 'EMERGENCY_WITHDRAWAL',
  RECONCILIATION = 'RECONCILIATION',
  ADMIN_ADJUSTMENT = 'ADMIN_ADJUSTMENT',
}

export interface BalanceProof {
  userId: string;
  tokenAddress: Address;
  balance: bigint;
  nonce: number;
  timestamp: Date;
  merkleRoot: string;
  merkleProof: string[];
  signature: string;
}

export interface WithdrawalRequest {
  id: string;
  userId: string;
  tokenAddress: Address;
  amount: bigint;
  status: WithdrawalStatus;
  requestedAt: Date;
  processedAt?: Date;
  txHash?: string;
  emergencyWithdrawal: boolean;
}

export enum WithdrawalStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export interface BalanceSnapshot {
  id: string;
  userId: string;
  tokenAddress: Address;
  balance: bigint;
  blockNumber: bigint;
  timestamp: Date;
  snapshotType: SnapshotType;
}

export enum SnapshotType {
  PERIODIC = 'PERIODIC',
  PRE_WITHDRAWAL = 'PRE_WITHDRAWAL',
  POST_DEPOSIT = 'POST_DEPOSIT',
  RECONCILIATION = 'RECONCILIATION',
}

export interface ReconciliationResult {
  userId: string;
  tokenAddress: Address;
  offChainBalance: bigint;
  onChainBalance: bigint;
  difference: bigint;
  isReconciled: boolean;
  timestamp: Date;
  actions: ReconciliationAction[];
}

export interface ReconciliationAction {
  type: 'ADJUST_OFF_CHAIN' | 'ADJUST_ON_CHAIN' | 'INVESTIGATE';
  amount: bigint;
  reason: string;
  executed: boolean;
}