import { ethers } from "ethers";

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

  // 📦 Trace source of submission
  console.log("📦 submitting from SwapWidget:", {
    order: req.body.order,
    signature: req.body.signature,
  });

  console.log("🔥 Incoming body:", req.body);
  console.log("🟡 Received body keys:", Object.keys(req.body));

  const { order, signature } = req.body;
  if (!order || !signature) {
    console.log("🟥 Body shape incorrect:", req.body);
    return res.status(400).json({ error: "Missing order or signature" });
  }

  console.log("🔍 Domain used for verifying:", domain);
  console.log("🧾 Order received:", order);
  console.log("✍ Signature received:", signature);

  // EIP-712 signature verification (ethers v6+)
  let recovered;
  try {
    recovered = ethers.verifyTypedData(domain, types, order, signature);
  } catch (err) {
    console.error("Signature verification threw:", err);
    return res.status(400).json({ error: "Signature verification failed" });
  }

  const isValid = recovered.toLowerCase() === order.user.toLowerCase();

  console.log("🧾 Validating signature:", {
    expectedUser: order.user,
    signature,
    domain,
    types,
    isValid,
  });

  // Signature validation
  if (!isValid) {
    return res.status(400).json({ error: "Invalid signature" });
  }

  // For testing, just echo back the body or a message
  res.status(200).json({ status: "success", body: req.body });
}