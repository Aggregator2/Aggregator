import { getRevenueAccumulator } from "../../../src/services/revenueAccumulator";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Check admin authentication
  const adminKey = req.headers["x-admin-key"];
  if (!adminKey || adminKey !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({
      success: false,
      error: "Unauthorized",
    });
  }

  try {
    const revenueAccumulator = getRevenueAccumulator();
    await revenueAccumulator.forceTransfer();

    res.status(200).json({
      success: true,
      message: "Transfer initiated successfully",
    });
  } catch (error) {
    console.error("Error forcing transfer:", error);
    res.status(500).json({
      success: false,
      error: "Failed to initiate transfer",
    });
  }
}