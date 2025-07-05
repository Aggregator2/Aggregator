import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { ethers } from 'ethers';
import { MerkleSettlementProof, SettlementLeaf, SettlementProof } from '../../src/services/settlement/MerkleSettlementProof';
import { SettlementProofEngine } from '../../src/services/settlement/SettlementProofEngine';
import { FinalSettlementEngine } from '../../src/services/settlement/FinalSettlementEngine';
import { ZKTradeProver, PrivateTradeInput } from '../../src/utils/zkProofs';
import { Trade } from '../../src/services/matchingEngine/types';

// Complete proof workflow orchestrator
class SettlementProofOrchestrator {
  private merkleProofService: MerkleSettlementProof;
  private proofEngine: SettlementProofEngine;
  private settlementEngine: FinalSettlementEngine;
  private zkProver: ZKTradeProver;
  private provider: ethers.Provider;
  private settlementContract: ethers.Contract;

  constructor(
    provider: ethers.Provider,
    settlementContractAddress: string,
    privateKey: string
  ) {
    this.provider = provider;
    this.merkleProofService = new MerkleSettlementProof();
    this.proofEngine = new SettlementProofEngine(provider, privateKey);
    this.settlementEngine = new FinalSettlementEngine(
      provider,
      privateKey,
      settlementContractAddress
    );
    this.zkProver = new ZKTradeProver({
      wasm: '/circuits/trade.wasm',
      zkey: '/circuits/trade.zkey',
      vkey: '/circuits/trade.vkey'
    });

    // Initialize settlement contract
    const abi = [
      'function createSettlementBatch(string epochId, bytes32 merkleRoot, uint256 totalSettlements, string ipfsHash)',
      'function finalizeSettlementBatch(string epochId)',
      'function verifyProof(string epochId, address user, address token, uint256 amount, bytes32[] merkleProof) view returns (bool)',
      'function claimSettlement(string epochId, address user, address token, uint256 amount, bytes32[] merkleProof)',
      'function depositTokens(address token, uint256 amount)',
      'event SettlementBatchCreated(string indexed epochId, bytes32 merkleRoot, uint256 totalSettlements, uint256 timestamp)',
      'event SettlementClaimed(string indexed epochId, address indexed user, address indexed token, uint256 amount)'
    ];

    const signer = new ethers.Wallet(privateKey, provider);
    this.settlementContract = new ethers.Contract(settlementContractAddress, abi, signer);
  }

  async executeCompleteWorkflow(trades: Trade[]): Promise<{
    epochId: string;
    merkleRoot: string;
    proofs: Map<string, SettlementProof>;
    transactionHash: string;
    claimable: boolean;
  }> {
    // Step 1: Process trades in settlement engine
    trades.forEach(trade => this.settlementEngine.addTrade(trade));

    // Step 2: Finalize epoch and generate settlements
    const epoch = await this.settlementEngine.forceFinalize();
    if (!epoch) throw new Error('Failed to finalize epoch');

    // Step 3: Generate Merkle proofs for all settlements
    const settlements = this.convertTradesToSettlements(trades);
    const proofs = this.merkleProofService.batchGenerateProofs(
      settlements,
      epoch.id,
      undefined,
      undefined
    );

    // Step 4: Get Merkle root
    const { root } = this.merkleProofService.generateMerkleTree(settlements);

    // Step 5: Submit to blockchain
    const tx = await this.settlementContract.createSettlementBatch(
      epoch.id,
      root,
      settlements.length,
      '' // IPFS hash could be added here
    );

    const receipt = await tx.wait();

    // Step 6: Finalize on-chain
    await this.settlementContract.finalizeSettlementBatch(epoch.id);

    return {
      epochId: epoch.id,
      merkleRoot: root,
      proofs,
      transactionHash: receipt.hash,
      claimable: true
    };
  }

  private convertTradesToSettlements(trades: Trade[]): SettlementLeaf[] {
    return trades.map((trade, index) => ({
      tradeId: trade.id,
      buyer: trade.buyerId,
      seller: trade.sellerId,
      buyerAmount: BigInt(trade.filledQuantity * trade.price * 1e6), // USDC decimals
      sellerAmount: BigInt(trade.filledQuantity * 1e18), // ETH decimals
      buyerToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
      sellerToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
      timestamp: trade.timestamp,
      nonce: index
    }));
  }

  async claimSettlement(
    epochId: string,
    proof: SettlementProof,
    user: string
  ): Promise<string> {
    const tx = await this.settlementContract.claimSettlement(
      epochId,
      user,
      proof.leaf.buyerToken,
      proof.leaf.buyerAmount,
      proof.merkleProof.proof
    );

    const receipt = await tx.wait();
    return receipt.hash;
  }
}

