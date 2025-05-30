require("dotenv").config();
const { ethers } = require("ethers");
const EscrowABI = require("../../artifacts/contracts/Escrow.sol/Escrow.json").abi; // Adjust path as needed

// --- Contract address and API key usage ---
// Use environment variables for sensitive data
// Example: const ESCROW_ADDRESS = process.env.ESCROW_CONTRACT_ADDRESS || "0x5fbD2311576a8fceb3f763249f642fc4180a0aa3";
const ESCROW_ADDRESS = process.env.ESCROW_CONTRACT_ADDRESS || "0xYourEscrowContractAddress";

// Use Alchemy Goerli URL from .env
const PROVIDER_URL = process.env.REACT_APP_NETWORK_URL_5 || "https://eth-goerli.g.alchemy.com/v2/p7xyx7d8cj77hokq";

// Use private key from .env
const PRIVATE_KEY = process.env.PRIVATE_KEY || "92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e";

// Example: Use 0x API key from .env if needed elsewhere
const ZEROX_API_KEY = process.env.ZEROX_API_KEY || "cdc3902a-daef-4d26-bca5-23df95595774";

/**
 * Calls settleOrder on the Escrow contract.
 * @param {Object} order - The order struct (must match contract struct).
 * @param {string} signature - The EIP-712 signature.
 * @returns {Promise<ethers.providers.TransactionResponse>}
 */
async function settleOrderOnChain(order, signature) {
  // 1. Setup provider and signer
  const provider = new ethers.providers.JsonRpcProvider(PROVIDER_URL);
  const signer = new ethers.Wallet(PRIVATE_KEY, provider);

  // 2. Connect to the contract
  const escrow = new ethers.Contract(ESCROW_ADDRESS, EscrowABI, signer);

  // 3. Call the contract method
  // If your contract expects the order as a struct, make sure the JS object matches the Solidity struct
  const tx = await escrow.settleOrder(order, signature);
  await tx.wait(); // Wait for confirmation (optional)
  return tx;
}

// Example usage:
async function main() {
  const order = {
    // Fill in with the correct fields/types as defined in your Escrow.sol
    maker: "0x...",
    taker: "0x...",
    amount: "1000000000000000000", // 1 ETH in wei, for example
    price: "2000",
    nonce: 1,
    expiry: Math.floor(Date.now() / 1000) + 3600
  };
  const signature = "0x..."; // User's EIP-712 signature

  try {
    const tx = await settleOrderOnChain(order, signature);
    console.log("Transaction sent:", tx.hash);
  } catch (err) {
    console.error("Error settling order:", err);
  }
}

main();

// --- Notes ---
// - ESCROW_ADDRESS: Set ESCROW_CONTRACT_ADDRESS in your .env file.
// - PROVIDER_URL: Uses REACT_APP_NETWORK_URL_5 from your .env file.
// - PRIVATE_KEY: Uses PRIVATE_KEY from your .env file.
// - ZEROX_API_KEY: Uses ZEROX_API_KEY from your .env file (if needed).
// - Never commit real keys or secrets to source control!