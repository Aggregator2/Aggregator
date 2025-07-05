import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { StateManager } from "../../../src/stateChannels/StateManager";
import { DisputeManager } from "../../../src/stateChannels/DisputeManager";
import { InstantFinalityEngine } from "../../../src/stateChannels/InstantFinality";
import { HFTOptimizedInstantFinality } from "../../../src/stateChannels/HFTOptimizedInstantFinality";

describe("Security and Fraud Proof Tests", function () {
  let stateManager: StateManager;
  let disputeManager: DisputeManager;
  let instantFinality: InstantFinalityEngine;
  let hftFinality: HFTOptimizedInstantFinality;
  
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let carol: HardhatEthersSigner;
  let attacker: HardhatEthersSigner;
  
  let provider: ethers.Provider;

  beforeEach(async function () {
    [alice, bob, carol, attacker] = await ethers.getSigners();
    provider = ethers.provider;
    
    stateManager = new StateManager();
    disputeManager = new DisputeManager(stateManager, provider, 3600);
    
    instantFinality = new InstantFinalityEngine(stateManager, {
      requiredSignatures: 2,
      challengePeriod: 3600,
      maxTradeValue: ethers.parseEther("10000"),
      requireInstantFinality: true
    });
    
    hftFinality = new HFTOptimizedInstantFinality(stateManager, {
      requiredSignatures: 2,
      challengePeriod: 3600,
      maxTradeValue: ethers.parseEther("10000"),
      requireInstantFinality: true,
      enableParallelExecution: true,
      batchProcessingInterval: 100,
      maxBatchSize: 50,
      enableOptimisticExecution: true,
      memoryPoolSize: 1000,
      signatureCacheSize: 10000,
      enableZeroConfirmation: false // Disable for security tests
    });
  });

  describe("Fraud Proof Generation and Verification", function () {
    let channelId: string;
    
    beforeEach(async function () {
      channelId = "channel-fraud-001";
      await stateManager.createChannel(
        channelId,
        [alice.address, bob.address],
        new Map([
          [alice.address, ethers.parseEther("100")],
          [bob.address, ethers.parseEther("100")]
        ])
      );
    });

    it("Should generate fraud proof for balance violation", async function () {
      const validState = stateManager.getState(channelId);
      
      // Create invalid state that violates balance conservation
      const invalidState = {
        channelId,
        participants: [alice.address, bob.address],
        balances: new Map([
          [alice.address, ethers.parseEther("120")], // More than deposited
          [bob.address, ethers.parseEther("100")]
        ]),
        nonce: validState.nonce + 1,
        timestamp: Date.now(),
        signatures: new Map(),
        status: "Active",
        totalCollateral: ethers.parseEther("200")
      };
      
      const fraudProof = await stateManager.generateFraudProof(validState, invalidState);
      
      expect(fraudProof.type).to.equal("BalanceViolation");
      expect(fraudProof.proof).to.include("Total balance exceeds collateral");
      expect(fraudProof.evidence.totalClaimed).to.equal(ethers.parseEther("220"));
      expect(fraudProof.evidence.totalAvailable).to.equal(ethers.parseEther("200"));
    });

    it("Should detect negative balance fraud", async function () {
      // Execute a valid trade first
      const trade = await instantFinality.initiateInstantTrade(
        channelId,
        alice.address,
        bob.address,
        ethers.parseEther("50"),
        alice
      );
      await instantFinality.confirmTrade(trade.id, bob);
      
      const validState = stateManager.getState(channelId);
      
      // Create state with negative balance
      const invalidState = {
        channelId,
        participants: [alice.address, bob.address],
        balances: new Map([
          [alice.address, ethers.parseEther("-10")], // Negative balance
          [bob.address, ethers.parseEther("210")]
        ]),
        nonce: validState.nonce + 1,
        timestamp: Date.now(),
        signatures: new Map(),
        status: "Active",
        totalCollateral: ethers.parseEther("200")
      };
      
      const fraudProof = await stateManager.generateFraudProof(validState, invalidState);
      
      expect(fraudProof.type).to.equal("NegativeBalance");
      expect(fraudProof.proof).to.include("Negative balance detected");
      expect(fraudProof.evidence.participant).to.equal(alice.address);
    });

    it("Should detect invalid nonce progression", async function () {
      const currentState = stateManager.getState(channelId);
      
      // Create state with invalid nonce (skipping nonces)
      const invalidState = {
        ...currentState,
        nonce: currentState.nonce + 5, // Skipping 4 nonces
        timestamp: Date.now()
      };
      
      const fraudProof = await stateManager.generateFraudProof(currentState, invalidState);
      
      expect(fraudProof.type).to.equal("InvalidNonce");
      expect(fraudProof.proof).to.include("Invalid nonce progression");
      expect(fraudProof.evidence.expectedNonce).to.equal(currentState.nonce + 1);
      expect(fraudProof.evidence.providedNonce).to.equal(currentState.nonce + 5);
    });

    it("Should detect unauthorized state transition", async function () {
      const validState = stateManager.getState(channelId);
      
      // Attacker creates unauthorized state transition
      const unauthorizedState = {
        channelId,
        participants: [alice.address, bob.address],
        balances: new Map([
          [alice.address, ethers.parseEther("20")],
          [bob.address, ethers.parseEther("180")]
        ]),
        nonce: validState.nonce + 1,
        timestamp: Date.now(),
        signatures: new Map([
          [attacker.address, "0xfake-signature"] // Attacker's signature
        ]),
        status: "Active",
        totalCollateral: ethers.parseEther("200")
      };
      
      const fraudProof = await stateManager.generateFraudProof(validState, unauthorizedState);
      
      expect(fraudProof.type).to.equal("UnauthorizedTransition");
      expect(fraudProof.proof).to.include("Missing required signatures");
      expect(fraudProof.evidence.requiredSigners).to.deep.equal([alice.address, bob.address]);
      expect(fraudProof.evidence.providedSigners).to.deep.equal([attacker.address]);
    });

    it("Should verify merkle proof for state transitions", async function () {
      // Execute multiple trades to build state history
      const trades = [];
      for (let i = 0; i < 10; i++) {
        const trade = await instantFinality.initiateInstantTrade(
          channelId,
          i % 2 === 0 ? alice.address : bob.address,
          i % 2 === 0 ? bob.address : alice.address,
          ethers.parseEther("5"),
          i % 2 === 0 ? alice : bob
        );
        await instantFinality.confirmTrade(trade.id, i % 2 === 0 ? bob : alice);
        trades.push(trade);
      }
      
      // Generate merkle tree of state transitions
      const stateHistory = await stateManager.getStateHistory(channelId);
      const merkleTree = stateManager.generateMerkleTree(stateHistory);
      
      // Verify specific state transition
      const targetIndex = 5;
      const targetState = stateHistory[targetIndex];
      const proof = merkleTree.getProof(targetIndex);
      
      const isValid = merkleTree.verifyProof(
        targetState,
        proof,
        merkleTree.getRoot()
      );
      
      expect(isValid).to.be.true;
      
      // Tamper with state and verify proof fails
      const tamperedState = {
        ...targetState,
        balances: new Map([
          [alice.address, ethers.parseEther("0")],
          [bob.address, ethers.parseEther("200")]
        ])
      };
      
      const isInvalid = merkleTree.verifyProof(
        tamperedState,
        proof,
        merkleTree.getRoot()
      );
      
      expect(isInvalid).to.be.false;
    });
  });

  describe("Double-Spend Prevention", function () {
    let channelId: string;
    
    beforeEach(async function () {
      channelId = "channel-double-spend-001";
      await stateManager.createChannel(
        channelId,
        [alice.address, bob.address],
        new Map([
          [alice.address, ethers.parseEther("100")],
          [bob.address, ethers.parseEther("100")]
        ])
      );
    });

    it("Should prevent concurrent double-spending", async function () {
      // Alice tries to spend same funds twice concurrently
      const amount = ethers.parseEther("60");
      
      const promise1 = instantFinality.initiateInstantTrade(
        channelId,
        alice.address,
        bob.address,
        amount,
        alice
      );
      
      const promise2 = instantFinality.initiateInstantTrade(
        channelId,
        alice.address,
        bob.address,
        amount,
        alice
      );
      
      // One should succeed, one should fail
      const results = await Promise.allSettled([promise1, promise2]);
      
      const successes = results.filter(r => r.status === 'fulfilled');
      const failures = results.filter(r => r.status === 'rejected');
      
      expect(successes.length).to.equal(1);
      expect(failures.length).to.equal(1);
      
      if (failures[0].status === 'rejected') {
        expect(failures[0].reason.message).to.include("Insufficient balance");
      }
    });

    it("Should prevent replay attacks with old states", async function () {
      // Execute some trades
      const trade1 = await instantFinality.initiateInstantTrade(
        channelId,
        alice.address,
        bob.address,
        ethers.parseEther("30"),
        alice
      );
      await instantFinality.confirmTrade(trade1.id, bob);
      
      const oldState = stateManager.getState(channelId);
      
      // Execute more trades
      const trade2 = await instantFinality.initiateInstantTrade(
        channelId,
        bob.address,
        alice.address,
        ethers.parseEther("20"),
        bob
      );
      await instantFinality.confirmTrade(trade2.id, alice);
      
      // Try to replay old state
      const message = stateManager.encodeState(oldState);
      const aliceSignature = await alice.signMessage(message);
      const bobSignature = await bob.signMessage(message);
      
      oldState.signatures.set(alice.address, aliceSignature);
      oldState.signatures.set(bob.address, bobSignature);
      
      await expect(
        disputeManager.initiateDispute(channelId, alice.address, {
          state: oldState,
          signatures: [aliceSignature, bobSignature]
        })
      ).to.be.revertedWith("Challenged state nonce must be higher");
    });

    it("Should detect and prevent race condition attacks", async function () {
      // Simulate race condition where Alice tries to:
      // 1. Send funds to Bob
      // 2. Withdraw funds before Bob can claim
      
      const sendAmount = ethers.parseEther("50");
      
      // Start trade
      const trade = await instantFinality.initiateInstantTrade(
        channelId,
        alice.address,
        bob.address,
        sendAmount,
        alice
      );
      
      // Alice tries to withdraw before trade confirmation
      await expect(
        stateManager.requestWithdrawal(
          channelId,
          alice.address,
          ethers.parseEther("60") // Would leave insufficient funds
        )
      ).to.be.revertedWith("Pending trades must be resolved first");
      
      // Complete the trade
      await instantFinality.confirmTrade(trade.id, bob);
      
      // Now Alice can only withdraw remaining balance
      const aliceBalance = stateManager.getState(channelId).balances.get(alice.address);
      expect(aliceBalance).to.equal(ethers.parseEther("50"));
    });

    it("Should prevent balance manipulation through state updates", async function () {
      const validState = stateManager.getState(channelId);
      
      // Attacker tries to manipulate balances
      const manipulatedState = {
        ...validState,
        balances: new Map([
          [alice.address, ethers.parseEther("150")], // Increased balance
          [bob.address, ethers.parseEther("50")]     // Decreased balance
        ]),
        nonce: validState.nonce + 1
      };
      
      // Even with valid signatures, should detect fraud
      const message = stateManager.encodeState(manipulatedState);
      const aliceSignature = await alice.signMessage(message);
      const bobSignature = await bob.signMessage(message);
      
      manipulatedState.signatures.set(alice.address, aliceSignature);
      manipulatedState.signatures.set(bob.address, bobSignature);
      
      const fraudProof = await stateManager.generateFraudProof(
        validState,
        manipulatedState
      );
      
      expect(fraudProof.type).to.equal("BalanceManipulation");
      expect(fraudProof.evidence.aliceGain).to.equal(ethers.parseEther("50"));
      expect(fraudProof.evidence.bobLoss).to.equal(ethers.parseEther("50"));
    });
  });

  describe("Signature Forgery Prevention", function () {
    let channelId: string;
    
    beforeEach(async function () {
      channelId = "channel-forgery-001";
      await stateManager.createChannel(
        channelId,
        [alice.address, bob.address],
        new Map([
          [alice.address, ethers.parseEther("100")],
          [bob.address, ethers.parseEther("100")]
        ])
      );
    });

    it("Should reject forged signatures", async function () {
      const state = stateManager.getState(channelId);
      const newState = {
        ...state,
        balances: new Map([
          [alice.address, ethers.parseEther("50")],
          [bob.address, ethers.parseEther("150")]
        ]),
        nonce: state.nonce + 1
      };
      
      // Attacker tries to forge signatures
      const message = stateManager.encodeState(newState);
      const attackerSignature = await attacker.signMessage(message);
      
      newState.signatures.set(alice.address, attackerSignature); // Forged
      newState.signatures.set(bob.address, attackerSignature);   // Forged
      
      const isValid = await stateManager.verifyStateSignatures(
        channelId,
        newState,
        [alice.address, bob.address]
      );
      
      expect(isValid).to.be.false;
    });

    it("Should detect signature malleability attacks", async function () {
      const trade = await instantFinality.initiateInstantTrade(
        channelId,
        alice.address,
        bob.address,
        ethers.parseEther("25"),
        alice
      );
      
      // Get Alice's signature
      const aliceSignature = trade.finalityProof.signatures.get(alice.address);
      const sig = ethers.Signature.from(aliceSignature);
      
      // Create malleable signature
      const n = BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");
      const malleableS = n - BigInt(sig.s);
      const malleableSignature = ethers.Signature.from({
        r: sig.r,
        s: malleableS.toString(),
        v: sig.v === 27 ? 28 : 27
      }).serialized;
      
      // Replace with malleable signature
      trade.finalityProof.signatures.set(alice.address, malleableSignature);
      
      // Should still verify correctly (both signatures valid)
      const message = instantFinality['createTradeMessage'](trade);
      const recovered = ethers.verifyMessage(
        message,
        malleableSignature
      );
      
      expect(recovered.toLowerCase()).to.equal(alice.address.toLowerCase());
      
      // But system should normalize signatures to prevent issues
      const normalized = stateManager.normalizeSignature(malleableSignature);
      expect(normalized).to.not.equal(malleableSignature);
    });

    it("Should prevent signature substitution attacks", async function () {
      // Alice signs a different message
      const differentMessage = "Transfer 100 ETH to attacker";
      const aliceSignature = await alice.signMessage(differentMessage);
      
      // Attacker tries to use this signature for state update
      const state = stateManager.getState(channelId);
      const maliciousState = {
        ...state,
        balances: new Map([
          [alice.address, ethers.parseEther("0")],
          [bob.address, ethers.parseEther("200")]
        ]),
        nonce: state.nonce + 1,
        signatures: new Map([
          [alice.address, aliceSignature], // Wrong signature
          [bob.address, "0xfake"]
        ])
      };
      
      const isValid = await stateManager.verifyStateSignatures(
        channelId,
        maliciousState,
        [alice.address, bob.address]
      );
      
      expect(isValid).to.be.false;
    });
  });

  describe("Channel Manipulation Attack Prevention", function () {
    it("Should prevent unauthorized channel creation", async function () {
      // Attacker tries to create channel with other's funds
      const maliciousChannelId = "channel-malicious-001";
      
      await expect(
        stateManager.createChannel(
          maliciousChannelId,
          [alice.address, bob.address],
          new Map([
            [alice.address, ethers.parseEther("1000")], // Claiming Alice has 1000
            [bob.address, ethers.parseEther("1000")]   // Claiming Bob has 1000
          ]),
          attacker // Unauthorized creator
        )
      ).to.be.revertedWith("Unauthorized channel creation");
    });

    it("Should prevent channel state injection", async function () {
      const channelId = "channel-injection-001";
      await stateManager.createChannel(
        channelId,
        [alice.address, bob.address],
        new Map([
          [alice.address, ethers.parseEther("100")],
          [bob.address, ethers.parseEther("100")]
        ])
      );
      
      // Attacker tries to inject false state
      const injectedState = {
        channelId,
        participants: [alice.address, attacker.address], // Changed participants
        balances: new Map([
          [alice.address, ethers.parseEther("50")],
          [attacker.address, ethers.parseEther("150")]
        ]),
        nonce: 100,
        timestamp: Date.now(),
        signatures: new Map(),
        status: "Active",
        totalCollateral: ethers.parseEther("200")
      };
      
      await expect(
        stateManager.updateState(channelId, injectedState)
      ).to.be.revertedWith("Invalid participants");
    });

    it("Should prevent forced channel closure attacks", async function () {
      const channelId = "channel-closure-001";
      await stateManager.createChannel(
        channelId,
        [alice.address, bob.address],
        new Map([
          [alice.address, ethers.parseEther("100")],
          [bob.address, ethers.parseEther("100")]
        ])
      );
      
      // Execute some trades
      const trade = await instantFinality.initiateInstantTrade(
        channelId,
        alice.address,
        bob.address,
        ethers.parseEther("30"),
        alice
      );
      await instantFinality.confirmTrade(trade.id, bob);
      
      // Attacker tries to force closure
      await expect(
        stateManager.forceSettlement(channelId, null, attacker)
      ).to.be.revertedWith("Not authorized to force settlement");
      
      // Only participants or dispute resolution can force closure
      const state = stateManager.getState(channelId);
      const message = stateManager.encodeState(state);
      const aliceSignature = await alice.signMessage(message);
      
      state.signatures.set(alice.address, aliceSignature);
      
      // Single signature insufficient for forced closure
      await expect(
        stateManager.forceSettlement(channelId, state)
      ).to.be.revertedWith("Insufficient signatures for forced settlement");
    });
  });

  describe("Race Condition Handling", function () {
    it("Should handle concurrent trade submissions", async function () {
      const channelId = "channel-race-001";
      await stateManager.createChannel(
        channelId,
        [alice.address, bob.address],
        new Map([
          [alice.address, ethers.parseEther("100")],
          [bob.address, ethers.parseEther("100")]
        ])
      );
      
      // Submit multiple trades concurrently
      const trades = [];
      const tradeCount = 20;
      
      for (let i = 0; i < tradeCount; i++) {
        const from = i % 2 === 0 ? alice : bob;
        const to = i % 2 === 0 ? bob : alice;
        
        trades.push(
          hftFinality.initiateInstantTradeHFT(
            channelId,
            from.address,
            to.address,
            ethers.parseEther("5"),
            from,
            false
          )
        );
      }
      
      const results = await Promise.allSettled(trades);
      
      // All trades should either succeed or fail cleanly
      results.forEach(result => {
        if (result.status === 'rejected') {
          expect(result.reason.message).to.match(/Insufficient balance|Concurrent modification/);
        }
      });
      
      // Final state should be consistent
      const finalState = stateManager.getState(channelId);
      const totalBalance = Array.from(finalState.balances.values())
        .reduce((sum, bal) => sum.add(bal), ethers.BigNumber.from(0));
      
      expect(totalBalance).to.equal(ethers.parseEther("200"));
    });

    it("Should handle concurrent dispute submissions", async function () {
      const channelId = "channel-dispute-race-001";
      await stateManager.createChannel(
        channelId,
        [alice.address, bob.address],
        new Map([
          [alice.address, ethers.parseEther("100")],
          [bob.address, ethers.parseEther("100")]
        ])
      );
      
      // Create different disputed states
      const disputedState1 = {
        channelId,
        participants: [alice.address, bob.address],
        balances: new Map([
          [alice.address, ethers.parseEther("60")],
          [bob.address, ethers.parseEther("140")]
        ]),
        nonce: 1,
        timestamp: Date.now(),
        signatures: new Map(),
        status: "Active",
        totalCollateral: ethers.parseEther("200")
      };
      
      const disputedState2 = {
        ...disputedState1,
        balances: new Map([
          [alice.address, ethers.parseEther("70")],
          [bob.address, ethers.parseEther("130")]
        ]),
        nonce: 2
      };
      
      // Sign both states
      const message1 = stateManager.encodeState(disputedState1);
      const aliceSig1 = await alice.signMessage(message1);
      const bobSig1 = await bob.signMessage(message1);
      disputedState1.signatures.set(alice.address, aliceSig1);
      disputedState1.signatures.set(bob.address, bobSig1);
      
      const message2 = stateManager.encodeState(disputedState2);
      const aliceSig2 = await alice.signMessage(message2);
      const bobSig2 = await bob.signMessage(message2);
      disputedState2.signatures.set(alice.address, aliceSig2);
      disputedState2.signatures.set(bob.address, bobSig2);
      
      // Submit disputes concurrently
      const dispute1Promise = disputeManager.initiateDispute(
        channelId,
        alice.address,
        {
          state: disputedState1,
          signatures: [aliceSig1, bobSig1]
        }
      );
      
      const dispute2Promise = disputeManager.initiateDispute(
        channelId,
        bob.address,
        {
          state: disputedState2,
          signatures: [aliceSig2, bobSig2]
        }
      );
      
      const results = await Promise.allSettled([dispute1Promise, dispute2Promise]);
      
      // One should succeed, one should fail
      const successes = results.filter(r => r.status === 'fulfilled');
      const failures = results.filter(r => r.status === 'rejected');
      
      expect(successes.length).to.equal(1);
      expect(failures.length).to.equal(1);
      
      if (failures[0].status === 'rejected') {
        expect(failures[0].reason.message).to.include("Dispute already active");
      }
    });
  });

  describe("Cryptographic Attack Resistance", function () {
    it("Should resist timing attacks on signature verification", async function () {
      const channelId = "channel-timing-001";
      await stateManager.createChannel(
        channelId,
        [alice.address, bob.address],
        new Map([
          [alice.address, ethers.parseEther("100")],
          [bob.address, ethers.parseEther("100")]
        ])
      );
      
      const state = stateManager.getState(channelId);
      const message = stateManager.encodeState(state);
      
      const validSignature = await alice.signMessage(message);
      const invalidSignature = await attacker.signMessage(message);
      
      // Measure verification times
      const iterations = 1000;
      const validTimes = [];
      const invalidTimes = [];
      
      for (let i = 0; i < iterations; i++) {
        // Valid signature timing
        const validStart = process.hrtime.bigint();
        await stateManager.verifySignature(message, validSignature, alice.address);
        const validEnd = process.hrtime.bigint();
        validTimes.push(Number(validEnd - validStart));
        
        // Invalid signature timing
        const invalidStart = process.hrtime.bigint();
        await stateManager.verifySignature(message, invalidSignature, alice.address);
        const invalidEnd = process.hrtime.bigint();
        invalidTimes.push(Number(invalidEnd - invalidStart));
      }
      
      // Calculate average times
      const avgValidTime = validTimes.reduce((a, b) => a + b) / validTimes.length;
      const avgInvalidTime = invalidTimes.reduce((a, b) => a + b) / invalidTimes.length;
      
      // Times should be similar (constant-time verification)
      const timeDifference = Math.abs(avgValidTime - avgInvalidTime);
      const maxAllowedDifference = Math.max(avgValidTime, avgInvalidTime) * 0.1; // 10% tolerance
      
      console.log(`
        Timing Attack Resistance:
        - Avg valid signature time: ${avgValidTime}ns
        - Avg invalid signature time: ${avgInvalidTime}ns
        - Difference: ${timeDifference}ns (${((timeDifference / avgValidTime) * 100).toFixed(2)}%)
      `);
      
      expect(timeDifference).to.be.lessThan(maxAllowedDifference);
    });

    it("Should prevent hash collision attacks", async function () {
      // Test that different states produce different hashes
      const states = [];
      const hashes = new Set();
      
      // Generate many similar states
      for (let i = 0; i < 1000; i++) {
        const state = {
          channelId: "channel-" + i,
          participants: [alice.address, bob.address],
          balances: new Map([
            [alice.address, ethers.parseEther((50 + i * 0.001).toString())],
            [bob.address, ethers.parseEther((150 - i * 0.001).toString())]
          ]),
          nonce: i,
          timestamp: Date.now() + i,
          signatures: new Map(),
          status: "Active",
          totalCollateral: ethers.parseEther("200")
        };
        
        states.push(state);
        const hash = stateManager.hashState(state);
        hashes.add(hash);
      }
      
      // All hashes should be unique
      expect(hashes.size).to.equal(states.length);
    });

    it("Should use secure random number generation", async function () {
      // Test trade ID generation randomness
      const channelId = "channel-random-001";
      const tradeIds = new Set();
      
      for (let i = 0; i < 1000; i++) {
        const tradeId = hftFinality['generateFastTradeId'](
          channelId,
          alice.address,
          bob.address
        );
        tradeIds.add(tradeId);
      }
      
      // All IDs should be unique
      expect(tradeIds.size).to.equal(1000);
      
      // Check entropy in random component
      const randomComponents = Array.from(tradeIds).map(id => {
        const parts = id.split('-');
        return parseInt(parts[parts.length - 1]);
      });
      
      // Simple entropy check - values should be well distributed
      const min = Math.min(...randomComponents);
      const max = Math.max(...randomComponents);
      const range = max - min;
      
      expect(range).to.be.greaterThan(900000); // Good distribution across range
    });
  });

  describe("MEV Protection", function () {
    it("Should prevent sandwich attacks on trades", async function () {
      const channelId = "channel-mev-001";
      await stateManager.createChannel(
        channelId,
        [alice.address, bob.address, carol.address],
        new Map([
          [alice.address, ethers.parseEther("100")],
          [bob.address, ethers.parseEther("100")],
          [carol.address, ethers.parseEther("100")]
        ])
      );
      
      // Alice wants to trade with Bob
      const aliceTrade = await instantFinality.initiateInstantTrade(
        channelId,
        alice.address,
        bob.address,
        ethers.parseEther("50"),
        alice
      );
      
      // Carol (MEV bot) tries to front-run
      const carolFrontRun = instantFinality.initiateInstantTrade(
        channelId,
        carol.address,
        bob.address,
        ethers.parseEther("30"),
        carol
      );
      
      // System should process in order of initiation
      await instantFinality.confirmTrade(aliceTrade.id, bob);
      
      // Carol's trade should fail or be processed after
      await expect(carolFrontRun).to.not.be.reverted;
      
      const state = stateManager.getState(channelId);
      
      // Verify Alice's trade was processed first
      expect(state.balances.get(alice.address)).to.equal(ethers.parseEther("50"));
      expect(state.balances.get(bob.address)).to.equal(ethers.parseEther("150"));
    });

    it("Should use commit-reveal for sensitive operations", async function () {
      // Implement commit-reveal pattern for trade intentions
      const channelId = "channel-commit-reveal-001";
      await stateManager.createChannel(
        channelId,
        [alice.address, bob.address],
        new Map([
          [alice.address, ethers.parseEther("100")],
          [bob.address, ethers.parseEther("100")]
        ])
      );
      
      // Commit phase
      const tradeDetails = {
        from: alice.address,
        to: bob.address,
        amount: ethers.parseEther("25"),
        nonce: Date.now()
      };
      
      const commitment = ethers.keccak256(
        ethers.defaultAbiCoder.encode(
          ["address", "address", "uint256", "uint256"],
          [tradeDetails.from, tradeDetails.to, tradeDetails.amount, tradeDetails.nonce]
        )
      );
      
      // Store commitment
      await stateManager.storeCommitment(channelId, alice.address, commitment);
      
      // Wait for reveal phase
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Reveal phase
      const trade = await instantFinality.initiateInstantTradeWithCommitment(
        channelId,
        tradeDetails,
        commitment,
        alice
      );
      
      expect(trade).to.exist;
      expect(trade.amount).to.equal(tradeDetails.amount);
    });
  });

  afterEach(async function () {
    // Cleanup
    await hftFinality.cleanup();
    stateManager.removeAllListeners();
    instantFinality.removeAllListeners();
    disputeManager.removeAllListeners();
  });
});