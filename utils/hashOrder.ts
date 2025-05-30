import { AbiCoder, ethers } from "ethers"; // for ethers v6

export interface Order {
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  buyAmount: string;
  validTo: number;
  wallet: string;
  nonce: number;
  user: string;
  receiver: string;
  appData: string;
  feeAmount: number;
  partiallyFillable: boolean;
  kind: string;
  signingScheme: string;
}

export function hashOrder(order: Order): string {
  console.log("Order for hashing:", order);

  // Use ethers v6 ABI coder
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    [
      "address", // sellToken
      "address", // buyToken
      "uint256", // sellAmount
      "uint256", // buyAmount
      "uint256", // validTo
      "address", // user
      "address", // receiver
      "bytes",   // appData
      "uint256", // feeAmount
      "bool",    // partiallyFillable
      "string",  // kind
      "string",  // signingScheme
    ],
    [
      order.sellToken,
      order.buyToken,
      order.sellAmount,
      order.buyAmount,
      order.validTo,
      order.user,
      order.receiver,
      order.appData,
      order.feeAmount,
      order.partiallyFillable,
      order.kind,
      order.signingScheme,
    ]
  );
  return ethers.keccak256(encoded);
}

export function validateAndHashOrder(order: Order): string | void {
  if (
    !order.sellToken ||
    !order.buyToken ||
    !order.sellAmount ||
    !order.buyAmount ||
    !order.validTo ||
    !order.user ||
    !order.receiver ||
    !order.appData ||
    !order.kind ||
    !order.signingScheme
  ) {
    console.error("Invalid order: Missing required fields", order);
    throw new Error("Invalid order: Missing required fields");
  }

  const orderHash = hashOrder(order);
  return orderHash;
}

const sellToken = "0xTokenAddress"; // from user dropdown
const buyToken = "0xTokenAddress"; // from user dropdown
const baseUnits = "1000000000000000000"; // from user input, parsed to base units
const quote = { buyAmount: "500000000000000000" }; // from quote API response
const walletAddress = "0xWalletAddress"; // connected wallet address

const order = {
  sellToken,                                 // from user dropdown
  buyToken,                                  // from user dropdown
  sellAmount: baseUnits,                     // from user input, parsed to base units
  buyAmount: quote?.buyAmount || "0",        // from quote API response
  validTo: Math.floor(Date.now() / 1000) + 600, // 10 minutes from now
  user: walletAddress,                       // connected wallet address
  receiver: walletAddress,                   // same as user for MVP
  appData: "0x",                             // empty bytes for MVP
  feeAmount: 0,                              // 0 for MVP, or from quote if you have it
  partiallyFillable: false,                  // false for MVP
  kind: "sell",                              // "sell" for swap UI
  signingScheme: "eip712",                   // "eip712" for MetaMask
  wallet: walletAddress,                     // required by your interface, use walletAddress
  nonce: 0,                                  // 0 for MVP, or fetch from backend if needed
};