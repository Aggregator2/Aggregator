import { expect } from "chai";
import { ethers } from "hardhat";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { DisputeResolutionEscrow, MockERC20, MockUniswapV2Router } from "../typechain-types";

describe("DisputeResolutionEscrow - Comprehensive Tests", function () {
  // Constants
  const DISPUTE_TIMEOUT = 7 * 24 * 60 * 60; // 7 days
  const SOLVER_TIMEOUT = 7 * 24 * 60 * 60; // 7 days
  const DEPOSIT_AMOUNT = ethers.utils.parseEther("10");
  const ZERO_ADDRESS = ethers.constants.AddressZero;

  // Fixture for deployment
  async function deployEscrowFixture() {
    const [owner, depositor, solver, attacker, arbitrator] = await ethers.getSigners();

    // Deploy mock tokens
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const depositToken = await MockERC20.deploy("Deposit Token", "DEP", 18);
    const settlementToken = await MockERC20.deploy("Settlement Token", "SET", 18);
    const wrongToken = await MockERC20.deploy("Wrong Token", "WRG", 18);

    // Deploy mock Uniswap router
    const MockRouter = await ethers.getContractFactory("MockUniswapV2Router");
    const uniswapRouter = await MockRouter.deploy();

    // Deploy escrow contract
    const Escrow = await ethers.getContractFactory("DisputeResolutionEscrow");
    const escrow = await Escrow.deploy(
      depositor.address,
      solver.address,
      depositToken.address,
      settlementToken.address,
      uniswapRouter.address
    );

    // Setup tokens
    await depositToken.mint(depositor.address, ethers.utils.parseEther("1000"));
    await settlementToken.mint(uniswapRouter.address, ethers.utils.parseEther("1000"));
    await wrongToken.mint(attacker.address, ethers.utils.parseEther("1000"));

    // Setup router
    await uniswapRouter.setSwapRate(depositToken.address, settlementToken.address, 95); // 0.95 exchange rate

    return { escrow, depositToken, settlementToken, wrongToken, uniswapRouter, owner, depositor, solver, attacker, arbitrator };
  }

  describe("1. Solver Timeout Scenarios", function () {
    it("Should allow emergency withdrawal after solver timeout", async function () {
      const { escrow, depositToken, depositor } = await loadFixture(deployEscrowFixture);

      // Deposit funds
      await depositToken.connect(depositor).approve(escrow.address, DEPOSIT_AMOUNT);
      await escrow.connect(depositor).deposit(DEPOSIT_AMOUNT);

      // Fast forward past solver timeout
      await time.increase(SOLVER_TIMEOUT + DISPUTE_TIMEOUT + 1);

      // Emergency withdrawal should work
      await expect(escrow.connect(depositor).emergencyWithdraw())
        .to.emit(escrow, "FundsRefunded")
        .withArgs(depositor.address, DEPOSIT_AMOUNT);

      expect(await escrow.currentState()).to.equal(5); // REFUNDED
    });

    it("Should NOT allow emergency withdrawal before timeout", async function () {
      const { escrow, depositToken, depositor } = await loadFixture(deployEscrowFixture);

      await depositToken.connect(depositor).approve(escrow.address, DEPOSIT_AMOUNT);
      await escrow.connect(depositor).deposit(DEPOSIT_AMOUNT);

      // Try emergency withdrawal immediately
      await expect(escrow.connect(depositor).emergencyWithdraw())
        .to.be.revertedWith("Emergency withdrawal not available");
    });

    it("Should unlock escrow after dispute deadline", async function () {
      const { escrow, depositToken, depositor, solver } = await loadFixture(deployEscrowFixture);

      // Setup and create dispute
      await depositToken.connect(depositor).approve(escrow.address, DEPOSIT_AMOUNT);
      await escrow.connect(depositor).deposit(DEPOSIT_AMOUNT);
      await escrow.connect(depositor).raiseDispute();

      // Fast forward past dispute deadline
      await time.increase(DISPUTE_TIMEOUT + 1);

      // Should resolve to Uniswap settlement by default
      await expect(escrow.resolveDispute())
        .to.emit(escrow, "SettledViaUniswap");

      expect(await escrow.currentState()).to.equal(6); // SETTLED_VIA_UNISWAP
    });
  });

  describe("2. Partial Fill Scenarios", function () {
    it("Should handle partial fills with refund mechanism", async function () {
      const { depositor, solver } = await loadFixture(deployEscrowFixture);
      
      // Deploy enhanced escrow with partial fill support
      const EnhancedEscrow = await ethers.getContractFactory("EnhancedDisputeResolutionEscrow");
      const enhancedEscrow = await EnhancedEscrow.deploy(
        depositor.address,
        solver.address,
        ZERO_ADDRESS,
        ZERO_ADDRESS,
        ZERO_ADDRESS
      );

      // Test partial fill functionality
      const totalAmount = ethers.utils.parseEther("100");
      const filledAmount = ethers.utils.parseEther("60");
      
      await enhancedEscrow.connect(depositor).deposit({ value: totalAmount });
      await enhancedEscrow.connect(solver).providePartialSolution(filledAmount);
      
      // Accept partial solution
      await expect(enhancedEscrow.connect(depositor).acceptPartialSolution())
        .to.changeEtherBalances(
          [solver, enhancedEscrow],
          [filledAmount, filledAmount.mul(-1)]
        );

      // Refund remaining
      const remaining = totalAmount.sub(filledAmount);
      await expect(enhancedEscrow.connect(depositor).refundRemaining())
        .to.changeEtherBalances(
          [depositor, enhancedEscrow],
          [remaining, remaining.mul(-1)]
        );
    });
  });

  describe("3. Wrong Token Delivery", function () {
    it("Should handle dispute for wrong token delivery", async function () {
      const { escrow, depositToken, wrongToken, depositor, solver, attacker } = await loadFixture(deployEscrowFixture);

      // Deposit correct token
      await depositToken.connect(depositor).approve(escrow.address, DEPOSIT_AMOUNT);
      await escrow.connect(depositor).deposit(DEPOSIT_AMOUNT);

      // Solver provides solution
      await escrow.connect(solver).provideSolution();

      // Depositor raises dispute due to wrong token delivery
      await escrow.connect(depositor).raiseDispute();

      // Set UI override to return funds
      await escrow.connect(depositor).setUIOverride(1); // RETURN_TO_DEPOSITOR

      // Resolve dispute
      await expect(escrow.resolveDispute())
        .to.emit(escrow, "FundsRefunded")
        .withArgs(depositor.address, DEPOSIT_AMOUNT);

      // Verify depositor got funds back
      expect(await depositToken.balanceOf(depositor.address)).to.equal(ethers.utils.parseEther("1000"));
    });
  });

  describe("4. Emergency Pause", function () {
    it("Should allow emergency pause and fund withdrawal", async function () {
      const { owner, depositor, solver } = await loadFixture(deployEscrowFixture);
      
      // Deploy pausable escrow
      const PausableEscrow = await ethers.getContractFactory("PausableDisputeResolutionEscrow");
      const pausableEscrow = await PausableEscrow.deploy(
        depositor.address,
        solver.address,
        ZERO_ADDRESS,
        ZERO_ADDRESS,
        ZERO_ADDRESS,
        owner.address // emergency admin
      );

      // Deposit ETH
      await pausableEscrow.connect(depositor).deposit({ value: DEPOSIT_AMOUNT });

      // Emergency pause by admin
      await pausableEscrow.connect(owner).pause();

      // All parties should be able to withdraw during pause
      await expect(pausableEscrow.connect(depositor).emergencyWithdrawPaused())
        .to.changeEtherBalances(
          [depositor, pausableEscrow],
          [DEPOSIT_AMOUNT, DEPOSIT_AMOUNT.mul(-1)]
        );
    });
  });

  describe("5. MEV Protection", function () {
    it("Should protect against sandwich attacks", async function () {
      const { escrow, depositToken, settlementToken, uniswapRouter, depositor, attacker } = await loadFixture(deployEscrowFixture);

      // Setup
      await depositToken.connect(depositor).approve(escrow.address, DEPOSIT_AMOUNT);
      await escrow.connect(depositor).deposit(DEPOSIT_AMOUNT);
      await escrow.connect(depositor).raiseDispute();

      // Attacker tries to front-run the Uniswap settlement
      const attackAmount = ethers.utils.parseEther("100");
      await depositToken.mint(attacker.address, attackAmount);
      await depositToken.connect(attacker).approve(uniswapRouter.address, attackAmount);

      // Attacker manipulates price
      await uniswapRouter.connect(attacker).swapExactTokensForTokens(
        attackAmount,
        0,
        [depositToken.address, settlementToken.address],
        attacker.address,
        ethers.constants.MaxUint256
      );

      // Fast forward to allow dispute resolution
      await time.increase(DISPUTE_TIMEOUT + 1);

      // Escrow should have slippage protection
      await expect(escrow.resolveDispute()).to.not.be.reverted;
      
      // User should receive reasonable amount despite MEV attack
      const userBalance = await settlementToken.balanceOf(depositor.address);
      expect(userBalance).to.be.gt(0);
    });

    it("Should use commit-reveal pattern for sensitive operations", async function () {
      const { depositor, solver } = await loadFixture(deployEscrowFixture);
      
      // Deploy MEV-protected escrow
      const MEVProtectedEscrow = await ethers.getContractFactory("MEVProtectedEscrow");
      const mevEscrow = await MEVProtectedEscrow.deploy(
        depositor.address,
        solver.address
      );

      // Commit phase
      const secret = ethers.utils.id("secret123");
      const commitment = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(["uint256", "bytes32"], [DEPOSIT_AMOUNT, secret])
      );
      
      await mevEscrow.connect(depositor).commitDeposit(commitment);
      
      // Wait for reveal period
      await time.increase(300); // 5 minutes
      
      // Reveal phase
      await mevEscrow.connect(depositor).revealDeposit(DEPOSIT_AMOUNT, secret, { value: DEPOSIT_AMOUNT });
      
      expect(await mevEscrow.depositAmount()).to.equal(DEPOSIT_AMOUNT);
    });
  });

  describe("6. Multi-signature Approval", function () {
    it("Should require multi-sig for large escrow releases", async function () {
      const { depositor, solver, arbitrator } = await loadFixture(deployEscrowFixture);
      
      // Deploy multi-sig escrow
      const MultiSigEscrow = await ethers.getContractFactory("MultiSigDisputeResolutionEscrow");
      const multiSigEscrow = await MultiSigEscrow.deploy(
        depositor.address,
        solver.address,
        [depositor.address, solver.address, arbitrator.address],
        2 // required signatures
      );

      const largeAmount = ethers.utils.parseEther("1000");
      await multiSigEscrow.connect(depositor).deposit({ value: largeAmount });
      await multiSigEscrow.connect(solver).provideSolution();

      // First approval
      await multiSigEscrow.connect(depositor).approveLargeRelease();
      
      // Should not release yet
      expect(await ethers.provider.getBalance(multiSigEscrow.address)).to.equal(largeAmount);

      // Second approval
      await expect(multiSigEscrow.connect(arbitrator).approveLargeRelease())
        .to.emit(multiSigEscrow, "LargeReleaseApproved")
        .withArgs(solver.address, largeAmount);

      // Funds should be released
      expect(await ethers.provider.getBalance(multiSigEscrow.address)).to.equal(0);
    });
  });

  describe("7. Event Indexing", function () {
    it("Should emit properly indexed events", async function () {
      const { escrow, depositToken, depositor, solver } = await loadFixture(deployEscrowFixture);

      // Test all events are properly indexed
      await depositToken.connect(depositor).approve(escrow.address, DEPOSIT_AMOUNT);
      
      // Deposited event
      await expect(escrow.connect(depositor).deposit(DEPOSIT_AMOUNT))
        .to.emit(escrow, "Deposited")
        .withArgs(depositor.address, DEPOSIT_AMOUNT);

      // SolutionProvided event
      await expect(escrow.connect(solver).provideSolution())
        .to.emit(escrow, "SolutionProvided")
        .withArgs(solver.address);

      // DisputeRaised event
      const tx = await escrow.connect(depositor).raiseDispute();
      const receipt = await tx.wait();
      const disputeEvent = receipt.events?.find(e => e.event === "DisputeRaised");
      
      expect(disputeEvent?.args?.raiser).to.equal(depositor.address);
      expect(disputeEvent?.args?.deadline).to.be.gt(0);
    });

    it("Should allow efficient event filtering", async function () {
      const { escrow, depositToken, depositor } = await loadFixture(deployEscrowFixture);

      // Create multiple deposits
      for (let i = 0; i < 5; i++) {
        await depositToken.connect(depositor).approve(escrow.address, DEPOSIT_AMOUNT);
        await escrow.connect(depositor).deposit(DEPOSIT_AMOUNT);
        
        // Reset for next iteration
        if (i < 4) {
          await escrow.connect(depositor).emergencyWithdraw();
          await time.increase(SOLVER_TIMEOUT + DISPUTE_TIMEOUT + 1);
        }
      }

      // Query events
      const filter = escrow.filters.Deposited(depositor.address);
      const events = await escrow.queryFilter(filter);
      
      expect(events.length).to.be.gte(1);
      expect(events[0].args.depositor).to.equal(depositor.address);
    });
  });

  describe("8. State Transition Tests", function () {
    it("Should properly transition through all states", async function () {
      const { escrow, depositToken, depositor, solver } = await loadFixture(deployEscrowFixture);

      // Initial state
      expect(await escrow.currentState()).to.equal(0); // AWAITING_DEPOSIT

      // Deposit -> AWAITING_SOLUTION
      await depositToken.connect(depositor).approve(escrow.address, DEPOSIT_AMOUNT);
      await escrow.connect(depositor).deposit(DEPOSIT_AMOUNT);
      expect(await escrow.currentState()).to.equal(1); // AWAITING_SOLUTION

      // Provide solution -> SOLUTION_PROVIDED
      await escrow.connect(solver).provideSolution();
      expect(await escrow.currentState()).to.equal(2); // SOLUTION_PROVIDED

      // Accept solution -> COMPLETED
      await escrow.connect(depositor).acceptSolution();
      expect(await escrow.currentState()).to.equal(3); // COMPLETED
    });
  });
});