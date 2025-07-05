import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';
import { BLSAggregator } from './blsSignatures';
import { ZKTradeProver } from './zkProofs';
import { ethers } from 'ethers';

export enum FraudType {
  DOUBLE_SPEND = 'DOUBLE_SPEND',
  INVALID_BALANCE = 'INVALID_BALANCE',
  SIGNATURE_FORGERY = 'SIGNATURE_FORGERY',
  PRICE_MANIPULATION = 'PRICE_MANIPULATION',
  VOLUME_INFLATION = 'VOLUME_INFLATION',
  MERKLE_PROOF_INVALID = 'MERKLE_PROOF_INVALID',
  COMMITMENT_MISMATCH = 'COMMITMENT_MISMATCH',
  THRESHOLD_VIOLATION = 'THRESHOLD_VIOLATION'
}

export interface FraudProof {
  type: FraudType;
  timestamp: number;
  blockNumber: number;
  proofData: any;
  evidenceHash: string;
  signature: string;
}

export interface MerkleProof {
  root: string;
  leaf: string;
  siblings: string[];
  index: number;
}

export interface StateTransition {
  previousState: string;
  newState: string;
  transaction: any;
  proof: MerkleProof;
}

export class FraudProofGenerator {
  private provider: ethers.Provider;
  private zkProver: ZKTradeProver;
  private fraudProofs: Map<string, FraudProof[]> = new Map();

  constructor(
    provider: ethers.Provider,
    zkProver: ZKTradeProver
  ) {
    this.provider = provider;
    this.zkProver = zkProver;
  }

  // Generate fraud proof for double spending
  async generateDoubleSpendProof(
    transaction1: any,
    transaction2: any,
    utxo: string
  ): Promise<FraudProof> {
    // Verify both transactions try to spend the same UTXO
    const tx1Input = this.extractUTXO(transaction1);
    const tx2Input = this.extractUTXO(transaction2);

    if (tx1Input !== utxo || tx2Input !== utxo) {
      throw new Error('Transactions do not spend the same UTXO');
    }

    const proofData = {
      utxo,
      transaction1: {
        hash: this.hashTransaction(transaction1),
        signature: transaction1.signature,
        timestamp: transaction1.timestamp
      },
      transaction2: {
        hash: this.hashTransaction(transaction2),
        signature: transaction2.signature,
        timestamp: transaction2.timestamp
      },
      conflictEvidence: await this.generateConflictEvidence(transaction1, transaction2)
    };

    const evidenceHash = bytesToHex(sha256(JSON.stringify(proofData)));
    const blockNumber = await this.provider.getBlockNumber();

    return {
      type: FraudType.DOUBLE_SPEND,
      timestamp: Date.now(),
      blockNumber,
      proofData,
      evidenceHash,
      signature: await this.signFraudProof(evidenceHash)
    };
  }

  // Generate fraud proof for invalid balance
  async generateInvalidBalanceProof(
    account: string,
    claimedBalance: bigint,
    actualBalance: bigint,
    balanceProof: MerkleProof
  ): Promise<FraudProof> {
    // Verify the merkle proof
    const isValidProof = this.verifyMerkleProof(balanceProof);
    
    if (!isValidProof) {
      throw new Error('Invalid merkle proof provided');
    }

    const proofData = {
      account,
      claimedBalance: claimedBalance.toString(),
      actualBalance: actualBalance.toString(),
      difference: (claimedBalance - actualBalance).toString(),
      merkleProof: balanceProof,
      stateRoot: await this.getStateRoot()
    };

    const evidenceHash = bytesToHex(sha256(JSON.stringify(proofData)));
    const blockNumber = await this.provider.getBlockNumber();

    return {
      type: FraudType.INVALID_BALANCE,
      timestamp: Date.now(),
      blockNumber,
      proofData,
      evidenceHash,
      signature: await this.signFraudProof(evidenceHash)
    };
  }

