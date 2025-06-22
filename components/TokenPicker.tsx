import React, { useState, useEffect, useMemo, useRef } from 'react';
import styles from './TokenPicker.module.css';
import { Token } from '../types/wallet';
import { lifiService } from '../src/services/lifiService';
import { isTokenBlacklisted } from '../src/config/tokenRegistry';
import { TokenMonitoringService } from '../src/services/tokenMonitoringService';
import { tokenLogger } from '../src/utils/devLogger';

interface TokenPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onTokenSelect: (token: Token) => void;
  selectedToken?: Token;
  otherToken?: Token; // To prevent selecting the same token on both sides
  title?: string;
}

// Popular tokens to show first
const POPULAR_TOKENS = ['ETH', 'WETH', 'USDC', 'USDT', 'DAI', 'WBTC', 'UNI', 'LINK', 'AAVE', 'MATIC'];

// Chain info - All 47 chains supported by LiFi
export const CHAIN_INFO: Record<number, { name: string; logo: string }> = {
  // Major EVM Chains
  1: { name: 'Ethereum', logo: '⟠' },
  56: { name: 'BSC', logo: '🔶' },
  137: { name: 'Polygon', logo: '🟣' },
  42161: { name: 'Arbitrum', logo: '🔷' },
  10: { name: 'Optimism', logo: '🔴' },
  43114: { name: 'Avalanche', logo: '🔺' },
  250: { name: 'Fantom', logo: '👻' },
  8453: { name: 'Base', logo: '🔵' },
  
  // Layer 2s and Sidechains
  100: { name: 'Gnosis', logo: '🦉' },
  1284: { name: 'Moonbeam', logo: '🌙' },
  1285: { name: 'Moonriver', logo: '🌘' },
  1313161554: { name: 'Aurora', logo: '🌅' },
  42220: { name: 'Celo', logo: '🟨' },
  
  // zkEVM Chains
  324: { name: 'zkSync', logo: '⚡' },
  1101: { name: 'Polygon zkEVM', logo: '🟪' },
  534352: { name: 'Scroll', logo: '📜' },
  59144: { name: 'Linea', logo: '🔗' },
  
  // Newer Chains
  81457: { name: 'Blast', logo: '💥' },
  34443: { name: 'Mode', logo: '🟢' },
  167000: { name: 'Taiko', logo: '⛩️' },
  5000: { name: 'Mantle', logo: '🛡️' },
  
  // Alternative L1s
  25: { name: 'Cronos', logo: '💎' },
  122: { name: 'FUSE', logo: '🔥' },
  288: { name: 'Boba', logo: '🫧' },
  1088: { name: 'Metis', logo: '🏛️' },
  8217: { name: 'Kaia', logo: '🎋' },
  
  // New/Emerging Chains
  146: { name: 'Sonic', logo: '🎵' },
  204: { name: 'opBNB', logo: '🟡' },
  232: { name: 'Lens', logo: '🌿' },
  480: { name: 'World Chain', logo: '🌍' },
  999: { name: 'HyperEVM', logo: '🚀' },
  1135: { name: 'Lisk', logo: '📐' },
  1329: { name: 'Sei', logo: '🌊' },
  1625: { name: 'Gravity', logo: '🪐' },
  1868: { name: 'Soneium', logo: '🎮' },
  1923: { name: 'Swellchain', logo: '🌊' },
  2741: { name: 'Abstract', logo: '🎨' },
  13371: { name: 'Immutable zkEVM', logo: '♾️' },
  21000000: { name: 'Corn', logo: '🌽' },
  30: { name: 'Rootstock', logo: '🌳' },
  33139: { name: 'Apechain', logo: '🦍' },
  50: { name: 'XDC', logo: '❌' },
  55244: { name: 'Superposition', logo: '🔀' },
  57073: { name: 'Ink', logo: '🖋️' },
  60808: { name: 'BOB', logo: '🤖' },
  80094: { name: 'Berachain', logo: '🐻' },
  130: { name: 'Unichain', logo: '🦄' },
  
  // Non-EVM Chains
  195: { name: 'Tron', logo: '🔷' },
  101: { name: 'Solana', logo: '☀️' },
};

