import { EventEmitter } from 'events';
import { ethers } from 'ethers';
import { EnhancedFinalSettlementEngine } from './EnhancedFinalSettlementEngine';
import { SettlementProofEngine, SettlementLeaf } from './SettlementProofEngine';
import { MerkleTree } from '../../utils/merkleTree';
import { db, TransactionClient } from '../../database/config';
import { logger } from '../../utils/logger';
import * as ipfsClient from 'ipfs-http-client';

interface ProofConfiguration {
  enabled: boolean;
  contractAddress: string;
  contractABI: any[];
  ipfsEnabled: boolean;
  ipfsApiUrl?: string;
  confirmationBlocks: number;
}

export class ProofEnabledFinalSettlementEngine extends EnhancedFinalSettlementEngine {
  private proofEngine: SettlementProofEngine;
  private provider: ethers.providers.Provider;
  private signer: ethers.Signer;
  private proofConfig: ProofConfiguration;
  private ipfs?: any;

  constructor(
    config: any,
    provider: ethers.providers.Provider,
    signer: ethers.Signer,
    proofConfig: ProofConfiguration
  ) {
    super(config);
    
    this.provider = provider;
    this.signer = signer;
    this.proofConfig = proofConfig;

    if (proofConfig.enabled) {
      this.proofEngine = new SettlementProofEngine(
        provider,
        proofConfig.contractAddress,
        proofConfig.contractABI
      );

      if (proofConfig.ipfsEnabled && proofConfig.ipfsApiUrl) {
        this.ipfs = ipfsClient.create({ url: proofConfig.ipfsApiUrl });
      }
    }
  }

  async initialize(): Promise<void> {
    await super.initialize();
    
    if (this.proofConfig.enabled) {
      logger.info('Settlement proof generation enabled', {
        contractAddress: this.proofConfig.contractAddress
      });
    }
  }

  /**
   * Override processSameChainSettlements to include proof generation
   */
  protected async processSameChainSettlements(
    epochId: string,
    trades: any[]
  ): Promise<{ settledCount: number; failedCount: number; proofGenerated?: boolean }> {
    const netPositions = this.calculateNetPositions(trades);
    
    return await db.transaction(async (client: TransactionClient) => {
      // Process settlements as before
      const settlementDetails = this.createSettlementDetails(epochId, netPositions, trades);
      await this.settlementRepo.createSettlementDetails(settlementDetails, client);
      
      let settledCount = 0;
      let failedCount = 0;
      
      for (const position of netPositions) {
        try {
          await this.processUserSettlement(position, epochId, client);
          settledCount++;
        } catch (error) {
          logger.error('Failed to settle user position', { 
            userId: position.userId, 
            currency: position.currency, 
            error 
          });
          failedCount++;
        }
      }
      
      // Mark trades as settled
      const tradeIds = trades.map(t => t.id);
      await this.settlementRepo.markTradesAsSettled(tradeIds, epochId, client);
      
      let proofGenerated = false;
      
      // Generate and submit proofs if enabled
      if (this.proofConfig.enabled && settledCount > 0) {
        try {
          await this.generateAndSubmitProofs(epochId, netPositions, trades, client);
          proofGenerated = true;
        } catch (error) {
          logger.error('Failed to generate settlement proofs', { epochId, error });
          // Don't fail the entire settlement if proof generation fails
        }
      }
      
      return { settledCount, failedCount, proofGenerated };
    });
  }

  /**
   * Generate Merkle proofs and submit to blockchain
   */
  private async generateAndSubmitProofs(
    epochId: string,
    netPositions: any[],
    trades: any[],
    client: TransactionClient
  ): Promise<void> {
    logger.info('Generating settlement proofs', { epochId });

    // Prepare settlement leaves
    const settlementLeaves: SettlementLeaf[] = netPositions.map(position => ({
      tradeId: `NET_${position.userId}_${position.currency}`,
      userId: position.userId,
      token: this.getTokenAddress(position.currency), // Map currency to token address
      amount: ethers.utils.parseEther(Math.abs(position.netAmount).toString()).toString()
    }));

    // Generate Merkle tree and proofs
    const { merkleTree, merkleRoot, proofs } = await this.proofEngine.generateSettlementProofs(
      epochId,
      settlementLeaves
    );

    // Upload full data to IPFS if enabled
    let ipfsHash = '';
    if (this.proofConfig.ipfsEnabled && this.ipfs) {
      ipfsHash = await this.uploadToIPFS(epochId, settlementLeaves, merkleRoot);
    }

    // Submit to blockchain
    const { transactionHash, blockNumber, timestamp } = await this.proofEngine.submitSettlementBatch(
      epochId,
      merkleRoot,
      settlementLeaves.length,
      ipfsHash,
      this.signer
    );

    // Store proofs in database
    await this.proofEngine.storeProofs(
      epochId,
      settlementLeaves,
      merkleTree,
      transactionHash,
      blockNumber,
      client
    );

    // Update epoch with proof information
    await this.updateEpochWithProof(
      epochId,
      merkleRoot,
      transactionHash,
      blockNumber,
      ipfsHash,
      client
    );

    // Wait for confirmations
    await this.waitForConfirmations(transactionHash);

    // Finalize the batch on-chain
    await this.finalizeSettlementBatch(epochId);

    logger.info('Settlement proofs generated and submitted', {
      epochId,
      merkleRoot,
      transactionHash,
      blockNumber,
      leafCount: settlementLeaves.length
    });

    this.emit('proofGenerated', {
      epochId,
      merkleRoot,
      transactionHash,
      blockNumber,
      proofCount: proofs.size
    });
  }

