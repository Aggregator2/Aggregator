import type { NextApiRequest, NextApiResponse } from "next";
import { authService } from "../../../src/services/authService";
import { ValidationError } from "../../../src/utils/errors";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { email, password } = req.body;

    if (!email || !password) {
      throw new ValidationError("Email and password are required");
    }

    const result = await authService.login({ email, password });

    res.status(200).json(result);
  } catch (error: any) {
    if (error instanceof ValidationError) {
      return res.status(400).json({ error: error.message });
    }

    if (error.message === "Invalid credentials") {
      return res.status(401).json({ error: error.message });
    }

    console.error("Login error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}
