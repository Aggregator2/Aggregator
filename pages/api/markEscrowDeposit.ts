import type { NextApiRequest, NextApiResponse } from "next";

// In-memory store for escrowed orders (replace with a database in production)
const escrowedOrders: Record<string, {
  status: string;
  txHash: string;
  depositedAt: number;
}> = {};

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { orderId, txHash } = JSON.parse(req.body);

    if (!orderId || !txHash) {
      return res.status(400).json({ error: "Missing orderId or txHash" });
    }

    escrowedOrders[orderId] = {
      status: "AWAITING_CONFIRMATION",
      txHash,
      depositedAt: Date.now(),
    };

    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
}