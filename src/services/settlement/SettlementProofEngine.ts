import { EventEmitter } from 'events';
import { ethers } from 'ethers';
import { MerkleTree, MerkleLeaf, MerkleProof } from '../../utils/merkleTree';
import { db, TransactionClient } from '../../database/config';
import { logger } from '../../utils/logger';

export interface SettlementProofData {
  epochId: string;
  transactionHash: string;
  blockNumber: number;
  merkleRoot: string;
  settlements: SettlementLeaf[];
  timestamp: Date;
}

export interface SettlementLeaf {
  tradeId: string;
  userId: string;
  token: string;
  amount: string;
}

export interface StoredProof {
  id: string;
  epochId: string;
  tradeId: string;
  userId: string;
  token: string;
  amount: string;
  merkleProof: string; // Compact encoded proof
  merkleRoot: string;
  leafIndex: number;
  transactionHash: string;
  blockNumber: number;
  createdAt: Date;
}

export class SettlementProofEngine extends EventEmitter {
  private provider: ethers.providers.Provider;
  private settlementContract: ethers.Contract;
  private contractAddress: string;

  constructor(
    provider: ethers.providers.Provider,
    settlementContractAddress: string,
    settlementContractABI: any[]
  ) {
    super();
    this.provider = provider;
    this.contractAddress = settlementContractAddress;
    this.settlementContract = new ethers.Contract(
      settlementContractAddress,
      settlementContractABI,
      provider
    );
  }

  /**
   * Generate Merkle tree and proofs for a settlement batch
   */
  async generateSettlementProofs(
    epochId: string,
    settlements: SettlementLeaf[]
  ): Promise<{
    merkleTree: MerkleTree;
    merkleRoot: string;
    proofs: Map<string, MerkleProof>;
  }> {
    logger.info('Generating settlement proofs', {
      epochId,
      settlementCount: settlements.length
    });

    // Convert settlements to Merkle leaves
    const leaves: MerkleLeaf[] = settlements.map(s => ({
      userId: s.userId,
      token: s.token,
      amount: s.amount
    }));

    // Create Merkle tree
    const merkleTree = new MerkleTree(leaves);
    const merkleRoot = merkleTree.getRoot();

    // Generate all proofs
    const proofs = merkleTree.getAllProofs();

    logger.info('Settlement proofs generated', {
      epochId,
      merkleRoot,
      proofCount: proofs.size
    });

    return { merkleTree, merkleRoot, proofs };
  }

  /**
   * Submit settlement batch to blockchain and capture transaction details
   */
  async submitSettlementBatch(
    epochId: string,
    merkleRoot: string,
    totalSettlements: number,
    ipfsHash: string = '',
    signer: ethers.Signer
  ): Promise<{
    transactionHash: string;
    blockNumber: number;
    timestamp: number;
  }> {
    try {
      const contractWithSigner = this.settlementContract.connect(signer);

      // Submit batch to contract
      const tx = await contractWithSigner.createSettlementBatch(
        epochId,
        merkleRoot,
        totalSettlements,
        ipfsHash
      );

      logger.info('Settlement batch transaction submitted', {
        epochId,
        transactionHash: tx.hash
      });

      // Wait for confirmation
      const receipt = await tx.wait();

      logger.info('Settlement batch confirmed', {
        epochId,
        transactionHash: receipt.transactionHash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString()
      });

      // Get block timestamp
      const block = await this.provider.getBlock(receipt.blockNumber);

      return {
        transactionHash: receipt.transactionHash,
        blockNumber: receipt.blockNumber,
        timestamp: block.timestamp
      };
    } catch (error) {
      logger.error('Failed to submit settlement batch', { epochId, error });
      throw error;
    }
  }

