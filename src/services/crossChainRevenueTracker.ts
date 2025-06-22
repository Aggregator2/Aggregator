import { ethers, BigNumber } from "ethers";
import { getRevenueAccumulator } from "./revenueAccumulator";

interface ChainConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  isL2: boolean;
  gasOptimizationEnabled: boolean;
  collectionThresholdUSD: number; // Lower for L2s
  provider?: ethers.Provider;
  wallet?: ethers.Wallet;
}

interface ChainRevenueSummary {
  chainId: number;
  chainName: string;
  totalRevenueUSD: number;
  feeCount: number;
  tokenBreakdown: Record<string, {
    symbol: string;
    amount: string;
    valueUSD: number;
    count: number;
  }>;
  gasEstimate: {
    collectionCostUSD: number;
    isOptimal: boolean;
    recommendation: string;
  };
}

export class CrossChainRevenueTracker {
  private static instance: CrossChainRevenueTracker;
  private chainConfigs: Map<number, ChainConfig>;
  private revenueAccumulator: any;
  
  // Chain configurations
  private readonly CHAIN_CONFIGS: ChainConfig[] = [
    {
      chainId: 1,
      name: "Ethereum",
      rpcUrl: process.env.ETHEREUM_RPC || "https://eth.llamarpc.com",
      isL2: false,
      gasOptimizationEnabled: true,
      collectionThresholdUSD: 100 // Higher threshold for L1
    },
    {
      chainId: 137,
      name: "Polygon",
      rpcUrl: process.env.POLYGON_RPC || "https://polygon-rpc.com",
      isL2: true,
      gasOptimizationEnabled: false,
      collectionThresholdUSD: 10 // Lower threshold for L2
    },
    {
      chainId: 42161,
      name: "Arbitrum",
      rpcUrl: process.env.ARBITRUM_RPC || "https://arbitrum.llamarpc.com",
      isL2: true,
      gasOptimizationEnabled: false,
      collectionThresholdUSD: 20 // Medium threshold for L2
    },
    {
      chainId: 10,
      name: "Optimism",
      rpcUrl: process.env.OPTIMISM_RPC || "https://optimism.llamarpc.com",
      isL2: true,
      gasOptimizationEnabled: false,
      collectionThresholdUSD: 20
    },
    {
      chainId: 56,
      name: "BSC",
      rpcUrl: process.env.BSC_RPC || "https://bsc-dataseed.binance.org",
      isL2: false,
      gasOptimizationEnabled: false,
      collectionThresholdUSD: 30
    }
  ];
  
  private constructor() {
    this.chainConfigs = new Map();
    this.revenueAccumulator = getRevenueAccumulator();
    this.initializeChains();
  }
  
  public static getInstance(): CrossChainRevenueTracker {
    if (!CrossChainRevenueTracker.instance) {
      CrossChainRevenueTracker.instance = new CrossChainRevenueTracker();
    }
    return CrossChainRevenueTracker.instance;
  }
  
  private initializeChains() {
    for (const config of this.CHAIN_CONFIGS) {
      // Initialize provider for each chain
      config.provider = new ethers.JsonRpcProvider(config.rpcUrl);
      
      // Initialize wallet if private key is available
      if (process.env.REVENUE_PRIVATE_KEY) {
        config.wallet = new ethers.Wallet(
          process.env.REVENUE_PRIVATE_KEY,
          config.provider
        );
      }
      
      this.chainConfigs.set(config.chainId, config);
    }
    
    console.log(`[CrossChainRevenueTracker] Initialized ${this.chainConfigs.size} chains`);
  }
  
  /**
   * Track a fee collection on a specific chain
   */
  async trackFeeCollection(params: {
    chainId: number;
    feeAmount: string;
    feeToken: string;
    tokenSymbol: string;
    tokenUsdPrice: number;
    transactionHash?: string;
    userAddress?: string;
  }): Promise<void> {
    const chainConfig = this.chainConfigs.get(params.chainId);
    if (!chainConfig) {
      throw new Error(`Unsupported chain: ${params.chainId}`);
    }
    
    console.log(
      `[CrossChainRevenueTracker] Recording fee on ${chainConfig.name}: ` +
      `${ethers.formatUnits(params.feeAmount, 18)} ${params.tokenSymbol}`
    );
    
    // Add to revenue accumulator with chain info
    await this.revenueAccumulator.addFeeCollection({
      feeAmount: params.feeAmount,
      feeToken: params.feeToken,
      tokenUsdPrice: params.tokenUsdPrice,
      timestamp: Date.now(),
      chainId: params.chainId
    });
    
    // Check if we should trigger collection for this specific chain
    await this.checkChainCollectionThreshold(params.chainId);
  }
  
