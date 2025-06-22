import { ethers } from 'ethers';
import { 
  SwapRoute, 
  ExecutionResult, 
  TransactionRecord, 
  SwapStep,
  BridgeStatus 
} from './types';
import { BridgeAggregator } from './BridgeAggregator';
import { DEXAggregator } from './DEXAggregator';
import { TokenService } from './TokenService';
import { sleep, createRetryWithBackoff } from './utils';

export class ExecutionEngine {
  private bridgeAggregator: BridgeAggregator;
  private dexAggregator: DEXAggregator;
  private tokenService: TokenService;
  private signers: Map<number, ethers.Signer>;

  constructor(
    bridgeAggregator: BridgeAggregator,
    dexAggregator: DEXAggregator,
    tokenService: TokenService,
    signers?: Map<number, ethers.Signer>
  ) {
    this.bridgeAggregator = bridgeAggregator;
    this.dexAggregator = dexAggregator;
    this.tokenService = tokenService;
    this.signers = signers || new Map();
  }

  async executeRoute(
    route: SwapRoute,
    userAddress: string,
    signer?: ethers.Signer
  ): Promise<ExecutionResult> {
    const transactions: TransactionRecord[] = [];
    let currentStepIndex = 0;
    let lastSuccessfulAmount = route.steps[0].fromAmount;

    try {
      for (const step of route.steps) {
        console.log(`Executing step ${currentStepIndex + 1}/${route.steps.length}: ${step.type} on chain ${step.chainId}`);
        
        // Check and handle approvals if needed
        if (step.type === 'swap' || step.type === 'bridge') {
          await this.ensureApproval(step, userAddress, signer);
        }

        // Execute the step
        const txRecord = await this.executeStep(step, userAddress, signer);
        transactions.push(txRecord);

        // Wait for transaction confirmation
        await this.waitForTransaction(txRecord);

        // If this is a bridge step, wait for bridge completion
        if (step.type === 'bridge') {
          console.log('Waiting for bridge completion...');
          await this.waitForBridgeCompletion(step, txRecord.txHash);
          lastSuccessfulAmount = step.estimatedToAmount;
        }

        currentStepIndex++;
      }

      // Verify final amount received
      const finalAmount = await this.verifyFinalAmount(
        route.steps[route.steps.length - 1].toToken,
        userAddress
      );

      return {
        success: true,
        routeId: route.id,
        transactions,
        finalAmount
      };
    } catch (error) {
      console.error('Execution failed:', error);
      return {
        success: false,
        routeId: route.id,
        transactions,
        error: error instanceof Error ? error.message : 'Unknown error',
        failedAtStep: currentStepIndex
      };
    }
  }

  private async executeStep(
    step: SwapStep,
    userAddress: string,
    signer?: ethers.Signer
  ): Promise<TransactionRecord> {
    const stepSigner = signer || this.signers.get(step.chainId);
    if (!stepSigner) {
      throw new Error(`No signer available for chain ${step.chainId}`);
    }

    let tx: ethers.TransactionResponse;
    const timestamp = Date.now();

    if (step.type === 'swap') {
      tx = await this.executeDEXSwap(step, userAddress, stepSigner);
    } else if (step.type === 'bridge') {
      tx = await this.executeBridge(step, userAddress, stepSigner);
    } else {
      throw new Error(`Unknown step type: ${step.type}`);
    }

    return {
      stepIndex: step.chainId,
      chainId: step.chainId,
      txHash: tx.hash,
      status: 'pending',
      timestamp
    };
  }

  private async executeDEXSwap(
    step: SwapStep,
    userAddress: string,
    signer: ethers.Signer
  ): Promise<ethers.TransactionResponse> {
    const txData = await this.dexAggregator.getBuildTx(
      {
        dexId: step.protocol,
        dexName: step.protocol,
        chainId: step.chainId,
        fromToken: step.fromToken.address,
        toToken: step.toToken.address,
        fromAmount: step.fromAmount,
        toAmount: step.estimatedToAmount,
        priceImpact: 0,
        gasCost: step.gasCost,
        gasPrice: step.gasPrice || '0',
        path: [],
        data: step.data
      },
      userAddress
    );

    // Execute transaction
    const tx = await signer.sendTransaction({
      to: txData.to,
      data: txData.data,
      value: txData.value || 0,
      gasLimit: txData.gas || step.gasCost,
      gasPrice: txData.gasPrice
    });

    return tx;
  }

  private async executeBridge(
    step: SwapStep,
    userAddress: string,
    signer: ethers.Signer
  ): Promise<ethers.TransactionResponse> {
    const bridgeQuote = {
      bridgeId: step.protocol,
      bridgeName: step.protocol,
      fromChainId: step.chainId,
      toChainId: step.toToken.chainId,
      fromToken: step.fromToken.address,
      toToken: step.toToken.address,
      fromAmount: step.fromAmount,
      toAmount: step.estimatedToAmount,
      toAmountMin: step.estimatedToAmount,
      bridgeFee: '0',
      bridgeFeeUSD: 0,
      estimatedTime: 0,
      reliability: 0,
      data: step.data
    };

    const txData = await this.bridgeAggregator.getBuildTx(bridgeQuote, userAddress);

    // Execute transaction
    const tx = await signer.sendTransaction({
      to: txData.to,
      data: txData.data,
      value: txData.value || 0,
      gasLimit: step.gasCost
    });

    return tx;
  }

