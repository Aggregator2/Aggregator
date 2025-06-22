const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("DisputeResolutionEscrow", function () {
  // We use a fixture to deploy contracts once and reset state between tests
  async function deployDisputeEscrowFixture() {
    // Get signers
    const [deployer, depositor, solver, otherUser] = await ethers.getSigners();

    // Deploy mock tokens
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const depositToken = await MockERC20.deploy("Deposit Token", "DEP", ethers.parseEther("10000"));
    const settlementToken = await MockERC20.deploy("Settlement Token", "SET", ethers.parseEther("10000"));
    
    // Deploy mock Uniswap router
    const MockUniswapRouter = await ethers.getContractFactory("MockUniswapV2Router");
    const uniswapRouter = await MockUniswapRouter.deploy();

    // Deploy DisputeResolutionEscrow
    const DisputeResolutionEscrow = await ethers.getContractFactory("DisputeResolutionEscrow");
    const escrow = await DisputeResolutionEscrow.deploy(
      await depositor.getAddress(),
      await solver.getAddress(),
      await depositToken.getAddress(),
      await settlementToken.getAddress(),
      await uniswapRouter.getAddress()
    );

    // Setup initial balances
    await depositToken.transfer(await depositor.getAddress(), ethers.parseEther("1000"));
    await settlementToken.transfer(await uniswapRouter.getAddress(), ethers.parseEther("1000"));

    // Approve escrow to spend depositor's tokens
    await depositToken.connect(depositor).approve(await escrow.getAddress(), ethers.parseEther("1000"));

    return { escrow, depositToken, settlementToken, uniswapRouter, depositor, solver, otherUser };
  }

  describe("Deployment", function () {
    it("Should deploy with correct initial state", async function () {
      const { escrow, depositToken, settlementToken, depositor, solver, uniswapRouter } = await loadFixture(deployDisputeEscrowFixture);
      
      expect(await escrow.depositor()).to.equal(await depositor.getAddress());
      expect(await escrow.solver()).to.equal(await solver.getAddress());
      expect(await escrow.depositToken()).to.equal(await depositToken.getAddress());
      expect(await escrow.settlementToken()).to.equal(await settlementToken.getAddress());
      expect(await escrow.uniswapRouter()).to.equal(await uniswapRouter.getAddress());
      expect(await escrow.currentState()).to.equal(0); // AWAITING_DEPOSIT
      expect(await escrow.disputeResolution()).to.equal(0); // DEFAULT_UNISWAP
    });

    it("Should reject zero addresses", async function () {
      const DisputeResolutionEscrow = await ethers.getContractFactory("DisputeResolutionEscrow");
      const [depositor, solver] = await ethers.getSigners();
      
      await expect(DisputeResolutionEscrow.deploy(
        ethers.ZeroAddress,
        await solver.getAddress(),
        ethers.ZeroAddress,
        ethers.ZeroAddress,
        ethers.ZeroAddress
      )).to.be.revertedWith("Invalid depositor");
    });
  });

  describe("Deposit Functionality", function () {
    it("Should allow depositor to deposit ERC20 tokens", async function () {
      const { escrow, depositToken, depositor } = await loadFixture(deployDisputeEscrowFixture);
      
      const depositAmount = ethers.parseEther("100");
      
      await expect(escrow.connect(depositor).deposit(depositAmount))
        .to.emit(escrow, "Deposited")
        .withArgs(await depositor.getAddress(), depositAmount);
      
      expect(await escrow.depositAmount()).to.equal(depositAmount);
      expect(await escrow.currentState()).to.equal(1); // AWAITING_SOLUTION
      expect(await depositToken.balanceOf(await escrow.getAddress())).to.equal(depositAmount);
    });

    it("Should reject deposits from non-depositor", async function () {
      const { escrow, solver } = await loadFixture(deployDisputeEscrowFixture);
      
      await expect(escrow.connect(solver).deposit(ethers.parseEther("100")))
        .to.be.revertedWith("Only depositor can call");
    });

    it("Should reject deposits in wrong state", async function () {
      const { escrow, depositor } = await loadFixture(deployDisputeEscrowFixture);
      
      // Make first deposit
      await escrow.connect(depositor).deposit(ethers.parseEther("100"));
      
      // Try to deposit again
      await expect(escrow.connect(depositor).deposit(ethers.parseEther("100")))
        .to.be.revertedWith("Invalid state for deposit");
    });
  });

  describe("Solution Flow", function () {
    it("Should allow solver to provide solution", async function () {
      const { escrow, depositor, solver } = await loadFixture(deployDisputeEscrowFixture);
      
      // First make a deposit
      await escrow.connect(depositor).deposit(ethers.parseEther("100"));
      
      await expect(escrow.connect(solver).provideSolution())
        .to.emit(escrow, "SolutionProvided")
        .withArgs(await solver.getAddress());
      
      expect(await escrow.currentState()).to.equal(2); // SOLUTION_PROVIDED
    });

    it("Should allow depositor to accept solution", async function () {
      const { escrow, depositToken, depositor, solver } = await loadFixture(deployDisputeEscrowFixture);
      
      // First make a deposit
      await escrow.connect(depositor).deposit(ethers.parseEther("100"));
      
      // Then solver provides solution
      await escrow.connect(solver).provideSolution();
      
      const solverBalanceBefore = await depositToken.balanceOf(await solver.getAddress());
      
      await expect(escrow.connect(depositor).acceptSolution())
        .to.emit(escrow, "SolutionAccepted")
        .withArgs(await depositor.getAddress());
      
      expect(await escrow.currentState()).to.equal(3); // COMPLETED
      expect(await depositToken.balanceOf(await solver.getAddress())).to.equal(
        solverBalanceBefore + ethers.parseEther("100")
      );
    });

    it("Should reject solution from non-solver", async function () {
      const { escrow, depositor } = await loadFixture(deployDisputeEscrowFixture);
      
      // First make a deposit
      await escrow.connect(depositor).deposit(ethers.parseEther("100"));
      
      await expect(escrow.connect(depositor).provideSolution())
        .to.be.revertedWith("Only solver can call");
    });
  });

  describe("Dispute Resolution", function () {
    it("Should allow raising dispute in AWAITING_SOLUTION state", async function () {
      const { escrow, depositor } = await loadFixture(deployDisputeEscrowFixture);
      
      // First make a deposit
      await escrow.connect(depositor).deposit(ethers.parseEther("100"));
      
      await expect(escrow.connect(depositor).raiseDispute())
        .to.emit(escrow, "DisputeRaised");
      
      expect(await escrow.currentState()).to.equal(4); // DISPUTED
    });

    it("Should allow raising dispute in SOLUTION_PROVIDED state", async function () {
      const { escrow, depositor, solver } = await loadFixture(deployDisputeEscrowFixture);
      
      // First make a deposit
      await escrow.connect(depositor).deposit(ethers.parseEther("100"));
      
      // Then solver provides solution
      await escrow.connect(solver).provideSolution();
      
      await expect(escrow.connect(depositor).raiseDispute())
        .to.emit(escrow, "DisputeRaised");
      
      expect(await escrow.currentState()).to.equal(4); // DISPUTED
    });

    it("Should allow UI override to return funds to depositor", async function () {
      const { escrow, depositToken, depositor } = await loadFixture(deployDisputeEscrowFixture);
      
      // First make a deposit
      await escrow.connect(depositor).deposit(ethers.parseEther("100"));
      
      // Then raise dispute
      await escrow.connect(depositor).raiseDispute();
      await escrow.connect(depositor).setUIOverride(1); // RETURN_TO_DEPOSITOR
      
      const depositorBalanceBefore = await depositToken.balanceOf(await depositor.getAddress());
      
      await expect(escrow.resolveDispute())
        .to.emit(escrow, "FundsRefunded")
        .withArgs(await depositor.getAddress(), ethers.parseEther("100"));
      
      expect(await escrow.currentState()).to.equal(5); // REFUNDED
      expect(await depositToken.balanceOf(await depositor.getAddress())).to.equal(
        depositorBalanceBefore + ethers.parseEther("100")
      );
    });

    it("Should settle via Uniswap when UI override is set to DEFAULT_UNISWAP", async function () {
      const { escrow, depositor, uniswapRouter } = await loadFixture(deployDisputeEscrowFixture);
      
      // First make a deposit
      await escrow.connect(depositor).deposit(ethers.parseEther("100"));
      
      // Then raise dispute
      await escrow.connect(depositor).raiseDispute();
      await escrow.connect(depositor).setUIOverride(0); // DEFAULT_UNISWAP
      
      await expect(escrow.resolveDispute())
        .to.emit(escrow, "SettledViaUniswap");
      
      expect(await escrow.currentState()).to.equal(6); // SETTLED_VIA_UNISWAP
    });

    it("Should default to Uniswap settlement after timeout", async function () {
      const { escrow, depositor } = await loadFixture(deployDisputeEscrowFixture);
      
      // First make a deposit
      await escrow.connect(depositor).deposit(ethers.parseEther("100"));
      
      // Then raise dispute
      await escrow.connect(depositor).raiseDispute();
      
      // Fast forward past dispute deadline
      await time.increase(7 * 24 * 60 * 60 + 1); // 7 days + 1 second
      
      await expect(escrow.resolveDispute())
        .to.emit(escrow, "SettledViaUniswap");
      
      expect(await escrow.currentState()).to.equal(6); // SETTLED_VIA_UNISWAP
    });

    it("Should reject resolution before timeout without UI override", async function () {
      const { escrow, depositor } = await loadFixture(deployDisputeEscrowFixture);
      
      // First make a deposit
      await escrow.connect(depositor).deposit(ethers.parseEther("100"));
      
      // Then raise dispute
      await escrow.connect(depositor).raiseDispute();
      
      await expect(escrow.resolveDispute())
        .to.be.revertedWith("Dispute still pending resolution");
    });

    it("Should only allow depositor to set UI override", async function () {
      const { escrow, depositor, solver } = await loadFixture(deployDisputeEscrowFixture);
      
      // First make a deposit
      await escrow.connect(depositor).deposit(ethers.parseEther("100"));
      
      // Then raise dispute
      await escrow.connect(depositor).raiseDispute();
      
      await expect(escrow.connect(solver).setUIOverride(1))
        .to.be.revertedWith("Only depositor can call");
    });
  });

  describe("Emergency Withdrawal", function () {
    it("Should allow emergency withdrawal after extended timeout", async function () {
      const { escrow, depositToken, depositor } = await loadFixture(deployDisputeEscrowFixture);
      
      await escrow.connect(depositor).deposit(ethers.parseEther("100"));
      
      // Fast forward past dispute deadline + timeout
      await time.increase(14 * 24 * 60 * 60 + 1); // 14 days + 1 second
      
      const depositorBalanceBefore = await depositToken.balanceOf(await depositor.getAddress());
      
      await expect(escrow.connect(depositor).emergencyWithdraw())
        .to.emit(escrow, "FundsRefunded");
      
      expect(await depositToken.balanceOf(await depositor.getAddress())).to.equal(
        depositorBalanceBefore + ethers.parseEther("100")
      );
    });

    it("Should reject emergency withdrawal before timeout", async function () {
      const { escrow, depositor } = await loadFixture(deployDisputeEscrowFixture);
      
      await escrow.connect(depositor).deposit(ethers.parseEther("100"));
      
      await expect(escrow.connect(depositor).emergencyWithdraw())
        .to.be.revertedWith("Emergency withdrawal not available");
    });
  });

  describe("ETH Support", function () {
    async function deployETHEscrowFixture() {
      const [deployer, depositor, solver] = await ethers.getSigners();
      
      const MockUniswapRouter = await ethers.getContractFactory("MockUniswapV2Router");
      const uniswapRouter = await MockUniswapRouter.deploy();

      const DisputeResolutionEscrow = await ethers.getContractFactory("DisputeResolutionEscrow");
      const escrow = await DisputeResolutionEscrow.deploy(
        await depositor.getAddress(),
        await solver.getAddress(),
        ethers.ZeroAddress, // ETH
        ethers.ZeroAddress, // No settlement token for ETH
        await uniswapRouter.getAddress()
      );

      return { escrow, depositor, solver };
    }

    it("Should handle ETH deposits and refunds", async function () {
      const { escrow, depositor } = await loadFixture(deployETHEscrowFixture);
      
      const depositAmount = ethers.parseEther("1");
      
      // Deposit ETH
      await expect(escrow.connect(depositor).deposit(0, { value: depositAmount }))
        .to.emit(escrow, "Deposited")
        .withArgs(await depositor.getAddress(), depositAmount);
      
      // Raise dispute and set UI override to refund
      await escrow.connect(depositor).raiseDispute();
      await escrow.connect(depositor).setUIOverride(1); // RETURN_TO_DEPOSITOR
      
      const depositorBalanceBefore = await ethers.provider.getBalance(await depositor.getAddress());
      
      // Resolve dispute
      const tx = await escrow.resolveDispute();
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;
      
      const depositorBalanceAfter = await ethers.provider.getBalance(await depositor.getAddress());
      
      // Check that depositor received ETH back (accounting for gas)
      expect(depositorBalanceAfter).to.be.closeTo(
        depositorBalanceBefore + depositAmount,
        ethers.parseEther("0.01") // Allow for gas costs
      );
    });

    it("Should reject Uniswap settlement for ETH", async function () {
      const { escrow, depositor } = await loadFixture(deployETHEscrowFixture);
      
      await escrow.connect(depositor).deposit(0, { value: ethers.parseEther("1") });
      await escrow.connect(depositor).raiseDispute();
      
      // Fast forward to timeout
      await time.increase(7 * 24 * 60 * 60 + 1);
      
      // Should revert because ETH cannot be swapped directly
      await expect(escrow.resolveDispute())
        .to.be.revertedWith("Cannot swap ETH directly");
    });
  });

  describe("Edge Cases and Security", function () {
    it("Should prevent reentrancy attacks", async function () {
      // This would require a malicious contract, simplified test here
      const { escrow, depositor } = await loadFixture(deployDisputeEscrowFixture);
      
      await escrow.connect(depositor).deposit(ethers.parseEther("100"));
      await escrow.connect(depositor).raiseDispute();
      await escrow.connect(depositor).setUIOverride(1);
      
      // Should only execute once even if called multiple times rapidly
      await escrow.resolveDispute();
      await expect(escrow.resolveDispute())
        .to.be.revertedWith("No dispute to resolve");
    });

    it("Should handle zero deposit amounts correctly", async function () {
      const { escrow, depositor } = await loadFixture(deployDisputeEscrowFixture);
      
      await expect(escrow.connect(depositor).deposit(0))
        .to.be.revertedWith("Amount must be > 0");
    });

    it("Should validate state transitions", async function () {
      const { escrow, depositor, solver } = await loadFixture(deployDisputeEscrowFixture);
      
      // Can't provide solution before deposit
      await expect(escrow.connect(solver).provideSolution())
        .to.be.revertedWith("Invalid state for solution");
      
      // Can't accept solution before it's provided
      await expect(escrow.connect(depositor).acceptSolution())
        .to.be.revertedWith("No solution to accept");
    });
  });
});

// Mock contracts for testing
const MockERC20Source = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor(string memory name, string memory symbol, uint256 initialSupply) ERC20(name, symbol) {
        _mint(msg.sender, initialSupply);
    }
}`;

const MockUniswapRouterSource = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockUniswapV2Router {
    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts) {
        require(path.length >= 2, "Invalid path");
        require(deadline >= block.timestamp, "Expired");
        
        // Transfer tokens from sender
        IERC20(path[0]).transferFrom(msg.sender, address(this), amountIn);
        
        // Mock swap: return 90% of input amount as output
        uint amountOut = (amountIn * 90) / 100;
        amounts = new uint[](path.length);
        amounts[0] = amountIn;
        amounts[amounts.length - 1] = amountOut;
        
        // Transfer output tokens to recipient
        IERC20(path[path.length - 1]).transfer(to, amountOut);
        
        return amounts;
    }
}`;