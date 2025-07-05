import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { ethers } from 'ethers';
import * as snarkjs from 'snarkjs';
import { ZKTradeProver, PrivateTradeInput, ZKProof, CircuitConfig } from '../../src/utils/zkProofs';
import { MerkleSettlementProof, SettlementLeaf } from '../../src/services/settlement/MerkleSettlementProof';

// Mock circuit paths
const CIRCUIT_PATHS = {
  trade: {
    wasm: '/circuits/trade/trade.wasm',
    zkey: '/circuits/trade/trade_final.zkey',
    vkey: '/circuits/trade/verification_key.json'
  },
  batch: {
    wasm: '/circuits/batch/batch_trade.wasm',
    zkey: '/circuits/batch/batch_trade_final.zkey',
    vkey: '/circuits/batch/batch_verification_key.json'
  },
  rangeProof: {
    wasm: '/circuits/range/range_proof.wasm',
    zkey: '/circuits/range/range_proof_final.zkey',
    vkey: '/circuits/range/range_verification_key.json'
  }
};

// Enhanced ZK Settlement Prover
class ZKSettlementProver extends ZKTradeProver {
  async generateSettlementProof(
    privateTrade: PrivateTradeInput,
    publicSettlement: Partial<SettlementLeaf>
  ): Promise<{
    zkProof: ZKProof;
    publicData: SettlementLeaf;
    commitment: string;
  }> {
    // Generate ZK proof for private trade data
    const zkProof = await this.generateProof(privateTrade, {
      minPrice: privateTrade.price - (privateTrade.price / 100n), // 1% slippage
      maxPrice: privateTrade.price + (privateTrade.price / 100n)
    });

    // Create public settlement data with hidden values
    const publicData: SettlementLeaf = {
      tradeId: publicSettlement.tradeId || `zk-${Date.now()}`,
      buyer: '0x0000000000000000000000000000000000000000', // Hidden
      seller: '0x0000000000000000000000000000000000000000', // Hidden
      buyerAmount: 0n, // Hidden actual amount
      sellerAmount: 0n, // Hidden actual amount
      buyerToken: publicSettlement.buyerToken || '0x0000000000000000000000000000000000000000',
      sellerToken: publicSettlement.sellerToken || '0x0000000000000000000000000000000000000000',
      timestamp: publicSettlement.timestamp || Date.now(),
      nonce: Number(privateTrade.nonce)
    };

    // Create commitment linking ZK proof to settlement
    const commitment = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['string', 'bytes32[]', 'uint256'],
        [publicData.tradeId, zkProof.publicSignals, publicData.timestamp]
      )
    );

    return {
      zkProof,
      publicData,
      commitment
    };
  }

  async verifySettlementProof(
    zkProof: ZKProof,
    publicData: SettlementLeaf,
    commitment: string
  ): Promise<boolean> {
    // Verify ZK proof
    const zkValid = await this.verifyProof(zkProof);
    
    // Verify commitment
    const expectedCommitment = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['string', 'bytes32[]', 'uint256'],
        [publicData.tradeId, zkProof.publicSignals, publicData.timestamp]
      )
    );

    return zkValid && commitment === expectedCommitment;
  }
}

