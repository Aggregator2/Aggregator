import { StateManager, DisputeManager, MultiPartyChannel } from './mocks/StateChannelMocks';
import { ethers } from 'ethers';
import { performance } from 'perf_hooks';

describe('State Channel Performance Under High Load', () => {
  let stateManager: StateManager;
  let disputeManager: DisputeManager;
  let multiPartyChannel: MultiPartyChannel;
  let participants: ethers.Wallet[];
  let channelId: string;

  beforeEach(async () => {
    // Create multiple participants
    participants = Array(10).fill(null).map(() => ethers.Wallet.createRandom());
    channelId = `perf-channel-${Date.now()}`;
    
    // Initialize components
    stateManager = new StateManager(channelId);
    disputeManager = new DisputeManager(channelId);
    multiPartyChannel = new MultiPartyChannel(
      channelId,
      participants.map(p => p.address),
      {
        threshold: Math.floor(participants.length * 0.67), // 2/3 consensus
        timeout: 30000,
        maxStateSize: 10000
      }
    );
  });

  describe('High-Frequency State Updates', () => {
    test('should handle rapid state transitions efficiently', async () => {
      const updateCount = 10000;
      const updates = [];
      const startTime = performance.now();
      
      for (let i = 0; i < updateCount; i++) {
        const update = {
          nonce: i,
          balances: participants.reduce((acc, p) => {
            acc[p.address] = ethers.parseEther((Math.random() * 100).toString());
            return acc;
          }, {} as Record<string, bigint>),
          timestamp: Date.now(),
          data: { 
            tradeId: `trade-${i}`,
            metadata: `update-${i}`
          }
        };
        
        updates.push(stateManager.proposeUpdate(update));
      }
      
      await Promise.all(updates);
      const totalTime = performance.now() - startTime;
      
      const updatesPerSecond = (updateCount / totalTime) * 1000;
      console.log(`State Update Performance:
        - Total Updates: ${updateCount}
        - Total Time: ${totalTime.toFixed(2)}ms
        - Updates/Second: ${updatesPerSecond.toFixed(2)}
        - Avg Time/Update: ${(totalTime / updateCount).toFixed(3)}ms
      `);
      
      expect(updatesPerSecond).toBeGreaterThan(5000); // > 5000 updates/sec
      expect(stateManager.getCurrentNonce()).toBe(updateCount - 1);
    });

    test('should maintain consistency under concurrent updates', async () => {
      const concurrentUpdates = 100;
      const updatesPerBatch = 100;
      
      const batches = Array(concurrentUpdates).fill(null).map((_, batchIdx) => {
        return Array(updatesPerBatch).fill(null).map((_, updateIdx) => {
          const globalIdx = batchIdx * updatesPerBatch + updateIdx;
          return {
            nonce: globalIdx,
            balances: participants.reduce((acc, p) => {
              acc[p.address] = ethers.parseEther('10');
              return acc;
            }, {} as Record<string, bigint>),
            timestamp: Date.now(),
            data: { batchIdx, updateIdx }
          };
        });
      });
      
      // Submit all batches concurrently
      const results = await Promise.all(
        batches.map(batch => 
          Promise.all(batch.map(update => stateManager.proposeUpdate(update)))
        )
      );
      
      // Verify consistency
      const finalState = stateManager.getCurrentState();
      expect(finalState.nonce).toBe(concurrentUpdates * updatesPerBatch - 1);
      
      // Verify state history integrity
      const history = stateManager.getStateHistory();
      expect(history.length).toBe(concurrentUpdates * updatesPerBatch);
      
      // Check for any missing or duplicate nonces
      const nonces = new Set(history.map(s => s.nonce));
      expect(nonces.size).toBe(history.length);
    });
  });

  describe('Multi-Party Consensus Performance', () => {
    test('should achieve consensus quickly with many participants', async () => {
      const proposalCount = 100;
      const consensusTimes: number[] = [];
      
      for (let i = 0; i < proposalCount; i++) {
        const proposal = {
          id: `proposal-${i}`,
          type: 'STATE_UPDATE',
          data: {
            nonce: i,
            balances: participants.reduce((acc, p) => {
              acc[p.address] = ethers.parseEther((Math.random() * 10).toString());
              return acc;
            }, {} as Record<string, bigint>)
          }
        };
        
        const startTime = performance.now();
        
        // Submit proposal
        await multiPartyChannel.submitProposal(proposal);
        
        // Simulate voting from required participants
        const votingParticipants = participants.slice(0, Math.ceil(participants.length * 0.67));
        await Promise.all(
          votingParticipants.map(p => 
            multiPartyChannel.vote(proposal.id, true, p)
          )
        );
        
        // Wait for consensus
        const result = await multiPartyChannel.waitForConsensus(proposal.id);
        const consensusTime = performance.now() - startTime;
        
        consensusTimes.push(consensusTime);
        expect(result.approved).toBe(true);
        expect(result.votes).toBeGreaterThanOrEqual(votingParticipants.length);
      }
      
      const avgConsensusTime = consensusTimes.reduce((a, b) => a + b) / consensusTimes.length;
      const maxConsensusTime = Math.max(...consensusTimes);
      
      console.log(`Multi-Party Consensus Performance:
        - Participants: ${participants.length}
        - Proposals: ${proposalCount}
        - Avg Consensus Time: ${avgConsensusTime.toFixed(2)}ms
        - Max Consensus Time: ${maxConsensusTime.toFixed(2)}ms
        - Consensus/Second: ${(1000 / avgConsensusTime).toFixed(2)}
      `);
      
      expect(avgConsensusTime).toBeLessThan(100); // < 100ms average
      expect(maxConsensusTime).toBeLessThan(500); // < 500ms worst case
    });

    test('should handle Byzantine participants efficiently', async () => {
      const byzantineCount = Math.floor(participants.length * 0.3); // 30% Byzantine
      const byzantineParticipants = participants.slice(0, byzantineCount);
      const honestParticipants = participants.slice(byzantineCount);
      
      const proposal = {
        id: 'byzantine-test',
        type: 'STATE_UPDATE',
        data: {
          nonce: 1,
          balances: {}
        }
      };
      
      await multiPartyChannel.submitProposal(proposal);
      
      // Byzantine participants vote against
      await Promise.all(
        byzantineParticipants.map(p => 
          multiPartyChannel.vote(proposal.id, false, p)
        )
      );
      
      // Honest participants vote for
      await Promise.all(
        honestParticipants.map(p => 
          multiPartyChannel.vote(proposal.id, true, p)
        )
      );
      
      const result = await multiPartyChannel.waitForConsensus(proposal.id);
      
      // Should still achieve consensus with honest majority
      expect(result.approved).toBe(true);
      expect(result.votes).toBeGreaterThanOrEqual(honestParticipants.length);
      expect(result.byzantineDetected).toBe(true);
      expect(result.byzantineParticipants).toEqual(
        expect.arrayContaining(byzantineParticipants.map(p => p.address))
      );
    });
  });

  describe('State Channel Cryptographic Operations', () => {
    test('should perform signature aggregation efficiently', async () => {
      const messageCount = 1000;
      const messages = Array(messageCount).fill(null).map((_, i) => 
        ethers.keccak256(ethers.toUtf8Bytes(`message-${i}`))
      );
      
      const startTime = performance.now();
      
      // Generate signatures from all participants
      const allSignatures = await Promise.all(
        messages.map(async message => {
          const sigs = await Promise.all(
            participants.map(p => p.signMessage(message))
          );
          return { message, signatures: sigs };
        })
      );
      
      // Aggregate signatures
      const aggregated = await Promise.all(
        allSignatures.map(({ message, signatures }) => 
          stateManager.aggregateSignatures(message, signatures)
        )
      );
      
      const totalTime = performance.now() - startTime;
      
      const opsPerSecond = (messageCount / totalTime) * 1000;
      console.log(`Signature Aggregation Performance:
        - Messages: ${messageCount}
        - Participants: ${participants.length}
        - Total Time: ${totalTime.toFixed(2)}ms
        - Aggregations/Second: ${opsPerSecond.toFixed(2)}
        - Avg Time/Aggregation: ${(totalTime / messageCount).toFixed(3)}ms
      `);
      
      expect(opsPerSecond).toBeGreaterThan(100); // > 100 aggregations/sec
      expect(aggregated.every(a => a.valid)).toBe(true);
    });

    test('should verify state roots efficiently', async () => {
      const stateCount = 10000;
      const states = [];
      
      // Generate states with merkle proofs
      for (let i = 0; i < stateCount; i++) {
        const state = {
          nonce: i,
          balances: participants.reduce((acc, p) => {
            acc[p.address] = ethers.parseEther((Math.random() * 100).toString());
            return acc;
          }, {} as Record<string, bigint>),
          timestamp: Date.now()
        };
        
        const stateRoot = await stateManager.calculateStateRoot(state);
        states.push({ state, stateRoot });
      }
      
      // Verify all state roots
      const startTime = performance.now();
      
      const verifications = await Promise.all(
        states.map(({ state, stateRoot }) => 
          stateManager.verifyStateRoot(state, stateRoot)
        )
      );
      
      const totalTime = performance.now() - startTime;
      
      const verificationsPerSecond = (stateCount / totalTime) * 1000;
      console.log(`State Root Verification Performance:
        - States: ${stateCount}
        - Total Time: ${totalTime.toFixed(2)}ms
        - Verifications/Second: ${verificationsPerSecond.toFixed(2)}
        - Avg Time/Verification: ${(totalTime / stateCount).toFixed(3)}ms
      `);
      
      expect(verificationsPerSecond).toBeGreaterThan(5000); // > 5000 verifications/sec
      expect(verifications.every(v => v)).toBe(true);
    });
  });

  describe('Dispute Resolution Performance', () => {
    test('should handle fraud proof generation efficiently', async () => {
      // Create invalid state transition
      const validState = {
        nonce: 100,
        balances: participants.reduce((acc, p) => {
          acc[p.address] = ethers.parseEther('100');
          return acc;
        }, {} as Record<string, bigint>),
        timestamp: Date.now()
      };
      
      const invalidState = {
        nonce: 101,
        balances: participants.reduce((acc, p) => {
          acc[p.address] = ethers.parseEther('200'); // Invalid: creates money
          return acc;
        }, {} as Record<string, bigint>),
        timestamp: Date.now() + 1000
      };
      
      const startTime = performance.now();
      
      // Generate fraud proof
      const fraudProof = await disputeManager.generateFraudProof(
        validState,
        invalidState,
        'INVALID_BALANCE_TRANSITION'
      );
      
      const generationTime = performance.now() - startTime;
      
      expect(fraudProof).toBeDefined();
      expect(fraudProof.type).toBe('INVALID_BALANCE_TRANSITION');
      expect(fraudProof.evidence).toBeDefined();
      expect(fraudProof.merkleProof).toBeDefined();
      expect(generationTime).toBeLessThan(100); // < 100ms
      
      // Verify fraud proof
      const verifyStart = performance.now();
      const isValid = await disputeManager.verifyFraudProof(fraudProof);
      const verifyTime = performance.now() - verifyStart;
      
      expect(isValid).toBe(true);
      expect(verifyTime).toBeLessThan(50); // < 50ms to verify
    });

    test('should resolve disputes quickly under load', async () => {
      const disputeCount = 100;
      const disputes = [];
      
      // Create multiple concurrent disputes
      for (let i = 0; i < disputeCount; i++) {
        const dispute = {
          id: `dispute-${i}`,
          channelId,
          disputedState: {
            nonce: i,
            balances: {},
            timestamp: Date.now()
          },
          challenger: participants[i % participants.length].address,
          reason: 'INVALID_SIGNATURE'
        };
        
        disputes.push(dispute);
      }
      
      const startTime = performance.now();
      
      // Submit all disputes
      const submissions = await Promise.all(
        disputes.map(d => disputeManager.submitDispute(d))
      );
      
      // Resolve all disputes
      const resolutions = await Promise.all(
        submissions.map(s => disputeManager.resolveDispute(s.disputeId))
      );
      
      const totalTime = performance.now() - startTime;
      
      const disputesPerSecond = (disputeCount / totalTime) * 1000;
      console.log(`Dispute Resolution Performance:
        - Disputes: ${disputeCount}
        - Total Time: ${totalTime.toFixed(2)}ms
        - Disputes/Second: ${disputesPerSecond.toFixed(2)}
        - Avg Resolution Time: ${(totalTime / disputeCount).toFixed(3)}ms
      `);
      
      expect(disputesPerSecond).toBeGreaterThan(50); // > 50 disputes/sec
      expect(resolutions.every(r => r.resolved)).toBe(true);
    });
  });

  describe('State Channel Memory Management', () => {
    test('should handle large state sizes efficiently', async () => {
      const largeDataSize = 1000000; // 1MB of data per state
      const stateCount = 100;
      
      const memoryBefore = process.memoryUsage().heapUsed;
      const states = [];
      
      for (let i = 0; i < stateCount; i++) {
        const largeState = {
          nonce: i,
          balances: participants.reduce((acc, p) => {
            acc[p.address] = ethers.parseEther('100');
            return acc;
          }, {} as Record<string, bigint>),
          data: Buffer.alloc(largeDataSize).toString('hex'), // Large data
          timestamp: Date.now()
        };
        
        await stateManager.proposeUpdate(largeState);
        states.push(largeState);
      }
      
      const memoryAfter = process.memoryUsage().heapUsed;
      const memoryUsed = (memoryAfter - memoryBefore) / 1024 / 1024; // MB
      
      console.log(`Memory Management Performance:
        - States: ${stateCount}
        - Data per State: ${(largeDataSize / 1024).toFixed(2)}KB
        - Total Data: ${(stateCount * largeDataSize / 1024 / 1024).toFixed(2)}MB
        - Memory Used: ${memoryUsed.toFixed(2)}MB
        - Memory Efficiency: ${((stateCount * largeDataSize / 1024 / 1024) / memoryUsed * 100).toFixed(2)}%
      `);
      
      // Should use less memory than raw data size (compression/optimization)
      expect(memoryUsed).toBeLessThan(stateCount * largeDataSize / 1024 / 1024);
      
      // Test state pruning
      await stateManager.pruneOldStates(50); // Keep only last 50 states
      
      const memoryAfterPrune = process.memoryUsage().heapUsed;
      const memoryFreed = (memoryAfter - memoryAfterPrune) / 1024 / 1024;
      
      expect(memoryFreed).toBeGreaterThan(0);
      expect(stateManager.getStateHistory().length).toBe(50);
    });

    test('should handle state compression effectively', async () => {
      const uncompressedStates = [];
      const compressedStates = [];
      
      for (let i = 0; i < 1000; i++) {
        const state = {
          nonce: i,
          balances: participants.reduce((acc, p) => {
            // Repetitive data that compresses well
            acc[p.address] = ethers.parseEther('100.123456789');
            return acc;
          }, {} as Record<string, bigint>),
          metadata: Array(100).fill('repetitive-data').join('-'),
          timestamp: Date.now()
        };
        
        uncompressedStates.push(JSON.stringify(state).length);
        
        const compressed = await stateManager.compressState(state);
        compressedStates.push(compressed.length);
      }
      
      const avgUncompressed = uncompressedStates.reduce((a, b) => a + b) / uncompressedStates.length;
      const avgCompressed = compressedStates.reduce((a, b) => a + b) / compressedStates.length;
      const compressionRatio = (1 - avgCompressed / avgUncompressed) * 100;
      
      console.log(`State Compression Performance:
        - Avg Uncompressed Size: ${avgUncompressed.toFixed(0)} bytes
        - Avg Compressed Size: ${avgCompressed.toFixed(0)} bytes
        - Compression Ratio: ${compressionRatio.toFixed(2)}%
      `);
      
      expect(compressionRatio).toBeGreaterThan(50); // > 50% compression
    });
  });
});