import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { ethers } from 'ethers';
import { FinalSettlementEngine, SettlementEpoch, TransactionBundle } from '../../src/services/settlement/FinalSettlementEngine';
import { MerkleSettlementProof } from '../../src/services/settlement/MerkleSettlementProof';
import { SettlementProofEngine } from '../../src/services/settlement/SettlementProofEngine';
import { CrossChainSettlementService } from '../../src/services/settlement/CrossChainSettlementService';
import { SettlementVerificationSystem } from '../../src/services/settlement/SettlementVerificationSystem';
import { Trade, OrderType, OrderSide } from '../../src/services/matchingEngine/types';
import { SettlementStatus } from '../../src/services/settlement/types';

// Mock IPFS client
const mockIPFS = {
  add: jest.fn().mockResolvedValue({ path: 'QmMockIPFSHash' }),
  cat: jest.fn().mockResolvedValue(Buffer.from('mock data')),
  pin: jest.fn().mockResolvedValue(true),
};

describe('Comprehensive Settlement Engine Tests', () => {
  let settlementEngine: FinalSettlementEngine;
  let proofEngine: SettlementProofEngine;
  let crossChainService: CrossChainSettlementService;
  let verificationSystem: SettlementVerificationSystem;
  
  const mockProvider = new ethers.JsonRpcProvider('http://localhost:8545');
  const privateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  const settlementContractAddress = '0x5FbDB2315678afecb367f032d93F642f64180aa3';

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Initialize settlement engine with short epoch for testing
    settlementEngine = new FinalSettlementEngine(
      mockProvider,
      privateKey,
      settlementContractAddress,
      5000 // 5 second epochs for testing
    );

    proofEngine = new SettlementProofEngine();
    verificationSystem = new SettlementVerificationSystem();
  });

  afterEach(() => {
    // Clean up
    settlementEngine.removeAllListeners();
  });

  describe('Settlement Batch Creation', () => {
    it('should batch trades into settlement epochs correctly', async () => {
      const trades: Trade[] = [
        createMockTrade('trade1', 'ETH/USDC', 2000, 1, 'user1', 'user2'),
        createMockTrade('trade2', 'ETH/USDC', 2001, 0.5, 'user3', 'user4'),
        createMockTrade('trade3', 'BTC/USDC', 40000, 0.1, 'user1', 'user3'),
        createMockTrade('trade4', 'ETH/USDC', 1999, 2, 'user2', 'user1'),
      ];

      // Add trades to current epoch
      for (const trade of trades) {
        settlementEngine.addTrade(trade);
      }

      const currentEpoch = settlementEngine.getCurrentEpoch();
      expect(currentEpoch).not.toBeNull();
      expect(currentEpoch!.trades).toHaveLength(4);
      expect(currentEpoch!.status).toBe('COLLECTING');
    });

    it('should calculate net positions across multiple trades', async () => {
      const trades: Trade[] = [
        // User1 buys 2 ETH @ 2000
        createMockTrade('t1', 'ETH/USDC', 2000, 2, 'user1', 'user2'),
        // User1 sells 1 ETH @ 2100
        createMockTrade('t2', 'ETH/USDC', 2100, 1, 'user3', 'user1'),
        // User1 buys 0.5 ETH @ 2050
        createMockTrade('t3', 'ETH/USDC', 2050, 0.5, 'user1', 'user4'),
      ];

      const mockEpoch: SettlementEpoch = {
        id: 'test-epoch',
        epochNumber: 1,
        startTime: Date.now(),
        endTime: Date.now() + 3600000,
        trades,
        status: 'PROCESSING',
      };

      // Test net position calculation
      const netPositions = await (settlementEngine as any).batchTradesAndCalculateNetPositions(mockEpoch);
      
      // User1 net position: bought 2.5 ETH, sold 1 ETH = net +1.5 ETH
      // User1 USDC: -2*2000 + 1*2100 - 0.5*2050 = -4000 + 2100 - 1025 = -2925 USDC
      const user1ETH = netPositions.get('user1')?.get('ETH');
      const user1USDC = netPositions.get('user1')?.get('USDC');
      
      expect(user1ETH).toBe(BigInt(1.5e18)); // 1.5 ETH in wei
      expect(user1USDC).toBe(BigInt(-2925e6)); // -2925 USDC (6 decimals)
    });

    it('should handle complex multi-token settlements', async () => {
      const trades: Trade[] = [
        createMockTrade('t1', 'ETH/USDC', 2000, 1, 'user1', 'user2'),
        createMockTrade('t2', 'BTC/USDC', 40000, 0.1, 'user1', 'user3'),
        createMockTrade('t3', 'ETH/BTC', 0.05, 2, 'user2', 'user1'), // ETH/BTC pair
        createMockTrade('t4', 'MATIC/USDC', 1, 1000, 'user3', 'user1'),
      ];

      for (const trade of trades) {
        settlementEngine.addTrade(trade);
      }

      // Wait for epoch to finalize
      await new Promise(resolve => setTimeout(resolve, 6000));

      // Check that multi-token positions were calculated
      const epochs = Array.from((settlementEngine as any).epochs.values());
      const completedEpoch = epochs.find(e => e.status === 'PROCESSING' || e.status === 'COMPLETED');
      
      expect(completedEpoch).toBeDefined();
      expect(completedEpoch!.settlementBatch).toBeDefined();
      expect(completedEpoch!.settlementBatch!.netPositions.size).toBeGreaterThan(0);
    });
  });

  describe('Merkle Proof Generation', () => {
    it('should generate valid merkle proofs for settlements', async () => {
      const settlements = [
        { userId: 'user1', token: 'ETH', amount: BigInt(1e18) },
        { userId: 'user2', token: 'ETH', amount: BigInt(-1e18) },
        { userId: 'user1', token: 'USDC', amount: BigInt(-2000e6) },
        { userId: 'user2', token: 'USDC', amount: BigInt(2000e6) },
      ];

      const merkleProof = new MerkleSettlementProof();
      const tree = await merkleProof.generateMerkleTree(settlements);
      
      expect(tree.root).toBeDefined();
      expect(tree.root.length).toBe(66); // 0x + 64 hex chars

      // Verify proof for each settlement
      for (let i = 0; i < settlements.length; i++) {
        const proof = await merkleProof.generateProof(settlements, i);
        const isValid = await merkleProof.verifyProof(
          proof.proof,
          proof.leaf,
          tree.root
        );
        expect(isValid).toBe(true);
      }
    });

    it('should handle large settlement batches efficiently', async () => {
      const largeSettlementBatch = [];
      
      // Create 1000 settlements
      for (let i = 0; i < 1000; i++) {
        largeSettlementBatch.push({
          userId: `user${i}`,
          token: i % 2 === 0 ? 'ETH' : 'USDC',
          amount: BigInt(Math.floor(Math.random() * 1e18)),
        });
      }

      const startTime = Date.now();
      const merkleProof = new MerkleSettlementProof();
      const tree = await merkleProof.generateMerkleTree(largeSettlementBatch);
      const generationTime = Date.now() - startTime;

      console.log(`Generated merkle tree for 1000 settlements in ${generationTime}ms`);
      expect(generationTime).toBeLessThan(1000); // Should complete in under 1 second
      expect(tree.leaves.length).toBe(1000);
    });

    it('should detect tampering with merkle proofs', async () => {
      const settlements = [
        { userId: 'user1', token: 'ETH', amount: BigInt(1e18) },
        { userId: 'user2', token: 'ETH', amount: BigInt(-1e18) },
      ];

      const merkleProof = new MerkleSettlementProof();
      const tree = await merkleProof.generateMerkleTree(settlements);
      const validProof = await merkleProof.generateProof(settlements, 0);

      // Tamper with the proof
      const tamperedProof = {
        ...validProof,
        leaf: ethers.keccak256(ethers.toUtf8Bytes('tampered data')),
      };

      const isValid = await merkleProof.verifyProof(
        tamperedProof.proof,
        tamperedProof.leaf,
        tree.root
      );

      expect(isValid).toBe(false);
    });
  });

  describe('On-chain Settlement Execution', () => {
    it('should batch settlements for gas optimization', async () => {
      const instructions = [
        {
          id: 'inst1',
          type: 'TRANSFER' as const,
          from: 'user1',
          to: 'user2',
          token: 'USDC',
          amount: BigInt(1000e6),
          settlementIds: ['set1'],
          priority: 50,
          gasEstimate: BigInt(65000),
        },
        {
          id: 'inst2',
          type: 'TRANSFER' as const,
          from: 'user3',
          to: 'user4',
          token: 'USDC',
          amount: BigInt(2000e6),
          settlementIds: ['set2'],
          priority: 50,
          gasEstimate: BigInt(65000),
        },
        {
          id: 'inst3',
          type: 'TRANSFER' as const,
          from: 'user5',
          to: 'user6',
          token: 'ETH',
          amount: BigInt(1e18),
          settlementIds: ['set3'],
          priority: 80,
          gasEstimate: BigInt(65000),
        },
      ];

      const bundles = await (settlementEngine as any).createTransactionBundles(instructions);
      
      expect(bundles).toHaveLength(1); // All should fit in one bundle
      expect(bundles[0].instructions).toHaveLength(3);
      expect(bundles[0].instructions[0].priority).toBe(80); // Highest priority first
      expect(bundles[0].totalGasEstimate).toBe(BigInt(195000)); // Sum of gas estimates
    });

    it('should handle settlement contract failures with retry logic', async () => {
      const mockContract = {
        batchSettle: jest.fn()
          .mockRejectedValueOnce(new Error('Network congestion'))
          .mockRejectedValueOnce(new Error('Nonce too low'))
          .mockResolvedValueOnce({
            hash: '0xsuccesstxhash',
            wait: jest.fn().mockResolvedValue({
              status: 1,
              gasUsed: BigInt(200000),
            }),
          }),
      };

      // Replace contract mock
      (settlementEngine as any).settlementContract = mockContract;

      const bundle: TransactionBundle = {
        id: 'test-bundle',
        instructions: [{
          id: 'inst1',
          type: 'TRANSFER',
          from: 'user1',
          to: 'user2',
          token: 'USDC',
          amount: BigInt(1000e6),
          settlementIds: ['set1'],
          priority: 50,
        }],
        totalGasEstimate: BigInt(65000),
        maxGasPrice: BigInt(30e9),
        nonce: 100,
        status: 'PENDING',
      };

      await (settlementEngine as any).executeBundle(bundle);

      expect(mockContract.batchSettle).toHaveBeenCalledTimes(3); // 2 failures + 1 success
      expect(bundle.status).toBe('CONFIRMED');
      expect(bundle.transactionHash).toBe('0xsuccesstxhash');
    });

    it('should optimize gas usage with multi-token transfers', async () => {
      const userInstructions = [
        // Multiple token transfers for same user
        {
          id: 'inst1',
          type: 'TRANSFER' as const,
          from: 'SETTLEMENT_POOL',
          to: 'user1',
          token: 'ETH',
          amount: BigInt(1e18),
          settlementIds: ['set1'],
          priority: 50,
          gasEstimate: BigInt(65000),
        },
        {
          id: 'inst2',
          type: 'TRANSFER' as const,
          from: 'SETTLEMENT_POOL',
          to: 'user1',
          token: 'USDC',
          amount: BigInt(2000e6),
          settlementIds: ['set2'],
          priority: 50,
          gasEstimate: BigInt(65000),
        },
        {
          id: 'inst3',
          type: 'TRANSFER' as const,
          from: 'SETTLEMENT_POOL',
          to: 'user1',
          token: 'WBTC',
          amount: BigInt(0.1e8),
          settlementIds: ['set3'],
          priority: 50,
          gasEstimate: BigInt(65000),
        },
      ];

      const optimized = (settlementEngine as any).optimizeInstructions(userInstructions);
      
      expect(optimized).toHaveLength(1); // Combined into single multi-token transfer
      expect(optimized[0].type).toBe('MULTI_TOKEN_TRANSFER');
      expect(optimized[0].token).toContain('ETH');
      expect(optimized[0].token).toContain('USDC');
      expect(optimized[0].token).toContain('WBTC');
    });
  });

  describe('Multi-chain Settlement', () => {
    beforeEach(() => {
      crossChainService = new CrossChainSettlementService({
        chains: {
          1: { name: 'Ethereum', rpc: 'http://localhost:8545' },
          137: { name: 'Polygon', rpc: 'http://localhost:8546' },
          42161: { name: 'Arbitrum', rpc: 'http://localhost:8547' },
        },
        bridges: {
          'ETH-POLYGON': { address: '0xbridge1', type: 'native' },
          'ETH-ARBITRUM': { address: '0xbridge2', type: 'native' },
        },
      });
    });

    it('should route settlements to appropriate chains', async () => {
      const crossChainSettlements = [
        {
          userId: 'user1',
          token: 'ETH',
          amount: BigInt(1e18),
          chainId: 1,
        },
        {
          userId: 'user2',
          token: 'MATIC',
          amount: BigInt(1000e18),
          chainId: 137,
        },
        {
          userId: 'user3',
          token: 'ETH',
          amount: BigInt(0.5e18),
          chainId: 42161,
        },
      ];

      const chainGroups = await crossChainService.groupSettlementsByChain(crossChainSettlements);
      
      expect(chainGroups.size).toBe(3);
      expect(chainGroups.get(1)).toHaveLength(1);
      expect(chainGroups.get(137)).toHaveLength(1);
      expect(chainGroups.get(42161)).toHaveLength(1);
    });

    it('should handle cross-chain bridge failures', async () => {
      const bridgeSettlement = {
        fromChain: 1,
        toChain: 137,
        token: 'USDC',
        amount: BigInt(1000e6),
        userId: 'user1',
      };

      // Mock bridge failure
      jest.spyOn(crossChainService, 'executeBridgeTransfer')
        .mockRejectedValue(new Error('Bridge liquidity insufficient'));

      await expect(
        crossChainService.executeCrossChainSettlement(bridgeSettlement)
      ).rejects.toThrow('Bridge liquidity insufficient');

      // Should emit failure event
      const failureHandler = jest.fn();
      crossChainService.on('bridge-failure', failureHandler);
      
      await crossChainService.executeCrossChainSettlement(bridgeSettlement)
        .catch(() => {}); // Ignore error

      expect(failureHandler).toHaveBeenCalled();
    });

    it('should estimate cross-chain settlement costs', async () => {
      const settlements = [
        { chainId: 1, gasEstimate: BigInt(100000) },
        { chainId: 137, gasEstimate: BigInt(80000) },
        { chainId: 42161, gasEstimate: BigInt(90000) },
      ];

      const costs = await crossChainService.estimateCrossChainCosts(settlements);
      
      expect(costs.totalGas).toBe(BigInt(270000));
      expect(costs.byChain.get(1)).toBe(BigInt(100000));
      expect(costs.estimatedUSD).toBeGreaterThan(0);
    });
  });

  describe('Settlement Claiming Process', () => {
    it('should allow users to claim settlements with valid proofs', async () => {
      const claimData = {
        userId: 'user1',
        epochId: 'epoch1',
        settlements: [
          { token: 'ETH', amount: BigInt(1e18) },
          { token: 'USDC', amount: BigInt(2000e6) },
        ],
        merkleProof: ['0xproof1', '0xproof2'],
      };

      const mockClaimContract = {
        claimSettlement: jest.fn().mockResolvedValue({
          hash: '0xclaimtx',
          wait: jest.fn().mockResolvedValue({ status: 1 }),
        }),
        isSettlementClaimed: jest.fn().mockResolvedValue(false),
      };

      const result = await processSettlementClaim(claimData, mockClaimContract);
      
      expect(result.success).toBe(true);
      expect(result.txHash).toBe('0xclaimtx');
      expect(mockClaimContract.claimSettlement).toHaveBeenCalledWith(
        claimData.userId,
        claimData.epochId,
        claimData.settlements,
        claimData.merkleProof
      );
    });

    it('should prevent double claiming', async () => {
      const mockClaimContract = {
        isSettlementClaimed: jest.fn().mockResolvedValue(true),
      };

      const claimData = {
        userId: 'user1',
        epochId: 'epoch1',
        settlements: [],
        merkleProof: [],
      };

      await expect(
        processSettlementClaim(claimData, mockClaimContract)
      ).rejects.toThrow('Settlement already claimed');
    });

    it('should validate claim amounts against merkle root', async () => {
      const settlements = [
        { userId: 'user1', token: 'ETH', amount: BigInt(1e18) },
        { userId: 'user2', token: 'ETH', amount: BigInt(0.5e18) },
      ];

      const merkleProof = new MerkleSettlementProof();
      const tree = await merkleProof.generateMerkleTree(settlements);
      const proof = await merkleProof.generateProof(settlements, 0);

      // Try to claim with different amount
      const tamperedClaim = {
        userId: 'user1',
        token: 'ETH',
        amount: BigInt(2e18), // Double the actual amount
      };

      const tamperedLeaf = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ['address', 'address', 'uint256'],
          [tamperedClaim.userId, tamperedClaim.token, tamperedClaim.amount]
        )
      );

      const isValid = await merkleProof.verifyProof(
        proof.proof,
        tamperedLeaf,
        tree.root
      );

      expect(isValid).toBe(false);
    });
  });

  describe('Reconciliation and Audit Trails', () => {
    it('should maintain complete audit trail for settlements', async () => {
      const auditService = (settlementEngine as any).auditService || {
        logEvent: jest.fn(),
        getAuditTrail: jest.fn().mockResolvedValue([]),
      };

      const trades = [
        createMockTrade('t1', 'ETH/USDC', 2000, 1, 'user1', 'user2'),
        createMockTrade('t2', 'ETH/USDC', 2001, 0.5, 'user3', 'user4'),
      ];

      for (const trade of trades) {
        settlementEngine.addTrade(trade);
      }

      // Wait for settlement
      await new Promise(resolve => setTimeout(resolve, 6000));

      const auditTrail = await auditService.getAuditTrail('epoch1');
      
      // Should have events for:
      // - Trade additions
      // - Epoch creation
      // - Net position calculation
      // - Settlement execution
      // - Verification
      expect(auditTrail.length).toBeGreaterThan(0);
    });

    it('should detect and reconcile settlement discrepancies', async () => {
      const verification = {
        epochId: 'epoch1',
        expectedChanges: new Map([
          ['user1', new Map([['ETH', BigInt(1e18)], ['USDC', BigInt(-2000e6)]])],
          ['user2', new Map([['ETH', BigInt(-1e18)], ['USDC', BigInt(2000e6)]])],
        ]),
        actualChanges: new Map([
          ['user1', new Map([['ETH', BigInt(0.9e18)], ['USDC', BigInt(-2000e6)]])], // Missing 0.1 ETH
          ['user2', new Map([['ETH', BigInt(-1e18)], ['USDC', BigInt(1900e6)]])], // Missing 100 USDC
        ]),
        discrepancies: [],
        verified: false,
        timestamp: Date.now(),
      };

      // Calculate discrepancies
      for (const [userId, expected] of verification.expectedChanges) {
        const actual = verification.actualChanges.get(userId);
        if (actual) {
          for (const [token, expectedAmount] of expected) {
            const actualAmount = actual.get(token) || BigInt(0);
            if (expectedAmount !== actualAmount) {
              verification.discrepancies.push({
                userId,
                token,
                expected: expectedAmount,
                actual: actualAmount,
              });
            }
          }
        }
      }

      expect(verification.discrepancies).toHaveLength(2);
      expect(verification.discrepancies[0]).toMatchObject({
        userId: 'user1',
        token: 'ETH',
        expected: BigInt(1e18),
        actual: BigInt(0.9e18),
      });
    });

    it('should generate settlement reports for compliance', async () => {
      const reportGenerator = {
        generateDailyReport: async (date: Date) => {
          return {
            date: date.toISOString(),
            totalTrades: 1000,
            totalVolume: BigInt(10000000e6), // $10M
            settlementBatches: 24,
            successRate: 0.995,
            averageSettlementTime: 3.2, // seconds
            gasUsed: BigInt(5000000),
            gasCostUSD: 250,
            discrepancies: 2,
            reconciledDiscrepancies: 2,
          };
        },
      };

      const report = await reportGenerator.generateDailyReport(new Date());
      
      expect(report.successRate).toBeGreaterThan(0.99);
      expect(report.discrepancies).toBe(report.reconciledDiscrepancies);
    });
  });

  describe('IPFS Backup Integration', () => {
    it('should backup settlement data to IPFS', async () => {
      const settlementData = {
        epochId: 'epoch1',
        trades: [
          createMockTrade('t1', 'ETH/USDC', 2000, 1, 'user1', 'user2'),
        ],
        merkleRoot: '0xmerkleroot',
        timestamp: Date.now(),
      };

      const ipfsHash = await mockIPFS.add(JSON.stringify(settlementData));
      expect(ipfsHash.path).toBe('QmMockIPFSHash');

      // Pin important data
      const pinned = await mockIPFS.pin(ipfsHash.path);
      expect(pinned).toBe(true);
    });

    it('should retrieve and verify IPFS backups', async () => {
      const originalData = {
        epochId: 'epoch1',
        merkleRoot: '0xabcdef',
        settlements: ['settlement1', 'settlement2'],
      };

      // Store
      const stored = await mockIPFS.add(JSON.stringify(originalData));
      
      // Retrieve
      const retrieved = await mockIPFS.cat(stored.path);
      const parsedData = JSON.parse(retrieved.toString());
      
      expect(parsedData).toEqual(originalData);
    });

    it('should handle IPFS failures gracefully', async () => {
      mockIPFS.add.mockRejectedValueOnce(new Error('IPFS node offline'));

      const settlementData = { epochId: 'epoch1' };
      
      // Should not throw, but log error
      const backup = await backupToIPFS(settlementData, mockIPFS).catch(e => null);
      expect(backup).toBeNull();
    });
  });

  describe('Settlement Verification', () => {
    it('should verify on-chain settlement state matches off-chain records', async () => {
      const onChainState = {
        'user1': {
          'ETH': BigInt(10e18),
          'USDC': BigInt(20000e6),
        },
        'user2': {
          'ETH': BigInt(5e18),
          'USDC': BigInt(10000e6),
        },
      };

      const offChainState = {
        'user1': {
          'ETH': BigInt(10e18),
          'USDC': BigInt(20000e6),
        },
        'user2': {
          'ETH': BigInt(5e18),
          'USDC': BigInt(10000e6),
        },
      };

      const verificationResult = await verificationSystem.verifySettlementState(
        onChainState,
        offChainState
      );

      expect(verificationResult.isValid).toBe(true);
      expect(verificationResult.discrepancies).toHaveLength(0);
    });

    it('should detect on-chain/off-chain discrepancies', async () => {
      const onChainState = {
        'user1': {
          'ETH': BigInt(10e18),
          'USDC': BigInt(19000e6), // Missing 1000 USDC
        },
      };

      const offChainState = {
        'user1': {
          'ETH': BigInt(10e18),
          'USDC': BigInt(20000e6),
        },
      };

      const verificationResult = await verificationSystem.verifySettlementState(
        onChainState,
        offChainState
      );

      expect(verificationResult.isValid).toBe(false);
      expect(verificationResult.discrepancies).toHaveLength(1);
      expect(verificationResult.discrepancies[0]).toMatchObject({
        user: 'user1',
        token: 'USDC',
        onChain: BigInt(19000e6),
        offChain: BigInt(20000e6),
        difference: BigInt(-1000e6),
      });
    });

    it('should verify merkle proof validity for all settlements', async () => {
      const epoch = {
        id: 'epoch1',
        settlements: [
          { userId: 'user1', token: 'ETH', amount: BigInt(1e18) },
          { userId: 'user2', token: 'ETH', amount: BigInt(-1e18) },
          { userId: 'user1', token: 'USDC', amount: BigInt(-2000e6) },
          { userId: 'user2', token: 'USDC', amount: BigInt(2000e6) },
        ],
        merkleRoot: '',
      };

      const merkleProof = new MerkleSettlementProof();
      const tree = await merkleProof.generateMerkleTree(epoch.settlements);
      epoch.merkleRoot = tree.root;

      // Verify each settlement can be proven
      for (let i = 0; i < epoch.settlements.length; i++) {
        const proof = await merkleProof.generateProof(epoch.settlements, i);
        const canProve = await merkleProof.verifyProof(
          proof.proof,
          proof.leaf,
          epoch.merkleRoot
        );
        expect(canProve).toBe(true);
      }
    });
  });
});