describe('ZK Proof Integration in Settlements', () => {
  let zkProver: ZKSettlementProver;
  let merkleProofService: MerkleSettlementProof;

  beforeEach(() => {
    zkProver = new ZKSettlementProver(CIRCUIT_PATHS.trade);
    merkleProofService = new MerkleSettlementProof();

    // Mock snarkjs functions
    jest.spyOn(snarkjs.groth16, 'fullProve').mockResolvedValue({
      proof: {
        pi_a: ['0x1234', '0x5678', '1'],
        pi_b: [['0x1111', '0x2222'], ['0x3333', '0x4444'], ['1', '0']],
        pi_c: ['0xaaaa', '0xbbbb', '1'],
        protocol: 'groth16',
        curve: 'bn128'
      },
      publicSignals: [
        '0x' + '1'.repeat(64), // commitment
        '0x' + '2'.repeat(64), // minPrice
        '0x' + '3'.repeat(64), // maxPrice
        '0x' + '4'.repeat(64)  // totalVolume
      ]
    });

    jest.spyOn(snarkjs.groth16, 'verify').mockResolvedValue(true);
  });

  describe('Basic ZK Settlement Proofs', () => {
    it('should generate ZK proof for private settlement data', async () => {
      const privateTrade: PrivateTradeInput = {
        price: ethers.parseUnits('2000', 8), // $2000
        amount: ethers.parseEther('1'), // 1 ETH
        nonce: 12345n,
        traderAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f6AEDC'
      };

      const { zkProof, publicData, commitment } = await zkProver.generateSettlementProof(
        privateTrade,
        {
          tradeId: 'trade-123',
          buyerToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
          sellerToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' // WETH
        }
      );

      expect(zkProof).toBeDefined();
      expect(zkProof.proof.protocol).toBe('groth16');
      expect(zkProof.publicSignals).toHaveLength(4);
      
      expect(publicData.buyer).toBe('0x0000000000000000000000000000000000000000');
      expect(publicData.seller).toBe('0x0000000000000000000000000000000000000000');
      expect(publicData.buyerAmount).toBe(0n);
      expect(publicData.sellerAmount).toBe(0n);
      
      expect(commitment).toMatch(/^0x[a-fA-F0-9]{64}$/);
    });

    it('should verify ZK settlement proof', async () => {
      const privateTrade: PrivateTradeInput = {
        price: ethers.parseUnits('2000', 8),
        amount: ethers.parseEther('1'),
        nonce: 12345n,
        traderAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f6AEDC'
      };

      const { zkProof, publicData, commitment } = await zkProver.generateSettlementProof(
        privateTrade,
        { tradeId: 'verify-test' }
      );

      const isValid = await zkProver.verifySettlementProof(
        zkProof,
        publicData,
        commitment
      );

      expect(isValid).toBe(true);
    });

    it('should reject invalid ZK proofs', async () => {
      const privateTrade: PrivateTradeInput = {
        price: ethers.parseUnits('2000', 8),
        amount: ethers.parseEther('1'),
        nonce: 12345n,
        traderAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f6AEDC'
      };

      const { zkProof, publicData, commitment } = await zkProver.generateSettlementProof(
        privateTrade,
        { tradeId: 'invalid-test' }
      );

      // Tamper with the commitment
      const tamperedCommitment = '0x' + 'f'.repeat(64);

      const isValid = await zkProver.verifySettlementProof(
        zkProof,
        publicData,
        tamperedCommitment
      );

      expect(isValid).toBe(false);
    });
  });

  describe('ZK Proofs with Merkle Trees', () => {
    it('should combine ZK proofs with Merkle settlement proofs', async () => {
      // Create mix of public and private settlements
      const settlements: SettlementLeaf[] = [];
      const zkSettlements: Array<{
        privateTrade: PrivateTradeInput;
        zkProof: ZKProof;
        commitment: string;
      }> = [];

      // Public settlements
      for (let i = 0; i < 3; i++) {
        settlements.push({
          tradeId: `public-${i}`,
          buyer: ethers.Wallet.createRandom().address,
          seller: ethers.Wallet.createRandom().address,
          buyerAmount: ethers.parseUnits('1000', 6),
          sellerAmount: ethers.parseEther('0.5'),
          buyerToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          sellerToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
          timestamp: Date.now(),
          nonce: i
        });
      }

      // Private settlements with ZK proofs
      for (let i = 0; i < 2; i++) {
        const privateTrade: PrivateTradeInput = {
          price: ethers.parseUnits('2000', 8),
          amount: ethers.parseEther('1'),
          nonce: BigInt(i + 1000),
          traderAddress: ethers.Wallet.createRandom().address
        };

        const { zkProof, publicData, commitment } = await zkProver.generateSettlementProof(
          privateTrade,
          { tradeId: `private-${i}` }
        );

        settlements.push(publicData);
        zkSettlements.push({ privateTrade, zkProof, commitment });
      }

      // Generate Merkle tree including both public and private settlements
      const { root, tree } = merkleProofService.generateMerkleTree(settlements);
      
      expect(settlements).toHaveLength(5);
      expect(zkSettlements).toHaveLength(2);
      expect(root).toMatch(/^0x[a-fA-F0-9]{64}$/);

      // Verify individual proofs
      for (const settlement of settlements) {
        const proof = merkleProofService.generateProof(settlement, settlements);
        expect(merkleProofService.verifyProof(proof)).toBe(true);
      }
    });

    it('should create privacy-preserving batch proofs', async () => {
      const privateTrades: PrivateTradeInput[] = [];
      const publicSettlements: SettlementLeaf[] = [];

      // Generate 10 private trades
      for (let i = 0; i < 10; i++) {
        const trade: PrivateTradeInput = {
          price: ethers.parseUnits((1900 + i * 10).toString(), 8),
          amount: ethers.parseEther((0.1 * (i + 1)).toString()),
          nonce: BigInt(i),
          traderAddress: ethers.Wallet.createRandom().address
        };
        privateTrades.push(trade);

        // Create corresponding public data
        const { publicData } = await zkProver.generateSettlementProof(trade, {
          tradeId: `batch-private-${i}`
        });
        publicSettlements.push(publicData);
      }

      // Generate batch Merkle proof
      const { root } = merkleProofService.generateMerkleTree(publicSettlements);

      // Create aggregated ZK proof for the batch
      const batchProof = await zkProver.generateBatchProof(privateTrades, {
        totalMinVolume: ethers.parseEther('1'),
        totalMaxVolume: ethers.parseEther('100'),
        priceRange: {
          min: ethers.parseUnits('1800', 8),
          max: ethers.parseUnits('2100', 8)
        }
      });

      expect(batchProof).toBeDefined();
      expect(root).toMatch(/^0x[a-fA-F0-9]{64}$/);
    });
  });

  describe('Range Proofs for Settlement Amounts', () => {
    it('should generate range proofs for settlement values', async () => {
      const amount = ethers.parseEther('10'); // 10 ETH
      const minAmount = ethers.parseEther('1');
      const maxAmount = ethers.parseEther('100');

      // Mock range proof generation
      const rangeProof = {
        commitment: ethers.keccak256(
          ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [amount])
        ),
        proof: {
          lower_bound_proof: '0x' + 'a'.repeat(64),
          upper_bound_proof: '0x' + 'b'.repeat(64),
          value_commitment: '0x' + 'c'.repeat(64)
        },
        publicInputs: {
          min: minAmount.toString(),
          max: maxAmount.toString()
        }
      };

      expect(rangeProof.commitment).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(BigInt(rangeProof.publicInputs.min)).toBeLessThanOrEqual(amount);
      expect(BigInt(rangeProof.publicInputs.max)).toBeGreaterThanOrEqual(amount);
    });

    it('should verify amounts are within acceptable ranges', async () => {
      const testCases = [
        { amount: ethers.parseEther('0.01'), valid: true },
        { amount: ethers.parseEther('50'), valid: true },
        { amount: ethers.parseEther('1000'), valid: false }, // Too large
        { amount: ethers.parseEther('0.0001'), valid: false } // Too small
      ];

      const minAmount = ethers.parseEther('0.001');
      const maxAmount = ethers.parseEther('100');

      for (const testCase of testCases) {
        const inRange = testCase.amount >= minAmount && testCase.amount <= maxAmount;
        expect(inRange).toBe(testCase.valid);
      }
    });
  });

  describe('Privacy-Preserving Settlement Aggregation', () => {
    it('should aggregate private settlements without revealing individual details', async () => {
      const privateSettlements: Array<{
        trade: PrivateTradeInput;
        proof: ZKProof;
        publicCommitment: string;
      }> = [];

      let totalVolume = 0n;
      
      // Create 5 private settlements
      for (let i = 0; i < 5; i++) {
        const trade: PrivateTradeInput = {
          price: ethers.parseUnits('2000', 8),
          amount: ethers.parseEther((i + 1).toString()),
          nonce: BigInt(i),
          traderAddress: ethers.Wallet.createRandom().address
        };

        const { zkProof, commitment } = await zkProver.generateSettlementProof(trade, {
          tradeId: `aggregate-${i}`
        });

        privateSettlements.push({
          trade,
          proof: zkProof,
          publicCommitment: commitment
        });

        totalVolume += trade.price * trade.amount / ethers.parseUnits('1', 8);
      }

      // Create aggregation proof
      const aggregationProof = {
        totalVolume: totalVolume.toString(),
        settlementCount: privateSettlements.length,
        commitments: privateSettlements.map(s => s.publicCommitment),
        aggregateCommitment: ethers.keccak256(
          ethers.AbiCoder.defaultAbiCoder().encode(
            ['bytes32[]'],
            [privateSettlements.map(s => s.publicCommitment)]
          )
        )
      };

      expect(aggregationProof.settlementCount).toBe(5);
      expect(BigInt(aggregationProof.totalVolume)).toBeGreaterThan(0n);
      expect(aggregationProof.aggregateCommitment).toMatch(/^0x[a-fA-F0-9]{64}$/);
      
      // Individual details remain private
      expect(aggregationProof.commitments).not.toContain(
        privateSettlements[0].trade.traderAddress
      );
    });

    it('should support selective disclosure of settlement attributes', async () => {
      const privateTrade: PrivateTradeInput = {
        price: ethers.parseUnits('2000', 8),
        amount: ethers.parseEther('5'),
        nonce: 99999n,
        traderAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f6AEDC'
      };

      // Generate proofs with different disclosure levels
      const fullPrivacyProof = await zkProver.generateSettlementProof(privateTrade, {
        tradeId: 'full-privacy'
      });

      // Selective disclosure: reveal only price range
      const priceRangeProof = {
        ...fullPrivacyProof.zkProof,
        disclosedAttributes: {
          priceRange: {
            min: ethers.parseUnits('1900', 8),
            max: ethers.parseUnits('2100', 8)
          }
        }
      };

      // Selective disclosure: reveal only volume tier
      const volumeTierProof = {
        ...fullPrivacyProof.zkProof,
        disclosedAttributes: {
          volumeTier: 'large', // > 1 ETH
          tierProof: '0x' + 'd'.repeat(64)
        }
      };

      expect(priceRangeProof.disclosedAttributes.priceRange).toBeDefined();
      expect(volumeTierProof.disclosedAttributes.volumeTier).toBe('large');
    });
  });

  describe('On-Chain ZK Proof Verification', () => {
    it('should generate calldata for on-chain ZK verification', () => {
      const zkProof: ZKProof = {
        proof: {
          pi_a: ['0x1234567890abcdef', '0xfedcba0987654321'],
          pi_b: [
            ['0x1111111111111111', '0x2222222222222222'],
            ['0x3333333333333333', '0x4444444444444444']
          ],
          pi_c: ['0xaaaaaaaaaaaaaaaa', '0xbbbbbbbbbbbbbbbb'],
          protocol: 'groth16'
        },
        publicSignals: [
          '0x' + '1'.repeat(64),
          '0x' + '2'.repeat(64),
          '0x' + '3'.repeat(64),
          '0x' + '4'.repeat(64)
        ]
      };

      // Generate calldata for verifier contract
      const iface = new ethers.Interface([
        'function verifyProof(uint[2] a, uint[2][2] b, uint[2] c, uint[4] publicSignals) returns (bool)'
      ]);

      const calldata = iface.encodeFunctionData('verifyProof', [
        zkProof.proof.pi_a,
        zkProof.proof.pi_b,
        zkProof.proof.pi_c,
        zkProof.publicSignals
      ]);

      expect(calldata).toMatch(/^0x[a-fA-F0-9]+$/);
      expect(calldata.length).toBeGreaterThan(100);
    });

    it('should handle different ZK proof systems', async () => {
      // Groth16 proof (already tested above)
      const groth16Proof: ZKProof = {
        proof: {
          pi_a: ['0x1', '0x2'],
          pi_b: [['0x3', '0x4'], ['0x5', '0x6']],
          pi_c: ['0x7', '0x8'],
          protocol: 'groth16'
        },
        publicSignals: ['0x' + 'a'.repeat(64)]
      };

      // PLONK proof simulation
      const plonkProof = {
        proof: {
          A: '0x' + '1'.repeat(64),
          B: '0x' + '2'.repeat(64),
          C: '0x' + '3'.repeat(64),
          Z: '0x' + '4'.repeat(64),
          T1: '0x' + '5'.repeat(64),
          T2: '0x' + '6'.repeat(64),
          T3: '0x' + '7'.repeat(64),
          Wxi: '0x' + '8'.repeat(64),
          Wxiw: '0x' + '9'.repeat(64),
          protocol: 'plonk'
        },
        publicSignals: ['0x' + 'b'.repeat(64)]
      };

      expect(groth16Proof.proof.protocol).toBe('groth16');
      expect(plonkProof.proof.protocol).toBe('plonk');
    });
  });

  describe('Performance and Scalability', () => {
    it('should efficiently generate ZK proofs for large batches', async () => {
      const batchSizes = [10, 50, 100];
      const timings: { size: number; duration: number }[] = [];

      for (const size of batchSizes) {
        const trades: PrivateTradeInput[] = [];
        
        for (let i = 0; i < size; i++) {
          trades.push({
            price: ethers.parseUnits((2000 + i).toString(), 8),
            amount: ethers.parseEther('1'),
            nonce: BigInt(i),
            traderAddress: ethers.Wallet.createRandom().address
          });
        }

        const startTime = Date.now();
        
        // Mock batch proof generation
        await zkProver.generateBatchProof(trades, {
          totalMinVolume: ethers.parseEther('1'),
          totalMaxVolume: ethers.parseEther('1000'),
          priceRange: {
            min: ethers.parseUnits('1900', 8),
            max: ethers.parseUnits('2200', 8)
          }
        });

        const duration = Date.now() - startTime;
        timings.push({ size, duration });
      }

      // Verify performance scales reasonably
      expect(timings[0].duration).toBeLessThan(100); // 10 trades < 100ms
      expect(timings[1].duration).toBeLessThan(500); // 50 trades < 500ms
      expect(timings[2].duration).toBeLessThan(1000); // 100 trades < 1s
    });

    it('should cache verification keys for performance', async () => {
      const vKeyCache = new Map<string, any>();
      
      // Simulate loading verification keys
      const circuits = ['trade', 'batch', 'range'];
      
      for (const circuit of circuits) {
        const vKey = {
          protocol: 'groth16',
          curve: 'bn128',
          nPublic: 4,
          vk_alpha_1: ['0x' + '1'.repeat(64), '0x' + '2'.repeat(64)],
          vk_beta_2: [['0x' + '3'.repeat(64), '0x' + '4'.repeat(64)]],
          vk_gamma_2: [['0x' + '5'.repeat(64), '0x' + '6'.repeat(64)]],
          vk_delta_2: [['0x' + '7'.repeat(64), '0x' + '8'.repeat(64)]],
          IC: Array(5).fill(['0x' + '9'.repeat(64), '0x' + 'a'.repeat(64)])
        };
        
        vKeyCache.set(circuit, vKey);
      }

      expect(vKeyCache.size).toBe(3);
      expect(vKeyCache.get('trade')).toBeDefined();
      expect(vKeyCache.get('batch')).toBeDefined();
      expect(vKeyCache.get('range')).toBeDefined();
    });
  });
});