  /**
   * Get revenue breakdown by chain
   */
  async getRevenueByChain(): Promise<ChainRevenueSummary[]> {
    const state = this.revenueAccumulator.getState();
    const summaries: ChainRevenueSummary[] = [];
    
    // Group fees by chain
    const feesByChain = new Map<number, any[]>();
    
    for (const fee of state.collectedFees) {
      if (!feesByChain.has(fee.chainId)) {
        feesByChain.set(fee.chainId, []);
      }
      feesByChain.get(fee.chainId)!.push(fee);
    }
    
    // Calculate summary for each chain
    for (const [chainId, fees] of feesByChain.entries()) {
      const chainConfig = this.chainConfigs.get(chainId);
      if (!chainConfig) continue;
      
      const tokenBreakdown: Record<string, any> = {};
      let totalChainRevenueUSD = 0;
      
      for (const fee of fees) {
        const feeValueUSD = parseFloat(ethers.formatUnits(fee.feeAmount, 18)) * fee.tokenUsdPrice;
        totalChainRevenueUSD += feeValueUSD;
        
        if (!tokenBreakdown[fee.feeToken]) {
          tokenBreakdown[fee.feeToken] = {
            symbol: fee.feeToken === "ETH" ? "ETH" : fee.feeToken.slice(0, 6),
            amount: BigInt(0),
            valueUSD: 0,
            count: 0
          };
        }
        
        tokenBreakdown[fee.feeToken].amount = (
          BigInt(tokenBreakdown[fee.feeToken].amount) + BigInt(fee.feeAmount)
        ).toString();
        tokenBreakdown[fee.feeToken].valueUSD += feeValueUSD;
        tokenBreakdown[fee.feeToken].count++;
      }
      
      // Estimate gas costs
      const gasEstimate = await this.estimateCollectionGasCost(chainId, Object.keys(tokenBreakdown).length);
      
      summaries.push({
        chainId,
        chainName: chainConfig.name,
        totalRevenueUSD: totalChainRevenueUSD,
        feeCount: fees.length,
        tokenBreakdown,
        gasEstimate
      });
    }
    
    return summaries;
  }
  
  /**
   * Check if collection threshold is met for a specific chain
   */
  private async checkChainCollectionThreshold(chainId: number): Promise<boolean> {
    const chainConfig = this.chainConfigs.get(chainId);
    if (!chainConfig) return false;
    
    const chainSummary = (await this.getRevenueByChain()).find(s => s.chainId === chainId);
    if (!chainSummary) return false;
    
    const shouldCollect = chainSummary.totalRevenueUSD >= chainConfig.collectionThresholdUSD;
    
    if (shouldCollect) {
      console.log(
        `[CrossChainRevenueTracker] Collection threshold reached on ${chainConfig.name}: ` +
        `$${chainSummary.totalRevenueUSD.toFixed(2)} >= $${chainConfig.collectionThresholdUSD}`
      );
      
      // For L2s, we can trigger collection more frequently
      if (chainConfig.isL2) {
        console.log(`[CrossChainRevenueTracker] L2 detected - recommending immediate collection`);
      }
    }
    
    return shouldCollect;
  }
  
  /**
   * Estimate gas cost for fee collection on a specific chain
   */
  private async estimateCollectionGasCost(
    chainId: number, 
    tokenCount: number
  ): Promise<{
    collectionCostUSD: number;
    isOptimal: boolean;
    recommendation: string;
  }> {
    const chainConfig = this.chainConfigs.get(chainId);
    if (!chainConfig || !chainConfig.provider) {
      return {
        collectionCostUSD: 0,
        isOptimal: false,
        recommendation: "Unable to estimate gas costs"
      };
    }
    
    try {
      // Get current gas price
      const gasPrice = await chainConfig.provider.getGasPrice();
      
      // Estimate gas usage (21k for ETH transfer, 65k per ERC20 transfer)
      const estimatedGas = 21000 + (tokenCount * 65000);
      
      // Calculate cost in ETH
      const gasCostWei = gasPrice.mul(estimatedGas);
      const gasCostETH = parseFloat(ethers.formatEther(gasCostWei));
      
      // Get ETH price (simplified - in production, fetch from price oracle)
      const ethPriceUSD = 2000; // Placeholder
      const collectionCostUSD = gasCostETH * ethPriceUSD;
      
      // Determine if collection is optimal
      let isOptimal = false;
      let recommendation = "";
      
      if (chainConfig.isL2) {
        isOptimal = collectionCostUSD < 1;
        recommendation = isOptimal 
          ? "Low gas costs - collection recommended"
          : "Consider batching more transactions";
      } else {
        isOptimal = collectionCostUSD < 10;
        recommendation = isOptimal
          ? "Acceptable gas costs for L1"
          : "High gas costs - wait for more fees to accumulate";
      }
      
      return {
        collectionCostUSD,
        isOptimal,
        recommendation
      };
    } catch (error) {
      console.error(`[CrossChainRevenueTracker] Gas estimation failed for chain ${chainId}:`, error);
      return {
        collectionCostUSD: 0,
        isOptimal: false,
        recommendation: "Gas estimation failed"
      };
    }
  }
  