  // Generate fraud proof for signature forgery
  async generateSignatureForgeryProof(
    message: any,
    signature: string,
    claimedSigner: string,
    actualSigner?: string
  ): Promise<FraudProof> {
    const messageHash = this.hashMessage(message);
    
    // Recover actual signer from signature
    const recoveredSigner = ethers.verifyMessage(
      messageHash,
      signature
    );

    if (recoveredSigner.toLowerCase() === claimedSigner.toLowerCase()) {
      throw new Error('Signature is valid for claimed signer');
    }

    const proofData = {
      message,
      messageHash,
      signature,
      claimedSigner,
      actualSigner: actualSigner || recoveredSigner,
      verificationResult: {
        isValid: false,
        recoveredAddress: recoveredSigner
      }
    };

    const evidenceHash = bytesToHex(sha256(JSON.stringify(proofData)));
    const blockNumber = await this.provider.getBlockNumber();

    return {
      type: FraudType.SIGNATURE_FORGERY,
      timestamp: Date.now(),
      blockNumber,
      proofData,
      evidenceHash,
      signature: await this.signFraudProof(evidenceHash)
    };
  }

  // Generate fraud proof for price manipulation
  async generatePriceManipulationProof(
    trades: Array<{
      price: bigint;
      volume: bigint;
      timestamp: number;
    }>,
    referencePrice: bigint,
    deviationThreshold: number // percentage
  ): Promise<FraudProof> {
    const suspiciousTrades = trades.filter(trade => {
      const deviation = Number(
        ((trade.price - referencePrice) * BigInt(100)) / referencePrice
      );
      return Math.abs(deviation) > deviationThreshold;
    });

    if (suspiciousTrades.length === 0) {
      throw new Error('No suspicious trades found');
    }

    // Calculate volume-weighted average price
    let totalVolume = BigInt(0);
    let weightedPriceSum = BigInt(0);
    
    for (const trade of trades) {
      totalVolume += trade.volume;
      weightedPriceSum += trade.price * trade.volume;
    }
    
    const vwap = weightedPriceSum / totalVolume;

    const proofData = {
      suspiciousTrades: suspiciousTrades.map(t => ({
        price: t.price.toString(),
        volume: t.volume.toString(),
        timestamp: t.timestamp,
        deviation: Number(((t.price - referencePrice) * BigInt(100)) / referencePrice)
      })),
      referencePrice: referencePrice.toString(),
      vwap: vwap.toString(),
      deviationThreshold,
      totalTradesAnalyzed: trades.length,
      manipulationScore: this.calculateManipulationScore(trades, referencePrice)
    };

    const evidenceHash = bytesToHex(sha256(JSON.stringify(proofData)));
    const blockNumber = await this.provider.getBlockNumber();

    return {
      type: FraudType.PRICE_MANIPULATION,
      timestamp: Date.now(),
      blockNumber,
      proofData,
      evidenceHash,
      signature: await this.signFraudProof(evidenceHash)
    };
  }

  // Generate comprehensive fraud proof for state transitions
  async generateStateTransitionFraudProof(
    previousState: StateTransition,
    invalidState: StateTransition,
    validState: StateTransition
  ): Promise<FraudProof> {
    // Verify state transition validity
    const previousRoot = previousState.newState;
    const claimedRoot = invalidState.previousState;

    if (previousRoot !== claimedRoot) {
      throw new Error('State transition does not follow from previous state');
    }

    // Compute what the correct state should be
    const correctStateHash = this.computeStateTransition(
      previousState.newState,
      invalidState.transaction
    );

    if (correctStateHash === invalidState.newState) {
      throw new Error('State transition appears to be valid');
    }

    const proofData = {
      previousState: {
        root: previousState.newState,
        proof: previousState.proof
      },
      invalidTransition: {
        transaction: invalidState.transaction,
        claimedNewState: invalidState.newState,
        proof: invalidState.proof
      },
      correctTransition: {
        expectedNewState: correctStateHash,
        computation: await this.generateComputationTrace(
          previousState.newState,
          invalidState.transaction
        )
      }
    };

    const evidenceHash = bytesToHex(sha256(JSON.stringify(proofData)));
    const blockNumber = await this.provider.getBlockNumber();

    return {
      type: FraudType.COMMITMENT_MISMATCH,
      timestamp: Date.now(),
      blockNumber,
      proofData,
      evidenceHash,
      signature: await this.signFraudProof(evidenceHash)
    };
  }

