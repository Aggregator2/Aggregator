import { MEVProtectedSettlementEngine, MEVProtectedSettlementConfig } from './MEVProtectedSettlementEngine';
import { MerkleSettlementProof, SettlementLeaf, SettlementProof } from './MerkleSettlementProof';
import { SettlementProofStorage } from './SettlementProofStorage';
import { TransactionBundle, SettlementInstruction } from './FinalSettlementEngine';
import { ethers } from 'ethers';

export interface ProofGeneratingSettlementConfig extends MEVProtectedSettlementConfig {
  proofStorageEnabled: boolean;
  generateProofsAsync?: boolean;
  storeOnChainRoot?: boolean;
}

export class ProofGeneratingSettlementEngine extends MEVProtectedSettlementEngine {
  private merkleProofService: MerkleSettlementProof;
  private proofStorage: SettlementProofStorage;
  private proofConfig: ProofGeneratingSettlementConfig;
  private settlementContractWithProof?: ethers.Contract;

  constructor(
    provider: ethers.Provider,
    privateKey: string,
    config: ProofGeneratingSettlementConfig
  ) {
    super(provider, privateKey, config);
    
    this.proofConfig = config;
    this.merkleProofService = new MerkleSettlementProof();
    this.proofStorage = new SettlementProofStorage();
    
    // Initialize settlement contract with proof support
    if (config.storeOnChainRoot && config.settlementContractAddress) {
      const abi = [
        'function executeSettlementWithProof(bytes32 batchId, bytes32 merkleRoot, address[] users, address[] tokens, int256[] amounts, uint256 leafCount) external',
        'function verifySettlement(bytes32 batchId, bytes32 leaf, bytes32[] proof, uint256 position) external view returns (bool)',
        'function getSettlementRoot(bytes32 batchId) external view returns (bytes32)'
      ];
      
      this.settlementContractWithProof = new ethers.Contract(
        config.settlementContractAddress,
        abi,
        this.wallet
      );
    }
    
    this.setupProofEventHandlers();
  }

  private setupProofEventHandlers(): void {
    // Listen to Merkle tree generation
    this.merkleProofService.on('merkleTreeGenerated', (data) => {
      this.emit('merkleTreeGenerated', data);
    });

    // Listen to proof generation
    this.merkleProofService.on('proofGenerated', (data) => {
      this.emit('proofGenerated', data);
    });

    // Listen to proof storage
    this.proofStorage.on('proofStored', (data) => {
      this.emit('proofStored', data);
    });
  }

  // Override executeBundle to generate proofs
  protected async executeBundle(bundle: TransactionBundle): Promise<void> {
    // Generate settlement leaves
    const leaves = this.generateSettlementLeaves(bundle);
    
    // Generate Merkle tree and root
    const { root, tree } = this.merkleProofService.generateMerkleTree(leaves);
    
    // Add Merkle root to bundle metadata
    bundle.metadata = {
      ...bundle.metadata,
      merkleRoot: root,
      leafCount: leaves.length
    };
    
    // Execute with MEV protection and Merkle root
    if (this.proofConfig.storeOnChainRoot && this.settlementContractWithProof) {
      await this.executeBundleWithProof(bundle, root, leaves);
    } else {
      await super.executeBundle(bundle);
    }
    
    // Generate and store proofs
    if (this.proofConfig.proofStorageEnabled) {
      if (this.proofConfig.generateProofsAsync) {
        // Generate proofs asynchronously
        this.generateAndStoreProofsAsync(bundle, leaves).catch(error => {
          console.error('Failed to generate proofs:', error);
          this.emit('proofGenerationFailed', {
            bundleId: bundle.id,
            error: error.message
          });
        });
      } else {
        // Generate proofs synchronously
        await this.generateAndStoreProofs(bundle, leaves);
      }
    }
  }

  // Generate settlement leaves from bundle
  private generateSettlementLeaves(bundle: TransactionBundle): SettlementLeaf[] {
    const leaves: SettlementLeaf[] = [];
    let nonce = 0;
    
    for (const instruction of bundle.instructions) {
      if (instruction.metadata?.tradeId) {
        // For trade settlements
        const leaf: SettlementLeaf = {
          tradeId: instruction.metadata.tradeId,
          buyer: instruction.metadata.buyer || instruction.to,
          seller: instruction.metadata.seller || instruction.from,
          buyerAmount: instruction.amount,
          sellerAmount: instruction.metadata.sellerAmount || instruction.amount,
          buyerToken: instruction.token,
          sellerToken: instruction.metadata.sellerToken || instruction.token,
          timestamp: instruction.metadata.timestamp || Date.now(),
          nonce: nonce++
        };
        leaves.push(leaf);
      } else {
        // For direct transfers
        const leaf: SettlementLeaf = {
          tradeId: `transfer_${bundle.id}_${nonce}`,
          buyer: instruction.to,
          seller: instruction.from,
          buyerAmount: instruction.amount,
          sellerAmount: BigInt(0),
          buyerToken: instruction.token,
          sellerToken: instruction.token,
          timestamp: Date.now(),
          nonce: nonce++
        };
        leaves.push(leaf);
      }
    }
    
    return leaves;
  }

