import { bls12_381 as bls } from '@noble/curves/bls12-381';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';

export interface BLSKeyPair {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}

export interface BLSSignature {
  signature: Uint8Array;
  publicKey: Uint8Array;
  message: Uint8Array;
}

export interface AggregatedSignature {
  aggregatedSignature: Uint8Array;
  aggregatedPublicKey: Uint8Array;
  signers: string[]; // Addresses of signers
}

export class BLSAggregator {
  private static readonly DST = utf8ToBytes('BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_NUL_');

  // Generate a new BLS key pair
  static generateKeyPair(): BLSKeyPair {
    const privateKey = bls.utils.randomPrivateKey();
    const publicKey = bls.getPublicKey(privateKey);

    return {
      privateKey,
      publicKey
    };
  }

  // Import private key from hex string
  static importPrivateKey(privateKeyHex: string): BLSKeyPair {
    const privateKey = hexToBytes(privateKeyHex);
    const publicKey = bls.getPublicKey(privateKey);

    return {
      privateKey,
      publicKey
    };
  }

  // Sign a message
  static sign(message: Uint8Array | string, privateKey: Uint8Array): Uint8Array {
    const msgBytes = typeof message === 'string' ? utf8ToBytes(message) : message;
    return bls.sign(msgBytes, privateKey, this.DST);
  }

  // Verify a signature
  static verify(
    signature: Uint8Array,
    message: Uint8Array | string,
    publicKey: Uint8Array
  ): boolean {
    const msgBytes = typeof message === 'string' ? utf8ToBytes(message) : message;
    
    try {
      return bls.verify(signature, msgBytes, publicKey, this.DST);
    } catch (error) {
      console.error('BLS signature verification failed:', error);
      return false;
    }
  }

  // Aggregate multiple signatures
  static aggregateSignatures(signatures: Uint8Array[]): Uint8Array {
    if (signatures.length === 0) {
      throw new Error('Cannot aggregate zero signatures');
    }

    return bls.aggregateSignatures(signatures);
  }

  // Aggregate multiple public keys
  static aggregatePublicKeys(publicKeys: Uint8Array[]): Uint8Array {
    if (publicKeys.length === 0) {
      throw new Error('Cannot aggregate zero public keys');
    }

    return bls.aggregatePublicKeys(publicKeys);
  }

  // Verify an aggregated signature
  static verifyAggregated(
    aggregatedSignature: Uint8Array,
    messages: (Uint8Array | string)[],
    publicKeys: Uint8Array[]
  ): boolean {
    if (messages.length !== publicKeys.length) {
      throw new Error('Messages and public keys must have the same length');
    }

    const msgBytes = messages.map(msg => 
      typeof msg === 'string' ? utf8ToBytes(msg) : msg
    );

    try {
      return bls.verifyBatch(aggregatedSignature, msgBytes, publicKeys, this.DST);
    } catch (error) {
      console.error('Aggregated signature verification failed:', error);
      return false;
    }
  }

  // Create a threshold signature scheme
  static createThresholdScheme(
    threshold: number,
    participants: number,
    masterPrivateKey?: Uint8Array
  ): {
    shares: Array<{ index: number; privateKey: Uint8Array; publicKey: Uint8Array }>;
    masterPublicKey: Uint8Array;
    threshold: number;
  } {
    if (threshold > participants) {
      throw new Error('Threshold cannot be greater than number of participants');
    }

    // Generate master key if not provided
    const masterKey = masterPrivateKey || bls.utils.randomPrivateKey();
    const masterPubKey = bls.getPublicKey(masterKey);

    // Generate polynomial coefficients
    const coefficients: Uint8Array[] = [masterKey];
    for (let i = 1; i < threshold; i++) {
      coefficients.push(bls.utils.randomPrivateKey());
    }

    // Generate shares using Shamir's secret sharing
    const shares: Array<{ index: number; privateKey: Uint8Array; publicKey: Uint8Array }> = [];
    
    for (let i = 1; i <= participants; i++) {
      let share = BigInt(0);
      let power = BigInt(1);
      
      for (const coeff of coefficients) {
        const coeffBigInt = bls.utils.bytesToNumberBE(coeff);
        share = (share + coeffBigInt * power) % bls.CURVE.r;
        power = (power * BigInt(i)) % bls.CURVE.r;
      }

      const shareBytes = bls.utils.numberToBytesBE(share, 32);
      shares.push({
        index: i,
        privateKey: shareBytes,
        publicKey: bls.getPublicKey(shareBytes)
      });
    }

    return {
      shares,
      masterPublicKey: masterPubKey,
      threshold
    };
  }

