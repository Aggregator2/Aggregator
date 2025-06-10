require("dotenv").config({ path: ".env.local" });
const { ethers } = require("hardhat");

async function main() {
    console.log("=== SIMPLE CONTRACT TEST ===");
    
    try {
        const [deployer] = await ethers.getSigners();
        console.log("✅ Connected to Hardhat network");
        console.log("Deployer address:", deployer.address);
        
        // Test the current deployed contract first
        const currentAddress = "0x0165878A594ca255338adfa4d48449f69242Eb8F";
        console.log("\n=== TESTING CURRENT CONTRACT ===");
        console.log("Contract address:", currentAddress);
        
        // Check if contract exists
        const provider = ethers.provider;
        const code = await provider.getCode(currentAddress);
        console.log("Contract bytecode exists:", code !== "0x");
        console.log("Bytecode length:", code.length);
        
        if (code === "0x") {
            console.log("❌ No contract found at address");
            return;
        }
        
        // Try to create contract instance
        const Escrow = await ethers.getContractFactory("Escrow");
        const escrow = Escrow.attach(currentAddress);
        
        console.log("\n=== BASIC FUNCTION TESTS ===");
        
        // Test with timeout wrapper
        async function testWithTimeout(testName, testFn, timeoutMs = 5000) {
            console.log(`Testing ${testName}...`);
            return Promise.race([
                testFn(),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Timeout')), timeoutMs)
                )
            ]);
        }
        
        try {
            const depositor = await testWithTimeout("depositor()", () => escrow.depositor());
            console.log("✅ depositor():", depositor);
        } catch (error) {
            console.log("❌ depositor() failed:", error.message);
        }
        
        try {
            const state = await testWithTimeout("currentState()", () => escrow.currentState());
            console.log("✅ currentState():", state.toString());
        } catch (error) {
            console.log("❌ currentState() failed:", error.message);
        }
        
        try {
            const arbiter = await testWithTimeout("arbiter()", () => escrow.arbiter());
            console.log("✅ arbiter():", arbiter);
        } catch (error) {
            console.log("❌ arbiter() failed:", error.message);
        }
        
        // If all tests fail, let's try a simple direct call
        console.log("\n=== DIRECT PROVIDER CALL TEST ===");
        try {
            const iface = new ethers.Interface([
                "function depositor() view returns (address)"
            ]);
            const calldata = iface.encodeFunctionData("depositor");
            
            const result = await Promise.race([
                provider.call({ to: currentAddress, data: calldata }),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Call timeout')), 3000)
                )
            ]);
            
            console.log("Raw call result:", result);
            
            if (result !== "0x") {
                const decoded = iface.decodeFunctionResult("depositor", result);
                console.log("✅ Direct call successful! Depositor:", decoded[0]);
            } else {
                console.log("❌ Direct call returned empty data");
            }
        } catch (error) {
            console.log("❌ Direct call failed:", error.message);
        }
        
    } catch (error) {
        console.error("❌ Test setup failed:", error.message);
    }
}

// Set a global timeout for the entire script
const timeout = setTimeout(() => {
    console.log("❌ Script timeout - force exit");
    process.exit(1);
}, 15000);

main()
    .then(() => {
        clearTimeout(timeout);
        console.log("\n✅ Test complete");
        process.exit(0);
    })
    .catch((error) => {
        clearTimeout(timeout);
        console.error("❌ Test failed:", error.message);
        process.exit(1);
    });
