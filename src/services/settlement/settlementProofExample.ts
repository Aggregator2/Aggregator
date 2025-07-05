import { ethers } from 'ethers';
import { ProofGeneratingSettlementEngine } from './ProofGeneratingSettlementEngine';
import { MerkleSettlementProof, SettlementLeaf } from './MerkleSettlementProof';
import { SettlementProofStorage } from './SettlementProofStorage';

// Example: Complete settlement proof workflow
async function demonstrateSettlementProofSystem() {
  console.log('\n=== Settlement Proof System Demo ===\n');

  // 1. Initialize services
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || 'http://localhost:8545');
  const privateKey = process.env.SETTLEMENT_PRIVATE_KEY || '0x...';
  
  const settlementEngine = new ProofGeneratingSettlementEngine(
    provider,
    privateKey,
    {
      // MEV Protection config
      mevProtection: {
        primaryProvider: 'FLASHBOTS' as any,
        fallbackProviders: ['STANDARD' as any],
        maxBlocksInFuture: 25,
        simulationEnabled: true,
        bundleTimeout: 120000,
        retryAttempts: 3,
        retryDelay: 1000
      },
      
      // Settlement config
      settlementContractAddress: process.env.SETTLEMENT_CONTRACT || '0x...',
      epochDuration: 300000, // 5 minutes
      prioritizeLargeSettlements: true,
      simulateBeforeSending: true,
      
      // Proof config
      proofStorageEnabled: true,
      generateProofsAsync: false,
      storeOnChainRoot: true
    }
  );

  // 2. Create sample trades
  const trades = [
    {
      id: 'trade-001',
      buyer: '0x1234567890123456789012345678901234567890',
      seller: '0x0987654321098765432109876543210987654321',
      buyerAmount: ethers.parseEther('100'), // 100 USDC
      sellerAmount: ethers.parseEther('0.04'), // 0.04 ETH
      buyerToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
      sellerToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
      timestamp: Date.now()
    },
    {
      id: 'trade-002',
      buyer: '0x2345678901234567890123456789012345678901',
      seller: '0x9876543210987654321098765432109876543210',
      buyerAmount: ethers.parseEther('500'), // 500 USDC
      sellerAmount: ethers.parseEther('0.2'), // 0.2 ETH
      buyerToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
      sellerToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
      timestamp: Date.now()
    },
    {
      id: 'trade-003',
      buyer: '0x3456789012345678901234567890123456789012',
      seller: '0x8765432109876543210987654321098765432109',
      buyerAmount: ethers.parseEther('250'), // 250 USDC
      sellerAmount: ethers.parseEther('0.1'), // 0.1 ETH
      buyerToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
      sellerToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
      timestamp: Date.now()
    }
  ];

  // 3. Add trades to settlement engine
  console.log('Adding trades to settlement engine...');
  for (const trade of trades) {
    settlementEngine.addSettlement({
      tradeId: trade.id,
      buyer: trade.buyer,
      seller: trade.seller,
      buyerAmount: trade.buyerAmount,
      sellerAmount: trade.sellerAmount,
      buyerToken: trade.buyerToken,
      sellerToken: trade.sellerToken,
      timestamp: trade.timestamp,
      priority: 50
    });
  }

  // 4. Listen for proof generation events
  settlementEngine.on('merkleTreeGenerated', (data) => {
    console.log('Merkle tree generated:', {
      root: data.root,
      leafCount: data.leafCount,
      treeHeight: data.treeHeight
    });
  });

  settlementEngine.on('proofsGenerated', (data) => {
    console.log('Proofs generated:', {
      bundleId: data.bundleId,
      proofCount: data.proofCount,
      merkleRoot: data.merkleRoot
    });
  });

  settlementEngine.on('bundleExecuted', (data) => {
    console.log('Bundle executed on-chain:', {
      bundleId: data.bundleId,
      txHash: data.transactionHash,
      merkleRoot: data.merkleRoot
    });
  });

  // 5. Wait for epoch to complete (in production)
  console.log('\nWaiting for settlement epoch...');
  // In production, this would wait for the epoch duration
  // For demo, we'll simulate immediate execution
  
  // 6. Retrieve and verify proofs
  console.log('\n=== Verifying Settlement Proofs ===\n');
  
  for (const trade of trades) {
    try {
      const proof = await settlementEngine.getTradeProof(trade.id);
      
      if (proof) {
        console.log(`\nProof for trade ${trade.id}:`);
        console.log('- Merkle Root:', proof.merkleProof.root);
        console.log('- Leaf Hash:', proof.merkleProof.leaf);
        console.log('- Position:', proof.merkleProof.position);
        console.log('- Proof Length:', proof.merkleProof.proof.length);
        
        // Verify the trade was settled
        const verification = await settlementEngine.verifyTradeSettlement(trade.id);
        console.log('- Verification:', verification.verified ? '✅ VERIFIED' : '❌ FAILED');
        
        if (verification.onChainRoot) {
          console.log('- On-chain Root:', verification.onChainRoot);
        }
      } else {
        console.log(`No proof found for trade ${trade.id}`);
      }
    } catch (error) {
      console.error(`Error verifying trade ${trade.id}:`, error.message);
    }
  }

  // 7. Get proof statistics
  const stats = settlementEngine.getProofStats();
  console.log('\n=== Proof Statistics ===');
  console.log('Cached Proofs:', stats.cachedProofs);
  console.log('Total Storage:', stats.totalProofs);
  console.log('Total Batches:', stats.totalBatches);
}

