const { ethers } = require("hardhat");

async function main() {
    console.log("=== CONTRACT DEBUG SCRIPT ===");
    
    const contractAddress = "0x0165878A594ca255338adfa4d48449f69242Eb8F";
    const [deployer] = await ethers.getSigners();
    
    console.log("Contract address:", contractAddress);
    console.log("Deployer address:", deployer.address);
    
    // Get contract factory and attach to deployed address
    const Escrow = await ethers.getContractFactory("Escrow");
    const escrow = Escrow.attach(contractAddress);
    
    console.log("\n=== TESTING BASIC PROPERTIES ===");
    
    try {
        // Test immutable variables (these should work if contract deployed correctly)
        console.log("Testing depositor()...");
        const depositor = await escrow.depositor();
        console.log("✅ Depositor:", depositor);
    } catch (e) {
        console.log("❌ depositor() failed:", e.message);
    }
    
    try {
        console.log("Testing token()...");
        const token = await escrow.token();
        console.log("✅ Token:", token);
    } catch (e) {
        console.log("❌ token() failed:", e.message);
    }
    
    try {
        console.log("Testing arbiter()...");
        const arbiter = await escrow.arbiter();
        console.log("✅ Arbiter:", arbiter);
    } catch (e) {
        console.log("❌ arbiter() failed:", e.message);
    }
    
    try {
        console.log("Testing currentState()...");
        const state = await escrow.currentState();
        console.log("✅ Current State:", state.toString());
    } catch (e) {
        console.log("❌ currentState() failed:", e.message);
    }
    
    console.log("\n=== CONTRACT ANALYSIS ===");
    
    // Check if the issue might be with the contract interface
    const contractInterface = escrow.interface;
    console.log("Available functions in interface:");
    const functions = contractInterface.fragments.filter(f => f.type === 'function');
    functions.forEach(func => {
        console.log("- " + func.name + "(" + func.inputs.map(i => i.type).join(", ") + ")");
    });
    
    // Try calling with static call to see what exactly happens
    console.log("\n=== LOW-LEVEL STATIC CALL TEST ===");
    const provider = escrow.provider;
    
    try {
        // currentState() function selector is first 4 bytes of keccak256("currentState()")
        const currentStateSelector = "0x2c1c2da6";
        console.log("Calling with selector:", currentStateSelector);
        
        const result = await provider.call({
            to: contractAddress,
            data: currentStateSelector
        });
        
        console.log("Raw result:", result);
        
        if (result === "0x") {
            console.log("❌ Contract returned empty data - function might not exist or contract is not deployed properly");
        } else {
            // Try to decode as uint8 (enum State)
            const decoded = ethers.AbiCoder.defaultAbiCoder().decode(['uint8'], result);
            console.log("✅ Decoded state:", decoded[0].toString());
        }
    } catch (e) {
        console.log("❌ Low-level call failed:", e.message);
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("❌ Debug script failed:", error);
        process.exit(1);
    });