export const TokenPicker: React.FC<TokenPickerProps> = ({
  isOpen,
  onClose,
  onTokenSelect,
  selectedToken,
  otherToken,
  title = "Select a token"
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [allTokens, setAllTokens] = useState<Token[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedChain, setSelectedChain] = useState<number | 'all'>('all');
  const [tokensByChain, setTokensByChain] = useState<Map<number, Token[]>>(new Map());

  const searchInputRef = useRef<HTMLInputElement>(null);

  // Load all tokens from LI.FI when modal opens
  useEffect(() => {
    if (isOpen) {
      loadLifiTokens();
      // Focus search input when modal opens
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 100);
    }
  }, [isOpen]);

  // Get filtered and sorted tokens
  const displayTokens = useMemo(() => {
    let tokens = allTokens;
    
    // Filter by chain if not 'all'
    if (selectedChain !== 'all') {
      tokens = tokens.filter(token => token.chainId === selectedChain);
    }
    
    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      tokens = tokens.filter(
        token =>
          token.symbol.toLowerCase().includes(query) ||
          token.name.toLowerCase().includes(query) ||
          token.address.toLowerCase().includes(query)
      );
    }
    
    // Sort tokens
    tokens.sort((a, b) => {
      // Popular tokens first
      const aPopular = POPULAR_TOKENS.includes(a.symbol.toUpperCase());
      const bPopular = POPULAR_TOKENS.includes(b.symbol.toUpperCase());
      
      if (aPopular && !bPopular) return -1;
      if (!aPopular && bPopular) return 1;
      
      // If both popular, sort by popularity order
      if (aPopular && bPopular) {
        const aIndex = POPULAR_TOKENS.indexOf(a.symbol.toUpperCase());
        const bIndex = POPULAR_TOKENS.indexOf(b.symbol.toUpperCase());
        return aIndex - bIndex;
      }
      
      // Then alphabetically by symbol
      return a.symbol.localeCompare(b.symbol);
    });
    
    return tokens;
  }, [allTokens, selectedChain, searchQuery]);

  const loadLifiTokens = async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      // First try to use cached tokens from monitoring service
      const cachedTokens = TokenMonitoringService.getCachedTokens();
      
      if (cachedTokens.size > 0) {
        // Use cached tokens for instant loading
        tokenLogger.info('Using cached tokens from monitoring service');
        processCachedTokens(cachedTokens);
        
        // Check if cache needs update in background
        if (TokenMonitoringService.needsUpdate()) {
          tokenLogger.info('Cache is stale, updating in background...');
          TokenMonitoringService.forceUpdate().then(() => {
            // Reload with fresh data
            const freshTokens = TokenMonitoringService.getCachedTokens();
            processCachedTokens(freshTokens);
          });
        }
      } else {
        // No cache, load directly from LI.FI
        tokenLogger.info('No cached tokens, loading from LI.FI...');
        const chains = await lifiService.getChains();
        tokenLogger.info(`Loading tokens from ${chains.length} chains...`);
        
        // Get tokens from all chains
        const allTokensMap = await lifiService.getAllTokens();
        processCachedTokens(allTokensMap);
      }
      
    } catch (error) {
      tokenLogger.error('Failed to load LI.FI tokens:', error);
      setError('Failed to load tokens. Please try again.');
      
      // Try to use cached tokens as fallback from all chains
      const cachedTokens = lifiService.getCachedTokens();
      if (cachedTokens.length > 0) {
        const tokens: Token[] = cachedTokens.map(token => ({
          symbol: token.symbol,
          name: token.name,
          address: token.address,
          logoURI: token.logoURI || '/fallback.svg',
          chainId: token.chainId,
          decimals: token.decimals,
          type: 'ERC-20' as const,
          tags: []
        }));
        setAllTokens(tokens);
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Process tokens from cache or API
  const processCachedTokens = (tokensMap: Map<number, any[]>) => {
    const allTokensArray: Token[] = [];
    const chainMap = new Map<number, Token[]>();
    
    tokensMap.forEach((chainTokens, chainId) => {
      const mappedTokens = chainTokens.map(token => ({
        symbol: token.symbol,
        name: token.name,
        address: token.address,
        logoURI: token.logoURI || '/fallback.svg',
        chainId: token.chainId || chainId,
        decimals: token.decimals,
        type: 'ERC-20' as const,
        tags: []
      }));
      
      // Store tokens by chain
      chainMap.set(chainId, mappedTokens);
      allTokensArray.push(...mappedTokens);
    });
    
    // Remove duplicates based on address + chainId combination
    const uniqueTokens = Array.from(
      new Map(allTokensArray.map(token => [`${token.address}-${token.chainId}`, token])).values()
    );
    
    // Filter out blacklisted tokens
    const safeTokens = uniqueTokens.filter(token => 
      !isTokenBlacklisted(token.address, token.chainId)
    );
    
    setTokensByChain(chainMap);
    setAllTokens(safeTokens);
    
    tokenLogger.info(`Loaded ${safeTokens.length} safe tokens from ${tokensMap.size} chains`);
  };

  const handleTokenSelect = (token: Token) => {
    onTokenSelect(token);
    setSearchQuery('');
    onClose();
  };
  
  // Get ALL chains from CHAIN_INFO, not just ones with tokens
  const availableChains = useMemo(() => {
    // Get all chain IDs from CHAIN_INFO
    const allChainIds = Object.keys(CHAIN_INFO).map(Number);
    
    // Sort by popularity - major chains first
    return allChainIds.sort((a, b) => {
      const order = [
        1, // Ethereum
        56, // BSC
        137, // Polygon
        42161, // Arbitrum
        10, // Optimism
        8453, // Base
        43114, // Avalanche
        250, // Fantom
        324, // zkSync
        534352, // Scroll
        59144, // Linea
        100, // Gnosis
        42220, // Celo
        1284, // Moonbeam
        5000, // Mantle
        25, // Cronos
        999, // HyperEVM
        // Add more chains in priority order as needed
      ];
      const aIndex = order.indexOf(a);
      const bIndex = order.indexOf(b);
      if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;
      return a - b;
    });
  }, []); // No dependency on tokensByChain - show all chains always

  if (!isOpen) return null;

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>{title}</h2>
          <button className={styles.closeButton} onClick={onClose}>
            <span className={styles.closeIcon}>×</span>
          </button>
        </div>
        
        <div className={styles.searchContainer}>
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search by name or paste address"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={styles.searchInput}
          />
          
          {/* Chain filter pills */}
          <div className={styles.chainFilter}>
            <button
              className={`${styles.chainPill} ${selectedChain === 'all' ? styles.active : ''}`}
              onClick={() => setSelectedChain('all')}
            >
              All Chains
            </button>
            {availableChains.map(chainId => (
              <button
                key={chainId}
                className={`${styles.chainPill} ${selectedChain === chainId ? styles.active : ''}`}
                onClick={() => setSelectedChain(chainId)}
              >
                {CHAIN_INFO[chainId]?.logo} {CHAIN_INFO[chainId]?.name || `Chain ${chainId}`}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.divider} />

        {/* Popular tokens section */}
        {!searchQuery && selectedChain === 'all' && (
          <div className={styles.popularSection}>
            <div className={styles.sectionTitle}>Popular tokens</div>
            <div className={styles.popularTokens}>
              {displayTokens.slice(0, 6).map((token) => (
                <button
                  key={`popular-${token.chainId}-${token.address}`}
                  className={styles.popularToken}
                  onClick={() => handleTokenSelect(token)}
                >
                  <img 
                    src={token.logoURI} 
                    alt={token.symbol}
                    className={styles.popularTokenIcon}
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = '/fallback.svg';
                    }}
                  />
                  <span>{token.symbol}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className={styles.tokenListWrapper}>
          <div className={styles.tokenList}>
            {isLoading ? (
              <div className={styles.loading}>
                <div className={styles.spinner} />
                <p>Loading tokens...</p>
              </div>
            ) : error ? (
              <div className={styles.error}>
                <p>{error}</p>
                <button onClick={loadLifiTokens} className={styles.retryButton}>
                  Try Again
                </button>
              </div>
            ) : displayTokens.length === 0 ? (
              <div className={styles.noResults}>
                {searchQuery 
                  ? 'No tokens found' 
                  : selectedChain !== 'all' 
                    ? `No tokens loaded for ${CHAIN_INFO[selectedChain]?.name || 'this chain'} yet`
                    : 'No tokens available'}
              </div>
            ) : (
              displayTokens.map((token) => {
                const isSelected = selectedToken?.address.toLowerCase() === token.address.toLowerCase() && 
                                  selectedToken?.chainId === token.chainId;
                const isOtherToken = otherToken?.address.toLowerCase() === token.address.toLowerCase() && 
                                     otherToken?.chainId === token.chainId;
                
                return (
                  <button
                    key={`${token.chainId}-${token.address}`}
                    className={`${styles.tokenRow} ${isSelected ? styles.selected : ''} ${isOtherToken ? styles.disabled : ''}`}
                    onClick={() => !isOtherToken && handleTokenSelect(token)}
                    disabled={isOtherToken}
                  >
                    <div className={styles.tokenLeft}>
                      <img 
                        src={token.logoURI || '/fallback.svg'} 
                        alt={token.symbol}
                        className={styles.tokenIcon}
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = '/fallback.svg';
                        }}
                      />
                      <div className={styles.tokenInfo}>
                        <div className={styles.tokenSymbol}>{token.symbol}</div>
                        <div className={styles.tokenName}>{token.name}</div>
                      </div>
                    </div>
                    <div className={styles.tokenRight}>
                      <div className={styles.chainBadge}>
                        {CHAIN_INFO[token.chainId]?.logo} {CHAIN_INFO[token.chainId]?.name || `Chain ${token.chainId}`}
                      </div>
                      {isOtherToken && (
                        <div className={styles.selectedBadge}>Selected</div>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
        
        {/* Token count */}
        <div className={styles.footer}>
          <div className={styles.tokenCount}>
            {displayTokens.length} tokens {selectedChain !== 'all' && `on ${CHAIN_INFO[selectedChain]?.name}`}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TokenPicker;