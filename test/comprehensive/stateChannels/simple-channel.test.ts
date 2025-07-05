import { expect } from "chai";
import { ethers } from "hardhat";
import { StateManager } from "../../../src/stateChannels/StateManager";
import { InstantFinalityEngine } from "../../../src/stateChannels/InstantFinality";
import { DisputeManager } from "../../../src/stateChannels/DisputeManager";
import { MultiPartyChannel } from "../../../src/stateChannels/MultiPartyChannel";

describe("State Channel Basic Tests", function () {
  let stateManager: StateManager;
  let instantFinality: InstantFinalityEngine;
  let disputeManager: DisputeManager;
  let multiPartyChannel: MultiPartyChannel;
  
  let alice: any;
  let bob: any;
  let provider: ethers.Provider;

  beforeEach(async function () {
    [alice, bob] = await ethers.getSigners();
    provider = ethers.provider;
    
    stateManager = new StateManager();
    disputeManager = new DisputeManager(stateManager, provider, 3600);
    
    instantFinality = new InstantFinalityEngine(stateManager, {
      requiredSignatures: 2,
      challengePeriod: 3600,
      maxTradeValue: ethers.parseEther("10000"),
      requireInstantFinality: true
    });
  });

  describe("1. Channel creation and initialization", function () {
    it("should create a new state channel", async function () {
      const channelId = "channel-1";
      await stateManager.createChannel(channelId, [alice.address, bob.address]);
      
      const channel = stateManager.getChannel(channelId);
      expect(channel).to.not.be.undefined;
      expect(channel?.participants).to.include(alice.address);
      expect(channel?.participants).to.include(bob.address);
    });

    it("should initialize channel with correct parameters", async function () {
      const channelId = "channel-2";
      const participants = [alice.address, bob.address];
      
      await stateManager.createChannel(channelId, participants);
      const channel = stateManager.getChannel(channelId);
      
      expect(channel?.id).to.equal(channelId);
      expect(channel?.participants.length).to.equal(2);
      expect(channel?.nonce).to.equal(0);
      expect(channel?.isOpen).to.be.true;
    });
  });

  describe("2. State updates and signatures", function () {
    it("should update channel state with valid signatures", async function () {
      const channelId = "channel-3";
      await stateManager.createChannel(channelId, [alice.address, bob.address]);
      
      const newState = {
        channelId,
        nonce: 1,
        balances: {
          [alice.address]: ethers.parseEther("100"),
          [bob.address]: ethers.parseEther("100")
        }
      };
      
      const stateHash = stateManager.hashState(newState);
      const aliceSignature = await alice.signMessage(ethers.getBytes(stateHash));
      const bobSignature = await bob.signMessage(ethers.getBytes(stateHash));
      
      await stateManager.updateState(
        channelId,
        newState,
        [aliceSignature, bobSignature]
      );
      
      const channel = stateManager.getChannel(channelId);
      expect(channel?.nonce).to.equal(1);
    });

    it("should reject invalid state updates", async function () {
      const channelId = "channel-4";
      await stateManager.createChannel(channelId, [alice.address, bob.address]);
      
      const invalidState = {
        channelId,
        nonce: 0, // Invalid: should be 1
        balances: {}
      };
      
      await expect(
        stateManager.updateState(channelId, invalidState, [])
      ).to.be.rejected;
    });
  });

  describe("3. Dispute resolution", function () {
    it("should handle dispute initiation", async function () {
      const channelId = "channel-5";
      await stateManager.createChannel(channelId, [alice.address, bob.address]);
      
      const dispute = await disputeManager.initiateDispute(channelId, alice.address);
      expect(dispute).to.not.be.undefined;
      expect(dispute.initiator).to.equal(alice.address);
    });

    it("should resolve disputes with valid evidence", async function () {
      const channelId = "channel-6";
      await stateManager.createChannel(channelId, [alice.address, bob.address]);
      
      // Create a state update
      const state = {
        channelId,
        nonce: 1,
        balances: {
          [alice.address]: ethers.parseEther("150"),
          [bob.address]: ethers.parseEther("50")
        }
      };
      
      const stateHash = stateManager.hashState(state);
      const aliceSignature = await alice.signMessage(ethers.getBytes(stateHash));
      const bobSignature = await bob.signMessage(ethers.getBytes(stateHash));
      
      // Initiate dispute
      const dispute = await disputeManager.initiateDispute(channelId, alice.address);
      
      // Submit evidence
      await disputeManager.submitEvidence(
        dispute.id,
        state,
        [aliceSignature, bobSignature]
      );
      
      // Resolve dispute
      const resolution = await disputeManager.resolveDispute(dispute.id);
      expect(resolution.resolved).to.be.true;
    });
  });

  describe("4. Channel closing", function () {
    it("should close channel cooperatively", async function () {
      const channelId = "channel-7";
      await stateManager.createChannel(channelId, [alice.address, bob.address]);
      
      const finalState = {
        channelId,
        nonce: 1,
        balances: {
          [alice.address]: ethers.parseEther("100"),
          [bob.address]: ethers.parseEther("100")
        },
        isFinal: true
      };
      
      const stateHash = stateManager.hashState(finalState);
      const aliceSignature = await alice.signMessage(ethers.getBytes(stateHash));
      const bobSignature = await bob.signMessage(ethers.getBytes(stateHash));
      
      await stateManager.closeChannel(
        channelId,
        finalState,
        [aliceSignature, bobSignature]
      );
      
      const channel = stateManager.getChannel(channelId);
      expect(channel?.isOpen).to.be.false;
    });

    it("should handle unilateral channel closing", async function () {
      const channelId = "channel-8";
      await stateManager.createChannel(channelId, [alice.address, bob.address]);
      
      // Initiate unilateral close
      await stateManager.initiateUnilateralClose(channelId, alice.address);
      
      const channel = stateManager.getChannel(channelId);
      expect(channel?.closingInitiated).to.be.true;
      expect(channel?.closingInitiator).to.equal(alice.address);
    });
  });
});