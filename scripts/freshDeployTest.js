require("dotenv").config({ path: ".env.local" });
const { ethers } = require("hardhat");

async function main() {
    console.log("=== FRESH DEPLOYMENT AND TEST ===");
    
    // Get the actual arbiter address from the private key
    const arbiterWallet = new ethers.Wallet(process.env.ARBITER_PRIVATE_KEY);
    console.log("Using arbiter address:", arbiterWallet.address);

    const [deployer] = await ethers.getSigners();
    console.log("Deploying with account:", deployer.address);

    // Contract parameters
    const depositorAddress = deployer.address;
    const tokenAddress = "0xf3f9d5e1a3a9d8f4c6acb58827729cff9f5e2266";
    const amount = ethers.parseEther("1.0");
    const counterpartyAddress = "0x1234567890abcdef1234567890abcdef12345678";
    const arbiterAddress = arbiterWallet.address;
    const tradeHash = ethers.id("unique-trade-hash-test");
    const uniswapRouterAddress = "0x1111111111111111111111111111111111111111";

    try {
        console.log("\n=== DEPLOYING CONTRACT ===");
        const Escrow = await ethers.getContractFactory("Escrow");
        const escrow = await Escrow.deploy(
            depositorAddress,
            tokenAddress,
            amount,
            counterpartyAddress,
            arbiterAddress,
            tradeHash,
            uniswapRouterAddress
        );

        console.log("Waiting for deployment...");
        await escrow.waitForDeployment();
        const contractAddress = await escrow.getAddress();
        console.log("✅ Contract deployed to:", contractAddress);

        console.log("\n=== IMMEDIATE FUNCTION TESTS ===");
        
        // Test functions immediately after deployment
        try {
            console.log("Testing depositor()...");
            const depositorResult = await escrow.depositor();
            console.log("✅ depositor():", depositorResult);
        } catch (error) {
            console.log("❌ depositor() failed:", error.message);
        }

        try {
            console.log("Testing arbiter()...");
            const arbiterResult = await escrow.arbiter();
            console.log("✅ arbiter():", arbiterResult);
        } catch (error) {
            console.log("❌ arbiter() failed:", error.message);
        }

        try {
            console.log("Testing currentState()...");
            const stateResult = await escrow.currentState();
            console.log("✅ currentState():", stateResult.toString());
        } catch (error) {
            console.log("❌ currentState() failed:", error.message);
        }

        try {
            console.log("Testing token()...");
            const tokenResult = await escrow.token();
            console.log("✅ token():", tokenResult);
        } catch (error) {
            console.log("❌ token() failed:", error.message);
        }

        try {
            console.log("Testing counterparty()...");
            const counterpartyResult = await escrow.counterparty();
            console.log("✅ counterparty():", counterpartyResult);
        } catch (error) {
            console.log("❌ counterparty() failed:", error.message);
        }

        try {
            console.log("Testing tradeHash()...");
            const tradeHashResult = await escrow.tradeHash();
            console.log("✅ tradeHash():", tradeHashResult);
        } catch (error) {
            console.log("❌ tradeHash() failed:", error.message);
        }

        console.log("\n=== TESTING WITH NEW CONTRACT INSTANCE ===");
        // Create a new contract instance using the address
        const escrowFromAddress = await ethers.getContractAt("Escrow", contractAddress);
        
        try {
            console.log("Testing depositor() with new instance...");
            const depositorResult2 = await escrowFromAddress.depositor();
            console.log("✅ depositor() (new instance):", depositorResult2);
        } catch (error) {
            console.log("❌ depositor() (new instance) failed:", error.message);
        }

        return contractAddress;

    } catch (error) {
        console.error("❌ Deployment or testing failed:", error);
        throw error;
    }
}

main()
    .then((address) => {
        console.log(`\n✅ Fresh deployment test complete! Contract: ${address}`);
        process.exit(0);
    })
    .catch((error) => {
        console.error("❌ Test failed:", error);
        process.exit(1);
    });