  /**
   * Get optimal collection strategy for all chains
   */
  async getCollectionStrategy(): Promise<{
    immediateCollection: number[];
    batchCollection: number[];
    recommendations: Record<number, string>;
  }> {
    const summaries = await this.getRevenueByChain();
    const immediateCollection: number[] = [];
    const batchCollection: number[] = [];
    const recommendations: Record<number, string> = {};
    
    for (const summary of summaries) {
      const chainConfig = this.chainConfigs.get(summary.chainId);
      if (!chainConfig) continue;
      
      const revenueToGasRatio = summary.totalRevenueUSD / (summary.gasEstimate.collectionCostUSD || 1);
      
      if (chainConfig.isL2 && revenueToGasRatio > 10) {
        immediateCollection.push(summary.chainId);
        recommendations[summary.chainId] = 
          `Collect immediately - L2 with good revenue/gas ratio (${revenueToGasRatio.toFixed(1)}x)`;
      } else if (revenueToGasRatio > 50) {
        immediateCollection.push(summary.chainId);
        recommendations[summary.chainId] = 
          `Collect now - excellent revenue/gas ratio (${revenueToGasRatio.toFixed(1)}x)`;
      } else if (summary.totalRevenueUSD > chainConfig.collectionThresholdUSD) {
        batchCollection.push(summary.chainId);
        recommendations[summary.chainId] = 
          `Batch with other collections - threshold met but gas ratio is ${revenueToGasRatio.toFixed(1)}x`;
      } else {
        recommendations[summary.chainId] = 
          `Wait - only $${summary.totalRevenueUSD.toFixed(2)} collected (need $${chainConfig.collectionThresholdUSD})`;
      }
    }
    
    return {
      immediateCollection,
      batchCollection,
      recommendations
    };
  }
  
  /**
   * Execute rebate distribution on L2s
   */
  async distributeRebatesOnL2(params: {
    chainId: number;
    recipients: Array<{ address: string; amount: string; token: string }>;
    dryRun?: boolean;
  }): Promise<{
    success: boolean;
    totalDistributed: string;
    gasUsed: string;
    transactions: string[];
  }> {
    const chainConfig = this.chainConfigs.get(params.chainId);
    if (!chainConfig || !chainConfig.wallet) {
      throw new Error(`Chain ${params.chainId} not configured for rebates`);
    }
    
    if (!chainConfig.isL2) {
      throw new Error(`Chain ${params.chainId} is not an L2 - use batch distribution`);
    }
    
    console.log(
      `[CrossChainRevenueTracker] Distributing rebates on ${chainConfig.name} to ${params.recipients.length} recipients`
    );
    
    const transactions: string[] = [];
    let totalDistributed = BigInt(0);
    let totalGasUsed = BigInt(0);
    
    if (params.dryRun) {
      console.log("[CrossChainRevenueTracker] DRY RUN - no transactions will be sent");
      
      // Simulate distribution
      for (const recipient of params.recipients) {
        totalDistributed += BigInt(recipient.amount);
        console.log(`  Would send ${ethers.formatUnits(recipient.amount, 18)} to ${recipient.address}`);
      }
      
      return {
        success: true,
        totalDistributed: totalDistributed.toString(),
        gasUsed: "0",
        transactions: []
      };
    }
    
    // Execute actual distribution
    for (const recipient of params.recipients) {
      try {
        let tx: ethers.TransactionResponse;
        
        if (recipient.token === ethers.ZeroAddress || recipient.token === "ETH") {
          // Send native token
          tx = await chainConfig.wallet.sendTransaction({
            to: recipient.address,
            value: recipient.amount
          });
        } else {
          // Send ERC20 token
          const tokenContract = new ethers.Contract(
            recipient.token,
            ["function transfer(address to, uint256 amount) returns (bool)"],
            chainConfig.wallet
          );
          
          tx = await tokenContract.transfer(recipient.address, recipient.amount);
        }
        
        const receipt = await tx.wait();
        transactions.push(tx.hash);
        totalDistributed += BigInt(recipient.amount);
        totalGasUsed += receipt!.gasUsed;
        
        console.log(`  ✓ Sent to ${recipient.address}: ${tx.hash}`);
      } catch (error) {
        console.error(`  ✗ Failed to send to ${recipient.address}:`, error);
      }
    }
    
    return {
      success: transactions.length > 0,
      totalDistributed: totalDistributed.toString(),
      gasUsed: totalGasUsed.toString(),
      transactions
    };
  }
}

// Export singleton getter
export const getCrossChainRevenueTracker = () => CrossChainRevenueTracker.getInstance();