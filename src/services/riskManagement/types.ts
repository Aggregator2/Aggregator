export interface Position {
  id: string;
  userId: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  size: number;
  entryPrice: number;
  markPrice: number;
  unrealizedPnL: number;
  realizedPnL: number;
  margin: number;
  leverage: number;
  liquidationPrice: number;
  lastUpdated: Date;
  createdAt: Date;
}

export interface PositionLimit {
  userId: string;
  symbol?: string; // Optional for symbol-specific limits
  maxPositionSize: number;
  maxLeverage: number;
  maxOpenPositions: number;
  maxNotionalValue: number;
  maxLossPerDay: number;
  maxLossPerWeek: number;
}

export interface MarginRequirement {
  symbol: string;
  initialMarginRate: number; // e.g., 0.1 for 10%
  maintenanceMarginRate: number; // e.g., 0.05 for 5%
  minNotionalValue: number;
  maxLeverage: number;
}

export interface RiskMetrics {
  userId: string;
  totalCollateral: number;
  usedCollateral: number;
  availableCollateral: number;
  totalExposure: number;
  marginRatio: number; // Used margin / Total margin
  healthFactor: number; // Collateral / Required margin
  netOpenPositions: number;
  totalUnrealizedPnL: number;
  totalRealizedPnL: number;
  riskScore: number; // 0-100
  lastCalculated: Date;
}

export interface LiquidationEvent {
  id: string;
  positionId: string;
  userId: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  size: number;
  liquidationPrice: number;
  executionPrice: number;
  loss: number;
  insuranceFundContribution: number;
  timestamp: Date;
  reason: 'MARGIN_CALL' | 'STOP_LOSS' | 'MAX_LOSS' | 'FORCED';
}

export interface CircuitBreaker {
  symbol: string;
  priceChangeThreshold: number; // e.g., 0.1 for 10%
  volumeThreshold: number;
  timeWindow: number; // in seconds
  cooldownPeriod: number; // in seconds
  isActive: boolean;
  triggeredAt?: Date;
  expiresAt?: Date;
}

export interface CounterpartyRisk {
  counterpartyId: string;
  creditScore: number; // 0-1000
  defaultProbability: number; // 0-1
  exposureLimit: number;
  currentExposure: number;
  collateralRatio: number;
  paymentHistory: {
    onTimePayments: number;
    latePayments: number;
    defaults: number;
  };
  lastAssessment: Date;
}

export interface InsuranceFund {
  id: string;
  totalBalance: number;
  reservedAmount: number;
  availableAmount: number;
  targetSize: number;
  contributions: {
    trading: number;
    liquidations: number;
    donations: number;
  };
  payouts: {
    liquidations: number;
    emergencies: number;
  };
  lastUpdated: Date;
}

export interface RiskAlert {
  id: string;
  userId?: string;
  type: 'MARGIN_WARNING' | 'POSITION_LIMIT' | 'CIRCUIT_BREAKER' | 'COUNTERPARTY_RISK' | 'SYSTEM_RISK';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  message: string;
  metadata: Record<string, any>;
  isResolved: boolean;
  createdAt: Date;
  resolvedAt?: Date;
}

export interface RiskConfig {
  globalMaxLeverage: number;
  defaultInitialMarginRate: number;
  defaultMaintenanceMarginRate: number;
  liquidationFeeRate: number;
  insuranceFundContributionRate: number;
  circuitBreakerEnabled: boolean;
  autoDeleveragingEnabled: boolean;
  marginCallWarningThreshold: number; // e.g., 0.7 for 70% margin usage
  maxDrawdownPerUser: number; // Maximum allowed drawdown
  riskFreeRate: number; // For advanced calculations
}