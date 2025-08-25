import { getRevenueAccumulator } from "../../../src/services/revenueAccumulator";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const revenueAccumulator = getRevenueAccumulator();
    const state = revenueAccumulator.getState();

    res.status(200).json({
      success: true,
      state: {
        totalRevenueUSD: state.totalRevenueUSD,
        collectedFees: state.collectedFees,
        lastTransferTimestamp: state.lastTransferTimestamp,
        feeCount: state.collectedFees.length,
      },
    });
  } catch (error) {
    console.error("Error getting revenue state:", error);
    res.status(500).json({
      success: false,
      error: "Failed to get revenue state",
    });
  }
}