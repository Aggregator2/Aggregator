const { ethers } = require("ethers");

const privateKey = "0x8c3255c5c928e57c9c8eb2fd086d2a4d590709c51ffe8cb020c766e706c25260";
const wallet = new ethers.Wallet(privateKey);

const domain = {
  name: "MetaAggregatorEscrow", // must match Solidity
  version: "1",
  chainId: 31337,
  verifyingContract: "0x5FbDB2315678afecb367f032d93F642f64180aa3"
};

const types = {
  Release: [
    { name: "escrowAddress", type: "address" }, // ✅ must match Solidity!
    { name: "to", type: "address" },
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" }
  ]
};

const value = {
  escrowAddress: "0x5FbDB2315678afecb367f032d93F642f64180aa3", // must match verifyingContract
  to: "0x1234567890AbcdEF1234567890aBcdef12345678",
  token: "0xf3f9d5e1a3a9d8f4c6acb58827729cff9f5e2266",
  amount: "1000000000000000000"
};

async function main() {
  const signature = await wallet.signTypedData(domain, types, value);
  console.log("✅ EIP-712 Signature:", signature);
}

main();