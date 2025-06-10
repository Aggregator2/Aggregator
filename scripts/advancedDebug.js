require("dotenv").config({ path: ".env.local" });
const { ethers } = require("hardhat");

async function main() {
    console.log("=== ADVANCED CONTRACT DEBUG ===");
    
    const contractAddress = "0x0165878A594ca255338adfa4d48449f69242Eb8F";
    const [deployer] = await ethers.getSigners();
    
    console.log("Contract address:", contractAddress);
    console.log("Deployer address:", deployer.address);
    
    // Get the provider
    const provider = ethers.provider;
    
    console.log("\n=== NETWORK CHECK ===");
    const network = await provider.getNetwork();
    console.log("Network:", network.name, "Chain ID:", network.chainId);
    
    console.log("\n=== BYTECODE ANALYSIS ===");
    const code = await provider.getCode(contractAddress);
    console.log("Contract bytecode length:", code.length);
    console.log("Bytecode exists:", code !== "0x");
    console.log("Bytecode starts with:", code.substring(0, 20) + "...");
    
    // Check if this is an implementation contract (proxy check)
    console.log("\n=== IMPLEMENTATION CHECK ===");
    try {
        // Try to call a simple view function directly with low-level call
        const iface = new ethers.Interface([
            "function currentState() view returns (uint8)"
        ]);
        
        const calldata = iface.encodeFunctionData("currentState");
        console.log("Calldata for currentState():", calldata);
        
        const result = await provider.call({
            to: contractAddress,
            data: calldata
        });
        
        console.log("Raw result:", result);
        
        if (result === "0x") {
            console.log("❌ Function returned empty data - possible issues:");
            console.log("1. Function doesn't exist");
            console.log("2. Function reverted");
            console.log("3. Contract is not properly deployed");
            console.log("4. Wrong ABI or interface");
        } else {
            console.log("✅ Function returned data, decoding...");
            const decoded = iface.decodeFunctionResult("currentState", result);
            console.log("Decoded result:", decoded);
        }
    } catch (error) {
        console.log("❌ Low-level call failed:", error.message);
    }
    
    console.log("\n=== CONTRACT COMPILATION CHECK ===");
    try {
        const Escrow = await ethers.getContractFactory("Escrow");
        console.log("✅ Contract factory created successfully");
        
        // Get the contract interface
        const contractInterface = Escrow.interface;
        console.log("Available functions:", contractInterface.fragments.filter(f => f.type === 'function').map(f => f.name));
        
        // Check if the bytecode matches
        const compiledBytecode = Escrow.bytecode;
        console.log("Compiled bytecode length:", compiledBytecode.length);
        
    } catch (error) {
        console.log("❌ Contract factory creation failed:", error.message);
    }
    
    console.log("\n=== STORAGE SLOT CHECK ===");
    try {
        // Check some storage slots directly
        for (let i = 0; i < 5; i++) {
            const storageValue = await provider.getStorage(contractAddress, i);
            console.log(`Storage slot ${i}:`, storageValue);
        }
    } catch (error) {
        console.log("❌ Storage check failed:", error.message);
    }
    
    console.log("\n=== DEPLOYMENT TRANSACTION CHECK ===");
    try {
        // Try to find the deployment transaction
        const currentBlock = await provider.getBlockNumber();
        console.log("Current block:", currentBlock);
        
        // Search recent blocks for contract creation
        for (let i = Math.max(0, currentBlock - 50); i <= currentBlock; i++) {
            const block = await provider.getBlock(i, true);
            if (block && block.transactions) {
                for (const tx of block.transactions) {
                    if (tx.to === null && tx.creates?.toLowerCase() === contractAddress.toLowerCase()) {
                        console.log("✅ Found deployment transaction:", tx.hash);
                        console.log("Block:", i);
                        console.log("Gas used:", tx.gasLimit.toString());
                        
                        const receipt = await provider.getTransactionReceipt(tx.hash);
                        console.log("Transaction status:", receipt.status === 1 ? "SUCCESS" : "FAILED");
                        console.log("Gas used in receipt:", receipt.gasUsed.toString());
                        
                        if (receipt.status === 0) {
                            console.log("❌ Deployment transaction FAILED!");
                        }
                        break;
                    }
                }
            }
        }
    } catch (error) {
        console.log("❌ Deployment transaction check failed:", error.message);
    }
}

main()
    .then(() => {
        console.log("\n=== DEBUG COMPLETE ===");
        process.exit(0);
    })
    .catch((error) => {
        console.error("❌ Debug failed:", error);
        process.exit(1);
    });
