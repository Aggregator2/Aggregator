import { BridgeProvider, BridgeQuote, BridgeQuoteParams, BridgeStatus } from './types';

// Mock bridge providers that simulate real bridge behavior
class MockLiFiBridgeProvider implements BridgeProvider {
  id = 'lifi';
  name = 'LI.FI (Mock)';
  supportedChains = [1, 56, 137, 42161, 10, 43114, 250];

  async getQuote(params: BridgeQuoteParams): Promise<BridgeQuote | null> {
    // Simulate bridge quote calculation
    const fromAmount = parseFloat(params.fromAmount);
    
    // Bridge fee: 0.1-0.3% depending on chains
    const feePercentage = this.getBridgeFeePercentage(params.fromChainId, params.toChainId);
    const bridgeFee = fromAmount * feePercentage;
    const toAmount = Math.floor(fromAmount - bridgeFee).toString();
    
    // Estimated time based on chain combination
    const estimatedTime = this.getEstimatedTime(params.fromChainId, params.toChainId);
    
    return {
      bridgeId: this.id,
      bridgeName: this.name,
      fromChainId: params.fromChainId,
      toChainId: params.toChainId,
      fromToken: params.fromToken,
      toToken: params.toToken,
      fromAmount: params.fromAmount,
      toAmount,
      toAmountMin: Math.floor(parseFloat(toAmount) * 0.99).toString(), // 1% slippage
      bridgeFee: bridgeFee.toString(),
      bridgeFeeUSD: bridgeFee * this.getTokenPriceUSD(params.fromToken),
      estimatedTime,
      reliability: 95,
      data: {
        mockBridge: true,
        provider: 'lifi'
      }
    };
  }

  async getBuildTx(quote: BridgeQuote, userAddress: string): Promise<any> {
    return {
      to: '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE', // Mock LI.FI contract
      data: '0x' + '12345678'.repeat(32), // Mock transaction data
      value: quote.fromToken === '0x0000000000000000000000000000000000000000' ? quote.fromAmount : '0',
      gasLimit: '300000'
    };
  }

  async checkStatus(txHash: string, fromChainId: number): Promise<BridgeStatus> {
    // Mock bridge status - simulate completion after some time
    const mockCompletionTime = Date.now() - 600000; // 10 minutes ago
    
    return {
      status: 'completed',
      fromTxHash: txHash,
      toTxHash: '0x' + 'abcdef'.repeat(11),
      completedAt: mockCompletionTime
    };
  }

  private getBridgeFeePercentage(fromChain: number, toChain: number): number {
    // Simulate different fee rates for different chain combinations
    if (fromChain === 1 || toChain === 1) return 0.003; // 0.3% for Ethereum
    if (fromChain === 56 || toChain === 56) return 0.002; // 0.2% for BSC
    return 0.001; // 0.1% for other chains
  }

  private getEstimatedTime(fromChain: number, toChain: number): number {
    // Simulate different bridge times
    if (fromChain === 1 || toChain === 1) return 900; // 15 minutes for Ethereum
    if (fromChain === 137 || toChain === 137) return 600; // 10 minutes for Polygon
    return 300; // 5 minutes for fast chains
  }

  private getTokenPriceUSD(tokenAddress: string): number {
    // Mock token prices
    const prices: Record<string, number> = {
      '0x0000000000000000000000000000000000000000': 2000, // ETH/Native
      '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 1,    // USDC
      '0xdac17f958d2ee523a2206206994597c13d831ec7': 1,    // USDT
    };
    
    return prices[tokenAddress.toLowerCase()] || 1;
  }
}

class MockSynapseBridgeProvider implements BridgeProvider {
  id = 'synapse';
  name = 'Synapse (Mock)';
  supportedChains = [1, 56, 137, 42161, 10, 43114];

  async getQuote(params: BridgeQuoteParams): Promise<BridgeQuote | null> {
    const fromAmount = parseFloat(params.fromAmount);
    const bridgeFee = fromAmount * 0.0025; // 0.25% fee
    const toAmount = Math.floor(fromAmount - bridgeFee).toString();
    
    return {
      bridgeId: this.id,
      bridgeName: this.name,
      fromChainId: params.fromChainId,
      toChainId: params.toChainId,
      fromToken: params.fromToken,
      toToken: params.toToken,
      fromAmount: params.fromAmount,
      toAmount,
      toAmountMin: Math.floor(parseFloat(toAmount) * 0.98).toString(),
      bridgeFee: bridgeFee.toString(),
      bridgeFeeUSD: bridgeFee,
      estimatedTime: 720, // 12 minutes
      reliability: 90,
      data: {
        mockBridge: true,
        provider: 'synapse'
      }
    };
  }

  async getBuildTx(quote: BridgeQuote, userAddress: string): Promise<any> {
    return {
      to: '0x2796317b0fF8538F253012862c06787Adfb8cEb6', // Mock Synapse contract
      data: '0x' + 'abcdef12'.repeat(32),
      value: quote.fromToken === '0x0000000000000000000000000000000000000000' ? quote.fromAmount : '0',
      gasLimit: '350000'
    };
  }

  async checkStatus(txHash: string, fromChainId: number): Promise<BridgeStatus> {
    return {
      status: 'completed',
      fromTxHash: txHash,
      toTxHash: '0x' + '123456'.repeat(11),
      completedAt: Date.now() - 720000 // 12 minutes ago
    };
  }
}

