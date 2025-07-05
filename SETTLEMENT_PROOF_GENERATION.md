# Settlement Proof Generation Documentation

## Overview

The Settlement Proof Generation system provides cryptographic proof of trade settlements on-chain using Merkle trees. Each settlement batch generates a Merkle root that is stored on-chain, allowing users to verify their individual settlements and claim tokens using Merkle proofs.

## Architecture

### Key Components

1. **MerkleTree Utility** (`/src/utils/merkleTree.ts`)
   - Generates Merkle trees from settlement data
   - Creates and verifies Merkle proofs
   - Uses keccak256 hashing for Ethereum compatibility

2. **SettlementProofEngine** (`/src/services/settlement/SettlementProofEngine.ts`)
   - Manages proof generation and storage
   - Submits Merkle roots to blockchain
   - Handles proof verification

3. **ProofEnabledFinalSettlementEngine** (`/src/services/settlement/ProofEnabledFinalSettlementEngine.ts`)
   - Enhanced settlement engine with proof generation
   - Captures transaction hash and block number
   - Integrates with IPFS for full data storage

4. **SettlementWithProofs Contract** (`/contracts/settlement/SettlementWithProofs.sol`)
   - Stores Merkle roots on-chain
   - Verifies proofs for claims
   - Manages token distribution

## Settlement Proof Flow

### 1. Settlement Processing
```
Trade Execution → Epoch End → Settlement Calculation → Merkle Tree Generation
```

### 2. Proof Generation
```javascript
// Settlement leaves format
{
  userId: "0x...",      // User's Ethereum address
  token: "0x...",       // Token contract address
  amount: "1000000"     // Settlement amount (in wei)
}
```

### 3. On-Chain Submission
```
Merkle Root → Smart Contract → Transaction Hash → Block Confirmation
```

### 4. Proof Storage
```
Individual Proofs → Database → API Access → User Verification
```

## API Endpoints

### Get Settlement Proof by Trade ID
```http
GET /api/settlement/proof/:tradeId
```

**Response:**
```json
{
  "success": true,
  "proof": {
    "tradeId": "TRADE123",
    "epochId": "EPOCH456",
    "userId": "0x...",
    "token": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    "amount": "1000000000",
    "merkleRoot": "0x...",
    "merkleProof": ["0x...", "0x..."],
    "transactionHash": "0x...",
    "blockNumber": 15234567
  },
  "verification": {
    "etherscanUrl": "https://etherscan.io/address/0x...#readContract",
    "instructions": {
      "step1": "Go to Etherscan verification URL",
      "step2": "Find 'verifyProof' function",
      "step3": "Enter parameters",
      "step4": "Click Query to verify"
    }
  }
}
```

### Get User's Settlement Proofs
```http
GET /api/settlement/proof/user/:userId
GET /api/settlement/proof/user/:userId?unclaimed=true
GET /api/settlement/proof/user/:userId?epochId=EPOCH123
```

### Verify Settlement Proof
```http
POST /api/settlement/proof/verify

Body:
{
  "epochId": "EPOCH123",
  "userId": "0x...",
  "token": "0x...",
  "amount": "1000000000",
  "merkleProof": ["0x...", "0x..."],
  "verifyOnChain": true
}
```

### Claim Settlement
```http
POST /api/settlement/proof/claim

Body:
{
  "epochId": "EPOCH123",
  "userId": "0x...",
  "token": "0x...",
  "amount": "1000000000",
  "merkleProof": ["0x...", "0x..."]
}
```

## Database Schema

### settlement_proofs
- Stores individual Merkle proofs for each settlement
- Links trades to their proof data
- Contains transaction hash and block number

### settlement_claims
- Tracks claim status for each user
- Records claim transaction details
- Prevents double claims

## Configuration

### Environment Variables
```env
# Settlement Proof Configuration
SETTLEMENT_CONTRACT_ADDRESS=0x...
SETTLEMENT_CONTRACT_ABI=[...]
PROOF_GENERATION_ENABLED=true
IPFS_API_URL=https://ipfs.infura.io:5001
CONFIRMATION_BLOCKS=2
CHAIN_ID=1
```

