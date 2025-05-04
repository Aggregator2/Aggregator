const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Escrow Contract End-to-End Flow", function () {
  let Escrow, escrow, depositor, counterparty, arbiter, token;
  const amount = ethers.utils.parseEther("10"); // 10 tokens

  beforeEach(async function () {
    // Get signers
    [depositor, counterparty, arbiter] = await ethers.getSigners();

    // Deploy a mock ERC20 token
    const Token = await ethers.getContractFactory("MockERC20");
    token = await Token.deploy("Mock Token", "MTK", ethers.utils.parseEther("1000"));
    await token.deployed();

    // Deploy the Escrow contract
    Escrow = await ethers.getContractFactory("Escrow");
    escrow = await Escrow.deploy(
      depositor.address,
      token.address,
      amount,
      counterparty.address,
      arbiter.address,
      ethers.utils.formatBytes32String("tradeHash"),
      "0x",
      ethers.constants.AddressZero // Mock Uniswap router address
    );
    await escrow.deployed();

    // Approve the Escrow contract to spend depositor's tokens
    await token.connect(depositor).approve(escrow.address, amount);
  });

  it("should track balances during deposit, release, and refund", async function () {
    // Initial balances
    const initialDepositorBalance = await token.balanceOf(depositor.address);
    const initialCounterpartyBalance = await token.balanceOf(counterparty.address);
    const initialEscrowBalance = await token.balanceOf(escrow.address);

    expect(initialDepositorBalance).to.equal(ethers.utils.parseEther("1000"));
    expect(initialCounterpartyBalance).to.equal(0);
    expect(initialEscrowBalance).to.equal(0);

    // Step 1: Deposit
    await escrow.connect(depositor).deposit();
    const afterDepositEscrowBalance = await token.balanceOf(escrow.address);
    const afterDepositDepositorBalance = await token.balanceOf(depositor.address);

    expect(afterDepositEscrowBalance).to.equal(amount);
    expect(afterDepositDepositorBalance).to.equal(initialDepositorBalance.sub(amount));

    // Step 2: Release
    await escrow.connect(arbiter).release();
    const afterReleaseCounterpartyBalance = await token.balanceOf(counterparty.address);
    const afterReleaseEscrowBalance = await token.balanceOf(escrow.address);

    expect(afterReleaseCounterpartyBalance).to.equal(initialCounterpartyBalance.add(amount));
    expect(afterReleaseEscrowBalance).to.equal(0);

    // Step 3: Refund (reset state for refund test)
    await escrow.connect(depositor).deposit();
    await escrow.connect(arbiter).refund();
    const afterRefundDepositorBalance = await token.balanceOf(depositor.address);
    const afterRefundEscrowBalance = await token.balanceOf(escrow.address);

    expect(afterRefundDepositorBalance).to.equal(initialDepositorBalance);
    expect(afterRefundEscrowBalance).to.equal(0);
  });
});