  private async ensureApproval(
    step: SwapStep,
    userAddress: string,
    signer?: ethers.Signer
  ): Promise<void> {
    // Skip approval for native token
    if (step.fromToken.address === ethers.ZeroAddress) {
      return;
    }

    const stepSigner = signer || this.signers.get(step.chainId);
    if (!stepSigner) {
      throw new Error(`No signer available for chain ${step.chainId}`);
    }

    const provider = stepSigner.provider;
    if (!provider) {
      throw new Error('Signer has no provider');
    }

    // Get spender address based on step type
    let spender: string;
    if (step.type === 'swap') {
      // Get router address from DEX aggregator
      // This is simplified - in reality you'd get the actual router address
      spender = await this.getDEXRouterAddress(step.protocol, step.chainId);
    } else if (step.type === 'bridge') {
      // Get bridge contract address
      spender = await this.getBridgeContractAddress(step.protocol, step.chainId);
    } else {
      return;
    }

    // Check current allowance
    const tokenContract = new ethers.Contract(
      step.fromToken.address,
      [
        'function allowance(address owner, address spender) view returns (uint256)',
        'function approve(address spender, uint256 amount) returns (bool)'
      ],
      provider
    );

    const currentAllowance = await tokenContract.allowance(userAddress, spender);
    const requiredAmount = BigInt(step.fromAmount);

    if (currentAllowance < requiredAmount) {
      console.log(`Approving ${step.fromToken.symbol} for ${step.protocol}...`);
      
      // Approve max uint256 for convenience
      const approveTx = await (tokenContract.connect(stepSigner) as any).approve(
        spender,
        ethers.MaxUint256
      );
      
      await approveTx.wait();
      console.log('Approval confirmed');
    }
  }

  private async waitForTransaction(txRecord: TransactionRecord): Promise<void> {
    const provider = this.signers.get(txRecord.chainId)?.provider;
    if (!provider) {
      throw new Error(`No provider for chain ${txRecord.chainId}`);
    }

    const receipt = await provider.waitForTransaction(txRecord.txHash, 2); // 2 confirmations
    
    if (!receipt || receipt.status === 0) {
      txRecord.status = 'failed';
      throw new Error(`Transaction failed: ${txRecord.txHash}`);
    }

    txRecord.status = 'success';
    txRecord.gasUsed = receipt.gasUsed.toString();
  }

  private async waitForBridgeCompletion(
    step: SwapStep,
    txHash: string,
    maxWaitTime: number = 3600000 // 1 hour
  ): Promise<void> {
    const startTime = Date.now();
    const checkInterval = 30000; // Check every 30 seconds

    while (Date.now() - startTime < maxWaitTime) {
      try {
        const status = await this.bridgeAggregator.checkStatus(
          step.protocol,
          txHash,
          step.chainId
        );

        if (status.status === 'completed') {
          console.log('Bridge transfer completed');
          return;
        } else if (status.status === 'failed') {
          throw new Error(`Bridge transfer failed: ${status.error}`);
        }

        // Still pending, wait before checking again
        await sleep(checkInterval);
      } catch (error) {
        console.error('Error checking bridge status:', error);
        // Continue waiting unless it's a critical error
        await sleep(checkInterval);
      }
    }

    throw new Error('Bridge transfer timeout');
  }

  private async verifyFinalAmount(
    token: { address: string; chainId: number },
    userAddress: string
  ): Promise<string> {
    // In a real implementation, you'd track the balance before and after
    // For now, just return the current balance
    return this.tokenService.getTokenBalance(
      token.chainId,
      token.address,
      userAddress
    );
  }

  private async getDEXRouterAddress(protocol: string, chainId: number): Promise<string> {
    // Simplified - in reality, fetch from DEX aggregator
    const routers: Record<string, Record<number, string>> = {
      '1inch': {
        1: '0x1111111254fb6c44bAC0beD2854e76F90643097d',
        56: '0x1111111254fb6c44bAC0beD2854e76F90643097d',
        137: '0x1111111254fb6c44bAC0beD2854e76F90643097d'
      },
      'uniswap': {
        1: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
        137: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
        42161: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45'
      }
    };

    return routers[protocol]?.[chainId] || ethers.ZeroAddress;
  }

  private async getBridgeContractAddress(protocol: string, chainId: number): Promise<string> {
    // Simplified - in reality, fetch from bridge aggregator
    const bridges: Record<string, Record<number, string>> = {
      'lifi': {
        1: '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE',
        56: '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE',
        137: '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE'
      }
    };

    return bridges[protocol]?.[chainId] || ethers.ZeroAddress;
  }
}