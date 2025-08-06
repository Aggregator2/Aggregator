const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("MultiSigOrderManager", function () {
    let multiSigManager;
    let owner, signer1, signer2, signer3, nonSigner;
    let mockToken;
    
    beforeEach(async function () {
        [owner, signer1, signer2, signer3, nonSigner] = await ethers.getSigners();
        
        // Deploy mock ERC20 token
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        mockToken = await MockERC20.deploy("Mock Token", "MOCK");
        
        // Deploy MultiSigOrderManager
        const MultiSigOrderManager = await ethers.getContractFactory("MultiSigOrderManager");
        multiSigManager = await MultiSigOrderManager.deploy();
        await multiSigManager.deployed();
    });
    
    describe("Order Creation", function () {
        it("Should create a multi-sig order with EOA scheme", async function () {
            const orderData = ethers.utils.defaultAbiCoder.encode(
                ["address", "uint256", "address", "uint256"],
                [mockToken.address, ethers.utils.parseEther("100"), ethers.constants.AddressZero, ethers.utils.parseEther("90")]
            );
            
            const signers = [signer1.address, signer2.address, signer3.address];
            const requiredSigs = 2;
            const scheme = 0; // EOA
            const timeLock = 0;
            
            const tx = await multiSigManager.createMultiSigOrder(
                orderData,
                requiredSigs,
                signers,
                scheme,
                timeLock
            );
            
            const receipt = await tx.wait();
            const event = receipt.events.find(e => e.event === "OrderCreated");
            
            expect(event).to.not.be.undefined;
            expect(event.args.requiredSignatures).to.equal(requiredSigs);
        });
        
        it("Should create a time-locked order", async function () {
            const orderData = "0x1234";
            const signers = [signer1.address, signer2.address];
            const requiredSigs = 2;
            const scheme = 3; // TimeLocked
            const timeLock = 3600; // 1 hour
            
            const tx = await multiSigManager.createMultiSigOrder(
                orderData,
                requiredSigs,
                signers,
                scheme,
                timeLock
            );
            
            const receipt = await tx.wait();
            const event = receipt.events.find(e => e.event === "OrderCreated");
            const orderId = event.args.orderId;
            
            const order = await multiSigManager.orders(orderId);
            expect(order.timeLock).to.equal(timeLock);
            expect(order.signatureScheme).to.equal(scheme);
        });
        
        it("Should reject order with invalid threshold", async function () {
            const orderData = "0x1234";
            const signers = [signer1.address];
            const requiredSigs = 2; // More than signers
            
            await expect(
                multiSigManager.createMultiSigOrder(
                    orderData,
                    requiredSigs,
                    signers,
                    0,
                    0
                )
            ).to.be.revertedWith("Invalid threshold");
        });
    });
    
    describe("Order Signing", function () {
        let orderId;
        
        beforeEach(async function () {
            const orderData = "0x1234";
            const signers = [signer1.address, signer2.address, signer3.address];
            const requiredSigs = 2;
            
            const tx = await multiSigManager.createMultiSigOrder(
                orderData,
                requiredSigs,
                signers,
                0, // EOA
                0
            );
            
            const receipt = await tx.wait();
            const event = receipt.events.find(e => e.event === "OrderCreated");
            orderId = event.args.orderId;
        });
        
        it("Should allow authorized signers to sign", async function () {
            await multiSigManager.connect(signer1).signOrder(orderId);
            
            const order = await multiSigManager.orders(orderId);
            expect(order.signatureCount).to.equal(1);
            
            const hasSigned = await multiSigManager.orderSignatures(orderId, signer1.address);
            expect(hasSigned).to.be.true;
        });
        
        it("Should reject duplicate signatures", async function () {
            await multiSigManager.connect(signer1).signOrder(orderId);
            
            await expect(
                multiSigManager.connect(signer1).signOrder(orderId)
            ).to.be.revertedWith("Already signed");
        });
        
        it("Should reject unauthorized signers", async function () {
            await expect(
                multiSigManager.connect(nonSigner).signOrder(orderId)
            ).to.be.revertedWith("Not authorized signer");
        });
        
        it("Should support hardware wallet signatures", async function () {
            // Create signature
            const messageHash = ethers.utils.keccak256(
                ethers.utils.defaultAbiCoder.encode(
                    ["bytes32", "address"],
                    [orderId, multiSigManager.address]
                )
            );
            
            const signature = await signer1.signMessage(ethers.utils.arrayify(messageHash));
            
            await multiSigManager.signWithHardwareWallet(orderId, signature);
            
            const order = await multiSigManager.orders(orderId);
            expect(order.signatureCount).to.equal(1);
        });
    });
    
    describe("Order Execution", function () {
        let orderId;
        
        beforeEach(async function () {
            const orderData = "0x1234";
            const signers = [signer1.address, signer2.address, signer3.address];
            const requiredSigs = 2;
            
            const tx = await multiSigManager.createMultiSigOrder(
                orderData,
                requiredSigs,
                signers,
                0, // EOA
                0
            );
            
            const receipt = await tx.wait();
            const event = receipt.events.find(e => e.event === "OrderCreated");
            orderId = event.args.orderId;
        });
        
        it("Should execute order when threshold is reached", async function () {
            // Get required signatures
            await multiSigManager.connect(signer1).signOrder(orderId);
            await multiSigManager.connect(signer2).signOrder(orderId);
            
            // Execute order
            const tx = await multiSigManager.executeOrder(orderId);
            const receipt = await tx.wait();
            
            const event = receipt.events.find(e => e.event === "OrderExecuted");
            expect(event).to.not.be.undefined;
            expect(event.args.orderId).to.equal(orderId);
            
            const order = await multiSigManager.orders(orderId);
            expect(order.executed).to.be.true;
        });
        
        it("Should reject execution with insufficient signatures", async function () {
            await multiSigManager.connect(signer1).signOrder(orderId);
            
            await expect(
                multiSigManager.executeOrder(orderId)
            ).to.be.revertedWith("Insufficient signatures");
        });
        
        it("Should reject re-execution", async function () {
            await multiSigManager.connect(signer1).signOrder(orderId);
            await multiSigManager.connect(signer2).signOrder(orderId);
            await multiSigManager.executeOrder(orderId);
            
            await expect(
                multiSigManager.executeOrder(orderId)
            ).to.be.revertedWith("Already executed");
        });
        
        it("Should respect time lock", async function () {
            // Create time-locked order
            const orderData = "0x1234";
            const signers = [signer1.address, signer2.address];
            const timeLock = 3600; // 1 hour
            
            const tx = await multiSigManager.createMultiSigOrder(
                orderData,
                2,
                signers,
                3, // TimeLocked
                timeLock
            );
            
            const receipt = await tx.wait();
            const event = receipt.events.find(e => e.event === "OrderCreated");
            const timeLockedOrderId = event.args.orderId;
            
            // Sign order
            await multiSigManager.connect(signer1).signOrder(timeLockedOrderId);
            await multiSigManager.connect(signer2).signOrder(timeLockedOrderId);
            
            // Try to execute before time lock
            await expect(
                multiSigManager.executeOrder(timeLockedOrderId)
            ).to.be.revertedWith("Time lock not expired");
            
            // Fast forward time
            await time.increase(timeLock + 1);
            
            // Should execute now
            await expect(
                multiSigManager.executeOrder(timeLockedOrderId)
            ).to.not.be.reverted;
        });
    });
    
    describe("Threshold Signatures", function () {
        let thresholdWallet;
        let orderId;
        
        beforeEach(async function () {
            // Deploy threshold wallet factory
            const ThresholdSigFactory = await ethers.getContractFactory("ThresholdSigFactory");
            const factory = await ThresholdSigFactory.deploy();
            
            // Create threshold wallet
            const owners = [signer1.address, signer2.address, signer3.address];
            const threshold = 2;
            const salt = ethers.utils.id("test-wallet");
            
            await factory.createThresholdWallet(threshold, owners, salt);
            const walletAddress = await factory.computeAddress(threshold, owners, salt);
            
            thresholdWallet = await ethers.getContractAt("ThresholdWallet", walletAddress);
            
            // Create order with threshold scheme
            const orderData = "0x1234";
            const tx = await multiSigManager.createMultiSigOrder(
                orderData,
                1, // Only need threshold wallet's signature
                [walletAddress],
                2, // Threshold scheme
                0
            );
            
            const receipt = await tx.wait();
            const event = receipt.events.find(e => e.event === "OrderCreated");
            orderId = event.args.orderId;
        });
        
        it("Should accept threshold wallet signatures", async function () {
            // Create transaction data for signing the order
            const signData = multiSigManager.interface.encodeFunctionData("signOrder", [orderId]);
            
            // Submit transaction from threshold wallet
            await thresholdWallet.connect(signer1).submitTransaction(
                multiSigManager.address,
                0,
                signData
            );
            
            // Confirm from second signer
            await thresholdWallet.connect(signer2).confirmTransaction(0);
            
            // Execute from threshold wallet
            await thresholdWallet.connect(signer1).executeTransaction(0);
            
            // Check order was signed
            const order = await multiSigManager.orders(orderId);
            expect(order.signatureCount).to.equal(1);
        });
    });
    
    describe("EIP-1271 Signatures", function () {
        it("Should validate smart contract wallet signatures", async function () {
            // Deploy a mock EIP-1271 wallet
            const MockEIP1271 = await ethers.getContractFactory("MockEIP1271Wallet");
            const smartWallet = await MockEIP1271.deploy(signer1.address);
            
            // Create order with EIP-1271 scheme
            const orderData = "0x1234";
            const tx = await multiSigManager.createMultiSigOrder(
                orderData,
                1,
                [smartWallet.address],
                1, // EIP1271 scheme
                0
            );
            
            const receipt = await tx.wait();
            const event = receipt.events.find(e => e.event === "OrderCreated");
            const orderId = event.args.orderId;
            
            // Sign from smart wallet's owner
            const messageHash = ethers.utils.keccak256(
                ethers.utils.defaultAbiCoder.encode(
                    ["bytes32", "address"],
                    [orderId, multiSigManager.address]
                )
            );
            
            const signature = await signer1.signMessage(ethers.utils.arrayify(messageHash));
            
            // Smart wallet should validate signature
            await multiSigManager.signWithHardwareWallet(orderId, signature);
            
            const order = await multiSigManager.orders(orderId);
            expect(order.signatureCount).to.equal(1);
        });
    });
});

// Mock EIP-1271 wallet for testing
const MockEIP1271Wallet = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract MockEIP1271Wallet {
    address public owner;
    bytes4 constant internal MAGICVALUE = 0x1626ba7e;
    
    constructor(address _owner) {
        owner = _owner;
    }
    
    function isValidSignature(
        bytes32 _hash,
        bytes memory _signature
    ) public view returns (bytes4 magicValue) {
        address signer = recoverSigner(_hash, _signature);
        if (signer == owner) {
            return MAGICVALUE;
        }
        return 0xffffffff;
    }
    
    function recoverSigner(
        bytes32 _hash,
        bytes memory _signature
    ) internal pure returns (address) {
        require(_signature.length == 65, "Invalid signature length");
        
        bytes32 r;
        bytes32 s;
        uint8 v;
        
        assembly {
            r := mload(add(_signature, 32))
            s := mload(add(_signature, 64))
            v := byte(0, mload(add(_signature, 96)))
        }
        
        return ecrecover(_hash, v, r, s);
    }
}`;