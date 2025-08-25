import { ethers, BigNumber } from "ethers";
import fs from "fs";
import path from "path";

interface FeeCollection {
  feeAmount: string;
  feeToken: string; // Token address or "ETH"
  tokenUsdPrice: number;
  timestamp: number;
  chainId: number;
}

interface RevenueState {
  totalRevenueUSD: number;
  collectedFees: FeeCollection[];
  lastTransferTimestamp: number;
}

export class RevenueAccumulator {
  private static instance: RevenueAccumulator;
  private state: RevenueState;
  private stateFilePath: string;
  private provider: ethers.Provider;
  private wallet: ethers.Wallet;
  private revenueWallet: string;
  private transferThresholdUSD: number = 0.5; // Lowered for testing - change back to 50 for production
  private isTransferring: boolean = false;

  private constructor() {
    // Initialize state file path
    this.stateFilePath = path.join(process.cwd(), ".revenue-state.json");

    // Load or initialize state
    this.state = this.loadState();

    // Initialize provider and wallet
    const rpcUrl = process.env.ETHEREUM_RPC || "https://eth.llamarpc.com";
    this.provider = new ethers.JsonRpcProvider(rpcUrl);

    // Validate environment variables
    if (!process.env.REVENUE_PRIVATE_KEY) {
      throw new Error("REVENUE_PRIVATE_KEY not set in environment variables");
    }
    if (!process.env.REVENUE_WALLET) {
      throw new Error("REVENUE_WALLET not set in environment variables");
    }

    this.wallet = new ethers.Wallet(
      process.env.REVENUE_PRIVATE_KEY,
      this.provider
    );
    this.revenueWallet = process.env.REVENUE_WALLET;

    console.log(
      "[RevenueAccumulator] Initialized with wallet:",
      this.wallet.address
    );
    console.log(
      "[RevenueAccumulator] Revenue will be sent to:",
      this.revenueWallet
    );
  }

  public static getInstance(): RevenueAccumulator {
    if (!RevenueAccumulator.instance) {
      RevenueAccumulator.instance = new RevenueAccumulator();
    }
    return RevenueAccumulator.instance;
  }

  /**
   * Add a fee collection to the accumulator
   */
  public async addFeeCollection(fee: FeeCollection): Promise<void> {
    try {
      // Calculate USD value of the fee
      const feeAmountBN = BigNumber.from(fee.feeAmount);
      const decimals = fee.feeToken === "ETH" ? 18 : 18; // Assuming 18 decimals, adjust per token
      const feeAmountDecimal = parseFloat(
        ethers.formatUnits(feeAmountBN, decimals)
      );
      const feeUsdValue = feeAmountDecimal * fee.tokenUsdPrice;

      // Add to state
      this.state.collectedFees.push(fee);
      this.state.totalRevenueUSD += feeUsdValue;

      console.log(
        `[RevenueAccumulator] Added fee: ${feeAmountDecimal} ${
          fee.feeToken
        } = $${feeUsdValue.toFixed(2)}`
      );
      console.log(
        `[RevenueAccumulator] Total accumulated: $${this.state.totalRevenueUSD.toFixed(
          2
        )}`
      );

      // Save state
      this.saveState();

      // Check if we should transfer
      if (
        this.state.totalRevenueUSD >= this.transferThresholdUSD &&
        !this.isTransferring
      ) {
        console.log(
          `[RevenueAccumulator] Threshold reached! Initiating transfer...`
        );
        await this.transferAccumulatedRevenue();
      }
    } catch (error) {
      console.error("[RevenueAccumulator] Error adding fee collection:", error);
      throw error;
    }
  }

  /**
   * Transfer all accumulated revenue to the revenue wallet
   */
  private async transferAccumulatedRevenue(): Promise<void> {
    if (this.isTransferring) {
      console.log(
        "[RevenueAccumulator] Transfer already in progress, skipping..."
      );
      return;
    }

    this.isTransferring = true;

    try {
      console.log("[RevenueAccumulator] Starting revenue transfer...");
      console.log(
        `[RevenueAccumulator] Total fees to transfer: ${this.state.collectedFees.length}`
      );

      // Group fees by token
      const feesByToken = new Map<
        string,
        { total: BigNumber; chainId: number }
      >();

      for (const fee of this.state.collectedFees) {
        const key = `${fee.chainId}-${fee.feeToken}`;
        const existing = feesByToken.get(key);

        if (existing) {
          existing.total = existing.total.add(BigNumber.from(fee.feeAmount));
        } else {
          feesByToken.set(key, {
            total: BigNumber.from(fee.feeAmount),
            chainId: fee.chainId,
          });
        }
      }

      // Transfer each token type
      const transferPromises: Promise<any>[] = [];

      for (const [key, data] of feesByToken.entries()) {
        const [chainId, token] = key.split("-");

        if (parseInt(chainId) === 1) {
          // Ethereum mainnet
          if (token === "ETH") {
            transferPromises.push(this.transferETH(data.total));
          } else {
            transferPromises.push(this.transferERC20(token, data.total));
          }
        } else {
          console.log(
            `[RevenueAccumulator] Skipping transfer for chain ${chainId} (not implemented)`
          );
        }
      }

      // Wait for all transfers
      const results = await Promise.allSettled(transferPromises);

      // Check results
      const successful = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.filter((r) => r.status === "rejected").length;

      console.log(
        `[RevenueAccumulator] Transfer complete. Success: ${successful}, Failed: ${failed}`
      );

      if (failed > 0) {
        console.error(
          "[RevenueAccumulator] Some transfers failed:",
          results.filter((r) => r.status === "rejected")
        );
      }

      // Reset state only if all transfers were successful
      if (failed === 0) {
        this.state.collectedFees = [];
        this.state.totalRevenueUSD = 0;
        this.state.lastTransferTimestamp = Date.now();
        this.saveState();

        console.log(
          "[RevenueAccumulator] State reset after successful transfer"
        );
      }
    } catch (error) {
      console.error(
        "[RevenueAccumulator] Error during revenue transfer:",
        error
      );
    } finally {
      this.isTransferring = false;
    }
  }

