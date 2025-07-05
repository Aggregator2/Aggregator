import { ethers } from 'ethers';
import { liquidityAggregator } from '../services/liquidityAggregator';
import { OrderSide } from '../services/matchingEngine/types';

describe('External Liquidity Execution Tests', () => {
  let provider: ethers.Provider;
  let signer: ethers.Signer;
  let userAddress: string;

  beforeAll(async () => {
    // Setup test provider (use a fork for testing)
    provider = new ethers.JsonRpcProvider('http://localhost:8545');
    
    // Create test signer
    const privateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
    signer = new ethers.Wallet(privateKey, provider);
    userAddress = await signer.getAddress();
    
    console.log('Test wallet:', userAddress);
  });

  describe('Quote Generation', () => {
    test('should get quote for ETH/USDC trade', async () => {
      const mockQuote = {
        routes: [{
          id: 'route1',
          fromAmount: '1000000', // 1 USDC
          toAmount: '500000000000000', // 0.0005 ETH
          gasCostUSD: '5.00',
          steps: [{
            toolDetails: { name: 'Uniswap V3' }
          }]
        }]
      };

      // Mock the LiFi service
      jest.spyOn(liquidityAggregator['lifiService'], 'getQuote')
        .mockResolvedValue(mockQuote);

      const quote = await liquidityAggregator['getLiFiQuoteForTrade'](
        'ETH/USDC',
        OrderSide.BUY,
        0.0005,
        signer,
        0.02
      );

      expect(quote).toBeDefined();
      expect(quote.routes).toHaveLength(1);
      expect(quote.routes[0].toAmount).toBe('500000000000000');
    });

    test('should handle quote failures gracefully', async () => {
      jest.spyOn(liquidityAggregator['lifiService'], 'getQuote')
        .mockRejectedValue(new Error('No routes available'));

      await expect(
        liquidityAggregator.executeExternalTrade(
          'user123',
          'ETH/USDC',
          OrderSide.BUY,
          1,
          signer
        )
      ).rejects.toThrow('No routes available');
    });
  });

  describe('Transaction Execution', () => {
    test('should execute external trade successfully', async () => {
      const orderId = 'EXT_TEST_123';
      const txHash = '0x' + '1'.repeat(64);
      
      // Mock successful execution
      const mockRoute = {
        id: 'route1',
        fromAmount: '1000000000',
        toAmount: '500000000000000000',
        gasCostUSD: '10.00'
      };

      // Setup mocks
      jest.spyOn(liquidityAggregator as any, 'getLiFiQuoteForTrade')
        .mockResolvedValue({ routes: [mockRoute] });
        
      jest.spyOn(liquidityAggregator as any, 'executeLiFiRoute')
        .mockResolvedValue({
          success: true,
          txHash,
          gasUsed: '150000',
          averagePrice: 0.5
        });

      const result = await liquidityAggregator.executeExternalTrade(
        'user123',
        'ETH/USDC',
        OrderSide.BUY,
        0.5,
        signer,
        { maxSlippage: 0.02 }
      );

      expect(result).toMatchObject({
        txHash,
        status: 'confirmed',
        filledQuantity: 0.5,
        averagePrice: 0.5
      });
    });

    test('should handle transaction reverts', async () => {
      // Mock revert scenario
      jest.spyOn(liquidityAggregator as any, 'executeLiFiRoute')
        .mockResolvedValue({
          success: false,
          error: 'Transaction reverted: slippage tolerance exceeded'
        });

      await expect(
        liquidityAggregator.executeExternalTrade(
          'user123',
          'ETH/USDC',
          OrderSide.SELL,
          1,
          signer
        )
      ).rejects.toThrow('slippage');
    });

    test('should retry on transient failures', async () => {
      let attempts = 0;
      
      // Mock retry scenario
      jest.spyOn(liquidityAggregator as any, 'executeLiFiRoute')
        .mockImplementation(async () => {
          attempts++;
          if (attempts < 3) {
            throw new Error('nonce too low');
          }
          return {
            success: true,
            txHash: '0x' + '2'.repeat(64),
            gasUsed: '200000',
            averagePrice: 2000
          };
        });

      const result = await liquidityAggregator.executeExternalTrade(
        'user123',
        'ETH/USDC',
        OrderSide.BUY,
        1,
        signer,
        { maxRetries: 3 }
      );

      expect(attempts).toBe(3);
      expect(result.status).toBe('confirmed');
    });
  });

  describe('Event Emissions', () => {
    test('should emit correct events during execution', async () => {
      const events: any[] = [];
      
      // Capture all events
      ['trade:initiated', 'quote:received', 'signature:required', 
       'transaction:submitted', 'transaction:confirmed'].forEach(event => {
        liquidityAggregator.on(event, (data) => {
          events.push({ event, data });
        });
      });

      // Mock successful execution
      jest.spyOn(liquidityAggregator as any, 'getLiFiQuoteForTrade')
        .mockResolvedValue({ 
          routes: [{
            fromAmount: '1000',
            toAmount: '2000',
            gasCostUSD: '5'
          }]
        });
        
      jest.spyOn(liquidityAggregator as any, 'executeLiFiRoute')
        .mockResolvedValue({
          success: true,
          txHash: '0xabc',
          gasUsed: '100000'
        });

      await liquidityAggregator.executeExternalTrade(
        'user123',
        'ETH/USDC',
        OrderSide.BUY,
        1,
        signer
      );

      // Verify events were emitted
      expect(events.find(e => e.event === 'trade:initiated')).toBeDefined();
      expect(events.find(e => e.event === 'quote:received')).toBeDefined();
      expect(events.find(e => e.event === 'signature:required')).toBeDefined();
    });
  });

  describe('Trade Status Management', () => {
    test('should track trade status correctly', async () => {
      const mockRoute = {
        fromAmount: '1000',
        toAmount: '2000',
        gasCostUSD: '5'
      };

      jest.spyOn(liquidityAggregator as any, 'getLiFiQuoteForTrade')
        .mockResolvedValue({ routes: [mockRoute] });

      // Start execution but don't await
      const tradePromise = liquidityAggregator.executeExternalTrade(
        'user123',
        'ETH/USDC',
        OrderSide.BUY,
        1,
        signer
      );

      // Check pending trades
      await new Promise(resolve => setTimeout(resolve, 100));
      const pendingTrades = liquidityAggregator.getPendingExternalTrades();
      expect(pendingTrades.length).toBeGreaterThan(0);

      // Complete the trade
      jest.spyOn(liquidityAggregator as any, 'executeLiFiRoute')
        .mockResolvedValue({
          success: true,
          txHash: '0xdef',
          gasUsed: '150000'
        });

      await tradePromise;

      // Verify trade is no longer pending
      const finalPendingTrades = liquidityAggregator.getPendingExternalTrades();
      expect(finalPendingTrades.length).toBe(pendingTrades.length - 1);
    });

    test('should retrieve user trade history', async () => {
      // Execute a few trades
      const userId = 'testUser123';
      
      // Mock trades
      for (let i = 0; i < 3; i++) {
        liquidityAggregator['externalTrades'].set(`ORDER_${i}`, {
          orderId: `ORDER_${i}`,
          userId,
          status: i === 0 ? 'CONFIRMED' : 'PENDING',
          timestamp: Date.now() - i * 1000
        } as any);
      }

      const userTrades = liquidityAggregator.getOrdersByUser(userId);
      expect(userTrades).toHaveLength(3);
      expect(userTrades[0].orderId).toBe('ORDER_0'); // Most recent first
    });
  });

  describe('Error Handling', () => {
    test('should handle insufficient funds error', async () => {
      jest.spyOn(liquidityAggregator as any, 'executeLiFiRoute')
        .mockRejectedValue(new Error('insufficient funds for gas * price + value'));

      await expect(
        liquidityAggregator.executeExternalTrade(
          'user123',
          'ETH/USDC',
          OrderSide.BUY,
          100, // Large amount
          signer
        )
      ).rejects.toThrow('insufficient funds');
    });

    test('should handle rate limit errors', async () => {
      jest.spyOn(liquidityAggregator['lifiService'], 'getQuote')
        .mockRejectedValue(new Error('LiFi API rate limit exceeded'));

      await expect(
        liquidityAggregator.executeExternalTrade(
          'user123',
          'ETH/USDC',
          OrderSide.BUY,
          1,
          signer
        )
      ).rejects.toThrow('rate limit');
    });

    test('should handle network errors with retry', async () => {
      let attempts = 0;
      
      jest.spyOn(liquidityAggregator['lifiService'], 'getQuote')
        .mockImplementation(async () => {
          attempts++;
          if (attempts === 1) {
            throw new Error('network timeout');
          }
          return { routes: [{ fromAmount: '1000', toAmount: '2000' }] };
        });

      // Should succeed on retry
      const result = await liquidityAggregator['getLiFiQuoteForTrade'](
        'ETH/USDC',
        OrderSide.BUY,
        1,
        signer
      );

      expect(result).toBeDefined();
      expect(attempts).toBe(2);
    });
  });

  describe('Fallback DEX Integration', () => {
    test('should attempt fallback DEXs on primary failure', async () => {
      const fallbackAttempts: string[] = [];
      
      // Mock primary failure
      jest.spyOn(liquidityAggregator as any, 'getLiFiQuoteForTrade')
        .mockRejectedValue(new Error('No routes available'));
        
      // Mock fallback attempts
      jest.spyOn(liquidityAggregator as any, 'tryFallbackDEXs')
        .mockImplementation(async (userId, pair, side, quantity, signer, options) => {
          fallbackAttempts.push(...(options.fallbackDEXs || []));
          return {
            orderId: 'FALLBACK_123',
            txHash: '0xfallback',
            status: 'confirmed',
            dex: 'Uniswap'
          };
        });

      const result = await liquidityAggregator.executeExternalTrade(
        'user123',
        'ETH/USDC',
        OrderSide.BUY,
        1,
        signer,
        {
          dexName: 'LiFi',
          fallbackDEXs: ['Uniswap', '1inch', '0x']
        }
      );

      expect(result.dex).toBe('Uniswap');
      expect(fallbackAttempts).toContain('Uniswap');
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });
});