  /**
   * Store proofs in database after successful blockchain submission
   */
  async storeProofs(
    epochId: string,
    settlements: SettlementLeaf[],
    merkleTree: MerkleTree,
    transactionHash: string,
    blockNumber: number,
    client?: TransactionClient
  ): Promise<void> {
    const dbClient = client || db;

    try {
      const proofRecords: any[] = [];
      const merkleRoot = merkleTree.getRoot();

      for (const settlement of settlements) {
        const leaf: MerkleLeaf = {
          userId: settlement.userId,
          token: settlement.token,
          amount: settlement.amount
        };

        const proof = merkleTree.getProofForLeaf(leaf);
        if (!proof) {
          logger.error('Failed to generate proof for settlement', { settlement });
          continue;
        }

        // Store compact proof
        const compactProof = merkleTree.getCompactProof(proof.leaf);
        if (!compactProof) continue;

        proofRecords.push({
          epoch_id: epochId,
          trade_id: settlement.tradeId,
          user_id: settlement.userId,
          token: settlement.token,
          amount: settlement.amount,
          merkle_proof: compactProof,
          merkle_root: merkleRoot,
          leaf_index: proof.index,
          transaction_hash: transactionHash,
          block_number: blockNumber
        });
      }

      // Batch insert proofs
      if (proofRecords.length > 0) {
        const query = `
          INSERT INTO settlement_proofs (
            epoch_id, trade_id, user_id, token, amount,
            merkle_proof, merkle_root, leaf_index,
            transaction_hash, block_number
          ) VALUES ${proofRecords.map((_, i) => 
            `($${i*10+1}, $${i*10+2}, $${i*10+3}, $${i*10+4}, $${i*10+5}, $${i*10+6}, $${i*10+7}, $${i*10+8}, $${i*10+9}, $${i*10+10})`
          ).join(', ')}
        `;

        const values = proofRecords.flatMap(r => [
          r.epoch_id, r.trade_id, r.user_id, r.token, r.amount,
          r.merkle_proof, r.merkle_root, r.leaf_index,
          r.transaction_hash, r.block_number
        ]);

        await dbClient.query(query, values);

        logger.info('Settlement proofs stored', {
          epochId,
          proofCount: proofRecords.length
        });
      }
    } catch (error) {
      logger.error('Failed to store settlement proofs', { epochId, error });
      throw error;
    }
  }

  /**
   * Retrieve proof for a specific trade
   */
  async getProofByTradeId(tradeId: string): Promise<StoredProof | null> {
    try {
      const query = `
        SELECT 
          id, epoch_id, trade_id, user_id, token, amount,
          merkle_proof, merkle_root, leaf_index,
          transaction_hash, block_number, created_at
        FROM settlement_proofs
        WHERE trade_id = $1
      `;

      const result = await db.query(query, [tradeId]);
      
      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return {
        id: row.id,
        epochId: row.epoch_id,
        tradeId: row.trade_id,
        userId: row.user_id,
        token: row.token,
        amount: row.amount,
        merkleProof: row.merkle_proof,
        merkleRoot: row.merkle_root,
        leafIndex: row.leaf_index,
        transactionHash: row.transaction_hash,
        blockNumber: row.block_number,
        createdAt: row.created_at
      };
    } catch (error) {
      logger.error('Failed to retrieve proof', { tradeId, error });
      throw error;
    }
  }

  /**
   * Get all proofs for a user in an epoch
   */
  async getProofsByUserAndEpoch(
    userId: string,
    epochId: string
  ): Promise<StoredProof[]> {
    try {
      const query = `
        SELECT 
          id, epoch_id, trade_id, user_id, token, amount,
          merkle_proof, merkle_root, leaf_index,
          transaction_hash, block_number, created_at
        FROM settlement_proofs
        WHERE user_id = $1 AND epoch_id = $2
        ORDER BY created_at DESC
      `;

      const result = await db.query(query, [userId, epochId]);
      
      return result.rows.map(row => ({
        id: row.id,
        epochId: row.epoch_id,
        tradeId: row.trade_id,
        userId: row.user_id,
        token: row.token,
        amount: row.amount,
        merkleProof: row.merkle_proof,
        merkleRoot: row.merkle_root,
        leafIndex: row.leaf_index,
        transactionHash: row.transaction_hash,
        blockNumber: row.block_number,
        createdAt: row.created_at
      }));
    } catch (error) {
      logger.error('Failed to retrieve user proofs', { userId, epochId, error });
      throw error;
    }
  }