  /**
   * Transfer ETH to the revenue wallet
   */
  private async transferETH(amount: BigNumber): Promise<void> {
    try {
      console.log(
        `[RevenueAccumulator] Transferring ${ethers.formatEther(
          amount
        )} ETH to ${this.revenueWallet}`
      );

      // Check balance
      const balance = await this.provider.getBalance(this.wallet.address);
      if (balance.lt(amount)) {
        throw new Error(
          `Insufficient ETH balance. Have: ${ethers.formatEther(
            balance
          )}, Need: ${ethers.formatEther(amount)}`
        );
      }

      // Send transaction
      const tx = await this.wallet.sendTransaction({
        to: this.revenueWallet,
        value: amount,
      });

      console.log(`[RevenueAccumulator] ETH transfer tx: ${tx.hash}`);

      // Wait for confirmation
      const receipt = await tx.wait();
      console.log(
        `[RevenueAccumulator] ETH transfer confirmed in block ${receipt?.blockNumber}`
      );
    } catch (error) {
      console.error("[RevenueAccumulator] ETH transfer failed:", error);
      throw error;
    }
  }

  /**
   * Transfer ERC-20 tokens to the revenue wallet
   */
  private async transferERC20(
    tokenAddress: string,
    amount: BigNumber
  ): Promise<void> {
    try {
      console.log(
        `[RevenueAccumulator] Transferring ${amount.toString()} of token ${tokenAddress} to ${
          this.revenueWallet
        }`
      );

      // ERC-20 ABI for transfer function
      const erc20Abi = [
        "function transfer(address to, uint256 amount) returns (bool)",
        "function balanceOf(address account) view returns (uint256)",
        "function decimals() view returns (uint8)",
        "function symbol() view returns (string)",
      ];

      // Create contract instance
      const tokenContract = new ethers.Contract(
        tokenAddress,
        erc20Abi,
        this.wallet
      );

      // Get token info
      const [symbol, decimals, balance] = await Promise.all([
        tokenContract.symbol().catch(() => "UNKNOWN"),
        tokenContract.decimals().catch(() => 18),
        tokenContract.balanceOf(this.wallet.address),
      ]);

      console.log(
        `[RevenueAccumulator] Token: ${symbol}, Decimals: ${decimals}, Balance: ${ethers.formatUnits(
          balance,
          decimals
        )}`
      );

      // Check balance
      if (balance.lt(amount)) {
        throw new Error(
          `Insufficient token balance. Have: ${ethers.formatUnits(
            balance,
            decimals
          )}, Need: ${ethers.formatUnits(amount, decimals)}`
        );
      }

      // Send transfer transaction
      const tx = await tokenContract.transfer(this.revenueWallet, amount);
      console.log(`[RevenueAccumulator] ERC-20 transfer tx: ${tx.hash}`);

      // Wait for confirmation
      const receipt = await tx.wait();
      console.log(
        `[RevenueAccumulator] ERC-20 transfer confirmed in block ${receipt?.blockNumber}`
      );
    } catch (error) {
      console.error("[RevenueAccumulator] ERC-20 transfer failed:", error);
      throw error;
    }
  }

  /**
   * Load state from file
   */
  private loadState(): RevenueState {
    try {
      if (fs.existsSync(this.stateFilePath)) {
        const data = fs.readFileSync(this.stateFilePath, "utf-8");
        return JSON.parse(data);
      }
    } catch (error) {
      console.error("[RevenueAccumulator] Error loading state:", error);
    }

    // Return default state
    return {
      totalRevenueUSD: 0,
      collectedFees: [],
      lastTransferTimestamp: 0,
    };
  }

  /**
   * Save state to file
   */
  private saveState(): void {
    try {
      fs.writeFileSync(this.stateFilePath, JSON.stringify(this.state, null, 2));
    } catch (error) {
      console.error("[RevenueAccumulator] Error saving state:", error);
    }
  }

  /**
   * Get current revenue state (for monitoring)
   */
  public getState(): RevenueState {
    return { ...this.state };
  }

  /**
   * Manually trigger a transfer (for testing or emergency)
   */
  public async forceTransfer(): Promise<void> {
    console.log("[RevenueAccumulator] Manual transfer triggered");
    await this.transferAccumulatedRevenue();
  }
}

// Export singleton instance getter
export const getRevenueAccumulator = () => RevenueAccumulator.getInstance();
