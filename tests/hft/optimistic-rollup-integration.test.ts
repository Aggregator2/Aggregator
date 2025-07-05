import { ethers } from 'ethers';
import { HFTOptimizedInstantFinality } from './mocks/HFTOptimizedInstantFinality';
import { StateManager } from './mocks/StateChannelMocks';
import { performance } from 'perf_hooks';

describe('Optimistic Rollup Integration Tests', () => {
  let rollupProvider: any;
  let sequencer: ethers.Wallet;
  let validators: ethers.Wallet[];
  let hftChannel: HFTOptimizedInstantFinality;
  let stateManager: StateManager;
  
  beforeEach(async () => {
    // Setup rollup environment
    sequencer = ethers.Wallet.createRandom();
    validators = Array(5).fill(null).map(() => ethers.Wallet.createRandom());
    
    // Mock rollup provider
    rollupProvider = {
      sequencerUrl: 'http://localhost:8547',
      l1Provider: new ethers.JsonRpcProvider(process.env.ETHEREUM_RPC_URL),
      challengePeriod: 7 * 24 * 60 * 60, // 7 days
      minBond: ethers.parseEther('1'),
      fraudProofWindow: 24 * 60 * 60 // 24 hours
    };
    
    // Initialize HFT channel with rollup support
    hftChannel = new HFTOptimizedInstantFinality(
      'rollup-channel-1',
      [sequencer.address, ...validators.map(v => v.address)],
      {
        enableOptimisticExecution: true,
        rollupProvider,
        batchSize: 100,
        compressionEnabled: true
      }
    );
    
    stateManager = new StateManager('rollup-channel-1');
  });

  describe('Optimistic Batch Submission', () => {
    test('should batch and submit transactions optimistically', async () => {
      const batchSize = 100;
      const transactions = [];
      
      // Generate batch of transactions
      for (let i = 0; i < batchSize; i++) {
        transactions.push({
          id: `tx-${i}`,
          from: validators[i % validators.length].address,
          to: validators[(i + 1) % validators.length].address,
          amount: ethers.parseEther('0.1'),
          nonce: i,
          timestamp: Date.now()
        });
      }
      
      // Submit batch optimistically
      const startTime = performance.now();
      const batchResult = await hftChannel.submitOptimisticBatch(transactions);
      const submissionTime = performance.now() - startTime;
      
      expect(batchResult.batchId).toBeDefined();
      expect(batchResult.stateRoot).toBeDefined();
      expect(batchResult.optimisticConfirmation).toBe(true);
      expect(batchResult.l1SubmissionPending).toBe(true);
      expect(submissionTime).toBeLessThan(100); // Fast optimistic confirmation
      
      // Check batch compression
      expect(batchResult.compressionRatio).toBeGreaterThan(0.5);
      expect(batchResult.compressedSize).toBeLessThan(batchResult.uncompressedSize);
      
      // Verify L2 state update
      const l2State = await hftChannel.getL2State();
      expect(l2State.lastBatch).toBe(batchResult.batchId);
      expect(l2State.pendingL1Confirmation).toBe(true);
    });

    test('should handle concurrent optimistic batches', async () => {
      const concurrentBatches = 10;
      const txPerBatch = 50;
      
      const batches = Array(concurrentBatches).fill(null).map((_, batchIdx) => {
        return Array(txPerBatch).fill(null).map((_, txIdx) => ({
          id: `batch-${batchIdx}-tx-${txIdx}`,
          from: sequencer.address,
          to: validators[0].address,
          amount: ethers.parseEther('0.01'),
          nonce: batchIdx * txPerBatch + txIdx,
          timestamp: Date.now()
        }));
      });
      
      // Submit all batches concurrently
      const startTime = performance.now();
      const results = await Promise.all(
        batches.map(batch => hftChannel.submitOptimisticBatch(batch))
      );
      const totalTime = performance.now() - startTime;
      
      // All should succeed optimistically
      expect(results.every(r => r.optimisticConfirmation)).toBe(true);
      expect(results.map(r => r.batchId)).toHaveLength(concurrentBatches);
      
      // Check ordering is preserved
      const batchIds = results.map(r => parseInt(r.batchId.split('-')[1]));
      expect(batchIds).toEqual(expect.arrayContaining([...Array(concurrentBatches).keys()]));
      
      const throughput = (concurrentBatches * txPerBatch / totalTime) * 1000;
      console.log(`Optimistic Batch Performance:
        - Concurrent Batches: ${concurrentBatches}
        - Transactions per Batch: ${txPerBatch}
        - Total Time: ${totalTime.toFixed(2)}ms
        - Throughput: ${throughput.toFixed(2)} TPS
      `);
      
      expect(throughput).toBeGreaterThan(5000); // > 5000 TPS
    });
  });

  describe('L1 Data Availability', () => {
    test('should post compressed data to L1 efficiently', async () => {
      const batch = {
        transactions: Array(1000).fill(null).map((_, i) => ({
          id: `da-tx-${i}`,
          from: sequencer.address,
          to: validators[i % validators.length].address,
          amount: ethers.parseEther('0.001'),
          data: '0x' + Buffer.from(`data-${i}`).toString('hex')
        })),
        stateRoot: ethers.keccak256(ethers.toUtf8Bytes('test-state-root')),
        timestamp: Date.now()
      };
      
      // Compress batch data
      const compressed = await hftChannel.compressBatchData(batch);
      expect(compressed.compressionRatio).toBeGreaterThan(0.7);
      
      // Post to L1 (mock)
      const l1Submission = await hftChannel.postToL1DataAvailability(compressed);
      
      expect(l1Submission.transactionHash).toBeDefined();
      expect(l1Submission.calldata.length).toBeLessThan(batch.transactions.length * 200);
      expect(l1Submission.gasUsed).toBeLessThan(1000000); // < 1M gas
      expect(l1Submission.dataAvailabilityProof).toBeDefined();
      
      // Verify data can be reconstructed
      const reconstructed = await hftChannel.reconstructFromL1Data(
        l1Submission.dataAvailabilityProof
      );
      
      expect(reconstructed.transactions.length).toBe(batch.transactions.length);
      expect(reconstructed.stateRoot).toBe(batch.stateRoot);
    });

    test('should use calldata optimization techniques', async () => {
      // Test different encoding strategies
      const strategies = ['simple', 'packed', 'compressed', 'eip4844'];
      const testBatch = Array(100).fill(null).map((_, i) => ({
        to: validators[i % validators.length].address,
        amount: ethers.parseEther('1'),
        data: '0x'
      }));
      
      const results = await Promise.all(
        strategies.map(async strategy => {
          const encoded = await hftChannel.encodeBatchWithStrategy(testBatch, strategy);
          return {
            strategy,
            size: encoded.length,
            gasEstimate: await hftChannel.estimateL1Gas(encoded)
          };
        })
      );
      
      // Compare strategies
      results.sort((a, b) => a.size - b.size);
      console.log('Calldata Optimization Results:');
      results.forEach(r => {
        console.log(`  ${r.strategy}: ${r.size} bytes, ${r.gasEstimate} gas`);
      });
      
      // EIP-4844 should be most efficient when available
      const eip4844Result = results.find(r => r.strategy === 'eip4844');
      if (eip4844Result) {
        expect(eip4844Result.size).toBe(Math.min(...results.map(r => r.size)));
      }
    });
  });

  describe('Fraud Proof Challenge System', () => {
    test('should generate and verify fraud proofs', async () => {
      // Create valid state transition
      const validBatch = {
        preStateRoot: ethers.keccak256(ethers.toUtf8Bytes('pre-state')),
        postStateRoot: ethers.keccak256(ethers.toUtf8Bytes('post-state')),
        transactions: [{
          from: sequencer.address,
          to: validators[0].address,
          amount: ethers.parseEther('1'),
          nonce: 0
        }]
      };
      
      // Create invalid state transition
      const invalidBatch = {
        preStateRoot: validBatch.postStateRoot,
        postStateRoot: ethers.keccak256(ethers.toUtf8Bytes('invalid-state')),
        transactions: [{
          from: sequencer.address,
          to: validators[0].address,
          amount: ethers.parseEther('1000000'), // Invalid amount
          nonce: 1
        }]
      };
      
      // Submit batches
      await hftChannel.submitOptimisticBatch(validBatch.transactions);
      const invalidSubmission = await hftChannel.submitOptimisticBatch(
        invalidBatch.transactions
      );
      
      // Generate fraud proof
      const startTime = performance.now();
      const fraudProof = await hftChannel.generateFraudProof(
        invalidSubmission.batchId,
        {
          challenger: validators[0],
          invalidStateRoot: invalidBatch.postStateRoot,
          validStateRoot: validBatch.postStateRoot
        }
      );
      const proofTime = performance.now() - startTime;
      
      expect(fraudProof).toBeDefined();
      expect(fraudProof.type).toBe('INVALID_STATE_TRANSITION');
      expect(fraudProof.evidence.invalidTransaction).toBeDefined();
      expect(fraudProof.merkleProof).toBeDefined();
      expect(proofTime).toBeLessThan(1000); // < 1 second
      
      // Submit fraud proof to L1
      const challenge = await hftChannel.submitFraudProof(fraudProof, {
        bond: ethers.parseEther('1')
      });
      
      expect(challenge.accepted).toBe(true);
      expect(challenge.slashingAmount).toBeGreaterThan(0);
      expect(challenge.revertedBatchId).toBe(invalidSubmission.batchId);
    });

    test('should handle challenge period correctly', async () => {
      // Submit batch
      const batch = [{
        from: sequencer.address,
        to: validators[0].address,
        amount: ethers.parseEther('1'),
        nonce: 0
      }];
      
      const submission = await hftChannel.submitOptimisticBatch(batch);
      
      // Check initial status
      let status = await hftChannel.getBatchStatus(submission.batchId);
      expect(status.state).toBe('PENDING_CHALLENGE_PERIOD');
      expect(status.challengeDeadline).toBeGreaterThan(Date.now());
      
      // Simulate time passing (mock)
      await hftChannel.mockAdvanceTime(rollupProvider.challengePeriod + 1);
      
      // Check finalized status
      status = await hftChannel.getBatchStatus(submission.batchId);
      expect(status.state).toBe('FINALIZED');
      expect(status.l1Confirmed).toBe(true);
      
      // Should not be challengeable after period
      await expect(
        hftChannel.submitFraudProof({
          batchId: submission.batchId,
          // ... fraud proof data
        })
      ).rejects.toThrow('Challenge period expired');
    });
  });

  describe('Rollup State Synchronization', () => {
    test('should sync L2 state with L1 efficiently', async () => {
      const syncIntervals = 10;
      const txPerInterval = 100;
      
      for (let i = 0; i < syncIntervals; i++) {
        // Submit L2 transactions
        const l2Txs = Array(txPerInterval).fill(null).map((_, j) => ({
          id: `sync-tx-${i}-${j}`,
          from: sequencer.address,
          to: validators[j % validators.length].address,
          amount: ethers.parseEther('0.01'),
          timestamp: Date.now()
        }));
        
        await hftChannel.submitOptimisticBatch(l2Txs);
        
        // Periodic L1 sync
        if (i % 3 === 0) {
          const syncStart = performance.now();
          const syncResult = await hftChannel.syncToL1();
          const syncTime = performance.now() - syncStart;
          
          expect(syncResult.batchesSynced).toBeGreaterThan(0);
          expect(syncResult.stateRoot).toBeDefined();
          expect(syncResult.l1TransactionHash).toBeDefined();
          expect(syncTime).toBeLessThan(5000); // < 5 seconds
          
          console.log(`L1 Sync #${i/3}: ${syncResult.batchesSynced} batches in ${syncTime.toFixed(0)}ms`);
        }
      }
      
      // Final state verification
      const l1State = await hftChannel.getL1State();
      const l2State = await hftChannel.getL2State();
      
      expect(l2State.totalTransactions).toBe(syncIntervals * txPerInterval);
      expect(l1State.lastSyncedBatch).toBeDefined();
      expect(l1State.syncLag).toBeLessThan(3); // Max 3 batches behind
    });

    test('should handle L1 reorgs gracefully', async () => {
      // Submit batches
      const batches = [];
      for (let i = 0; i < 5; i++) {
        const result = await hftChannel.submitOptimisticBatch([{
          from: sequencer.address,
          to: validators[0].address,
          amount: ethers.parseEther('1'),
          nonce: i
        }]);
        batches.push(result);
        
        // Sync to L1
        await hftChannel.syncToL1();
      }
      
      // Simulate L1 reorg
      const reorgDepth = 2;
      const reorgEvent = {
        type: 'REORG',
        depth: reorgDepth,
        newHead: ethers.keccak256(ethers.toUtf8Bytes('new-head')),
        oldHead: ethers.keccak256(ethers.toUtf8Bytes('old-head'))
      };
      
      await hftChannel.handleL1Reorg(reorgEvent);
      
      // Check rollback
      const status = await hftChannel.getReorgStatus();
      expect(status.rolledBackBatches).toBe(reorgDepth);
      expect(status.resyncRequired).toBe(true);
      
      // Verify affected batches are marked for resubmission
      for (let i = batches.length - reorgDepth; i < batches.length; i++) {
        const batchStatus = await hftChannel.getBatchStatus(batches[i].batchId);
        expect(batchStatus.state).toBe('PENDING_RESUBMISSION');
      }
      
      // Automatic recovery
      await hftChannel.recoverFromReorg();
      
      const recoveryStatus = await hftChannel.getReorgStatus();
      expect(recoveryStatus.recovered).toBe(true);
      expect(recoveryStatus.resubmittedBatches).toBe(reorgDepth);
    });
  });

  describe('Cross-Layer Communication', () => {
    test('should handle L1 <-> L2 message passing efficiently', async () => {
      // L2 -> L1 message
      const l2ToL1Message = {
        target: '0x742d35Cc6634C0532925a3b844Bc9e7595f2BD6e',
        data: ethers.hexlify(ethers.randomBytes(100)),
        value: ethers.parseEther('0'),
        gasLimit: 100000
      };
      
      const l2Result = await hftChannel.sendMessageToL1(l2ToL1Message);
      expect(l2Result.messageId).toBeDefined();
      expect(l2Result.inclusionDelay).toBeLessThan(300000); // < 5 minutes
      
      // L1 -> L2 message
      const l1ToL2Message = {
        target: validators[0].address,
        data: ethers.hexlify(ethers.randomBytes(50)),
        value: ethers.parseEther('1'),
        gasLimit: 50000
      };
      
      const l1Result = await hftChannel.sendMessageToL2(l1ToL2Message);
      expect(l1Result.messageId).toBeDefined();
      expect(l1Result.executionDelay).toBeLessThan(60000); // < 1 minute
      
      // Wait for message execution
      const l2Execution = await hftChannel.waitForL2Execution(l1Result.messageId);
      expect(l2Execution.success).toBe(true);
      expect(l2Execution.gasUsed).toBeLessThan(l1ToL2Message.gasLimit);
    });

    test('should batch cross-layer messages for efficiency', async () => {
      const messageCount = 50;
      const messages = Array(messageCount).fill(null).map((_, i) => ({
        target: validators[i % validators.length].address,
        data: ethers.hexlify(ethers.randomBytes(20)),
        value: ethers.parseEther('0.01')
      }));
      
      // Send messages in batch
      const batchResult = await hftChannel.batchSendToL1(messages);
      
      expect(batchResult.messageIds).toHaveLength(messageCount);
      expect(batchResult.merkleRoot).toBeDefined();
      expect(batchResult.totalGasCost).toBeLessThan(
        messageCount * 50000 // Less than individual sends
      );
      
      // Verify batch inclusion proof
      const proofForMessage = await hftChannel.getInclusionProof(
        batchResult.messageIds[0],
        batchResult.merkleRoot
      );
      
      expect(proofForMessage.valid).toBe(true);
      expect(proofForMessage.proof.length).toBeGreaterThan(0);
    });
  });
});