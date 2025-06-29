import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { ethers } from 'ethers';
import { FinalSettlementEngine } from '../FinalSettlementEngine';
import { Trade, OrderType } from '../../matchingEngine/types';

// Mock providers and wallet
const mockProvider = {
  getFeeData: jest.fn().mockResolvedValue({
    gasPrice: ethers.parseUnits('20', 'gwei')
  }),
  getBlockNumber: jest.fn().mockResolvedValue(1000)
} as any;

const mockWallet = {
  address: '0x1234567890123456789012345678901234567890',
  getNonce: jest.fn().mockResolvedValue(0),
  sendTransaction: jest.fn().mockResolvedValue({
    hash: '0xmocktxhash',
    wait: jest.fn().mockResolvedValue({
      status: 1,
      gasUsed: BigInt(100000)
    })
  })
} as any;

// Mock contract
const mockContract = {
  batchSettle: jest.fn().mockResolvedValue({
    hash: '0xmockcontracttxhash',
    wait: jest.fn().mockResolvedValue({
      status: 1,
      gasUsed: BigInt(200000)
    })
  }),
  on: jest.fn(),
  removeAllListeners: jest.fn()
} as any;

// Override ethers Contract constructor
jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers') as any;
  return {
    ...actual,
    Contract: jest.fn().mockImplementation(() => mockContract),
    Wallet: jest.fn().mockImplementation(() => mockWallet)
  };
});

