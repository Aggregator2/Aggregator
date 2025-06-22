import { ethers } from 'ethers';
import { CrossChainSwapRequest } from './types';

export async function validateSwapRequest(request: CrossChainSwapRequest): Promise<{
  valid: boolean;
  error?: string;
}> {
  // Basic validation
  if (!request.sourceChainId || !request.destinationChainId) {
    return { valid: false, error: 'Missing chain IDs' };
  }

  if (!request.sourceToken || !request.destinationToken) {
    return { valid: false, error: 'Missing token addresses' };
  }

  if (!request.sourceAmount || BigInt(request.sourceAmount) <= 0n) {
    return { valid: false, error: 'Invalid source amount' };
  }

  // Check recipient address (skip for native tokens as they use special addresses)
  const isNativeToken = (addr: string) => 
    addr.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' || 
    addr === ethers.ZeroAddress;
  
  if (!isNativeToken(request.sourceToken) && !ethers.isAddress(request.sourceToken)) {
    return { valid: false, error: 'Invalid source token address' };
  }
  
  if (!isNativeToken(request.destinationToken) && !ethers.isAddress(request.destinationToken)) {
    return { valid: false, error: 'Invalid destination token address' };
  }
  
  if (!ethers.isAddress(request.recipientAddress)) {
    return { valid: false, error: 'Invalid recipient address' };
  }

  // Validate slippage tolerance
  if (request.slippageTolerance !== undefined) {
    if (request.slippageTolerance < 0 || request.slippageTolerance > 5000) {
      return { valid: false, error: 'Slippage tolerance must be between 0 and 5000 basis points' };
    }
  }

  return { valid: true };
}

export function calculatePriceImpact(
  inputAmount: string,
  outputAmount: string,
  inputPriceUSD: number,
  outputPriceUSD: number
): number {
  const inputValueUSD = parseFloat(inputAmount) * inputPriceUSD;
  const outputValueUSD = parseFloat(outputAmount) * outputPriceUSD;
  
  if (inputValueUSD === 0) return 0;
  
  const impact = ((inputValueUSD - outputValueUSD) / inputValueUSD) * 10000; // basis points
  return Math.max(0, impact);
}

export async function estimateGasCost(
  stepType: 'swap' | 'bridge' | 'approval',
  chainId: number
): Promise<string> {
  // Estimated gas units for different operations
  const gasEstimates: Record<string, number> = {
    'swap': 200000,      // Typical DEX swap
    'bridge': 300000,    // Bridge transaction
    'approval': 50000    // Token approval
  };

  return gasEstimates[stepType]?.toString() || '200000';
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function createRetryWithBackoff(
  fn: (...args: any[]) => Promise<any>,
  maxRetries: number = 3,
  baseDelay: number = 1000
) {
  return async (...args: any[]) => {
    let lastError;
    
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await fn(...args);
      } catch (error) {
        lastError = error;
        
        if (i < maxRetries - 1) {
          const delay = baseDelay * Math.pow(2, i);
          await sleep(delay);
        }
      }
    }
    
    throw lastError;
  };
}

export function formatTokenAmount(
  amount: string,
  decimals: number,
  displayDecimals: number = 6
): string {
  const formatted = ethers.formatUnits(amount, decimals);
  const [whole, decimal] = formatted.split('.');
  
  if (!decimal) return whole;
  
  return `${whole}.${decimal.slice(0, displayDecimals)}`;
}

export function parseTokenAmount(
  amount: string,
  decimals: number
): string {
  return ethers.parseUnits(amount, decimals).toString();
}

export function calculateMinimumAmountOut(
  expectedAmount: string,
  slippageBps: number
): string {
  const expected = BigInt(expectedAmount);
  const slippage = expected * BigInt(slippageBps) / 10000n;
  return (expected - slippage).toString();
}

export function isNativeToken(tokenAddress: string): boolean {
  return tokenAddress === ethers.ZeroAddress || 
         tokenAddress.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
}

export function getWrappedNativeToken(chainId: number): string {
  const wrappedTokens: Record<number, string> = {
    1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',     // WETH
    56: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',    // WBNB
    137: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',   // WMATIC
    42161: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', // WETH
    10: '0x4200000000000000000000000000000000000006',     // WETH
    43114: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7', // WAVAX
    250: '0x21be370D5312f44cB42ce377BC9b8a0cEF1A4C83'    // WFTM
  };

  return wrappedTokens[chainId] || ethers.ZeroAddress;
}

export interface RouteMetrics {
  totalFeeUSD: number;
  totalGasCostUSD: number;
  estimatedTime: number;
  priceImpact: number;
  reliability: number;
  numberOfSteps: number;
  bridgesUsed: string[];
  dexesUsed: string[];
}

export function analyzeRoute(route: any): RouteMetrics {
  const bridgesUsed = new Set<string>();
  const dexesUsed = new Set<string>();
  
  for (const step of route.steps) {
    if (step.type === 'bridge') {
      bridgesUsed.add(step.protocol);
    } else if (step.type === 'swap') {
      dexesUsed.add(step.protocol);
    }
  }

  return {
    totalFeeUSD: route.totalFeeUSD,
    totalGasCostUSD: route.totalGasCostUSD,
    estimatedTime: route.estimatedTime,
    priceImpact: route.priceImpact,
    reliability: route.reliability,
    numberOfSteps: route.steps.length,
    bridgesUsed: Array.from(bridgesUsed),
    dexesUsed: Array.from(dexesUsed)
  };
}

export function compareRoutes(routeA: any, routeB: any): number {
  // Compare by output amount (higher is better)
  const outputDiff = parseFloat(routeB.estimatedOutput) - parseFloat(routeA.estimatedOutput);
  if (outputDiff !== 0) return outputDiff > 0 ? 1 : -1;

  // Compare by total cost (lower is better)
  const costA = routeA.totalFeeUSD + routeA.totalGasCostUSD;
  const costB = routeB.totalFeeUSD + routeB.totalGasCostUSD;
  const costDiff = costA - costB;
  if (costDiff !== 0) return costDiff > 0 ? 1 : -1;

  // Compare by time (faster is better)
  return routeA.estimatedTime - routeB.estimatedTime;
}