import { NextApiRequest, NextApiResponse } from "next";
import { ethers } from "ethers";

// Minimal ABI for FixedEscrow contract
const escrowAbi = [
  "function releaseWithSignature(address to, address token, uint256 amount, bytes signature) external",
  "function release(address to, address token, uint256 amount) external",
  "function deposit(address token, uint256 amount) external payable",
  "function arbiter() external view returns (address)",
  "function balances(address token, address user) external view returns (uint256)"
];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { escrowAddress, token, amount, to, signature } = req.body;

  if (!escrowAddress || !token || !amount || !to || !signature) {
    return res.status(400).json({ error: "Missing required fields" });
  }
  try {
    // Connect to local Hardhat network
    const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
    const signer = new ethers.Wallet(process.env.ARBITER_PRIVATE_KEY as string, provider);
    const escrow = new ethers.Contract(escrowAddress, escrowAbi, signer);

    // For ETH releases, use zero address as token parameter
    const tokenAddress = token === "ETH" ? ethers.ZeroAddress : token;
    
    // Use values from the request body directly
    const tx = await escrow.releaseWithSignature(to, tokenAddress, amount, signature);
    await tx.wait();

    return res.status(200).json({ status: "released", txHash: tx.hash });
  } catch (err: any) {
    console.error("❌ Release failed", err);
    return res.status(500).json({ error: "Release failed", details: err.message });
  }
}