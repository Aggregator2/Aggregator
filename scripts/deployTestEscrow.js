const { ethers } = require("hardhat");

async function main() {
    console.log("🚀 Deploying test escrow contract...");
    
    const [deployer, depositor, counterparty, arbiter] = await ethers.getSigners();
    
    console.log("📋 Deployment info:");
    console.log("  Deployer:", deployer.address);
    console.log("  Depositor:", depositor.address);
    console.log("  Counterparty:", counterparty.address);
    console.log("  Arbiter:", arbiter.address);
    
    // Deploy a test token first
    console.log("\n🪙 Deploying test token...");
    const TestToken = await ethers.getContractFactory("SimpleTest");
    const testToken = await TestToken.deploy();
    await testToken.waitForDeployment();
    const tokenAddress = await testToken.getAddress();
    console.log("  Test token deployed to:", tokenAddress);
    
    // Deploy FixedEscrow contract
    console.log("\n🔒 Deploying FixedEscrow contract...");
    const FixedEscrow = await ethers.getContractFactory("FixedEscrow");
    
    const escrowParams = [
        depositor.address,        // _depositor
        tokenAddress,            // _token
        ethers.parseEther("1.0"), // _amount (1 ETH worth)
        counterparty.address,     // _counterparty
        arbiter.address,         // _arbiter
        ethers.keccak256(ethers.toUtf8Bytes("test-trade-123")), // _tradeHash
        "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D" // Uniswap V2 Router (doesn't matter for local testing)
    ];
    
    const escrow = await FixedEscrow.deploy(...escrowParams);
    await escrow.waitForDeployment();
    const escrowAddress = await escrow.getAddress();
    
    console.log("  FixedEscrow deployed to:", escrowAddress);
    
    // Update .env.local with the new addresses
    const envContent = `# Meta Aggregator 2.0 Configuration
# Updated automatically by deployment script

# Current Keys
PRIVATE_KEY=0x4d71a20e2a4af93fa4a4ec54fe7d3b6520714942f5127bc8ed3c0e5e58866485
ARBITER_PRIVATE_KEY=0x9a37debdac26e2848d61922edbecbf5dda9180dc12d15a02c8fccacb221f4d27

# Network Settings
PROVIDER_URL=http://127.0.0.1:8545
RPC_URL=http://127.0.0.1:8545

# Contract Addresses (Auto-updated)
ESCROW_CONTRACT_ADDRESS=${escrowAddress}
TEST_TOKEN_ADDRESS=${tokenAddress}

# Test Account Addresses
DEPLOYER_ADDRESS=${deployer.address}
DEPOSITOR_ADDRESS=${depositor.address}
COUNTERPARTY_ADDRESS=${counterparty.address}
ARBITER_ADDRESS=${arbiter.address}

# Key Rotation Settings
KEY_ENCRYPTION_PASSWORD=test_password_for_demo
ROTATION_INTERVAL_DAYS=30
ROTATION_SCHEDULE="0 2 * * *"

# Monitoring Settings
MONITORING_INTERVAL=60
ALERT_EMAIL=test@example.com
`;

    require('fs').writeFileSync('.env.local', envContent);
    console.log("\n✅ Updated .env.local with deployment addresses");
    
    // Test the contract by making a deposit
    console.log("\n🧪 Testing contract functionality...");
    
    // Connect as depositor and make a deposit
    const escrowAsDepositor = escrow.connect(depositor);
    const depositTx = await escrowAsDepositor.deposit({ value: ethers.parseEther("1.0") });
    await depositTx.wait();
    console.log("  ✅ Deposit transaction:", depositTx.hash);
    
    // Check the escrow state
    const currentState = await escrow.currentState();
    console.log("  📊 Current escrow state:", currentState.toString());
    
    console.log("\n🎯 Deployment Summary:");
    console.log("==========================================");
    console.log(`📍 FixedEscrow Address: ${escrowAddress}`);
    console.log(`🪙 Test Token Address:  ${tokenAddress}`);
    console.log(`📝 Updated .env.local with new addresses`);
    console.log(`💰 Test deposit of 1 ETH completed`);
    console.log(`📊 Contract state: ${currentState}`);
    
    return {
        escrow: escrowAddress,
        token: tokenAddress,
        depositor: depositor.address,
        counterparty: counterparty.address,
        arbiter: arbiter.address
    };
}

if (require.main === module) {
    main()
        .then(() => process.exit(0))
        .catch((error) => {
            console.error("❌ Deployment failed:", error);
            process.exit(1);
        });
}

module.exports = main;
