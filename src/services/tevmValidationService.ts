import { createTevmClient } from '@tevm/node';
import { createMemoryClient } from '@tevm/memory-client';
import { ethers } from 'ethers';

// ERC20 ABI for token interactions
const ERC20_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transfer(address recipient, uint256 amount) returns (bool)',
  'function transferFrom(address sender, address recipient, uint256 amount) returns (bool)',
];

export interface ValidationResult {
  isValid: boolean;
  reason?: string;
  gasEstimate?: bigint;
  simulatedOutput?: any;
}

export interface OrderValidationParams {
  userAddress: string;
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  routerAddress: string;
  routerCalldata: string;
  chainId: number;
}

export class TevmValidationService {
  private tevmClient: any;
  private initialized = false;

  async initialize(forkUrl?: string) {
    if (this.initialized) return;

    try {
      // Create TEVM client with fork mode for mainnet simulation
      this.tevmClient = await createTevmClient({
        fork: {
          url: forkUrl || process.env.ETH_RPC_URL || 'https://eth.llamarpc.com',
        },
        mining: {
          mode: 'manual',
        },
      });

      this.initialized = true;
      console.log('TEVM validation service initialized');
    } catch (error) {
      console.error('Failed to initialize TEVM:', error);
      throw error;
    }
  }