  /**
   * Verify a proof against the on-chain Merkle root
   */
  async verifyProofOnChain(
    epochId: string,
    userId: string,
    token: string,
    amount: string,
    merkleProof: string[]
  ): Promise<boolean> {
    try {
      const isValid = await this.settlementContract.verifyProof(
        epochId,
        userId,
        token,
        amount,
        merkleProof
      );

      return isValid;
    } catch (error) {
      logger.error('Failed to verify proof on-chain', { epochId, userId, error });
      return false;
    }
  }

  /**
   * Generate Etherscan-compatible verification data
   */
  generateEtherscanVerification(
    proof: StoredProof,
    chainId: number = 1
  ): {
    verificationUrl: string;
    contractAddress: string;
    methodName: string;
    calldata: string;
  } {
    // Decode the compact proof
    const decodedProof = MerkleTree.decodeCompactProof(proof.merkleProof);

    // Generate calldata for verification
    const iface = new ethers.utils.Interface([
      'function verifyProof(string epochId, address user, address token, uint256 amount, bytes32[] merkleProof) view returns (bool)'
    ]);

    const calldata = iface.encodeFunctionData('verifyProof', [
      proof.epochId,
      proof.userId,
      proof.token,
      proof.amount,
      decodedProof.proof
    ]);

    // Generate Etherscan URL based on chain
    const baseUrl = this.getEtherscanBaseUrl(chainId);
    const verificationUrl = `${baseUrl}/address/${this.contractAddress}#readContract`;

    return {
      verificationUrl,
      contractAddress: this.contractAddress,
      methodName: 'verifyProof',
      calldata
    };
  }

  private getEtherscanBaseUrl(chainId: number): string {
    switch (chainId) {
      case 1: return 'https://etherscan.io';
      case 5: return 'https://goerli.etherscan.io';
      case 11155111: return 'https://sepolia.etherscan.io';
      case 137: return 'https://polygonscan.com';
      case 42161: return 'https://arbiscan.io';
      case 10: return 'https://optimistic.etherscan.io';
      case 56: return 'https://bscscan.com';
      default: return 'https://etherscan.io';
    }
  }

  /**
   * Check if a user has already claimed their settlement
   */
  async hasUserClaimed(epochId: string, userId: string): Promise<boolean> {
    try {
      return await this.settlementContract.hasClaimed(epochId, userId);
    } catch (error) {
      logger.error('Failed to check claim status', { epochId, userId, error });
      return false;
    }
  }

  /**
   * Monitor settlement batch finalization
   */
  async monitorSettlementFinalization(
    epochId: string,
    callback: (finalized: boolean) => void
  ): Promise<void> {
    const checkFinalization = async () => {
      try {
        const batch = await this.settlementContract.getSettlementBatch(epochId);
        if (batch.finalized) {
          callback(true);
          return true;
        }
        return false;
      } catch (error) {
        logger.error('Error checking finalization', { epochId, error });
        return false;
      }
    };

    // Check immediately
    if (await checkFinalization()) return;

    // Set up interval to check periodically
    const interval = setInterval(async () => {
      if (await checkFinalization()) {
        clearInterval(interval);
      }
    }, 30000); // Check every 30 seconds

    // Also listen for events
    const filter = this.settlementContract.filters.SettlementBatchFinalized(epochId);
    this.settlementContract.once(filter, () => {
      clearInterval(interval);
      callback(true);
    });
  }
}