### Settlement Engine Configuration
```javascript
const proofConfig = {
  enabled: true,
  contractAddress: process.env.SETTLEMENT_CONTRACT_ADDRESS,
  contractABI: settlementABI,
  ipfsEnabled: true,
  ipfsApiUrl: process.env.IPFS_API_URL,
  confirmationBlocks: 2
};

const settlementEngine = new ProofEnabledFinalSettlementEngine(
  config,
  provider,
  signer,
  proofConfig
);
```

## Verification Methods

### 1. Local Verification
```javascript
// Verify proof locally without blockchain call
const leaf = keccak256(encode(['address', 'address', 'uint256'], [user, token, amount]));
const isValid = MerkleTree.verifyProof(leaf, proof, root, index);
```

### 2. On-Chain Verification
```javascript
// Verify using smart contract
const isValid = await contract.verifyProof(epochId, user, token, amount, proof);
```

### 3. Etherscan Verification
Users can verify directly on Etherscan:
1. Go to contract address on Etherscan
2. Navigate to "Read Contract" tab
3. Find `verifyProof` function
4. Enter parameters from API response
5. Click "Query" to verify

## Security Considerations

1. **Merkle Tree Construction**
   - Leaves are sorted deterministically
   - Uses keccak256 hashing (Ethereum standard)
   - Prevents second preimage attacks

2. **Proof Storage**
   - Compact encoding reduces storage costs
   - Database indexes for efficient retrieval
   - Immutable once generated

3. **Claim Security**
   - On-chain verification prevents fraud
   - Single claim per user per epoch
   - Contract holds settlement tokens

4. **Transaction Security**
   - Wait for block confirmations
   - Monitor for chain reorganizations
   - Retry failed transactions

## Best Practices

1. **For Settlement Operators**
   - Monitor proof generation logs
   - Ensure sufficient gas for transactions
   - Backup proof data regularly
   - Verify IPFS uploads if enabled

2. **For Users**
   - Save proof data locally
   - Verify before claiming
   - Check gas prices before claiming
   - Monitor claim transaction

3. **For Developers**
   - Cache proof data for performance
   - Implement retry logic for claims
   - Handle chain reorganizations
   - Monitor contract events

## Troubleshooting

### Common Issues

1. **Proof Generation Fails**
   - Check settlement engine logs
   - Verify contract deployment
   - Ensure sufficient gas

2. **Verification Fails**
   - Confirm correct parameters
   - Check merkle root matches
   - Verify epoch is finalized

3. **Claim Fails**
   - Check token balance in contract
   - Verify user hasn't claimed
   - Ensure correct proof data

## Example Integration

```javascript
// Get user's unclaimed settlements
const response = await fetch(`/api/settlement/proof/user/${userAddress}?unclaimed=true`);
const { proofs } = await response.json();

// Verify each proof
for (const proof of proofs) {
  const verifyResponse = await fetch('/api/settlement/proof/verify', {
    method: 'POST',
    body: JSON.stringify({
      epochId: proof.epochId,
      userId: userAddress,
      token: proof.token,
      amount: proof.amount,
      merkleProof: proof.merkleProof
    })
  });
  
  const { verification } = await verifyResponse.json();
  console.log(`Proof valid: ${verification.local.valid}`);
}

// Claim settlements
for (const proof of proofs) {
  const claimResponse = await fetch('/api/settlement/proof/claim', {
    method: 'POST',
    body: JSON.stringify({
      epochId: proof.epochId,
      userId: userAddress,
      token: proof.token,
      amount: proof.amount,
      merkleProof: proof.merkleProof
    })
  });
  
  const { transactionHash } = await claimResponse.json();
  console.log(`Claimed: ${transactionHash}`);
}
```

## Future Enhancements

1. **Batch Claims** - Allow claiming multiple settlements in one transaction
2. **Gasless Claims** - Implement meta-transactions for gas-free claims  
3. **Cross-Chain Proofs** - Support proofs across multiple chains
4. **ZK Proofs** - Enhanced privacy with zero-knowledge proofs
5. **Automated Claims** - Bot service for automatic claiming