import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { StateManager } from "../../../src/stateChannels/StateManager";
import { InstantFinalityEngine } from "../../../src/stateChannels/InstantFinality";
import { HFTOptimizedInstantFinality } from "../../../src/stateChannels/HFTOptimizedInstantFinality";
import { DisputeManager } from "../../../src/stateChannels/DisputeManager";
import { MultiPartyChannel } from "../../../src/stateChannels/MultiPartyChannel";

describe("State Channel Lifecycle Tests", function () {
  let stateManager: StateManager;
  let instantFinality: InstantFinalityEngine;
  let hftFinality: HFTOptimizedInstantFinality;
  let disputeManager: DisputeManager;
  let multiPartyChannel: MultiPartyChannel;
  
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let carol: HardhatEthersSigner;
  let dave: HardhatEthersSigner;
  
  let provider: ethers.Provider;

  beforeEach(async function () {
    [alice, bob, carol, dave] = await ethers.getSigners();
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
      enableZeroConfirmation: true
    });
  });

  describe("Channel Creation and Initialization", function () {
    it("Should create a basic two-party channel", async function () {
      const channelId = "channel-alice-bob-001";
      const participants = [alice.address, bob.address];
      const collateral = new Map([
        [alice.address, ethers.parseEther("100")],
        [bob.address, ethers.parseEther("100")]
      ]);
      
      const channel = await stateManager.createChannel(
        channelId,
        participants,
        collateral
      );
      
      expect(channel.channelId).to.equal(channelId);
      expect(channel.participants).to.deep.equal(participants);
      expect(channel.totalCollateral).to.equal(ethers.parseEther("200"));
      expect(channel.status).to.equal("Active");
      expect(channel.nonce).to.equal(0);
      
      // Verify initial balances
      expect(channel.balances.get(alice.address)).to.equal(collateral.get(alice.address));
      expect(channel.balances.get(bob.address)).to.equal(collateral.get(bob.address));
    });

    it("Should create a multi-party channel", async function () {
      const channelId = "channel-multi-001";
      const participants = [alice.address, bob.address, carol.address, dave.address];
      const collateral = new Map([
        [alice.address, ethers.parseEther("50")],
        [bob.address, ethers.parseEther("75")],
        [carol.address, ethers.parseEther("100")],
        [dave.address, ethers.parseEther("25")]
      ]);
      
      multiPartyChannel = new MultiPartyChannel(channelId, participants, stateManager);
      await multiPartyChannel.initialize(collateral);
      
      const state = multiPartyChannel.getChannelState();
      expect(state.participants.length).to.equal(4);
      expect(state.totalCollateral).to.equal(ethers.parseEther("250"));
      
      // Verify Byzantine fault tolerance threshold
      const threshold = multiPartyChannel.getConsensusThreshold();
      expect(threshold).to.equal(3); // 3 out of 4 for BFT
    });

    it("Should reject channel creation with invalid parameters", async function () {
      const channelId = "channel-invalid-001";
      
      // Test with single participant
      await expect(
        stateManager.createChannel(channelId, [alice.address], new Map())
      ).to.be.revertedWith("Minimum 2 participants required");
      
      // Test with duplicate participants
      await expect(
        stateManager.createChannel(
          channelId,
          [alice.address, alice.address],
          new Map([[alice.address, ethers.parseEther("100")]])
        )
      ).to.be.revertedWith("Duplicate participant");
      
      // Test with zero collateral
      await expect(
        stateManager.createChannel(
          channelId,
          [alice.address, bob.address],
          new Map([
            [alice.address, ethers.parseEther("0")],
            [bob.address, ethers.parseEther("100")]
          ])
        )
      ).to.be.revertedWith("Zero collateral not allowed");
    });

    it("Should handle concurrent channel creation attempts", async function () {
      const channelId = "channel-concurrent-001";
      const participants = [alice.address, bob.address];
      const collateral = new Map([
        [alice.address, ethers.parseEther("100")],
        [bob.address, ethers.parseEther("100")]
      ]);
      
      // Simulate concurrent creation attempts
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(
          stateManager.createChannel(channelId, participants, collateral)
            .catch(err => err.message)
        );
      }
      
      const results = await Promise.all(promises);
      
      // Only one should succeed
      const successes = results.filter(r => typeof r !== 'string');
      const failures = results.filter(r => typeof r === 'string');
      
      expect(successes.length).to.equal(1);
      expect(failures.length).to.equal(9);
      expect(failures.every(f => f.includes("Channel already exists"))).to.be.true;
    });
  });

  describe("Collateral Deposits and Withdrawals", function () {
    let channelId: string;
    
    beforeEach(async function () {
      channelId = "channel-deposits-001";
      await stateManager.createChannel(
        channelId,
        [alice.address, bob.address],
        new Map([
          [alice.address, ethers.parseEther("50")],
          [bob.address, ethers.parseEther("50")]
        ])
      );
    });

    it("Should allow additional deposits", async function () {
      const additionalDeposit = ethers.parseEther("25");
      
      await stateManager.deposit(channelId, alice.address, additionalDeposit);
      
      const state = stateManager.getState(channelId);
      expect(state.balances.get(alice.address)).to.equal(ethers.parseEther("75"));
      expect(state.totalCollateral).to.equal(ethers.parseEther("125"));
      
      // Verify deposit event
      stateManager.on("depositMade", (cId, participant, amount) => {
        expect(cId).to.equal(channelId);
        expect(participant).to.equal(alice.address);
        expect(amount).to.equal(additionalDeposit);
      });
    });

    it("Should prevent deposits to finalized channels", async function () {
      await stateManager.finalizeChannel(channelId);
      
      await expect(
        stateManager.deposit(channelId, alice.address, ethers.parseEther("10"))
      ).to.be.revertedWith("Channel is finalized");
    });

    it("Should handle withdrawal requests with pending trades", async function () {
      // Create a pending trade
      const trade = await instantFinality.initiateInstantTrade(
        channelId,
        alice.address,
        bob.address,
        ethers.parseEther("10"),
        alice
      );
      
      // Attempt withdrawal while trade is pending
      await expect(
        stateManager.requestWithdrawal(channelId, alice.address, ethers.parseEther("45"))
      ).to.be.revertedWith("Pending trades must be resolved first");
      
      // Complete the trade
      await instantFinality.confirmTrade(trade.id, bob);
      
      // Now withdrawal should succeed
      await stateManager.requestWithdrawal(channelId, alice.address, ethers.parseEther("30"));
      const state = stateManager.getState(channelId);
      expect(state.pendingWithdrawals.get(alice.address)).to.equal(ethers.parseEther("30"));
    });

    it("Should enforce minimum balance requirements", async function () {
      const state = stateManager.getState(channelId);
      const currentBalance = state.balances.get(alice.address);
      
      // Try to withdraw more than available
      await expect(
        stateManager.requestWithdrawal(channelId, alice.address, currentBalance.add(1))
      ).to.be.revertedWith("Insufficient balance");
      
      // Ensure minimum channel balance is maintained
      const minChannelBalance = ethers.parseEther("10");
      const maxWithdrawable = currentBalance.sub(minChannelBalance);
      
      await stateManager.requestWithdrawal(channelId, alice.address, maxWithdrawable);
      expect(state.balances.get(alice.address)).to.equal(minChannelBalance);
    });
  });

  describe("Off-chain Trade Execution", function () {
    let channelId: string;
    
    beforeEach(async function () {
      channelId = "channel-trades-001";
      await stateManager.createChannel(
        channelId,
        [alice.address, bob.address],
        new Map([
          [alice.address, ethers.parseEther("100")],
          [bob.address, ethers.parseEther("100")]
        ])
      );
    });

    it("Should execute instant finality trade", async function () {
      const tradeAmount = ethers.parseEther("25");
      
      const trade = await instantFinality.initiateInstantTrade(
        channelId,
        alice.address,
        bob.address,
        tradeAmount,
        alice
      );
      
      expect(trade.from).to.equal(alice.address);
      expect(trade.to).to.equal(bob.address);
      expect(trade.amount).to.equal(tradeAmount);
      expect(trade.executed).to.be.false;
      
      // Bob confirms the trade
      await instantFinality.confirmTrade(trade.id, bob);
      
      // Verify trade execution
      const executedTrade = instantFinality.getTrade(trade.id);
      expect(executedTrade.executed).to.be.true;
      expect(executedTrade.finalityProof.signatures.size).to.equal(2);
      
      // Verify balance updates
      const state = stateManager.getState(channelId);
      expect(state.balances.get(alice.address)).to.equal(ethers.parseEther("75"));
      expect(state.balances.get(bob.address)).to.equal(ethers.parseEther("125"));
    });

    it("Should handle HFT optimized trades", async function () {
      const trades = [];
      const tradeCount = 100;
      const tradeAmount = ethers.parseEther("0.1");
      
      // Generate rapid trades
      const startTime = Date.now();
      
      for (let i = 0; i < tradeCount; i++) {
        const from = i % 2 === 0 ? alice : bob;
        const to = i % 2 === 0 ? bob : alice;
        
        const trade = await hftFinality.initiateInstantTradeHFT(
          channelId,
          from.address,
          to.address,
          tradeAmount,
          from,
          true // trusted counterparty for zero-conf
        );
        
        trades.push(trade);
      }
      
      const endTime = Date.now();
      const totalTime = endTime - startTime;
      const throughput = (tradeCount / totalTime) * 1000; // trades per second
      
      console.log(`HFT Performance: ${tradeCount} trades in ${totalTime}ms (${throughput.toFixed(2)} TPS)`);
      
      // Verify all trades executed
      expect(trades.every(t => t.executed)).to.be.true;
      
      // Verify final balances (should be back to original since trades alternate)
      const state = stateManager.getState(channelId);
      expect(state.balances.get(alice.address)).to.equal(ethers.parseEther("100"));
      expect(state.balances.get(bob.address)).to.equal(ethers.parseEther("100"));
      
      // Check HFT metrics
      const metrics = hftFinality.getMetrics();
      expect(metrics.totalTrades).to.equal(tradeCount);
      expect(metrics.avgLatency).to.be.lessThan(10); // Less than 10ms average
      expect(metrics.p99Latency).to.be.lessThan(50); // P99 less than 50ms
    });

    it("Should rollback failed optimistic trades", async function () {
      // Enable optimistic execution
      const optimisticTrade = await hftFinality.initiateInstantTradeHFT(
        channelId,
        alice.address,
        bob.address,
        ethers.parseEther("50"),
        alice,
        false // not trusted, will use optimistic execution
      );
      
      // Immediately check balance (optimistically applied)
      let state = stateManager.getState(channelId);
      expect(state.balances.get(alice.address)).to.equal(ethers.parseEther("50"));
      
      // Simulate signature verification failure
      hftFinality.on("optimisticTradeReverted", (trade, error) => {
        expect(trade.id).to.equal(optimisticTrade.id);
        expect(error.message).to.include("Invalid signatures");
      });
      
      // Wait for background verification
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Balance should be reverted
      state = stateManager.getState(channelId);
      expect(state.balances.get(alice.address)).to.equal(ethers.parseEther("100"));
    });

    it("Should handle trade amount limits", async function () {
      const maxTradeValue = ethers.parseEther("10000");
      
      await expect(
        instantFinality.initiateInstantTrade(
          channelId,
          alice.address,
          bob.address,
          maxTradeValue.add(1),
          alice
        )
      ).to.be.revertedWith("Trade amount exceeds maximum");
    });

    it("Should process batch trades efficiently", async function () {
      const batchSize = 20;
      const trades = [];
      
      // Queue trades for batch processing
      for (let i = 0; i < batchSize; i++) {
        const trade = await hftFinality.initiateInstantTradeHFT(
          channelId,
          alice.address,
          bob.address,
          ethers.parseEther("1"),
          alice,
          false
        );
        trades.push(trade);
      }
      
      // Wait for batch processing
      await new Promise(resolve => setTimeout(resolve, 150));
      
      // All trades should be processed
      const metrics = hftFinality.getMetrics();
      expect(metrics.totalTrades).to.be.at.least(batchSize);
      expect(metrics.pendingQueueSize).to.equal(0);
    });
  });

  describe("Channel State Updates and Synchronization", function () {
    let channelId: string;
    
    beforeEach(async function () {
      channelId = "channel-state-001";
      await stateManager.createChannel(
        channelId,
        [alice.address, bob.address],
        new Map([
          [alice.address, ethers.parseEther("100")],
          [bob.address, ethers.parseEther("100")]
        ])
      );
    });

    it("Should update state with proper nonce increment", async function () {
      const initialState = stateManager.getState(channelId);
      const initialNonce = initialState.nonce;
      
      // Execute a trade to update state
      const trade = await instantFinality.initiateInstantTrade(
        channelId,
        alice.address,
        bob.address,
        ethers.parseEther("10"),
        alice
      );
      await instantFinality.confirmTrade(trade.id, bob);
      
      const updatedState = stateManager.getState(channelId);
      expect(updatedState.nonce).to.equal(initialNonce + 1);
      expect(updatedState.timestamp).to.be.greaterThan(initialState.timestamp);
    });

    it("Should maintain state consistency across concurrent updates", async function () {
      const tradePromises = [];
      const tradeCount = 10;
      const tradeAmount = ethers.parseEther("1");
      
      // Create concurrent trades
      for (let i = 0; i < tradeCount; i++) {
        const from = i % 2 === 0 ? alice : bob;
        const to = i % 2 === 0 ? bob : alice;
        
        const promise = instantFinality.initiateInstantTrade(
          channelId,
          from.address,
          to.address,
          tradeAmount,
          from
        ).then(trade => instantFinality.confirmTrade(trade.id, to));
        
        tradePromises.push(promise);
      }
      
      await Promise.all(tradePromises);
      
      // Verify final state consistency
      const finalState = stateManager.getState(channelId);
      expect(finalState.nonce).to.equal(tradeCount);
      
      // Balances should be back to original
      expect(finalState.balances.get(alice.address)).to.equal(ethers.parseEther("100"));
      expect(finalState.balances.get(bob.address)).to.equal(ethers.parseEther("100"));
    });

    it("Should generate valid state proofs", async function () {
      // Execute some trades
      for (let i = 0; i < 5; i++) {
        const trade = await instantFinality.initiateInstantTrade(
          channelId,
          alice.address,
          bob.address,
          ethers.parseEther("5"),
          alice
        );
        await instantFinality.confirmTrade(trade.id, bob);
      }
      
      const state = stateManager.getState(channelId);
      const stateProof = await stateManager.generateStateProof(channelId);
      
      expect(stateProof.channelId).to.equal(channelId);
      expect(stateProof.nonce).to.equal(state.nonce);
      expect(stateProof.stateRoot).to.be.a('string');
      expect(stateProof.signatures.size).to.equal(2);
      
      // Verify signatures
      const isValid = await stateManager.verifyStateProof(stateProof);
      expect(isValid).to.be.true;
    });

    it("Should handle state rollbacks", async function () {
      const checkpointNonce = 3;
      
      // Execute trades to advance state
      for (let i = 0; i < 5; i++) {
        const trade = await instantFinality.initiateInstantTrade(
          channelId,
          alice.address,
          bob.address,
          ethers.parseEther("10"),
          alice
        );
        await instantFinality.confirmTrade(trade.id, bob);
        
        if (i === checkpointNonce - 1) {
          // Create checkpoint
          await stateManager.createCheckpoint(channelId);
        }
      }
      
      const currentState = stateManager.getState(channelId);
      expect(currentState.nonce).to.equal(5);
      
      // Rollback to checkpoint
      await stateManager.rollbackToCheckpoint(channelId, checkpointNonce);
      
      const rolledBackState = stateManager.getState(channelId);
      expect(rolledBackState.nonce).to.equal(checkpointNonce);
      expect(rolledBackState.balances.get(alice.address)).to.equal(ethers.parseEther("70"));
      expect(rolledBackState.balances.get(bob.address)).to.equal(ethers.parseEther("130"));
    });
  });

  describe("Dispute Resolution and Fraud Proofs", function () {
    let channelId: string;
    
    beforeEach(async function () {
      channelId = "channel-dispute-001";
      await stateManager.createChannel(
        channelId,
        [alice.address, bob.address],
        new Map([
          [alice.address, ethers.parseEther("100")],
          [bob.address, ethers.parseEther("100")]
        ])
      );
    });

    it("Should initiate dispute with valid evidence", async function () {
      // Create some channel activity
      const trade = await instantFinality.initiateInstantTrade(
        channelId,
        alice.address,
        bob.address,
        ethers.parseEther("30"),
        alice
      );
      await instantFinality.confirmTrade(trade.id, bob);
      
      // Alice claims a different state
      const disputedState = {
        channelId,
        participants: [alice.address, bob.address],
        balances: new Map([
          [alice.address, ethers.parseEther("60")],
          [bob.address, ethers.parseEther("140")]
        ]),
        nonce: 2,
        timestamp: Date.now(),
        signatures: new Map(),
        status: "Active",
        totalCollateral: ethers.parseEther("200")
      };
      
      // Sign the disputed state
      const message = stateManager.encodeState(disputedState);
      const aliceSignature = await alice.signMessage(message);
      const bobSignature = await bob.signMessage(message);
      
      disputedState.signatures.set(alice.address, aliceSignature);
      disputedState.signatures.set(bob.address, bobSignature);
      
      const dispute = await disputeManager.initiateDispute(
        channelId,
        alice.address,
        {
          state: disputedState,
          signatures: [aliceSignature, bobSignature]
        }
      );
      
      expect(dispute.channelId).to.equal(channelId);
      expect(dispute.initiator).to.equal(alice.address);
      expect(dispute.status).to.equal("Initiated");
      expect(dispute.challengedState.nonce).to.equal(2);
    });

    it("Should respond to dispute with higher nonce state", async function () {
      // First create a dispute
      const disputedState = {
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
      
      const message1 = stateManager.encodeState(disputedState);
      const aliceSignature1 = await alice.signMessage(message1);
      const bobSignature1 = await bob.signMessage(message1);
      
      disputedState.signatures.set(alice.address, aliceSignature1);
      disputedState.signatures.set(bob.address, bobSignature1);
      
      await disputeManager.initiateDispute(
        channelId,
        alice.address,
        {
          state: disputedState,
          signatures: [aliceSignature1, bobSignature1]
        }
      );
      
      // Bob responds with higher nonce state
      const responseState = {
        channelId,
        participants: [alice.address, bob.address],
        balances: new Map([
          [alice.address, ethers.parseEther("50")],
          [bob.address, ethers.parseEther("150")]
        ]),
        nonce: 3,
        timestamp: Date.now(),
        signatures: new Map(),
        status: "Active",
        totalCollateral: ethers.parseEther("200")
      };
      
      const message2 = stateManager.encodeState(responseState);
      const aliceSignature2 = await alice.signMessage(message2);
      const bobSignature2 = await bob.signMessage(message2);
      
      responseState.signatures.set(alice.address, aliceSignature2);
      responseState.signatures.set(bob.address, bobSignature2);
      
      await disputeManager.respondToDispute(
        channelId,
        bob.address,
        {
          state: responseState,
          signatures: [aliceSignature2, bobSignature2]
        }
      );
      
      const dispute = disputeManager.getDispute(channelId);
      expect(dispute.status).to.equal("Resolved");
      expect(dispute.responseState.nonce).to.equal(3);
    });

    it("Should timeout dispute without response", async function () {
      const disputedState = {
        channelId,
        participants: [alice.address, bob.address],
        balances: new Map([
          [alice.address, ethers.parseEther("80")],
          [bob.address, ethers.parseEther("120")]
        ]),
        nonce: 1,
        timestamp: Date.now(),
        signatures: new Map(),
        status: "Active",
        totalCollateral: ethers.parseEther("200")
      };
      
      const message = stateManager.encodeState(disputedState);
      const aliceSignature = await alice.signMessage(message);
      const bobSignature = await bob.signMessage(message);
      
      disputedState.signatures.set(alice.address, aliceSignature);
      disputedState.signatures.set(bob.address, bobSignature);
      
      await disputeManager.initiateDispute(
        channelId,
        alice.address,
        {
          state: disputedState,
          signatures: [aliceSignature, bobSignature]
        }
      );
      
      // Fast forward time past challenge period
      await ethers.provider.send("evm_increaseTime", [3601]);
      await ethers.provider.send("evm_mine", []);
      
      await disputeManager.checkTimeouts();
      
      const dispute = disputeManager.getDispute(channelId);
      expect(dispute.status).to.equal("TimedOut");
      expect(dispute.resolved).to.be.true;
    });

    it("Should generate fraud proof for invalid state transition", async function () {
      // Create a valid state transition first
      const validTrade = await instantFinality.initiateInstantTrade(
        channelId,
        alice.address,
        bob.address,
        ethers.parseEther("20"),
        alice
      );
      await instantFinality.confirmTrade(validTrade.id, bob);
      
      const validState = stateManager.getState(channelId);
      
      // Now create an invalid state that violates conservation of funds
      const invalidState = {
        channelId,
        participants: [alice.address, bob.address],
        balances: new Map([
          [alice.address, ethers.parseEther("90")],
          [bob.address, ethers.parseEther("130")] // Total: 220 > 200
        ]),
        nonce: validState.nonce + 1,
        timestamp: Date.now(),
        signatures: new Map(),
        status: "Active",
        totalCollateral: ethers.parseEther("200")
      };
      
      const fraudProof = await stateManager.generateFraudProof(
        validState,
        invalidState
      );
      
      expect(fraudProof.type).to.equal("BalanceViolation");
      expect(fraudProof.validState).to.deep.equal(validState);
      expect(fraudProof.invalidState).to.deep.equal(invalidState);
      expect(fraudProof.proof).to.include("Total balance exceeds collateral");
    });

    it("Should detect double-spend attempts", async function () {
      // Alice tries to spend the same funds twice
      const trade1 = await instantFinality.initiateInstantTrade(
        channelId,
        alice.address,
        bob.address,
        ethers.parseEther("60"),
        alice
      );
      
      // Try to create another trade that would exceed Alice's balance
      await expect(
        instantFinality.initiateInstantTrade(
          channelId,
          alice.address,
          bob.address,
          ethers.parseEther("60"),
          alice
        )
      ).to.be.revertedWith("Insufficient balance");
      
      // Confirm first trade
      await instantFinality.confirmTrade(trade1.id, bob);
      
      // Now Alice only has 40 ETH left
      await expect(
        instantFinality.initiateInstantTrade(
          channelId,
          alice.address,
          bob.address,
          ethers.parseEther("50"),
          alice
        )
      ).to.be.revertedWith("Insufficient balance");
    });
  });

  describe("Channel Settlement and Finalization", function () {
    let channelId: string;
    
    beforeEach(async function () {
      channelId = "channel-settlement-001";
      await stateManager.createChannel(
        channelId,
        [alice.address, bob.address],
        new Map([
          [alice.address, ethers.parseEther("100")],
          [bob.address, ethers.parseEther("100")]
        ])
      );
    });

    it("Should finalize channel cooperatively", async function () {
      // Execute some trades
      const trade1 = await instantFinality.initiateInstantTrade(
        channelId,
        alice.address,
        bob.address,
        ethers.parseEther("30"),
        alice
      );
      await instantFinality.confirmTrade(trade1.id, bob);
      
      const trade2 = await instantFinality.initiateInstantTrade(
        channelId,
        bob.address,
        alice.address,
        ethers.parseEther("10"),
        bob
      );
      await instantFinality.confirmTrade(trade2.id, alice);
      
      // Get final state
      const finalState = stateManager.getState(channelId);
      
      // Both parties sign the final state
      const message = stateManager.encodeState(finalState);
      const aliceSignature = await alice.signMessage(message);
      const bobSignature = await bob.signMessage(message);
      
      // Finalize channel
      await stateManager.finalizeChannel(
        channelId,
        [aliceSignature, bobSignature]
      );
      
      const state = stateManager.getState(channelId);
      expect(state.status).to.equal("Finalized");
      
      // Verify final balances
      expect(state.balances.get(alice.address)).to.equal(ethers.parseEther("80"));
      expect(state.balances.get(bob.address)).to.equal(ethers.parseEther("120"));
    });

    it("Should generate settlement proof", async function () {
      // Execute trades
      for (let i = 0; i < 10; i++) {
        const from = i % 2 === 0 ? alice : bob;
        const to = i % 2 === 0 ? bob : alice;
        const trade = await instantFinality.initiateInstantTrade(
          channelId,
          from.address,
          to.address,
          ethers.parseEther("5"),
          from
        );
        await instantFinality.confirmTrade(trade.id, to);
      }
      
      // Finalize channel
      const finalState = stateManager.getState(channelId);
      const message = stateManager.encodeState(finalState);
      const aliceSignature = await alice.signMessage(message);
      const bobSignature = await bob.signMessage(message);
      
      await stateManager.finalizeChannel(channelId, [aliceSignature, bobSignature]);
      
      // Generate settlement proof
      const settlementProof = await stateManager.generateSettlementProof(channelId);
      
      expect(settlementProof.channelId).to.equal(channelId);
      expect(settlementProof.finalState).to.deep.equal(finalState);
      expect(settlementProof.merkleRoot).to.be.a('string');
      expect(settlementProof.participants).to.deep.equal([alice.address, bob.address]);
      expect(settlementProof.finalBalances.get(alice.address)).to.equal(ethers.parseEther("100"));
      expect(settlementProof.finalBalances.get(bob.address)).to.equal(ethers.parseEther("100"));
    });

    it("Should handle forced settlement after dispute", async function () {
      // Create dispute scenario
      const disputedState = {
        channelId,
        participants: [alice.address, bob.address],
        balances: new Map([
          [alice.address, ethers.parseEther("60")],
          [bob.address, ethers.parseEther("140")]
        ]),
        nonce: 5,
        timestamp: Date.now(),
        signatures: new Map(),
        status: "Active",
        totalCollateral: ethers.parseEther("200")
      };
      
      const message = stateManager.encodeState(disputedState);
      const aliceSignature = await alice.signMessage(message);
      const bobSignature = await bob.signMessage(message);
      
      disputedState.signatures.set(alice.address, aliceSignature);
      disputedState.signatures.set(bob.address, bobSignature);
      
      await disputeManager.initiateDispute(
        channelId,
        alice.address,
        {
          state: disputedState,
          signatures: [aliceSignature, bobSignature]
        }
      );
      
      // Fast forward time
      await ethers.provider.send("evm_increaseTime", [3601]);
      await ethers.provider.send("evm_mine", []);
      
      await disputeManager.checkTimeouts();
      
      // Force settlement with disputed state
      await stateManager.forceSettlement(channelId, disputedState);
      
      const finalState = stateManager.getState(channelId);
      expect(finalState.status).to.equal("Finalized");
      expect(finalState.balances.get(alice.address)).to.equal(ethers.parseEther("60"));
      expect(finalState.balances.get(bob.address)).to.equal(ethers.parseEther("140"));
    });

    it("Should prevent operations on finalized channels", async function () {
      await stateManager.finalizeChannel(channelId, []);
      
      // Try to execute trade on finalized channel
      await expect(
        instantFinality.initiateInstantTrade(
          channelId,
          alice.address,
          bob.address,
          ethers.parseEther("10"),
          alice
        )
      ).to.be.revertedWith("Channel is finalized");
      
      // Try to deposit
      await expect(
        stateManager.deposit(channelId, alice.address, ethers.parseEther("10"))
      ).to.be.revertedWith("Channel is finalized");
      
      // Try to update state
      await expect(
        stateManager.updateState(channelId, {} as any)
      ).to.be.revertedWith("Channel is finalized");
    });
  });

  describe("Multi-party Channels", function () {
    let channelId: string;
    let participants: string[];
    
    beforeEach(async function () {
      channelId = "channel-multiparty-001";
      participants = [alice.address, bob.address, carol.address, dave.address];
      
      multiPartyChannel = new MultiPartyChannel(channelId, participants, stateManager);
      await multiPartyChannel.initialize(
        new Map([
          [alice.address, ethers.parseEther("100")],
          [bob.address, ethers.parseEther("100")],
          [carol.address, ethers.parseEther("100")],
          [dave.address, ethers.parseEther("100")]
        ])
      );
    });

    it("Should execute multi-party trades with consensus", async function () {
      // Alice proposes a trade to Bob
      const tradeProposal = await multiPartyChannel.proposeTrade(
        alice.address,
        bob.address,
        ethers.parseEther("25"),
        alice
      );
      
      expect(tradeProposal.signatures.size).to.equal(1);
      expect(tradeProposal.status).to.equal("Pending");
      
      // Bob and Carol approve (3/4 consensus reached)
      await multiPartyChannel.approveTrade(tradeProposal.id, bob);
      await multiPartyChannel.approveTrade(tradeProposal.id, carol);
      
      const executedTrade = multiPartyChannel.getTrade(tradeProposal.id);
      expect(executedTrade.status).to.equal("Executed");
      expect(executedTrade.signatures.size).to.equal(3);
      
      // Verify balances
      const state = multiPartyChannel.getChannelState();
      expect(state.balances.get(alice.address)).to.equal(ethers.parseEther("75"));
      expect(state.balances.get(bob.address)).to.equal(ethers.parseEther("125"));
    });

    it("Should reject trades without consensus", async function () {
      const tradeProposal = await multiPartyChannel.proposeTrade(
        alice.address,
        bob.address,
        ethers.parseEther("50"),
        alice
      );
      
      // Only Bob approves (2/4 - not enough)
      await multiPartyChannel.approveTrade(tradeProposal.id, bob);
      
      // Try to execute without consensus
      await expect(
        multiPartyChannel.executeTrade(tradeProposal.id)
      ).to.be.revertedWith("Insufficient consensus");
      
      const trade = multiPartyChannel.getTrade(tradeProposal.id);
      expect(trade.status).to.equal("Pending");
    });

    it("Should handle Byzantine participant behavior", async function () {
      // Alice proposes a valid trade
      const validTrade = await multiPartyChannel.proposeTrade(
        alice.address,
        bob.address,
        ethers.parseEther("20"),
        alice
      );
      
      // Dave tries to propose conflicting trade with same nonce
      await expect(
        multiPartyChannel.proposeConflictingTrade(
          dave.address,
          carol.address,
          ethers.parseEther("30"),
          dave,
          validTrade.nonce
        )
      ).to.be.revertedWith("Nonce already used");
      
      // Dave tries to double-vote
      await multiPartyChannel.approveTrade(validTrade.id, dave);
      await expect(
        multiPartyChannel.approveTrade(validTrade.id, dave)
      ).to.be.revertedWith("Already voted");
    });

    it("Should finalize multi-party channel with unanimous consent", async function () {
      // Execute some trades
      const trade1 = await multiPartyChannel.proposeTrade(
        alice.address,
        carol.address,
        ethers.parseEther("30"),
        alice
      );
      await multiPartyChannel.approveTrade(trade1.id, bob);
      await multiPartyChannel.approveTrade(trade1.id, carol);
      
      // Get final state
      const finalState = multiPartyChannel.getChannelState();
      
      // All parties sign final state
      const signatures = await multiPartyChannel.getAllSignatures(finalState, [alice, bob, carol, dave]);
      
      // Finalize
      await multiPartyChannel.finalizeChannel(signatures);
      
      expect(finalState.status).to.equal("Finalized");
      expect(finalState.balances.get(alice.address)).to.equal(ethers.parseEther("70"));
      expect(finalState.balances.get(carol.address)).to.equal(ethers.parseEther("130"));
    });
  });

  describe("Performance and Stress Tests", function () {
    it("Should handle high-frequency trading load", async function () {
      this.timeout(30000); // Extended timeout for stress test
      
      const channelId = "channel-stress-001";
      await stateManager.createChannel(
        channelId,
        [alice.address, bob.address],
        new Map([
          [alice.address, ethers.parseEther("1000")],
          [bob.address, ethers.parseEther("1000")]
        ])
      );
      
      const tradeCount = 1000;
      const startTime = Date.now();
      const trades = [];
      
      // Generate rapid trades
      for (let i = 0; i < tradeCount; i++) {
        const from = i % 2 === 0 ? alice : bob;
        const to = i % 2 === 0 ? bob : alice;
        const amount = ethers.parseEther((Math.random() * 0.1).toFixed(4));
        
        const trade = await hftFinality.initiateInstantTradeHFT(
          channelId,
          from.address,
          to.address,
          amount,
          from,
          true
        );
        
        trades.push(trade);
      }
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      const throughput = (tradeCount / duration) * 1000;
      
      console.log(`
        Stress Test Results:
        - Total Trades: ${tradeCount}
        - Duration: ${duration}ms
        - Throughput: ${throughput.toFixed(2)} TPS
        - Avg Latency: ${(duration / tradeCount).toFixed(2)}ms
      `);
      
      const metrics = hftFinality.getMetrics();
      expect(metrics.totalTrades).to.equal(tradeCount);
      expect(throughput).to.be.greaterThan(100); // At least 100 TPS
      
      // Verify state consistency
      const finalState = stateManager.getState(channelId);
      const totalBalance = Array.from(finalState.balances.values())
        .reduce((sum, bal) => sum.add(bal), ethers.BigNumber.from(0));
      expect(totalBalance).to.equal(ethers.parseEther("2000"));
    });

    it("Should maintain performance with large state", async function () {
      const channelId = "channel-large-state-001";
      const participantCount = 50;
      const participants = [];
      const collateral = new Map();
      
      // Create many participants
      for (let i = 0; i < participantCount; i++) {
        const wallet = ethers.Wallet.createRandom();
        participants.push(wallet.address);
        collateral.set(wallet.address, ethers.parseEther("10"));
      }
      
      await stateManager.createChannel(channelId, participants, collateral);
      
      // Measure state proof generation time
      const proofStartTime = Date.now();
      const stateProof = await stateManager.generateStateProof(channelId);
      const proofTime = Date.now() - proofStartTime;
      
      console.log(`State proof generation time for ${participantCount} participants: ${proofTime}ms`);
      
      expect(proofTime).to.be.lessThan(1000); // Should complete within 1 second
      expect(stateProof.signatures.size).to.equal(participantCount);
    });

    it("Should handle signature cache effectively", async function () {
      const channelId = "channel-cache-001";
      await stateManager.createChannel(
        channelId,
        [alice.address, bob.address],
        new Map([
          [alice.address, ethers.parseEther("100")],
          [bob.address, ethers.parseEther("100")]
        ])
      );
      
      // Create a trade
      const trade = await hftFinality.initiateInstantTradeHFT(
        channelId,
        alice.address,
        bob.address,
        ethers.parseEther("10"),
        alice,
        false
      );
      
      // Measure first verification (cache miss)
      const firstVerifyStart = Date.now();
      await hftFinality['fastVerifySignatures'](trade);
      const firstVerifyTime = Date.now() - firstVerifyStart;
      
      // Measure second verification (cache hit)
      const secondVerifyStart = Date.now();
      await hftFinality['fastVerifySignatures'](trade);
      const secondVerifyTime = Date.now() - secondVerifyStart;
      
      console.log(`
        Signature Cache Performance:
        - First verification (cache miss): ${firstVerifyTime}ms
        - Second verification (cache hit): ${secondVerifyTime}ms
        - Speedup: ${(firstVerifyTime / secondVerifyTime).toFixed(2)}x
      `);
      
      expect(secondVerifyTime).to.be.lessThan(firstVerifyTime);
      expect(firstVerifyTime / secondVerifyTime).to.be.greaterThan(5); // At least 5x speedup
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