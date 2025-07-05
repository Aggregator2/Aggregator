import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { ethers } from 'ethers';
import { MerkleSettlementProof, SettlementLeaf } from '../../src/services/settlement/MerkleSettlementProof';
import { CrossChainSettlementService } from '../../src/services/settlement/CrossChainSettlementService';

// Mock cross-chain bridge interface
interface CrossChainBridge {
  sendProof(targetChain: number, proof: any): Promise<string>;
  verifyProof(sourceChain: number, proof: any): Promise<boolean>;
  getChainId(): number;
}

// Mock settlement aggregator for cross-chain proofs
class CrossChainSettlementAggregator {
  private chainProofs: Map<number, Map<string, any>> = new Map();
  private bridges: Map<number, CrossChainBridge> = new Map();
  
  constructor() {
    // Initialize chain maps
    [1, 137, 42161, 10, 56].forEach(chainId => {
      this.chainProofs.set(chainId, new Map());
    });
  }

  addBridge(chainId: number, bridge: CrossChainBridge) {
    this.bridges.set(chainId, bridge);
  }

  async aggregateSettlements(
    settlements: Array<SettlementLeaf & { chainId: number }>
  ): Promise<Map<number, { root: string; count: number; settlements: SettlementLeaf[] }>> {
    const chainSettlements = new Map<number, SettlementLeaf[]>();
    
    // Group settlements by chain
    for (const settlement of settlements) {
      const chainList = chainSettlements.get(settlement.chainId) || [];
      chainList.push(settlement);
      chainSettlements.set(settlement.chainId, chainList);
    }

    // Generate proofs per chain
    const chainRoots = new Map<number, { root: string; count: number; settlements: SettlementLeaf[] }>();
    const proofService = new MerkleSettlementProof();
    
    for (const [chainId, chainSettlementList] of chainSettlements) {
      const { root } = proofService.generateMerkleTree(chainSettlementList);
      chainRoots.set(chainId, {
        root,
        count: chainSettlementList.length,
        settlements: chainSettlementList
      });
    }

    return chainRoots;
  }

  async createCrossChainProof(
    sourceChain: number,
    targetChain: number,
    settlements: SettlementLeaf[]
  ): Promise<{
    sourceRoot: string;
    targetRoot: string;
    bridgeProof: string;
    metadata: any;
  }> {
    const proofService = new MerkleSettlementProof();
    const { root: sourceRoot } = proofService.generateMerkleTree(settlements);
    
    // Create bridge-specific proof
    const bridgeProof = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint256', 'uint256', 'bytes32', 'uint256'],
        [sourceChain, targetChain, sourceRoot, Date.now()]
      )
    );

    return {
      sourceRoot,
      targetRoot: sourceRoot, // In real implementation, this would be different
      bridgeProof,
      metadata: {
        sourceChain,
        targetChain,
        timestamp: Date.now(),
        settlementCount: settlements.length
      }
    };
  }
}

