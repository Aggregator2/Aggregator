import { ethers } from 'ethers';
import { 
  getTokenFeePercentage, 
  requiresSpecialApproval,
  isWrappedNativeToken,
  getActualDecimals 
} from '../config/tokenRegistry';

export interface FeeCalculation {
  grossAmount: string;
  feeAmount: string;
  netAmount: string;
  feePercentage: number;
}

export class SpecialTokenService {
  /**
   * Calculate the actual received amount after fee-on-transfer token fees
   */
  static calculateFeeOnTransferAmount(
    tokenAddress: string,
    chainId: number,
    grossAmount: string,
    decimals: number
  ): FeeCalculation {
    const feePercentage = getTokenFeePercentage(tokenAddress, chainId);
    
    if (feePercentage === 0) {
      return {
        grossAmount,
        feeAmount: '0',
        netAmount: grossAmount,
        feePercentage: 0
      };
    }

    try {
      const grossBigNumber = BigInt(grossAmount);
      const feeMultiplier = BigInt(Math.floor(feePercentage * 100)); // Convert percentage to basis points
      const feeBigNumber = (grossBigNumber * feeMultiplier) / BigInt(10000);
      const netBigNumber = grossBigNumber - feeBigNumber;

      return {
        grossAmount,
        feeAmount: feeBigNumber.toString(),
        netAmount: netBigNumber.toString(),
        feePercentage
      };
    } catch (error) {
      console.error('Error calculating fee-on-transfer amount:', error);
      return {
        grossAmount,
        feeAmount: '0',
        netAmount: grossAmount,
        feePercentage: 0
      };
    }
  }

  /**
   * Format amount with correct decimals, handling special cases
   */
  static formatTokenAmount(
    tokenAddress: string,
    chainId: number,
    amount: string,
    defaultDecimals: number
  ): string {
    const actualDecimals = getActualDecimals(tokenAddress, chainId, defaultDecimals);
    
    try {
      return ethers.formatUnits(amount, actualDecimals);
    } catch (error) {
      console.error('Error formatting token amount:', error);
      return '0';
    }
  }

  /**
   * Parse amount with correct decimals, handling special cases
   */
  static parseTokenAmount(
    tokenAddress: string,
    chainId: number,
    amount: string,
    defaultDecimals: number
  ): string {
    const actualDecimals = getActualDecimals(tokenAddress, chainId, defaultDecimals);
    
    try {
      return ethers.parseUnits(amount, actualDecimals).toString();
    } catch (error) {
      console.error('Error parsing token amount:', error);
      return '0';
    }
  }

  /**
   * Generate approval transaction data for tokens with non-standard approval
   */
  static async generateApprovalTx(
    tokenAddress: string,
    chainId: number,
    spenderAddress: string,
    amount: string,
    currentAllowance: string
  ): Promise<{ to: string; data: string; value: string }[]> {
    const transactions = [];

    // Check if token requires special approval handling (like USDT)
    if (requiresSpecialApproval(tokenAddress, chainId)) {
      // If current allowance is not zero, first set it to zero
      if (currentAllowance !== '0') {
        const erc20Interface = new ethers.Interface([
          'function approve(address spender, uint256 amount) returns (bool)'
        ]);

        const resetData = erc20Interface.encodeFunctionData('approve', [
          spenderAddress,
          '0'
        ]);

        transactions.push({
          to: tokenAddress,
          data: resetData,
          value: '0'
        });
      }
    }

    // Generate the actual approval transaction
    const erc20Interface = new ethers.Interface([
      'function approve(address spender, uint256 amount) returns (bool)'
    ]);

    const approveData = erc20Interface.encodeFunctionData('approve', [
      spenderAddress,
      amount
    ]);

    transactions.push({
      to: tokenAddress,
      data: approveData,
      value: '0'
    });

    return transactions;
  }

  /**
   * Check if token is wrapped native and can be unwrapped
   */
  static canUnwrap(tokenAddress: string, chainId: number): boolean {
    return isWrappedNativeToken(tokenAddress, chainId);
  }

  /**
   * Generate unwrap transaction data
   */
  static generateUnwrapTx(
    tokenAddress: string,
    amount: string
  ): { to: string; data: string; value: string } {
    const wethInterface = new ethers.Interface([
      'function withdraw(uint256 amount)'
    ]);

    const withdrawData = wethInterface.encodeFunctionData('withdraw', [amount]);

    return {
      to: tokenAddress,
      data: withdrawData,
      value: '0'
    };
  }

  /**
   * Check current allowance for a token
   */
  static async checkAllowance(
    provider: ethers.providers.Provider,
    tokenAddress: string,
    ownerAddress: string,
    spenderAddress: string
  ): Promise<string> {
    const erc20Interface = new ethers.Interface([
      'function allowance(address owner, address spender) view returns (uint256)'
    ]);

    try {
      const data = erc20Interface.encodeFunctionData('allowance', [
        ownerAddress,
        spenderAddress
      ]);

      const result = await provider.call({
        to: tokenAddress,
        data
      });

      const [allowance] = erc20Interface.decodeFunctionResult('allowance', result);
      return allowance.toString();
    } catch (error) {
      console.error('Error checking allowance:', error);
      return '0';
    }
  }

  /**
   * Validate token decimals match expected
   */
  static async validateTokenDecimals(
    provider: ethers.providers.Provider,
    tokenAddress: string,
    chainId: number,
    expectedDecimals: number
  ): Promise<boolean> {
    const actualDecimals = getActualDecimals(tokenAddress, chainId, expectedDecimals);
    
    if (actualDecimals !== expectedDecimals) {
      console.warn(
        `Token ${tokenAddress} on chain ${chainId} has ${actualDecimals} decimals, ` +
        `but ${expectedDecimals} was expected`
      );
    }

    // Always return true but log the warning
    return true;
  }
}