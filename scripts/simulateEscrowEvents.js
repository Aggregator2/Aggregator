require("dotenv").config({ path: ".env.local" });
const { ethers } = require("hardhat");
const EscrowEventListener = require("../utils/escrowEventListener");

/**
 * Event Simulation and Testing Script
 * Deploys a test escrow contract, emits events, and verifies event logging
 */

async function simulateEscrowEvents() {
    console.log("🧪 Starting Escrow Event Simulation...\n");

    let listener;
    let escrowContract;
    let deployer, user1, user2, arbiter;

    try {
        // Get signers
        [deployer, user1, user2, arbiter] = await ethers.getSigners();
        console.log("👥 Test accounts:");
        console.log(`   Deployer: ${deployer.address}`);
        console.log(`   User1 (depositor): ${user1.address}`);
        console.log(`   User2 (counterparty): ${user2.address}`);
        console.log(`   Arbiter: ${arbiter.address}\n`);

        // Deploy a test escrow contract
        console.log("🚀 Deploying test escrow contract...");
        const FixedEscrow = await ethers.getContractFactory("FixedEscrow");
        
        const testTokenAddress = "0x0000000000000000000000000000000000000001"; // Dummy token
        const testAmount = ethers.parseEther("1.0");
        const testTradeHash = ethers.id("test-trade-123");
        const uniswapRouter = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D"; // Mainnet Uniswap V2 Router

        escrowContract = await FixedEscrow.deploy(
            user1.address,      // depositor
            testTokenAddress,   // token
            testAmount,         // amount
            user2.address,      // counterparty
            arbiter.address,    // arbiter
            testTradeHash,      // tradeHash
            uniswapRouter       // uniswapRouter
        );

        await escrowContract.waitForDeployment();
        const contractAddress = await escrowContract.getAddress();
        console.log(`✅ Contract deployed at: ${contractAddress}\n`);

        // Initialize event listener with the deployed contract
        listener = new EscrowEventListener({
            contractAddress: contractAddress,
            providerUrl: "http://127.0.0.1:8545"
        });

        // Start listening to events
        console.log("🎧 Starting event listener...");
        await listener.subscribeToEvents();
        
        // Wait a moment for listener to be ready
        await new Promise(resolve => setTimeout(resolve, 1000));

        console.log("\n🎯 Simulating escrow events...\n");

        // Simulate Event 1: Deposit
        console.log("1️⃣ Simulating deposit event...");
        const depositAmount = ethers.parseEther("0.5");
        const depositTx = await escrowContract.connect(user1).deposit({
            value: depositAmount
        });
        await depositTx.wait();
        console.log(`   ✅ Deposit transaction: ${depositTx.hash}`);

        // Wait for event processing
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Simulate Event 2: Confirm Trade
        console.log("\n2️⃣ Simulating trade confirmation...");
        const confirmTx = await escrowContract.connect(user2).confirmTrade();
        await confirmTx.wait();
        console.log(`   ✅ Confirmation transaction: ${confirmTx.hash}`);

        // Wait for event processing
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Simulate Event 3: Release with Signature
        console.log("\n3️⃣ Simulating fund release with arbiter signature...");
        
        // Create release signature
        const releaseAmount = ethers.parseEther("0.1");
        const messageHash = ethers.solidityPackedKeccak256(
            ["address", "uint256", "address"],
            [user2.address, releaseAmount, contractAddress]
        );
        const ethSignedMessageHash = ethers.hashMessage(ethers.getBytes(messageHash));
        const signature = await arbiter.signMessage(ethers.getBytes(messageHash));

        // Deploy a mock ERC20 token for release testing
        console.log("   📝 Deploying mock ERC20 token...");
        const MockToken = await ethers.getContractFactory("contracts/SimpleTest.sol:SimpleTest");
        const mockToken = await MockToken.deploy();
        await mockToken.waitForDeployment();
        const mockTokenAddress = await mockToken.getAddress();
        
        // Mint tokens to the escrow contract
        const mintAmount = ethers.parseEther("10");
        await mockToken.mint(contractAddress, mintAmount);
        console.log(`   ✅ Minted ${ethers.formatEther(mintAmount)} tokens to escrow`);

        // Update escrow contract to use the mock token (for this test, we'll deploy a new one)
        const testEscrowWithToken = await FixedEscrow.deploy(
            user1.address,
            mockTokenAddress,
            testAmount,
            user2.address,
            arbiter.address,
            testTradeHash,
            uniswapRouter
        );
        await testEscrowWithToken.waitForDeployment();
        const newContractAddress = await testEscrowWithToken.getAddress();

        // Mint tokens to the new escrow
        await mockToken.mint(newContractAddress, mintAmount);

        // Setup new listener for the token escrow
        const tokenListener = new EscrowEventListener({
            contractAddress: newContractAddress,
            providerUrl: "http://127.0.0.1:8545"
        });
        await tokenListener.subscribeToEvents();

        // Deposit to complete the escrow
        await testEscrowWithToken.connect(user1).deposit({ value: depositAmount });
        await testEscrowWithToken.connect(user2).confirmTrade();

        // Create signature for the new contract
        const newMessageHash = ethers.solidityPackedKeccak256(
            ["address", "uint256", "address"],
            [user2.address, releaseAmount, newContractAddress]
        );
        const newSignature = await arbiter.signMessage(ethers.getBytes(newMessageHash));

        // Release funds
        const releaseTx = await testEscrowWithToken.releaseWithSignature(
            user2.address,
            arbiter.address,
            releaseAmount,
            newSignature
        );
        await releaseTx.wait();
        console.log(`   ✅ Release transaction: ${releaseTx.hash}`);

        // Wait for event processing
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Simulate Event 4: Refund
        console.log("\n4️⃣ Simulating refund event...");
        
        // Deploy another escrow for refund testing
        const refundEscrow = await FixedEscrow.deploy(
            user1.address,
            testTokenAddress,
            testAmount,
            user2.address,
            arbiter.address,
            ethers.id("refund-test"),
            uniswapRouter
        );
        await refundEscrow.waitForDeployment();
        const refundContractAddress = await refundEscrow.getAddress();

        // Setup listener for refund escrow
        const refundListener = new EscrowEventListener({
            contractAddress: refundContractAddress,
            providerUrl: "http://127.0.0.1:8545"
        });
        await refundListener.subscribeToEvents();

        // Deposit and then refund
        await refundEscrow.connect(user1).deposit({ value: depositAmount });
        const refundTx = await refundEscrow.connect(arbiter).refund();
        await refundTx.wait();
        console.log(`   ✅ Refund transaction: ${refundTx.hash}`);

        // Wait for final event processing
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Show event summaries
        console.log("\n📊 Event Summaries:");
        console.log("\n🔸 Original Escrow Contract:");
        const summary1 = listener.getEventSummary();
        console.log(`   Total events: ${summary1.totalEvents}`);
        console.log(`   Event types:`, summary1.eventTypes);

        console.log("\n🔸 Token Escrow Contract:");
        const summary2 = tokenListener.getEventSummary();
        console.log(`   Total events: ${summary2.totalEvents}`);
        console.log(`   Event types:`, summary2.eventTypes);

        console.log("\n🔸 Refund Escrow Contract:");
        const summary3 = refundListener.getEventSummary();
        console.log(`   Total events: ${summary3.totalEvents}`);
        console.log(`   Event types:`, summary3.eventTypes);

        // Cleanup
        listener.stop();
        tokenListener.stop();
        refundListener.stop();

        console.log("\n✅ Event simulation completed successfully!");
        console.log("📁 Check the logs directory for detailed event logs");

    } catch (error) {
        console.error("❌ Error during event simulation:", error);
        if (listener) listener.stop();
        throw error;
    }
}

// CLI usage
if (require.main === module) {
    simulateEscrowEvents()
        .then(() => {
            console.log("\n🎉 Simulation completed!");
            process.exit(0);
        })
        .catch((error) => {
            console.error("💥 Simulation failed:", error);
            process.exit(1);
        });
}

module.exports = { simulateEscrowEvents };
