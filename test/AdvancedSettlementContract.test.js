const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("AdvancedSettlementContract", function () {
    let settlementContract;
    let factory;
    let owner, maker, taker, feeRecipient, protocolFeeRecipient;
    let mockERC20A, mockERC20B;
    let mockERC721, mockERC1155;
    
    const DOMAIN_NAME = "AdvancedSettlement";
    const DOMAIN_VERSION = "1.0";
    const FEE_DIVISOR = 10000;
    const MAX_FEE = 1000; // 10%
    
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
                { name: "makerAmount", type: "uint256" },
                { name: "takerAmount", type: "uint256" },
                { name: "makerTokenId", type: "uint256" },
                { name: "takerTokenId", type: "uint256" },
                { name: "makerTokenType", type: "uint8" },
                { name: "takerTokenType", type: "uint8" },
                { name: "salt", type: "uint256" },
                { name: "expiry", type: "uint256" },
                { name: "nonce", type: "uint256" },
                { name: "makerFee", type: "uint256" },
                { name: "takerFee", type: "uint256" },
                { name: "feeRecipient", type: "address" }
            ]
        };
        
        return await signer._signTypedData(domain, types, order);
    }
    
    beforeEach(async function () {
        [owner, maker, taker, feeRecipient, protocolFeeRecipient] = await ethers.getSigners();
        
        // Deploy mock tokens
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        mockERC20A = await MockERC20.deploy("Token A", "TKNA", 18);
        mockERC20B = await MockERC20.deploy("Token B", "TKNB", 18);
        
        const MockERC721 = await ethers.getContractFactory("MockERC721");
        mockERC721 = await MockERC721.deploy("NFT Collection", "NFT");
        
        const MockERC1155 = await ethers.getContractFactory("MockERC1155");
        mockERC1155 = await MockERC1155.deploy("uri://");
        
        // Deploy factory
        const Factory = await ethers.getContractFactory("SettlementFactory");
        factory = await Factory.deploy();
        
        // Deploy settlement contract via factory
        const salt = ethers.utils.randomBytes(32);
        await factory.deploySettlement(salt, DOMAIN_NAME, DOMAIN_VERSION, protocolFeeRecipient.address);
        const settlementAddress = await factory.deployments(salt);
        settlementContract = await ethers.getContractAt("AdvancedSettlementContract", settlementAddress);
        
        // Setup tokens
        await mockERC20A.mint(maker.address, ethers.utils.parseEther("10000"));
        await mockERC20B.mint(taker.address, ethers.utils.parseEther("10000"));
        await mockERC20A.connect(maker).approve(settlementContract.address, ethers.constants.MaxUint256);
        await mockERC20B.connect(taker).approve(settlementContract.address, ethers.constants.MaxUint256);
    });
    
    describe("Deployment", function () {
        it("Should deploy with correct parameters", async function () {
            expect(await settlementContract.protocolFeeRecipient()).to.equal(protocolFeeRecipient.address);
            expect(await settlementContract.protocolFeeRate()).to.equal(30); // 0.3%
            expect(await settlementContract.FEE_DIVISOR()).to.equal(FEE_DIVISOR);
            expect(await settlementContract.MAX_FEE()).to.equal(MAX_FEE);
        });
        
        it("Should calculate deterministic addresses correctly", async function () {
            const salt = ethers.utils.randomBytes(32);
            const calculatedAddress = await factory.calculateAddress(
                salt,
                DOMAIN_NAME,
                DOMAIN_VERSION,
                protocolFeeRecipient.address
            );
            
            await factory.deploySettlement(salt, DOMAIN_NAME, DOMAIN_VERSION, protocolFeeRecipient.address);
            const deployedAddress = await factory.deployments(salt);
            
            expect(deployedAddress).to.equal(calculatedAddress);
        });
    });
    
    describe("Order Filling", function () {
        it("Should fill a valid ERC20 order completely", async function () {
            const order = createOrder();
            const signature = await signOrder(order, maker);
            
            const makerBalanceBefore = await mockERC20A.balanceOf(maker.address);
            const takerBalanceBefore = await mockERC20B.balanceOf(taker.address);
            
            await expect(settlementContract.connect(taker).fillOrder(order, order.makerAmount, signature))
                .to.emit(settlementContract, "OrderFilled")
                .withArgs(
                    await settlementContract.getOrderHash(order),
                    maker.address,
                    taker.address,
                    order.makerAmount,
                    order.takerAmount,
                    order.makerFee,
                    order.takerFee
                );
            
            // Check balances after fees
            const makerFee = order.makerAmount.mul(order.makerFee).div(FEE_DIVISOR);
            const takerFee = order.takerAmount.mul(order.takerFee).div(FEE_DIVISOR);
            const protocolMakerFee = order.makerAmount.mul(30).div(FEE_DIVISOR);
            const protocolTakerFee = order.takerAmount.mul(30).div(FEE_DIVISOR);
            
            expect(await mockERC20A.balanceOf(taker.address)).to.equal(
                order.makerAmount.sub(makerFee).sub(protocolMakerFee)
            );
            expect(await mockERC20B.balanceOf(maker.address)).to.equal(
                order.takerAmount.sub(takerFee).sub(protocolTakerFee)
            );
        });
        
        it("Should handle partial fills correctly", async function () {
            const order = createOrder();
            const signature = await signOrder(order, maker);
            
            const fillAmount = order.makerAmount.div(4); // Fill 25%
            
            await expect(settlementContract.connect(taker).fillOrder(order, fillAmount, signature))
                .to.emit(settlementContract, "OrderPartiallyFilled");
            
            // Check order status
            const orderHash = await settlementContract.getOrderHash(order);
            const fillInfo = await settlementContract.orderFills(orderHash);
            expect(fillInfo.filledMakerAmount).to.equal(fillAmount);
            
            // Fill another 25%
            await expect(settlementContract.connect(taker).fillOrder(order, fillAmount, signature))
                .to.emit(settlementContract, "OrderPartiallyFilled");
            
            // Check updated fill amount
            const fillInfo2 = await settlementContract.orderFills(orderHash);
            expect(fillInfo2.filledMakerAmount).to.equal(fillAmount.mul(2));
        });
        
        it("Should reject expired orders", async function () {
            const order = createOrder({ expiry: Math.floor(Date.now() / 1000) - 100 });
            const signature = await signOrder(order, maker);
            
            await expect(
                settlementContract.connect(taker).fillOrder(order, order.makerAmount, signature)
            ).to.be.revertedWith("Order expired");
        });
        
        it("Should enforce taker restrictions", async function () {
            const order = createOrder({ taker: owner.address }); // Restrict to owner
            const signature = await signOrder(order, maker);
            
            await expect(
                settlementContract.connect(taker).fillOrder(order, order.makerAmount, signature)
            ).to.be.revertedWith("Unauthorized taker");
        });
    });
    
    describe("Order Cancellation", function () {
        it("Should cancel order with valid signature", async function () {
            const order = createOrder();
            const orderHash = await settlementContract.getOrderHash(order);
            
            // Create cancel signature
            const domain = {
                name: DOMAIN_NAME,
                version: DOMAIN_VERSION,
                chainId: await maker.getChainId(),
                verifyingContract: settlementContract.address
            };
            
            const types = {
                Cancel: [
                    { name: "orderHash", type: "bytes32" },
                    { name: "nonce", type: "uint256" }
                ]
            };
            
            const cancelData = {
                orderHash: orderHash,
                nonce: await settlementContract.nonces(maker.address)
            };
            
            const cancelSignature = await maker._signTypedData(domain, types, cancelData);
            
            await expect(settlementContract.cancelOrder(order, cancelSignature))
                .to.emit(settlementContract, "OrderCancelled")
                .withArgs(orderHash, maker.address, 1);
            
            // Verify order is cancelled
            const fillInfo = await settlementContract.orderFills(orderHash);
            expect(fillInfo.cancelled).to.be.true;
        });
        
        it("Should batch cancel orders by incrementing nonce", async function () {
            const currentNonce = await settlementContract.nonces(maker.address);
            const newNonce = currentNonce.add(10);
            
            await settlementContract.connect(maker).batchCancelOrdersByNonce(newNonce);
            
            expect(await settlementContract.nonces(maker.address)).to.equal(newNonce);
            
            // Old orders should be invalid
            const order = createOrder({ nonce: currentNonce });
            expect(await settlementContract.getOrderStatus(order)).to.equal(5); // CANCELLED
        });
    });
    
    describe("Multi-Token Support", function () {
        it("Should support ERC721 trades", async function () {
            await mockERC721.mint(maker.address, 1);
            await mockERC721.connect(maker).approve(settlementContract.address, 1);
            
            const order = createOrder({
                makerToken: mockERC721.address,
                makerAmount: 1,
                makerTokenId: 1,
                makerTokenType: 1, // ERC721
                takerAmount: ethers.utils.parseEther("100")
            });
            
            const signature = await signOrder(order, maker);
            
            await settlementContract.connect(taker).fillOrder(order, 1, signature);
            
            expect(await mockERC721.ownerOf(1)).to.equal(taker.address);
        });
        
        it("Should support ERC1155 trades", async function () {
            await mockERC1155.mint(maker.address, 1, 100, "0x");
            await mockERC1155.connect(maker).setApprovalForAll(settlementContract.address, true);
            
            const order = createOrder({
                makerToken: mockERC1155.address,
                makerAmount: 50,
                makerTokenId: 1,
                makerTokenType: 2, // ERC1155
                takerAmount: ethers.utils.parseEther("100")
            });
            
            const signature = await signOrder(order, maker);
            
            await settlementContract.connect(taker).fillOrder(order, 50, signature);
            
            expect(await mockERC1155.balanceOf(taker.address, 1)).to.equal(50);
        });
    });
    
    describe("Circuit Breaker", function () {
        it("Should pause trading in emergency", async function () {
            await settlementContract.connect(owner).emergencyPause();
            
            const order = createOrder();
            const signature = await signOrder(order, maker);
            
            await expect(
                settlementContract.connect(taker).fillOrder(order, order.makerAmount, signature)
            ).to.be.revertedWith("Pausable: paused");
        });
        
        it("Should enforce daily volume limits", async function () {
            // Set low daily volume limit
            await settlementContract.connect(owner).updateCircuitBreakerLimits(
                ethers.utils.parseEther("100"),
                ethers.utils.parseEther("1000")
            );
            
            const order = createOrder({
                makerAmount: ethers.utils.parseEther("60"),
                takerAmount: ethers.utils.parseEther("60")
            });
            const signature = await signOrder(order, maker);
            
            // This should exceed daily volume (60 + 60 = 120 > 100)
            await expect(
                settlementContract.connect(taker).fillOrder(order, order.makerAmount, signature)
            ).to.be.revertedWith("Daily volume exceeded");
        });
        
        it("Should enforce max order size", async function () {
            await settlementContract.connect(owner).updateCircuitBreakerLimits(
                ethers.utils.parseEther("10000"),
                ethers.utils.parseEther("100") // Max order size
            );
            
            const order = createOrder({
                makerAmount: ethers.utils.parseEther("200")
            });
            const signature = await signOrder(order, maker);
            
            await expect(
                settlementContract.connect(taker).fillOrder(order, order.makerAmount, signature)
            ).to.be.revertedWith("Order too large");
        });
        
        it("Should pause specific tokens", async function () {
            await settlementContract.connect(owner).setTokenPaused(
                mockERC20A.address,
                true,
                "Suspicious activity"
            );
            
            const order = createOrder();
            const signature = await signOrder(order, maker);
            
            await expect(
                settlementContract.connect(taker).fillOrder(order, order.makerAmount, signature)
            ).to.be.revertedWith("Maker token paused");
        });
    });
    
    describe("Fee Mechanism", function () {
        it("Should collect maker and taker fees correctly", async function () {
            const order = createOrder({
                makerFee: 100, // 1%
                takerFee: 200  // 2%
            });
            const signature = await signOrder(order, maker);
            
            const feeRecipientBalanceABefore = await mockERC20A.balanceOf(feeRecipient.address);
            const feeRecipientBalanceBBefore = await mockERC20B.balanceOf(feeRecipient.address);
            
            await settlementContract.connect(taker).fillOrder(order, order.makerAmount, signature);
            
            const makerFee = order.makerAmount.mul(100).div(FEE_DIVISOR);
            const takerFee = order.takerAmount.mul(200).div(FEE_DIVISOR);
            
            expect(await mockERC20A.balanceOf(feeRecipient.address)).to.equal(
                feeRecipientBalanceABefore.add(makerFee)
            );
            expect(await mockERC20B.balanceOf(feeRecipient.address)).to.equal(
                feeRecipientBalanceBBefore.add(takerFee)
            );
        });
        
        it("Should collect protocol fees", async function () {
            const order = createOrder();
            const signature = await signOrder(order, maker);
            
            await settlementContract.connect(taker).fillOrder(order, order.makerAmount, signature);
            
            const protocolMakerFee = order.makerAmount.mul(30).div(FEE_DIVISOR);
            const protocolTakerFee = order.takerAmount.mul(30).div(FEE_DIVISOR);
            
            expect(await settlementContract.protocolFeeBalance(mockERC20A.address, protocolFeeRecipient.address))
                .to.equal(protocolMakerFee);
            expect(await settlementContract.protocolFeeBalance(mockERC20B.address, protocolFeeRecipient.address))
                .to.equal(protocolTakerFee);
        });
        
        it("Should allow protocol fee withdrawal", async function () {
            const order = createOrder();
            const signature = await signOrder(order, maker);
            
            await settlementContract.connect(taker).fillOrder(order, order.makerAmount, signature);
            
            const protocolMakerFee = order.makerAmount.mul(30).div(FEE_DIVISOR);
            
            const balanceBefore = await mockERC20A.balanceOf(protocolFeeRecipient.address);
            
            await settlementContract.connect(owner).withdrawProtocolFees(
                mockERC20A.address,
                protocolMakerFee
            );
            
            expect(await mockERC20A.balanceOf(protocolFeeRecipient.address)).to.equal(
                balanceBefore.add(protocolMakerFee)
            );
        });
    });
    
    describe("Order Status", function () {
        it("Should return correct order status", async function () {
            const order = createOrder();
            
            // Check initial status
            expect(await settlementContract.getOrderStatus(order)).to.equal(1); // FILLABLE
            
            // Fill partially
            const signature = await signOrder(order, maker);
            await settlementContract.connect(taker).fillOrder(order, order.makerAmount.div(2), signature);
            
            expect(await settlementContract.getOrderStatus(order)).to.equal(3); // PARTIALLY_FILLED
            
            // Fill completely
            await settlementContract.connect(taker).fillOrder(order, order.makerAmount.div(2), signature);
            
            expect(await settlementContract.getOrderStatus(order)).to.equal(2); // FILLED
        });
        
        it("Should detect expired orders", async function () {
            const order = createOrder({ expiry: Math.floor(Date.now() / 1000) + 2 });
            
            expect(await settlementContract.getOrderStatus(order)).to.equal(1); // FILLABLE
            
            // Wait for expiry
            await time.increase(3);
            
            expect(await settlementContract.getOrderStatus(order)).to.equal(5); // EXPIRED
        });
    });
    
    describe("Emergency Functions", function () {
        it("Should allow emergency withdrawal when paused", async function () {
            // Add some tokens to contract
            await mockERC20A.mint(settlementContract.address, ethers.utils.parseEther("100"));
            
            await settlementContract.connect(owner).emergencyPause();
            
            await expect(
                settlementContract.connect(owner).emergencyWithdraw(
                    mockERC20A.address,
                    ethers.utils.parseEther("100"),
                    owner.address
                )
            ).to.emit(settlementContract, "EmergencyWithdrawal");
            
            expect(await mockERC20A.balanceOf(owner.address)).to.equal(ethers.utils.parseEther("100"));
        });
    });
    
    describe("Edge Cases", function () {
        it("Should handle zero fee orders", async function () {
            const order = createOrder({ makerFee: 0, takerFee: 0 });
            const signature = await signOrder(order, maker);
            
            await expect(settlementContract.connect(taker).fillOrder(order, order.makerAmount, signature))
                .to.not.be.reverted;
        });
        
        it("Should reject invalid signatures", async function () {
            const order = createOrder();
            const fakeSignature = await signOrder(order, taker); // Wrong signer
            
            await expect(
                settlementContract.connect(taker).fillOrder(order, order.makerAmount, fakeSignature)
            ).to.be.revertedWith("Invalid signature");
        });
        
        it("Should handle orders with same maker and taker token", async function () {
            const order = createOrder({
                takerToken: mockERC20A.address,
                makerAmount: ethers.utils.parseEther("100"),
                takerAmount: ethers.utils.parseEther("90") // Maker gets less back
            });
            const signature = await signOrder(order, maker);
            
            await mockERC20A.mint(taker.address, ethers.utils.parseEther("100"));
            await mockERC20A.connect(taker).approve(settlementContract.address, ethers.constants.MaxUint256);
            
            await expect(settlementContract.connect(taker).fillOrder(order, order.makerAmount, signature))
                .to.not.be.reverted;
        });
    });
});

// Helper contracts for testing
const mockERC20Code = `
pragma solidity ^0.8.28;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    uint8 private _decimals;
    
    constructor(string memory name, string memory symbol, uint8 decimals_) ERC20(name, symbol) {
        _decimals = decimals_;
    }
    
    function decimals() public view override returns (uint8) {
        return _decimals;
    }
    
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
    
    function burn(address from, uint256 amount) external {
        _burn(from, amount);
    }
}`;

const mockERC721Code = `
pragma solidity ^0.8.28;
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract MockERC721 is ERC721 {
    constructor(string memory name, string memory symbol) ERC721(name, symbol) {}
    
    function mint(address to, uint256 tokenId) external {
        _mint(to, tokenId);
    }
}`;

const mockERC1155Code = `
pragma solidity ^0.8.28;
import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";

contract MockERC1155 is ERC1155 {
    constructor(string memory uri) ERC1155(uri) {}
    
    function mint(address to, uint256 id, uint256 amount, bytes memory data) external {
        _mint(to, id, amount, data);
    }
}`;