  // Execute bundle with on-chain Merkle root storage
  private async executeBundleWithProof(
    bundle: TransactionBundle,
    merkleRoot: string,
    leaves: SettlementLeaf[]
  ): Promise<void> {
    const users: string[] = [];
    const tokens: string[] = [];
    const amounts: bigint[] = [];
    
    // Prepare settlement data
    for (const instruction of bundle.instructions) {
      if (instruction.type === 'TRANSFER') {
        users.push(instruction.to === 'SETTLEMENT_POOL' ? instruction.from : instruction.to);
        tokens.push(instruction.token);
        amounts.push(instruction.to === 'SETTLEMENT_POOL' ? -instruction.amount : instruction.amount);
      }
    }
    
    // Generate batch ID
    const batchId = ethers.id(bundle.id);
    
    // Prepare transaction for MEV protection
    const tx: ethers.TransactionRequest = {
      to: this.settlementContractWithProof!.target,
      data: this.settlementContractWithProof!.interface.encodeFunctionData(
        'executeSettlementWithProof',
        [batchId, merkleRoot, users, tokens, amounts, leaves.length]
      ),
      gasLimit: bundle.totalGasEstimate,
      maxFeePerGas: bundle.maxGasPrice,
      nonce: bundle.nonce
    };
    
    // Send via MEV protection
    const protectedTx = await this.mevProtectionService.sendProtectedTransaction(tx, {
      urgency: this.determineBundleUrgency(bundle),
      settlementBatchId: bundle.id
    });
    
    // Wait for confirmation
    const confirmationTimeout = this.mevConfig.bundleTimeout || 120000;
    const startTime = Date.now();
    
    while (protectedTx.status === 'SUBMITTED' && Date.now() - startTime < confirmationTimeout) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const updated = this.mevProtectionService.getTransaction(protectedTx.id);
      if (updated) {
        Object.assign(protectedTx, updated);
      }
    }
    
    if (protectedTx.status === 'CONFIRMED') {
      bundle.status = 'CONFIRMED';
      bundle.transactionHash = protectedTx.txHash;
      bundle.metadata = {
        ...bundle.metadata,
        blockNumber: await this.provider.getBlockNumber()
      };
      
      this.emit('bundleExecuted', {
        bundleId: bundle.id,
        transactionHash: protectedTx.txHash,
        merkleRoot,
        leafCount: leaves.length
      });
    } else {
      throw new Error(`Transaction failed: ${protectedTx.error || 'Timeout'}`);
    }
  }

  // Generate and store proofs synchronously
  private async generateAndStoreProofs(
    bundle: TransactionBundle,
    leaves: SettlementLeaf[]
  ): Promise<void> {
    const proofs = this.merkleProofService.batchGenerateProofs(
      leaves,
      bundle.id,
      bundle.transactionHash,
      bundle.metadata?.blockNumber
    );
    
    const storedProofs = await this.proofStorage.batchStoreProofs(
      Array.from(proofs.values())
    );
    
    this.emit('proofsGenerated', {
      bundleId: bundle.id,
      proofCount: storedProofs.length,
      merkleRoot: bundle.metadata?.merkleRoot
    });
  }

  // Generate and store proofs asynchronously
  private async generateAndStoreProofsAsync(
    bundle: TransactionBundle,
    leaves: SettlementLeaf[]
  ): Promise<void> {
    // Use setTimeout to make it truly async
    setTimeout(async () => {
      try {
        await this.generateAndStoreProofs(bundle, leaves);
      } catch (error) {
        console.error('Async proof generation failed:', error);
        this.emit('proofGenerationFailed', {
          bundleId: bundle.id,
          error: error.message
        });
      }
    }, 0);
  }

  // Get proof for a specific trade
  async getTradeProof(tradeId: string): Promise<SettlementProof | null> {
    // Check cache first
    const cached = this.merkleProofService.getCachedProof(tradeId);
    if (cached) return cached;
    
    // Check storage
    return await this.proofStorage.getProofByTradeId(tradeId);
  }

  // Verify a trade was settled on-chain
  async verifyTradeSettlement(tradeId: string): Promise<{
    verified: boolean;
    proof?: SettlementProof;
    onChainRoot?: string;
    error?: string;
  }> {
    try {
      // Get proof
      const proof = await this.getTradeProof(tradeId);
      if (!proof) {
        return { verified: false, error: 'Proof not found' };
      }
      
      // Get on-chain root
      if (this.settlementContractWithProof && proof.settlementBatchId) {
        const batchId = ethers.id(proof.settlementBatchId);
        const onChainRoot = await this.settlementContractWithProof.getSettlementRoot(batchId);
        
        // Verify inclusion
        const verified = this.merkleProofService.verifySettlementInclusion(proof, onChainRoot);
        
        return {
          verified,
          proof,
          onChainRoot
        };
      }
      
      // If no on-chain verification available, just verify the proof structure
      const verified = this.merkleProofService.verifyProof(proof.merkleProof);
      
      return {
        verified,
        proof
      };
      
    } catch (error) {
      return {
        verified: false,
        error: error.message
      };
    }
  }

  // Get proofs for a batch
  async getBatchProofs(batchId: string): Promise<SettlementProof[]> {
    return await this.proofStorage.getProofsByBatch(batchId);
  }

  // Export proofs for backup
  async exportProofs(batchId?: string): Promise<any> {
    return await this.proofStorage.exportProofs(batchId);
  }

  // Get proof statistics
  getProofStats(): any {
    return {
      ...this.merkleProofService.getProofStats(),
      ...this.proofStorage.getStorageStats()
    };
  }
}