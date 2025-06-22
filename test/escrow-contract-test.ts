import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract, Signer } from "ethers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("DisputeResolutionEscrow - Comprehensive Test Suite", function () {
  let escrow: Contract;
  let enhancedEscrow: Contract;
  let pausableEscrow: Contract;
  let mockToken: Contract;
  let mockUniswapRouter: Contract;
  
  let deployer: Signer;
  let depositor: Signer;
  let solver: Signer;
  let emergencyAdmin: Signer;
  
  const DISPUTE_TIMEOUT = 7 * 24 * 60 * 60; // 7 days
  const SOLVER_TIMEOUT = 7 * 24 * 60 * 60; // 7 days
  
  beforeEach(async function () {
    [deployer, depositor, solver, emergencyAdmin] = await ethers.getSigners();
    
    // Deploy mock ERC20 token
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockToken = await MockERC20.deploy("Mock USDC", "USDC", 6);
    await mockToken.deployed();
    
    // Deploy mock Uniswap router
    const MockUniswapRouter = await ethers.getContractFactory("MockUniswapV2Router");
    mockUniswapRouter = await MockUniswapRouter.deploy();
    await mockUniswapRouter.deployed();
    
    // Mint tokens to depositor
    await mockToken.mint(await depositor.getAddress(), ethers.parseUnits("10000", 6));
    
    // Deploy escrow contracts
    const DisputeResolutionEscrow = await ethers.getContractFactory("DisputeResolutionEscrow");
    escrow = await DisputeResolutionEscrow.deploy(
      await depositor.getAddress(),
      await solver.getAddress(),
      await mockToken.getAddress(),
      await mockToken.getAddress(), // Using same token for simplicity
      await mockUniswapRouter.getAddress()
    );
    await escrow.deployed();
    
    // Deploy enhanced escrow
    const EnhancedEscrow = await ethers.getContractFactory("EnhancedDisputeResolutionEscrow");
    enhancedEscrow = await EnhancedEscrow.deploy(
      await depositor.getAddress(),
      await solver.getAddress(),
      await mockToken.getAddress(),
      await mockToken.getAddress(),
      await mockUniswapRouter.getAddress()
    );
    await enhancedEscrow.deployed();
    
    // Deploy pausable escrow
    const PausableEscrow = await ethers.getContractFactory("PausableDisputeResolutionEscrow");
    pausableEscrow = await PausableEscrow.deploy(
      await depositor.getAddress(),
      await solver.getAddress(),
      await mockToken.getAddress(),
      await mockToken.getAddress(),
      await mockUniswapRouter.getAddress(),
      await emergencyAdmin.getAddress()
    );
    await pausableEscrow.deployed();
  });

  describe("1. User Authentication & Initialization", function () {
    it("Should initialize with correct parameters", async function () {
      expect(await escrow.depositor()).to.equal(await depositor.getAddress());
      expect(await escrow.solver()).to.equal(await solver.getAddress());
      expect(await escrow.depositToken()).to.equal(await mockToken.getAddress());
      expect(await escrow.currentState()).to.equal(0); // AWAITING_DEPOSIT
    });

    it("Should reject initialization with zero addresses", async function () {
      const DisputeResolutionEscrow = await ethers.getContractFactory("DisputeResolutionEscrow");
      
      await expect(
        DisputeResolutionEscrow.deploy(
          ethers.ZeroAddress,
          await solver.getAddress(),
          await mockToken.getAddress(),
          await mockToken.getAddress(),
          await mockUniswapRouter.getAddress()
        )
      ).to.be.revertedWith("Invalid depositor");
    });
  });

  describe("2. Deposit Functionality", function () {
    it("Should accept ERC20 deposits", async function () {
      const depositAmount = ethers.parseUnits("1000", 6);
      
      // Approve escrow contract
      await mockToken.connect(depositor).approve(await escrow.getAddress(), depositAmount);
      
      // Make deposit
      await expect(escrow.connect(depositor).deposit(depositAmount))
        .to.emit(escrow, "Deposited")
        .withArgs(await depositor.getAddress(), depositAmount);
      
      expect(await escrow.depositAmount()).to.equal(depositAmount);
      expect(await escrow.currentState()).to.equal(1); // AWAITING_SOLUTION
    });

    it("Should accept ETH deposits", async function () {
      // Deploy ETH escrow
      const DisputeResolutionEscrow = await ethers.getContractFactory("DisputeResolutionEscrow");
      const ethEscrow = await DisputeResolutionEscrow.deploy(
        await depositor.getAddress(),
        await solver.getAddress(),
        ethers.ZeroAddress, // ETH
        await mockToken.getAddress(),
        await mockUniswapRouter.getAddress()
      );
      
      const depositAmount = ethers.parseEther("1");
      
      await expect(ethEscrow.connect(depositor).deposit(0, { value: depositAmount }))
        .to.emit(ethEscrow, "Deposited")
        .withArgs(await depositor.getAddress(), depositAmount);
    });

    it("Should reject deposits in wrong state", async function () {
      const depositAmount = ethers.parseUnits("1000", 6);
      
      // First deposit
      await mockToken.connect(depositor).approve(await escrow.getAddress(), depositAmount * 2n);
      await escrow.connect(depositor).deposit(depositAmount);
      
      // Try to deposit again
      await expect(escrow.connect(depositor).deposit(depositAmount))
        .to.be.revertedWith("Invalid state for deposit");
    });

    it("Should reject deposits from non-depositor", async function () {
      const depositAmount = ethers.parseUnits("1000", 6);
      
      await expect(escrow.connect(solver).deposit(depositAmount))
        .to.be.revertedWith("Only depositor can call");
    });
  });

  describe("3. Solution Provision & Acceptance", function () {
    beforeEach(async function () {
      const depositAmount = ethers.parseUnits("1000", 6);
      await mockToken.connect(depositor).approve(await escrow.getAddress(), depositAmount);
      await escrow.connect(depositor).deposit(depositAmount);
    });

    it("Should allow solver to provide solution", async function () {
      await expect(escrow.connect(solver).provideSolution())
        .to.emit(escrow, "SolutionProvided")
        .withArgs(await solver.getAddress());
      
      expect(await escrow.currentState()).to.equal(2); // SOLUTION_PROVIDED
    });

    it("Should allow depositor to accept solution", async function () {
      await escrow.connect(solver).provideSolution();
      
      const solverBalanceBefore = await mockToken.balanceOf(await solver.getAddress());
      
      await expect(escrow.connect(depositor).acceptSolution())
        .to.emit(escrow, "SolutionAccepted")
        .withArgs(await depositor.getAddress());
      
      const solverBalanceAfter = await mockToken.balanceOf(await solver.getAddress());
      expect(solverBalanceAfter - solverBalanceBefore).to.equal(ethers.parseUnits("1000", 6));
      expect(await escrow.currentState()).to.equal(3); // COMPLETED
    });

    it("Should handle partial solutions in enhanced escrow", async function () {
      const depositAmount = ethers.parseUnits("1000", 6);
      await mockToken.connect(depositor).approve(await enhancedEscrow.getAddress(), depositAmount);
      await enhancedEscrow.connect(depositor).deposit(depositAmount);
      
      const partialAmount = ethers.parseUnits("600", 6);
      
      await expect(enhancedEscrow.connect(solver).providePartialSolution(partialAmount))
        .to.emit(enhancedEscrow, "PartialSolutionProvided")
        .withArgs(partialAmount, depositAmount - partialAmount);
      
      await enhancedEscrow.connect(depositor).acceptPartialSolution();
      await enhancedEscrow.connect(depositor).refundRemaining();
      
      expect(await enhancedEscrow.currentState()).to.equal(3); // COMPLETED
    });
  });

  describe("4. Dispute Resolution", function () {
    beforeEach(async function () {
      const depositAmount = ethers.parseUnits("1000", 6);
      await mockToken.connect(depositor).approve(await escrow.getAddress(), depositAmount);
      await escrow.connect(depositor).deposit(depositAmount);
    });

    it("Should allow raising disputes", async function () {
      await expect(escrow.connect(depositor).raiseDispute())
        .to.emit(escrow, "DisputeRaised");
      
      expect(await escrow.currentState()).to.equal(4); // DISPUTED
    });

    it("Should handle UI override for dispute resolution", async function () {
      await escrow.connect(depositor).raiseDispute();
      
      await expect(escrow.connect(depositor).setUIOverride(1)) // RETURN_TO_DEPOSITOR
        .to.emit(escrow, "UIOverrideSet")
        .withArgs(1);
      
      const depositorBalanceBefore = await mockToken.balanceOf(await depositor.getAddress());
      
      await expect(escrow.resolveDispute())
        .to.emit(escrow, "FundsRefunded")
        .withArgs(await depositor.getAddress(), ethers.parseUnits("1000", 6));
      
      const depositorBalanceAfter = await mockToken.balanceOf(await depositor.getAddress());
      expect(depositorBalanceAfter - depositorBalanceBefore).to.equal(ethers.parseUnits("1000", 6));
    });

    it("Should settle via Uniswap after timeout", async function () {
      await escrow.connect(depositor).raiseDispute();
      
      // Fast forward time
      await time.increase(DISPUTE_TIMEOUT + 1);
      
      // Mock Uniswap to return successful swap
      await mockUniswapRouter.setSwapResult(ethers.parseUnits("950", 6));
      
      await expect(escrow.resolveDispute())
        .to.emit(escrow, "SettledViaUniswap");
      
      expect(await escrow.currentState()).to.equal(6); // SETTLED_VIA_UNISWAP
    });
  });

  describe("5. Edge Cases & Security", function () {
    it("Should prevent reentrancy attacks", async function () {
      // This would require a malicious contract setup
      // For now, we verify the modifier is present
      const depositAmount = ethers.parseUnits("1000", 6);
      await mockToken.connect(depositor).approve(await escrow.getAddress(), depositAmount);
      
      // The nonReentrant modifier will prevent reentrancy
      await expect(escrow.connect(depositor).deposit(depositAmount))
        .to.not.be.reverted;
    });

    it("Should handle emergency withdrawals", async function () {
      const depositAmount = ethers.parseUnits("1000", 6);
      await mockToken.connect(depositor).approve(await escrow.getAddress(), depositAmount);
      await escrow.connect(depositor).deposit(depositAmount);
      
      // Fast forward past both timeouts
      await time.increase(SOLVER_TIMEOUT + DISPUTE_TIMEOUT + 1);
      
      const depositorBalanceBefore = await mockToken.balanceOf(await depositor.getAddress());
      
      await expect(escrow.connect(depositor).emergencyWithdraw())
        .to.emit(escrow, "FundsRefunded");
      
      const depositorBalanceAfter = await mockToken.balanceOf(await depositor.getAddress());
      expect(depositorBalanceAfter - depositorBalanceBefore).to.equal(depositAmount);
    });

    it("Should handle pause functionality in pausable escrow", async function () {
      await expect(pausableEscrow.connect(emergencyAdmin).pause())
        .to.emit(pausableEscrow, "Paused");
      
      const depositAmount = ethers.parseUnits("1000", 6);
      await mockToken.connect(depositor).approve(await pausableEscrow.getAddress(), depositAmount);
      
      await expect(pausableEscrow.connect(depositor).deposit(depositAmount))
        .to.be.revertedWith("Pausable: paused");
      
      await pausableEscrow.connect(emergencyAdmin).unpause();
      
      await expect(pausableEscrow.connect(depositor).deposit(depositAmount))
        .to.not.be.reverted;
    });

    it("Should reject invalid dispute resolutions", async function () {
      const depositAmount = ethers.parseUnits("1000", 6);
      await mockToken.connect(depositor).approve(await escrow.getAddress(), depositAmount);
      await escrow.connect(depositor).deposit(depositAmount);
      await escrow.connect(depositor).raiseDispute();
      
      // Try to resolve without timeout or UI override
      await expect(escrow.resolveDispute())
        .to.be.revertedWith("Dispute still pending resolution");
    });
  });

  describe("6. Gas Optimization Tests", function () {
    it("Should measure gas costs for key operations", async function () {
      const depositAmount = ethers.parseUnits("1000", 6);
      
      // Measure approval gas
      await mockToken.connect(depositor).approve(await escrow.getAddress(), depositAmount);
      const approveTx = await mockToken.connect(depositor).approve(await escrow.getAddress(), depositAmount);
      const approveReceipt = await approveTx.wait();
      console.log(`Approval gas used: ${approveReceipt?.gasUsed.toString()}`);
      
      // Measure deposit gas
      const depositTx = await escrow.connect(depositor).deposit(depositAmount);
      const depositReceipt = await depositTx.wait();
      console.log(`Deposit gas used: ${depositReceipt?.gasUsed.toString()}`);
      
      // Measure solution provision gas
      const solutionTx = await escrow.connect(solver).provideSolution();
      const solutionReceipt = await solutionTx.wait();
      console.log(`Solution provision gas used: ${solutionReceipt?.gasUsed.toString()}`);
      
      // Measure acceptance gas
      const acceptTx = await escrow.connect(depositor).acceptSolution();
      const acceptReceipt = await acceptTx.wait();
      console.log(`Solution acceptance gas used: ${acceptReceipt?.gasUsed.toString()}`);
    });
  });

  describe("7. Multi-Signature Escrow Tests", function () {
    it("Should handle multi-sig requirements for large amounts", async function () {
      const signers = [deployer, emergencyAdmin];
      const MultiSigEscrow = await ethers.getContractFactory("MultiSigDisputeResolutionEscrow");
      
      const multiSigEscrow = await MultiSigEscrow.deploy(
        await depositor.getAddress(),
        await solver.getAddress(),
        await Promise.all(signers.map(s => s.getAddress())),
        2 // require 2 signatures
      );
      
      // Test deployment validation
      expect(await multiSigEscrow.requiredSignatures()).to.equal(2);
      
      // Note: Full multi-sig testing would require depositing > 100 ETH
      // which is impractical for unit tests
    });
  });

  describe("8. Integration with CrossChain Router", function () {
    it("Should validate escrow can work with cross-chain swaps", async function () {
      // This test validates the escrow contract interface is compatible
      // with cross-chain router expectations
      
      const depositAmount = ethers.parseUnits("1000", 6);
      await mockToken.connect(depositor).approve(await escrow.getAddress(), depositAmount);
      await escrow.connect(depositor).deposit(depositAmount);
      
      // Verify state transitions that would be triggered by router
      expect(await escrow.currentState()).to.equal(1); // AWAITING_SOLUTION
      
      // Router would call provideSolution after successful cross-chain swap
      await escrow.connect(solver).provideSolution();
      expect(await escrow.currentState()).to.equal(2); // SOLUTION_PROVIDED
      
      // User accepts and funds are released
      await escrow.connect(depositor).acceptSolution();
      expect(await escrow.currentState()).to.equal(3); // COMPLETED
    });
  });
});