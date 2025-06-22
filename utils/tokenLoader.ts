/**
 * Token loading utilities that use the supported tokens API
 * to ensure only tokens supported by active quote APIs are shown
 */

import type { Token } from "../types/wallet";

// BSC token list override to prevent CoinGecko fallback for chain 56
const BSC_CURATED_TOKENS: Token[] = [
  {
    symbol: "BNB",
    name: "BNB",
    address: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
    decimals: 18,
    chainId: 56,
    type: "ERC-20",
    logoURI: "https://cryptologos.cc/logos/bnb-bnb-logo.png",
  },
  {
    symbol: "USDT",
    name: "Tether USD",
    address: "0x55d398326f99059fF775485246999027B3197955",
    decimals: 18,
    chainId: 56,
    type: "ERC-20",
    logoURI: "https://cryptologos.cc/logos/tether-usdt-logo.png",
  },
  {
    symbol: "USDC",
    name: "USD Coin",
    address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
    decimals: 18,
    chainId: 56,
    type: "ERC-20",
    logoURI: "https://cryptologos.cc/logos/usd-coin-usdc-logo.png",
  },
  {
    symbol: "BUSD",
    name: "Binance USD",
    address: "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56",
    decimals: 18,
    chainId: 56,
    type: "ERC-20",
    logoURI: "https://cryptologos.cc/logos/binance-usd-busd-logo.png",
  },
  {
    symbol: "CAKE",
    name: "PancakeSwap Token",
    address: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82",
    decimals: 18,
    chainId: 56,
    type: "ERC-20",
    logoURI: "https://cryptologos.cc/logos/pancakeswap-cake-logo.png",
  },
];

interface TokenListResponse {
  success: boolean;
  tokens: Token[];
  source: string;
}

/**
 * Load supported tokens for a given chain ID
 * Uses curated list for BSC (chain 56) to avoid CoinGecko fallback
 */
export async function loadSupportedTokens(chainId: number): Promise<Token[]> {
  try {
    // For BSC (chain 56), use curated list to prevent CoinGecko fallback
    if (chainId === 56) {
      // eslint-disable-next-line no-console
      console.log(
        "Using curated BSC token list (bypassing CoinGecko fallback)"
      );
      return BSC_CURATED_TOKENS;
    }

    // For other chains, fetch from supported tokens API
    const response = await fetch("/api/supported-tokens", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ chainId }),
    });

    if (!response.ok) {
      console.error(`Supported tokens API error: ${response.status}`);
      return getDefaultTokensForChain(chainId);
    }

    const data: TokenListResponse = await response.json();

    if (!data.success || !Array.isArray(data.tokens)) {
      console.error("Invalid response from supported tokens API");
      return getDefaultTokensForChain(chainId);
    }

    // eslint-disable-next-line no-console
    console.log(
      `Loaded ${data.tokens.length} supported tokens from ${data.source} for chain ${chainId}`
    );
    return data.tokens;
  } catch (error) {
    console.error("Failed to load supported tokens:", error);
    return getDefaultTokensForChain(chainId);
  }
}

/**
 * Get default tokens for a chain when API fails
 */
function getDefaultTokensForChain(chainId: number): Token[] {
  const defaultTokens: Record<number, Token[]> = {
    1: [
      // Ethereum
      {
        symbol: "WETH",
        name: "Wrapped Ethereum",
        address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
        decimals: 18,
        chainId: 1,
        type: "ERC-20",
        logoURI: "https://cryptologos.cc/logos/ethereum-eth-logo.png",
      },
      {
        symbol: "USDC",
        name: "USD Coin",
        address: "0xA0b86a33E6411B11E6063b95D0b8f3BcF9a24009",
        decimals: 6,
        chainId: 1,
        type: "ERC-20",
        logoURI: "https://cryptologos.cc/logos/usd-coin-usdc-logo.png",
      },
    ],
    56: BSC_CURATED_TOKENS, // BSC
    137: [
      // Polygon
      {
        symbol: "WMATIC",
        name: "Wrapped Matic",
        address: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",
        decimals: 18,
        chainId: 137,
        type: "ERC-20",
        logoURI: "https://cryptologos.cc/logos/polygon-matic-logo.png",
      },
      {
        symbol: "USDC",
        name: "USD Coin",
        address: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
        decimals: 6,
        chainId: 137,
        type: "ERC-20",
        logoURI: "https://cryptologos.cc/logos/usd-coin-usdc-logo.png",
      },
    ],
  };

  return defaultTokens[chainId] || [];
}

/**
 * Load tokens for multiple chains
 */
export async function loadTokensForChains(
  chainIds: number[]
): Promise<Record<number, Token[]>> {
  const results: Record<number, Token[]> = {};

  const promises = chainIds.map(async (chainId) => {
    const tokens = await loadSupportedTokens(chainId);
    results[chainId] = tokens;
  });

  await Promise.all(promises);
  return results;
}

/**
 * Validate if a token is supported by checking against the supported tokens list
 */
export async function isTokenSupported(token: Token): Promise<boolean> {
  if (!token.chainId) return false;

  const supportedTokens = await loadSupportedTokens(token.chainId);
  return supportedTokens.some(
    (supportedToken) =>
      supportedToken.address.toLowerCase() === token.address.toLowerCase()
  );
}

/**
 * Filter token list to only include supported tokens
 */
export async function filterUnsupportedTokens(tokens: Token[]): Promise<{
  supported: Token[];
  removed: Token[];
}> {
  const supported: Token[] = [];
  const removed: Token[] = [];

  for (const token of tokens) {
    const isSupported = await isTokenSupported(token);
    if (isSupported) {
      supported.push(token);
    } else {
      removed.push(token);
    }
  }

  if (removed.length > 0) {
    // eslint-disable-next-line no-console
    console.log(
      `Removed ${removed.length} unsupported tokens:`,
      removed.map((t) => t.symbol)
    );
  }

  return { supported, removed };
}