describe('Complete Settlement Proof Workflow Integration', () => {
  let orchestrator: SettlementProofOrchestrator;
  let provider: ethers.Provider;
  let settlementContractAddress: string;
  let mockToken: ethers.Contract;
  
  // Test accounts
  let deployer: ethers.Signer;
  let trader1: ethers.Signer;
  let trader2: ethers.Signer;
  let trader3: ethers.Signer;

  beforeEach(async () => {
    // Setup test environment
    provider = new ethers.JsonRpcProvider('http://localhost:8545');
    
    // Get signers
    [deployer, trader1, trader2, trader3] = await ethers.getSigners();
    
    // Deploy mock token
    const MockToken = await ethers.getContractFactory('MockERC20');
    mockToken = await MockToken.deploy('USDC', 'USDC', 6);
    await mockToken.deployed();

    // Deploy settlement contract
    const SettlementContract = await ethers.getContractFactory('SettlementWithProofs');
    const settlementContract = await SettlementContract.deploy();
    await settlementContract.deployed();
    settlementContractAddress = settlementContract.address;

    // Initialize orchestrator
    const deployerKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
    orchestrator = new SettlementProofOrchestrator(
      provider,
      settlementContractAddress,
      deployerKey
    );

    // Authorize settlement engine
    await settlementContract.authorizeEngine(await deployer.getAddress(), true);

    // Fund settlement contract
    await mockToken.mint(settlementContractAddress, ethers.parseUnits('1000000', 6));
    await settlementContract.depositTokens(
      mockToken.address,
      ethers.parseUnits('1000000', 6)
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('End-to-End Proof Generation and Verification', () => {
    it('should complete full workflow from trades to claimable proofs', async () => {
      // Create test trades
      const trades: Trade[] = [
        {
          id: 'trade-001',
          pair: 'ETH/USDC',
          price: 2000,
          quantity: 1,
          filledQuantity: 1,
          buyerId: await trader1.getAddress(),
          sellerId: await trader2.getAddress(),
          buyOrderId: 'buy-001',
          sellOrderId: 'sell-001',
          timestamp: Date.now(),
          fee: 0.001
        },
        {
          id: 'trade-002',
          pair: 'ETH/USDC',
          price: 2010,
          quantity: 0.5,
          filledQuantity: 0.5,
          buyerId: await trader3.getAddress(),
          sellerId: await trader1.getAddress(),
          buyOrderId: 'buy-002',
          sellOrderId: 'sell-002',
          timestamp: Date.now() + 1000,
          fee: 0.001
        }
      ];

      // Execute complete workflow
      const result = await orchestrator.executeCompleteWorkflow(trades);

      expect(result.epochId).toBeDefined();
      expect(result.merkleRoot).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(result.proofs.size).toBe(trades.length);
      expect(result.transactionHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(result.claimable).toBe(true);

      // Verify on-chain batch creation
      const batch = await orchestrator['settlementContract'].getSettlementBatch(result.epochId);
      expect(batch.merkleRoot).toBe(result.merkleRoot);
      expect(batch.finalized).toBe(true);
    });

    it('should verify and claim individual settlements', async () => {
      const trades: Trade[] = [
        {
          id: 'claim-trade-001',
          pair: 'ETH/USDC',
          price: 2000,
          quantity: 1,
          filledQuantity: 1,
          buyerId: await trader1.getAddress(),
          sellerId: await trader2.getAddress(),
          buyOrderId: 'buy-003',
          sellOrderId: 'sell-003',
          timestamp: Date.now(),
          fee: 0.001
        }
      ];

      const result = await orchestrator.executeCompleteWorkflow(trades);
      
      // Get proof for trader1 (buyer)
      const proof = result.proofs.get('claim-trade-001');
      expect(proof).toBeDefined();

      // Verify proof on-chain
      const isValid = await orchestrator['settlementContract'].verifyProof(
        result.epochId,
        await trader1.getAddress(),
        proof!.leaf.buyerToken,
        proof!.leaf.buyerAmount,
        proof!.merkleProof.proof
      );
      expect(isValid).toBe(true);

      // Claim settlement
      const claimTx = await orchestrator.claimSettlement(
        result.epochId,
        proof!,
        await trader1.getAddress()
      );
      expect(claimTx).toMatch(/^0x[a-fA-F0-9]{64}$/);

      // Verify claim status
      const hasClaimed = await orchestrator['settlementContract'].hasClaimed(
        result.epochId,
        await trader1.getAddress()
      );
      expect(hasClaimed).toBe(true);
    });
  });

  describe('Privacy-Enhanced Workflow with ZK Proofs', () => {
    it('should integrate ZK proofs into settlement workflow', async () => {
      // Mock ZK prover
      jest.spyOn(orchestrator['zkProver'], 'generateProof').mockResolvedValue({
        proof: {
          pi_a: ['0x1', '0x2'],
          pi_b: [['0x3', '0x4'], ['0x5', '0x6']],
          pi_c: ['0x7', '0x8'],
          protocol: 'groth16'
        },
        publicSignals: ['0x' + '1'.repeat(64)]
      });

      // Create trades with privacy requirements
      const privateTrades: Array<Trade & { isPrivate: boolean }> = [
        {
          id: 'private-trade-001',
          pair: 'ETH/USDC',
          price: 2000,
          quantity: 10,
          filledQuantity: 10,
          buyerId: '0x0000000000000000000000000000000000000000', // Hidden
          sellerId: '0x0000000000000000000000000000000000000000', // Hidden
          buyOrderId: 'private-buy-001',
          sellOrderId: 'private-sell-001',
          timestamp: Date.now(),
          fee: 0.001,
          isPrivate: true
        }
      ];

      // Generate ZK commitments
      const privateTradeData: PrivateTradeInput = {
        price: ethers.parseUnits('2000', 8),
        amount: ethers.parseEther('10'),
        nonce: 12345n,
        traderAddress: await trader1.getAddress()
      };

      const zkProof = await orchestrator['zkProver'].generateProof(privateTradeData, {
        minPrice: ethers.parseUnits('1900', 8),
        maxPrice: ethers.parseUnits('2100', 8)
      });

      expect(zkProof).toBeDefined();
      expect(zkProof.proof.protocol).toBe('groth16');
    });
  });

  describe('Multi-Chain Settlement Proof Workflow', () => {
    it('should handle cross-chain settlement proofs', async () => {
      // Simulate multi-chain trades
      const multiChainTrades = [
        // Ethereum trades
        {
          id: 'eth-trade-001',
          pair: 'ETH/USDC',
          price: 2000,
          quantity: 1,
          filledQuantity: 1,
          buyerId: await trader1.getAddress(),
          sellerId: await trader2.getAddress(),
          buyOrderId: 'eth-buy-001',
          sellOrderId: 'eth-sell-001',
          timestamp: Date.now(),
          fee: 0.001,
          chainId: 1
        },
        // Polygon trades
        {
          id: 'poly-trade-001',
          pair: 'MATIC/USDC',
          price: 0.8,
          quantity: 1000,
          filledQuantity: 1000,
          buyerId: await trader2.getAddress(),
          sellerId: await trader3.getAddress(),
          buyOrderId: 'poly-buy-001',
          sellOrderId: 'poly-sell-001',
          timestamp: Date.now(),
          fee: 0.001,
          chainId: 137
        }
      ];

      // Group by chain
      const chainGroups = multiChainTrades.reduce((groups, trade) => {
        const chainId = trade.chainId || 1;
        if (!groups[chainId]) groups[chainId] = [];
        groups[chainId].push(trade);
        return groups;
      }, {} as Record<number, Trade[]>);

      // Process each chain
      const chainResults = new Map<number, any>();
      
      for (const [chainId, trades] of Object.entries(chainGroups)) {
        const result = await orchestrator.executeCompleteWorkflow(trades);
        chainResults.set(Number(chainId), result);
      }

      expect(chainResults.size).toBe(2);
      expect(chainResults.get(1)).toBeDefined();
      expect(chainResults.get(137)).toBeDefined();
    });
  });

  describe('Error Recovery and Edge Cases', () => {
    it('should handle proof generation failures gracefully', async () => {
      const invalidTrades: Trade[] = [
        {
          id: '',  // Invalid: empty ID
          pair: 'ETH/USDC',
          price: 2000,
          quantity: 1,
          filledQuantity: 1,
          buyerId: await trader1.getAddress(),
          sellerId: await trader2.getAddress(),
          buyOrderId: 'buy-invalid',
          sellOrderId: 'sell-invalid',
          timestamp: Date.now(),
          fee: 0.001
        }
      ];

      // Should handle gracefully
      const result = await orchestrator.executeCompleteWorkflow(invalidTrades);
      expect(result.proofs.size).toBe(1);
    });

    it('should handle claim failures and retry logic', async () => {
      const trades: Trade[] = [
        {
          id: 'retry-trade-001',
          pair: 'ETH/USDC',
          price: 2000,
          quantity: 1,
          filledQuantity: 1,
          buyerId: await trader1.getAddress(),
          sellerId: await trader2.getAddress(),
          buyOrderId: 'retry-buy-001',
          sellOrderId: 'retry-sell-001',
          timestamp: Date.now(),
          fee: 0.001
        }
      ];

      const result = await orchestrator.executeCompleteWorkflow(trades);
      const proof = result.proofs.get('retry-trade-001')!;

      // First claim succeeds
      await orchestrator.claimSettlement(
        result.epochId,
        proof,
        await trader1.getAddress()
      );

      // Second claim should fail (already claimed)
      await expect(
        orchestrator.claimSettlement(
          result.epochId,
          proof,
          await trader1.getAddress()
        )
      ).rejects.toThrow();
    });

    it('should handle large batch settlements efficiently', async () => {
      // Generate 100 trades
      const largeBatch: Trade[] = [];
      for (let i = 0; i < 100; i++) {
        largeBatch.push({
          id: `large-trade-${i}`,
          pair: 'ETH/USDC',
          price: 2000 + (i % 10),
          quantity: 0.1 * (i % 5 + 1),
          filledQuantity: 0.1 * (i % 5 + 1),
          buyerId: i % 2 === 0 ? await trader1.getAddress() : await trader2.getAddress(),
          sellerId: i % 2 === 0 ? await trader3.getAddress() : await trader1.getAddress(),
          buyOrderId: `large-buy-${i}`,
          sellOrderId: `large-sell-${i}`,
          timestamp: Date.now() + i * 100,
          fee: 0.001
        });
      }

      const startTime = Date.now();
      const result = await orchestrator.executeCompleteWorkflow(largeBatch);
      const duration = Date.now() - startTime;

      expect(result.proofs.size).toBe(100);
      expect(duration).toBeLessThan(10000); // Should complete within 10 seconds
      
      // Verify a random proof
      const randomIndex = Math.floor(Math.random() * 100);
      const randomProof = result.proofs.get(`large-trade-${randomIndex}`);
      expect(randomProof).toBeDefined();
      
      const merkleProofService = new MerkleSettlementProof();
      const isValid = merkleProofService.verifyProof(randomProof!.merkleProof);
      expect(isValid).toBe(true);
    });
  });

  describe('Monitoring and Analytics', () => {
    it('should emit proper events for monitoring', async () => {
      const trades: Trade[] = [
        {
          id: 'event-trade-001',
          pair: 'ETH/USDC',
          price: 2000,
          quantity: 1,
          filledQuantity: 1,
          buyerId: await trader1.getAddress(),
          sellerId: await trader2.getAddress(),
          buyOrderId: 'event-buy-001',
          sellOrderId: 'event-sell-001',
          timestamp: Date.now(),
          fee: 0.001
        }
      ];

      // Set up event listeners
      const events: any[] = [];
      
      orchestrator['settlementContract'].on('SettlementBatchCreated', 
        (epochId: string, merkleRoot: string, totalSettlements: bigint, timestamp: bigint) => {
          events.push({
            type: 'SettlementBatchCreated',
            epochId,
            merkleRoot,
            totalSettlements: totalSettlements.toString(),
            timestamp: timestamp.toString()
          });
        }
      );

      // Execute workflow
      const result = await orchestrator.executeCompleteWorkflow(trades);

      // Wait for events
      await new Promise(resolve => setTimeout(resolve, 1000));

      expect(events.length).toBeGreaterThan(0);
      expect(events[0].type).toBe('SettlementBatchCreated');
      expect(events[0].epochId).toBe(result.epochId);
      expect(events[0].merkleRoot).toBe(result.merkleRoot);
    });

    it('should track proof generation metrics', () => {
      const metrics = {
        proofsGenerated: 0,
        proofsVerified: 0,
        proofGenerationTime: [] as number[],
        averageProofSize: 0,
        totalDataProcessed: 0
      };

      // Track proof generation
      const merkleProofService = new MerkleSettlementProof();
      merkleProofService.on('proofGenerated', (data) => {
        metrics.proofsGenerated++;
      });

      merkleProofService.on('merkleTreeGenerated', (data) => {
        metrics.totalDataProcessed += data.leafCount;
      });

      // Generate some proofs
      const settlements = generateTestSettlements(10);
      merkleProofService.batchGenerateProofs(settlements, 'metrics-batch');

      expect(metrics.proofsGenerated).toBe(10);
      expect(metrics.totalDataProcessed).toBe(10);
    });
  });
});

// Helper function to generate test settlements
function generateTestSettlements(count: number): SettlementLeaf[] {
  const settlements: SettlementLeaf[] = [];
  
  for (let i = 0; i < count; i++) {
    settlements.push({
      tradeId: `test-trade-${i}`,
      buyer: ethers.Wallet.createRandom().address,
      seller: ethers.Wallet.createRandom().address,
      buyerAmount: ethers.parseUnits((Math.random() * 10000).toFixed(2), 6),
      sellerAmount: ethers.parseEther((Math.random() * 10).toFixed(4)),
      buyerToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      sellerToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      timestamp: Date.now() - i * 1000,
      nonce: i
    });
  }
  
  return settlements;
}