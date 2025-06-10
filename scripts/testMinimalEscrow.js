require("dotenv").config({ path: ".env.local" });
const { ethers } = require("hardhat");

async function main() {
    console.log("=== MINIMAL ESCROW TEST ===");
    
    const [deployer] = await ethers.getSigners();
    console.log("Deployer address:", deployer.address);
    
    // Deploy minimal escrow
    console.log("\n=== DEPLOYING MINIMAL ESCROW ===");
    const MinimalEscrow = await ethers.getContractFactory("MinimalEscrow");
    const minimalEscrow = await MinimalEscrow.deploy(
        deployer.address,
        "0xf3f9d5e1a3a9d8f4c6acb58827729cff9f5e2266",
        ethers.parseEther("1.0"),
        "0xf494B481224cf74DC2Ac2602819d1f605AACDcc6"
    );
    
    await minimalEscrow.waitForDeployment();
    const contractAddress = await minimalEscrow.getAddress();
    console.log("✅ MinimalEscrow deployed to:", contractAddress);
    
    // Test the minimal contract
    console.log("\n=== TESTING MINIMAL ESCROW ===");
    try {
        console.log("Testing currentState()...");
        const state = await minimalEscrow.currentState();
        console.log("✅ currentState():", state.toString());
        
        console.log("Testing depositor()...");
        const depositor = await minimalEscrow.depositor();
        console.log("✅ depositor():", depositor);
        
        console.log("Testing token()...");
        const token = await minimalEscrow.token();
        console.log("✅ token():", token);
        
        console.log("Testing arbiter()...");
        const arbiter = await minimalEscrow.arbiter();
        console.log("✅ arbiter():", arbiter);
        
        console.log("Testing getAmount()...");
        const amount = await minimalEscrow.getAmount();
        console.log("✅ getAmount():", ethers.formatEther(amount), "ETH");
        
        console.log("Testing getState()...");
        const stateFromGetter = await minimalEscrow.getState();
        console.log("✅ getState():", stateFromGetter.toString());
        
        console.log("\n🎉 All minimal escrow tests passed!");
        
    } catch (error) {
        console.log("❌ Minimal escrow test failed:", error.message);
    }
}

main()
    .then(() => {
        console.log("\n✅ Minimal test complete");
        process.exit(0);
    })
    .catch((error) => {
        console.error("❌ Test failed:", error);
        process.exit(1);
    });
