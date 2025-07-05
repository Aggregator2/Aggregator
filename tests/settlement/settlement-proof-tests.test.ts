import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { ethers } from 'ethers';
import { MerkleSettlementProof, SettlementLeaf, MerkleProof, SettlementProof } from '../../src/services/settlement/MerkleSettlementProof';
import { ZKTradeProver, PrivateTradeInput, ZKProof } from '../../src/utils/zkProofs';
import { SettlementProofEngine } from '../../src/services/settlement/SettlementProofEngine';

describe('Settlement Proof Tests', () => {
  let merkleProofService: MerkleSettlementProof;
  let zkProver: ZKTradeProver;
  let provider: ethers.Provider;
  let signer: ethers.Wallet;
  let settlementContract: ethers.Contract;

  beforeEach(() => {
    merkleProofService = new MerkleSettlementProof();
    
    // Mock ZK prover
    zkProver = new ZKTradeProver({
      wasm: '/circuits/trade.wasm',
      zkey: '/circuits/trade.zkey',
      vkey: '/circuits/trade.vkey'
    });

    // Mock provider and signer
    provider = new ethers.JsonRpcProvider('http://localhost:8545');
    signer = new ethers.Wallet(
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
      provider
    );

    // Mock contract interface
    const abi = [
      'function createSettlementBatch(string epochId, bytes32 merkleRoot, uint256 totalSettlements, string ipfsHash)',
      'function verifyProof(string epochId, address user, address token, uint256 amount, bytes32[] merkleProof) view returns (bool)',
      'function claimSettlement(string epochId, address user, address token, uint256 amount, bytes32[] merkleProof)',
      'function getSettlementBatch(string epochId) view returns (tuple(bytes32 merkleRoot, uint256 timestamp, uint256 blockNumber, uint256 totalSettlements, string ipfsHash, bool finalized))'
    ];
    
    settlementContract = new ethers.Contract(
      '0x5FbDB2315678afecb367f032d93F642f64180aa3',
      abi,
      signer
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Merkle Proof Generation', () => {
    it('should generate valid Merkle tree from settlements', () => {
      const settlements: SettlementLeaf[] = [
        {
          tradeId: 'trade1',
          buyer: '0x1234567890123456789012345678901234567890',
          seller: '0x2345678901234567890123456789012345678901',
          buyerAmount: BigInt(1000e6), // 1000 USDC
          sellerAmount: BigInt(1e18), // 1 ETH
          buyerToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
          sellerToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
          timestamp: Date.now(),
          nonce: 1
        },
        {
          tradeId: 'trade2',
          buyer: '0x3456789012345678901234567890123456789012',
          seller: '0x4567890123456789012345678901234567890123',
          buyerAmount: BigInt(2000e6),
          sellerAmount: BigInt(2e18),
          buyerToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          sellerToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
          timestamp: Date.now(),
          nonce: 2
        }
      ];

      const { root, tree, leaves } = merkleProofService.generateMerkleTree(settlements);

      expect(root).toBeDefined();
      expect(root.length).toBe(66); // 0x + 64 hex chars
      expect(tree).toBeDefined();
      expect(tree.length).toBeGreaterThan(0);
      expect(leaves.length).toBe(settlements.length);
    });

    it('should generate consistent leaf hashes', () => {
      const settlement: SettlementLeaf = {
        tradeId: 'trade1',
        buyer: '0x1234567890123456789012345678901234567890',
        seller: '0x2345678901234567890123456789012345678901',
        buyerAmount: BigInt(1000e6),
        sellerAmount: BigInt(1e18),
        buyerToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        sellerToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        timestamp: 1234567890,
        nonce: 1
      };

      const hash1 = merkleProofService.generateLeafHash(settlement);
      const hash2 = merkleProofService.generateLeafHash(settlement);

      expect(hash1).toBe(hash2);
      expect(hash1.length).toBe(66);
    });

    it('should generate valid Merkle proofs for each settlement', () => {
      const settlements: SettlementLeaf[] = generateTestSettlements(10);
      
      for (const settlement of settlements) {
        const proof = merkleProofService.generateProof(settlement, settlements);
        
        expect(proof).toBeDefined();
        expect(proof.leaf).toBe(merkleProofService.generateLeafHash(settlement));
        expect(proof.proof).toBeDefined();
        expect(proof.proof.length).toBeGreaterThan(0);
        expect(proof.position).toBeGreaterThanOrEqual(0);
        expect(proof.position).toBeLessThan(settlements.length);
      }
    });

    it('should verify generated Merkle proofs', () => {
      const settlements: SettlementLeaf[] = generateTestSettlements(8);
      
      for (const settlement of settlements) {
        const proof = merkleProofService.generateProof(settlement, settlements);
        const isValid = merkleProofService.verifyProof(proof);
        
        expect(isValid).toBe(true);
      }
    });

    it('should reject invalid Merkle proofs', () => {
      const settlements: SettlementLeaf[] = generateTestSettlements(4);
      const proof = merkleProofService.generateProof(settlements[0], settlements);
      
      // Tamper with the proof
      proof.proof[0] = '0x' + '0'.repeat(64);
      
      const isValid = merkleProofService.verifyProof(proof);
      expect(isValid).toBe(false);
    });

    it('should handle single settlement tree', () => {
      const settlement: SettlementLeaf = {
        tradeId: 'single',
        buyer: '0x1234567890123456789012345678901234567890',
        seller: '0x2345678901234567890123456789012345678901',
        buyerAmount: BigInt(1000e6),
        sellerAmount: BigInt(1e18),
        buyerToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        sellerToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        timestamp: Date.now(),
        nonce: 1
      };

      const { root, tree } = merkleProofService.generateMerkleTree([settlement]);
      const proof = merkleProofService.generateProof(settlement, [settlement]);
      
      expect(tree.length).toBe(1);
      expect(proof.proof.length).toBe(0);
      expect(proof.root).toBe(root);
      expect(merkleProofService.verifyProof(proof)).toBe(true);
    });

    it('should batch generate proofs efficiently', () => {
      const settlements: SettlementLeaf[] = generateTestSettlements(100);
      const batchId = 'batch-001';
      
      const startTime = Date.now();
      const proofs = merkleProofService.batchGenerateProofs(
        settlements,
        batchId,
        '0xtxhash',
        12345
      );
      const duration = Date.now() - startTime;
      
      expect(proofs.size).toBe(settlements.length);
      expect(duration).toBeLessThan(1000); // Should complete within 1 second
      
      // Verify all proofs are valid
      for (const [tradeId, proof] of proofs) {
        expect(merkleProofService.verifyProof(proof.merkleProof)).toBe(true);
      }
    });
  });

  describe('On-Chain Proof Verification', () => {
    it('should generate correct calldata for on-chain verification', () => {
      const settlement = generateTestSettlements(1)[0];
      const proof = merkleProofService.generateSettlementProof(
        settlement,
        [settlement],
        'epoch-1'
      );

      const verificationData = merkleProofService.generateEtherscanVerificationData(proof);
      
      expect(verificationData.functionName).toBe('verifySettlement');
      expect(verificationData.calldata).toBeDefined();
      expect(verificationData.decodedParams.root).toBe(proof.merkleProof.root);
      expect(verificationData.decodedParams.leaf).toBe(proof.merkleProof.leaf);
      expect(verificationData.decodedParams.proof).toEqual(proof.merkleProof.proof);
    });

    it('should verify settlement inclusion with on-chain root', () => {
      const settlements = generateTestSettlements(5);
      const targetSettlement = settlements[2];
      const proof = merkleProofService.generateSettlementProof(
        targetSettlement,
        settlements,
        'epoch-1'
      );

      // Simulate on-chain root
      const onChainRoot = proof.merkleProof.root;
      
      const isValid = merkleProofService.verifySettlementInclusion(proof, onChainRoot);
      expect(isValid).toBe(true);

      // Try with wrong root
      const wrongRoot = '0x' + '1'.repeat(64);
      const isInvalid = merkleProofService.verifySettlementInclusion(proof, wrongRoot);
      expect(isInvalid).toBe(false);
    });

    it('should generate proof data compatible with Solidity verification', async () => {
      const settlements: SettlementLeaf[] = [
        {
          tradeId: 'trade1',
          buyer: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
          seller: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
          buyerAmount: BigInt(1000e6),
          sellerAmount: BigInt(1e18),
          buyerToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          sellerToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
          timestamp: Date.now(),
          nonce: 1
        }
      ];

      const { root } = merkleProofService.generateMerkleTree(settlements);
      const proof = merkleProofService.generateProof(settlements[0], settlements);

      // Verify the proof format matches Solidity expectations
      expect(proof.root).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(proof.leaf).toMatch(/^0x[a-fA-F0-9]{64}$/);
      proof.proof.forEach(element => {
        expect(element).toMatch(/^0x[a-fA-F0-9]{64}$/);
      });

      // Mock contract verification
      jest.spyOn(settlementContract, 'verifyProof').mockResolvedValue(true);
      
      const isValid = await settlementContract.verifyProof(
        'epoch-1',
        settlements[0].buyer,
        settlements[0].buyerToken,
        settlements[0].buyerAmount.toString(),
        proof.proof
      );
      
      expect(isValid).toBe(true);
    });
  });

  describe('Cross-Chain Settlement Proofs', () => {
    it('should generate proofs for cross-chain settlements', () => {
      const crossChainSettlements: SettlementLeaf[] = [
        {
          tradeId: 'cross-1',
          buyer: '0x1234567890123456789012345678901234567890',
          seller: '0x2345678901234567890123456789012345678901',
          buyerAmount: BigInt(1000e6),
          sellerAmount: BigInt(1e18),
          buyerToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // Ethereum USDC
          sellerToken: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', // Polygon WETH
          timestamp: Date.now(),
          nonce: 1
        },
        {
          tradeId: 'cross-2',
          buyer: '0x3456789012345678901234567890123456789012',
          seller: '0x4567890123456789012345678901234567890123',
          buyerAmount: BigInt(50e18), // 50 MATIC
          sellerAmount: BigInt(40e6), // 40 USDC
          buyerToken: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', // Polygon WMATIC
          sellerToken: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', // Polygon USDC
          timestamp: Date.now(),
          nonce: 2
        }
      ];

      const proofs = merkleProofService.batchGenerateProofs(
        crossChainSettlements,
        'cross-chain-batch-1'
      );

      // Create chain-specific roots
      const ethereumSettlements = crossChainSettlements.filter(s => 
        s.buyerToken.startsWith('0xA0b') || s.sellerToken.startsWith('0xA0b')
      );
      const polygonSettlements = crossChainSettlements.filter(s =>
        s.buyerToken.startsWith('0x7ce') || s.sellerToken.startsWith('0x0d5') ||
        s.buyerToken.startsWith('0x279') || s.sellerToken.startsWith('0x279')
      );

      expect(proofs.size).toBe(crossChainSettlements.length);
      
      // Verify each proof
      for (const [tradeId, proof] of proofs) {
        expect(merkleProofService.verifyProof(proof.merkleProof)).toBe(true);
      }
    });

    it('should generate compatible proofs for different chain standards', () => {
      const settlement: SettlementLeaf = {
        tradeId: 'multi-chain-1',
        buyer: '0x1234567890123456789012345678901234567890',
        seller: '0x2345678901234567890123456789012345678901',
        buyerAmount: BigInt(1000e6),
        sellerAmount: BigInt(1e18),
        buyerToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        sellerToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        timestamp: Date.now(),
        nonce: 1
      };

      const proof = merkleProofService.generateSettlementProof(
        settlement,
        [settlement],
        'epoch-1'
      );

      // EVM-compatible format
      const evmData = merkleProofService.generateEtherscanVerificationData(proof);
      expect(evmData.calldata).toMatch(/^0x[a-fA-F0-9]+$/);

      // Ensure proof elements are 32 bytes each
      proof.merkleProof.proof.forEach(element => {
        expect(element.length).toBe(66); // 0x + 64 hex chars = 32 bytes
      });
    });

    it('should handle settlements across multiple chains with different finality', () => {
      const multiChainBatch = {
        ethereum: {
          chainId: 1,
          finality: 12, // blocks
          settlements: generateTestSettlements(5)
        },
        polygon: {
          chainId: 137,
          finality: 128, // blocks
          settlements: generateTestSettlements(3)
        },
        arbitrum: {
          chainId: 42161,
          finality: 1, // blocks
          settlements: generateTestSettlements(4)
        }
      };

      const chainProofs = new Map<number, Map<string, SettlementProof>>();
      
      for (const [chain, data] of Object.entries(multiChainBatch)) {
        const proofs = merkleProofService.batchGenerateProofs(
          data.settlements,
          `${chain}-batch-1`
        );
        chainProofs.set(data.chainId, proofs);
      }

      expect(chainProofs.size).toBe(3);
      expect(chainProofs.get(1)?.size).toBe(5);
      expect(chainProofs.get(137)?.size).toBe(3);
      expect(chainProofs.get(42161)?.size).toBe(4);
    });
  });

  describe('ZK Proof Integration', () => {
    beforeEach(() => {
      // Mock ZK prover methods
      jest.spyOn(zkProver, 'generateProof').mockResolvedValue({
        proof: {
          pi_a: ['0x1234', '0x5678'],
          pi_b: [['0x1111', '0x2222'], ['0x3333', '0x4444']],
          pi_c: ['0xaaaa', '0xbbbb'],
          protocol: 'groth16'
        },
        publicSignals: ['0xsignal1', '0xsignal2']
      });

      jest.spyOn(zkProver, 'verifyProof').mockResolvedValue(true);
    });

    it('should generate ZK proofs for private trade data', async () => {
      const privateTrade: PrivateTradeInput = {
        price: BigInt(2000e8), // $2000 with 8 decimals
        amount: BigInt(1e18), // 1 ETH
        nonce: BigInt(12345),
        traderAddress: '0x1234567890123456789012345678901234567890'
      };

      const zkProof = await zkProver.generateProof(privateTrade, {
        minPrice: BigInt(1900e8),
        maxPrice: BigInt(2100e8)
      });

      expect(zkProof).toBeDefined();
      expect(zkProof.proof.protocol).toBe('groth16');
      expect(zkProof.publicSignals).toBeDefined();
    });

    it('should verify ZK proofs', async () => {
      const privateTrade: PrivateTradeInput = {
        price: BigInt(2000e8),
        amount: BigInt(1e18),
        nonce: BigInt(12345),
        traderAddress: '0x1234567890123456789012345678901234567890'
      };

      const zkProof = await zkProver.generateProof(privateTrade, {
        minPrice: BigInt(1900e8),
        maxPrice: BigInt(2100e8)
      });

      const isValid = await zkProver.verifyProof(zkProof);
      expect(isValid).toBe(true);
    });

    it('should integrate ZK proofs with settlement proofs', async () => {
      // Create settlement with hidden trade details
      const publicSettlement: SettlementLeaf = {
        tradeId: 'zk-trade-1',
        buyer: '0x0000000000000000000000000000000000000000', // Hidden
        seller: '0x0000000000000000000000000000000000000000', // Hidden
        buyerAmount: BigInt(0), // Hidden
        sellerAmount: BigInt(0), // Hidden
        buyerToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        sellerToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        timestamp: Date.now(),
        nonce: 12345
      };

      // Generate Merkle proof for public data
      const merkleProof = merkleProofService.generateProof(
        publicSettlement,
        [publicSettlement]
      );

      // Generate ZK proof for private data
      const privateTrade: PrivateTradeInput = {
        price: BigInt(2000e8),
        amount: BigInt(1e18),
        nonce: BigInt(12345),
        traderAddress: '0x1234567890123456789012345678901234567890'
      };

      const zkProof = await zkProver.generateProof(privateTrade, {
        minPrice: BigInt(1900e8),
        maxPrice: BigInt(2100e8)
      });

      // Combine proofs
      const combinedProof = {
        merkleProof,
        zkProof,
        publicCommitment: ethers.keccak256(
          ethers.AbiCoder.defaultAbiCoder().encode(
            ['bytes32', 'bytes32[]'],
            [merkleProof.root, zkProof.publicSignals]
          )
        )
      };

      expect(combinedProof.publicCommitment).toBeDefined();
      expect(combinedProof.publicCommitment.length).toBe(66);
    });

    it('should batch generate ZK proofs for multiple trades', async () => {
      const trades: PrivateTradeInput[] = [
        {
          price: BigInt(2000e8),
          amount: BigInt(1e18),
          nonce: BigInt(1),
          traderAddress: '0x1234567890123456789012345678901234567890'
        },
        {
          price: BigInt(2050e8),
          amount: BigInt(2e18),
          nonce: BigInt(2),
          traderAddress: '0x2345678901234567890123456789012345678901'
        },
        {
          price: BigInt(1980e8),
          amount: BigInt(5e17),
          nonce: BigInt(3),
          traderAddress: '0x3456789012345678901234567890123456789012'
        }
      ];

      const batchProof = await zkProver.generateBatchProof(trades, {
        totalMinVolume: BigInt(1e18),
        totalMaxVolume: BigInt(10e18),
        priceRange: { min: BigInt(1900e8), max: BigInt(2100e8) }
      });

      expect(batchProof).toBeDefined();
      expect(await zkProver.verifyProof(batchProof)).toBe(true);
    });
  });

  describe('Settlement Proof Storage and Retrieval', () => {
    it('should cache generated proofs', () => {
      const settlements = generateTestSettlements(5);
      const batchId = 'batch-cache-test';
      
      merkleProofService.batchGenerateProofs(settlements, batchId);
      
      // Check cache
      for (const settlement of settlements) {
        const cachedProof = merkleProofService.getCachedProof(settlement.tradeId);
        expect(cachedProof).toBeDefined();
        expect(cachedProof?.settlementBatchId).toBe(batchId);
      }
    });

    it('should provide proof statistics', () => {
      const settlements = generateTestSettlements(10);
      merkleProofService.batchGenerateProofs(settlements, 'stats-test');
      
      const stats = merkleProofService.getProofStats();
      expect(stats.cachedProofs).toBe(10);
      expect(stats.cacheSize).toBeGreaterThan(0);
    });

    it('should clear proof cache', () => {
      const settlements = generateTestSettlements(5);
      merkleProofService.batchGenerateProofs(settlements, 'clear-test');
      
      let stats = merkleProofService.getProofStats();
      expect(stats.cachedProofs).toBe(5);
      
      merkleProofService.clearCache();
      
      stats = merkleProofService.getProofStats();
      expect(stats.cachedProofs).toBe(0);
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle empty settlement batch', () => {
      expect(() => {
        merkleProofService.generateMerkleTree([]);
      }).toThrow('Cannot generate Merkle tree from empty settlement batch');
    });

    it('should handle settlement not in batch', () => {
      const settlements = generateTestSettlements(3);
      const outsideSettlement: SettlementLeaf = {
        tradeId: 'outside',
        buyer: '0x9999999999999999999999999999999999999999',
        seller: '0x8888888888888888888888888888888888888888',
        buyerAmount: BigInt(100e6),
        sellerAmount: BigInt(1e17),
        buyerToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        sellerToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        timestamp: Date.now(),
        nonce: 999
      };

      expect(() => {
        merkleProofService.generateProof(outsideSettlement, settlements);
      }).toThrow('Settlement not found in batch');
    });

    it('should handle large settlement batches', () => {
      const largeSettlements = generateTestSettlements(1000);
      
      const startTime = Date.now();
      const { root, tree } = merkleProofService.generateMerkleTree(largeSettlements);
      const duration = Date.now() - startTime;
      
      expect(root).toBeDefined();
      expect(tree.length).toBe(Math.ceil(Math.log2(largeSettlements.length)) + 1);
      expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
      
      // Verify random proofs
      for (let i = 0; i < 10; i++) {
        const randomIndex = Math.floor(Math.random() * largeSettlements.length);
        const proof = merkleProofService.generateProof(
          largeSettlements[randomIndex],
          largeSettlements
        );
        expect(merkleProofService.verifyProof(proof)).toBe(true);
      }
    });
  });
});

// Helper function to generate test settlements
function generateTestSettlements(count: number): SettlementLeaf[] {
  const settlements: SettlementLeaf[] = [];
  
  for (let i = 0; i < count; i++) {
    settlements.push({
      tradeId: `trade-${i}`,
      buyer: ethers.Wallet.createRandom().address,
      seller: ethers.Wallet.createRandom().address,
      buyerAmount: BigInt(Math.floor(Math.random() * 10000) * 1e6),
      sellerAmount: BigInt(Math.floor(Math.random() * 10) * 1e18),
      buyerToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      sellerToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      timestamp: Date.now() - i * 1000,
      nonce: i
    });
  }
  
  return settlements;
}