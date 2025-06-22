/**
 * Central type definitions for the entire project
 * This file re-exports all types from various type files for easy importing
 */

// Re-export all types from wallet.ts
export type {
  WalletState,
  Token,
  Order,
  Quote,
  SwapFormState,
  ApiResponse
} from './wallet';

// Re-export type guards
export {
  isOrder,
  isOrderArray,
  isQuote
} from './wallet';

// Re-export token types from src/types/token.ts
export type {
  TokenType,
  Token as ExtendedToken, // Extended token interface from src/types/token.ts
  ChainConfig as ExtendedChainConfig,
  TokenList,
  TokenBalance
} from '../src/types/token';

// Re-export the SUPPORTED_CHAINS constant
export { SUPPORTED_CHAINS } from '../src/types/token';

// Additional common types used across the project
export interface TransactionStatus {
  hash: string;
  status: 'pending' | 'success' | 'failed';
  confirmations: number;
  timestamp: Date;
}

export interface ChainConfig {
  chainId: number;
  name: string;
  nativeCurrency: string;
  rpcUrls: string[];
  blockExplorerUrl?: string;
  iconUrl?: string;
}

export interface PriceData {
  token: string;
  price: number;
  change24h?: number;
  volume24h?: number;
  marketCap?: number;
  lastUpdated: Date;
}

export interface GasEstimate {
  standard: string;
  fast: string;
  instant: string;
  baseFee?: string;
  priorityFee?: string;
}

export interface SwapRoute {
  path: string[];
  protocols: string[];
  pools?: string[];
  estimatedGas: string;
  priceImpact: number;
}

// Utility types
export type Nullable<T> = T | null;
export type Optional<T> = T | undefined;
export type AsyncResult<T> = Promise<{ success: boolean; data?: T; error?: string }>;

// Component prop types
export interface BaseComponentProps {
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

export interface ModalProps extends BaseComponentProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  size?: 'small' | 'medium' | 'large';
}

// Form types
export interface FormField<T = string> {
  value: T;
  error?: string;
  touched?: boolean;
  disabled?: boolean;
}

export interface FormState<T> {
  values: T;
  errors: Partial<Record<keyof T, string>>;
  touched: Partial<Record<keyof T, boolean>>;
  isSubmitting: boolean;
  isValid: boolean;
}

// API types
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface ErrorResponse {
  error: string;
  code?: string;
  details?: any;
  timestamp?: Date;
}

// Event types
export interface SwapEvent {
  type: 'swap_initiated' | 'swap_completed' | 'swap_failed';
  data: {
    sellToken: Token;
    buyToken: Token;
    sellAmount: string;
    buyAmount: string;
    txHash?: string;
    error?: string;
  };
  timestamp: Date;
}

// Constants
export const NATIVE_TOKEN_ADDRESS = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

// Type aliases for better readability
export type TokenAddress = string;
export type ChainId = number;
export type TransactionHash = string;
export type BlockNumber = number;
export type Wei = string;
export type Gwei = string;

// Enum-like constants
export const OrderStatus = {
  PENDING: 'pending',
  FILLED: 'filled',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
} as const;

export type OrderStatusType = typeof OrderStatus[keyof typeof OrderStatus];

export const TransactionType = {
  SWAP: 'swap',
  APPROVE: 'approve',
  WRAP: 'wrap',
  UNWRAP: 'unwrap'
} as const;

export type TransactionTypeValue = typeof TransactionType[keyof typeof TransactionType];