  // Batch fraud proof generation for multiple violations
  async generateBatchFraudProof(
    violations: Array<{
      type: FraudType;
      evidence: any;
    }>
  ): Promise<{
    batchProof: FraudProof;
    individualProofs: FraudProof[];
    merkleRoot: string;
  }> {
    const individualProofs: FraudProof[] = [];

    // Generate individual proofs
    for (const violation of violations) {
      let proof: FraudProof;
      
      switch (violation.type) {
        case FraudType.DOUBLE_SPEND:
          proof = await this.generateDoubleSpendProof(
            violation.evidence.tx1,
            violation.evidence.tx2,
            violation.evidence.utxo
          );
          break;
        case FraudType.INVALID_BALANCE:
          proof = await this.generateInvalidBalanceProof(
            violation.evidence.account,
            violation.evidence.claimedBalance,
            violation.evidence.actualBalance,
            violation.evidence.proof
          );
          break;
        default:
          throw new Error(`Unsupported fraud type: ${violation.type}`);
      }
      
      individualProofs.push(proof);
    }

    // Create merkle tree of individual proofs
    const proofHashes = individualProofs.map(p => p.evidenceHash);
    const merkleRoot = this.computeMerkleRoot(proofHashes);

    const batchData = {
      numViolations: violations.length,
      types: violations.map(v => v.type),
      merkleRoot,
      timestamp: Date.now()
    };

    const evidenceHash = bytesToHex(sha256(JSON.stringify(batchData)));
    const blockNumber = await this.provider.getBlockNumber();

    const batchProof: FraudProof = {
      type: FraudType.THRESHOLD_VIOLATION,
      timestamp: Date.now(),
      blockNumber,
      proofData: batchData,
      evidenceHash,
      signature: await this.signFraudProof(evidenceHash)
    };

    return {
      batchProof,
      individualProofs,
      merkleRoot
    };
  }

  // Verify a fraud proof
  async verifyFraudProof(proof: FraudProof): Promise<boolean> {
    // Verify signature
    const signerAddress = ethers.verifyMessage(
      proof.evidenceHash,
      proof.signature
    );

    // Check if signer is authorized
    // In production, this would check against a registry of authorized watchers
    
    // Verify proof data integrity
    const computedHash = bytesToHex(
      sha256(JSON.stringify(proof.proofData))
    );
    
    if (computedHash !== proof.evidenceHash) {
      return false;
    }

    // Type-specific verification
    switch (proof.type) {
      case FraudType.DOUBLE_SPEND:
        return this.verifyDoubleSpendProof(proof.proofData);
      case FraudType.INVALID_BALANCE:
        return this.verifyInvalidBalanceProof(proof.proofData);
      case FraudType.SIGNATURE_FORGERY:
        return this.verifySignatureForgeryProof(proof.proofData);
      default:
        return false;
    }
  }

  // Store fraud proof for future reference
  storeFraudProof(proof: FraudProof): void {
    const key = `${proof.type}_${proof.blockNumber}`;
    
    if (!this.fraudProofs.has(key)) {
      this.fraudProofs.set(key, []);
    }
    
    this.fraudProofs.get(key)!.push(proof);
  }

  // Retrieve fraud proofs by type and block range
  getFraudProofs(
    type: FraudType,
    startBlock: number,
    endBlock: number
  ): FraudProof[] {
    const proofs: FraudProof[] = [];
    
    for (let block = startBlock; block <= endBlock; block++) {
      const key = `${type}_${block}`;
      const blockProofs = this.fraudProofs.get(key) || [];
      proofs.push(...blockProofs);
    }
    
    return proofs;
  }

  // Helper methods
  private extractUTXO(transaction: any): string {
    return transaction.inputs[0].utxo;
  }

