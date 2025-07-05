import { ethers } from 'ethers';
import { EventEmitter } from 'events';

export interface SettlementLeaf {
  tradeId: string;
  buyer: string;
  seller: string;
  buyerAmount: bigint;
  sellerAmount: bigint;
  buyerToken: string;
  sellerToken: string;
  timestamp: number;
  nonce: number;
}

export interface MerkleProof {
  leaf: string;
  proof: string[];
  position: number;
  root: string;
}

export interface SettlementProof {
  tradeId: string;
  leaf: SettlementLeaf;
  merkleProof: MerkleProof;
  settlementBatchId: string;
  transactionHash?: string;
  blockNumber?: number;
  timestamp: number;
}

export class MerkleSettlementProof extends EventEmitter {
  private proofCache: Map<string, SettlementProof> = new Map();

  constructor() {
    super();
  }

  // Generate leaf hash for a settlement
  generateLeafHash(leaf: SettlementLeaf): string {
    // Encode the leaf data in a deterministic way
    const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
      ['string', 'address', 'address', 'uint256', 'uint256', 'address', 'address', 'uint256', 'uint256'],
      [
        leaf.tradeId,
        leaf.buyer,
        leaf.seller,
        leaf.buyerAmount,
        leaf.sellerAmount,
        leaf.buyerToken,
        leaf.sellerToken,
        leaf.timestamp,
        leaf.nonce
      ]
    );
    
