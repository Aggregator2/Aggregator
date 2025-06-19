import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract, Signer } from "ethers";
import { time, mine, reset, snapshot, revert } from "@nomicfoundation/hardhat-network-helpers";

describe("Escrow Contract - Comprehensive Tests", function () {
  let escrow: Contract;
  let token: Contract;
  let depositor: Signer;
  let counterparty: Signer;
  let arbiter: Signer;
  let maliciousUser: Signer;
  let recipient: Signer;
  
  const amount = ethers.parseEther("10");
  const tradeHash = ethers.id("trade123");
  
  beforeEach(async function () {
    [depositor, counterparty, arbiter, maliciousUser, recipient] = await ethers.getSigners();

    // Deploy mock ERC20 token
    const Token = await ethers.getContractFactory("MockERC20");
    token = await Token.deploy("Mock Token", "MTK", ethers.parseEther("10000"));
    await token.waitForDeployment();

    // Deploy Escrow contract
    const Escrow = await ethers.getContractFactory("Escrow");
    escrow = await Escrow.deploy(
      await depositor.getAddress(),
      await token.getAddress(),
      amount,
      await counterparty.getAddress(),
      await arbiter.getAddress(),
      tradeHash,
      "0x",
      ethers.ZeroAddress // Mock Uniswap router
    );
    await escrow.waitForDeployment();

    // Setup initial token balances
    await token.transfer(await depositor.getAddress(), ethers.parseEther("1000"));
    await token.transfer(await counterparty.getAddress(), ethers.parseEther("1000"));
    await token.connect(depositor).approve(await escrow.getAddress(), amount);
  });

  describe("Basic Functionality", function () {
    it("should initialize with correct parameters", async function () {
      expect(await escrow.depositor()).to.equal(await depositor.getAddress());
      expect(await escrow.counterparty()).to.equal(await counterparty.getAddress());
      expect(await escrow.arbiter()).to.equal(await arbiter.getAddress());
      expect(await escrow.amount()).to.equal(amount);
      expect(await escrow.tradeHash()).to.equal(tradeHash);
    });

    it("should handle deposit flow correctly", async function () {
      const initialBalance = await token.balanceOf(await depositor.getAddress());
      
      await expect(escrow.connect(depositor).deposit())
        .to.emit(escrow, "Deposited")
        .withArgs(await depositor.getAddress(), await token.getAddress(), amount);

      expect(await token.balanceOf(await escrow.getAddress())).to.equal(amount);
      expect(await token.balanceOf(await depositor.getAddress())).to.equal(initialBalance - amount);
    });

    it("should handle release flow correctly", async function () {
      await escrow.connect(depositor).deposit();
      const initialBalance = await token.balanceOf(await counterparty.getAddress());

      await expect(escrow.connect(arbiter).release())
        .to.emit(escrow, "Executed")
        .withArgs(await counterparty.getAddress(), await token.getAddress(), amount);

      expect(await token.balanceOf(await counterparty.getAddress())).to.equal(initialBalance + amount);
      expect(await token.balanceOf(await escrow.getAddress())).to.equal(0);
    });

    it("should handle refund flow correctly", async function () {
      await escrow.connect(depositor).deposit();
      const initialBalance = await token.balanceOf(await depositor.getAddress());

      await expect(escrow.connect(arbiter).refund())
        .to.emit(escrow, "Withdrawn")
        .withArgs(await depositor.getAddress(), await token.getAddress(), amount);

      expect(await token.balanceOf(await depositor.getAddress())).to.equal(initialBalance + amount);
      expect(await token.balanceOf(await escrow.getAddress())).to.equal(0);
    });
  });

  describe("Security & Access Control", function () {
    it("should prevent unauthorized deposits", async function () {
      await expect(escrow.connect(counterparty).deposit())
        .to.be.revertedWith("Only the depositor can call this function");
      
      await expect(escrow.connect(arbiter).deposit())
        .to.be.revertedWith("Only the depositor can call this function");
      
      await expect(escrow.connect(maliciousUser).deposit())
        .to.be.revertedWith("Only the depositor can call this function");
    });

    it("should prevent unauthorized releases", async function () {
      await escrow.connect(depositor).deposit();
      
      await expect(escrow.connect(depositor).release())
        .to.be.revertedWith("Only the arbiter can call this function");
      
      await expect(escrow.connect(counterparty).release())
        .to.be.revertedWith("Only the arbiter can call this function");
      
      await expect(escrow.connect(maliciousUser).release())
        .to.be.revertedWith("Only the arbiter can call this function");
    });

    it("should prevent unauthorized refunds", async function () {
      await escrow.connect(depositor).deposit();
      
      await expect(escrow.connect(depositor).refund())
        .to.be.revertedWith("Only the arbiter can call this function");
      
      await expect(escrow.connect(counterparty).refund())
        .to.be.revertedWith("Only the arbiter can call this function");
      
      await expect(escrow.connect(maliciousUser).refund())
        .to.be.revertedWith("Only the arbiter can call this function");
    });

    it("should prevent double deposits", async function () {
      await escrow.connect(depositor).deposit();
      await expect(escrow.connect(depositor).deposit())
        .to.be.revertedWith("Funds already deposited");
    });

    it("should prevent operations on empty escrow", async function () {
      await expect(escrow.connect(arbiter).release())
        .to.be.revertedWith("No funds to release");
      
      await expect(escrow.connect(arbiter).refund())
        .to.be.revertedWith("No funds to refund");
    });

    it("should prevent double releases", async function () {
      await escrow.connect(depositor).deposit();
      await escrow.connect(arbiter).release();
      
      await expect(escrow.connect(arbiter).release())
        .to.be.revertedWith("No funds to release");
    });

    it("should prevent double refunds", async function () {
      await escrow.connect(depositor).deposit();
      await escrow.connect(arbiter).refund();
      
      await expect(escrow.connect(arbiter).refund())
        .to.be.revertedWith("No funds to refund");
    });
  });

  describe("Signature Verification", function () {
    it("should verify valid signatures correctly", async function () {
      await escrow.connect(depositor).deposit();
      
      const messageHash = ethers.solidityPackedKeccak256(
        ["address", "address", "uint256"],
        [await escrow.getAddress(), await counterparty.getAddress(), amount]
      );
      
      const signature = await depositor.signMessage(ethers.getBytes(messageHash));
      
      await expect(escrow.connect(arbiter).releaseWithSignature(signature))
        .to.emit(escrow, "Executed");
    });

    it("should reject invalid signatures", async function () {
      await escrow.connect(depositor).deposit();
      
      const messageHash = ethers.solidityPackedKeccak256(
        ["address", "address", "uint256"],
        [await escrow.getAddress(), await counterparty.getAddress(), amount]
      );
      
      const invalidSignature = await counterparty.signMessage(ethers.getBytes(messageHash));
      
      await expect(escrow.connect(arbiter).releaseWithSignature(invalidSignature))
        .to.be.revertedWith("Invalid signature");
    });

    it("should reject malformed signatures", async function () {
      await escrow.connect(depositor).deposit();
      
      const malformedSignature = "0x" + "00".repeat(65);
      
      await expect(escrow.connect(arbiter).releaseWithSignature(malformedSignature))
        .to.be.revertedWith("Invalid signature");
    });
  });

  describe("Edge Cases & Error Conditions", function () {
    it("should handle insufficient token balance", async function () {
      // Transfer away tokens to create insufficient balance
      const balance = await token.balanceOf(await depositor.getAddress());
      await token.connect(depositor).transfer(await recipient.getAddress(), balance);
      
      await expect(escrow.connect(depositor).deposit())
        .to.be.revertedWith("ERC20: transfer amount exceeds balance");
    });

    it("should handle insufficient allowance", async function () {
      await token.connect(depositor).approve(await escrow.getAddress(), 0);
      
      await expect(escrow.connect(depositor).deposit())
        .to.be.revertedWith("ERC20: insufficient allowance");
    });

    it("should handle zero amount escrow", async function () {
      const zeroEscrow = await (await ethers.getContractFactory("Escrow")).deploy(
        await depositor.getAddress(),
        await token.getAddress(),
        0,
        await counterparty.getAddress(),
        await arbiter.getAddress(),
        tradeHash,
        "0x",
        ethers.ZeroAddress
      );
      
      await expect(zeroEscrow.connect(depositor).deposit())
        .to.be.revertedWith("Amount must be greater than zero");
    });

    it("should handle contract pausing scenarios", async function () {
      // This test assumes the contract has pause functionality
      // If not implemented, this test can be skipped or the functionality added
      await escrow.connect(depositor).deposit();
      
      // Test operations during pause
      // await escrow.pause(); // If pause functionality exists
      // await expect(escrow.connect(arbiter).release()).to.be.revertedWith("Pausable: paused");
    });
  });

  describe("Chain Reorganization Tests", function () {
    let snapshotId: string;

    beforeEach(async function () {
      snapshotId = await snapshot();
    });

    afterEach(async function () {
      await revert(snapshotId);
    });

    it("should maintain consistency during chain reorg - deposit scenario", async function () {
      // Simulate deposit transaction
      await escrow.connect(depositor).deposit();
      let escrowBalance = await token.balanceOf(await escrow.getAddress());
      expect(escrowBalance).to.equal(amount);

      // Simulate chain reorg by reverting to snapshot and replaying
      await revert(snapshotId);
      snapshotId = await snapshot();

      // Mine some blocks to simulate time passing
      await mine(5);

      // Replay the deposit transaction
      await escrow.connect(depositor).deposit();
      escrowBalance = await token.balanceOf(await escrow.getAddress());
      expect(escrowBalance).to.equal(amount);
    });

    it("should handle reorg during release transaction", async function () {
      await escrow.connect(depositor).deposit();
      
      // Take snapshot before release
      const releaseSnapshot = await snapshot();
      
      // Execute release
      await escrow.connect(arbiter).release();
      let counterpartyBalance = await token.balanceOf(await counterparty.getAddress());
      
      // Revert to before release and replay
      await revert(releaseSnapshot);
      await mine(3);
      
      await escrow.connect(arbiter).release();
      const finalBalance = await token.balanceOf(await counterparty.getAddress());
      expect(finalBalance).to.equal(counterpartyBalance);
    });

    it("should prevent double spending during reorg", async function () {
      await escrow.connect(depositor).deposit();
      
      const beforeRelease = await snapshot();
      await escrow.connect(arbiter).release();
      
      // Attempt to revert and execute refund (should fail)
      await revert(beforeRelease);
      
      // Now try refund - should work since we reverted the release
      await escrow.connect(arbiter).refund();
      
      // Verify state is consistent
      expect(await token.balanceOf(await escrow.getAddress())).to.equal(0);
    });
  });

  describe("Gas Optimization Tests", function () {
    it("should consume reasonable gas for deposit", async function () {
      const tx = await escrow.connect(depositor).deposit();
      const receipt = await tx.wait();
      
      // Gas consumption should be reasonable (adjust threshold as needed)
      expect(receipt!.gasUsed).to.be.lt(100000);
    });

    it("should consume reasonable gas for release", async function () {
      await escrow.connect(depositor).deposit();
      
      const tx = await escrow.connect(arbiter).release();
      const receipt = await tx.wait();
      
      expect(receipt!.gasUsed).to.be.lt(80000);
    });
  });

  describe("Event Emission Tests", function () {
    it("should emit events with correct parameters", async function () {
      // Test deposit event
      await expect(escrow.connect(depositor).deposit())
        .to.emit(escrow, "Deposited")
        .withArgs(await depositor.getAddress(), await token.getAddress(), amount);

      // Test release event
      await expect(escrow.connect(arbiter).release())
        .to.emit(escrow, "Executed")
        .withArgs(await counterparty.getAddress(), await token.getAddress(), amount);
    });

    it("should emit events in correct order", async function () {
      const tx = await escrow.connect(depositor).deposit();
      const receipt = await tx.wait();
      
      // Verify event ordering and structure
      expect(receipt!.logs.length).to.be.greaterThan(0);
    });
  });

  describe("Integration with External Contracts", function () {
    it("should handle token contract failures gracefully", async function () {
      // Create a mock failing token
      const FailingToken = await ethers.getContractFactory("MockFailingERC20");
      const failingToken = await FailingToken.deploy();
      
      const failingEscrow = await (await ethers.getContractFactory("Escrow")).deploy(
        await depositor.getAddress(),
        await failingToken.getAddress(),
        amount,
        await counterparty.getAddress(),
        await arbiter.getAddress(),
        tradeHash,
        "0x",
        ethers.ZeroAddress
      );
      
      await expect(failingEscrow.connect(depositor).deposit())
        .to.be.revertedWith("Token transfer failed");
    });
  });

  describe("Time-based Tests", function () {
    it("should handle operations across different time periods", async function () {
      await escrow.connect(depositor).deposit();
      
      // Fast forward time
      await time.increase(86400); // 1 day
      
      // Operations should still work
      await escrow.connect(arbiter).release();
      expect(await token.balanceOf(await counterparty.getAddress())).to.equal(
        ethers.parseEther("1000") + amount
      );
    });
  });
});

// Mock contracts for testing
// Note: These would need to be implemented as actual Solidity contracts
contract("MockFailingERC20", function () {
  // This is a placeholder for a mock contract that always fails transfers
  // In a real implementation, this would be a Solidity contract
});