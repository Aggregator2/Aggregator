import { ethers } from 'ethers';

export interface MerkleLeaf {
  userId: string;
  token: string;
  amount: string;
  index?: number;
}

export interface MerkleProof {
  leaf: string;
  proof: string[];
  index: number;
  root: string;
}

export class MerkleTree {
  private leaves: string[];
  private layers: string[][];
  private leafData: Map<string, MerkleLeaf>;

  constructor(leaves: MerkleLeaf[]) {
    // Sort leaves for consistent tree generation
    const sortedLeaves = leaves.sort((a, b) => {
      const keyA = `${a.userId}-${a.token}`;
      const keyB = `${b.userId}-${b.token}`;
      return keyA.localeCompare(keyB);
    });

    // Create leaf hashes and store mapping
    this.leafData = new Map();
    this.leaves = sortedLeaves.map((leaf, index) => {
      const leafWithIndex = { ...leaf, index };
      const hash = this.hashLeaf(leafWithIndex);
      this.leafData.set(hash, leafWithIndex);
      return hash;
    });

    this.layers = this.buildLayers(this.leaves);
  }

  private hashLeaf(leaf: MerkleLeaf): string {
    // Create a deterministic hash of the leaf data
    // Format: keccak256(abi.encode(userId, token, amount))
    const encoded = ethers.utils.defaultAbiCoder.encode(
      ['address', 'address', 'uint256'],
      [leaf.userId, leaf.token, leaf.amount]
    );
    return ethers.utils.keccak256(encoded);
  }

  private hashPair(left: string, right: string): string {
    // Sort to ensure consistent hashing regardless of order
    const sorted = [left, right].sort();
    const combined = ethers.utils.concat(sorted);
    return ethers.utils.keccak256(combined);
  }

  private buildLayers(leaves: string[]): string[][] {
    if (leaves.length === 0) {
      return [[]];
    }

    const layers: string[][] = [leaves];
    let currentLayer = leaves;

    while (currentLayer.length > 1) {
      const nextLayer: string[] = [];
      
      for (let i = 0; i < currentLayer.length; i += 2) {
        if (i + 1 < currentLayer.length) {
          // Hash pair of nodes
          nextLayer.push(this.hashPair(currentLayer[i], currentLayer[i + 1]));
        } else {
          // Odd number of nodes, promote the last one
          nextLayer.push(currentLayer[i]);
        }
      }

      layers.push(nextLayer);
      currentLayer = nextLayer;
    }

    return layers;
  }

  getRoot(): string {
    if (this.layers.length === 0 || this.layers[this.layers.length - 1].length === 0) {
      return ethers.constants.HashZero;
    }
    return this.layers[this.layers.length - 1][0];
  }

  getProof(leafHash: string): MerkleProof | null {
    const leafIndex = this.leaves.indexOf(leafHash);
    if (leafIndex === -1) {
      return null;
    }

    const proof: string[] = [];
    let currentIndex = leafIndex;

    // Build proof from bottom to top
    for (let layerIndex = 0; layerIndex < this.layers.length - 1; layerIndex++) {
      const currentLayer = this.layers[layerIndex];
      const isRightNode = currentIndex % 2 === 1;
      const pairIndex = isRightNode ? currentIndex - 1 : currentIndex + 1;

      if (pairIndex < currentLayer.length) {
        proof.push(currentLayer[pairIndex]);
      }

      // Move to parent index in next layer
      currentIndex = Math.floor(currentIndex / 2);
    }

    return {
      leaf: leafHash,
      proof,
      index: leafIndex,
      root: this.getRoot()
    };
  }

  getProofForLeaf(leaf: MerkleLeaf): MerkleProof | null {
    const leafHash = this.hashLeaf(leaf);
    return this.getProof(leafHash);
  }

  static verifyProof(leaf: string, proof: string[], root: string, index: number): boolean {
    let computedHash = leaf;
    let currentIndex = index;

    for (const proofElement of proof) {
      const isRightNode = currentIndex % 2 === 1;
      
      if (isRightNode) {
        // Current node is right, proof element is left sibling
        computedHash = ethers.utils.keccak256(
          ethers.utils.concat([proofElement, computedHash].sort())
        );
      } else {
        // Current node is left, proof element is right sibling
        computedHash = ethers.utils.keccak256(
          ethers.utils.concat([computedHash, proofElement].sort())
        );
      }

      currentIndex = Math.floor(currentIndex / 2);
    }

    return computedHash === root;
  }

  static verifyProofForLeaf(
    leaf: MerkleLeaf,
    proof: string[],
    root: string,
    index: number
  ): boolean {
    const leafHash = ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(
        ['address', 'address', 'uint256'],
        [leaf.userId, leaf.token, leaf.amount]
      )
    );
    return MerkleTree.verifyProof(leafHash, proof, root, index);
  }

  getLeaves(): string[] {
    return [...this.leaves];
  }

  getLeafData(leafHash: string): MerkleLeaf | undefined {
    return this.leafData.get(leafHash);
  }

  getAllProofs(): Map<string, MerkleProof> {
    const proofs = new Map<string, MerkleProof>();
    
    for (const leafHash of this.leaves) {
      const proof = this.getProof(leafHash);
      if (proof) {
        proofs.set(leafHash, proof);
      }
    }

    return proofs;
  }

  // Generate proof data for Solidity verification
  getSolidityProof(leafHash: string): {
    proof: string[];
    leaf: string;
    root: string;
  } | null {
    const merkleProof = this.getProof(leafHash);
    if (!merkleProof) {
      return null;
    }

    return {
      proof: merkleProof.proof,
      leaf: leafHash,
      root: merkleProof.root
    };
  }

  // Generate a compact proof format for storage
  getCompactProof(leafHash: string): string | null {
    const proof = this.getProof(leafHash);
    if (!proof) {
      return null;
    }

    // Encode proof data in a compact format
    return ethers.utils.defaultAbiCoder.encode(
      ['bytes32', 'bytes32[]', 'uint256', 'bytes32'],
      [proof.leaf, proof.proof, proof.index, proof.root]
    );
  }

  static decodeCompactProof(compactProof: string): MerkleProof {
    const decoded = ethers.utils.defaultAbiCoder.decode(
      ['bytes32', 'bytes32[]', 'uint256', 'bytes32'],
      compactProof
    );

    return {
      leaf: decoded[0],
      proof: decoded[1],
      index: decoded[2].toNumber(),
      root: decoded[3]
    };
  }
}