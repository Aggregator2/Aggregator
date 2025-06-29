import { Trade } from '../matchingEngine/types';

export enum SettlementStatus {
  PENDING = 'PENDING',
  NETTING = 'NETTING',
  BATCHED = 'BATCHED',
  CLEARING = 'CLEARING',
  SETTLED = 'SETTLED',
  FAILED = 'FAILED',
  RECONCILING = 'RECONCILING'
}

export enum SettlementCycle {
  CONTINUOUS = 'CONTINUOUS',
  HOURLY = 'HOURLY',
  DAILY = 'DAILY',
  WEEKLY = 'WEEKLY',
  CUSTOM = 'CUSTOM'
}

export interface Settlement {
  id: string;
  trades: Trade[];
  status: SettlementStatus;
  cycle: SettlementCycle;
  netAmounts: NetPosition[];
  createdAt: number;
  updatedAt: number;
  settledAt?: number;
  batchId?: string;
  transactionHash?: string;
  error?: string;
}

export interface NetPosition {
  userId: string;
  token: string;
  netAmount: bigint;
  originalAmount: bigint;
  nettingReduction: bigint;
}

export interface UserBalance {
  userId: string;
  balances: Map<string, bigint>;
  pendingSettlements: Map<string, bigint>;
  lastUpdated: number;
}

export interface AtomicSwap {
  id: string;
  fromUserId: string;
  toUserId: string;
  fromToken: string;
  toToken: string;
  fromAmount: bigint;
  toAmount: bigint;
  status: 'PENDING' | 'LOCKED' | 'EXECUTED' | 'REVERTED';
  hashlock?: string;
  timelock: number;
  secret?: string;
  createdAt: number;
  executedAt?: number;
}

export interface SettlementBatch {
  id: string;
  settlements: Settlement[];
  totalTrades: number;
  netPositions: Map<string, Map<string, bigint>>;
  status: SettlementStatus;
  createdAt: number;
  executedAt?: number;
}

export interface ClearingHouseConfig {
  collateralRequirement: number;
  marginCallThreshold: number;
  liquidationThreshold: number;
  settlementDelay: number;
  maxBatchSize: number;
}

export interface ClearingMember {
  userId: string;
  collateral: Map<string, bigint>;
  margin: bigint;
  positions: Map<string, bigint>;
  status: 'ACTIVE' | 'MARGIN_CALL' | 'SUSPENDED';
}

export interface ReconciliationReport {
  id: string;
  startTime: number;
  endTime: number;
  offChainBalances: Map<string, UserBalance>;
  onChainBalances: Map<string, Map<string, bigint>>;
  discrepancies: ReconciliationDiscrepancy[];
  status: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  resolvedCount: number;
  pendingCount: number;
}

export interface ReconciliationDiscrepancy {
  userId: string;
  token: string;
  offChainBalance: bigint;
  onChainBalance: bigint;
  difference: bigint;
  type: 'MISSING_SETTLEMENT' | 'DOUBLE_SETTLEMENT' | 'BALANCE_MISMATCH';
  resolved: boolean;
  resolution?: string;
}

export interface SettlementEvent {
  type: 'TRADE_MATCHED' | 'SETTLEMENT_INITIATED' | 'NETTING_COMPLETED' | 
        'BATCH_CREATED' | 'SETTLEMENT_EXECUTED' | 'SETTLEMENT_FAILED' |
        'RECONCILIATION_STARTED' | 'RECONCILIATION_COMPLETED';
  data: any;
  timestamp: number;
}

export interface SettlementMetrics {
  totalTrades: number;
  totalSettlements: number;
  pendingSettlements: number;
  nettingEfficiency: number;
  averageSettlementTime: number;
  failureRate: number;
  reconciliationAccuracy: number;
}