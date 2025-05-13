require("dotenv").config();
const { ethers } = require("hardhat");

// Use the address from your Hardhat node output and validate checksum
const depositorAddress = ethers.utils.getAddress("0xf3f9d5e1a3a9d8f4c6acb58827729cff9f5e2266");
const tokenAddress = "0xf3f9d5e1a3a9d8f4c6acb58827729cff9f5e2266"; // Using the same address for testing
const amount = ethers.utils.parseEther("1.0"); // 1 ETH in wei
const counterpartyAddress = "0x1234567890abcdef1234567890abcdef12345678"; // Replace with another valid address
const arbiterAddress = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd"; // Replace with another valid address
const tradeHash = ethers.utils.id("unique-trade-hash"); // Replace with your unique trade hash
const signature = "0x00"; // Dummy signature for testing
const uniswapRouterAddress = "0x1111111111111111111111111111111111111111"; // Replace with a valid Uniswap router address
const ownerAddress = depositorAddress; // Use the same as depositor for now

async function main() {
    console.log("Ethers object:", ethers);
    console.log("Ethers.utils:", ethers.utils);

    const Escrow = await ethers.getContractFactory("Escrow");
    const escrow = await Escrow.deploy(
        depositorAddress,
        tokenAddress,
        amount,
        counterpartyAddress,
        arbiterAddress,
        tradeHash,
        signature,
        uniswapRouterAddress,
        ownerAddress
    );

    await escrow.deployed();
    console.log("Escrow deployed to:", escrow.address);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});