import { ethers } from 'ethers';
import TronWeb from 'tronweb';
import { Connection, PublicKey } from '@solana/web3.js';
import { SUPPORTED_CHAINS, ChainConfig } from '../../types/token';
import { logger } from '../../utils/logger';

export class ProviderService {
  private providers: Map<number, any> = new Map();

  getProviderForChain(chainId: number): any {
    if (this.providers.has(chainId)) {
      return this.providers.get(chainId);
    }

    const chainConfig = SUPPORTED_CHAINS[chainId];
    if (!chainConfig) {
      throw new Error(`Unsupported chain ID: ${chainId}`);
    }

    let provider: any;

    switch (chainConfig.type) {
      case 'EVM':
        provider = this.createEVMProvider(chainConfig);
        break;
      case 'TRON':
        provider = this.createTronProvider(chainConfig);
        break;
      case 'SOLANA':
        provider = this.createSolanaProvider(chainConfig);
        break;
      default:
        throw new Error(`Unsupported chain type: ${chainConfig.type}`);
    }

    this.providers.set(chainId, provider);
    return provider;
  }

  private createEVMProvider(chainConfig: ChainConfig): ethers.JsonRpcProvider {
    return new ethers.JsonRpcProvider(chainConfig.rpcUrl);
  }

  private createTronProvider(chainConfig: ChainConfig): any {
    const HttpProvider = TronWeb.providers.HttpProvider;
    const fullNode = new HttpProvider(chainConfig.rpcUrl);
    const solidityNode = new HttpProvider(chainConfig.rpcUrl);
    const eventServer = new HttpProvider(chainConfig.rpcUrl);

    return new TronWeb(fullNode, solidityNode, eventServer);
  }

  private createSolanaProvider(chainConfig: ChainConfig): Connection {
    return new Connection(chainConfig.rpcUrl, 'confirmed');
  }

  async getTokenBalance(
    chainId: number,
    tokenAddress: string,
    walletAddress: string
  ): Promise<string> {
    const chainConfig = SUPPORTED_CHAINS[chainId];
    if (!chainConfig) {
      throw new Error(`Unsupported chain ID: ${chainId}`);
    }

    try {
      switch (chainConfig.type) {
        case 'EVM':
          return this.getEVMTokenBalance(chainId, tokenAddress, walletAddress);
        case 'TRON':
          return this.getTronTokenBalance(tokenAddress, walletAddress);
        case 'SOLANA':
          return this.getSolanaTokenBalance(tokenAddress, walletAddress);
        default:
          throw new Error(`Unsupported chain type: ${chainConfig.type}`);
      }
    } catch (error) {
      logger.error('Error getting token balance:', error);
      throw error;
    }
  }

  private async getEVMTokenBalance(
    chainId: number,
    tokenAddress: string,
    walletAddress: string
  ): Promise<string> {
    const provider = this.getProviderForChain(chainId);
    const erc20Abi = [
      'function balanceOf(address account) view returns (uint256)',
      'function decimals() view returns (uint8)'
    ];

    const contract = new ethers.Contract(tokenAddress, erc20Abi, provider);
    const balance = await contract.balanceOf(walletAddress);
    const decimals = await contract.decimals();

    return ethers.formatUnits(balance, decimals);
  }

  private async getTronTokenBalance(
    tokenAddress: string,
    walletAddress: string
  ): Promise<string> {
    const tronWeb = this.getProviderForChain(1001);
    tronWeb.setAddress(walletAddress);

    const contract = await tronWeb.contract().at(tokenAddress);
    const balance = await contract.balanceOf(walletAddress).call();
    const decimals = await contract.decimals().call();

    return (balance / Math.pow(10, decimals)).toString();
  }

  private async getSolanaTokenBalance(
    tokenAddress: string,
    walletAddress: string
  ): Promise<string> {
    const connection = this.getProviderForChain(101);
    const walletPubkey = new PublicKey(walletAddress);
    const tokenPubkey = new PublicKey(tokenAddress);

    const tokenAccounts = await connection.getTokenAccountsByOwner(
      walletPubkey,
      { mint: tokenPubkey }
    );

    if (tokenAccounts.value.length === 0) {
      return '0';
    }

    const balance = await connection.getTokenAccountBalance(
      tokenAccounts.value[0].pubkey
    );

    return balance.value.uiAmountString || '0';
  }

  async validateAddress(chainId: number, address: string): Promise<boolean> {
    const chainConfig = SUPPORTED_CHAINS[chainId];
    if (!chainConfig) {
      return false;
    }

    try {
      switch (chainConfig.type) {
        case 'EVM':
          return ethers.isAddress(address);
        case 'TRON':
          return TronWeb.isAddress(address);
        case 'SOLANA':
          try {
            new PublicKey(address);
            return true;
          } catch {
            return false;
          }
        default:
          return false;
      }
    } catch {
      return false;
    }
  }

  async getTransactionStatus(chainId: number, txHash: string): Promise<any> {
    const chainConfig = SUPPORTED_CHAINS[chainId];
    if (!chainConfig) {
      throw new Error(`Unsupported chain ID: ${chainId}`);
    }

    try {
      switch (chainConfig.type) {
        case 'EVM':
          return this.getEVMTransactionStatus(chainId, txHash);
        case 'TRON':
          return this.getTronTransactionStatus(txHash);
        case 'SOLANA':
          return this.getSolanaTransactionStatus(txHash);
        default:
          throw new Error(`Unsupported chain type: ${chainConfig.type}`);
      }
    } catch (error) {
      logger.error('Error getting transaction status:', error);
      throw error;
    }
  }

  private async getEVMTransactionStatus(chainId: number, txHash: string): Promise<any> {
    const provider = this.getProviderForChain(chainId);
    const receipt = await provider.getTransactionReceipt(txHash);

    if (!receipt) {
      return { status: 'pending' };
    }

    return {
      status: receipt.status === 1 ? 'success' : 'failed',
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      confirmations: await provider.getBlockNumber() - receipt.blockNumber
    };
  }

  private async getTronTransactionStatus(txHash: string): Promise<any> {
    const tronWeb = this.getProviderForChain(1001);
    const transaction = await tronWeb.trx.getTransactionInfo(txHash);

    if (!transaction || !transaction.id) {
      return { status: 'pending' };
    }

    return {
      status: transaction.receipt.result === 'SUCCESS' ? 'success' : 'failed',
      blockNumber: transaction.blockNumber,
      fee: transaction.fee,
      energy: transaction.receipt.energy_usage_total
    };
  }

  private async getSolanaTransactionStatus(txHash: string): Promise<any> {
    const connection = this.getProviderForChain(101);
    const signature = await connection.getSignatureStatus(txHash);

    if (!signature || !signature.value) {
      return { status: 'pending' };
    }

    return {
      status: signature.value.err ? 'failed' : 'success',
      slot: signature.value.slot,
      confirmations: signature.value.confirmations,
      confirmationStatus: signature.value.confirmationStatus
    };
  }
}

export const providerService = new ProviderService();