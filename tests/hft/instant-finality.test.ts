import { HFTOptimizedInstantFinality } from './mocks/HFTOptimizedInstantFinality';
import { ethers } from 'ethers';
import { performance } from 'perf_hooks';

describe('HFT Instant Finality Tests', () => {
  let hftChannel: HFTOptimizedInstantFinality;
  let participant1: ethers.Wallet;
  let participant2: ethers.Wallet;
  let participant3: ethers.Wallet;
  let channelId: string;

  beforeEach(async () => {
    // Create test wallets
    participant1 = ethers.Wallet.createRandom();
    participant2 = ethers.Wallet.createRandom();
    participant3 = ethers.Wallet.createRandom();
    
    channelId = `channel-${Date.now()}`;
    
    // Initialize HFT channel with test participants
    hftChannel = new HFTOptimizedInstantFinality(
      channelId,
      [participant1.address, participant2.address, participant3.address],
      {
        enableZeroConfirmation: true,
        parallelBatchSize: 100,
        targetLatencyMs: 1,
        enableSignatureCaching: true,
        maxCacheSize: 10000
      }
    );

    // Trust participants for zero-confirmation trades
    await hftChannel.trustParticipant(participant1.address);
    await hftChannel.trustParticipant(participant2.address);
  });

  afterEach(() => {
    hftChannel.shutdown();
  });

  describe('Zero-Confirmation Trading', () => {
    test('should execute zero-confirmation trades for trusted participants', async () => {
      const trade = {
        id: 'trade-1',
        from: participant1.address,
        to: participant2.address,
        amount: ethers.parseEther('1.0'),
        token: 'ETH',
        price: 50000,
        timestamp: Date.now()
      };

      const startTime = performance.now();
      const result = await hftChannel.submitZeroConfTrade(trade);
      const executionTime = performance.now() - startTime;

      expect(result.confirmed).toBe(true);
      expect(result.executionTimeMs).toBeLessThan(1); // Sub-millisecond
      expect(executionTime).toBeLessThan(5); // Total processing under 5ms
      expect(result.trade.status).toBe('EXECUTED');
    });

    test('should reject zero-confirmation trades for untrusted participants', async () => {
      const trade = {
        id: 'trade-2',
        from: participant3.address, // Not trusted
        to: participant1.address,
        amount: ethers.parseEther('1.0'),
        token: 'ETH',
        price: 50000,
        timestamp: Date.now()
      };

      const result = await hftChannel.submitZeroConfTrade(trade);
      
      expect(result.confirmed).toBe(false);
      expect(result.requiresConfirmation).toBe(true);
      expect(result.trade.status).toBe('PENDING_CONFIRMATION');
    });

    test('should handle high-frequency zero-conf trades', async () => {
      const trades = [];
      const tradeCount = 1000;
      
      // Generate trades
      for (let i = 0; i < tradeCount; i++) {
        trades.push({
          id: `hft-trade-${i}`,
          from: i % 2 === 0 ? participant1.address : participant2.address,
          to: i % 2 === 0 ? participant2.address : participant1.address,
          amount: ethers.parseEther('0.001'),
          token: 'ETH',
          price: 50000 + (Math.random() * 100),
          timestamp: Date.now()
        });
      }

      const startTime = performance.now();
      const results = await Promise.all(
        trades.map(trade => hftChannel.submitZeroConfTrade(trade))
      );
      const totalTime = performance.now() - startTime;
      
      const avgTimePerTrade = totalTime / tradeCount;
      const successfulTrades = results.filter(r => r.confirmed).length;
      
      expect(successfulTrades).toBe(tradeCount);
      expect(avgTimePerTrade).toBeLessThan(1); // Average under 1ms per trade
      
      // Check throughput
      const throughput = (tradeCount / totalTime) * 1000; // TPS
      expect(throughput).toBeGreaterThan(1000); // > 1000 TPS
    });
  });

  describe('Parallel Batch Processing', () => {
    test('should process trades in parallel batches', async () => {
      const batchSize = 100;
      const trades = [];
      
      for (let i = 0; i < batchSize; i++) {
        trades.push({
          id: `batch-trade-${i}`,
          from: participant1.address,
          to: participant2.address,
          amount: ethers.parseEther('0.01'),
          token: 'ETH',
          price: 50000,
          timestamp: Date.now(),
          nonce: i
        });
      }

      const startTime = performance.now();
      const batchResult = await hftChannel.processBatch(trades);
      const processingTime = performance.now() - startTime;

      expect(batchResult.processed).toBe(batchSize);
      expect(batchResult.failed).toBe(0);
      expect(batchResult.parallelExecutionTime).toBeLessThan(processingTime);
      expect(batchResult.throughput).toBeGreaterThan(1000); // TPS
    });

    test('should maintain order consistency in parallel execution', async () => {
      const trades = [];
      const accounts = [
        { address: participant1.address, balance: 100 },
        { address: participant2.address, balance: 100 }
      ];

      // Create dependent trades
      for (let i = 0; i < 50; i++) {
        trades.push({
          id: `order-trade-${i}`,
          from: participant1.address,
          to: participant2.address,
          amount: ethers.parseEther('1'),
          token: 'ETH',
          price: 50000,
          timestamp: Date.now(),
          nonce: i
        });
      }

      const result = await hftChannel.processBatch(trades);
      const finalState = await hftChannel.getChannelState();

      // Verify order was maintained
      expect(result.processed).toBe(50);
      expect(finalState.nonce).toBe(50);
      expect(finalState.trades.length).toBe(50);
      
      // Verify trades were processed in order
      for (let i = 0; i < 50; i++) {
        expect(finalState.trades[i].nonce).toBe(i);
      }
    });
  });

  describe('Signature Caching Performance', () => {
    test('should cache and reuse signatures for performance', async () => {
      const message = 'test-message';
      const messageHash = ethers.keccak256(ethers.toUtf8Bytes(message));
      
      // First signature - should be computed
      const startTime1 = performance.now();
      const sig1 = await hftChannel.signWithCache(messageHash, participant1);
      const time1 = performance.now() - startTime1;
      
      // Second signature - should be cached
      const startTime2 = performance.now();
      const sig2 = await hftChannel.signWithCache(messageHash, participant1);
      const time2 = performance.now() - startTime2;
      
      expect(sig1).toBe(sig2);
      expect(time2).toBeLessThan(time1 / 10); // Cached should be 10x+ faster
      
      const cacheStats = hftChannel.getCacheStats();
      expect(cacheStats.hits).toBe(1);
      expect(cacheStats.misses).toBe(1);
      expect(cacheStats.hitRate).toBe(0.5);
    });

    test('should handle cache overflow gracefully', async () => {
      const maxCache = 100;
      const signatures = [];
      
      // Fill cache beyond capacity
      for (let i = 0; i < maxCache * 2; i++) {
        const message = `message-${i}`;
        const messageHash = ethers.keccak256(ethers.toUtf8Bytes(message));
        signatures.push(await hftChannel.signWithCache(messageHash, participant1));
      }
      
      const cacheStats = hftChannel.getCacheStats();
      expect(cacheStats.size).toBeLessThanOrEqual(maxCache);
      expect(cacheStats.evictions).toBeGreaterThan(0);
    });
  });

  describe('Latency Metrics and Monitoring', () => {
    test('should track and report latency metrics', async () => {
      const trades = [];
      const count = 100;
      
      for (let i = 0; i < count; i++) {
        const trade = {
          id: `metric-trade-${i}`,
          from: participant1.address,
          to: participant2.address,
          amount: ethers.parseEther('0.001'),
          token: 'ETH',
          price: 50000,
          timestamp: Date.now()
        };
        
        await hftChannel.submitZeroConfTrade(trade);
      }
      
      const metrics = hftChannel.getPerformanceMetrics();
      
      expect(metrics.avgLatencyMs).toBeLessThan(1);
      expect(metrics.p99LatencyMs).toBeLessThan(5);
      expect(metrics.p95LatencyMs).toBeLessThan(2);
      expect(metrics.totalTrades).toBe(count);
      expect(metrics.tradesPerSecond).toBeGreaterThan(100);
    });

    test('should emit alerts for latency spikes', async () => {
      const alerts: any[] = [];
      hftChannel.on('latencyAlert', (alert) => alerts.push(alert));
      
      // Simulate slow trade
      const slowTrade = {
        id: 'slow-trade',
        from: participant1.address,
        to: participant2.address,
        amount: ethers.parseEther('1'),
        token: 'ETH',
        price: 50000,
        timestamp: Date.now(),
        simulateDelay: 100 // ms
      };
      
      await hftChannel.submitZeroConfTrade(slowTrade);
      
      expect(alerts.length).toBeGreaterThan(0);
      expect(alerts[0].type).toBe('LATENCY_SPIKE');
      expect(alerts[0].latencyMs).toBeGreaterThan(50);
    });
  });

  describe('Optimistic Execution', () => {
    test('should execute trades optimistically with background confirmation', async () => {
      const trade = {
        id: 'optimistic-1',
        from: participant1.address,
        to: participant2.address,
        amount: ethers.parseEther('10'),
        token: 'ETH',
        price: 50000,
        timestamp: Date.now()
      };
      
      const result = await hftChannel.submitOptimisticTrade(trade);
      
      expect(result.optimisticExecution).toBe(true);
      expect(result.immediateResult).toBe('EXECUTED');
      expect(result.confirmationPending).toBe(true);
      
      // Wait for background confirmation
      const confirmation = await result.confirmationPromise;
      expect(confirmation.confirmed).toBe(true);
      expect(confirmation.blockNumber).toBeGreaterThan(0);
    });

    test('should handle optimistic execution rollback', async () => {
      const invalidTrade = {
        id: 'optimistic-invalid',
        from: participant1.address,
        to: participant2.address,
        amount: ethers.parseEther('1000000'), // Exceeds balance
        token: 'ETH',
        price: 50000,
        timestamp: Date.now()
      };
      
      const result = await hftChannel.submitOptimisticTrade(invalidTrade);
      
      expect(result.optimisticExecution).toBe(true);
      expect(result.immediateResult).toBe('EXECUTED');
      
      // Wait for rollback
      const confirmation = await result.confirmationPromise;
      expect(confirmation.confirmed).toBe(false);
      expect(confirmation.rolledBack).toBe(true);
      expect(confirmation.reason).toContain('Insufficient balance');
      
      // Verify state was rolled back
      const state = await hftChannel.getChannelState();
      expect(state.trades.find(t => t.id === invalidTrade.id)).toBeUndefined();
    });
  });

  describe('High Load Performance', () => {
    test('should maintain performance under extreme load', async () => {
      const duration = 5000; // 5 seconds
      const startTime = Date.now();
      let tradeCount = 0;
      const latencies: number[] = [];
      
      // Generate continuous high-frequency trades
      while (Date.now() - startTime < duration) {
        const trade = {
          id: `load-trade-${tradeCount}`,
          from: tradeCount % 2 === 0 ? participant1.address : participant2.address,
          to: tradeCount % 2 === 0 ? participant2.address : participant1.address,
          amount: ethers.parseEther('0.0001'),
          token: 'ETH',
          price: 50000 + (Math.random() * 10),
          timestamp: Date.now()
        };
        
        const tradeStart = performance.now();
        await hftChannel.submitZeroConfTrade(trade);
        latencies.push(performance.now() - tradeStart);
        
        tradeCount++;
      }
      
      const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      const sortedLatencies = latencies.sort((a, b) => a - b);
      const p99Latency = sortedLatencies[Math.floor(sortedLatencies.length * 0.99)];
      const throughput = (tradeCount / duration) * 1000;
      
      console.log(`High Load Test Results:
        - Total Trades: ${tradeCount}
        - Duration: ${duration}ms
        - Throughput: ${throughput.toFixed(2)} TPS
        - Avg Latency: ${avgLatency.toFixed(3)}ms
        - P99 Latency: ${p99Latency.toFixed(3)}ms
      `);
      
      expect(throughput).toBeGreaterThan(1000); // > 1000 TPS
      expect(avgLatency).toBeLessThan(2); // < 2ms average
      expect(p99Latency).toBeLessThan(10); // < 10ms P99
    });

    test('should handle concurrent channel operations', async () => {
      const operations = [];
      const operationCount = 1000;
      
      // Mix of different operations
      for (let i = 0; i < operationCount; i++) {
        const op = i % 4;
        
        switch (op) {
          case 0: // Submit trade
            operations.push(hftChannel.submitZeroConfTrade({
              id: `concurrent-trade-${i}`,
              from: participant1.address,
              to: participant2.address,
              amount: ethers.parseEther('0.001'),
              token: 'ETH',
              price: 50000,
              timestamp: Date.now()
            }));
            break;
            
          case 1: // Get state
            operations.push(hftChannel.getChannelState());
            break;
            
          case 2: // Get metrics
            operations.push(hftChannel.getPerformanceMetrics());
            break;
            
          case 3: // Process batch
            operations.push(hftChannel.processBatch([{
              id: `batch-${i}`,
              from: participant2.address,
              to: participant1.address,
              amount: ethers.parseEther('0.001'),
              token: 'ETH',
              price: 50000,
              timestamp: Date.now()
            }]));
            break;
        }
      }
      
      const startTime = performance.now();
      await Promise.all(operations);
      const totalTime = performance.now() - startTime;
      
      const opsPerSecond = (operationCount / totalTime) * 1000;
      expect(opsPerSecond).toBeGreaterThan(1000); // > 1000 ops/sec
      
      // Verify channel integrity
      const finalState = await hftChannel.getChannelState();
      expect(finalState).toBeDefined();
      expect(finalState.stateRoot).toBeDefined();
    });
  });
});