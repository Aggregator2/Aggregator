# Settlement Proof System

This document describes the Merkle tree-based settlement proof system that provides cryptographic proof of trade inclusion in on-chain settlements.

## Overview

The Settlement Proof System generates and stores Merkle proofs for every trade included in a settlement batch. These proofs allow users to independently verify that their trades were properly settled on-chain without requiring trust in the settlement operator.

### Key Features

- **Merkle Tree Generation**: Creates a Merkle tree from all trades in a settlement batch
- **On-chain Root Storage**: Stores the Merkle root in the settlement smart contract
- **Individual Proof Generation**: Generates proof for each trade showing inclusion in the tree
- **Proof Verification**: Allows independent verification against the on-chain root
- **Persistent Storage**: Stores proofs in database with configurable retention
- **API Access**: RESTful endpoint for retrieving proofs by trade ID
- **UI Component**: React component for viewing and verifying proofs

## Architecture

```
Settlement Flow with Proofs:
Trades → Settlement Engine → Merkle Tree Generation
                                    ↓
                              Merkle Root
                              /          \
                    On-chain Storage    Individual Proofs
                         ↓                      ↓
                  Smart Contract          Proof Database
                         ↓                      ↓
                    Verification ←──────── API Endpoint
                                              ↓
                                         UI Component
```

## Components

### 1. MerkleSettlementProof
Core service for generating Merkle trees and proofs.

```typescript
const merkleProof = new MerkleSettlementProof();

// Generate Merkle tree from settlements
const { root, tree, leaves } = merkleProof.generateMerkleTree(settlements);

// Generate proof for specific settlement
const proof = merkleProof.generateProof(settlement, settlements);

// Verify a proof
const isValid = merkleProof.verifyProof(proof);
```

### 2. SettlementProofStorage
Database service for storing and retrieving proofs.

```typescript
const storage = new SettlementProofStorage({
  maxProofsPerBatch: 10000,
  retentionPeriodDays: 365,
  enableCompression: true
});

// Store proof
const storedProof = await storage.storeProof(proof);

// Retrieve proof
const proof = await storage.getProofByTradeId(tradeId);
```

### 3. ProofGeneratingSettlementEngine
Enhanced settlement engine that automatically generates proofs.

```typescript
const engine = new ProofGeneratingSettlementEngine(provider, privateKey, {
  // ... other config
  proofStorageEnabled: true,
  generateProofsAsync: false,
  storeOnChainRoot: true
});
```

### 4. Settlement Smart Contract
Solidity contract that stores Merkle roots on-chain.

```solidity
contract SettlementWithMerkleProof {
  // Execute settlement and store root
  function executeSettlementWithProof(
    bytes32 batchId,
    bytes32 merkleRoot,
    address[] users,
    address[] tokens,
    int256[] amounts,
    uint256 leafCount
  ) external;

  // Verify a settlement proof
  function verifySettlement(
    bytes32 batchId,
    bytes32 leaf,
    bytes32[] proof,
    uint256 position
  ) external view returns (bool);
}
```

## Proof Structure

### Settlement Leaf
Each trade is encoded as a leaf in the Merkle tree:

```typescript
interface SettlementLeaf {
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
```

### Leaf Encoding
Leaves are encoded deterministically using ABI encoding:

```typescript
const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
  ['string', 'address', 'address', 'uint256', 'uint256', 'address', 'address', 'uint256', 'uint256'],
  [tradeId, buyer, seller, buyerAmount, sellerAmount, buyerToken, sellerToken, timestamp, nonce]
);
const leafHash = ethers.keccak256(ethers.keccak256(encoded)); // Double hash
```

### Merkle Proof
The proof contains everything needed for verification:

```typescript
interface MerkleProof {
  leaf: string;      // Leaf hash
  proof: string[];   // Sibling hashes
  position: number;  // Leaf position in tree
  root: string;      // Merkle root
}
```

## API Endpoint

### GET /api/settlement/proof/:tradeId

Retrieves the settlement proof for a specific trade.

#### Request
```
GET /api/settlement/proof/trade-123
```

#### Query Parameters
- `verify` (optional): Set to `true` to include on-chain verification

#### Response
```json
{
  "success": true,
  "proof": {
    "tradeId": "trade-123",
    "settlementBatchId": "batch-001",
    "transactionHash": "0x...",
    "blockNumber": 12345678,
    "timestamp": 1234567890,
    "trade": {
      "buyer": "0x...",
      "seller": "0x...",
      "buyerAmount": "100000000000000000000",
      "sellerAmount": "40000000000000000",
      "buyerToken": "0x...",
      "sellerToken": "0x...",
      "timestamp": 1234567890,
      "nonce": 0
    },
    "merkleProof": {
      "root": "0x...",
      "leaf": "0x...",
      "proof": ["0x...", "0x..."],
      "position": 0
    },
    "onChainVerification": {
      "onChainRoot": "0x...",
      "proofRoot": "0x...",
      "rootsMatch": true,
      "proofValid": true,
      "verifiedAt": "2024-01-01T00:00:00.000Z"
    },
    "etherscan": {
      "verificationUrl": "https://etherscan.io/tx/0x...",
      "calldata": "0x...",
      "decodedParams": {...}
    }
  }
}
```

## UI Component

### SettlementProofViewer
React component for displaying and verifying proofs.

```typescript
<SettlementProofViewer
  tradeId="trade-123"
  apiEndpoint="/api/settlement/proof"
  provider={provider}
  onVerified={(verified) => console.log('Verified:', verified)}
/>
```

