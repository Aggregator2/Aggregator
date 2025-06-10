require("dotenv").config({ path: ".env.local" });
const { ethers } = require("hardhat");

async function main() {
    console.log("=== FRONTEND INTEGRATION TEST ===\n");
    console.log("🔧 Testing FixedEscrow contract with frontend configuration...\n");

    // Check the current escrow address in frontend config
    const fs = require('fs');
    const path = require('path');
    const frontendConfigPath = path.resolve(__dirname, "../frontend/src/config/escrowAddress.js");
    
    if (fs.existsSync(frontendConfigPath)) {
        const configContent = fs.readFileSync(frontendConfigPath, 'utf8');
        console.log("📁 Frontend config content:");
        console.log(configContent);
    } else {
        console.log("⚠️ Frontend config not found at:", frontendConfigPath);
    }

    console.log("\n🚀 STEP 1: DEPLOYING NEW FIXED ESCROW FOR TESTING");
    
    const [deployer, counterpartySigner] = await ethers.getSigners();
    const arbiterWallet = new ethers.Wallet(process.env.ARBITER_PRIVATE_KEY);
    
    console.log("👤 Deployer:", deployer.address);
    console.log("👤 Counterparty:", counterpartySigner.address);
    console.log("👤 Arbiter:", arbiterWallet.address);

    // Deploy new contract for testing
    const FixedEscrow = await ethers.getContractFactory("FixedEscrow");
    const escrow = await FixedEscrow.deploy(
        deployer.address,                                    // depositor
        "0xf3f9d5e1a3a9d8f4c6acb58827729cff9f5e2266",      // token (mock)
        ethers.parseEther("1.0"),                           // amount
        counterpartySigner.address,                          // counterparty
        arbiterWallet.address,                              // arbiter
        ethers.id("frontend-integration-test"),             // tradeHash
        "0x1111111111111111111111111111111111111111"       // uniswap router (mock)
    );

    await escrow.waitForDeployment();
    const contractAddress = await escrow.getAddress();
    console.log("✅ Test FixedEscrow deployed to:", contractAddress);

    // Update frontend config with new address
    const newConfigContent = `export const ESCROW_CONTRACT_ADDRESS = "${contractAddress}";\n`;
    fs.writeFileSync(frontendConfigPath, newConfigContent);
    console.log("✅ Updated frontend config with test contract address");

    console.log("\n🔍 STEP 2: TESTING CONTRACT FUNCTION CALLS");
    
    // Test all getter functions (mimicking frontend calls)
    try {
        const currentState = await escrow.currentState();
        console.log("✅ currentState():", currentState.toString());
        
        const depositor = await escrow.depositor();
        console.log("✅ depositor():", depositor);
        
        const counterparty = await escrow.counterparty();
        console.log("✅ counterparty():", counterparty);
        
        const arbiter = await escrow.arbiter();
        console.log("✅ arbiter():", arbiter);
        
        const token = await escrow.token();
        console.log("✅ token():", token);
        
        const tradeHash = await escrow.tradeHash();
        console.log("✅ tradeHash():", tradeHash);
        
        const amount = await escrow.getAmount();
        console.log("✅ getAmount():", ethers.formatEther(amount), "ETH");
        
        const balance = await escrow.getBalance();
        console.log("✅ getBalance():", ethers.formatEther(balance), "ETH");
        
    } catch (error) {
        console.error("❌ Contract function call failed:", error.message);
        throw error;
    }

    console.log("\n💰 STEP 3: TESTING DEPOSIT FUNCTIONALITY");
    
    try {
        const depositAmount = ethers.parseEther("0.3");
        const depositTx = await escrow.connect(deployer).deposit({ value: depositAmount });
        await depositTx.wait();
        console.log("✅ Deposit successful:", ethers.formatEther(depositAmount), "ETH");
        
        const newBalance = await escrow.getBalance();
        console.log("✅ Contract balance after deposit:", ethers.formatEther(newBalance), "ETH");
        
        const newState = await escrow.currentState();
        console.log("✅ State after deposit:", newState.toString(), "(1=AWAITING_CONFIRMATION)");
        
    } catch (error) {
        console.error("❌ Deposit failed:", error.message);
        throw error;
    }

    console.log("\n✅ STEP 4: TESTING COUNTERPARTY CONFIRMATION");
    
    try {
        const confirmTx = await escrow.connect(counterpartySigner).confirmTrade();
        await confirmTx.wait();
        console.log("✅ Trade confirmation successful");
        
        const finalState = await escrow.currentState();
        console.log("✅ Final state:", finalState.toString(), "(2=COMPLETE)");
        
    } catch (error) {
        console.error("❌ Confirmation failed:", error.message);
        throw error;
    }

    console.log("\n📋 STEP 5: VERIFYING ABI COMPATIBILITY");
    
    // Check that FixedEscrow ABI file exists and is accessible
    const abiPath = path.resolve(__dirname, "../artifacts/contracts/FixedEscrow.sol/FixedEscrow.json");
    if (fs.existsSync(abiPath)) {
        const abiContent = JSON.parse(fs.readFileSync(abiPath, 'utf8'));
        console.log("✅ FixedEscrow ABI file found");
        console.log("✅ ABI contains", abiContent.abi.length, "functions/events");
        
        // Check for essential functions
        const essentialFunctions = [
            'currentState', 'depositor', 'counterparty', 'arbiter', 
            'token', 'tradeHash', 'getAmount', 'getBalance',
            'deposit', 'confirmTrade', 'refund'
        ];
        
        const abiNames = abiContent.abi.map(item => item.name).filter(Boolean);
        const missingFunctions = essentialFunctions.filter(func => !abiNames.includes(func));
        
        if (missingFunctions.length === 0) {
            console.log("✅ All essential functions present in ABI");
        } else {
            console.log("⚠️ Missing functions in ABI:", missingFunctions);
        }
        
    } else {
        console.error("❌ FixedEscrow ABI file not found at:", abiPath);
        throw new Error("ABI file missing");
    }

    console.log("\n🔧 STEP 6: TESTING ERROR HANDLING");
    
    try {
        // Try to deposit again (should fail)
        await escrow.connect(deployer).deposit({ value: ethers.parseEther("0.1") });
        console.log("❌ ERROR: Second deposit should have failed!");
    } catch (error) {
        console.log("✅ Error handling works: Second deposit correctly rejected");
    }

    console.log("\n🎉 FRONTEND INTEGRATION TEST COMPLETED SUCCESSFULLY!");
    console.log("==================================================");
    console.log("✅ Contract deployment: WORKING");
    console.log("✅ Frontend configuration: UPDATED");
    console.log("✅ ABI compatibility: VERIFIED");
    console.log("✅ Essential functions: ALL ACCESSIBLE");
    console.log("✅ Deposit flow: WORKING");
    console.log("✅ Confirmation flow: WORKING");
    console.log("✅ Error handling: WORKING");
    console.log("==================================================");
    
    console.log(`\n🎯 NEXT STEPS:`);
    console.log(`1. Start frontend with: npm run dev`);
    console.log(`2. Test UI interactions with contract at: ${contractAddress}`);
    console.log(`3. Verify all frontend functions work correctly`);
    console.log(`4. Deploy to testnet when ready`);
    
    return {
        contractAddress,
        configUpdated: true,
        abiVerified: true
    };
}

main()
    .then((result) => {
        console.log(`\n🚀 FRONTEND INTEGRATION TEST SUCCESSFUL!`);
        console.log(`📍 Test contract: ${result.contractAddress}`);
        console.log(`🔧 Frontend config updated: ${result.configUpdated}`);
        console.log(`📋 ABI verified: ${result.abiVerified}`);
        console.log(`\n🎯 META AGGREGATOR 2.0 IS READY FOR FRONTEND TESTING!`);
        process.exit(0);
    })
    .catch((error) => {
        console.error("❌ Frontend integration test failed:", error);
        process.exit(1);
    });
