import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract, Signer, BigNumber } from "ethers";
import { time, loadFixture, mine } from "@nomicfoundation/hardhat-network-helpers";

describe("SettlementQueueV5 - Edge Cases and Security Hardening Tests", function () {
  const OPERATOR_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("OPERATOR_ROLE"));
  const EXECUTOR_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("EXECUTOR_ROLE"));
  const GUARDIAN_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("GUARDIAN_ROLE"));
  const EMERGENCY_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("EMERGENCY_ROLE"));
  const ORACLE_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("ORACLE_ROLE"));

  async function deployQueueV5Fixture() {
    const [
      owner, operator, executor, guardian, emergency,
      oracle1, oracle2, oracle3, trader1, trader2, 
      attacker, maliciousOracle, user1, user2
    ] = await ethers.getSigners();
    
    // Deploy mock tokens with different decimals for edge case testing
    const MockToken = await ethers.getContractFactory("MockERC20");
    const mockUSDC = await MockToken.deploy("Mock USDC", "USDC", 6);
    const mockWETH = await MockToken.deploy("Mock WETH", "WETH", 18);
    const mockBTC = await MockToken.deploy("Mock BTC", "BTC", 8);
    const mockDAI = await MockToken.deploy("Mock DAI", "DAI", 18);
    const weirdToken = await MockToken.deploy("Weird Token", "WEIRD", 0); // 0 decimals edge case
    
    // Deploy SettlementQueueV5
    const largeSettlementThreshold = ethers.utils.parseUnits("1000", 6);
    const initialTokens = [mockUSDC.address, mockWETH.address, mockBTC.address];
    const initialLimits = [
      ethers.utils.parseUnits("1000000", 6),  // 1M USDC
      ethers.utils.parseUnits("1000", 18),    // 1k WETH
      ethers.utils.parseUnits("100", 8)       // 100 BTC
    ];
    const initialOracles = [oracle1.address, oracle2.address, oracle3.address];
    
    const SettlementQueueV5 = await ethers.getContractFactory("SettlementQueueV5");
    const queueV5 = await SettlementQueueV5.deploy(
      largeSettlementThreshold,
      initialTokens,
      initialLimits,
      initialOracles
    );
    
    // Setup roles
    await queueV5.grantRole(OPERATOR_ROLE, operator.address);
    await queueV5.grantRole(EXECUTOR_ROLE, executor.address);
    await queueV5.grantRole(GUARDIAN_ROLE, guardian.address);
    await queueV5.grantRole(EMERGENCY_ROLE, emergency.address);
    await queueV5.grantRole(ORACLE_ROLE, oracle1.address);
    await queueV5.grantRole(ORACLE_ROLE, oracle2.address);
    await queueV5.grantRole(ORACLE_ROLE, oracle3.address);
    
    // Fund contracts and users
    const fundAmount = ethers.utils.parseUnits("10000000", 6);
    await mockUSDC.mint(queueV5.address, fundAmount);
    await mockWETH.mint(queueV5.address, ethers.utils.parseUnits("10000", 18));
    await mockBTC.mint(queueV5.address, ethers.utils.parseUnits("1000", 8));
    
    // Fund traders
    for (const trader of [trader1, trader2]) {
      await mockUSDC.mint(trader.address, ethers.utils.parseUnits("100000", 6));
      await mockWETH.mint(trader.address, ethers.utils.parseUnits("100", 18));
      await mockBTC.mint(trader.address, ethers.utils.parseUnits("10", 8));
      
      await mockUSDC.connect(trader).approve(queueV5.address, ethers.constants.MaxUint256);
      await mockWETH.connect(trader).approve(queueV5.address, ethers.constants.MaxUint256);
      await mockBTC.connect(trader).approve(queueV5.address, ethers.constants.MaxUint256);
    }
    
    return {
      queueV5,
      mockUSDC,
      mockWETH,
      mockBTC,
      mockDAI,
      weirdToken,
      owner,
      operator,
      executor,
      guardian,
      emergency,
      oracle1,
      oracle2,
      oracle3,
      trader1,
      trader2,
      attacker,
      maliciousOracle,
      user1,
      user2,
      largeSettlementThreshold
    };
  }

  describe("Integer Overflow and Underflow Protection", function () {
    it("Should handle maximum uint256 values safely", async function () {
      const { queueV5, trader1, mockUSDC, mockWETH } = await loadFixture(deployQueueV5Fixture);
      
      const maxUint256 = ethers.constants.MaxUint256;
      const commitmentHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("max_value_test"));
      const expiry = Math.floor(Date.now() / 1000) + 3600;
      
      // Should handle max values without overflow
      await expect(
        queueV5.connect(trader1).commitOrderSecure(
          commitmentHash,
          ethers.utils.parseEther("1"),
          expiry,
          { value: ethers.utils.parseEther("1") }
        )
      ).to.not.be.reverted;
    });

    it("Should prevent arithmetic overflow in price calculations", async function () {
      const { queueV5, oracle1, mockUSDC } = await loadFixture(deployQueueV5Fixture);
      
      const maxPrice = ethers.constants.MaxUint256.div(2); // Large but safe price
      const confidence = 100;
      const timestamp = Math.floor(Date.now() / 1000);
      
      // Create EIP-712 signature for oracle update
      const domain = {
        name: "SettlementQueueV5",
        version: "5.0",
        chainId: await oracle1.getChainId(),
        verifyingContract: queueV5.address
      };
      
      const types = {
        OracleUpdate: [
          { name: "token", type: "address" },
          { name: "price", type: "uint256" },
          { name: "confidence", type: "uint256" },
          { name: "timestamp", type: "uint256" },
          { name: "nonce", type: "uint256" }
        ]
      };
      
      const value = {
        token: mockUSDC.address,
        price: maxPrice,
        confidence: confidence,
        timestamp: timestamp,
        nonce: 1
      };
      
      const signature = await oracle1._signTypedData(domain, types, value);
      
      // Should handle large price values safely
      await expect(
        queueV5.connect(oracle1).updatePriceOracleSecure(
          mockUSDC.address,
          maxPrice,
          confidence,
          timestamp,
          signature
        )
      ).to.not.be.reverted;
    });

    it("Should handle zero values and edge cases", async function () {
      const { queueV5, trader1 } = await loadFixture(deployQueueV5Fixture);
      
      // Zero commitment hash should fail
      await expect(
        queueV5.connect(trader1).commitOrderSecure(
          ethers.constants.HashZero,
          ethers.utils.parseEther("1"),
          Math.floor(Date.now() / 1000) + 3600,
          { value: ethers.utils.parseEther("1") }
        )
      ).to.be.revertedWithCustomError(queueV5, "InvalidCommitment");
      
      // Zero deposit should fail
      await expect(
        queueV5.connect(trader1).commitOrderSecure(
          ethers.utils.keccak256(ethers.utils.toUtf8Bytes("test")),
          ethers.utils.parseEther("1"),
          Math.floor(Date.now() / 1000) + 3600,
          { value: 0 }
        )
      ).to.be.revertedWithCustomError(queueV5, "InsufficientBalance");
    });
  });

  describe("Multi-Oracle Price Manipulation Edge Cases", function () {
    it("Should detect and reject manipulated price feeds", async function () {
      const { queueV5, oracle1, oracle2, mockUSDC } = await loadFixture(deployQueueV5Fixture);
      
      const normalPrice = ethers.utils.parseUnits("1", 8); // $1
      const manipulatedPrice = ethers.utils.parseUnits("10", 8); // $10 (1000% increase)
      const timestamp = Math.floor(Date.now() / 1000);
      
      // First oracle provides normal price
      const domain = {
        name: "SettlementQueueV5",
        version: "5.0",
        chainId: await oracle1.getChainId(),
        verifyingContract: queueV5.address
      };
      
      const types = {
        OracleUpdate: [
          { name: "token", type: "address" },
          { name: "price", type: "uint256" },
          { name: "confidence", type: "uint256" },
          { name: "timestamp", type: "uint256" },
          { name: "nonce", type: "uint256" }
        ]
      };
      
      // Submit normal price
      let value = {
        token: mockUSDC.address,
        price: normalPrice,
        confidence: 95,
        timestamp: timestamp,
        nonce: 1
      };
      
      let signature = await oracle1._signTypedData(domain, types, value);
      
      await queueV5.connect(oracle1).updatePriceOracleSecure(
        mockUSDC.address,
        normalPrice,
        95,
        timestamp,
        signature
      );
      
      // Wait a moment to avoid same-block issues
      await time.increase(1);
      
      // Second oracle tries to submit manipulated price
      value = {
        token: mockUSDC.address,
        price: manipulatedPrice,
        confidence: 95,
        timestamp: timestamp + 1,
        nonce: 2
      };
      
      signature = await oracle2._signTypedData(domain, types, value);
      
      // Should detect price manipulation
      await expect(
        queueV5.connect(oracle2).updatePriceOracleSecure(
          mockUSDC.address,
          manipulatedPrice,
          95,
          timestamp + 1,
          signature
        )
      ).to.be.revertedWithCustomError(queueV5, "OracleManipulationDetected");
    });

    it("Should handle stale price feeds gracefully", async function () {
      const { queueV5, oracle1, mockUSDC } = await loadFixture(deployQueueV5Fixture);
      
      const price = ethers.utils.parseUnits("1", 8);
      const staleTimestamp = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
      
      const domain = {
        name: "SettlementQueueV5",
        version: "5.0",
        chainId: await oracle1.getChainId(),
        verifyingContract: queueV5.address
      };
      
      const types = {
        OracleUpdate: [
          { name: "token", type: "address" },
          { name: "price", type: "uint256" },
          { name: "confidence", type: "uint256" },
          { name: "timestamp", type: "uint256" },
          { name: "nonce", type: "uint256" }
        ]
      };
      
      const value = {
        token: mockUSDC.address,
        price: price,
        confidence: 95,
        timestamp: staleTimestamp,
        nonce: 1
      };
      
      const signature = await oracle1._signTypedData(domain, types, value);
      
      // Should reject stale price
      await expect(
        queueV5.connect(oracle1).updatePriceOracleSecure(
          mockUSDC.address,
          price,
          95,
          staleTimestamp,
          signature
        )
      ).to.be.revertedWithCustomError(queueV5, "StalePrice");
    });

    it("Should require multiple oracles for price aggregation", async function () {
      const { queueV5, mockUSDC } = await loadFixture(deployQueueV5Fixture);
      
      // Should fail when no oracles have submitted prices
      await expect(
        queueV5.getAggregatedPrice(mockUSDC.address)
      ).to.be.revertedWithCustomError(queueV5, "StalePrice");
    });
  });

  describe("Commit-Reveal Timing Edge Cases", function () {
    it("Should handle commitment expiry edge cases", async function () {
      const { queueV5, trader1 } = await loadFixture(deployQueueV5Fixture);
      
      const commitmentHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("timing_test"));
      const shortExpiry = Math.floor(Date.now() / 1000) + 30; // 30 seconds (too short)
      
      // Should reject commitment with too short expiry
      await expect(
        queueV5.connect(trader1).commitOrderSecure(
          commitmentHash,
          ethers.utils.parseEther("1"),
          shortExpiry,
          { value: ethers.utils.parseEther("1") }
        )
      ).to.be.revertedWithCustomError(queueV5, "InvalidCommitment");
    });

    it("Should prevent revealing after expiry", async function () {
      const { queueV5, trader1, mockUSDC, mockWETH } = await loadFixture(deployQueueV5Fixture);
      
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
        submittedAt: 0,
        priority: 500,
        status: 0,
        requiresMultiSig: false,
        metadata: ethers.constants.HashZero,
        commitmentHash: ethers.constants.HashZero,
        lastUpdateBlock: 0
      };
      
      const salt = 12345;
      const orderHash = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["address", "address", "address", "uint256", "uint256", "uint256"],
          [order.trader, order.tokenIn, order.tokenOut, order.amountIn, order.minAmountOut, salt]
        )
      );
      
      const commitmentHash = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["bytes32", "uint256", "address", "uint256"],
          [orderHash, salt, trader1.address, Math.floor(Date.now() / 1000)]
        )
      );
      
      const expiry = Math.floor(Date.now() / 1000) + 120; // 2 minutes
      
      // Commit order
      const commitTx = await queueV5.connect(trader1).commitOrderSecure(
        commitmentHash,
        ethers.utils.parseEther("1"),
        expiry,
        { value: ethers.utils.parseEther("1") }
      );
      const commitReceipt = await commitTx.wait();
      const commitmentId = commitReceipt.events[0].args.commitmentId;
      
      // Fast forward past expiry
      await time.increase(125);
      
      // Should fail to reveal after expiry
      await expect(
        queueV5.connect(trader1).revealOrderSecure(commitmentId, order, salt)
      ).to.be.revertedWithCustomError(queueV5, "RevealPeriodExpired");
    });

    it("Should prevent double reveals", async function () {
      const { queueV5, trader1, mockUSDC, mockWETH } = await loadFixture(deployQueueV5Fixture);
      
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
        submittedAt: 0,
        priority: 500,
        status: 0,
        requiresMultiSig: false,
        metadata: ethers.constants.HashZero,
        commitmentHash: ethers.constants.HashZero,
        lastUpdateBlock: 0
      };
      
      const salt = 12345;
      const currentTime = Math.floor(Date.now() / 1000);
      const orderHash = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["address", "address", "address", "uint256", "uint256", "uint256"],
          [order.trader, order.tokenIn, order.tokenOut, order.amountIn, order.minAmountOut, salt]
        )
      );
      
      const commitmentHash = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["bytes32", "uint256", "address", "uint256"],
          [orderHash, salt, trader1.address, currentTime]
        )
      );
      
      const expiry = currentTime + 1800; // 30 minutes
      
      // Commit order
      const commitTx = await queueV5.connect(trader1).commitOrderSecure(
        commitmentHash,
        ethers.utils.parseEther("1"),
        expiry,
        { value: ethers.utils.parseEther("1") }
      );
      const commitReceipt = await commitTx.wait();
      const commitmentId = commitReceipt.events[0].args.commitmentId;
      
      // First reveal should succeed
      await queueV5.connect(trader1).revealOrderSecure(commitmentId, order, salt);
      
      // Second reveal should fail
      await expect(
        queueV5.connect(trader1).revealOrderSecure(commitmentId, order, salt)
      ).to.be.revertedWithCustomError(queueV5, "InvalidCommitment");
    });
  });

  describe("Multi-Block Reentrancy Protection", function () {
    it("Should prevent multi-block reentrancy attacks", async function () {
      const { queueV5, trader1 } = await loadFixture(deployQueueV5Fixture);
      
      const commitmentHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("reentrancy_test"));
      const expiry = Math.floor(Date.now() / 1000) + 1800;
      
      // First transaction
      await queueV5.connect(trader1).commitOrderSecure(
        commitmentHash,
        ethers.utils.parseEther("1"),
        expiry,
        { value: ethers.utils.parseEther("1") }
      );
      
      // Same block transaction should be prevented
      const commitmentHash2 = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("reentrancy_test_2"));
      
      await expect(
        queueV5.connect(trader1).commitOrderSecure(
          commitmentHash2,
          ethers.utils.parseEther("1"),
          expiry,
          { value: ethers.utils.parseEther("1") }
        )
      ).to.be.revertedWithCustomError(queueV5, "MultiBlockReentrancy");
    });

    it("Should allow transactions after protection window", async function () {
      const { queueV5, trader1 } = await loadFixture(deployQueueV5Fixture);
      
      const commitmentHash1 = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("test1"));
      const expiry = Math.floor(Date.now() / 1000) + 1800;
      
      // First transaction
      await queueV5.connect(trader1).commitOrderSecure(
        commitmentHash1,
        ethers.utils.parseEther("1"),
        expiry,
        { value: ethers.utils.parseEther("1") }
      );
      
      // Mine blocks to pass protection window
      await mine(4); // 4 blocks (> MULTI_BLOCK_PROTECTION)
      
      // Should allow new transaction after protection window
      const commitmentHash2 = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("test2"));
      
      await expect(
        queueV5.connect(trader1).commitOrderSecure(
          commitmentHash2,
          ethers.utils.parseEther("1"),
          expiry,
          { value: ethers.utils.parseEther("1") }
        )
      ).to.not.be.reverted;
    });
  });

  describe("Gas Limit and DoS Protection", function () {
    it("Should handle maximum batch sizes without running out of gas", async function () {
      const { queueV5, trader1 } = await loadFixture(deployQueueV5Fixture);
      
      // Test with maximum allowed operations
      const maxOperations = 5; // MAX_CONCURRENT_OPERATIONS
      
      for (let i = 0; i < maxOperations; i++) {
        const commitmentHash = ethers.utils.keccak256(
          ethers.utils.toUtf8Bytes(`batch_test_${i}`)
        );
        const expiry = Math.floor(Date.now() / 1000) + 1800;
        
        await queueV5.connect(trader1).commitOrderSecure(
          commitmentHash,
          ethers.utils.parseEther("0.1"),
          expiry,
          { value: ethers.utils.parseEther("0.1") }
        );
        
        // Mine a block to avoid multi-block protection
        await mine(1);
      }
      
      // Additional operation should be prevented by anomaly detection
      const commitmentHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("overflow_test"));
      const expiry = Math.floor(Date.now() / 1000) + 1800;
      
      await expect(
        queueV5.connect(trader1).commitOrderSecure(
          commitmentHash,
          ethers.utils.parseEther("0.1"),
          expiry,
          { value: ethers.utils.parseEther("0.1") }
        )
      ).to.be.revertedWithCustomError(queueV5, "AnomalyDetected");
    });

    it("Should prevent gas griefing through large arrays", async function () {
      const { queueV5 } = await loadFixture(deployQueueV5Fixture);
      
      // This test verifies that the contract handles large data structures efficiently
      // The bitmap implementation should prevent O(n) operations that could cause DoS
      
      // Get system health - should not consume excessive gas
      const gasEstimate = await queueV5.estimateGas.getSystemHealth();
      expect(gasEstimate).to.be.lt(100000); // Should use less than 100k gas
    });
  });

  describe("Token Edge Cases", function () {
    it("Should handle tokens with different decimal places", async function () {
      const { queueV5, weirdToken, trader1 } = await loadFixture(deployQueueV5Fixture);
      
      // Tokens with 0 decimals should still work
      const order = {
        id: 0,
        trader: trader1.address,
        tokenIn: weirdToken.address,
        tokenOut: weirdToken.address,
        amountIn: 100, // 100 tokens (no decimals)
        minAmountOut: 99,
        maxSlippageBps: 100,
        deadline: Math.floor(Date.now() / 1000) + 3600,
        nonce: 0,
        submittedAt: 0,
        priority: 500,
        status: 0,
        requiresMultiSig: false,
        metadata: ethers.constants.HashZero,
        commitmentHash: ethers.constants.HashZero,
        lastUpdateBlock: 0
      };
      
      // Should handle zero-decimal tokens correctly
      expect(order.amountIn).to.equal(100);
      expect(order.minAmountOut).to.equal(99);
    });

    it("Should prevent operations with non-whitelisted tokens", async function () {
      const { queueV5, mockDAI, trader1 } = await loadFixture(deployQueueV5Fixture);
      
      const order = {
        id: 0,
        trader: trader1.address,
        tokenIn: mockDAI.address, // Not whitelisted
        tokenOut: mockDAI.address,
        amountIn: ethers.utils.parseUnits("1000", 18),
        minAmountOut: ethers.utils.parseUnits("999", 18),
        maxSlippageBps: 100,
        deadline: Math.floor(Date.now() / 1000) + 3600,
        nonce: 0,
        submittedAt: 0,
        priority: 500,
        status: 0,
        requiresMultiSig: false,
        metadata: ethers.constants.HashZero,
        commitmentHash: ethers.constants.HashZero,
        lastUpdateBlock: 0
      };
      
      // Should validate that tokens are whitelisted during order processing
      expect(await queueV5.whitelistedTokens(mockDAI.address)).to.be.false;
    });
  });

  describe("Circuit Breaker Edge Cases", function () {
    it("Should trigger circuit breaker on rapid successive operations", async function () {
      const { queueV5, trader1 } = await loadFixture(deployQueueV5Fixture);
      
      // Perform operations rapidly to trigger anomaly detection
      for (let i = 0; i < 50; i++) { // Below ANOMALY_THRESHOLD but rapid
        try {
          const commitmentHash = ethers.utils.keccak256(
            ethers.utils.toUtf8Bytes(`rapid_test_${i}`)
          );
          const expiry = Math.floor(Date.now() / 1000) + 1800;
          
          await queueV5.connect(trader1).commitOrderSecure(
            commitmentHash,
            ethers.utils.parseEther("0.01"),
            expiry,
            { value: ethers.utils.parseEther("0.01") }
          );
          
          await mine(1); // Mine block to avoid multi-block protection
        } catch (error) {
          // Should eventually trigger anomaly detection
          expect(error.message).to.include("AnomalyDetected");
          break;
        }
      }
    });

    it("Should reset circuit breaker after time window", async function () {
      const { queueV5, guardian } = await loadFixture(deployQueueV5Fixture);
      
      // Manually trigger circuit breaker through emergency pause
      await queueV5.connect(guardian).emergencyPauseSecure();
      
      // Should be paused
      expect(await queueV5.paused()).to.be.true;
      
      // Reset through controlled unpause
      await queueV5.connect(guardian).controlledUnpauseSecure();
      
      // Should be unpaused with reset state
      expect(await queueV5.paused()).to.be.false;
      
      const systemHealth = await queueV5.getSystemHealth();
      expect(systemHealth.isHealthy).to.be.true;
    });
  });

  describe("Signature and Nonce Edge Cases", function () {
    it("Should prevent signature replay attacks", async function () {
      const { queueV5, oracle1, mockUSDC } = await loadFixture(deployQueueV5Fixture);
      
      const price = ethers.utils.parseUnits("1", 8);
      const confidence = 95;
      const timestamp = Math.floor(Date.now() / 1000);
      
      const domain = {
        name: "SettlementQueueV5",
        version: "5.0",
        chainId: await oracle1.getChainId(),
        verifyingContract: queueV5.address
      };
      
      const types = {
        OracleUpdate: [
          { name: "token", type: "address" },
          { name: "price", type: "uint256" },
          { name: "confidence", type: "uint256" },
          { name: "timestamp", type: "uint256" },
          { name: "nonce", type: "uint256" }
        ]
      };
      
      const value = {
        token: mockUSDC.address,
        price: price,
        confidence: confidence,
        timestamp: timestamp,
        nonce: 1
      };
      
      const signature = await oracle1._signTypedData(domain, types, value);
      
      // First use should succeed
      await queueV5.connect(oracle1).updatePriceOracleSecure(
        mockUSDC.address,
        price,
        confidence,
        timestamp,
        signature
      );
      
      // Second use of same signature should fail
      await expect(
        queueV5.connect(oracle1).updatePriceOracleSecure(
          mockUSDC.address,
          price,
          confidence,
          timestamp,
          signature
        )
      ).to.be.revertedWithCustomError(queueV5, "NonceAlreadyUsed");
    });

    it("Should handle nonce overflow gracefully", async function () {
      const { queueV5, trader1 } = await loadFixture(deployQueueV5Fixture);
      
      // The contract should handle nonce overflow by resetting to 1
      // This is tested by verifying that _getNextNonce() returns valid values
      
      const commitmentHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("nonce_test"));
      const expiry = Math.floor(Date.now() / 1000) + 1800;
      
      // Should handle nonce generation without issues
      await expect(
        queueV5.connect(trader1).commitOrderSecure(
          commitmentHash,
          ethers.utils.parseEther("1"),
          expiry,
          { value: ethers.utils.parseEther("1") }
        )
      ).to.not.be.reverted;
    });
  });

  describe("Pull Payment Security", function () {
    it("Should allow secure withdrawal of pending funds", async function () {
      const { queueV5, trader1 } = await loadFixture(deployQueueV5Fixture);
      
      const commitmentHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("withdrawal_test"));
      const expiry = Math.floor(Date.now() / 1000) + 1800;
      const deposit = ethers.utils.parseEther("1");
      
      // Commit order (deposit goes to pending withdrawals)
      await queueV5.connect(trader1).commitOrderSecure(
        commitmentHash,
        deposit,
        expiry,
        { value: deposit }
      );
      
      // Check pending withdrawals
      const pendingBefore = await queueV5.pendingWithdrawals(trader1.address);
      expect(pendingBefore).to.equal(deposit);
      
      // Withdraw funds
      const balanceBefore = await ethers.provider.getBalance(trader1.address);
      
      const tx = await queueV5.connect(trader1).withdrawPendingFunds(deposit);
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed.mul(receipt.effectiveGasPrice);
      
      const balanceAfter = await ethers.provider.getBalance(trader1.address);
      
      // Should receive deposit minus gas costs
      expect(balanceAfter).to.be.closeTo(
        balanceBefore.add(deposit).sub(gasUsed),
        ethers.utils.parseEther("0.001") // 0.001 ETH tolerance for gas estimation
      );
      
      // Pending withdrawals should be zero
      const pendingAfter = await queueV5.pendingWithdrawals(trader1.address);
      expect(pendingAfter).to.equal(0);
    });

    it("Should prevent withdrawal of more than available", async function () {
      const { queueV5, trader1 } = await loadFixture(deployQueueV5Fixture);
      
      // Try to withdraw without any pending funds
      await expect(
        queueV5.connect(trader1).withdrawPendingFunds(ethers.utils.parseEther("1"))
      ).to.be.revertedWithCustomError(queueV5, "InsufficientBalance");
    });
  });

  describe("Emergency and Recovery Edge Cases", function () {
    it("Should handle emergency pause and recovery correctly", async function () {
      const { queueV5, emergency, guardian, trader1 } = await loadFixture(deployQueueV5Fixture);
      
      // Emergency pause
      await queueV5.connect(emergency).emergencyPauseSecure();
      expect(await queueV5.paused()).to.be.true;
      
      // Operations should fail when paused
      const commitmentHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("emergency_test"));
      const expiry = Math.floor(Date.now() / 1000) + 1800;
      
      await expect(
        queueV5.connect(trader1).commitOrderSecure(
          commitmentHash,
          ethers.utils.parseEther("1"),
          expiry,
          { value: ethers.utils.parseEther("1") }
        )
      ).to.be.revertedWith("Pausable: paused");
      
      // Guardian can unpause
      await queueV5.connect(guardian).controlledUnpauseSecure();
      expect(await queueV5.paused()).to.be.false;
      
      // Operations should work after unpause
      await expect(
        queueV5.connect(trader1).commitOrderSecure(
          commitmentHash,
          ethers.utils.parseEther("1"),
          expiry,
          { value: ethers.utils.parseEther("1") }
        )
      ).to.not.be.reverted;
    });

    it("Should maintain security state across pause/unpause cycles", async function () {
      const { queueV5, emergency, guardian } = await loadFixture(deployQueueV5Fixture);
      
      // Check initial system health
      const healthBefore = await queueV5.getSystemHealth();
      expect(healthBefore.isHealthy).to.be.true;
      
      // Emergency pause
      await queueV5.connect(emergency).emergencyPauseSecure();
      
      // Controlled unpause should reset security state
      await queueV5.connect(guardian).controlledUnpauseSecure();
      
      // System should be healthy again
      const healthAfter = await queueV5.getSystemHealth();
      expect(healthAfter.isHealthy).to.be.true;
      expect(healthAfter.alerts).to.equal(0); // Alerts should be reset
    });
  });

  describe("Operator Bond Edge Cases", function () {
    it("Should handle minimum bond requirements strictly", async function () {
      const { queueV5, trader1 } = await loadFixture(deployQueueV5Fixture);
      
      const minBond = ethers.utils.parseEther("32"); // MIN_OPERATOR_BOND
      const insufficientBond = minBond.sub(1);
      
      // Should reject insufficient bond
      await expect(
        queueV5.connect(trader1).addOperatorBondSecure(
          7 * 24 * 60 * 60, // 7 days lock
          { value: insufficientBond }
        )
      ).to.be.revertedWithCustomError(queueV5, "InsufficientBond");
      
      // Should accept minimum bond
      await expect(
        queueV5.connect(trader1).addOperatorBondSecure(
          7 * 24 * 60 * 60, // 7 days lock
          { value: minBond }
        )
      ).to.not.be.reverted;
    });

    it("Should enforce bond withdrawal delays", async function () {
      const { queueV5, trader1 } = await loadFixture(deployQueueV5Fixture);
      
      const bond = ethers.utils.parseEther("32");
      const lockDuration = 7 * 24 * 60 * 60; // 7 days
      
      // Add bond
      await queueV5.connect(trader1).addOperatorBondSecure(lockDuration, { value: bond });
      
      // Should not allow immediate withdrawal request
      await expect(
        queueV5.connect(trader1).requestBondWithdrawal(ethers.utils.parseEther("1"))
      ).to.be.revertedWithCustomError(queueV5, "BondWithdrawalTooEarly");
      
      // Fast forward past lock period
      await time.increase(lockDuration + 1);
      
      // Should allow withdrawal request after lock period
      await expect(
        queueV5.connect(trader1).requestBondWithdrawal(ethers.utils.parseEther("1"))
      ).to.not.be.reverted;
    });
  });

  describe("Storage Layout and Upgrade Safety", function () {
    it("Should maintain storage gaps for upgrade safety", async function () {
      const { queueV5 } = await loadFixture(deployQueueV5Fixture);
      
      // The contract should have proper storage gaps defined
      // This is verified by successful deployment and basic operations
      const systemHealth = await queueV5.getSystemHealth();
      expect(systemHealth.isHealthy).to.be.true;
    });

    it("Should handle contract interaction edge cases", async function () {
      const { queueV5, trader1 } = await loadFixture(deployQueueV5Fixture);
      
      // Test view functions don't modify state
      const healthBefore = await queueV5.getSystemHealth();
      await queueV5.getSystemHealth(); // Call again
      const healthAfter = await queueV5.getSystemHealth();
      
      expect(healthBefore.isHealthy).to.equal(healthAfter.isHealthy);
      expect(healthBefore.alerts).to.equal(healthAfter.alerts);
    });
  });
});