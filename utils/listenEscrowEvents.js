import { ethers } from "ethers";
import dotenv from "dotenv";
import EscrowABI from "../artifacts/contracts/Escrow.sol/Escrow.json" assert { type: "json" };

dotenv.config();

const ESCROW_ADDRESS = process.env.ESCROW_CONTRACT_ADDRESS;
const PROVIDER_URL = process.env.PROVIDER_URL || "https://eth-goerli.g.alchemy.com/v2/your-api-key";

if (!ESCROW_ADDRESS) {
  throw new Error("ESCROW_CONTRACT_ADDRESS not set in .env");
}

const provider = new ethers.JsonRpcProvider(PROVIDER_URL);
const escrow = new ethers.Contract(ESCROW_ADDRESS, EscrowABI.abi, provider);

// Listen for all events
escrow.on("*", (event) => {
  console.log("Escrow Event:", event);
});

// Listen for specific events (example: Deposited, Confirmed, Refunded, TradeExecuted)
escrow.on("Deposited", (depositor, amount, event) => {
  console.log(`Deposited: depositor=${depositor}, amount=${amount.toString()}`);
});
escrow.on("Confirmed", (sender, event) => {
  console.log(`Confirmed: sender=${sender}`);
});
escrow.on("Refunded", (depositor, amount, event) => {
  console.log(`Refunded: depositor=${depositor}, amount=${amount.toString()}`);
});
escrow.on("TradeExecuted", (sender, amountOutMin, path, deadline, event) => {
  console.log(`TradeExecuted: sender=${sender}, amountOutMin=${amountOutMin.toString()}, path=${path}, deadline=${deadline}`);
});

// Keep the process alive
console.log("Listening for Escrow contract events...");