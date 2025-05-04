const hre = require("hardhat");

async function main() {
    const { ethers } = hre;
    const [deployer] = await ethers.getSigners();

    console.log("Deploying contracts with the account:", deployer.address);

    const Escrow = await ethers.getContractFactory("Escrow");

    // Replace these with actual values
    const depositor = deployer.address; // Use the deployer's address for testing
    const token = "0xYourTokenAddress"; // Replace with a deployed ERC20 token address
    const amount = ethers.utils.parseUnits("100", 18); // 100 tokens with 18 decimals
    const counterparty = "0xCounterpartyAddress"; // Replace with a valid address
    const arbiter = "0xArbiterAddress"; // Replace with a valid address
    const tradeHash = ethers.utils.id("Trade123"); // Unique trade identifier
    const signature = "0x"; // Empty signature
    const uniswapRouter = "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f"; // Uniswap V2 router address

    const escrow = await Escrow.deploy(
        depositor,
        token,
        amount,
        counterparty,
        arbiter,
        tradeHash,
        signature,
        uniswapRouter
    );

    await escrow.deployed();

    console.log("Escrow deployed to:", escrow.address);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});