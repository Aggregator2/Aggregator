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

  console.log("📦 Received order submission:", {
    order: order,
    signature: signature ? `${signature.substring(0, 10)}...` : "missing",
    hasOrder: !!order,
    hasSignature: !!signature
  });

  if (!order || !signature) {
    return res.status(400).json({ error: "Missing order or signature" });
  }

  // Ensure numeric fields are strings for EIP-712
  const orderForSigning = {
    ...order,
    sellAmount: order.sellAmount.toString(),
    buyAmount: order.buyAmount.toString(),
    validTo: parseInt(order.validTo),
    feeAmount: order.feeAmount.toString(),
    nonce: parseInt(order.nonce || 0),
  };

  // Verify taker signature (EIP-712)
  let recovered;
  try {
    console.log("🔐 Verifying EIP-712 signature...");
    console.log("Domain:", domain);
    console.log("Order for signing:", orderForSigning);
    recovered = ethers.verifyTypedData(domain, types, orderForSigning, signature);
    console.log("✅ Recovered address:", recovered);
  } catch (err) {
    console.error("❌ Taker signature verification threw:", err);
    console.error("Error details:", err.message);
    console.error("Order data that failed:", orderForSigning);
    return res.status(400).json({ error: `Taker signature verification failed: ${err.message}` });
  }

  const isValid = recovered.toLowerCase() === orderForSigning.user.toLowerCase();

  if (!isValid) {
    console.error("❌ Signature mismatch!");
    console.error("Expected (order.user):", orderForSigning.user.toLowerCase());
    console.error("Recovered from signature:", recovered.toLowerCase());
    return res.status(400).json({ error: "Invalid taker signature" });
  }

  const orderId = Date.now().toString();
  
  addSettledOrder({
    order,
    signature,
    orderId,
    settledAt: Date.now(),
  });

  console.log(`✅ Order ${orderId} validated and settled (simulated)`);

  return res.status(200).json({
    status: "settled_offchain",
    message: "Order fully matched and settled (simulated).",
    orderId: orderId,
  });
}