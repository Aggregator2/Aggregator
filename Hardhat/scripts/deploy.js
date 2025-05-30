require("dotenv").config();
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

// Ethers v6 utils are on the main ethers object
const { getAddress, parseEther, id } = ethers;

const depositorAddress = getAddress("0xf3f9d5e1a3a9d8f4c6acb58827729cff9f5e2266");
const tokenAddress = getAddress("0xf3f9d5e1a3a9d8f4c6acb58827729cff9f5e2266");
const amount = parseEther("1.0");
const counterpartyAddress = getAddress("0x1234567890abcdef1234567890abcdef12345678");
const arbiterAddress = getAddress("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd");
const tradeHash = id("unique-trade-hash");
const uniswapRouterAddress = getAddress("0x1111111111111111111111111111111111111111");

async function main() {
  const Escrow = await ethers.getContractFactory("Escrow");

  // Deploy and await directly (no .deployed() in v6)
  const escrow = await Escrow.deploy(
    depositorAddress,
    tokenAddress,
    amount,
    counterpartyAddress,
    arbiterAddress,
    tradeHash,
    uniswapRouterAddress
  );

  console.log("✅ Escrow deployed to:", escrow.target); // ethers v6: use .target

  // Write to frontend config file
  const frontendConfigPath = path.resolve(
    __dirname,
    "../../frontend/src/config/escrowAddress.js"
  );
  const fileContent = `export const ESCROW_CONTRACT_ADDRESS = "${escrow.target}";\n`;
  fs.writeFileSync(frontendConfigPath, fileContent);
  console.log(`📄 Address written to: ${frontendConfigPath}`);
}

main().catch((error) => {
  console.error("❌ Deployment failed:", error);
  process.exit(1);
});