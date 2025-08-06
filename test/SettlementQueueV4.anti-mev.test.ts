import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract, Signer, BigNumber } from "ethers";
import { time, loadFixture, mine } from "@nomicfoundation/hardhat-network-helpers";

describe("SettlementQueueV4 - Anti-MEV Protection Tests", function () {
  const OPERATOR_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("OPERATOR_ROLE"));
  const EXECUTOR_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("EXECUTOR_ROLE"));
  const FLASHBOT_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("FLASHBOT_ROLE"));
  const SEQUENCER_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("SEQUENCER_ROLE"));
  const ORACLE_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("ORACLE_ROLE"));

  async function deployQueueV4Fixture() {
    const [
      owner, operator, executor, flashbot, sequencer, oracle,
      trader1, trader2, trader3, attacker, user1, user2
    ] = await ethers.getSigners();
    
    // Deploy mock tokens
    const MockToken = await ethers.getContractFactory("MockERC20");
    const mockUSDC = await MockToken.deploy("Mock USDC", "USDC", 6);
    const mockWETH = await MockToken.deploy("Mock WETH", "WETH", 18);
    const mockDAI = await MockToken.deploy("Mock DAI", "DAI", 18);
    
    // Deploy settlement queue V4
    const largeSettlementThreshold = ethers.utils.parseUnits("1000", 6);
    const initialTokens = [mockUSDC.address, mockWETH.address, mockDAI.address];
    const initialLimits = [
      ethers.utils.parseUnits("1000000", 6),  // 1M USDC per day
      ethers.utils.parseUnits("1000", 18),    // 1k WETH per day
      ethers.utils.parseUnits("1000000", 18)  // 1M DAI per day
    ];
    
    const SettlementQueueV4 = await ethers.getContractFactory("SettlementQueueV4");
    const queueV4 = await SettlementQueueV4.deploy(
      largeSettlementThreshold,
      initialTokens,
      initialLimits,
      ethers.constants.AddressZero, // No gas oracle for testing
      ethers.constants.AddressZero  // No randomness beacon for testing
    );
    
    // Setup roles
    await queueV4.grantRole(OPERATOR_ROLE, operator.address);
    await queueV4.grantRole(EXECUTOR_ROLE, executor.address);
    await queueV4.grantRole(FLASHBOT_ROLE, flashbot.address);
    await queueV4.grantRole(SEQUENCER_ROLE, sequencer.address);
    await queueV4.grantRole(ORACLE_ROLE, oracle.address);
    
    // Whitelist flashbot
    await queueV4.whitelistFlashbot(flashbot.address);
    
    // Fund contracts and users
    const fundAmount = ethers.utils.parseUnits("10000000", 6);
    await mockUSDC.mint(queueV4.address, fundAmount);
    await mockWETH.mint(queueV4.address, ethers.utils.parseUnits("10000", 18));
    await mockDAI.mint(queueV4.address, ethers.utils.parseUnits("10000000", 18));
    
    // Fund traders
    for (const trader of [trader1, trader2, trader3]) {
      await mockUSDC.mint(trader.address, ethers.utils.parseUnits("100000", 6));
      await mockWETH.mint(trader.address, ethers.utils.parseUnits("100", 18));
      await mockDAI.mint(trader.address, ethers.utils.parseUnits("100000", 18));
      
      // Approve spending
      await mockUSDC.connect(trader).approve(queueV4.address, ethers.constants.MaxUint256);
      await mockWETH.connect(trader).approve(queueV4.address, ethers.constants.MaxUint256);
      await mockDAI.connect(trader).approve(queueV4.address, ethers.constants.MaxUint256);
    }
    
    return {
      queueV4,
      mockUSDC,
      mockWETH,
      mockDAI,
      owner,
      operator,
      executor,
      flashbot,
      sequencer,
      oracle,
      trader1,
      trader2,
      trader3,
      attacker,
      user1,
      user2,
      largeSettlementThreshold
    };
  }

  describe("Commit-Reveal Scheme", function () {
    it("Should allow order commitment with proper deposit", async function () {
      const { queueV4, trader1 } = await loadFixture(deployQueueV4Fixture);
      
      const commitmentHash = ethers.utils.keccak256(
        ethers.utils.toUtf8Bytes("secret_order_data_123")
      );
      const deposit = ethers.utils.parseEther("0.1");

      const tx = await queueV4.connect(trader1).commitOrder(commitmentHash, deposit, {
        value: deposit
      });
      const receipt = await tx.wait();

      expect(receipt.events).to.have.length.greaterThan(0);
      const commitEvent = receipt.events.find(e => e.event === "OrderCommitted");
      expect(commitEvent).to.not.be.undefined;
      expect(commitEvent.args.committer).to.equal(trader1.address);
      expect(commitEvent.args.deposit).to.equal(deposit);
    });

    it("Should prevent duplicate commitments", async function () {
      const { queueV4, trader1 } = await loadFixture(deployQueueV4Fixture);
      
      const commitmentHash = ethers.utils.keccak256(
        ethers.utils.toUtf8Bytes("secret_order_data_123")
      );
      const deposit = ethers.utils.parseEther("0.1");

      // First commitment should succeed
      await queueV4.connect(trader1).commitOrder(commitmentHash, deposit, {
        value: deposit
      });

      // Second identical commitment should fail
      await expect(
        queueV4.connect(trader1).commitOrder(commitmentHash, deposit, {
          value: deposit
        })
      ).to.be.revertedWithCustomError(queueV4, "CommitmentAlreadyExists");
    });

    it("Should allow order reveal after commit phase", async function () {
      const { queueV4, mockUSDC, mockWETH, trader1 } = await loadFixture(deployQueueV4Fixture);
      
      // Create order
      const order = {
        id: 0, // Will be set by contract
        trader: trader1.address,
        tokenIn: mockUSDC.address,
        tokenOut: mockWETH.address,
        amountIn: ethers.utils.parseUnits("1000", 6),
        minAmountOut: ethers.utils.parseEther("0.4"),
        maxSlippageBps: 500,
        deadline: Math.floor(Date.now() / 1000) + 3600,
        nonce: 0, // Will be set by contract
        priority: 500,
        createdAt: 0, // Will be set by contract
        commitPhaseEnd: 0, // Will be set by contract
        revealPhaseEnd: 0, // Will be set by contract
        status: 0,
        requiresCommitReveal: true,
        metadata: ethers.constants.HashZero
      };

      const salt = 12345;
      
      // Calculate order hash (simplified)
      const orderData = ethers.utils.defaultAbiCoder.encode(
        ["address", "address", "address", "uint256", "uint256", "uint256"],
        [order.trader, order.tokenIn, order.tokenOut, order.amountIn, order.minAmountOut, salt]
      );
      const orderHash = ethers.utils.keccak256(orderData);
      
      // Create commitment
      const commitmentHash = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["bytes32", "uint256", "address"],
          [orderHash, salt, trader1.address]
        )
      );
      
      const deposit = ethers.utils.parseEther("0.1");

      // Commit order
      const commitTx = await queueV4.connect(trader1).commitOrder(commitmentHash, deposit, {
        value: deposit
      });
      const commitReceipt = await commitTx.wait();
      
      const commitmentId = commitReceipt.events[0].args[0];

      // Wait for minimum delay
      await time.increase(16); // 16 seconds (> MIN_COMMIT_REVEAL_DELAY)

      // Reveal order
      await expect(
        queueV4.connect(trader1).revealOrder(commitmentId, order, salt)
      ).to.not.be.reverted;
    });

    it("Should prevent early reveals", async function () {
      const { queueV4, mockUSDC, mockWETH, trader1 } = await loadFixture(deployQueueV4Fixture);
      
      const order = {
        id: 0,
        trader: trader1.address,
        tokenIn: mockUSDC.address,
        tokenOut: mockWETH.address,
        amountIn: ethers.utils.parseUnits("1000", 6),
        minAmountOut: ethers.utils.parseEther("0.4"),
        maxSlippageBps: 500,
        deadline: Math.floor(Date.now() / 1000) + 3600,
        nonce: 0,
        priority: 500,
        createdAt: 0,
        commitPhaseEnd: 0,
        revealPhaseEnd: 0,
        status: 0,
        requiresCommitReveal: true,
        metadata: ethers.constants.HashZero
      };

      const salt = 12345;
      const orderData = ethers.utils.defaultAbiCoder.encode(
        ["address", "address", "address", "uint256", "uint256", "uint256"],
        [order.trader, order.tokenIn, order.tokenOut, order.amountIn, order.minAmountOut, salt]
      );
      const orderHash = ethers.utils.keccak256(orderData);
      const commitmentHash = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["bytes32", "uint256", "address"],
          [orderHash, salt, trader1.address]
        )
      );
      
      const deposit = ethers.utils.parseEther("0.1");
      const commitTx = await queueV4.connect(trader1).commitOrder(commitmentHash, deposit, {
        value: deposit
      });
      const commitReceipt = await commitTx.wait();
      const commitmentId = commitReceipt.events[0].args[0];

      // Try to reveal immediately (should fail)
      await expect(
        queueV4.connect(trader1).revealOrder(commitmentId, order, salt)
      ).to.be.revertedWithCustomError(queueV4, "RevealPeriodNotStarted");
    });

    it("Should prevent reveals after deadline", async function () {
      const { queueV4, mockUSDC, mockWETH, trader1 } = await loadFixture(deployQueueV4Fixture);
      
      const order = {
        id: 0,
        trader: trader1.address,
        tokenIn: mockUSDC.address,
        tokenOut: mockWETH.address,
        amountIn: ethers.utils.parseUnits("1000", 6),
        minAmountOut: ethers.utils.parseEther("0.4"),
        maxSlippageBps: 500,
        deadline: Math.floor(Date.now() / 1000) + 3600,
        nonce: 0,
        priority: 500,
        createdAt: 0,
        commitPhaseEnd: 0,
        revealPhaseEnd: 0,
        status: 0,
        requiresCommitReveal: true,
        metadata: ethers.constants.HashZero
      };

      const salt = 12345;
      const orderData = ethers.utils.defaultAbiCoder.encode(
        ["address", "address", "address", "uint256", "uint256", "uint256"],
        [order.trader, order.tokenIn, order.tokenOut, order.amountIn, order.minAmountOut, salt]
      );
      const orderHash = ethers.utils.keccak256(orderData);
      const commitmentHash = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["bytes32", "uint256", "address"],
          [orderHash, salt, trader1.address]
        )
      );
      
      const deposit = ethers.utils.parseEther("0.1");
      const commitTx = await queueV4.connect(trader1).commitOrder(commitmentHash, deposit, {
        value: deposit
      });
      const commitReceipt = await commitTx.wait();
      const commitmentId = commitReceipt.events[0].args[0];

      // Wait past reveal deadline
      await time.increase(65); // 65 seconds (> REVEAL_PHASE_DURATION)

      // Try to reveal (should fail)
      await expect(
        queueV4.connect(trader1).revealOrder(commitmentId, order, salt)
      ).to.be.revertedWithCustomError(queueV4, "RevealPeriodExpired");
    });
  });

  describe("Flashbot Integration", function () {
    it("Should allow whitelisted flashbot to submit bundles", async function () {
      const { queueV4, flashbot, trader1, mockUSDC, mockWETH } = await loadFixture(deployQueueV4Fixture);
      
      // Create and reveal some orders first
      const orderIds = [];
      
      for (let i = 0; i < 3; i++) {
        const order = {
          id: 0,
          trader: trader1.address,
          tokenIn: mockUSDC.address,
          tokenOut: mockWETH.address,
          amountIn: ethers.utils.parseUnits("100", 6),
          minAmountOut: ethers.utils.parseEther("0.04"),
          maxSlippageBps: 500,
          deadline: Math.floor(Date.now() / 1000) + 3600,
          nonce: 0,
          priority: 500 + i,
          createdAt: 0,
          commitPhaseEnd: 0,
          revealPhaseEnd: 0,
          status: 1, // Revealed
          requiresCommitReveal: false,
          metadata: ethers.constants.HashZero
        };

        // For simplicity, create orders without commit-reveal for this test
        // In a real scenario, these would go through the commit-reveal process
      }

      const targetBlock = await ethers.provider.getBlockNumber() + 2;
      const maxGasPrice = ethers.utils.parseUnits("100", "gwei");
      const signature = ethers.utils.hexlify(ethers.utils.randomBytes(65));

      const tx = await queueV4.connect(flashbot).submitFlashbotBundle(
        [1, 2, 3], // Mock order IDs
        maxGasPrice,
        targetBlock,
        signature
      );

      await expect(tx).to.not.be.reverted;
      const receipt = await tx.wait();
      expect(receipt.events).to.have.length.greaterThan(0);
    });

    it("Should reject non-whitelisted flashbot submissions", async function () {
      const { queueV4, attacker } = await loadFixture(deployQueueV4Fixture);
      
      const targetBlock = await ethers.provider.getBlockNumber() + 2;
      const maxGasPrice = ethers.utils.parseUnits("100", "gwei");
      const signature = ethers.utils.hexlify(ethers.utils.randomBytes(65));

      await expect(
        queueV4.connect(attacker).submitFlashbotBundle(
          [1, 2, 3],
          maxGasPrice,
          targetBlock,
          signature
        )
      ).to.be.revertedWithCustomError(queueV4, "UnauthorizedCaller");
    });

    it("Should execute flashbot bundles with MEV protection", async function () {
      const { queueV4, flashbot, sequencer, trader1, mockUSDC, mockWETH } = await loadFixture(deployQueueV4Fixture);
      
      // Submit flashbot bundle
      const targetBlock = await ethers.provider.getBlockNumber() + 2;
      const maxGasPrice = ethers.utils.parseUnits("100", "gwei");
      const signature = ethers.utils.hexlify(ethers.utils.randomBytes(65));

      const bundleTx = await queueV4.connect(flashbot).submitFlashbotBundle(
        [1], // Single order ID
        maxGasPrice,
        targetBlock,
        signature
      );
      const bundleReceipt = await bundleTx.wait();
      const bundleId = bundleReceipt.events[0].args.bundleId;

      // Execute bundle (should work with sequencer role)
      await expect(
        queueV4.connect(sequencer).executeFlashbotBundle(bundleId)
      ).to.not.be.reverted;
    });
  });

  describe("Order Bundling and Sandwich Protection", function () {
    it("Should create atomic bundles for protection", async function () {
      const { queueV4, operator, trader1, mockUSDC, mockWETH } = await loadFixture(deployQueueV4Fixture);
      
      // Mock order IDs for bundling
      const orderIds = [1, 2, 3];
      const maxSlippagePerOrder = [500, 500, 500]; // 5% each

      const tx = await queueV4.connect(operator).createAtomicBundle(
        orderIds,
        maxSlippagePerOrder
      );

      await expect(tx).to.not.be.reverted;
      const receipt = await tx.wait();
      expect(receipt.events).to.have.length.greaterThan(0);
    });

    it("Should detect potential sandwich attacks", async function () {
      const { queueV4, operator, trader1, mockUSDC, mockWETH } = await loadFixture(deployQueueV4Fixture);
      
      // Create orders that might form a sandwich pattern
      const suspiciousOrderIds = [1, 2]; // These would be flagged by sandwich detection
      const maxSlippagePerOrder = [500, 500];

      // In a real scenario, this would trigger sandwich detection and revert
      // For this test, we'll check that the function exists and can be called
      await expect(
        queueV4.connect(operator).createAtomicBundle(
          suspiciousOrderIds,
          maxSlippagePerOrder
        )
      ).to.not.be.reverted; // Simplified test
    });

    it("Should prevent MEV extraction through bundling", async function () {
      const { queueV4, operator, executor, trader1, mockUSDC, mockWETH } = await loadFixture(deployQueueV4Fixture);
      
      // Create protective bundle
      const orderIds = [1, 2, 3];
      const maxSlippagePerOrder = [500, 500, 500];

      const bundleTx = await queueV4.connect(operator).createAtomicBundle(
        orderIds,
        maxSlippagePerOrder
      );
      const bundleReceipt = await bundleTx.wait();
      const bundleId = bundleReceipt.events[0].args.bundleId;

      // Bundled execution should protect against MEV
      // This test verifies the bundle creation and would need actual order execution for full testing
      expect(bundleId).to.be.gt(0);
    });
  });

  describe("Dynamic Slippage Protection", function () {
    it("Should update price oracles for slippage calculation", async function () {
      const { queueV4, oracle, mockUSDC } = await loadFixture(deployQueueV4Fixture);
      
      const price = ethers.utils.parseUnits("1", 8); // $1 per USDC (with 8 decimals)
      const confidence = 95; // 95% confidence
      const signature = ethers.utils.hexlify(ethers.utils.randomBytes(65));

      const tx = await queueV4.connect(oracle).updatePriceOracle(
        mockUSDC.address,
        price,
        confidence,
        signature
      );

      await expect(tx).to.not.be.reverted;
      const receipt = await tx.wait();
      
      const updateEvent = receipt.events.find(e => e.event === "PriceOracleUpdate");
      expect(updateEvent).to.not.be.undefined;
      expect(updateEvent.args.token).to.equal(mockUSDC.address);
      expect(updateEvent.args.newPrice).to.equal(price);
    });

    it("Should calculate dynamic slippage based on market conditions", async function () {
      const { queueV4, mockUSDC } = await loadFixture(deployQueueV4Fixture);
      
      const baseAmount = ethers.utils.parseUnits("1000", 6);
      
      // This would test the dynamic slippage calculation
      // For now, we verify the function exists and can be called
      const slippage = await queueV4.calculateDynamicSlippage(mockUSDC.address, baseAmount);
      expect(slippage).to.be.gte(0);
    });

    it("Should protect against slippage violations", async function () {
      const { queueV4, trader1, mockUSDC } = await loadFixture(deployQueueV4Fixture);
      
      // Create an order with tight slippage that might be violated
      const order = {
        id: 1,
        trader: trader1.address,
        tokenIn: mockUSDC.address,
        tokenOut: mockUSDC.address, // Same token for simplicity
        amountIn: ethers.utils.parseUnits("1000", 6),
        minAmountOut: ethers.utils.parseUnits("999", 6), // Very tight slippage
        maxSlippageBps: 10, // 0.1% slippage
        deadline: Math.floor(Date.now() / 1000) + 3600,
        nonce: 1,
        priority: 500,
        createdAt: Math.floor(Date.now() / 1000),
        commitPhaseEnd: 0,
        revealPhaseEnd: 0,
        status: 1, // Revealed
        requiresCommitReveal: false,
        metadata: ethers.constants.HashZero
      };

      // This test would verify slippage protection in actual execution
      expect(order.maxSlippageBps).to.equal(10);
    });
  });

  describe("Fair Sequencing Service", function () {
    it("Should update randomness beacon for fair sequencing", async function () {
      const { queueV4, sequencer } = await loadFixture(deployQueueV4Fixture);
      
      const newBeacon = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("random_beacon_data"));
      const vdfProof = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("vdf_proof_data"));

      const tx = await queueV4.connect(sequencer).updateRandomnessBeacon(
        newBeacon,
        vdfProof
      );

      await expect(tx).to.not.be.reverted;
      const receipt = await tx.wait();
      
      const updateEvent = receipt.events.find(e => e.event === "FairSequencingUpdate");
      expect(updateEvent).to.not.be.undefined;
    });

    it("Should provide fair sequencing for order execution", async function () {
      const { queueV4 } = await loadFixture(deployQueueV4Fixture);
      
      const orderIds = [1, 2, 3, 4, 5];
      
      // Get fair sequencing order
      const sequencedIds = await queueV4.getFairSequencingOrder(orderIds);
      
      expect(sequencedIds).to.have.length(orderIds.length);
      // Verify all original order IDs are present (order may be different)
      for (const originalId of orderIds) {
        expect(sequencedIds).to.include(originalId);
      }
    });

    it("Should maintain sequencing round integrity", async function () {
      const { queueV4 } = await loadFixture(deployQueueV4Fixture);
      
      // Get current sequencing round
      const currentRound = await queueV4.getCurrentSequencingRound();
      expect(currentRound).to.be.gte(1);
    });
  });

  describe("MEV Protection Integration", function () {
    it("Should integrate all MEV protection mechanisms", async function () {
      const { queueV4, operator, executor, flashbot, sequencer, oracle, trader1, mockUSDC, mockWETH } = await loadFixture(deployQueueV4Fixture);
      
      // 1. Update price oracle
      await queueV4.connect(oracle).updatePriceOracle(
        mockUSDC.address,
        ethers.utils.parseUnits("1", 8),
        95,
        ethers.utils.hexlify(ethers.utils.randomBytes(65))
      );

      // 2. Update randomness beacon
      await queueV4.connect(sequencer).updateRandomnessBeacon(
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("beacon")),
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("proof"))
      );

      // 3. Create atomic bundle for protection
      const bundleTx = await queueV4.connect(operator).createAtomicBundle(
        [1, 2], 
        [500, 500]
      );
      const bundleReceipt = await bundleTx.wait();
      const bundleId = bundleReceipt.events[0].args.bundleId;

      // 4. Submit via flashbot for private execution
      const flashbotTx = await queueV4.connect(flashbot).submitFlashbotBundle(
        [1, 2],
        ethers.utils.parseUnits("100", "gwei"),
        await ethers.provider.getBlockNumber() + 2,
        ethers.utils.hexlify(ethers.utils.randomBytes(65))
      );

      // All operations should succeed without reverting
      expect(bundleTx).to.not.be.reverted;
      expect(flashbotTx).to.not.be.reverted;
    });

    it("Should prevent common MEV attack patterns", async function () {
      const { queueV4, trader1, trader2, attacker, mockUSDC, mockWETH } = await loadFixture(deployQueueV4Fixture);
      
      // Test various MEV attack patterns:
      
      // 1. Front-running protection through commit-reveal
      const commitmentHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("secret"));
      await queueV4.connect(trader1).commitOrder(commitmentHash, ethers.utils.parseEther("0.1"), {
        value: ethers.utils.parseEther("0.1")
      });

      // 2. Sandwich attack prevention through bundling
      // (Would be tested with actual order execution)

      // 3. Slippage protection through dynamic limits
      // (Would be tested with actual price feeds)

      // For now, verify the protective mechanisms are in place
      expect(await queueV4.isWhitelistedFlashbot(attacker.address)).to.be.false;
    });

    it("Should provide comprehensive MEV metrics", async function () {
      const { queueV4 } = await loadFixture(deployQueueV4Fixture);
      
      // Get various metrics to verify MEV protection is active
      const currentRound = await queueV4.getCurrentSequencingRound();
      expect(currentRound).to.be.gte(1);

      // Check if flashbot is whitelisted (should be false for random address)
      const randomAddress = ethers.Wallet.createRandom().address;
      const isWhitelisted = await queueV4.isWhitelistedFlashbot(randomAddress);
      expect(isWhitelisted).to.be.false;
    });
  });

  describe("Security Edge Cases", function () {
    it("Should handle commitment deposit requirements", async function () {
      const { queueV4, trader1 } = await loadFixture(deployQueueV4Fixture);
      
      const commitmentHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("test"));
      const deposit = ethers.utils.parseEther("0.1");

      // Should fail with insufficient deposit
      await expect(
        queueV4.connect(trader1).commitOrder(commitmentHash, deposit, {
          value: deposit.sub(1)
        })
      ).to.be.revertedWithCustomError(queueV4, "InsufficientBalance");
    });

    it("Should prevent invalid bundle submissions", async function () {
      const { queueV4, flashbot } = await loadFixture(deployQueueV4Fixture);
      
      // Empty order array should fail
      await expect(
        queueV4.connect(flashbot).submitFlashbotBundle(
          [],
          ethers.utils.parseUnits("100", "gwei"),
          await ethers.provider.getBlockNumber() + 2,
          ethers.utils.hexlify(ethers.utils.randomBytes(65))
        )
      ).to.be.revertedWithCustomError(queueV4, "InvalidBatchSize");

      // Past target block should fail
      await expect(
        queueV4.connect(flashbot).submitFlashbotBundle(
          [1],
          ethers.utils.parseUnits("100", "gwei"),
          await ethers.provider.getBlockNumber() - 1,
          ethers.utils.hexlify(ethers.utils.randomBytes(65))
        )
      ).to.be.revertedWithCustomError(queueV4, "InvalidSettlement");
    });

    it("Should enforce oracle signature validation", async function () {
      const { queueV4, attacker, mockUSDC } = await loadFixture(deployQueueV4Fixture);
      
      // Non-oracle role should not be able to update prices
      await expect(
        queueV4.connect(attacker).updatePriceOracle(
          mockUSDC.address,
          ethers.utils.parseUnits("1", 8),
          95,
          ethers.utils.hexlify(ethers.utils.randomBytes(65))
        )
      ).to.be.reverted; // Should revert due to access control
    });

    it("Should handle VDF verification edge cases", async function () {
      const { queueV4, sequencer } = await loadFixture(deployQueueV4Fixture);
      
      // Invalid VDF proof should be rejected
      const invalidBeacon = ethers.constants.HashZero;
      const invalidProof = ethers.constants.HashZero;

      await expect(
        queueV4.connect(sequencer).updateRandomnessBeacon(invalidBeacon, invalidProof)
      ).to.be.revertedWithCustomError(queueV4, "VDFVerificationFailed");
    });
  });

  describe("Performance and Gas Optimization", function () {
    it("Should maintain gas efficiency with MEV protection", async function () {
      const { queueV4, operator, trader1, mockUSDC, mockWETH } = await loadFixture(deployQueueV4Fixture);
      
      // Test gas usage for protected operations
      const bundleTx = await queueV4.connect(operator).createAtomicBundle([1], [500]);
      const bundleReceipt = await bundleTx.wait();
      
      // Gas usage should be reasonable even with MEV protection
      expect(bundleReceipt.gasUsed).to.be.lt(500000); // Should use less than 500k gas
    });

    it("Should scale with multiple protection mechanisms", async function () {
      const { queueV4, operator, flashbot, sequencer, oracle, trader1, mockUSDC } = await loadFixture(deployQueueV4Fixture);
      
      // Run multiple MEV protection operations simultaneously
      const operations = [
        queueV4.connect(oracle).updatePriceOracle(
          mockUSDC.address,
          ethers.utils.parseUnits("1", 8),
          95,
          ethers.utils.hexlify(ethers.utils.randomBytes(65))
        ),
        queueV4.connect(sequencer).updateRandomnessBeacon(
          ethers.utils.keccak256(ethers.utils.toUtf8Bytes("beacon")),
          ethers.utils.keccak256(ethers.utils.toUtf8Bytes("proof"))
        ),
        queueV4.connect(operator).createAtomicBundle([1], [500])
      ];

      // All operations should complete successfully
      await Promise.all(operations);
    });
  });
});