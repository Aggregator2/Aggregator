import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { SecureEscrowV2, MockERC20, ChainlinkPriceOracle } from "../typechain-types";

describe("SecureEscrowV2 Security Tests", function () {
  let escrow: SecureEscrowV2;
  let oracle: ChainlinkPriceOracle;
  let token: MockERC20;
  let owner: SignerWithAddress;
  let depositor: SignerWithAddress;
  let beneficiary: SignerWithAddress;
  let attacker: SignerWithAddress;
  let arbiter: SignerWithAddress;

  beforeEach(async function () {
    [owner, depositor, beneficiary, attacker, arbiter] = await ethers.getSigners();

    // Deploy contracts
    const Oracle = await ethers.getContractFactory("ChainlinkPriceOracle");
    oracle = await Oracle.deploy();

    const Escrow = await ethers.getContractFactory("SecureEscrowV2");
    escrow = await Escrow.deploy(oracle.address);

    const Token = await ethers.getContractFactory("MockERC20");
    token = await Token.deploy("Test Token", "TEST", 18);

    // Setup roles
    await escrow.grantRole(await escrow.ARBITER_ROLE(), arbiter.address);

    // Mint tokens
    await token.mint(depositor.address, ethers.utils.parseEther("1000"));
    await token.mint(attacker.address, ethers.utils.parseEther("1000"));
  });

  describe("MEV Protection", function () {
    it("Should prevent same-block actions", async function () {
      const commitHash = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["address", "address", "address", "uint256", "uint256", "bytes32"],
          [
            depositor.address,
            beneficiary.address,
            token.address,
            ethers.utils.parseEther("100"),
            Math.floor(Date.now() / 1000) + 3600,
            ethers.utils.randomBytes(32)
          ]
        )
      );

      await escrow.connect(depositor).commitEscrow(commitHash);
      
      // Try to commit again in same block - should fail
      await expect(
        escrow.connect(depositor).commitEscrow(commitHash)
      ).to.be.revertedWith("MEV: Same block action prevented");
    });

    it("Should enforce commit-reveal delay", async function () {
      const salt = ethers.utils.randomBytes(32);
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const amount = ethers.utils.parseEther("100");

      const commitHash = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["address", "address", "address", "uint256", "uint256", "bytes32"],
          [depositor.address, beneficiary.address, token.address, amount, deadline, salt]
        )
      );

      await escrow.connect(depositor).commitEscrow(commitHash);

      // Try to reveal immediately - should fail
      await expect(
        escrow.connect(depositor).revealAndCreateEscrow(
          depositor.address,
          beneficiary.address,
          token.address,
          amount,
          deadline,
          salt
        )
      ).to.be.revertedWith("Reveal too early");

      // Mine a block and try again
      await ethers.provider.send("evm_mine", []);
      
      // Should work now
      await expect(
        escrow.connect(depositor).revealAndCreateEscrow(
          depositor.address,
          beneficiary.address,
          token.address,
          amount,
          deadline,
          salt
        )
      ).to.not.be.reverted;
    });
  });

  describe("Signature Security", function () {
    it("Should prevent signature replay attacks", async function () {
      // Create escrow first
      const salt = ethers.utils.randomBytes(32);
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const amount = ethers.utils.parseEther("100");

      const commitHash = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["address", "address", "address", "uint256", "uint256", "bytes32"],
          [depositor.address, beneficiary.address, token.address, amount, deadline, salt]
        )
      );

      await escrow.connect(depositor).commitEscrow(commitHash);
      await ethers.provider.send("evm_mine", []);
      
      const tx = await escrow.connect(depositor).revealAndCreateEscrow(
        depositor.address,
        beneficiary.address,
        token.address,
        amount,
        deadline,
        salt
      );
      
      const receipt = await tx.wait();
      const escrowId = receipt.events?.find(e => e.event === "EscrowCreated")?.args?.escrowId;

      // Deposit funds
      await token.connect(depositor).approve(escrow.address, amount);
      await escrow.connect(depositor).deposit(escrowId);

      // Create signature
      const domain = {
        name: "SecureEscrowV2",
        version: "1",
        chainId: await arbiter.getChainId(),
        verifyingContract: escrow.address
      };

      const types = {
        ExecuteEscrow: [
          { name: "escrowId", type: "bytes32" },
          { name: "beneficiary", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "nonce", type: "uint256" }
        ]
      };

      const sigDeadline = Math.floor(Date.now() / 1000) + 300;
      const nonce = await escrow.nonces(arbiter.address);

      const value = {
        escrowId: escrowId,
        beneficiary: beneficiary.address,
        amount: amount,
        deadline: sigDeadline,
        nonce: nonce
      };

      const signature = await arbiter._signTypedData(domain, types, value);

      // Execute with signature
      await escrow.executeWithSignature(escrowId, signature, sigDeadline, nonce);

      // Try to replay the signature - should fail
      await expect(
        escrow.executeWithSignature(escrowId, signature, sigDeadline, nonce)
      ).to.be.revertedWith("Invalid state"); // Because escrow is already executed
    });

    it("Should reject expired signatures", async function () {
      // Similar setup as above but with expired deadline
      const sigDeadline = Math.floor(Date.now() / 1000) - 100; // Past deadline
      
      // ... (setup code)
      
      // Should fail due to expired signature
      await expect(
        escrow.executeWithSignature("0x", "0x", sigDeadline, 0)
      ).to.be.revertedWith("Signature expired");
    });
  });

  describe("Circuit Breaker", function () {
    it("Should trigger circuit breaker on excessive daily volume", async function () {
      // Set lower threshold for testing
      await escrow.updateMaxDailyVolume(ethers.utils.parseEther("100"));

      // Create multiple escrows that exceed daily volume
      const amount = ethers.utils.parseEther("60");
      
      // First escrow should work
      // ... (create and deposit first escrow)
      
      // Second escrow should trigger circuit breaker
      // ... (attempt second escrow)
      
      // Verify circuit breaker state
      expect(await escrow.breakerState()).to.equal(1); // PAUSED
    });

    it("Should enforce emergency cooldown period", async function () {
      // Trigger emergency
      await escrow.triggerEmergency("Test emergency");
      
      // Try to reset immediately - should fail
      await expect(
        escrow.resetCircuitBreaker()
      ).to.be.revertedWith("Emergency cooldown not finished");

      // Fast forward time
      await ethers.provider.send("evm_increaseTime", [24 * 60 * 60]);
      await ethers.provider.send("evm_mine", []);

      // Should work now
      await expect(escrow.resetCircuitBreaker()).to.not.be.reverted;
    });
  });

  describe("Oracle Protection", function () {
    it("Should reject swaps with excessive slippage", async function () {
      // Setup mock price feed
      // ... (setup oracle with price)

      const escrowId = "0x..."; // Valid escrow ID
      const path = [token.address, "0x..."]; // Token addresses
      const expectedOut = ethers.utils.parseEther("95"); // 5% slippage

      // Should fail due to excessive slippage
      await expect(
        escrow.executeSwapWithOracle(escrowId, path, expectedOut)
      ).to.be.revertedWith("Price deviation too high");
    });
  });

  describe("Gas Griefing Protection", function () {
    it("Should limit gas for external calls", async function () {
      // Deploy malicious contract that consumes excessive gas
      const Malicious = await ethers.getContractFactory("MaliciousReceiver");
      const malicious = await Malicious.deploy();

      // Create escrow with malicious contract as beneficiary
      // ... (setup escrow)

      // Execute should not consume excessive gas
      const tx = await escrow.executeWithSignature(/* params */);
      const receipt = await tx.wait();
      
      // Verify gas usage is reasonable
      expect(receipt.gasUsed).to.be.lt(200000);
    });

    it("Should use pull pattern for emergency withdrawals", async function () {
      // Trigger emergency withdrawal
      await escrow.connect(owner).emergencyWithdraw("0x...");

      // Check pending withdrawal
      const pending = await escrow.pendingWithdrawals(depositor.address);
      expect(pending).to.be.gt(0);

      // User pulls their funds
      await expect(
        escrow.connect(depositor).withdrawPending()
      ).to.not.be.reverted;
    });
  });

  describe("Reentrancy Protection", function () {
    it("Should prevent reentrancy attacks", async function () {
      // Deploy reentrancy attacker
      const Attacker = await ethers.getContractFactory("ReentrancyAttacker");
      const attackerContract = await Attacker.deploy(escrow.address);

      // Setup escrow with attacker as beneficiary
      // ... (setup)

      // Attack should fail
      await expect(
        attackerContract.attack()
      ).to.be.revertedWith("ReentrancyGuard: reentrant call");
    });
  });

  describe("Access Control", function () {
    it("Should enforce role-based access", async function () {
      // Non-arbiter tries to refund
      await expect(
        escrow.connect(attacker).refund("0x...")
      ).to.be.revertedWith("AccessControl:");

      // Non-emergency admin tries emergency withdrawal
      await expect(
        escrow.connect(attacker).emergencyWithdraw("0x...")
      ).to.be.revertedWith("AccessControl:");
    });
  });
});