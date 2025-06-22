// SwapWidget specific type definitions

import type { Order, Quote, Token } from './wallet';

// Props types
export interface SwapWidgetProps {
  userAddress?: string;
  onConnect?: () => void;
  onSubmitOrder?: (order: SignedOrder) => void | Promise<void>;
  orders?: Order[];
}

// EIP-712 types
export interface EIP712Domain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: string;
}

export interface EIP712TypeDef {
  name: string;
  type: string;
}

export interface EIP712Types {
  Order: EIP712TypeDef[];
}

// Order types
export interface SignedOrder {
  order: Order;
  signature: string;
}

// Hook return types
export interface ToastHook {
  showError: (message: string) => void;
  showSuccess: (message: string) => void;
  showWarning: (message: string) => void;
  showInfo: (message: string) => void;
  ToastContainer: React.FC;
}

export interface OrderToastHook {
  showOrderSubmitted: (
    orderId: string,
    sellToken: string,
    buyToken: string,
    sellAmount: string,
    buyAmount: string
  ) => void;
  showOrderFilled: (
    orderId: string,
    sellToken: string,
    buyToken: string,
    sellAmount: string,
    buyAmount: string,
    txHash: string
  ) => void;
  showOrderFailed: (orderId: string, error: string) => void;
  OrderToastContainer: React.FC;
}

export interface NetworkStatus {
  isOnline: boolean;
}

export interface TokenPriceData {
  price?: number;
  error?: string;
  loading: boolean;
  retry: () => void;
}

// Fee calculation types
export interface FeeCalculation {
  netAmount: string;
  feeAmount: string;
  feePercentage: number;
}

// API types
export interface QuoteRequest {
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  chainId: number;
}

export interface QuoteResponse extends Quote {
  warning?: string;
  source?: string;
}

export interface SubmitOrderRequest {
  order: Order;
  signature: string;
}

export interface SubmitOrderResponse {
  orderId: string;
  txHash?: string;
  status: string;
}

// Component state types
export type SettlementMode = 'offchain' | 'escrow';
export type ActiveTab = 'swap' | 'limit';

// Event handler types
export type FormSubmitHandler = (e: React.FormEvent<HTMLFormElement>) => void | Promise<void>;
export type TokenSelectHandler = (token: Token) => void;
export type InputChangeHandler = (e: React.ChangeEvent<HTMLInputElement>) => void;
export type ButtonClickHandler = (e: React.MouseEvent<HTMLButtonElement>) => void;

// Escrow contract factory type
export type EscrowContractFactory = () => Promise<any>; // ethers.Contract

// Window ethereum types
export interface EthereumProvider {
  request: (args: { method: string; params?: any[] }) => Promise<any>;
  on: (event: string, handler: (...args: any[]) => void) => void;
  removeListener: (event: string, handler: (...args: any[]) => void) => void;
}

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

// Order display type for safe orders
export interface SafeOrder {
  id: string;
  status: 'filled' | 'failed' | 'pending';
  timestamp: Date;
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  buyAmount: string;
  txHash?: string;
  side?: string;
}

// Connect wallet result type
export interface ConnectWalletResult {
  success: boolean;
  address?: string;
  error?: string;
}

// Signer result type
export interface SignerResult {
  success: boolean;
  signer?: any; // ethers.Signer
  address?: string;
  error?: string;
}