describe('FinalSettlementEngine', () => {
  let engine: FinalSettlementEngine;
  const privateKey = '0x0123456789012345678901234567890123456789012345678901234567890123';
  const contractAddress = '0xabcdef0123456789012345678901234567890123';
  
  beforeEach(() => {
    jest.clearAllMocks();
    engine = new FinalSettlementEngine(
      mockProvider,
      privateKey,
      contractAddress,
      1000 // 1 second epoch for testing
    );
  });
  
  describe('Trade Processing', () => {
    it('should add trades to current epoch', () => {
      const trade: Trade = {
        id: 'trade1',
        pair: 'ETH/USDC',
        price: 2000,
        quantity: 1,
        filledQuantity: 1,
        side: 'BUY',
        type: OrderType.LIMIT,
        status: 'FILLED',
        timestamp: Date.now(),
        buyerId: 'user1',
        sellerId: 'user2',
        buyOrderId: 'order1',
        sellOrderId: 'order2',
        buyerFee: 0.001,
        sellerFee: 0.001
      };
      
      engine.addTrade(trade);
      
      const currentEpoch = engine.getCurrentEpoch();
      expect(currentEpoch).not.toBeNull();
      expect(currentEpoch!.trades).toHaveLength(1);
      expect(currentEpoch!.trades[0]).toEqual(trade);
    });
    
    it('should reject trades when no active epoch', () => {
      // Force no active epoch
      (engine as any).currentEpoch = null;
      
      const trade: Trade = {
        id: 'trade1',
        pair: 'ETH/USDC',
        price: 2000,
        quantity: 1,
        filledQuantity: 1,
        side: 'BUY',
        type: OrderType.LIMIT,
        status: 'FILLED',
        timestamp: Date.now(),
        buyerId: 'user1',
        sellerId: 'user2',
        buyOrderId: 'order1',
        sellOrderId: 'order2',
        buyerFee: 0,
        sellerFee: 0
      };
      
      expect(() => engine.addTrade(trade)).toThrow('No active epoch accepting trades');
    });
  });
  
  describe('Epoch Management', () => {
    it('should automatically start new epochs', (done) => {
      const initialEpoch = engine.getCurrentEpoch();
      expect(initialEpoch).not.toBeNull();
      expect(initialEpoch!.status).toBe('COLLECTING');
      
      // Wait for epoch transition
      setTimeout(() => {
        const newEpoch = engine.getCurrentEpoch();
        expect(newEpoch).not.toBeNull();
        expect(newEpoch!.epochNumber).toBe(initialEpoch!.epochNumber + 1);
        done();
      }, 1500);
    });
    
    it('should finalize epochs with trades', (done) => {
      const trades: Trade[] = [
        {
          id: 'trade1',
          pair: 'ETH/USDC',
          price: 2000,
          quantity: 1,
          filledQuantity: 1,
          side: 'BUY',
          type: OrderType.LIMIT,
          status: 'FILLED',
          timestamp: Date.now(),
          buyerId: 'user1',
          sellerId: 'user2',
          buyOrderId: 'order1',
          sellOrderId: 'order2',
          buyerFee: 0.001,
          sellerFee: 0.001
        },
        {
          id: 'trade2',
          pair: 'ETH/USDC',
          price: 2010,
          quantity: 0.5,
          filledQuantity: 0.5,
          side: 'SELL',
          type: OrderType.MARKET,
          status: 'FILLED',
          timestamp: Date.now(),
          buyerId: 'user3',
          sellerId: 'user1',
          buyOrderId: 'order3',
          sellOrderId: 'order4',
          buyerFee: 0.001,
          sellerFee: 0.001
        }
      ];
      
      trades.forEach(trade => engine.addTrade(trade));
      
      const epochId = engine.getCurrentEpoch()!.id;
      
      engine.on('epochFinalized', (epoch) => {
        expect(epoch.id).toBe(epochId);
        expect(epoch.status).toBe('COMPLETED');
        expect(epoch.settlementBatch).toBeDefined();
        expect(epoch.transactionBundles).toBeDefined();
        done();
      });
      
      // Wait for epoch to finalize
      setTimeout(() => {
        // Check if event was not fired (meaning test should fail)
        done(new Error('Epoch finalization timeout'));
      }, 2000);
    });
  });
  
  describe('Settlement Instructions', () => {
    it('should generate correct settlement instructions', async () => {
      const netPositions = new Map([
        ['user1', new Map([
          ['ETH', BigInt(1000000000)], // 1 ETH
          ['USDC', BigInt(-2000000000)] // -2000 USDC
        ])],
        ['user2', new Map([
          ['ETH', BigInt(-1000000000)], // -1 ETH
          ['USDC', BigInt(2000000000)] // 2000 USDC
        ])]
      ]);
      
      const instructions = await (engine as any).generateSettlementInstructions(
        netPositions,
        'epoch1'
      );
      
      expect(instructions.length).toBeGreaterThan(0);
      
      // Check ETH transfers
      const ethInstructions = instructions.filter(i => i.token === 'ETH');
      expect(ethInstructions).toHaveLength(2);
      
      const user1EthInstruction = ethInstructions.find(i => i.to === 'user1');
      expect(user1EthInstruction).toBeDefined();
      expect(user1EthInstruction!.amount).toBe(BigInt(1000000000));
      
      // Check USDC transfers
      const usdcInstructions = instructions.filter(i => i.token === 'USDC');
      expect(usdcInstructions).toHaveLength(2);
      
      const user2UsdcInstruction = usdcInstructions.find(i => i.to === 'user2');
      expect(user2UsdcInstruction).toBeDefined();
      expect(user2UsdcInstruction!.amount).toBe(BigInt(2000000000));
    });
    
    it('should optimize multi-token transfers', async () => {
      const netPositions = new Map([
        ['user1', new Map([
          ['ETH', BigInt(1000000000)],
          ['USDC', BigInt(-2000000000)],
          ['DAI', BigInt(500000000)],
          ['USDT', BigInt(-300000000)]
        ])]
      ]);
      
      const instructions = await (engine as any).generateSettlementInstructions(
        netPositions,
        'epoch1'
      );
      
      // Should create optimized instructions
      const optimized = (engine as any).optimizeInstructions(instructions);
      
      // Check if multi-token transfer was created
      const multiTokenInstruction = optimized.find(i => i.type === 'MULTI_TOKEN_TRANSFER');
      expect(multiTokenInstruction).toBeDefined();
    });
  });
  
  describe('Transaction Bundling', () => {
    it('should create bundles respecting size limits', async () => {
      const instructions = Array.from({ length: 250 }, (_, i) => ({
        id: `inst_${i}`,
        type: 'TRANSFER' as const,
        from: 'user1',
        to: 'user2',
        token: 'USDC',
        amount: BigInt(1000000),
        settlementIds: [`set_${i}`],
        priority: 50,
        gasEstimate: BigInt(65000)
      }));
      
      const bundles = await (engine as any).createTransactionBundles(instructions);
      
      expect(bundles.length).toBeGreaterThan(1);
      bundles.forEach(bundle => {
        expect(bundle.instructions.length).toBeLessThanOrEqual(100);
      });
    });
    
    it('should respect gas limits per bundle', async () => {
      const instructions = Array.from({ length: 50 }, (_, i) => ({
        id: `inst_${i}`,
        type: 'TRANSFER' as const,
        from: 'user1',
        to: 'user2',
        token: 'USDC',
        amount: BigInt(1000000),
        settlementIds: [`set_${i}`],
        priority: 50,
        gasEstimate: BigInt(1000000) // High gas per instruction
      }));
      
      const bundles = await (engine as any).createTransactionBundles(instructions);
      
      bundles.forEach(bundle => {
        expect(bundle.totalGasEstimate).toBeLessThanOrEqual(BigInt(30000000));
      });
    });
  });
  
  describe('Bundle Execution', () => {
    it('should execute bundles via settlement contract', async () => {
      const bundle = {
        id: 'bundle1',
        instructions: [
          {
            id: 'inst1',
            type: 'TRANSFER' as const,
            from: 'SETTLEMENT_POOL',
            to: 'user1',
            token: 'USDC',
            amount: BigInt(1000000),
            settlementIds: ['set1'],
            priority: 50
          }
        ],
        totalGasEstimate: BigInt(100000),
        maxGasPrice: BigInt(20000000000),
        nonce: 0,
        status: 'PENDING' as const
      };
      
      await (engine as any).executeBundle(bundle);
      
      expect(mockContract.batchSettle).toHaveBeenCalled();
      expect(bundle.status).toBe('CONFIRMED');
      expect(bundle.transactionHash).toBe('0xmockcontracttxhash');
    });
    
    it('should retry failed bundles', async () => {
      // Mock failure then success
      mockContract.batchSettle
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          hash: '0xretrytxhash',
          wait: jest.fn().mockResolvedValue({
            status: 1,
            gasUsed: BigInt(150000)
          })
        });
      
      const bundle = {
        id: 'bundle1',
        instructions: [
          {
            id: 'inst1',
            type: 'TRANSFER' as const,
            from: 'SETTLEMENT_POOL',
            to: 'user1',
            token: 'USDC',
            amount: BigInt(1000000),
            settlementIds: ['set1'],
            priority: 50
          }
        ],
        totalGasEstimate: BigInt(100000),
        maxGasPrice: BigInt(20000000000),
        nonce: 0,
        status: 'PENDING' as const
      };
      
      await (engine as any).executeBundle(bundle);
      
      expect(mockContract.batchSettle).toHaveBeenCalledTimes(2);
      expect(bundle.status).toBe('CONFIRMED');
      expect(bundle.transactionHash).toBe('0xretrytxhash');
    });
    
    it('should handle permanent failures', async () => {
      // Mock permanent failure
      mockContract.batchSettle.mockRejectedValue(new Error('Insufficient funds'));
      
      const bundle = {
        id: 'bundle1',
        instructions: [
          {
            id: 'inst1',
            type: 'TRANSFER' as const,
            from: 'SETTLEMENT_POOL',
            to: 'user1',
            token: 'USDC',
            amount: BigInt(1000000),
            settlementIds: ['set1'],
            priority: 50
          }
        ],
        totalGasEstimate: BigInt(100000),
        maxGasPrice: BigInt(20000000000),
        nonce: 0,
        status: 'PENDING' as const
      };
      
      await expect((engine as any).executeBundle(bundle)).rejects.toThrow('Insufficient funds');
      expect(bundle.status).toBe('FAILED');
      expect(bundle.error).toBe('Insufficient funds');
    });
  });
  
  describe('Settlement Verification', () => {
    it('should verify successful settlements', async () => {
      const epoch = {
        id: 'epoch1',
        epochNumber: 1,
        startTime: Date.now() - 3600000,
        endTime: Date.now(),
        trades: [],
        status: 'FINALIZING' as const,
        settlementBatch: {
          id: 'batch1',
          settlements: [],
          totalTrades: 2,
          netPositions: new Map([
            ['user1', new Map([['USDC', BigInt(1000000)]])],
            ['user2', new Map([['USDC', BigInt(-1000000)]])]
          ]),
          status: 'SETTLED' as const,
          createdAt: Date.now()
        }
      };
      
      // Mock balance tracker
      const mockBalanceTracker = (engine as any).balanceTracker;
      mockBalanceTracker.getUserBalance = jest.fn()
        .mockResolvedValueOnce({
          userId: 'user1',
          balances: new Map([['USDC', BigInt(1000000)]]),
          pendingSettlements: new Map(),
          lastUpdated: Date.now()
        })
        .mockResolvedValueOnce({
          userId: 'user2',
          balances: new Map([['USDC', BigInt(0)]]),
          pendingSettlements: new Map(),
          lastUpdated: Date.now()
        });
      
      await (engine as any).verifySettlements(epoch);
      
      const verification = engine.getVerification(epoch.id);
      expect(verification).toBeDefined();
      expect(verification!.verified).toBe(true);
      expect(verification!.discrepancies).toHaveLength(0);
    });
    
    it('should detect settlement discrepancies', async () => {
      const epoch = {
        id: 'epoch1',
        epochNumber: 1,
        startTime: Date.now() - 3600000,
        endTime: Date.now(),
        trades: [],
        status: 'FINALIZING' as const,
        settlementBatch: {
          id: 'batch1',
          settlements: [],
          totalTrades: 2,
          netPositions: new Map([
            ['user1', new Map([['USDC', BigInt(1000000)]])]
          ]),
          status: 'SETTLED' as const,
          createdAt: Date.now()
        }
      };
      
      // Mock balance tracker with wrong balance
      const mockBalanceTracker = (engine as any).balanceTracker;
      mockBalanceTracker.getUserBalance = jest.fn()
        .mockResolvedValue({
          userId: 'user1',
          balances: new Map([['USDC', BigInt(500000)]]), // Wrong amount
          pendingSettlements: new Map(),
          lastUpdated: Date.now()
        });
      
      let verificationFailedEmitted = false;
      engine.on('verificationFailed', () => {
        verificationFailedEmitted = true;
      });
      
      await (engine as any).verifySettlements(epoch);
      
      const verification = engine.getVerification(epoch.id);
      expect(verification).toBeDefined();
      expect(verification!.verified).toBe(false);
      expect(verification!.discrepancies).toHaveLength(1);
      expect(verification!.discrepancies[0]).toEqual({
        userId: 'user1',
        token: 'USDC',
        expected: BigInt(1000000),
        actual: BigInt(500000)
      });
      expect(verificationFailedEmitted).toBe(true);
    });
  });
  
  describe('Emergency Controls', () => {
    it('should pause settlement contract on emergency', async () => {
      mockContract.emergencyPause = jest.fn().mockResolvedValue({
        hash: '0xpausetxhash',
        wait: jest.fn().mockResolvedValue({ status: 1 })
      });
      
      await engine.emergencyPause();
      
      expect(mockContract.emergencyPause).toHaveBeenCalled();
    });
  });
  
  describe('Priority Calculation', () => {
    it('should assign correct priorities based on amount', () => {
      const testCases = [
        { amount: BigInt(2000000000000), expectedPriority: 100 }, // > $1M
        { amount: BigInt(200000000000), expectedPriority: 80 },   // > $100k
        { amount: BigInt(20000000000), expectedPriority: 60 },    // > $10k
        { amount: BigInt(2000000000), expectedPriority: 40 },     // > $1k
        { amount: BigInt(200000000), expectedPriority: 20 }       // < $1k
      ];
      
      testCases.forEach(({ amount, expectedPriority }) => {
        const priority = (engine as any).calculatePriority(amount);
        expect(priority).toBe(expectedPriority);
      });
    });
  });
});