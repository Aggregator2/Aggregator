// Wallet-related type definitions

export interface WalletState {
  address: string | null;
  isConnecting: boolean;
  error: string | null;
  chainId: number | null;
}

export interface Token {
  symbol: string;
  name: string;
  address: string;
  decimals?: number;
  logoURI?: string;
  chainId?: number;
  type?: "ERC-20" | "SPL";
  tags?: string[];
}

export interface Order {
  id?: string;
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  buyAmount: string;
  validTo: number;
  user: string;
  receiver: string;
  wallet: string;
  appData: string;
  feeAmount: string | number;
  partiallyFillable: boolean;
  kind: "sell" | "buy";
  signingScheme: string;
  nonce: string | number;
  signature?: string;
  side?: string;
  status?: string;
}

export interface Quote {
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  buyAmount: string;
  minReceived?: string;
  lpFee?: string | number;
  validTo?: number;
  warning?: string;
  source?: string;
  price?: number;
  slippage?: string;
  priceImpact?: string;
  networkFeeUsd?: string;
}

export interface SwapFormState {
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  buyAmount: string;
  slippageTolerance: string;
}

export interface ApiResponse<T> {
  data?: T;
  error?: string;
  status?: string;
  message?: string;
}

// Type guards
export function isOrder(obj: any): obj is Order {
  return (
    obj &&
    typeof obj === "object" &&
    typeof obj.sellToken === "string" &&
    typeof obj.buyToken === "string" &&
    typeof obj.sellAmount === "string" &&
    typeof obj.buyAmount === "string" &&
    typeof obj.user === "string"
  );
}

export function isOrderArray(obj: any): obj is Order[] {
  return Array.isArray(obj) && obj.every(isOrder);
}

export function isQuote(obj: any): obj is Quote {
  return (
    obj &&
    typeof obj === "object" &&
    typeof obj.sellToken === "string" &&
    typeof obj.buyToken === "string" &&
    typeof obj.sellAmount === "string" &&
    typeof obj.buyAmount === "string"
  );
}
