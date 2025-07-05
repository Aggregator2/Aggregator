import { SettlementProof, SettlementLeaf } from './MerkleSettlementProof';
import { EventEmitter } from 'events';

export interface ProofStorageConfig {
  maxProofsPerBatch?: number;
  retentionPeriodDays?: number;
  enableCompression?: boolean;
}

export interface StoredProof extends SettlementProof {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
}

export interface BatchProofData {
  batchId: string;
  merkleRoot: string;
  transactionHash: string;
  blockNumber: number;
  leafCount: number;
  timestamp: number;
  proofs: Map<string, StoredProof>;
}

// In-memory implementation (replace with actual database in production)
export class SettlementProofStorage extends EventEmitter {
  private proofsByTrade: Map<string, StoredProof> = new Map();
  private proofsByBatch: Map<string, BatchProofData> = new Map();
  private config: ProofStorageConfig;

  constructor(config: ProofStorageConfig = {}) {
    super();
    this.config = {
      maxProofsPerBatch: 10000,
      retentionPeriodDays: 365,
      enableCompression: true,
      ...config
    };

    // Start cleanup interval
    this.startCleanupInterval();
  }

  // Store a single proof
  async storeProof(proof: SettlementProof): Promise<StoredProof> {
    const storedProof: StoredProof = {
      ...proof,
      id: `proof_${proof.tradeId}_${Date.now()}`,
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: this.calculateExpiryDate()
    };

    // Store by trade ID
    this.proofsByTrade.set(proof.tradeId, storedProof);

    // Update batch data
    this.updateBatchData(storedProof);

    this.emit('proofStored', {
      tradeId: proof.tradeId,
      batchId: proof.settlementBatchId,
      proofId: storedProof.id
    });

    return storedProof;
  }

  // Store multiple proofs
  async batchStoreProofs(proofs: SettlementProof[]): Promise<StoredProof[]> {
    const storedProofs: StoredProof[] = [];

    for (const proof of proofs) {
      const stored = await this.storeProof(proof);
      storedProofs.push(stored);
    }

    this.emit('batchProofsStored', {
      count: storedProofs.length,
      batchIds: [...new Set(storedProofs.map(p => p.settlementBatchId))]
    });

    return storedProofs;
  }

  // Retrieve proof by trade ID
  async getProofByTradeId(tradeId: string): Promise<StoredProof | null> {
    const proof = this.proofsByTrade.get(tradeId);
    
    if (proof && this.isProofValid(proof)) {
      return proof;
    }

    return null;
  }

  // Retrieve all proofs for a batch
  async getProofsByBatch(batchId: string): Promise<StoredProof[]> {
    const batchData = this.proofsByBatch.get(batchId);
    
    if (!batchData) {
      return [];
    }

    return Array.from(batchData.proofs.values()).filter(proof => 
      this.isProofValid(proof)
    );
  }

  // Get batch summary
  async getBatchSummary(batchId: string): Promise<BatchProofData | null> {
    return this.proofsByBatch.get(batchId) || null;
  }

  // Search proofs by criteria
  async searchProofs(criteria: {
    buyer?: string;
    seller?: string;
    startDate?: Date;
    endDate?: Date;
    batchId?: string;
    transactionHash?: string;
  }): Promise<StoredProof[]> {
    let proofs = Array.from(this.proofsByTrade.values());

    // Apply filters
    if (criteria.buyer) {
      proofs = proofs.filter(p => 
        p.leaf.buyer.toLowerCase() === criteria.buyer!.toLowerCase()
      );
    }

    if (criteria.seller) {
      proofs = proofs.filter(p => 
        p.leaf.seller.toLowerCase() === criteria.seller!.toLowerCase()
      );
    }

    if (criteria.batchId) {
      proofs = proofs.filter(p => p.settlementBatchId === criteria.batchId);
    }

    if (criteria.transactionHash) {
      proofs = proofs.filter(p => p.transactionHash === criteria.transactionHash);
    }

    if (criteria.startDate) {
      proofs = proofs.filter(p => 
        new Date(p.timestamp) >= criteria.startDate!
      );
    }

    if (criteria.endDate) {
      proofs = proofs.filter(p => 
        new Date(p.timestamp) <= criteria.endDate!
      );
    }

    // Filter out expired proofs
    return proofs.filter(proof => this.isProofValid(proof));
  }