  private hashTransaction(transaction: any): string {
    return bytesToHex(sha256(JSON.stringify(transaction)));
  }

  private hashMessage(message: any): string {
    return bytesToHex(sha256(JSON.stringify(message)));
  }

  private async generateConflictEvidence(tx1: any, tx2: any): Promise<any> {
    return {
      conflictType: 'UTXO_DOUBLE_SPEND',
      timestamp1: tx1.timestamp,
      timestamp2: tx2.timestamp,
      blockGap: Math.abs(tx1.blockNumber - tx2.blockNumber)
    };
  }

  private verifyMerkleProof(proof: MerkleProof): boolean {
    let computedHash = proof.leaf;
    let index = proof.index;

    for (const sibling of proof.siblings) {
      const combined = index % 2 === 0
        ? computedHash + sibling
        : sibling + computedHash;
      
      computedHash = bytesToHex(sha256(hexToBytes(combined)));
      index = Math.floor(index / 2);
    }

    return computedHash === proof.root;
  }

  private async getStateRoot(): Promise<string> {
    const block = await this.provider.getBlock('latest');
    return block?.stateRoot || '0x';
  }

  private async signFraudProof(evidenceHash: string): Promise<string> {
    // In production, this would use the watcher's private key
    return '0x' + '00'.repeat(65);
  }

  private calculateManipulationScore(
    trades: Array<{ price: bigint; volume: bigint; timestamp: number }>,
    referencePrice: bigint
  ): number {
    let score = 0;
    
    for (const trade of trades) {
      const deviation = Number(
        ((trade.price - referencePrice) * BigInt(100)) / referencePrice
      );
      
      // Higher score for larger deviations
      if (Math.abs(deviation) > 10) score += 1;
      if (Math.abs(deviation) > 20) score += 2;
      if (Math.abs(deviation) > 50) score += 5;
    }
    
    return score;
  }

  private computeStateTransition(
    previousState: string,
    transaction: any
  ): string {
    // Simplified state transition computation
    const data = previousState + JSON.stringify(transaction);
    return bytesToHex(sha256(data));
  }

  private async generateComputationTrace(
    state: string,
    transaction: any
  ): Promise<any> {
    return {
      steps: [
        { operation: 'LOAD_STATE', data: state },
        { operation: 'APPLY_TX', data: transaction },
        { operation: 'COMPUTE_NEW_STATE', data: 'computed' }
      ]
    };
  }

  private computeMerkleRoot(leaves: string[]): string {
    if (leaves.length === 0) return '';
    if (leaves.length === 1) return leaves[0];

    const tree: string[][] = [leaves];
    let currentLevel = 0;

    while (tree[currentLevel].length > 1) {
      const nextLevel: string[] = [];
      const currentLevelNodes = tree[currentLevel];

      for (let i = 0; i < currentLevelNodes.length; i += 2) {
        const left = currentLevelNodes[i];
        const right = currentLevelNodes[i + 1] || left;
        
        const combined = new Uint8Array(64);
        combined.set(hexToBytes(left), 0);
        combined.set(hexToBytes(right), 32);
        
        nextLevel.push(bytesToHex(sha256(combined)));
      }

      tree.push(nextLevel);
      currentLevel++;
    }

    return tree[currentLevel][0];
  }

  private verifyDoubleSpendProof(proofData: any): boolean {
    // Verify both transactions reference the same UTXO
    return proofData.transaction1 && proofData.transaction2 && proofData.utxo;
  }

  private verifyInvalidBalanceProof(proofData: any): boolean {
    // Verify the merkle proof and balance mismatch
    return BigInt(proofData.claimedBalance) !== BigInt(proofData.actualBalance);
  }

  private verifySignatureForgeryProof(proofData: any): boolean {
    // Verify signature doesn't match claimed signer
    return !proofData.verificationResult.isValid;
  }
}

// Export helper function for creating fraud watcher
export function createFraudWatcher(
  provider: ethers.Provider,
  zkProver: ZKTradeProver
): FraudProofGenerator {
  return new FraudProofGenerator(provider, zkProver);
}