class MockCelerBridgeProvider implements BridgeProvider {
  id = 'celer';
  name = 'Celer cBridge (Mock)';
  supportedChains = [1, 56, 137, 42161, 43114];

  async getQuote(params: BridgeQuoteParams): Promise<BridgeQuote | null> {
    const fromAmount = parseFloat(params.fromAmount);
    const bridgeFee = fromAmount * 0.002; // 0.2% fee
    const toAmount = Math.floor(fromAmount - bridgeFee).toString();
    
    return {
      bridgeId: this.id,
      bridgeName: this.name,
      fromChainId: params.fromChainId,
      toChainId: params.toChainId,
      fromToken: params.fromToken,
      toToken: params.toToken,
      fromAmount: params.fromAmount,
      toAmount,
      toAmountMin: Math.floor(parseFloat(toAmount) * 0.97).toString(),
      bridgeFee: bridgeFee.toString(),
      bridgeFeeUSD: bridgeFee,
      estimatedTime: 480, // 8 minutes
      reliability: 85,
      data: {
        mockBridge: true,
        provider: 'celer'
      }
    };
  }

  async getBuildTx(quote: BridgeQuote, userAddress: string): Promise<any> {
    return {
      to: '0x5427FEFA711Eff984124bFBB1AB6fbf5E3DA1820', // Mock Celer contract
      data: '0x' + 'fedcba98'.repeat(32),
      value: quote.fromToken === '0x0000000000000000000000000000000000000000' ? quote.fromAmount : '0',
      gasLimit: '280000'
    };
  }

  async checkStatus(txHash: string, fromChainId: number): Promise<BridgeStatus> {
    return {
      status: 'completed',
      fromTxHash: txHash,
      toTxHash: '0x' + '987654'.repeat(11),
      completedAt: Date.now() - 480000 // 8 minutes ago
    };
  }
}

export class MockBridgeAggregator {
  private providers: BridgeProvider[] = [];

  constructor() {
    this.providers = [
      new MockLiFiBridgeProvider(),
      new MockSynapseBridgeProvider(),
      new MockCelerBridgeProvider()
    ];
  }

  async getQuotes(params: BridgeQuoteParams): Promise<BridgeQuote[]> {
    const quotes: BridgeQuote[] = [];
    
    // Get quotes from all providers that support the chains
    const eligibleProviders = this.providers.filter(provider => 
      provider.supportedChains.includes(params.fromChainId) &&
      provider.supportedChains.includes(params.toChainId)
    );

    // Simulate different response times and success rates
    for (const provider of eligibleProviders) {
      try {
        // Simulate some providers failing occasionally
        if (Math.random() > 0.1) { // 90% success rate
          const quote = await provider.getQuote(params);
          if (quote) quotes.push(quote);
        }
      } catch (error) {
        console.warn(`Mock bridge ${provider.name} failed:`, error);
      }
    }
    
    // Sort by output amount (descending)
    quotes.sort((a, b) => parseFloat(b.toAmount) - parseFloat(a.toAmount));
    
    return quotes;
  }

  async getBuildTx(quote: BridgeQuote, userAddress: string): Promise<any> {
    const provider = this.providers.find(p => p.id === quote.bridgeId);
    if (!provider) {
      throw new Error(`Bridge provider ${quote.bridgeId} not found`);
    }
    
    return provider.getBuildTx(quote, userAddress);
  }

  async checkStatus(bridgeId: string, txHash: string, fromChainId: number): Promise<BridgeStatus> {
    const provider = this.providers.find(p => p.id === bridgeId);
    if (!provider) {
      throw new Error(`Bridge provider ${bridgeId} not found`);
    }
    
    return provider.checkStatus(txHash, fromChainId);
  }

  async canBridge(
    fromChainId: number,
    toChainId: number,
    fromToken: string,
    toToken: string
  ): Promise<boolean> {
    // Mock bridge availability - assume most major tokens can be bridged
    const supportedTokens = [
      '0x0000000000000000000000000000000000000000', // Native tokens
      '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC (various addresses)
      '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', // USDC BSC
      '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', // USDC Polygon
      '0xdac17f958d2ee523a2206206994597c13d831ec7', // USDT
      '0x55d398326f99059ff775485246999027b3197955', // USDT BSC
    ];
    
    const fromTokenLower = fromToken.toLowerCase();
    const toTokenLower = toToken.toLowerCase();
    
    // Check if any provider supports both chains
    for (const provider of this.providers) {
      if (provider.supportedChains.includes(fromChainId) && 
          provider.supportedChains.includes(toChainId)) {
        
        // Check if it's a supported token
        if (supportedTokens.includes(fromTokenLower) || 
            supportedTokens.includes(toTokenLower) ||
            fromTokenLower === toTokenLower) { // Same token on different chains
          return true;
        }
      }
    }
    
    return false;
  }

  getSupportedChains(): number[] {
    const chains = new Set<number>();
    this.providers.forEach(provider => {
      provider.supportedChains.forEach(chainId => chains.add(chainId));
    });
    return Array.from(chains);
  }

  getSupportedBridges(): Array<{ id: string; name: string; chains: number[] }> {
    return this.providers.map(provider => ({
      id: provider.id,
      name: provider.name,
      chains: provider.supportedChains
    }));
  }
}