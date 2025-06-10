import { ethers } from "ethers";
import { addSettledOrder } from "../../utils/orderStore"; // <-- Add this import

// Define EIP-712 domain and types (must match frontend)
const domain = {
  name: "MetaAggregator",
  version: "1",
  chainId: 31337,
  verifyingContract: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
};

const types = {
  Order: [
    { name: "sellToken", type: "address" },
    { name: "buyToken", type: "address" },
    { name: "sellAmount", type: "uint256" },
    { name: "buyAmount", type: "uint256" },
    { name: "validTo", type: "uint32" },
    { name: "appData", type: "bytes32" },
    { name: "feeAmount", type: "uint256" },
    { name: "kind", type: "string" },
    { name: "partiallyFillable", type: "bool" },
    { name: "receiver", type: "address" },
    { name: "user", type: "address" },
    { name: "signingScheme", type: "string" },
    { name: "nonce", type: "uint256" },
    { name: "wallet", type: "address" },
  ],
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).end();
  }

  const { order, signature } = req.body;

  if (!order || !signature) {
    return res.status(400).json({ error: "Missing order or signature" });
  }

  // Verify taker signature (EIP-712)
  let recovered;
  try {
    recovered = ethers.verifyTypedData(domain, types, order, signature);
  } catch (err) {
    console.error("❌ Taker signature verification threw:", err);
    return res.status(400).json({ error: "Taker signature verification failed" });
  }

  const isValid = recovered.toLowerCase() === order.user.toLowerCase();

  if (!isValid) {
    return res.status(400).json({ error: "Invalid taker signature" });
  }

  addSettledOrder({
    order,
    signature,
    settledAt: Date.now(),
  });

  return res.status(200).json({
    status: "settled_offchain",
    message: "Order fully matched and settled (simulated).",
  });
}