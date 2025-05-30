import { ethers } from "ethers";
import EscrowABI from "../artifacts/contracts/Escrow.sol/Escrow.json" assert { type: "json" };

// Load contract address from environment variable
const ESCROW_ADDRESS = process.env.ESCROW_CONTRACT_ADDRESS;

// Function to instantiate the contract with a signer
export function getEscrowContract(signer) {
  if (!ESCROW_ADDRESS) throw new Error("ESCROW_CONTRACT_ADDRESS not set in environment");
  return new ethers.Contract(ESCROW_ADDRESS, EscrowABI.abi, signer);
}