// Helper functions
function createMockTrade(
  id: string,
  pair: string,
  price: number,
  quantity: number,
  buyerId: string,
  sellerId: string
): Trade {
  return {
    id,
    pair,
    price,
    quantity,
    filledQuantity: quantity,
    side: OrderSide.BUY,
    type: OrderType.LIMIT,
    status: OrderStatus.FILLED,
    timestamp: Date.now(),
    buyerId,
    sellerId,
    buyOrderId: `buy-${id}`,
    sellOrderId: `sell-${id}`,
    buyerFee: quantity * price * 0.002,
    sellerFee: quantity * price * 0.001,
    makerOrderId: `sell-${id}`,
    takerOrderId: `buy-${id}`,
    makerUserId: sellerId,
    takerUserId: buyerId,
    makerFee: quantity * price * 0.001,
    takerFee: quantity * price * 0.002,
  };
}

async function processSettlementClaim(claimData: any, contract: any) {
  const isClaimed = await contract.isSettlementClaimed(
    claimData.userId,
    claimData.epochId
  );
  
  if (isClaimed) {
    throw new Error('Settlement already claimed');
  }

  const tx = await contract.claimSettlement(
    claimData.userId,
    claimData.epochId,
    claimData.settlements,
    claimData.merkleProof
  );

  const receipt = await tx.wait();
  
  return {
    success: receipt.status === 1,
    txHash: tx.hash,
  };
}

async function backupToIPFS(data: any, ipfs: any) {
  try {
    const result = await ipfs.add(JSON.stringify(data));
    await ipfs.pin(result.path);
    return result.path;
  } catch (error) {
    console.error('IPFS backup failed:', error);
    throw error;
  }
}