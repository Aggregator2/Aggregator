import React, { useState, useEffect, useMemo, useRef } from 'react';
import styles from './TokenPicker.module.css';
import { Token } from '../types/wallet';
import { ALL_TOKENS, searchTokens } from './tokenData';

interface TokenPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onTokenSelect: (token: Token) => void;
  selectedToken?: Token;
  otherToken?: Token; // To prevent selecting the same token on both sides
  title?: string;
}

export const TokenPicker: React.FC<TokenPickerProps> = ({
  isOpen,
  onClose,
  onTokenSelect,
  selectedToken,
  otherToken,
  title = "Select a token"
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [allTokens, setAllTokens] = useState<Token[]>(ALL_TOKENS); // Initialize with static data
  const [comprehensiveTokens, setComprehensiveTokens] = useState<Token[]>([]);
  const [searchResults, setSearchResults] = useState<Token[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingComprehensive, setIsLoadingComprehensive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importAddress, setImportAddress] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [recentTokens, setRecentTokens] = useState<Token[]>([]);
  const [tokenStats, setTokenStats] = useState<any>(null);
  const [selectedChainId, setSelectedChainId] = useState<number>(1); // Default to Ethereum

  const searchInputRef = useRef<HTMLInputElement>(null);

  // Load recent tokens and comprehensive tokens on mount
  useEffect(() => {
    if (isOpen) {
      loadRecentTokens();
      loadComprehensiveTokens();
      // Focus search input when modal opens
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 100);
    }
  }, [isOpen]);

  // Reload tokens when chain changes
  useEffect(() => {
    if (isOpen) {
      loadComprehensiveTokens();
    }
  }, [selectedChainId]);

  // Instant client-side search
  useEffect(() => {
    if (searchQuery.trim()) {
      const results = searchTokens(searchQuery.trim());
      setSearchResults(results);
      
      // Show import option if query looks like an address and no results
      const isAddress = /^0x[a-fA-F0-9]{40}$/i.test(searchQuery);
      setShowImport(isAddress && results.length === 0);
    } else {
      setSearchResults([]);
      setError(null);
      setShowImport(false);
    }
  }, [searchQuery]);

  const loadComprehensiveTokens = async () => {
    try {
      setIsLoadingComprehensive(true);
      
      // Try comprehensive v2 API first, then fallback to v1, then static
      let response = await fetch(`/api/tokens/comprehensive-v2?limit=1000&chainId=${selectedChainId}&includeTopTokens=true&includeTrending=true`);
      
      // If v2 API fails, try v1
      if (!response.ok) {
        console.log('Comprehensive v2 API failed, trying v1...');
        response = await fetch(`/api/tokens/comprehensive?limit=1000&chainId=${selectedChainId}`);
      }
      
      // If both comprehensive APIs fail, use static fallback
      if (!response.ok || (await response.clone().json()).tokens.length === 0) {
        console.log('Comprehensive APIs failed or empty, using static fallback...');
        response = await fetch(`/api/tokens/static-comprehensive?limit=1000&chainId=${selectedChainId}`);
      }
      
      if (!response.ok) {
        throw new Error('Failed to load tokens');
      }
      
      const data = await response.json();
      
      if (data.tokens && data.tokens.length > 0) {
        // Merge with existing tokens, prioritizing new list
        const mergedTokens = [...data.tokens, ...allTokens];
        const uniqueTokens = Array.from(
          new Map(mergedTokens.map(token => [`${token.chainId}-${token.address.toLowerCase()}`, token])).values()
        );
        
        setAllTokens(uniqueTokens);
        setComprehensiveTokens(data.tokens);
        setTokenStats(data.stats);
        
        console.log(`Loaded ${data.tokens.length} tokens from ${data.metadata?.version || 'API'}`);
        console.log('Token sources:', data.metadata?.sources);
        console.log('Token stats:', data.stats);
        
        // Show capabilities if available
        if (data.metadata?.capabilities) {
          console.log('API capabilities:', data.metadata.capabilities);
        }
      }
      
    } catch (err) {
      console.error('Failed to load comprehensive tokens:', err);
      // Keep using static tokens as fallback
    } finally {
      setIsLoadingComprehensive(false);
    }
  };

  const loadRecentTokens = () => {
    try {
      const stored = localStorage.getItem('recentTokens');
      if (stored) {
        const recent = JSON.parse(stored);
        setRecentTokens(recent.slice(0, 5)); // Last 5 tokens
      }
    } catch (err) {
      console.error('Error loading recent tokens:', err);
    }
  };

  const saveRecentToken = (token: Token) => {
    try {
      const stored = localStorage.getItem('recentTokens');
      let recent: Token[] = stored ? JSON.parse(stored) : [];
      
      // Remove if already exists
      recent = recent.filter(t => t.address.toLowerCase() !== token.address.toLowerCase());
      
      // Add to beginning
      recent.unshift(token);
      
      // Keep only last 10
      recent = recent.slice(0, 10);
      
      localStorage.setItem('recentTokens', JSON.stringify(recent));
      setRecentTokens(recent.slice(0, 5));
    } catch (err) {
      console.error('Error saving recent token:', err);
    }
  };

  // No longer need performInstantSearch - using searchTokens from tokenData

  const handleTokenSelect = (token: Token) => {
    // Prevent selecting the same token on both sides
    if (otherToken && token.address.toLowerCase() === otherToken.address.toLowerCase()) {
      return;
    }
    
    saveRecentToken(token);
    onTokenSelect(token);
    onClose();
    setSearchQuery('');
    setSearchResults([]);
  };

  const handleImportToken = async () => {
    if (!importAddress.trim()) return;
    
    try {
      setIsLoading(true);
      setError(null);
      
      const response = await fetch('/api/tokens/import-token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          address: importAddress.trim(),
          chainId: selectedChainId,
          userAddress: 'anonymous' // Could be from wallet context
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Import failed');
      }
      
      const data = await response.json();
      
      // Add the imported token to our local list
      if (data.token) {
        setAllTokens(prevTokens => [data.token, ...prevTokens]);
        handleTokenSelect(data.token);
      }
      
    } catch (err: any) {
      console.error('Import error:', err);
      setError(err.message || 'Failed to import token');
    } finally {
      setIsLoading(false);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const tokensToDisplay = useMemo(() => {
    if (searchQuery.trim()) {
      return searchResults.filter(token => token.chainId === selectedChainId);
    }
    // Show tokens from selected chain
    const chainTokens = allTokens.filter(token => token.chainId === selectedChainId);
    return chainTokens.slice(0, 20);
  }, [searchQuery, searchResults, allTokens, selectedChainId]);

  const filteredTokens = useMemo(() => {
    return tokensToDisplay.filter(token => {
      // Filter out the other selected token
      if (otherToken && token.address.toLowerCase() === otherToken.address.toLowerCase()) {
        return false;
      }
      return true;
    });
  }, [tokensToDisplay, otherToken]);

  if (!isOpen) return null;

  return (
    <div className={styles.backdrop} onClick={handleBackdropClick}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title}>{title}</h2>
          <button 
            className={styles.closeButton}
            onClick={onClose}
            type="button"
          >
            ✕
          </button>
        </div>

        <div className={styles.searchContainer}>
          <div className={styles.chainSelector}>
            <select 
              value={selectedChainId} 
              onChange={(e) => {
                setSelectedChainId(Number(e.target.value));
                setSearchQuery(''); // Clear search when changing chains
              }}
              className={styles.chainSelect}
            >
              <option value={1}>🔷 Ethereum</option>
              <option value={56}>🟡 BSC</option>
              <option value={137}>🟣 Polygon</option>
              <option value={101}>🌞 Solana</option>
              <option value={43114}>🔺 Avalanche</option>
              <option value={42161}>🔵 Arbitrum</option>
              <option value={10}>🔴 Optimism</option>
              <option value={250}>👻 Fantom</option>
              <option value={195}>🅣 Tron</option>
            </select>
          </div>
          
          <div className={styles.searchWrapper}>
            <input
              ref={searchInputRef}
              type="text"
              placeholder={
                isLoadingComprehensive 
                  ? `Loading tokens...` 
                  : tokenStats && tokenStats.byChain[selectedChainId]
                    ? `Search ${tokenStats.byChain[selectedChainId].toLocaleString()} tokens`
                    : `Search tokens by name or address`
              }
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={styles.searchInput}
            />
            {(searchQuery || isLoadingComprehensive) && (
              <div className={styles.searchLoader}>
                {isLoadingComprehensive ? '⏳' : '🔍'}
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className={styles.error}>
            {error}
            <button 
              onClick={() => setError(null)}
              className={styles.dismissError}
            >
              ✕
            </button>
          </div>
        )}

        {/* Recent tokens */}
        {!searchQuery && recentTokens.length > 0 && (
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Recent</h3>
            <div className={styles.tokenList}>
              {recentTokens.map((token) => (
                <TokenRow
                  key={token.address}
                  token={token}
                  onSelect={handleTokenSelect}
                  isSelected={selectedToken?.address.toLowerCase() === token.address.toLowerCase()}
                  isDisabled={otherToken?.address.toLowerCase() === token.address.toLowerCase()}
                />
              ))}
            </div>
          </div>
        )}

        {/* Popular/Search results */}
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>
            {searchQuery ? `Search Results (${filteredTokens.length})` : 'Popular Tokens'}
          </h3>
          
          <div className={styles.tokenList}>
            {filteredTokens.length > 0 ? (
              filteredTokens.map((token) => (
                <TokenRow
                  key={`${token.chainId}-${token.address}`}
                  token={token}
                  onSelect={handleTokenSelect}
                  isSelected={selectedToken?.address.toLowerCase() === token.address.toLowerCase()}
                  isDisabled={otherToken?.address.toLowerCase() === token.address.toLowerCase()}
                />
              ))
            ) : searchQuery ? (
              <div className={styles.noResults}>
                No tokens found for "{searchQuery}"
              </div>
            ) : (
              <div className={styles.noResults}>
                No tokens available
              </div>
            )}
          </div>
        </div>

        {/* Import token */}
        {showImport && (
          <div className={styles.section}>
            <div className={styles.importContainer}>
              <div className={styles.importHeader}>
                <span>⚠️ Token not found</span>
              </div>
              <p className={styles.importText}>
                This token is not in our list. You can import it by pasting the contract address.
              </p>
              <div className={styles.importInputContainer}>
                <input
                  type="text"
                  placeholder="0x..."
                  value={importAddress}
                  onChange={(e) => setImportAddress(e.target.value)}
                  className={styles.importInput}
                />
                <button
                  onClick={handleImportToken}
                  disabled={!importAddress.trim() || isLoading}
                  className={styles.importButton}
                >
                  {isLoading ? 'Importing...' : 'Import'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

interface TokenRowProps {
  token: Token;
  onSelect: (token: Token) => void;
  isSelected: boolean;
  isDisabled: boolean;
}

const TokenRow: React.FC<TokenRowProps> = ({ 
  token, 
  onSelect, 
  isSelected, 
  isDisabled 
}) => {
  const handleClick = () => {
    if (!isDisabled) {
      onSelect(token);
    }
  };

  return (
    <div 
      className={`${
        styles.tokenRow
      } ${
        isSelected ? styles.selected : ''
      } ${
        isDisabled ? styles.disabled : ''
      }`}
      onClick={handleClick}
    >
      <div className={styles.tokenInfo}>
        <img 
          src={token.logoURI || '/images/fallback-token.png'}
          alt={token.symbol}
          className={styles.tokenIcon}
          onError={(e) => {
            const img = e.target as HTMLImageElement;
            if (!img.src.endsWith('/images/fallback-token.png')) {
              img.src = '/images/fallback-token.png';
            }
          }}
        />
        <div className={styles.tokenDetails}>
          <div className={styles.tokenSymbol}>{token.symbol}</div>
          <div className={styles.tokenName}>{token.name}</div>
        </div>
      </div>
      
      <div className={styles.tokenMeta}>
        {token.extensions?.verified && (
          <span className={styles.verifiedBadge} title="Verified token">
            ✓
          </span>
        )}
        {isSelected && (
          <span className={styles.selectedBadge}>✓</span>
        )}
      </div>
    </div>
  );
};

export default TokenPicker;