import { enhancedLifiTokenService, EnhancedToken } from '../enhancedLifiTokenService';
import { lifiService } from '../lifiService';
import { FALLBACK_TOKENS, getFallbackTokensForChain } from '../../config/tokenRegistry';

// Mock LiFi service
jest.mock('../lifiService', () => ({
  lifiService: {
    getAllTokens: jest.fn(),
    getTokens: jest.fn(),
    getChains: jest.fn()
  }
}));

const mockLifiService = lifiService as jest.Mocked<typeof lifiService>;

describe('EnhancedLiFiTokenService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    enhancedLifiTokenService.clearCache();
  });

  describe('Fallback Integration', () => {
    it('should return fallback tokens when LiFi fails', async () => {
      // Mock LiFi failure
      mockLifiService.getAllTokens.mockRejectedValue(new Error('LiFi API Error'));
      
      const tokens = await enhancedLifiTokenService.getAllTokens({
        chains: [1], // Ethereum
        includeWarnings: false
      });
      
      // Should have fallback tokens for Ethereum
      expect(tokens.length).toBeGreaterThan(0);
      expect(tokens.some(t => t.symbol === 'ETH')).toBe(true);
      expect(tokens.some(t => t.symbol === 'WETH')).toBe(true);
      expect(tokens.some(t => t.symbol === 'USDC')).toBe(true);
      expect(tokens.every(t => t.source === 'Fallback')).toBe(true);
    });

    it('should merge LiFi tokens with fallback tokens', async () => {
      // Mock successful LiFi response with limited tokens
      const mockLifiTokens = new Map([
        [1, [
          {
            address: '0x1234567890123456789012345678901234567890', // Custom token
            symbol: 'CUSTOM',
            name: 'Custom Token',
            decimals: 18,
            chainId: 1,
            logoURI: 'https://example.com/logo.png'
          }
        ]]
      ]);
      
      mockLifiService.getAllTokens.mockResolvedValue(mockLifiTokens);
      
      const tokens = await enhancedLifiTokenService.getAllTokens({
        chains: [1],
        includeWarnings: false
      });
      
      // Should have both LiFi custom token and fallback tokens
      expect(tokens.some(t => t.symbol === 'CUSTOM' && t.source === 'LiFi')).toBe(true);
      expect(tokens.some(t => t.symbol === 'ETH' && t.source === 'Fallback')).toBe(true);
      expect(tokens.some(t => t.symbol === 'USDC' && t.source === 'Fallback')).toBe(true);
    });

    it('should not duplicate tokens that exist in both LiFi and fallback', async () => {
      // Mock LiFi response with ETH (which also exists in fallback)
      const mockLifiTokens = new Map([
        [1, [
          {
            address: '0x0000000000000000000000000000000000000000', // ETH
            symbol: 'ETH',
            name: 'Ethereum',
            decimals: 18,
            chainId: 1,
            logoURI: 'https://ethereum.org/logo.png'
          }
        ]]
      ]);
      
      mockLifiService.getAllTokens.mockResolvedValue(mockLifiTokens);
      
      const tokens = await enhancedLifiTokenService.getAllTokens({
        chains: [1],
        includeWarnings: false
      });
      
      // Should have only one ETH token (from LiFi, not duplicated from fallback)
      const ethTokens = tokens.filter(t => t.symbol === 'ETH');
      expect(ethTokens).toHaveLength(1);
      expect(ethTokens[0].source).toBe('LiFi');
    });
  });

  describe('Token Metadata Enhancement', () => {
    it('should add warning information to tokens', async () => {
      mockLifiService.getAllTokens.mockResolvedValue(new Map());
      
      const tokens = await enhancedLifiTokenService.getAllTokens({
        chains: [1],
        includeWarnings: true
      });
      
      // USDT should have warnings about special approval
      const usdtToken = tokens.find(t => t.symbol === 'USDT');
      expect(usdtToken).toBeDefined();
      expect(usdtToken!.warnings).toBeDefined();
      expect(usdtToken!.warnings!.length).toBeGreaterThan(0);
    });

    it('should mark native and wrapped native tokens correctly', async () => {
      mockLifiService.getAllTokens.mockResolvedValue(new Map());
      
      const tokens = await enhancedLifiTokenService.getAllTokens({
        chains: [1],
        includeWarnings: false
      });
      
      const ethToken = tokens.find(t => t.symbol === 'ETH');
      const wethToken = tokens.find(t => t.symbol === 'WETH');
      
      expect(ethToken?.isNative).toBe(true);
      expect(ethToken?.isWrappedNative).toBe(false);
      expect(wethToken?.isNative).toBe(false);
      expect(wethToken?.isWrappedNative).toBe(true);
    });

    it('should filter out blacklisted tokens by default', async () => {
      mockLifiService.getAllTokens.mockResolvedValue(new Map());
      
      const tokens = await enhancedLifiTokenService.getAllTokens({
        chains: [1],
        includeBlacklisted: false
      });
      
      // Should not contain any blacklisted tokens
      expect(tokens.every(t => !t.isBlacklisted)).toBe(true);
    });

    it('should include blacklisted tokens when requested', async () => {
      mockLifiService.getAllTokens.mockResolvedValue(new Map());
      
      const tokensWithBlacklisted = await enhancedLifiTokenService.getAllTokens({
        chains: [1],
        includeBlacklisted: true
      });
      
      const tokensWithoutBlacklisted = await enhancedLifiTokenService.getAllTokens({
        chains: [1],
        includeBlacklisted: false
      });
      
      // Should have more tokens when including blacklisted
      expect(tokensWithBlacklisted.length).toBeGreaterThanOrEqual(tokensWithoutBlacklisted.length);
    });
  });

  describe('Token Prioritization', () => {
    it('should sort tokens with native first, then wrapped native', async () => {
      mockLifiService.getAllTokens.mockResolvedValue(new Map());
      
      const tokens = await enhancedLifiTokenService.getTokensForChain(1, {
        includeWarnings: false
      });
      
      // Find positions of key tokens
      const ethIndex = tokens.findIndex(t => t.symbol === 'ETH');
      const wethIndex = tokens.findIndex(t => t.symbol === 'WETH');
      const usdcIndex = tokens.findIndex(t => t.symbol === 'USDC');
      
      // ETH (native) should come before WETH (wrapped native)
      expect(ethIndex).toBeLessThan(wethIndex);
      // WETH should come before USDC (stablecoin)
      expect(wethIndex).toBeLessThan(usdcIndex);
    });
  });

  describe('Chain-specific Operations', () => {
    it('should handle multiple chains correctly', async () => {
      mockLifiService.getAllTokens.mockResolvedValue(new Map());
      
      const ethereumTokens = await enhancedLifiTokenService.getTokensForChain(1);
      const polygonTokens = await enhancedLifiTokenService.getTokensForChain(137);
      
      // Should have different native tokens
      expect(ethereumTokens.some(t => t.symbol === 'ETH' && t.isNative)).toBe(true);
      expect(polygonTokens.some(t => t.symbol === 'MATIC' && t.isNative)).toBe(true);
      
      // Ethereum shouldn't have MATIC
      expect(ethereumTokens.some(t => t.symbol === 'MATIC')).toBe(false);
      // Polygon shouldn't have ETH as native
      expect(polygonTokens.some(t => t.symbol === 'ETH' && t.isNative)).toBe(false);
    });

    it('should provide fallback tokens for all supported chains', async () => {
      mockLifiService.getAllTokens.mockRejectedValue(new Error('API Error'));
      
      const supportedChains = [1, 56, 137, 42161, 10]; // Major chains
      
      for (const chainId of supportedChains) {
        const tokens = await enhancedLifiTokenService.getTokensForChain(chainId);
        expect(tokens.length).toBeGreaterThan(0);
        
        // Should have at least a native token
        const hasNativeToken = tokens.some(t => t.isNative);
        expect(hasNativeToken).toBe(true);
      }
    });
  });

  describe('Search and Lookup', () => {
    it('should search tokens by symbol', async () => {
      mockLifiService.getAllTokens.mockResolvedValue(new Map());
      
      const usdcTokens = await enhancedLifiTokenService.searchTokens('USDC', 1);
      
      expect(usdcTokens.length).toBeGreaterThan(0);
      expect(usdcTokens.every(t => t.symbol.includes('USDC'))).toBe(true);
    });

    it('should find token by address', async () => {
      mockLifiService.getAllTokens.mockResolvedValue(new Map());
      
      const usdcAddress = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
      const token = await enhancedLifiTokenService.getTokenByAddress(usdcAddress, 1);
      
      expect(token).toBeDefined();
      expect(token!.symbol).toBe('USDC');
      expect(token!.address.toLowerCase()).toBe(usdcAddress.toLowerCase());
    });

    it('should return popular tokens in correct order', async () => {
      mockLifiService.getAllTokens.mockResolvedValue(new Map());
      
      const popularTokens = await enhancedLifiTokenService.getPopularTokens(1, 5);
      
      expect(popularTokens.length).toBeLessThanOrEqual(5);
      
      // First token should be native
      expect(popularTokens[0].isNative).toBe(true);
      
      // Should contain major tokens
      const symbols = popularTokens.map(t => t.symbol);
      expect(symbols).toContain('ETH');
    });
  });

  describe('Caching', () => {
    it('should cache tokens and return cached data on subsequent calls', async () => {
      mockLifiService.getAllTokens.mockResolvedValue(new Map());
      
      // First call
      await enhancedLifiTokenService.getAllTokens({ chains: [1] });
      expect(mockLifiService.getAllTokens).toHaveBeenCalledTimes(1);
      
      // Second call should use cache
      await enhancedLifiTokenService.getAllTokens({ chains: [1] });
      expect(mockLifiService.getAllTokens).toHaveBeenCalledTimes(1);
    });

    it('should refresh cache when forced', async () => {
      mockLifiService.getAllTokens.mockResolvedValue(new Map());
      
      // First call
      await enhancedLifiTokenService.getAllTokens({ chains: [1] });
      expect(mockLifiService.getAllTokens).toHaveBeenCalledTimes(1);
      
      // Force refresh
      await enhancedLifiTokenService.getAllTokens({ 
        chains: [1], 
        forceRefresh: true 
      });
      expect(mockLifiService.getAllTokens).toHaveBeenCalledTimes(2);
    });

    it('should provide cache statistics', async () => {
      mockLifiService.getAllTokens.mockResolvedValue(new Map());
      
      // Load some tokens
      await enhancedLifiTokenService.getAllTokens({ chains: [1, 137] });
      
      const stats = enhancedLifiTokenService.getCacheStats();
      
      expect(stats.totalTokens).toBeGreaterThan(0);
      expect(stats.chainCount).toBeGreaterThanOrEqual(2);
      expect(stats.tokensByChain[1]).toBeGreaterThan(0);
      expect(stats.tokensByChain[137]).toBeGreaterThan(0);
    });
  });

  describe('Error Handling', () => {
    it('should gracefully handle LiFi service errors', async () => {
      mockLifiService.getAllTokens.mockRejectedValue(new Error('Network error'));
      
      // Should not throw, should return fallback tokens
      const tokens = await enhancedLifiTokenService.getAllTokens({ chains: [1] });
      
      expect(tokens.length).toBeGreaterThan(0);
      expect(tokens.every(t => t.source === 'Fallback')).toBe(true);
    });

    it('should handle partial failures gracefully', async () => {
      // Mock LiFi to succeed for some chains but fail for others
      mockLifiService.getTokens
        .mockResolvedValueOnce([]) // Chain 1 succeeds
        .mockRejectedValueOnce(new Error('Chain error')); // Chain 137 fails
      
      const tokens1 = await enhancedLifiTokenService.getTokensForChain(1);
      const tokens137 = await enhancedLifiTokenService.getTokensForChain(137);
      
      // Both should return tokens (fallback for chain 137)
      expect(tokens1.length).toBeGreaterThan(0);
      expect(tokens137.length).toBeGreaterThan(0);
    });
  });
});