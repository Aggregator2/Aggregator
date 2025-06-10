require("dotenv").config({ path: ".env.local" });
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
    // Get the actual arbiter address from the private key
    const arbiterWallet = new ethers.Wallet(process.env.ARBITER_PRIVATE_KEY);
    console.log("Using arbiter address:", arbiterWallet.address);

    const [deployer] = await ethers.getSigners();
    console.log("Deploying with account:", deployer.address);

    // Contract parameters
    const depositorAddress = deployer.address; // Use deployer as depositor
    const tokenAddress = "0xf3f9d5e1a3a9d8f4c6acb58827729cff9f5e2266";
    const amount = ethers.parseEther("1.0");
    const counterpartyAddress = "0x1234567890abcdef1234567890abcdef12345678";
    const arbiterAddress = arbiterWallet.address; // Use the actual arbiter address
    const tradeHash = ethers.id("unique-trade-hash");
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

    await escrow.waitForDeployment();
    const contractAddress = await escrow.getAddress();

    console.log("✅ Escrow deployed to:", contractAddress);

    // Update frontend config file
    const frontendConfigPath = path.resolve(
        __dirname,
        "../frontend/src/config/escrowAddress.js"
    );
    const fileContent = `export const ESCROW_CONTRACT_ADDRESS = "${contractAddress}";\n`;
    fs.writeFileSync(frontendConfigPath, fileContent);
    console.log("📄 Address written to:", frontendConfigPath);

    // Update the signRelease API with the new contract address
    const signReleaseApiPath = path.resolve(__dirname, "../pages/api/signRelease.ts");
    let signReleaseContent = fs.readFileSync(signReleaseApiPath, 'utf8');
    
    // Replace the verifyingContract address in the domain
    signReleaseContent = signReleaseContent.replace(
        /verifyingContract: '[^']+'/,
        `verifyingContract: '${contractAddress}'`
    );
    
    fs.writeFileSync(signReleaseApiPath, signReleaseContent);
    console.log("📄 Updated signRelease API with new contract address");

    return contractAddress;
}

main()
    .then((address) => {
        console.log(`\n🎉 Deployment complete! Contract address: ${address}`);
        process.exit(0);
    })
    .catch((error) => {
        console.error("❌ Deployment failed:", error);
        process.exit(1);
    });
