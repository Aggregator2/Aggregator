require("dotenv").config({ path: ".env.local" });
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
    console.log("=== DEPLOYING FIXED ESCROW CONTRACT ===");
    
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
    const tradeHash = ethers.id("fixed-escrow-trade-hash");
    const uniswapRouterAddress = "0x1111111111111111111111111111111111111111";

    console.log("Deploy parameters:");
    console.log("- Depositor:", depositorAddress);
    console.log("- Token:", tokenAddress);
    console.log("- Amount:", ethers.formatEther(amount), "ETH");
    console.log("- Counterparty:", counterpartyAddress);
    console.log("- Arbiter:", arbiterAddress);
    console.log("- Trade Hash:", tradeHash);
    console.log("- Uniswap Router:", uniswapRouterAddress);

    // Deploy the contract
    const FixedEscrow = await ethers.getContractFactory("FixedEscrow");
    const escrow = await FixedEscrow.deploy(
        depositorAddress,
        tokenAddress,
        amount,
        counterpartyAddress,
        arbiterAddress,
        tradeHash,
        uniswapRouterAddress
    );

    await escrow.waitForDeployment();
    const contractAddress = await escrow.getAddress();

    console.log("✅ FixedEscrow deployed to:", contractAddress);

    // Test immediately after deployment
    console.log("\n=== IMMEDIATE FUNCTION TESTS ===");
    
    try {
        console.log("Testing currentState()...");
        const state = await escrow.currentState();
        console.log("✅ currentState():", state.toString());
    } catch (error) {
        console.log("❌ currentState() failed:", error.message);
    }

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

    try {
        console.log("Testing getAmount()...");
        const amountResult = await escrow.getAmount();
        console.log("✅ getAmount():", ethers.formatEther(amountResult), "ETH");
    } catch (error) {
        console.log("❌ getAmount() failed:", error.message);
    }

    // Update frontend config file
    const frontendConfigPath = path.resolve(
        __dirname,
        "../frontend/src/config/escrowAddress.js"
    );
    const fileContent = `export const ESCROW_CONTRACT_ADDRESS = "${contractAddress}";\n`;
    fs.writeFileSync(frontendConfigPath, fileContent);
    console.log("📄 Address written to:", frontendConfigPath);

    return contractAddress;
}

main()
    .then((address) => {
        console.log(`\n🎉 Fixed Escrow deployment complete! Contract address: ${address}`);
        process.exit(0);
    })
    .catch((error) => {
        console.error("❌ Deployment failed:", error);
        process.exit(1);
    });
