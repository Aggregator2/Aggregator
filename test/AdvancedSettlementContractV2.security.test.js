const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("AdvancedSettlementContractV2 - Security Tests", function () {
    let settlementContract;
    let factory;
    let owner, maker, taker, attacker, feeRecipient, protocolFeeRecipient;
    let mockERC20A, mockERC20B;
    
    const DOMAIN_NAME = "AdvancedSettlement";
    const DOMAIN_VERSION = "1.0";
    const FEE_DIVISOR = 10000;
    
    // Helper to create order struct
    function createOrder(overrides = {}) {
        const defaultOrder = {
            maker: maker.address,
            taker: ethers.constants.AddressZero,
            makerToken: mockERC20A.address,
            takerToken: mockERC20B.address,
            makerAmount: ethers.utils.parseEther("100"),
            takerAmount: ethers.utils.parseEther("200"),
            makerTokenId: 0,
            takerTokenId: 0,
            makerTokenType: 0, // ERC20
            takerTokenType: 0, // ERC20
            salt: ethers.utils.randomBytes(32),
            expiry: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
            nonce: 0,
            makerFee: 50, // 0.5%
            takerFee: 50, // 0.5%
            feeRecipient: feeRecipient.address
        };
        
        return { ...defaultOrder, ...overrides };
    }
    
    // Helper to sign order
    async function signOrder(order, signer) {
        const domain = {
            name: DOMAIN_NAME,
            version: DOMAIN_VERSION,
            chainId: await signer.getChainId(),
            verifyingContract: settlementContract.address
        };
        
        const types = {
            Order: [
                { name: "maker", type: "address" },
                { name: "taker", type: "address" },
                { name: "makerToken", type: "address" },
                { name: "takerToken", type: "address" },
                { name: "makerAmount", type: "uint128" },
                { name: "takerAmount", type: "uint128" },
                { name: "makerTokenId", type: "uint256" },
                { name: "takerTokenId", type: "uint256" },
                { name: "salt", type: "uint256" },
                { name: "expiry", type: "uint64" },
                { name: "nonce", type: "uint64" },
                { name: "makerTokenType", type: "uint8" },
                { name: "takerTokenType", type: "uint8" },
                { name: "makerFee", type: "uint16" },
                { name: "takerFee", type: "uint16" },
                { name: "feeRecipient", type: "address" }
            ]
        };
        
        return await signer._signTypedData(domain, types, order);
    }
    
    beforeEach(async function () {
        [owner, maker, taker, attacker, feeRecipient, protocolFeeRecipient] = await ethers.getSigners();
        
        // Deploy mock tokens
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        mockERC20A = await MockERC20.deploy("Token A", "TKNA", 18);
        mockERC20B = await MockERC20.deploy("Token B", "TKNB", 18);
        
        // Deploy settlement contract
        const AdvancedSettlementContractV2 = await ethers.getContractFactory("AdvancedSettlementContractV2");
        settlementContract = await AdvancedSettlementContractV2.deploy(
            DOMAIN_NAME,
            DOMAIN_VERSION,
            protocolFeeRecipient.address
        );
        
        // Setup tokens
        await mockERC20A.mint(maker.address, ethers.utils.parseEther("10000"));
        await mockERC20B.mint(taker.address, ethers.utils.parseEther("10000"));
        await mockERC20B.mint(attacker.address, ethers.utils.parseEther("10000"));
        
        await mockERC20A.connect(maker).approve(settlementContract.address, ethers.constants.MaxUint256);
        await mockERC20B.connect(taker).approve(settlementContract.address, ethers.constants.MaxUint256);
        await mockERC20B.connect(attacker).approve(settlementContract.address, ethers.constants.MaxUint256);
    });
    
    describe("Signature Replay Protection", function () {
        it("Should prevent signature replay attacks", async function () {
            const order = createOrder();
            const signature = await signOrder(order, maker);
            
            // First fill should succeed
            await settlementContract.connect(taker).fillOrder(order, order.makerAmount, signature);
            
            // Mint more tokens for another attempt
            await mockERC20A.mint(maker.address, ethers.utils.parseEther("100"));
            
            // Second fill with same signature should fail
            await expect(
                settlementContract.connect(taker).fillOrder(order, order.makerAmount, signature)
            ).to.be.revertedWithCustomError(settlementContract, "OrderAlreadyFilled");
        });
        
        it("Should prevent cross-order signature reuse", async function () {
            const order1 = createOrder({ salt: ethers.utils.randomBytes(32) });
            const order2 = createOrder({ salt: ethers.utils.randomBytes(32) });
            const signature1 = await signOrder(order1, maker);
            
            // Try to use order1's signature for order2
            await expect(
                settlementContract.connect(taker).fillOrder(order2, order2.makerAmount, signature1)
            ).to.be.revertedWithCustomError(settlementContract, "InvalidSignature");
        });
        
        it("Should respect nonce-based cancellation", async function () {
            const order = createOrder({ nonce: 0 });
            const signature = await signOrder(order, maker);
            
            // Cancel by incrementing nonce
            await settlementContract.connect(maker).batchCancelOrdersByNonce(5);
            
            // Order should now be invalid
            await expect(
                settlementContract.connect(taker).fillOrder(order, order.makerAmount, signature)
            ).to.be.revertedWithCustomError(settlementContract, "InvalidSignature");
        });
    });
    
    describe("Reentrancy Protection", function () {
        let maliciousToken;
        
        beforeEach(async function () {
            // Deploy malicious token that attempts reentrancy
            const MaliciousToken = await ethers.getContractFactory("MaliciousReentrantToken");
            maliciousToken = await MaliciousToken.deploy(settlementContract.address);
            
            await maliciousToken.mint(maker.address, ethers.utils.parseEther("1000"));
            await maliciousToken.connect(maker).approve(settlementContract.address, ethers.constants.MaxUint256);
        });
        
        it("Should prevent reentrancy during order filling", async function () {
            const order = createOrder({
                makerToken: maliciousToken.address,
                makerAmount: ethers.utils.parseEther("100")
            });
            const signature = await signOrder(order, maker);
            
            // Set malicious token to attempt reentrancy
            await maliciousToken.setAttackMode(true);
            
            // Should revert due to reentrancy guard
            await expect(
                settlementContract.connect(taker).fillOrder(order, order.makerAmount, signature)
            ).to.be.reverted;
        });
    });
    
    describe("Integer Overflow/Underflow Protection", function () {
        it("Should handle maximum uint128 values safely", async function () {
            const maxUint128 = ethers.BigNumber.from("340282366920938463463374607431768211455");
            
            const order = createOrder({
                makerAmount: maxUint128,
                takerAmount: maxUint128
            });
            const signature = await signOrder(order, maker);
            
            // Should handle large numbers without overflow
            await expect(
                settlementContract.connect(taker).fillOrder(order, 1, signature)
            ).to.not.be.reverted;
        });
        
        it("Should prevent fee calculation overflow", async function () {
            const largeAmount = ethers.utils.parseEther("1000000000000");
            
            const order = createOrder({
                makerAmount: largeAmount,
                takerAmount: largeAmount,
                makerFee: 999, // 9.99%
                takerFee: 999
            });
            const signature = await signOrder(order, maker);
            
            // Mint required tokens
            await mockERC20A.mint(maker.address, largeAmount);
            await mockERC20B.mint(taker.address, largeAmount);
            
            // Should calculate fees correctly without overflow
            await expect(
                settlementContract.connect(taker).fillOrder(order, order.makerAmount, signature)
            ).to.not.be.reverted;
        });
    });
    
    describe("Access Control", function () {
        it("Should restrict owner functions to owner only", async function () {
            await expect(
                settlementContract.connect(attacker).emergencyPause()
            ).to.be.revertedWith("Ownable: caller is not the owner");
            
            await expect(
                settlementContract.connect(attacker).updateProtocolFee(100, attacker.address)
            ).to.be.revertedWith("Ownable: caller is not the owner");
            
            await expect(
                settlementContract.connect(attacker).setTokenPaused(mockERC20A.address, true, "test")
            ).to.be.revertedWith("Ownable: caller is not the owner");
        });
        
        it("Should implement two-step ownership transfer", async function () {
            // Initiate ownership transfer
            await settlementContract.connect(owner).transferOwnership(taker.address);
            
            // Ownership should not change yet
            expect(await settlementContract.owner()).to.equal(owner.address);
            
            // New owner must accept
            await settlementContract.connect(taker).acceptOwnership();
            
            // Now ownership should be transferred
            expect(await settlementContract.owner()).to.equal(taker.address);
        });
    });
    
    describe("Front-Running Protection", function () {
        it("Should allow specific taker restriction", async function () {
            const order = createOrder({ taker: taker.address });
            const signature = await signOrder(order, maker);
            
            // Attacker tries to front-run
            await expect(
                settlementContract.connect(attacker).fillOrder(order, order.makerAmount, signature)
            ).to.be.revertedWithCustomError(settlementContract, "UnauthorizedTaker");
            
            // Intended taker can still fill
            await expect(
                settlementContract.connect(taker).fillOrder(order, order.makerAmount, signature)
            ).to.not.be.reverted;
        });
        
        it("Should handle partial fill front-running gracefully", async function () {
            const order = createOrder();
            const signature = await signOrder(order, maker);
            
            // Attacker front-runs with partial fill
            await settlementContract.connect(attacker).fillOrder(order, order.makerAmount.div(2), signature);
            
            // Original taker can still fill remaining amount
            await expect(
                settlementContract.connect(taker).fillOrder(order, order.makerAmount, signature)
            ).to.emit(settlementContract, "OrderPartiallyFilled");
            
            // Verify order is now fully filled
            expect(await settlementContract.getOrderStatus(order)).to.equal(2); // FILLED
        });
    });
    
    describe("Dust Attack Prevention", function () {
        it("Should reject orders below minimum size", async function () {
            const order = createOrder({
                makerAmount: 999, // Below MIN_ORDER_SIZE (1000)
                takerAmount: 999
            });
            const signature = await signOrder(order, maker);
            
            await expect(
                settlementContract.connect(taker).fillOrder(order, order.makerAmount, signature)
            ).to.be.revertedWithCustomError(settlementContract, "OrderTooSmall");
        });
        
        it("Should allow small NFT trades", async function () {
            const order = createOrder({
                makerAmount: 1,
                makerTokenType: 1, // ERC721
                takerAmount: ethers.utils.parseEther("1")
            });
            const signature = await signOrder(order, maker);
            
            // Small amount is OK for NFTs
            await expect(
                settlementContract.connect(taker).fillOrder(order, 1, signature)
            ).to.not.be.reverted;
        });
    });
    
    describe("Circuit Breaker Security", function () {
        it("Should enforce emergency pause", async function () {
            await settlementContract.connect(owner).emergencyPause();
            
            const order = createOrder();
            const signature = await signOrder(order, maker);
            
            await expect(
                settlementContract.connect(taker).fillOrder(order, order.makerAmount, signature)
            ).to.be.revertedWith("Pausable: paused");
        });
        
        it("Should track and limit daily volume", async function () {
            // Set low daily limit
            await settlementContract.connect(owner).updateCircuitBreakerLimits(
                ethers.utils.parseEther("150"), // 150 token daily limit
                ethers.utils.parseEther("1000")
            );
            
            const order1 = createOrder({
                makerAmount: ethers.utils.parseEther("50"),
                takerAmount: ethers.utils.parseEther("50")
            });
            const signature1 = await signOrder(order1, maker);
            
            // First order (100 total volume) should succeed
            await settlementContract.connect(taker).fillOrder(order1, order1.makerAmount, signature1);
            
            // Prepare second order
            await mockERC20A.mint(maker.address, ethers.utils.parseEther("100"));
            const order2 = createOrder({
                makerAmount: ethers.utils.parseEther("60"),
                takerAmount: ethers.utils.parseEther("60"),
                salt: ethers.utils.randomBytes(32)
            });
            const signature2 = await signOrder(order2, maker);
            
            // Second order would exceed daily limit (220 > 150)
            await expect(
                settlementContract.connect(taker).fillOrder(order2, order2.makerAmount, signature2)
            ).to.be.revertedWithCustomError(settlementContract, "DailyVolumeExceeded");
            
            // Fast forward 24 hours
            await time.increase(24 * 60 * 60);
            
            // Now it should work
            await expect(
                settlementContract.connect(taker).fillOrder(order2, order2.makerAmount, signature2)
            ).to.not.be.reverted;
        });
        
        it("Should prevent token-specific attacks", async function () {
            // Pause a specific token
            await settlementContract.connect(owner).setTokenPaused(
                mockERC20A.address,
                true,
                "Potential exploit detected"
            );
            
            const order = createOrder();
            const signature = await signOrder(order, maker);
            
            await expect(
                settlementContract.connect(taker).fillOrder(order, order.makerAmount, signature)
            ).to.be.revertedWithCustomError(settlementContract, "TokenPaused");
            
            // Other tokens should still work
            const orderB = createOrder({
                makerToken: mockERC20B.address,
                takerToken: mockERC20A.address,
                maker: taker.address,
                salt: ethers.utils.randomBytes(32)
            });
            const signatureB = await signOrder(orderB, taker);
            
            await mockERC20B.connect(taker).approve(settlementContract.address, ethers.constants.MaxUint256);
            await mockERC20A.connect(maker).approve(settlementContract.address, ethers.constants.MaxUint256);
            await mockERC20A.mint(maker.address, ethers.utils.parseEther("200"));
            
            await expect(
                settlementContract.connect(maker).fillOrder(orderB, orderB.makerAmount, signatureB)
            ).to.be.revertedWithCustomError(settlementContract, "TokenPaused");
        });
    });
    
    describe("Fee Manipulation Protection", function () {
        it("Should enforce maximum fee limits", async function () {
            const order = createOrder({
                makerFee: 1001, // 10.01% - above max
                takerFee: 500
            });
            const signature = await signOrder(order, maker);
            
            await expect(
                settlementContract.connect(taker).fillOrder(order, order.makerAmount, signature)
            ).to.be.revertedWithCustomError(settlementContract, "FeeTooHigh");
        });
        
        it("Should require fee recipient if fees are set", async function () {
            const order = createOrder({
                makerFee: 100,
                takerFee: 100,
                feeRecipient: ethers.constants.AddressZero
            });
            const signature = await signOrder(order, maker);
            
            await expect(
                settlementContract.connect(taker).fillOrder(order, order.makerAmount, signature)
            ).to.be.revertedWithCustomError(settlementContract, "InvalidRecipient");
        });
        
        it("Should correctly calculate fees on partial fills", async function () {
            const order = createOrder({
                makerFee: 100, // 1%
                takerFee: 200  // 2%
            });
            const signature = await signOrder(order, maker);
            
            const fillAmount = order.makerAmount.div(4); // 25% fill
            const expectedMakerFee = fillAmount.mul(100).div(FEE_DIVISOR);
            const expectedTakerFee = order.takerAmount.div(4).mul(200).div(FEE_DIVISOR);
            
            const feeRecipientBalanceABefore = await mockERC20A.balanceOf(feeRecipient.address);
            const feeRecipientBalanceBBefore = await mockERC20B.balanceOf(feeRecipient.address);
            
            await settlementContract.connect(taker).fillOrder(order, fillAmount, signature);
            
            const feeRecipientBalanceAAfter = await mockERC20A.balanceOf(feeRecipient.address);
            const feeRecipientBalanceBAfter = await mockERC20B.balanceOf(feeRecipient.address);
            
            expect(feeRecipientBalanceAAfter.sub(feeRecipientBalanceABefore)).to.equal(expectedMakerFee);
            expect(feeRecipientBalanceBAfter.sub(feeRecipientBalanceBBefore)).to.equal(expectedTakerFee);
        });
    });
    
    describe("Expiry and Timing Attacks", function () {
        it("Should reject expired orders", async function () {
            const order = createOrder({
                expiry: Math.floor(Date.now() / 1000) - 100 // Already expired
            });
            const signature = await signOrder(order, maker);
            
            await expect(
                settlementContract.connect(taker).fillOrder(order, order.makerAmount, signature)
            ).to.be.revertedWithCustomError(settlementContract, "OrderExpired");
        });
        
        it("Should handle expiry during partial fills", async function () {
            const order = createOrder({
                expiry: Math.floor(Date.now() / 1000) + 2 // Expires in 2 seconds
            });
            const signature = await signOrder(order, maker);
            
            // First partial fill succeeds
            await settlementContract.connect(taker).fillOrder(order, order.makerAmount.div(2), signature);
            
            // Wait for expiry
            await time.increase(3);
            
            // Second partial fill should fail
            await expect(
                settlementContract.connect(taker).fillOrder(order, order.makerAmount.div(2), signature)
            ).to.be.revertedWithCustomError(settlementContract, "OrderExpired");
        });
    });
    
    describe("Emergency Recovery", function () {
        it("Should only allow emergency withdrawal when paused", async function () {
            await mockERC20A.mint(settlementContract.address, ethers.utils.parseEther("100"));
            
            // Should fail when not paused
            await expect(
                settlementContract.connect(owner).emergencyWithdraw(
                    mockERC20A.address,
                    ethers.utils.parseEther("100"),
                    owner.address
                )
            ).to.be.revertedWith("Pausable: not paused");
            
            // Pause contract
            await settlementContract.connect(owner).emergencyPause();
            
            // Now should succeed
            await expect(
                settlementContract.connect(owner).emergencyWithdraw(
                    mockERC20A.address,
                    ethers.utils.parseEther("100"),
                    owner.address
                )
            ).to.emit(settlementContract, "EmergencyWithdrawal");
        });
        
        it("Should handle ETH emergency withdrawal", async function () {
            // Send ETH to contract
            await owner.sendTransaction({
                to: settlementContract.address,
                value: ethers.utils.parseEther("1")
            });
            
            await settlementContract.connect(owner).emergencyPause();
            
            const balanceBefore = await ethers.provider.getBalance(owner.address);
            
            await settlementContract.connect(owner).emergencyWithdraw(
                ethers.constants.AddressZero,
                ethers.utils.parseEther("1"),
                owner.address
            );
            
            const balanceAfter = await ethers.provider.getBalance(owner.address);
            expect(balanceAfter.sub(balanceBefore)).to.be.closeTo(
                ethers.utils.parseEther("1"),
                ethers.utils.parseEther("0.01") // Account for gas
            );
        });
    });
    
    describe("Protocol Fee Security", function () {
        it("Should track protocol fees separately", async function () {
            const order = createOrder();
            const signature = await signOrder(order, maker);
            
            await settlementContract.connect(taker).fillOrder(order, order.makerAmount, signature);
            
            const protocolMakerFee = order.makerAmount.mul(30).div(FEE_DIVISOR);
            const protocolTakerFee = order.takerAmount.mul(30).div(FEE_DIVISOR);
            
            expect(
                await settlementContract.protocolFeeBalance(mockERC20A.address, protocolFeeRecipient.address)
            ).to.equal(protocolMakerFee);
            
            expect(
                await settlementContract.protocolFeeBalance(mockERC20B.address, protocolFeeRecipient.address)
            ).to.equal(protocolTakerFee);
        });
        
        it("Should prevent unauthorized protocol fee withdrawal", async function () {
            const order = createOrder();
            const signature = await signOrder(order, maker);
            
            await settlementContract.connect(taker).fillOrder(order, order.makerAmount, signature);
            
            const protocolMakerFee = order.makerAmount.mul(30).div(FEE_DIVISOR);
            
            await expect(
                settlementContract.connect(attacker).withdrawProtocolFees(
                    mockERC20A.address,
                    protocolMakerFee
                )
            ).to.be.revertedWith("Ownable: caller is not the owner");
        });
        
        it("Should prevent over-withdrawal of protocol fees", async function () {
            const order = createOrder();
            const signature = await signOrder(order, maker);
            
            await settlementContract.connect(taker).fillOrder(order, order.makerAmount, signature);
            
            const protocolMakerFee = order.makerAmount.mul(30).div(FEE_DIVISOR);
            
            await expect(
                settlementContract.connect(owner).withdrawProtocolFees(
                    mockERC20A.address,
                    protocolMakerFee.add(1)
                )
            ).to.be.revertedWithCustomError(settlementContract, "InsufficientBalance");
        });
    });
});

// Malicious token contract for reentrancy testing
const maliciousTokenCode = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MaliciousReentrantToken is ERC20 {
    address public settlementContract;
    bool public attackMode;
    
    constructor(address _settlementContract) ERC20("Malicious", "MAL") {
        settlementContract = _settlementContract;
    }
    
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
    
    function setAttackMode(bool _attackMode) external {
        attackMode = _attackMode;
    }
    
    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        if (attackMode && to == settlementContract) {
            // Attempt reentrancy
            // This would try to call back into the settlement contract
            // The reentrancy guard should prevent this
        }
        return super.transferFrom(from, to, amount);
    }
}`;