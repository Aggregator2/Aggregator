/**
 * @file escrowAddress.js
 * @description Exports the deployed Escrow contract address for frontend integration.
 */

// Deployed Escrow contract address, using an environment variable with a fallback
export const ESCROW_CONTRACT_ADDRESS =
  process.env.NEXT_PUBLIC_ESCROW_CONTRACT_ADDRESS || "0x5fbD2311576a8fceb3f763249f642fc4180a0aa3";