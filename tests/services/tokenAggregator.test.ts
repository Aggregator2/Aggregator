import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { TokenAggregator } from '../../src/services/tokenAggregator';
import { lifiService } from '../../src/services/lifiService';

// Mock the lifiService
jest.mock('../../src/services/lifiService', () => ({
  lifiService: {
    getAllTokens: jest.fn(),
    getChains: jest.fn(),
    getTokens: jest.fn()
  }
}));

describe('TokenAggregator', () => {
  let tokenAggregator: TokenAggregator;
  const mockLifiService = lifiService as jest.Mocked<typeof lifiService>;

  beforeEach(() => {
    // Get fresh instance
    tokenAggregator = TokenAggregator.getInstance();
    
    // Reset mocks
    jest.clearAllMocks();
    
    // Mock LiFi service responses
    mockLifiService.getAllTokens.mockResolvedValue(new Map([
      [1, [
        {
          symbol: 'ETH',
          name: 'Ethereum',
          address: '0x0000000000000000000000000000000000000000',
          chainId: 1,
          decimals: 18,
          logoURI: 'https://example.com/eth.png',
          priceUSD: '2000'
        },
        {
          symbol: 'USDC',
          name: 'USD Coin',
          address: '0xA0b86a33E6c17b7f2F3f4a0b8d6d6d6d6d6d6d6d',
          chainId: 1,
          decimals: 6,
          logoURI: 'https://example.com/usdc.png',
          priceUSD: '1'
        }
      ]],
      [56, [
        {
          symbol: 'BNB',
          name: 'Binance Coin',
          address: '0x0000000000000000000000000000000000000000',
          chainId: 56,
          decimals: 18,
          logoURI: 'https://example.com/bnb.png',
          priceUSD: '300'
        }
      ]]
    ]));
  });

  describe('loadAllTokens', () => {
    it('should load tokens from LiFi as primary source', async () => {
      // Mock fetch to avoid network calls
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));
      
      await tokenAggregator.loadAllTokens();
      
      expect(mockLifiService.getAllTokens).toHaveBeenCalled();
      
      const stats = tokenAggregator.getStats();
      expect(stats.total).toBeGreaterThan(0);
      expect(stats.byChain[1]).toBe(2); // ETH and USDC on Ethereum
      expect(stats.byChain[56]).toBe(1); // BNB on BSC
    });

    it('should prevent concurrent loading', async () => {
      // Start multiple loads concurrently
      const promise1 = tokenAggregator.loadAllTokens();
      const promise2 = tokenAggregator.loadAllTokens();
      const promise3 = tokenAggregator.loadAllTokens();
      
      await Promise.all([promise1, promise2, promise3]);
      
      // Should only call LiFi service once
      expect(mockLifiService.getAllTokens).toHaveBeenCalledTimes(1);
    });

    it('should handle LiFi service errors gracefully', async () => {
      mockLifiService.getAllTokens.mockRejectedValue(new Error('LiFi API error'));
      
      // Mock fetch to return empty arrays for backup sources
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ tokens: [] })
      } as Response);
      
      await expect(tokenAggregator.loadAllTokens()).resolves.not.toThrow();
      
      // Should still try to load from backup sources
      expect(global.fetch).toHaveBeenCalled();
    });
  });

  describe('searchTokens', () => {
    beforeEach(async () => {
      await tokenAggregator.loadAllTokens();
    });

    it('should find tokens by symbol', () => {
      const results = tokenAggregator.searchTokens('ETH');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].symbol).toBe('ETH');
    });

    it('should find tokens by name', () => {
      const results = tokenAggregator.searchTokens('Ethereum');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].name).toBe('Ethereum');
    });

    it('should filter by chain ID', () => {
      const results = tokenAggregator.searchTokens('', 1); // Ethereum only
      expect(results.every(token => token.chainId === 1)).toBe(true);
    });
  });

  describe('getTokensByChain', () => {
    beforeEach(async () => {
      await tokenAggregator.loadAllTokens();
    });

    it('should return tokens for specific chain', () => {
      const ethereumTokens = tokenAggregator.getTokensByChain(1);
      expect(ethereumTokens.length).toBe(2);
      expect(ethereumTokens.every(token => token.chainId === 1)).toBe(true);
    });

    it('should return empty array for unknown chain', () => {
      const unknownTokens = tokenAggregator.getTokensByChain(999);
      expect(unknownTokens).toEqual([]);
    });
  });

  describe('getStats', () => {
    it('should return safe stats even without loaded tokens', () => {
      const stats = tokenAggregator.getStats();
      expect(stats).toHaveProperty('total');
      expect(stats).toHaveProperty('byChain');
      expect(stats).toHaveProperty('lastUpdate');
      expect(typeof stats.total).toBe('number');
    });

    it('should return correct stats after loading', async () => {
      await tokenAggregator.loadAllTokens();
      
      const stats = tokenAggregator.getStats();
      expect(stats.total).toBe(3); // 2 on Ethereum + 1 on BSC
      expect(stats.byChain[1]).toBe(2);
      expect(stats.byChain[56]).toBe(1);
      expect(stats.lastUpdate).toBeGreaterThan(0);
    });
  });
});