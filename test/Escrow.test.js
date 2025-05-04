const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Escrow Contract", function () {
  let Escrow, escrow, depositor, counterparty, arbiter, token, uniswapRouter;
  const amount = ethers.utils.parseEther("10"); // 10 tokens

  beforeEach(async function () {
    // Get signers
    [depositor, counterparty, arbiter, recipient, other] = await ethers.getSigners();

    // Deploy a mock ERC20 token
    const Token = await ethers.getContractFactory("MockERC20");
    token = await Token.deploy("Mock Token", "MTK", ethers.utils.parseEther("1000"));
    await token.deployed();

    // Deploy the Escrow contract
    Escrow = await ethers.getContractFactory("Escrow");
    uniswapRouter = ethers.constants.AddressZero; // Mock Uniswap router address
    escrow = await Escrow.deploy(
      depositor.address,
      token.address,
      amount,
      counterparty.address,
      arbiter.address,
      ethers.utils.formatBytes32String("tradeHash"),
      "0x",
      uniswapRouter
    );
    await escrow.deployed();

    // Approve the Escrow contract to spend depositor's tokens
    await token.connect(depositor).approve(escrow.address, amount);
  });

  it("should allow the depositor to deposit tokens", async function () {
    await expect(escrow.connect(depositor).deposit())
      .to.emit(escrow, "Deposited")
      .withArgs(depositor.address, token.address, amount);

    const escrowBalance = await token.balanceOf(escrow.address);
    expect(escrowBalance).to.equal(amount);
  });

  it("should not allow non-depositor to deposit tokens", async function () {
    await expect(escrow.connect(counterparty).deposit()).to.be.revertedWith(
      "Only the depositor can call this function"
    );
  });

  it("should allow the arbiter to release tokens to the counterparty", async function () {
    await escrow.connect(depositor).deposit();

    await expect(escrow.connect(arbiter).release())
      .to.emit(escrow, "Executed")
      .withArgs(counterparty.address, token.address, amount);

    const counterpartyBalance = await token.balanceOf(counterparty.address);
    expect(counterpartyBalance).to.equal(amount);
  });

  it("should not allow non-arbiter to release tokens", async function () {
    await escrow.connect(depositor).deposit();

    await expect(escrow.connect(counterparty).release()).to.be.revertedWith(
      "Only the arbiter can call this function"
    );
  });

  it("should allow the arbiter to refund the depositor", async function () {
    await escrow.connect(depositor).deposit();

    await expect(escrow.connect(arbiter).refund())
      .to.emit(escrow, "Withdrawn")
      .withArgs(depositor.address, token.address, amount);

    const depositorBalance = await token.balanceOf(depositor.address);
    expect(depositorBalance).to.equal(ethers.utils.parseEther("1000"));
  });

  it("should fail if a non-arbiter tries to refund", async function () {
    await escrow.connect(depositor).deposit();

    await expect(escrow.connect(counterparty).refund()).to.be.revertedWith(
      "Only the arbiter can call this function"
    );
  });

  it("should transfer tokens back to the depositor", async function () {
    await escrow.connect(depositor).deposit();

    await escrow.connect(arbiter).refund();

    const depositorBalance = await token.balanceOf(depositor.address);
    expect(depositorBalance).to.equal(ethers.utils.parseEther("1000"));

    const escrowBalance = await token.balanceOf(escrow.address);
    expect(escrowBalance).to.equal(0);
  });

  it("should prevent double refunds", async function () {
    await escrow.connect(depositor).deposit();

    await escrow.connect(arbiter).refund();

    await expect(escrow.connect(arbiter).refund()).to.be.revertedWith(
      "No funds to refund"
    );
  });

  it("should perform a token swap and transfer output tokens to the recipient", async function () {
    // Mock input and output tokens and amounts
    const inputToken = token.address;
    const outputToken = token.address; // Mock same token for simplicity
    const amountIn = ethers.utils.parseEther("5");
    const minAmountOut = ethers.utils.parseEther("4");

    // Approve the Escrow contract to spend input tokens
    await token.connect(depositor).approve(escrow.address, amountIn);

    // Call swapAndExecute
    await expect(
      escrow
        .connect(depositor)
        .swapAndExecute(inputToken, outputToken, amountIn, minAmountOut, recipient.address)
    )
      .to.emit(escrow, "SwapExecuted")
      .withArgs(inputToken, outputToken, amountIn, minAmountOut, recipient.address);

    // Verify recipient received the output tokens
    const recipientBalance = await token.balanceOf(recipient.address);
    expect(recipientBalance).to.equal(minAmountOut);
  });

  it("should execute release when a valid signature is provided", async function () {
    // Create a message hash
    const messageHash = ethers.utils.solidityKeccak256(
      ["address", "address", "uint256"],
      [escrow.address, counterparty.address, amount]
    );

    // Sign the message hash with the depositor's private key
    const signature = await depositor.signMessage(ethers.utils.arrayify(messageHash));

    // Call release with the valid signature
    await escrow.connect(arbiter).releaseWithSignature(signature);

    // Verify the counterparty received the tokens
    const counterpartyBalance = await token.balanceOf(counterparty.address);
    expect(counterpartyBalance).to.equal(amount);
  });

  it("should revert release if the signature is from the wrong address", async function () {
    // Create a message hash
    const messageHash = ethers.utils.solidityKeccak256(
      ["address", "address", "uint256"],
      [escrow.address, counterparty.address, amount]
    );

    // Sign the message hash with the wrong address (e.g., counterparty)
    const signature = await counterparty.signMessage(ethers.utils.arrayify(messageHash));

    // Expect the transaction to revert
    await expect(escrow.connect(arbiter).releaseWithSignature(signature)).to.be.revertedWith(
      "Invalid signature"
    );
  });

  it("should revert release if the signature is malformed", async function () {
    // Create a random invalid signature
    const invalidSignature = "0x" + "00".repeat(65);

    // Expect the transaction to revert
    await expect(escrow.connect(arbiter).releaseWithSignature(invalidSignature)).to.be.revertedWith(
      "Invalid signature"
    );
  });
});