    // Double hash for security (standard practice)
    return ethers.keccak256(ethers.keccak256(encoded));
  }

  // Generate Merkle tree from settlement batch
  generateMerkleTree(settlements: SettlementLeaf[]): {
    root: string;
    tree: string[][];
    leaves: string[];
  } {
    if (settlements.length === 0) {
      throw new Error('Cannot generate Merkle tree from empty settlement batch');
    }

    // Generate leaf hashes
    const leaves = settlements.map(settlement => this.generateLeafHash(settlement));
    
    // Sort leaves for deterministic tree
    const sortedLeaves = [...leaves].sort();
    
    // Build tree
    const tree: string[][] = [sortedLeaves];
    
    while (tree[tree.length - 1].length > 1) {
      const currentLevel = tree[tree.length - 1];
      const nextLevel: string[] = [];
      
      for (let i = 0; i < currentLevel.length; i += 2) {
        const left = currentLevel[i];
        const right = currentLevel[i + 1] || left; // Duplicate last node if odd
        
        // Hash pair
        const combined = ethers.solidityPacked(['bytes32', 'bytes32'], [left, right]);
        const hash = ethers.keccak256(combined);
        nextLevel.push(hash);
      }
      
      tree.push(nextLevel);
    }
    
    const root = tree[tree.length - 1][0];
    
    this.emit('merkleTreeGenerated', {
      root,
      leafCount: settlements.length,
      treeHeight: tree.length
    });
    
    return {
      root,
      tree,
      leaves: sortedLeaves
    };
  }

  // Generate proof for a specific settlement
  generateProof(
    settlement: SettlementLeaf,
    settlements: SettlementLeaf[]
  ): MerkleProof {
    const { tree, leaves, root } = this.generateMerkleTree(settlements);
    const leafHash = this.generateLeafHash(settlement);
    
    // Find leaf position
    const position = leaves.indexOf(leafHash);
    if (position === -1) {
      throw new Error('Settlement not found in batch');
    }
    
    // Generate proof path
    const proof: string[] = [];
    let currentIndex = position;
    
    for (let level = 0; level < tree.length - 1; level++) {
      const currentLevel = tree[level];
      const isRightNode = currentIndex % 2 === 1;
      const siblingIndex = isRightNode ? currentIndex - 1 : currentIndex + 1;
      
      if (siblingIndex < currentLevel.length) {
        proof.push(currentLevel[siblingIndex]);
      } else {
        // If no sibling, duplicate current node
        proof.push(currentLevel[currentIndex]);
      }
      
      currentIndex = Math.floor(currentIndex / 2);
    }
    
    return {
      leaf: leafHash,
      proof,
      position,
      root
    };
  }

  // Verify a Merkle proof
  verifyProof(merkleProof: MerkleProof): boolean {
    let computedHash = merkleProof.leaf;
    let index = merkleProof.position;
    
    for (const proofElement of merkleProof.proof) {
      if (index % 2 === 0) {
        // Current node is left child
        const combined = ethers.solidityPacked(
          ['bytes32', 'bytes32'],
          [computedHash, proofElement]
        );
        computedHash = ethers.keccak256(combined);
      } else {
        // Current node is right child
        const combined = ethers.solidityPacked(
          ['bytes32', 'bytes32'],
          [proofElement, computedHash]
        );
        computedHash = ethers.keccak256(combined);
      }
      
      index = Math.floor(index / 2);
    }
    
    return computedHash === merkleProof.root;
  }

  // Generate settlement proof for a trade
  generateSettlementProof(
    settlement: SettlementLeaf,
    settlements: SettlementLeaf[],
    batchId: string,
    transactionHash?: string,
    blockNumber?: number
  ): SettlementProof {
    const merkleProof = this.generateProof(settlement, settlements);
    
    const proof: SettlementProof = {
      tradeId: settlement.tradeId,
      leaf: settlement,
      merkleProof,
      settlementBatchId: batchId,
      transactionHash,
      blockNumber,
      timestamp: Date.now()
    };
    
    // Cache the proof
    this.proofCache.set(settlement.tradeId, proof);
    
    this.emit('proofGenerated', {
      tradeId: settlement.tradeId,
      batchId,
      root: merkleProof.root
    });
    
    return proof;
  }

  // Get cached proof
  getCachedProof(tradeId: string): SettlementProof | undefined {
    return this.proofCache.get(tradeId);
  }

  // Verify settlement inclusion
  verifySettlementInclusion(
    proof: SettlementProof,
    onChainRoot: string
  ): boolean {
    // Verify the Merkle proof
    const isValidProof = this.verifyProof(proof.merkleProof);
    
    // Verify the root matches on-chain
    const rootMatches = proof.merkleProof.root === onChainRoot;
    
    // Verify leaf hash matches
    const leafHash = this.generateLeafHash(proof.leaf);
    const leafMatches = leafHash === proof.merkleProof.leaf;
    
    return isValidProof && rootMatches && leafMatches;
  }

  // Generate Etherscan-compatible verification data
  generateEtherscanVerificationData(proof: SettlementProof): {
    functionName: string;
    contractAddress: string;
    calldata: string;
    decodedParams: any;
  } {
    // Generate calldata for on-chain verification
    const iface = new ethers.Interface([
      'function verifySettlement(bytes32 root, bytes32 leaf, bytes32[] calldata proof, uint256 position) external view returns (bool)'
    ]);
    
    const calldata = iface.encodeFunctionData('verifySettlement', [
      proof.merkleProof.root,
      proof.merkleProof.leaf,
      proof.merkleProof.proof,
      proof.merkleProof.position
    ]);
    
    return {
      functionName: 'verifySettlement',
      contractAddress: '', // To be filled with actual contract address
      calldata,
      decodedParams: {
        root: proof.merkleProof.root,
        leaf: proof.merkleProof.leaf,
        proof: proof.merkleProof.proof,
        position: proof.merkleProof.position
      }
    };
  }

  // Batch generate proofs for multiple settlements
  batchGenerateProofs(
    settlements: SettlementLeaf[],
    batchId: string,
    transactionHash?: string,
    blockNumber?: number
  ): Map<string, SettlementProof> {
    const proofs = new Map<string, SettlementProof>();
    
    // Generate tree once for all settlements
    const { root } = this.generateMerkleTree(settlements);
    
    // Generate individual proofs
    for (const settlement of settlements) {
      const proof = this.generateSettlementProof(
        settlement,
        settlements,
        batchId,
        transactionHash,
        blockNumber
      );
      proofs.set(settlement.tradeId, proof);
    }
    
    this.emit('batchProofsGenerated', {
      batchId,
      root,
      proofCount: proofs.size
    });
    
    return proofs;
  }

  // Clear proof cache
  clearCache(): void {
    const size = this.proofCache.size;
    this.proofCache.clear();
    
    this.emit('cacheCleared', { entriesCleared: size });
  }

  // Get proof statistics
  getProofStats(): {
    cachedProofs: number;
    cacheSize: number;
  } {
    return {
      cachedProofs: this.proofCache.size,
      cacheSize: Array.from(this.proofCache.values()).reduce(
        (size, proof) => size + JSON.stringify(proof).length,
        0
      )
    };
  }
}