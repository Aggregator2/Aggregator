// Client-side token data for instant loading
import { getAllPopularTokens } from '../src/config/tokens/popularTokens';

// Export tokens for direct import in components
export const ALL_TOKENS = getAllPopularTokens();

// Pre-compute lowercase values for faster search
export const TOKENS_WITH_SEARCH_DATA = ALL_TOKENS.map(token => ({
  ...token,
  _searchData: {
    symbol: token.symbol.toLowerCase(),
    name: token.name.toLowerCase(),
    address: token.address.toLowerCase()
  }
}));

// Group tokens by chain for faster filtering
export const TOKENS_BY_CHAIN = ALL_TOKENS.reduce((acc, token) => {
  if (!acc[token.chainId]) {
    acc[token.chainId] = [];
  }
  acc[token.chainId].push(token);
  return acc;
}, {} as Record<number, typeof ALL_TOKENS>);

// Export search function for instant client-side search
export function searchTokens(query: string, chainId?: number) {
  const lowerQuery = query.toLowerCase();
  
  // Default to Ethereum tokens if no chainId specified
  let tokens = chainId ? (TOKENS_BY_CHAIN[chainId] || []) : (TOKENS_BY_CHAIN[1] || ALL_TOKENS);
  
  if (!query) return tokens.slice(0, 20); // Return top 20 if no query
  
  const results = tokens.filter(token => {
    const symbolMatch = token.symbol.toLowerCase().includes(lowerQuery);
    const nameMatch = token.name.toLowerCase().includes(lowerQuery);
    const addressMatch = token.address.toLowerCase().includes(lowerQuery);
    
    return symbolMatch || nameMatch || addressMatch;
  });
  
  // Sort by relevance
  return results.sort((a, b) => {
    const aSymbol = a.symbol.toLowerCase();
    const bSymbol = b.symbol.toLowerCase();
    const aName = a.name.toLowerCase();
    const bName = b.name.toLowerCase();
    
    // Exact symbol match first
    if (aSymbol === lowerQuery && bSymbol !== lowerQuery) return -1;
    if (bSymbol === lowerQuery && aSymbol !== lowerQuery) return 1;
    
    // Symbol starts with query
    if (aSymbol.startsWith(lowerQuery) && !bSymbol.startsWith(lowerQuery)) return -1;
    if (bSymbol.startsWith(lowerQuery) && !aSymbol.startsWith(lowerQuery)) return 1;
    
    // Name starts with query
    if (aName.startsWith(lowerQuery) && !bName.startsWith(lowerQuery)) return -1;
    if (bName.startsWith(lowerQuery) && !aName.startsWith(lowerQuery)) return 1;
    
    // Alphabetical by symbol
    return aSymbol.localeCompare(bSymbol);
  });
}