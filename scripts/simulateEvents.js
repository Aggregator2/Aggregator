#!/usr/bin/env node

/**
 * Event Simulation Script
 * Triggers events on the deployed escrow contract to test the event listener
 */

const { ethers } = require('hardhat');
require('dotenv').config({ path: '.env.local' });

async function simulateEscrowEvents() {
    console.log('🎭 Starting Event Simulation\n');
    
    // Get contract address from environment
    const contractAddress = process.env.ESCROW_CONTRACT_ADDRESS;
    if (!contractAddress || !ethers.isAddress(contractAddress)) {
        console.error('❌ Invalid or missing ESCROW_CONTRACT_ADDRESS in .env.local');
        console.log('💡 Run: npx hardhat run scripts/deployTestEscrow.js --network localhost');
        process.exit(1);
    }
    
    console.log(`📍 Contract address: ${contractAddress}`);
    
    // Get signers
    const [deployer, depositor, counterparty, arbiter] = await ethers.getSigners();
    
    // Get contract instance
    const FixedEscrow = await ethers.getContractFactory("FixedEscrow");
    const escrow = FixedEscrow.attach(contractAddress);
    
    console.log('👥 Simulation actors:');
    console.log(`  Depositor: ${depositor.address}`);
    console.log(`  Counterparty: ${counterparty.address}`);
    console.log(`  Arbiter: ${arbiter.address}\n`);
    
    try {
        console.log('📊 Current contract state:');
        const currentState = await escrow.currentState();
        const balance = await ethers.provider.getBalance(contractAddress);
        console.log(`  State: ${currentState}`);
        console.log(`  Balance: ${ethers.formatEther(balance)} ETH\n`);
        
        console.log('🎬 Simulation 1: Additional Deposit (if state allows)');
        console.log('====================================================');
        
        if (currentState === 0n) { // AWAITING_DEPOSIT
            console.log('💰 Making deposit...');
            const escrowAsDepositor = escrow.connect(depositor);
            const depositTx = await escrowAsDepositor.deposit({ 
                value: ethers.parseEther("0.5"),
                gasLimit: 300000
            });
            await depositTx.wait();
            console.log(`✅ Deposit transaction: ${depositTx.hash}`);
            
            // Wait a moment for event processing
            await new Promise(resolve => setTimeout(resolve, 2000));
        } else {
            console.log('ℹ️ Contract not in AWAITING_DEPOSIT state, skipping deposit');
        }
        
        console.log('\n🎬 Simulation 2: Trade Confirmation');
        console.log('====================================');
        
        const newState = await escrow.currentState();
        if (newState === 1n) { // AWAITING_CONFIRMATION
            console.log('✅ Confirming trade...');
            const escrowAsCounterparty = escrow.connect(counterparty);
            const confirmTx = await escrowAsCounterparty.confirmTrade({
                gasLimit: 300000
            });
            await confirmTx.wait();
            console.log(`✅ Confirmation transaction: ${confirmTx.hash}`);
            
            // Wait for event processing
            await new Promise(resolve => setTimeout(resolve, 2000));
        } else {
            console.log('ℹ️ Contract not in AWAITING_CONFIRMATION state, skipping confirmation');
        }
        
        console.log('\n🎬 Simulation 3: Deploy New Contract for Refund Test');
        console.log('====================================================');
        
        // Deploy a fresh contract for refund testing
        const testToken = await ethers.getContractAt("SimpleTest", process.env.TEST_TOKEN_ADDRESS);
        
        const newEscrowParams = [
            depositor.address,
            await testToken.getAddress(),
            ethers.parseEther("0.1"),
            counterparty.address,
            arbiter.address,
            ethers.keccak256(ethers.toUtf8Bytes("refund-test-" + Date.now())),
            "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D"
        ];
        
        const newEscrow = await FixedEscrow.deploy(...newEscrowParams);
        await newEscrow.waitForDeployment();
        const newEscrowAddress = await newEscrow.getAddress();
        
        console.log(`📍 New escrow for refund test: ${newEscrowAddress}`);
        
        // Make deposit
        const newEscrowAsDepositor = newEscrow.connect(depositor);
        const refundDepositTx = await newEscrowAsDepositor.deposit({ 
            value: ethers.parseEther("0.1"),
            gasLimit: 300000
        });
        await refundDepositTx.wait();
        console.log(`✅ Refund test deposit: ${refundDepositTx.hash}`);
        
        // Wait a moment
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Issue refund
        console.log('💸 Issuing refund...');
        const newEscrowAsArbiter = newEscrow.connect(arbiter);
        const refundTx = await newEscrowAsArbiter.refund({
            gasLimit: 300000
        });
        await refundTx.wait();
        console.log(`✅ Refund transaction: ${refundTx.hash}`);
        
        console.log('\n🎯 Event Simulation Complete!');
        console.log('==============================');
        console.log('✅ Generated multiple events for testing');
        console.log('✅ Check the event listener logs for captured events');
        console.log(`📍 Main contract: ${contractAddress}`);
        console.log(`📍 Refund test contract: ${newEscrowAddress}`);
        
        // Final state check
        const finalState = await escrow.currentState();
        const finalBalance = await ethers.provider.getBalance(contractAddress);
        console.log(`\n📊 Final main contract state: ${finalState}`);
        console.log(`💰 Final balance: ${ethers.formatEther(finalBalance)} ETH`);
        
    } catch (error) {
        console.error('❌ Simulation failed:', error.message);
        if (error.reason) {
            console.error('📋 Reason:', error.reason);
        }
        throw error;
    }
}

if (require.main === module) {
    simulateEscrowEvents()
        .then(() => {
            console.log('\n🏁 Simulation completed successfully!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n💥 Simulation failed:', error);
            process.exit(1);
        });
}

module.exports = simulateEscrowEvents;
