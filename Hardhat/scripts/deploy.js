require("@nomicfoundation/hardhat-ethers");

const hre = require("hardhat");
const { ethers } = hre;

const depositorAddress = "0xYourDepositorAddressHere"; // Replace with the actual depositor address
const tokenAddress = "0xYourTokenAddressHere"; // Replace with the actual token address
const amount = ethers.utils.parseEther("1.0"); // 1 ETH in wei
const counterpartyAddress = "0xYourCounterpartyAddressHere"; // Replace with the actual counterparty address
const arbiterAddress = "0xYourArbiterAddressHere"; // Replace with the actual arbiter address
const tradeHash = ethers.utils.id("unique-trade-hash"); // Replace with your unique trade hash
const signature = "0xYourSignatureHere"; // Replace with the actual signature
const uniswapRouterAddress = "0xYourUniswapRouterAddressHere"; // Replace with the Uniswap router address
const ownerAddress = "0xYourOwnerAddressHere"; // Replace with the actual owner address

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