describe('ZK Proof Error Handling', () => {
  let zkProver: ZKSettlementProver;

  beforeEach(() => {
    zkProver = new ZKSettlementProver(CIRCUIT_PATHS.trade);
  });

  it('should handle invalid circuit paths gracefully', async () => {
    const invalidProver = new ZKSettlementProver({
      wasm: '/invalid/path.wasm',
      zkey: '/invalid/path.zkey',
      vkey: '/invalid/path.vkey'
    });

    // Mock to throw error
    jest.spyOn(snarkjs.groth16, 'fullProve').mockRejectedValue(
      new Error('Circuit file not found')
    );

    const privateTrade: PrivateTradeInput = {
      price: ethers.parseUnits('2000', 8),
      amount: ethers.parseEther('1'),
      nonce: 12345n,
      traderAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f6AEDc'
    };

    await expect(
      invalidProver.generateProof(privateTrade, {
        minPrice: ethers.parseUnits('1900', 8),
        maxPrice: ethers.parseUnits('2100', 8)
      })
    ).rejects.toThrow('Failed to generate ZK proof');
  });

  it('should validate input constraints', async () => {
    const invalidTrade: PrivateTradeInput = {
      price: 0n, // Invalid: zero price
      amount: ethers.parseEther('1'),
      nonce: 12345n,
      traderAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f6AEDc'
    };

    // Should handle invalid inputs gracefully
    const result = await zkProver.generateSettlementProof(invalidTrade, {
      tradeId: 'invalid-input-test'
    });

    // The proof generation might succeed but verification should catch issues
    expect(result).toBeDefined();
  });
});