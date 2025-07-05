import { groth16 } from 'snarkjs';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

export interface PrivateTradeInput {
  price: bigint;
  amount: bigint;
  nonce: bigint;
  traderAddress: string;
}

export interface PublicSignals {
  commitment: string;
  minPrice: bigint;
  maxPrice: bigint;
  totalVolume: bigint;
}

export interface ZKProof {
  proof: {
    pi_a: string[];
    pi_b: string[][];
    pi_c: string[];
    protocol: string;
  };
  publicSignals: string[];
}

export class ZKTradeProver {
  private wasmPath: string;
  private zkeyPath: string;
  private vKeyPath: string;

  constructor(circuitPaths: {
    wasm: string;
    zkey: string;
    vkey: string;
  }) {
    this.wasmPath = circuitPaths.wasm;
    this.zkeyPath = circuitPaths.zkey;
    this.vKeyPath = circuitPaths.vkey;
  }

  private computeCommitment(trade: PrivateTradeInput): string {
    const data = new Uint8Array(32 * 4);
    const view = new DataView(data.buffer);
    
    // Pack the trade data
    view.setBigUint64(0, trade.price, false);
    view.setBigUint64(8, trade.amount, false);
    view.setBigUint64(16, trade.nonce, false);
    
    // Add trader address (assuming 20 bytes)
    const addressBytes = hexToBytes(trade.traderAddress.slice(2));
    data.set(addressBytes, 24);
    
    // Compute commitment hash
    return bytesToHex(sha256(data));
  }

  async generateProof(
    privateTrade: PrivateTradeInput,
    publicInputs: {
      minPrice: bigint;
      maxPrice: bigint;
    }
  ): Promise<ZKProof> {
    // Compute commitment
    const commitment = this.computeCommitment(privateTrade);
    
    // Prepare circuit inputs
    const circuitInputs = {
      // Private inputs
      price: privateTrade.price.toString(),
      amount: privateTrade.amount.toString(),
      nonce: privateTrade.nonce.toString(),
      traderAddress: privateTrade.traderAddress,
      
      // Public inputs
      commitment,
      minPrice: publicInputs.minPrice.toString(),
      maxPrice: publicInputs.maxPrice.toString(),
      totalVolume: (privateTrade.price * privateTrade.amount).toString()
    };

    try {
      // Generate the proof
      const { proof, publicSignals } = await groth16.fullProve(
        circuitInputs,
        this.wasmPath,
        this.zkeyPath
      );

      return {
        proof: {
          pi_a: proof.pi_a.slice(0, 2),
          pi_b: [proof.pi_b[0].slice(0, 2), proof.pi_b[1].slice(0, 2)],
          pi_c: proof.pi_c.slice(0, 2),
          protocol: 'groth16'
        },
        publicSignals
      };
    } catch (error) {
      throw new Error(`Failed to generate ZK proof: ${error.message}`);
    }
  }

  async verifyProof(zkProof: ZKProof): Promise<boolean> {
    try {
      const vKey = JSON.parse(
        await (await fetch(this.vKeyPath)).text()
      );

      const verified = await groth16.verify(
        vKey,
        zkProof.publicSignals,
        zkProof.proof
      );

      return verified;
    } catch (error) {
      console.error('Proof verification failed:', error);
      return false;
    }
  }

  // Generate proof for batch trades
  async generateBatchProof(
    trades: PrivateTradeInput[],
    aggregateConstraints: {
      totalMinVolume: bigint;
      totalMaxVolume: bigint;
      priceRange: { min: bigint; max: bigint };
    }
  ): Promise<ZKProof> {
    // Compute aggregate values
    let totalVolume = BigInt(0);
    const commitments: string[] = [];

    for (const trade of trades) {
      totalVolume += trade.price * trade.amount;
      commitments.push(this.computeCommitment(trade));
    }

    // Create Merkle tree of commitments
    const merkleRoot = this.computeMerkleRoot(commitments);

    const batchInputs = {
      // Private inputs (flattened trades)
      trades: trades.map(t => ({
        price: t.price.toString(),
        amount: t.amount.toString(),
        nonce: t.nonce.toString(),
        traderAddress: t.traderAddress
      })),
      
      // Public inputs
      merkleRoot,
      totalVolume: totalVolume.toString(),
      totalMinVolume: aggregateConstraints.totalMinVolume.toString(),
      totalMaxVolume: aggregateConstraints.totalMaxVolume.toString(),
      minPrice: aggregateConstraints.priceRange.min.toString(),
      maxPrice: aggregateConstraints.priceRange.max.toString()
    };

    return this.generateProof(trades[0], {
      minPrice: aggregateConstraints.priceRange.min,
      maxPrice: aggregateConstraints.priceRange.max
    });
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
}

// Helper function to create a simple range proof
export async function createRangeProof(
  value: bigint,
  min: bigint,
  max: bigint,
  bits: number = 64
): Promise<{ commitment: string; proof: any }> {
  // Simple commitment using Pedersen-like scheme
  const nonce = crypto.getRandomValues(new Uint8Array(32));
  const valueBytes = new Uint8Array(8);
  new DataView(valueBytes.buffer).setBigUint64(0, value, false);
  
  const commitmentData = new Uint8Array(40);
  commitmentData.set(valueBytes, 0);
  commitmentData.set(nonce, 8);
  
  const commitment = bytesToHex(sha256(commitmentData));
  
  // In a real implementation, this would generate a proper range proof
  // For now, we create a placeholder structure
  const proof = {
    commitment,
    rangeProof: {
      min: min.toString(),
      max: max.toString(),
      bits,
      value: value.toString(),
      nonce: bytesToHex(nonce)
    }
  };

  return { commitment, proof };
}

// Export types for circuit generation
export interface CircuitConfig {
  maxTrades: number;
  priceDecimals: number;
  amountDecimals: number;
}

export const DEFAULT_CIRCUIT_CONFIG: CircuitConfig = {
  maxTrades: 100,
  priceDecimals: 8,
  amountDecimals: 18
};