  // Update batch data
  private updateBatchData(proof: StoredProof): void {
    let batchData = this.proofsByBatch.get(proof.settlementBatchId);

    if (!batchData) {
      batchData = {
        batchId: proof.settlementBatchId,
        merkleRoot: proof.merkleProof.root,
        transactionHash: proof.transactionHash || '',
        blockNumber: proof.blockNumber || 0,
        leafCount: 0,
        timestamp: proof.timestamp,
        proofs: new Map()
      };
      this.proofsByBatch.set(proof.settlementBatchId, batchData);
    }

    // Update batch data
    batchData.proofs.set(proof.tradeId, proof);
    batchData.leafCount = batchData.proofs.size;
    
    if (proof.transactionHash) {
      batchData.transactionHash = proof.transactionHash;
    }
    
    if (proof.blockNumber) {
      batchData.blockNumber = proof.blockNumber;
    }
  }

  // Check if proof is still valid
  private isProofValid(proof: StoredProof): boolean {
    if (!proof.expiresAt) return true;
    return new Date() < proof.expiresAt;
  }

  // Calculate expiry date
  private calculateExpiryDate(): Date {
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + this.config.retentionPeriodDays!);
    return expiryDate;
  }

  // Cleanup expired proofs
  private async cleanupExpiredProofs(): Promise<number> {
    const now = new Date();
    let removedCount = 0;

    // Clean trade proofs
    for (const [tradeId, proof] of this.proofsByTrade.entries()) {
      if (proof.expiresAt && now > proof.expiresAt) {
        this.proofsByTrade.delete(tradeId);
        removedCount++;
      }
    }

    // Clean batch data
    for (const [batchId, batchData] of this.proofsByBatch.entries()) {
      // Remove expired proofs from batch
      for (const [tradeId, proof] of batchData.proofs.entries()) {
        if (proof.expiresAt && now > proof.expiresAt) {
          batchData.proofs.delete(tradeId);
        }
      }

      // Remove empty batches
      if (batchData.proofs.size === 0) {
        this.proofsByBatch.delete(batchId);
      }
    }

    if (removedCount > 0) {
      this.emit('proofsCleanedUp', { removedCount });
    }

    return removedCount;
  }

  // Start cleanup interval
  private startCleanupInterval(): void {
    // Run cleanup daily
    setInterval(async () => {
      await this.cleanupExpiredProofs();
    }, 24 * 60 * 60 * 1000);
  }

  // Get storage statistics
  getStorageStats(): {
    totalProofs: number;
    totalBatches: number;
    oldestProof?: Date;
    newestProof?: Date;
    averageProofsPerBatch: number;
  } {
    const proofs = Array.from(this.proofsByTrade.values());
    
    return {
      totalProofs: this.proofsByTrade.size,
      totalBatches: this.proofsByBatch.size,
      oldestProof: proofs.length > 0 
        ? new Date(Math.min(...proofs.map(p => p.timestamp)))
        : undefined,
      newestProof: proofs.length > 0
        ? new Date(Math.max(...proofs.map(p => p.timestamp)))
        : undefined,
      averageProofsPerBatch: this.proofsByBatch.size > 0
        ? this.proofsByTrade.size / this.proofsByBatch.size
        : 0
    };
  }

  // Export proofs for backup
  async exportProofs(batchId?: string): Promise<any> {
    if (batchId) {
      const batchData = this.proofsByBatch.get(batchId);
      if (!batchData) return null;

      return {
        batch: {
          id: batchData.batchId,
          merkleRoot: batchData.merkleRoot,
          transactionHash: batchData.transactionHash,
          blockNumber: batchData.blockNumber,
          leafCount: batchData.leafCount,
          timestamp: batchData.timestamp
        },
        proofs: Array.from(batchData.proofs.values()).map(proof => ({
          tradeId: proof.tradeId,
          leaf: proof.leaf,
          merkleProof: proof.merkleProof,
          timestamp: proof.timestamp
        }))
      };
    }

    // Export all proofs
    const batches: any[] = [];
    
    for (const [batchId, batchData] of this.proofsByBatch.entries()) {
      batches.push({
        batch: {
          id: batchData.batchId,
          merkleRoot: batchData.merkleRoot,
          transactionHash: batchData.transactionHash,
          blockNumber: batchData.blockNumber,
          leafCount: batchData.leafCount,
          timestamp: batchData.timestamp
        },
        proofs: Array.from(batchData.proofs.values()).map(proof => ({
          tradeId: proof.tradeId,
          leaf: proof.leaf,
          merkleProof: proof.merkleProof,
          timestamp: proof.timestamp
        }))
      });
    }

    return batches;
  }

  // Clear all stored proofs
  clearAll(): void {
    const proofCount = this.proofsByTrade.size;
    const batchCount = this.proofsByBatch.size;

    this.proofsByTrade.clear();
    this.proofsByBatch.clear();

    this.emit('storageCleared', { proofCount, batchCount });
  }
}