  /**
   * Validate token approval status using TEVM simulation
   */
  async validateTokenApproval(
    tokenAddress: string,
    ownerAddress: string,
    spenderAddress: string,
    requiredAmount: string
  ): Promise<ValidationResult> {
    try {
      if (!this.initialized) await this.initialize();

      // Simulate allowance check
      const tokenContract = new ethers.Contract(
        tokenAddress,
        ERC20_ABI,
        new ethers.JsonRpcProvider(this.tevmClient.url)
      );

      const allowanceCall = await this.tevmClient.call({
        to: tokenAddress,
        data: tokenContract.interface.encodeFunctionData('allowance', [
          ownerAddress,
          spenderAddress,
        ]),
        from: ownerAddress,
      });

      if (!allowanceCall.success) {
        return {
          isValid: false,
          reason: 'Failed to check allowance',
        };
      }

      const allowance = tokenContract.interface.decodeFunctionResult(
        'allowance',
        allowanceCall.returnValue
      )[0];

      if (BigInt(allowance) < BigInt(requiredAmount)) {
        return {
          isValid: false,
          reason: `Insufficient allowance. Current: ${allowance}, Required: ${requiredAmount}`,
        };
      }

      return { isValid: true };
    } catch (error) {
      console.error('Token approval validation error:', error);
      return {
        isValid: false,
        reason: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Validate user has sufficient balance
   */
  async validateBalance(
    tokenAddress: string,
    userAddress: string,
    requiredAmount: string
  ): Promise<ValidationResult> {
    try {
      if (!this.initialized) await this.initialize();

      // Check if it's ETH or ERC20
      if (tokenAddress === ethers.ZeroAddress) {
        // ETH balance check
        const balance = await this.tevmClient.getBalance({ address: userAddress });
        
        if (BigInt(balance) < BigInt(requiredAmount)) {
          return {
            isValid: false,
            reason: `Insufficient ETH balance. Current: ${balance}, Required: ${requiredAmount}`,
          };
        }

        return { isValid: true };
      } else {
        // ERC20 balance check
        const tokenContract = new ethers.Contract(
          tokenAddress,
          ERC20_ABI,
          new ethers.JsonRpcProvider(this.tevmClient.url)
        );

        const balanceCall = await this.tevmClient.call({
          to: tokenAddress,
          data: tokenContract.interface.encodeFunctionData('balanceOf', [userAddress]),
          from: userAddress,
        });

        if (!balanceCall.success) {
          return {
            isValid: false,
            reason: 'Failed to check balance',
          };
        }

        const balance = tokenContract.interface.decodeFunctionResult(
          'balanceOf',
          balanceCall.returnValue
        )[0];

        if (BigInt(balance) < BigInt(requiredAmount)) {
          return {
            isValid: false,
            reason: `Insufficient token balance. Current: ${balance}, Required: ${requiredAmount}`,
          };
        }

        return { isValid: true };
      }
    } catch (error) {
      console.error('Balance validation error:', error);
      return {
        isValid: false,
        reason: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Simulate swap router behavior before signing
   */
  async simulateSwapExecution(params: OrderValidationParams): Promise<ValidationResult> {
    try {
      if (!this.initialized) await this.initialize();

      // First validate balance
      const balanceCheck = await this.validateBalance(
        params.sellToken,
        params.userAddress,
        params.sellAmount
      );

      if (!balanceCheck.isValid) {
        return balanceCheck;
      }

      // If not ETH, validate approval
      if (params.sellToken !== ethers.ZeroAddress) {
        const approvalCheck = await this.validateTokenApproval(
          params.sellToken,
          params.userAddress,
          params.routerAddress,
          params.sellAmount
        );

        if (!approvalCheck.isValid) {
          return approvalCheck;
        }
      }

      // Simulate the swap call
      const swapCall = await this.tevmClient.call({
        to: params.routerAddress,
        data: params.routerCalldata,
        from: params.userAddress,
        value: params.sellToken === ethers.ZeroAddress ? params.sellAmount : '0',
      });

      if (!swapCall.success) {
        // Decode revert reason if possible
        let revertReason = 'Swap simulation failed';
        try {
          if (swapCall.returnValue) {
            // Try to decode standard revert string
            const errorSig = swapCall.returnValue.slice(0, 10);
            if (errorSig === '0x08c379a0') {
              // Error(string)
              const abiCoder = new ethers.AbiCoder();
              const reason = abiCoder.decode(['string'], '0x' + swapCall.returnValue.slice(10))[0];
              revertReason = reason;
            }
          }
        } catch (e) {
          // Ignore decode errors
        }

        return {
          isValid: false,
          reason: revertReason,
        };
      }

      // Estimate gas for the transaction
      const gasEstimate = await this.tevmClient.estimateGas({
        to: params.routerAddress,
        data: params.routerCalldata,
        from: params.userAddress,
        value: params.sellToken === ethers.ZeroAddress ? params.sellAmount : '0',
      });

      return {
        isValid: true,
        gasEstimate: BigInt(gasEstimate),
        simulatedOutput: swapCall.returnValue,
      };
    } catch (error) {
      console.error('Swap simulation error:', error);
      return {
        isValid: false,
        reason: error instanceof Error ? error.message : 'Simulation failed',
      };
    }
  }

  /**
   * Validate complete order before submission
   */
  async validateOrder(order: any): Promise<ValidationResult> {
    try {
      if (!this.initialized) await this.initialize();

      // Basic validation
      if (!order.sellToken || !order.buyToken || !order.sellAmount || !order.user) {
        return {
          isValid: false,
          reason: 'Missing required order fields',
        };
      }

      // Check if order is expired
      const currentTime = Math.floor(Date.now() / 1000);
      if (order.validTo && order.validTo < currentTime) {
        return {
          isValid: false,
          reason: 'Order has expired',
        };
      }

      // Validate user balance
      const balanceCheck = await this.validateBalance(
        order.sellToken,
        order.user,
        order.sellAmount
      );

      if (!balanceCheck.isValid) {
        return balanceCheck;
      }

      // If we have router details, simulate the execution
      if (order.routerAddress && order.routerCalldata) {
        return await this.simulateSwapExecution({
          userAddress: order.user,
          sellToken: order.sellToken,
          buyToken: order.buyToken,
          sellAmount: order.sellAmount,
          routerAddress: order.routerAddress,
          routerCalldata: order.routerCalldata,
          chainId: order.chainId || 1,
        });
      }

      return { isValid: true };
    } catch (error) {
      console.error('Order validation error:', error);
      return {
        isValid: false,
        reason: error instanceof Error ? error.message : 'Validation failed',
      };
    }
  }

  /**
   * Estimate gas for order execution
   */
  async estimateOrderGas(order: any): Promise<bigint | null> {
    try {
      if (!this.initialized) await this.initialize();

      // Basic transfer gas estimates
      let baseGas = 21000n; // Base transaction cost

      if (order.sellToken === ethers.ZeroAddress) {
        // ETH transfer
        baseGas += 0n; // ETH transfers are included in base
      } else {
        // ERC20 transfer
        baseGas += 65000n; // Approximate ERC20 transfer cost
      }

      // Add swap router overhead if applicable
      if (order.routerAddress && order.routerCalldata) {
        const validation = await this.simulateSwapExecution({
          userAddress: order.user,
          sellToken: order.sellToken,
          buyToken: order.buyToken,
          sellAmount: order.sellAmount,
          routerAddress: order.routerAddress,
          routerCalldata: order.routerCalldata,
          chainId: order.chainId || 1,
        });

        if (validation.isValid && validation.gasEstimate) {
          return validation.gasEstimate;
        }
      }

      return baseGas;
    } catch (error) {
      console.error('Gas estimation error:', error);
      return null;
    }
  }

  /**
   * Reset TEVM state (useful between simulations)
   */
  async reset() {
    if (this.tevmClient) {
      await this.tevmClient.reset();
    }
  }

  /**
   * Clean up resources
   */
  async cleanup() {
    if (this.tevmClient) {
      await this.tevmClient.stop();
      this.initialized = false;
    }
  }
}

// Singleton instance
export const tevmValidator = new TevmValidationService();