  /**
   * Upload settlement data to IPFS
   */
  private async uploadToIPFS(
    epochId: string,
    settlements: SettlementLeaf[],
    merkleRoot: string
  ): Promise<string> {
    try {
      const data = {
        epochId,
        merkleRoot,
        timestamp: new Date().toISOString(),
        settlements: settlements.map(s => ({
          tradeId: s.tradeId,
          userId: s.userId,
          token: s.token,
          amount: s.amount
        }))
      };

      const result = await this.ipfs.add(JSON.stringify(data, null, 2));
      logger.info('Settlement data uploaded to IPFS', {
        epochId,
        ipfsHash: result.path
      });

      return result.path;
    } catch (error) {
      logger.error('Failed to upload to IPFS', { epochId, error });
      return '';
    }
  }

  /**
   * Update epoch record with proof information
   */
  private async updateEpochWithProof(
    epochId: string,
    merkleRoot: string,
    transactionHash: string,
    blockNumber: number,
    ipfsHash: string,
    client: TransactionClient
  ): Promise<void> {
    const query = `
      UPDATE settlement_epochs
      SET 
        merkle_root = $2,
        proof_tx_hash = $3,
        proof_block_number = $4,
        ipfs_hash = $5
      WHERE id = $1
    `;

    await client.query(query, [
      epochId,
      merkleRoot,
      transactionHash,
      blockNumber,
      ipfsHash
    ]);
  }

  /**
   * Wait for transaction confirmations
   */
  private async waitForConfirmations(transactionHash: string): Promise<void> {
    const confirmations = this.proofConfig.confirmationBlocks || 2;
    
    logger.info('Waiting for confirmations', {
      transactionHash,
      requiredConfirmations: confirmations
    });

    const receipt = await this.provider.getTransactionReceipt(transactionHash);
    if (!receipt) {
      throw new Error('Transaction receipt not found');
    }

    let currentBlock = await this.provider.getBlockNumber();
    let confirmedBlocks = currentBlock - receipt.blockNumber;

    while (confirmedBlocks < confirmations) {
      await new Promise(resolve => setTimeout(resolve, 15000)); // Wait 15 seconds
      currentBlock = await this.provider.getBlockNumber();
      confirmedBlocks = currentBlock - receipt.blockNumber;
      
      logger.info('Confirmation progress', {
        confirmedBlocks,
        requiredConfirmations: confirmations
      });
    }
  }

  /**
   * Finalize settlement batch on-chain
   */
  private async finalizeSettlementBatch(epochId: string): Promise<void> {
    try {
      const contractWithSigner = this.proofEngine['settlementContract'].connect(this.signer);
      
      const tx = await contractWithSigner.finalizeSettlementBatch(epochId);
      await tx.wait();
      
      logger.info('Settlement batch finalized on-chain', { epochId });
    } catch (error) {
      logger.error('Failed to finalize settlement batch', { epochId, error });
      throw error;
    }
  }

  /**
   * Map currency symbol to token address
   */
  private getTokenAddress(currency: string): string {
    // This should be configured based on your token mappings
    const tokenMap: { [key: string]: string } = {
      'USDT': '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      'USDC': '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      'DAI': '0x6B175474E89094C44Da98b954EedeAC495271d0F',
      'WBTC': '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
      'WETH': '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      // Add more mappings as needed
    };

    return tokenMap[currency] || ethers.constants.AddressZero;
  }

  /**
   * Get proof for a specific trade
   */
  async getSettlementProof(tradeId: string): Promise<any> {
    if (!this.proofConfig.enabled) {
      throw new Error('Proof generation is not enabled');
    }

    return await this.proofEngine.getProofByTradeId(tradeId);
  }

  /**
   * Get all proofs for a user in an epoch
   */
  async getUserProofs(userId: string, epochId: string): Promise<any[]> {
    if (!this.proofConfig.enabled) {
      throw new Error('Proof generation is not enabled');
    }

    return await this.proofEngine.getProofsByUserAndEpoch(userId, epochId);
  }

  /**
   * Verify a proof on-chain
   */
  async verifyProof(
    epochId: string,
    userId: string,
    token: string,
    amount: string,
    merkleProof: string[]
  ): Promise<boolean> {
    if (!this.proofConfig.enabled) {
      throw new Error('Proof generation is not enabled');
    }

    return await this.proofEngine.verifyProofOnChain(
      epochId,
      userId,
      token,
      amount,
      merkleProof
    );
  }

  /**
   * Generate Etherscan verification URL
   */
  generateVerificationUrl(proof: any, chainId: number = 1): any {
    if (!this.proofConfig.enabled) {
      throw new Error('Proof generation is not enabled');
    }

    return this.proofEngine.generateEtherscanVerification(proof, chainId);
  }

  async shutdown(): Promise<void> {
    await super.shutdown();
    
    if (this.proofEngine) {
      this.proofEngine.removeAllListeners();
    }
  }
}