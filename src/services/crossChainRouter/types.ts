// No longer importing BigNumber as it's not available in ethers v6

export interface CrossChainSwapRequest {
  sourceChainId: number;
  destinationChainId: number;
  sourceToken: string;
  destinationToken: string;
  sourceAmount: string;
  recipientAddress: string;
  slippageTolerance?: number; // basis points (100 = 1%)
  maxPriceImpact?: number; // basis points
  preferredBridges?: string[]; // optional bridge preferences
  excludeBridges?: string[]; // bridges to exclude
}

export interface SwapRoute {
  id: string;
  steps: SwapStep[];
  estimatedOutput: string;
  totalFeeUSD: number;
  totalGasCostUSD: number;
  estimatedTime: number; // seconds
  priceImpact: number; // basis points
  reliability: number; // 0-100 score
}

export interface SwapStep {
  type: 'swap' | 'bridge' | 'approval';
  chainId: number;
  protocol: string;
  fromToken: TokenInfo;
  toToken: TokenInfo;
  fromAmount: string;
  estimatedToAmount: string;
  gasCost: string;
  gasPrice?: string;
  data?: any; // protocol-specific data
}

export interface TokenInfo {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  chainId: number;
  logoURI?: string;
  priceUSD?: number;
}

export interface BridgeQuote {
  bridgeId: string;
  bridgeName: string;
  fromChainId: number;
  toChainId: number;
  fromToken: string;
  toToken: string;
  fromAmount: string;
  toAmount: string;
  toAmountMin: string;
  bridgeFee: string;
  bridgeFeeUSD: number;
  estimatedTime: number; // seconds
  reliability: number; // 0-100
  data: any; // bridge-specific data
}

export interface DEXQuote {
  dexId: string;
  dexName: string;
  chainId: number;
  fromToken: string;
  toToken: string;
  fromAmount: string;
  toAmount: string;
  priceImpact: number;
  gasCost: string;
  gasPrice: string;
  path: string[]; // token addresses in path
  data: any; // dex-specific data
}

export interface ExecutionResult {
  success: boolean;
  routeId: string;
  transactions: TransactionRecord[];
  finalAmount?: string;
  error?: string;
  failedAtStep?: number;
}

export interface TransactionRecord {
  stepIndex: number;
  chainId: number;
  txHash: string;
  status: 'pending' | 'success' | 'failed';
  gasUsed?: string;
  timestamp: number;
}

export interface BridgeProvider {
  id: string;
  name: string;
  supportedChains: number[];
  getQuote(params: BridgeQuoteParams): Promise<BridgeQuote | null>;
  getBuildTx(quote: BridgeQuote, userAddress: string): Promise<any>;
  checkStatus(txHash: string, fromChainId: number): Promise<BridgeStatus>;
}

export interface BridgeQuoteParams {
  fromChainId: number;
  toChainId: number;
  fromToken: string;
  toToken: string;
  fromAmount: string;
  fromAddress: string;
  toAddress: string;
}

export interface BridgeStatus {
  status: 'pending' | 'completed' | 'failed';
  fromTxHash: string;
  toTxHash?: string;
  completedAt?: number;
  error?: string;
}

export interface PathFinderConfig {
  maxRoutes: number; // max routes to evaluate
  maxSteps: number; // max steps in a route
  minLiquidity: number; // minimum liquidity USD
  bridgeReliabilityWeight: number; // 0-1
  gasCostWeight: number; // 0-1
  executionTimeWeight: number; // 0-1
  priceImpactWeight: number; // 0-1
}

export enum ChainType {
  EVM = 'EVM',
  SOLANA = 'SOLANA',
  TRON = 'TRON',
  COSMOS = 'COSMOS',
  NEAR = 'NEAR'
}

export interface ChainConfig {
  chainId: number;
  name: string;
  type: ChainType;
  rpcUrl: string;
  nativeCurrency: {
    symbol: string;
    decimals: number;
  };
  blockExplorer: string;
  isTestnet: boolean;
}