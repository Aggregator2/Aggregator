import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { StateChannelFactory, StateChannel, MockERC20 } from "../../typechain-types";

describe("StateChannel", function () {
  let factory: StateChannelFactory;
  let token: MockERC20;
  let owner: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let carol: SignerWithAddress;
  let participants: string[];
  let challengePeriod: number;

  beforeEach(async function () {
    [owner, alice, bob, carol] = await ethers.getSigners();
    participants = [alice.address, bob.address];
    challengePeriod = 3600; // 1 hour

    // Deploy mock token
    const MockERC20Factory = await ethers.getContractFactory("MockERC20");
    token = await MockERC20Factory.deploy("Test Token", "TEST");

    // Deploy factory
    const StateChannelFactoryFactory = await ethers.getContractFactory("StateChannelFactory");
    factory = await StateChannelFactoryFactory.deploy();

    // Mint tokens
    await token.mint(alice.address, ethers.utils.parseEther("1000"));
    await token.mint(bob.address, ethers.utils.parseEther("1000"));
  });

  describe("Channel Creation", function () {
    it("Should create a channel with valid parameters", async function () {
      const params = {
        participants,
        token: token.address,
        challengePeriod,
        nonce: 1
      };

      // Create signatures
      const messageHash = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["string", "address[]", "address", "uint256", "uint256", "uint256", "address"],
          ["StateChannel", participants, token.address, challengePeriod, 1, 31337, factory.address]
        )
      );

      const ethSignedMessageHash = ethers.utils.hashMessage(ethers.utils.arrayify(messageHash));
      const aliceSignature = await alice.signMessage(ethers.utils.arrayify(messageHash));
      const bobSignature = await bob.signMessage(ethers.utils.arrayify(messageHash));

      const tx = await factory.createChannel(params, [aliceSignature, bobSignature]);
      const receipt = await tx.wait();

      const event = receipt.events?.find(e => e.event === "ChannelCreated");
      expect(event).to.not.be.undefined;
      expect(event?.args?.participants).to.deep.equal(participants);
    });

    it("Should fail with invalid participant count", async function () {
      const params = {
        participants: [alice.address], // Only one participant
        token: token.address,
        challengePeriod,
        nonce: 1
      };

      await expect(factory.createChannel(params, [])).to.be.revertedWithCustomError(
        factory,
        "InvalidParticipantCount"
      );
    });

    it("Should fail with duplicate participants", async function () {
      const params = {
        participants: [alice.address, alice.address], // Duplicate
        token: token.address,
        challengePeriod,
        nonce: 1
      };

      await expect(factory.createChannel(params, [])).to.be.revertedWithCustomError(
        factory,
        "DuplicateParticipant"
      );
    });
  });

  describe("Deposits and Withdrawals", function () {
    let channel: StateChannel;

    beforeEach(async function () {
      // Create channel
      const params = {
        participants,
        token: token.address,
        challengePeriod,
        nonce: 1
      };

      const messageHash = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["string", "address[]", "address", "uint256", "uint256", "uint256", "address"],
          ["StateChannel", participants, token.address, challengePeriod, 1, 31337, factory.address]
        )
      );

      const aliceSignature = await alice.signMessage(ethers.utils.arrayify(messageHash));
      const bobSignature = await bob.signMessage(ethers.utils.arrayify(messageHash));

      const tx = await factory.createChannel(params, [aliceSignature, bobSignature]);
      const receipt = await tx.wait();

      const event = receipt.events?.find(e => e.event === "ChannelCreated");
      const channelAddress = event?.args?.channelAddress;

      channel = await ethers.getContractAt("StateChannel", channelAddress);
    });

    it("Should allow participants to deposit", async function () {
      const amount = ethers.utils.parseEther("100");

      await token.connect(alice).approve(channel.address, amount);
      await expect(channel.connect(alice).deposit(amount))
        .to.emit(channel, "Deposited")
        .withArgs(alice.address, amount);

      expect(await channel.deposits(alice.address)).to.equal(amount);
      expect(await channel.totalDeposited()).to.equal(amount);
    });

    it("Should prevent non-participants from depositing", async function () {
      const amount = ethers.utils.parseEther("100");

      await token.connect(carol).approve(channel.address, amount);
      await expect(channel.connect(carol).deposit(amount)).to.be.revertedWithCustomError(
        channel,
        "NotParticipant"
      );
    });

    it("Should enforce minimum deposit", async function () {
      const amount = ethers.utils.parseEther("0.0000001"); // Below minimum

      await token.connect(alice).approve(channel.address, amount);
      await expect(channel.connect(alice).deposit(amount)).to.be.revertedWithCustomError(
        channel,
        "InsufficientDeposit"
      );
    });
  });

  describe("State Updates", function () {
    let channel: StateChannel;

    beforeEach(async function () {
      // Create and fund channel
      const params = {
        participants,
        token: token.address,
        challengePeriod,
        nonce: 1
      };

      const messageHash = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["string", "address[]", "address", "uint256", "uint256", "uint256", "address"],
          ["StateChannel", participants, token.address, challengePeriod, 1, 31337, factory.address]
        )
      );

      const aliceSignature = await alice.signMessage(ethers.utils.arrayify(messageHash));
      const bobSignature = await bob.signMessage(ethers.utils.arrayify(messageHash));

      const tx = await factory.createChannel(params, [aliceSignature, bobSignature]);
      const receipt = await tx.wait();

      const event = receipt.events?.find(e => e.event === "ChannelCreated");
      const channelAddress = event?.args?.channelAddress;

      channel = await ethers.getContractAt("StateChannel", channelAddress);

      // Deposit funds
      const amount = ethers.utils.parseEther("100");
      await token.connect(alice).approve(channel.address, amount);
      await channel.connect(alice).deposit(amount);
      await token.connect(bob).approve(channel.address, amount);
      await channel.connect(bob).deposit(amount);
    });

    it("Should update state with valid signatures", async function () {
      const nonce = 1;
      const stateRoot = ethers.utils.keccak256("0x01");
      const balances = [ethers.utils.parseEther("90"), ethers.utils.parseEther("110")];

      const messageHash = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["address", "uint256", "bytes32", "uint256[]", "uint256"],
          [channel.address, nonce, stateRoot, balances, 31337]
        )
      );

      const aliceSignature = await alice.signMessage(ethers.utils.arrayify(messageHash));
      const bobSignature = await bob.signMessage(ethers.utils.arrayify(messageHash));

      await expect(channel.connect(alice).updateState(nonce, stateRoot, balances, [aliceSignature, bobSignature]))
        .to.emit(channel, "StateUpdated")
        .withArgs(nonce, stateRoot);
    });

    it("Should reject invalid nonce", async function () {
      const nonce = 0; // Same as current
      const stateRoot = ethers.utils.keccak256("0x01");
      const balances = [ethers.utils.parseEther("90"), ethers.utils.parseEther("110")];

      await expect(
        channel.connect(alice).updateState(nonce, stateRoot, balances, [])
      ).to.be.revertedWithCustomError(channel, "InvalidStateTransition");
    });

    it("Should reject state with total balance exceeding deposits", async function () {
      const nonce = 1;
      const stateRoot = ethers.utils.keccak256("0x01");
      const balances = [ethers.utils.parseEther("150"), ethers.utils.parseEther("150")]; // Total: 300 > 200 deposited

      await expect(
        channel.connect(alice).updateState(nonce, stateRoot, balances, [])
      ).to.be.revertedWithCustomError(channel, "InvalidStateTransition");
    });
  });

  describe("Dispute Resolution", function () {
    let channel: StateChannel;

    beforeEach(async function () {
      // Create and fund channel
      const params = {
        participants,
        token: token.address,
        challengePeriod,
        nonce: 1
      };

      const messageHash = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["string", "address[]", "address", "uint256", "uint256", "uint256", "address"],
          ["StateChannel", participants, token.address, challengePeriod, 1, 31337, factory.address]
        )
      );

      const aliceSignature = await alice.signMessage(ethers.utils.arrayify(messageHash));
      const bobSignature = await bob.signMessage(ethers.utils.arrayify(messageHash));

      const tx = await factory.createChannel(params, [aliceSignature, bobSignature]);
      const receipt = await tx.wait();

      const event = receipt.events?.find(e => e.event === "ChannelCreated");
      const channelAddress = event?.args?.channelAddress;

      channel = await ethers.getContractAt("StateChannel", channelAddress);

      // Deposit funds
      const amount = ethers.utils.parseEther("100");
      await token.connect(alice).approve(channel.address, amount);
      await channel.connect(alice).deposit(amount);
      await token.connect(bob).approve(channel.address, amount);
      await channel.connect(bob).deposit(amount);
    });

    it("Should initiate challenge with valid state", async function () {
      const nonce = 1;
      const stateRoot = ethers.utils.keccak256("0x01");
      const balances = [ethers.utils.parseEther("90"), ethers.utils.parseEther("110")];

      const messageHash = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["address", "uint256", "bytes32", "uint256[]", "uint256"],
          [channel.address, nonce, stateRoot, balances, 31337]
        )
      );

      const aliceSignature = await alice.signMessage(ethers.utils.arrayify(messageHash));
      const bobSignature = await bob.signMessage(ethers.utils.arrayify(messageHash));

      await expect(
        channel.connect(alice).initiateChallenge(nonce, stateRoot, balances, [aliceSignature, bobSignature])
      )
        .to.emit(channel, "ChallengeInitiated")
        .withArgs(alice.address, nonce);

      expect(await channel.status()).to.equal(1); // Disputing
    });

    it("Should respond to challenge with higher nonce", async function () {
      // First initiate challenge
      const nonce1 = 1;
      const stateRoot1 = ethers.utils.keccak256("0x01");
      const balances1 = [ethers.utils.parseEther("90"), ethers.utils.parseEther("110")];

      const messageHash1 = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["address", "uint256", "bytes32", "uint256[]", "uint256"],
          [channel.address, nonce1, stateRoot1, balances1, 31337]
        )
      );

      const aliceSignature1 = await alice.signMessage(ethers.utils.arrayify(messageHash1));
      const bobSignature1 = await bob.signMessage(ethers.utils.arrayify(messageHash1));

      await channel.connect(alice).initiateChallenge(nonce1, stateRoot1, balances1, [aliceSignature1, bobSignature1]);

      // Respond with higher nonce
      const nonce2 = 2;
      const stateRoot2 = ethers.utils.keccak256("0x02");
      const balances2 = [ethers.utils.parseEther("85"), ethers.utils.parseEther("115")];

      const messageHash2 = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["address", "uint256", "bytes32", "uint256[]", "uint256"],
          [channel.address, nonce2, stateRoot2, balances2, 31337]
        )
      );

      const aliceSignature2 = await alice.signMessage(ethers.utils.arrayify(messageHash2));
      const bobSignature2 = await bob.signMessage(ethers.utils.arrayify(messageHash2));

      await expect(
        channel.connect(bob).respondToChallenge(nonce2, stateRoot2, balances2, [aliceSignature2, bobSignature2])
      )
        .to.emit(channel, "ChallengeResponded")
        .withArgs(nonce2);

      expect(await channel.status()).to.equal(0); // Active
    });

    it("Should finalize after challenge timeout", async function () {
      const nonce = 1;
      const stateRoot = ethers.utils.keccak256("0x01");
      const balances = [ethers.utils.parseEther("90"), ethers.utils.parseEther("110")];

      const messageHash = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["address", "uint256", "bytes32", "uint256[]", "uint256"],
          [channel.address, nonce, stateRoot, balances, 31337]
        )
      );

      const aliceSignature = await alice.signMessage(ethers.utils.arrayify(messageHash));
      const bobSignature = await bob.signMessage(ethers.utils.arrayify(messageHash));

      await channel.connect(alice).initiateChallenge(nonce, stateRoot, balances, [aliceSignature, bobSignature]);

      // Fast forward time
      await ethers.provider.send("evm_increaseTime", [challengePeriod + 1]);
      await ethers.provider.send("evm_mine", []);

      await expect(channel.finalizeChallengeTimeout())
        .to.emit(channel, "ChannelFinalized")
        .withArgs(nonce);

      expect(await channel.status()).to.equal(2); // Finalized
    });
  });

  describe("Cooperative Close", function () {
    let channel: StateChannel;

    beforeEach(async function () {
      // Create and fund channel
      const params = {
        participants,
        token: token.address,
        challengePeriod,
        nonce: 1
      };

      const messageHash = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["string", "address[]", "address", "uint256", "uint256", "uint256", "address"],
          ["StateChannel", participants, token.address, challengePeriod, 1, 31337, factory.address]
        )
      );

      const aliceSignature = await alice.signMessage(ethers.utils.arrayify(messageHash));
      const bobSignature = await bob.signMessage(ethers.utils.arrayify(messageHash));

      const tx = await factory.createChannel(params, [aliceSignature, bobSignature]);
      const receipt = await tx.wait();

      const event = receipt.events?.find(e => e.event === "ChannelCreated");
      const channelAddress = event?.args?.channelAddress;

      channel = await ethers.getContractAt("StateChannel", channelAddress);

      // Deposit funds
      const amount = ethers.utils.parseEther("100");
      await token.connect(alice).approve(channel.address, amount);
      await channel.connect(alice).deposit(amount);
      await token.connect(bob).approve(channel.address, amount);
      await channel.connect(bob).deposit(amount);
    });

    it("Should allow cooperative close with agreed state", async function () {
      const nonce = 1;
      const stateRoot = ethers.utils.keccak256("0x01");
      const balances = [ethers.utils.parseEther("90"), ethers.utils.parseEther("110")];

      const messageHash = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["address", "uint256", "bytes32", "uint256[]", "uint256"],
          [channel.address, nonce, stateRoot, balances, 31337]
        )
      );

      const aliceSignature = await alice.signMessage(ethers.utils.arrayify(messageHash));
      const bobSignature = await bob.signMessage(ethers.utils.arrayify(messageHash));

      await expect(
        channel.connect(alice).cooperativeClose(nonce, stateRoot, balances, [aliceSignature, bobSignature])
      )
        .to.emit(channel, "ChannelFinalized")
        .withArgs(nonce);

      expect(await channel.status()).to.equal(2); // Finalized

      // Check balances
      expect(await channel.getParticipantBalance(alice.address)).to.equal(balances[0]);
      expect(await channel.getParticipantBalance(bob.address)).to.equal(balances[1]);
    });

    it("Should allow withdrawals after finalization", async function () {
      const nonce = 1;
      const stateRoot = ethers.utils.keccak256("0x01");
      const balances = [ethers.utils.parseEther("90"), ethers.utils.parseEther("110")];

      const messageHash = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["address", "uint256", "bytes32", "uint256[]", "uint256"],
          [channel.address, nonce, stateRoot, balances, 31337]
        )
      );

      const aliceSignature = await alice.signMessage(ethers.utils.arrayify(messageHash));
      const bobSignature = await bob.signMessage(ethers.utils.arrayify(messageHash));

      await channel.connect(alice).cooperativeClose(nonce, stateRoot, balances, [aliceSignature, bobSignature]);

      // Withdraw
      const aliceBalanceBefore = await token.balanceOf(alice.address);

      await expect(channel.connect(alice).withdraw())
        .to.emit(channel, "Withdrawn")
        .withArgs(alice.address, balances[0]);

      const aliceBalanceAfter = await token.balanceOf(alice.address);
      expect(aliceBalanceAfter.sub(aliceBalanceBefore)).to.equal(balances[0]);

      // Should not allow double withdrawal
      await expect(channel.connect(alice).withdraw()).to.be.revertedWithCustomError(
        channel,
        "InvalidWithdrawalAmount"
      );
    });
  });
});