// Example: Verify individual proof
async function verifyIndividualProof() {
  console.log('\n=== Individual Proof Verification ===\n');

  const merkleProof = new MerkleSettlementProof();
  
  // Sample settlement leaves
  const settlements: SettlementLeaf[] = [
    {
      tradeId: 'trade-001',
      buyer: '0x1234567890123456789012345678901234567890',
      seller: '0x0987654321098765432109876543210987654321',
      buyerAmount: ethers.parseEther('100'),
      sellerAmount: ethers.parseEther('0.04'),
      buyerToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      sellerToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      timestamp: Date.now(),
      nonce: 0
    },
    {
      tradeId: 'trade-002',
      buyer: '0x2345678901234567890123456789012345678901',
      seller: '0x9876543210987654321098765432109876543210',
      buyerAmount: ethers.parseEther('500'),
      sellerAmount: ethers.parseEther('0.2'),
      buyerToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      sellerToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      timestamp: Date.now(),
      nonce: 1
    }
  ];

  // Generate Merkle tree
  const { root, tree, leaves } = merkleProof.generateMerkleTree(settlements);
  console.log('Merkle Root:', root);
  console.log('Tree Height:', tree.length);

  // Generate proof for first trade
  const proof = merkleProof.generateProof(settlements[0], settlements);
  console.log('\nProof for trade-001:');
  console.log('- Leaf:', proof.leaf);
  console.log('- Position:', proof.position);
  console.log('- Proof Path:', proof.proof);

  // Verify the proof
  const isValid = merkleProof.verifyProof(proof);
  console.log('\nProof verification:', isValid ? '✅ VALID' : '❌ INVALID');

  // Verify with wrong root
  const tamperedProof = { ...proof, root: '0x' + '0'.repeat(64) };
  const isTampered = merkleProof.verifyProof(tamperedProof);
  console.log('Tampered proof verification:', isTampered ? '✅ VALID' : '❌ INVALID (expected)');
}

// Example: Storage operations
async function demonstrateProofStorage() {
  console.log('\n=== Proof Storage Demo ===\n');

  const storage = new SettlementProofStorage({
    maxProofsPerBatch: 1000,
    retentionPeriodDays: 365,
    enableCompression: true
  });

  // Create sample proofs
  const proofs = [];
  for (let i = 0; i < 5; i++) {
    const proof = {
      tradeId: `trade-${i.toString().padStart(3, '0')}`,
      leaf: {
        tradeId: `trade-${i.toString().padStart(3, '0')}`,
        buyer: ethers.Wallet.createRandom().address,
        seller: ethers.Wallet.createRandom().address,
        buyerAmount: ethers.parseEther((Math.random() * 1000).toFixed(2)),
        sellerAmount: ethers.parseEther((Math.random() * 1).toFixed(4)),
        buyerToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        sellerToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        timestamp: Date.now() - i * 60000,
        nonce: i
      },
      merkleProof: {
        leaf: ethers.id(`leaf-${i}`),
        proof: [ethers.id(`proof-${i}-0`), ethers.id(`proof-${i}-1`)],
        position: i,
        root: ethers.id('sample-root')
      },
      settlementBatchId: 'batch-001',
      transactionHash: '0x' + ethers.randomBytes(32).map(b => b.toString(16).padStart(2, '0')).join(''),
      blockNumber: 1000000 + i,
      timestamp: Date.now() - i * 60000
    };
    proofs.push(proof);
  }

  // Store proofs
  console.log('Storing proofs...');
  const storedProofs = await storage.batchStoreProofs(proofs);
  console.log(`Stored ${storedProofs.length} proofs`);

  // Search proofs
  const searchResults = await storage.searchProofs({
    batchId: 'batch-001',
    startDate: new Date(Date.now() - 3600000), // Last hour
    endDate: new Date()
  });
  console.log(`\nFound ${searchResults.length} proofs matching criteria`);

  // Get batch summary
  const batchSummary = await storage.getBatchSummary('batch-001');
  if (batchSummary) {
    console.log('\nBatch Summary:');
    console.log('- Batch ID:', batchSummary.batchId);
    console.log('- Merkle Root:', batchSummary.merkleRoot);
    console.log('- Leaf Count:', batchSummary.leafCount);
    console.log('- Block Number:', batchSummary.blockNumber);
  }

  // Export proofs
  const exportData = await storage.exportProofs('batch-001');
  console.log('\nExported batch data:', {
    batchId: exportData.batch.id,
    proofCount: exportData.proofs.length
  });

  // Get storage statistics
  const stats = storage.getStorageStats();
  console.log('\nStorage Statistics:');
  console.log('- Total Proofs:', stats.totalProofs);
  console.log('- Total Batches:', stats.totalBatches);
  console.log('- Average Proofs per Batch:', stats.averageProofsPerBatch.toFixed(2));
}

// Main execution
async function main() {
  try {
    await demonstrateSettlementProofSystem();
    await verifyIndividualProof();
    await demonstrateProofStorage();
  } catch (error) {
    console.error('Error:', error);
  }
}

// Export functions
export {
  demonstrateSettlementProofSystem,
  verifyIndividualProof,
  demonstrateProofStorage
};

// Run if executed directly
if (require.main === module) {
  main().catch(console.error);
}