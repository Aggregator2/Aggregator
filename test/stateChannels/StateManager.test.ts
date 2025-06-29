import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { StateManager, ChannelState, Trade } from "../../src/stateChannels/StateManager";

describe("StateManager", function () {
  let stateManager: StateManager;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let carol: SignerWithAddress;
  let channelId: string;
  let participants: string[];

  beforeEach(async function () {
    [alice, bob, carol] = await ethers.getSigners();
    participants = [alice.address, bob.address];
    channelId = ethers.utils.id("test-channel");

    stateManager = new StateManager(alice);

    // Initialize channel with balances
    const initialBalances = new Map<string, ethers.BigNumber>();
    initialBalances.set(alice.address, ethers.utils.parseEther("100"));
    initialBalances.set(bob.address, ethers.utils.parseEther("100"));

    await stateManager.initializeChannel(channelId, participants, initialBalances);
  });

  describe("Channel Initialization", function () {
    it("Should initialize a channel with correct state", async function () {
      const newChannelId = ethers.utils.id("new-channel");
      const balances = new Map<string, ethers.BigNumber>();
      balances.set(alice.address, ethers.utils.parseEther("50"));
      balances.set(bob.address, ethers.utils.parseEther("50"));

      const state = await stateManager.initializeChannel(newChannelId, participants, balances);

      expect(state.channelId).to.equal(newChannelId);
      expect(state.nonce).to.equal(0);
      expect(state.balances.get(alice.address)).to.deep.equal(ethers.utils.parseEther("50"));
      expect(state.balances.get(bob.address)).to.deep.equal(ethers.utils.parseEther("50"));
    });

    it("Should emit channelInitialized event", async function () {
      const newChannelId = ethers.utils.id("new-channel-2");
      const balances = new Map<string, ethers.BigNumber>();
      balances.set(alice.address, ethers.utils.parseEther("50"));

      let eventEmitted = false;
      stateManager.on("channelInitialized", (emittedChannelId) => {
        expect(emittedChannelId).to.equal(newChannelId);
        eventEmitted = true;
      });

      await stateManager.initializeChannel(newChannelId, [alice.address], balances);
      expect(eventEmitted).to.be.true;
    });
  });

  describe("Trade Proposals", function () {
    it("Should propose a valid trade", async function () {
      const trade: Trade = {
        id: ethers.utils.id("trade-1"),
        from: alice.address,
        to: bob.address,
        amount: ethers.utils.parseEther("10"),
        timestamp: Date.now()
      };

      await expect(stateManager.proposeTrade(channelId, trade)).to.not.be.rejected;

      const pendingTrades = stateManager.getPendingTrades(channelId);
      expect(pendingTrades).to.have.lengthOf(1);
      expect(pendingTrades[0]).to.deep.equal(trade);
    });

    it("Should reject trade with insufficient balance", async function () {
      const trade: Trade = {
        id: ethers.utils.id("trade-2"),
        from: alice.address,
        to: bob.address,
        amount: ethers.utils.parseEther("150"), // More than Alice has
        timestamp: Date.now()
      };

      await expect(stateManager.proposeTrade(channelId, trade)).to.be.rejectedWith("Insufficient balance");
    });

    it("Should reject trade for non-existent channel", async function () {
      const trade: Trade = {
        id: ethers.utils.id("trade-3"),
        from: alice.address,
        to: bob.address,
        amount: ethers.utils.parseEther("10"),
        timestamp: Date.now()
      };

      await expect(stateManager.proposeTrade("invalid-channel", trade)).to.be.rejectedWith("Channel not found");
    });
  });

  describe("Trade Application", function () {
    it("Should apply pending trades correctly", async function () {
      const trade1: Trade = {
        id: ethers.utils.id("trade-1"),
        from: alice.address,
        to: bob.address,
        amount: ethers.utils.parseEther("10"),
        timestamp: Date.now()
      };

      const trade2: Trade = {
        id: ethers.utils.id("trade-2"),
        from: bob.address,
        to: alice.address,
        amount: ethers.utils.parseEther("5"),
        timestamp: Date.now()
      };

      await stateManager.proposeTrade(channelId, trade1);
      await stateManager.proposeTrade(channelId, trade2);

      const newState = await stateManager.applyTrades(channelId);

      expect(newState.nonce).to.equal(1);
      expect(newState.balances.get(alice.address)).to.deep.equal(ethers.utils.parseEther("95"));
      expect(newState.balances.get(bob.address)).to.deep.equal(ethers.utils.parseEther("105"));
    });

    it("Should clear pending trades after application", async function () {
      const trade: Trade = {
        id: ethers.utils.id("trade-1"),
        from: alice.address,
        to: bob.address,
        amount: ethers.utils.parseEther("10"),
        timestamp: Date.now()
      };

      await stateManager.proposeTrade(channelId, trade);
      await stateManager.applyTrades(channelId);

      const pendingTrades = stateManager.getPendingTrades(channelId);
      expect(pendingTrades).to.have.lengthOf(0);
    });

    it("Should update state history", async function () {
      const trade: Trade = {
        id: ethers.utils.id("trade-1"),
        from: alice.address,
        to: bob.address,
        amount: ethers.utils.parseEther("10"),
        timestamp: Date.now()
      };

      await stateManager.proposeTrade(channelId, trade);
      await stateManager.applyTrades(channelId);

      const history = stateManager.getStateHistory(channelId);
      expect(history).to.have.lengthOf(2); // Initial + new state
      expect(history[1].nonce).to.equal(1);
    });
  });

  describe("State Signing", function () {
    it("Should sign current state", async function () {
      const signature = await stateManager.signState(channelId);
      expect(signature).to.be.a("string");
      expect(signature).to.have.lengthOf(132); // Standard signature length

      const state = stateManager.getState(channelId);
      expect(state?.signatures.get(alice.address)).to.equal(signature);
    });

    it("Should verify valid signatures", async function () {
      // Sign with Alice
      await stateManager.signState(channelId);
      
      // Create Bob's state manager and sign
      const bobStateManager = new StateManager(bob);
      const state = stateManager.getState(channelId)!;
      
      // Bob needs to have the same state
      const balances = new Map<string, ethers.BigNumber>();
      balances.set(alice.address, ethers.utils.parseEther("100"));
      balances.set(bob.address, ethers.utils.parseEther("100"));
      await bobStateManager.initializeChannel(channelId, participants, balances);
      
      const bobSignature = await bobStateManager.signState(channelId);
      state.signatures.set(bob.address, bobSignature);

      const isValid = await stateManager.verifyStateSignatures(channelId, state, participants);
      expect(isValid).to.be.true;
    });

    it("Should reject invalid signatures", async function () {
      const state = stateManager.getState(channelId)!;
      state.signatures.set(alice.address, "0x" + "00".repeat(65)); // Invalid signature

      const isValid = await stateManager.verifyStateSignatures(channelId, state, [alice.address]);
      expect(isValid).to.be.false;
    });
  });

  describe("State Export/Import", function () {
    it("Should export state correctly", async function () {
      await stateManager.signState(channelId);
      const exported = await stateManager.exportState(channelId);
      
      const parsed = JSON.parse(exported);
      expect(parsed.channelId).to.equal(channelId);
      expect(parsed.nonce).to.equal(0);
      expect(parsed.balances).to.have.lengthOf(2);
    });

    it("Should import state correctly", async function () {
      // Export from one manager
      await stateManager.signState(channelId);
      const exported = await stateManager.exportState(channelId);

      // Import to new manager
      const newManager = new StateManager(bob);
      await newManager.importState(exported);

      const importedState = newManager.getState(channelId);
      expect(importedState).to.not.be.undefined;
      expect(importedState?.nonce).to.equal(0);
      expect(importedState?.balances.get(alice.address)).to.deep.equal(ethers.utils.parseEther("100"));
    });
  });

  describe("State Root Calculation", function () {
    it("Should calculate consistent state roots", async function () {
      const state1 = stateManager.getState(channelId)!;
      
      // Create same state in different order
      const balances2 = new Map<string, ethers.BigNumber>();
      balances2.set(bob.address, ethers.utils.parseEther("100")); // Bob first
      balances2.set(alice.address, ethers.utils.parseEther("100")); // Alice second

      const newChannelId = ethers.utils.id("channel-2");
      await stateManager.initializeChannel(newChannelId, [bob.address, alice.address], balances2);
      const state2 = stateManager.getState(newChannelId)!;

      // State roots should be the same despite different insertion order
      expect(state1.stateRoot).to.equal(state2.stateRoot);
    });
  });

  describe("Edge Cases", function () {
    it("Should handle trades to non-participants", async function () {
      const trade: Trade = {
        id: ethers.utils.id("trade-1"),
        from: alice.address,
        to: carol.address, // Not a participant
        amount: ethers.utils.parseEther("10"),
        timestamp: Date.now()
      };

      await stateManager.proposeTrade(channelId, trade);
      const newState = await stateManager.applyTrades(channelId);

      expect(newState.balances.get(carol.address)).to.deep.equal(ethers.utils.parseEther("10"));
    });

    it("Should handle zero-amount trades", async function () {
      const trade: Trade = {
        id: ethers.utils.id("trade-1"),
        from: alice.address,
        to: bob.address,
        amount: ethers.BigNumber.from(0),
        timestamp: Date.now()
      };

      await stateManager.proposeTrade(channelId, trade);
      const newState = await stateManager.applyTrades(channelId);

      expect(newState.nonce).to.equal(1); // Nonce still increments
      expect(newState.balances.get(alice.address)).to.deep.equal(ethers.utils.parseEther("100"));
      expect(newState.balances.get(bob.address)).to.deep.equal(ethers.utils.parseEther("100"));
    });
  });
});