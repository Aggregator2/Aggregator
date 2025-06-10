require("dotenv").config({ path: ".env.local" });
const { ethers } = require("hardhat");

async function main() {
    console.log("=== SIMPLE CONTRACT TEST ===");
    
    const [deployer] = await ethers.getSigners();
    console.log("Deployer address:", deployer.address);
    
    // Deploy simple test contract
    console.log("\n=== DEPLOYING SIMPLE TEST CONTRACT ===");
    const SimpleTest = await ethers.getContractFactory("SimpleTest");
    const simpleTest = await SimpleTest.deploy(42);
    
    await simpleTest.waitForDeployment();
    const contractAddress = await simpleTest.getAddress();
    console.log("✅ SimpleTest deployed to:", contractAddress);
    
    // Test the simple contract
    console.log("\n=== TESTING SIMPLE CONTRACT ===");
    try {
        const value = await simpleTest.getValue();
        console.log("✅ getValue():", value.toString());
        
        const owner = await simpleTest.getOwner();
        console.log("✅ getOwner():", owner);
        
        // Test setting a new value
        const tx = await simpleTest.setValue(100);
        await tx.wait();
        console.log("✅ setValue() transaction successful");
        
        const newValue = await simpleTest.getValue();
        console.log("✅ New value:", newValue.toString());
        
    } catch (error) {
        console.log("❌ Simple contract test failed:", error.message);
        return;
    }
    
    // Now test the Escrow contract
    console.log("\n=== TESTING ESCROW CONTRACT ===");
    const escrowAddress = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
    
    try {
        const Escrow = await ethers.getContractFactory("Escrow");
        const escrow = Escrow.attach(escrowAddress);
        
        console.log("Testing currentState()...");
        const state = await escrow.currentState();
        console.log("✅ currentState():", state.toString());
        
        console.log("Testing depositor()...");
        const depositor = await escrow.depositor();
        console.log("✅ depositor():", depositor);
        
    } catch (error) {
        console.log("❌ Escrow contract test failed:", error.message);
        console.log("This suggests the issue is specific to the Escrow contract");
    }
}

main()
    .then(() => {
        console.log("\n✅ Test complete");
        process.exit(0);
    })
    .catch((error) => {
        console.error("❌ Test failed:", error);
        process.exit(1);
    });