### Features
- Trade details display
- Settlement information
- Merkle proof visualization
- On-chain verification
- Etherscan links
- Copy-to-clipboard functionality

## Verification Process

### 1. Client-side Verification
```typescript
// Reconstruct leaf hash from trade data
const leafHash = merkleProof.generateLeafHash(trade);

// Verify proof
const isValid = merkleProof.verifyProof({
  leaf: leafHash,
  proof: proofPath,
  position: leafPosition,
  root: merkleRoot
});
```

### 2. On-chain Verification
```solidity
// Call contract to verify
bool isValid = settlementContract.verifySettlement(
  batchId,
  leafHash,
  proofPath,
  position
);
```

### 3. Independent Verification
Users can independently verify by:
1. Getting the on-chain Merkle root for their batch
2. Reconstructing their leaf hash from trade data
3. Computing the root using their proof path
4. Comparing computed root with on-chain root

## Security Considerations

### 1. Leaf Construction
- Double hashing prevents length extension attacks
- Deterministic encoding ensures consistency
- Nonce prevents duplicate leaves

### 2. Tree Construction
- Leaves are sorted for deterministic trees
- Odd-level nodes are duplicated (no zero padding)
- Uses Keccak256 for hashing

### 3. Proof Storage
- Proofs are immutable once generated
- Retention period ensures long-term verifiability
- Database backups recommended

### 4. On-chain Storage
- Only root is stored on-chain (gas efficient)
- Root cannot be modified after storage
- Contract access controlled

## Best Practices

### 1. Proof Generation
- Generate proofs immediately after settlement
- Store proofs before marking trades as complete
- Use async generation for large batches

### 2. Storage Management
```typescript
// Configure appropriate retention
const storage = new SettlementProofStorage({
  retentionPeriodDays: 365 * 7, // 7 years
  maxProofsPerBatch: 10000
});

// Regular backups
const backup = await storage.exportProofs();
```

### 3. API Performance
- Enable caching for proof endpoints
- Use CDN for static proof data
- Implement rate limiting

### 4. User Experience
- Show proof status in trade history
- Provide easy verification tools
- Include educational content

## Integration Examples

### Basic Integration
```typescript
// 1. Configure settlement engine
const engine = new ProofGeneratingSettlementEngine(provider, key, {
  proofStorageEnabled: true,
  storeOnChainRoot: true
});

// 2. Settle trades (proofs generated automatically)
engine.addSettlement({
  tradeId: 'trade-123',
  buyer: '0x...',
  seller: '0x...',
  // ... other fields
});

// 3. Retrieve proof later
const proof = await engine.getTradeProof('trade-123');

// 4. Verify settlement
const result = await engine.verifyTradeSettlement('trade-123');
```

### Advanced Integration
```typescript
// Listen to proof events
engine.on('merkleTreeGenerated', (data) => {
  console.log('Root:', data.root, 'Leaves:', data.leafCount);
});

engine.on('proofsGenerated', (data) => {
  console.log('Generated', data.proofCount, 'proofs');
});

// Custom proof handling
engine.on('bundleExecuted', async (data) => {
  // Store root in your own system
  await myDatabase.storeMerkleRoot(data.merkleRoot);
  
  // Send notifications
  await notifyUsersOfSettlement(data.bundleId);
});
```

## Troubleshooting

### Common Issues

1. **"Proof not found"**
   - Check if trade was actually settled
   - Verify trade ID format
   - Check retention period

2. **"Verification failed"**
   - Ensure correct on-chain root
   - Verify leaf construction matches
   - Check proof path order

3. **"On-chain root mismatch"**
   - Verify correct batch ID
   - Check contract address
   - Ensure transaction confirmed

### Debug Tools
```typescript
// Manually verify a proof
const leaf = merkleProof.generateLeafHash(tradeData);
const proof = { leaf, proof: [...], position: 0, root: '0x...' };
const isValid = merkleProof.verifyProof(proof);

// Check on-chain root
const contract = new ethers.Contract(address, abi, provider);
const root = await contract.getSettlementRoot(batchId);
```

## Performance Optimization

### 1. Batch Processing
```typescript
// Generate all proofs at once
const proofs = merkleProof.batchGenerateProofs(
  settlements,
  batchId,
  txHash,
  blockNumber
);
```

### 2. Async Generation
```typescript
// Don't block settlement for proof generation
const engine = new ProofGeneratingSettlementEngine(provider, key, {
  generateProofsAsync: true // Non-blocking
});
```

### 3. Caching Strategy
- Cache proofs in memory for recent trades
- Use Redis for distributed caching
- Set appropriate TTLs

## Compliance & Audit

### Record Keeping
- Proofs serve as immutable settlement records
- Retain for regulatory requirements
- Export for audit purposes

### Verification Trail
```typescript
// Complete verification trail
const auditTrail = {
  tradeId: proof.tradeId,
  settlementBatch: proof.settlementBatchId,
  onChainTx: proof.transactionHash,
  merkleRoot: proof.merkleProof.root,
  verificationDate: new Date(),
  verificationResult: isValid
};
```

## Future Enhancements

1. **IPFS Integration**: Store full proof data on IPFS
2. **Multi-chain Support**: Cross-chain proof verification
3. **ZK Proofs**: Privacy-preserving settlement proofs
4. **Automated Disputes**: Smart contract dispute resolution