describe('Cross-Chain Settlement Proofs', () => {
  let aggregator: CrossChainSettlementAggregator;
  let merkleProofService: MerkleSettlementProof;
  let mockBridges: Map<number, CrossChainBridge>;

  beforeEach(() => {
    aggregator = new CrossChainSettlementAggregator();
    merkleProofService = new MerkleSettlementProof();
    mockBridges = new Map();

    // Setup mock bridges for each chain
    const chains = [
      { id: 1, name: 'Ethereum' },
      { id: 137, name: 'Polygon' },
      { id: 42161, name: 'Arbitrum' },
      { id: 10, name: 'Optimism' },
      { id: 56, name: 'BSC' }
    ];

    chains.forEach(chain => {
      const mockBridge: CrossChainBridge = {
        sendProof: jest.fn().mockResolvedValue(`0x${chain.id}txhash`),
        verifyProof: jest.fn().mockResolvedValue(true),
        getChainId: () => chain.id
      };
      mockBridges.set(chain.id, mockBridge);
      aggregator.addBridge(chain.id, mockBridge);
    });
  });

  describe('Multi-Chain Settlement Aggregation', () => {
    it('should aggregate settlements by chain', async () => {
      const multiChainSettlements = [
        // Ethereum settlements
        createSettlement('eth-1', 1),
        createSettlement('eth-2', 1),
        createSettlement('eth-3', 1),
        // Polygon settlements
        createSettlement('poly-1', 137),
        createSettlement('poly-2', 137),
        // Arbitrum settlements
        createSettlement('arb-1', 42161),
        createSettlement('arb-2', 42161),
        createSettlement('arb-3', 42161),
        createSettlement('arb-4', 42161),
        // Optimism settlement
        createSettlement('op-1', 10),
        // BSC settlements
        createSettlement('bsc-1', 56),
        createSettlement('bsc-2', 56)
      ];

      const chainRoots = await aggregator.aggregateSettlements(multiChainSettlements);

      expect(chainRoots.size).toBe(5);
      expect(chainRoots.get(1)?.count).toBe(3);
      expect(chainRoots.get(137)?.count).toBe(2);
      expect(chainRoots.get(42161)?.count).toBe(4);
      expect(chainRoots.get(10)?.count).toBe(1);
      expect(chainRoots.get(56)?.count).toBe(2);

      // Verify each chain has a valid root
      for (const [chainId, data] of chainRoots) {
        expect(data.root).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(data.settlements.length).toBe(data.count);
      }
    });

    it('should generate consistent roots for same chain settlements', async () => {
      const settlements = [
        createSettlement('test-1', 1),
        createSettlement('test-2', 1),
        createSettlement('test-3', 1)
      ];

      const roots1 = await aggregator.aggregateSettlements(settlements);
      const roots2 = await aggregator.aggregateSettlements(settlements);

      expect(roots1.get(1)?.root).toBe(roots2.get(1)?.root);
    });
  });

  describe('Cross-Chain Bridge Proofs', () => {
    it('should create bridge proof between chains', async () => {
      const sourceChain = 1; // Ethereum
      const targetChain = 137; // Polygon
      
      const settlements = [
        createSettlement('bridge-1', sourceChain),
        createSettlement('bridge-2', sourceChain),
        createSettlement('bridge-3', sourceChain)
      ];

      const crossChainProof = await aggregator.createCrossChainProof(
        sourceChain,
        targetChain,
        settlements.map(s => {
          const { chainId, ...settlement } = s;
          return settlement;
        })
      );

      expect(crossChainProof.sourceRoot).toBeDefined();
      expect(crossChainProof.bridgeProof).toBeDefined();
      expect(crossChainProof.metadata.sourceChain).toBe(sourceChain);
      expect(crossChainProof.metadata.targetChain).toBe(targetChain);
      expect(crossChainProof.metadata.settlementCount).toBe(3);
    });

    it('should verify cross-chain proofs', async () => {
      const settlements = [
        createSettlement('verify-1', 1),
        createSettlement('verify-2', 1)
      ];

      const crossChainProof = await aggregator.createCrossChainProof(
        1, // Ethereum
        137, // Polygon
        settlements.map(s => {
          const { chainId, ...settlement } = s;
          return settlement;
        })
      );

      // Verify on target chain
      const targetBridge = mockBridges.get(137)!;
      const isValid = await targetBridge.verifyProof(1, crossChainProof);
      
      expect(isValid).toBe(true);
      expect(targetBridge.verifyProof).toHaveBeenCalledWith(1, crossChainProof);
    });
  });

  describe('Chain-Specific Settlement Formats', () => {
    it('should handle Ethereum-style settlements', () => {
      const ethSettlement: SettlementLeaf = {
        tradeId: 'eth-trade-1',
        buyer: '0x742d35Cc6634C0532925a3b844Bc9e7595f6AEDC',
        seller: '0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199',
        buyerAmount: ethers.parseUnits('1000', 6), // USDC
        sellerAmount: ethers.parseEther('0.5'), // ETH
        buyerToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        sellerToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        timestamp: Date.now(),
        nonce: 1
      };

      const leafHash = merkleProofService.generateLeafHash(ethSettlement);
      expect(leafHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
    });

    it('should handle Polygon-style settlements with different decimals', () => {
      const polygonSettlement: SettlementLeaf = {
        tradeId: 'poly-trade-1',
        buyer: '0x742d35Cc6634C0532925a3b844Bc9e7595f6AEDC',
        seller: '0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199',
        buyerAmount: ethers.parseUnits('1000', 6), // USDC (6 decimals)
        sellerAmount: ethers.parseUnits('1200', 18), // MATIC (18 decimals)
        buyerToken: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', // Polygon USDC
        sellerToken: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', // WMATIC
        timestamp: Date.now(),
        nonce: 1
      };

      const leafHash = merkleProofService.generateLeafHash(polygonSettlement);
      expect(leafHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
    });

    it('should handle BSC settlements with BEP-20 tokens', () => {
      const bscSettlement: SettlementLeaf = {
        tradeId: 'bsc-trade-1',
        buyer: '0x742d35Cc6634C0532925a3b844Bc9e7595f6AEDC',
        seller: '0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199',
        buyerAmount: ethers.parseUnits('100', 18), // BUSD
        sellerAmount: ethers.parseUnits('0.3', 18), // BNB
        buyerToken: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56', // BUSD
        sellerToken: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // WBNB
        timestamp: Date.now(),
        nonce: 1
      };

      const leafHash = merkleProofService.generateLeafHash(bscSettlement);
      expect(leafHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
    });
  });

  describe('Cross-Chain Proof Relaying', () => {
    it('should relay proofs between L1 and L2', async () => {
      // L1 (Ethereum) to L2 (Arbitrum)
      const l1Settlements = [
        createSettlement('l1-1', 1),
        createSettlement('l1-2', 1)
      ];

      const l1Roots = await aggregator.aggregateSettlements(l1Settlements);
      const l1Root = l1Roots.get(1)?.root!;

      // Create relay proof
      const relayProof = {
        l1Root,
        l1BlockNumber: 17500000,
        l1BlockHash: '0x' + 'a'.repeat(64),
        timestamp: Date.now()
      };

      // Mock L2 bridge receiving the proof
      const l2Bridge = mockBridges.get(42161)!;
      const txHash = await l2Bridge.sendProof(1, relayProof);
      
      expect(txHash).toBe('0x42161txhash');
      expect(l2Bridge.sendProof).toHaveBeenCalledWith(1, relayProof);
    });

    it('should handle optimistic rollup challenge period', async () => {
      const optimismSettlements = [
        createSettlement('op-1', 10),
        createSettlement('op-2', 10)
      ];

      const proof = await aggregator.createCrossChainProof(
        10, // Optimism
        1,  // Ethereum
        optimismSettlements.map(s => {
          const { chainId, ...settlement } = s;
          return settlement;
        })
      );

      // Add challenge period metadata
      const challengeProof = {
        ...proof,
        challengePeriod: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
        submittedAt: Date.now(),
        canFinalize: Date.now() + 7 * 24 * 60 * 60 * 1000
      };

      expect(challengeProof.challengePeriod).toBe(604800000);
      expect(challengeProof.canFinalize).toBeGreaterThan(Date.now());
    });
  });

  describe('Multi-Hop Cross-Chain Settlements', () => {
    it('should handle settlements across multiple hops', async () => {
      // Ethereum -> Polygon -> BSC
      const hop1Proof = await aggregator.createCrossChainProof(
        1,   // Ethereum
        137, // Polygon
        [createSettlement('hop1-1', 1)].map(s => {
          const { chainId, ...settlement } = s;
          return settlement;
        })
      );

      const hop2Proof = await aggregator.createCrossChainProof(
        137, // Polygon
        56,  // BSC
        [createSettlement('hop2-1', 137)].map(s => {
          const { chainId, ...settlement } = s;
          return settlement;
        })
      );

      // Create multi-hop proof
      const multiHopProof = {
        hops: [hop1Proof, hop2Proof],
        sourceChain: 1,
        destinationChain: 56,
        totalHops: 2,
        proofChain: ethers.keccak256(
          ethers.AbiCoder.defaultAbiCoder().encode(
            ['bytes32', 'bytes32'],
            [hop1Proof.bridgeProof, hop2Proof.bridgeProof]
          )
        )
      };

      expect(multiHopProof.hops.length).toBe(2);
      expect(multiHopProof.sourceChain).toBe(1);
      expect(multiHopProof.destinationChain).toBe(56);
      expect(multiHopProof.proofChain).toMatch(/^0x[a-fA-F0-9]{64}$/);
    });
  });

  describe('Cross-Chain Proof Verification Edge Cases', () => {
    it('should handle chain reorganizations', async () => {
      const settlements = [createSettlement('reorg-1', 1)];
      const proof1 = await aggregator.createCrossChainProof(
        1,
        137,
        settlements.map(s => {
          const { chainId, ...settlement } = s;
          return settlement;
        })
      );

      // Simulate reorg by creating new proof with same settlements
      const proof2 = await aggregator.createCrossChainProof(
        1,
        137,
        settlements.map(s => {
          const { chainId, ...settlement } = s;
          return settlement;
        })
      );

      // Proofs should be different due to timestamp
      expect(proof1.bridgeProof).not.toBe(proof2.bridgeProof);
      expect(proof1.metadata.timestamp).toBeLessThan(proof2.metadata.timestamp);
    });

    it('should handle missing chain support', async () => {
      const unsupportedChainId = 9999;
      const settlements = [{
        ...createSettlement('unsupported-1', unsupportedChainId),
        chainId: unsupportedChainId
      }];

      const chainRoots = await aggregator.aggregateSettlements(settlements);
      
      // Should still generate root for unsupported chain
      expect(chainRoots.has(unsupportedChainId)).toBe(true);
      expect(chainRoots.get(unsupportedChainId)?.count).toBe(1);
    });

    it('should handle empty settlement batches per chain', async () => {
      const chainRoots = await aggregator.aggregateSettlements([]);
      expect(chainRoots.size).toBe(0);
    });
  });

  describe('Gas Optimization for Cross-Chain Proofs', () => {
    it('should batch settlements efficiently for gas optimization', async () => {
      // Create 1000 settlements across 5 chains
      const largeSettlements = [];
      const chains = [1, 137, 42161, 10, 56];
      
      for (let i = 0; i < 1000; i++) {
        const chainId = chains[i % chains.length];
        largeSettlements.push(createSettlement(`large-${i}`, chainId));
      }

      const startTime = Date.now();
      const chainRoots = await aggregator.aggregateSettlements(largeSettlements);
      const duration = Date.now() - startTime;

      expect(chainRoots.size).toBe(5);
      
      // Each chain should have 200 settlements
      for (const [chainId, data] of chainRoots) {
        expect(data.count).toBe(200);
      }

      // Should complete within reasonable time
      expect(duration).toBeLessThan(1000); // 1 second
    });

    it('should compress proof data for cross-chain transmission', () => {
      const settlements = Array(100).fill(null).map((_, i) => 
        createSettlement(`compress-${i}`, 1)
      );

      const proofService = new MerkleSettlementProof();
      const { root, tree } = proofService.generateMerkleTree(
        settlements.map(s => {
          const { chainId, ...settlement } = s;
          return settlement;
        })
      );

      // Original size
      const originalSize = JSON.stringify({ root, tree }).length;

      // Compressed format (just root + count)
      const compressed = {
        root,
        count: settlements.length,
        height: tree.length
      };
      const compressedSize = JSON.stringify(compressed).length;

      expect(compressedSize).toBeLessThan(originalSize / 10);
    });
  });
});

// Helper function to create test settlement
function createSettlement(
  tradeId: string, 
  chainId: number
): SettlementLeaf & { chainId: number } {
  const chainTokens = {
    1: { // Ethereum
      usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
    },
    137: { // Polygon
      usdc: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
      wmatic: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270'
    },
    42161: { // Arbitrum
      usdc: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
      weth: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1'
    },
    10: { // Optimism
      usdc: '0x7F5c764cBc14f9669B88837ca1490cCa17c31607',
      weth: '0x4200000000000000000000000000000000000006'
    },
    56: { // BSC
      busd: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
      wbnb: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'
    }
  };

  const tokens = chainTokens[chainId] || chainTokens[1];

  return {
    tradeId,
    buyer: ethers.Wallet.createRandom().address,
    seller: ethers.Wallet.createRandom().address,
    buyerAmount: ethers.parseUnits((100 + Math.random() * 900).toFixed(2), 6),
    sellerAmount: ethers.parseUnits((0.1 + Math.random() * 0.9).toFixed(4), 18),
    buyerToken: tokens.usdc || tokens.busd,
    sellerToken: tokens.weth || tokens.wmatic || tokens.wbnb,
    timestamp: Date.now(),
    nonce: Math.floor(Math.random() * 1000000),
    chainId
  };
}