  // Combine threshold signatures
  static combineThresholdSignatures(
    partialSignatures: Array<{
      index: number;
      signature: Uint8Array;
    }>,
    threshold: number
  ): Uint8Array {
    if (partialSignatures.length < threshold) {
      throw new Error(`Need at least ${threshold} signatures, got ${partialSignatures.length}`);
    }

    // Use Lagrange interpolation to combine signatures
    const indices = partialSignatures.map(ps => BigInt(ps.index));
    const signatures = partialSignatures.map(ps => ps.signature);

    // For simplicity, we aggregate the first 'threshold' signatures
    // In a real implementation, proper Lagrange interpolation would be used
    return this.aggregateSignatures(signatures.slice(0, threshold));
  }
}

// Batch signature verification for efficiency
export class BatchVerifier {
  private signatures: Array<{
    signature: Uint8Array;
    message: Uint8Array;
    publicKey: Uint8Array;
  }> = [];

  add(signature: Uint8Array, message: Uint8Array | string, publicKey: Uint8Array): void {
    const msgBytes = typeof message === 'string' ? utf8ToBytes(message) : message;
    this.signatures.push({
      signature,
      message: msgBytes,
      publicKey
    });
  }

  verify(): boolean {
    if (this.signatures.length === 0) return true;

    const signatures = this.signatures.map(s => s.signature);
    const messages = this.signatures.map(s => s.message);
    const publicKeys = this.signatures.map(s => s.publicKey);

    const aggregatedSig = BLSAggregator.aggregateSignatures(signatures);
    return BLSAggregator.verifyAggregated(aggregatedSig, messages, publicKeys);
  }

  clear(): void {
    this.signatures = [];
  }
}

// Helper functions for integration with existing systems
export function createBLSSignedOrder(
  order: any,
  privateKey: Uint8Array
): { order: any; blsSignature: string; blsPublicKey: string } {
  const orderHash = sha256(JSON.stringify(order));
  const signature = BLSAggregator.sign(orderHash, privateKey);
  const publicKey = bls.getPublicKey(privateKey);

  return {
    order,
    blsSignature: bytesToHex(signature),
    blsPublicKey: bytesToHex(publicKey)
  };
}

export function verifyBLSSignedOrder(
  order: any,
  blsSignature: string,
  blsPublicKey: string
): boolean {
  const orderHash = sha256(JSON.stringify(order));
  const signature = hexToBytes(blsSignature);
  const publicKey = hexToBytes(blsPublicKey);

  return BLSAggregator.verify(signature, orderHash, publicKey);
}

// Aggregate multiple signed orders
export function aggregateOrderSignatures(
  signedOrders: Array<{
    order: any;
    blsSignature: string;
    blsPublicKey: string;
    signerAddress: string;
  }>
): AggregatedSignature {
  const signatures = signedOrders.map(so => hexToBytes(so.blsSignature));
  const publicKeys = signedOrders.map(so => hexToBytes(so.blsPublicKey));
  const signers = signedOrders.map(so => so.signerAddress);

  const aggregatedSignature = BLSAggregator.aggregateSignatures(signatures);
  const aggregatedPublicKey = BLSAggregator.aggregatePublicKeys(publicKeys);

  return {
    aggregatedSignature,
    aggregatedPublicKey,
    signers
  };
}

// Export constants for on-chain verification
export const BLS_CONSTANTS = {
  FIELD_MODULUS: bls.CURVE.r.toString(),
  CURVE_ORDER: bls.CURVE.n.toString(),
  DST: bytesToHex(BLSAggregator['DST'])
};