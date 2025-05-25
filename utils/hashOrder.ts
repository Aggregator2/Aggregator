import { ethers } from "ethers";

interface Order {
  sellToken: string; // address
  buyToken: string; // address
  sellAmount: string; // uint256
  buyAmount: string; // uint256
  validTo: number; // uint256 (Unix timestamp)
  wallet: string; // address
  nonce: number; // uint256
  user: string; // address
  receiver: string; // address
  appData: string; // bytes
  feeAmount: number; // uint256
  partiallyFillable: boolean; // bool
  kind: string; // string
  signingScheme: string; // string
}

export function hashOrder(order: Order): string {
  console.log("Order for hashing:", order);
  Object.entries(order).forEach(([key, value]) => {
    if (value === undefined || value === null) {
      console.error(`Order field ${key} is missing or invalid:`, value);
    }
  });

  const encoded = ethers.utils.defaultAbiCoder.encode(
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
  return ethers.utils.keccak256(encoded);
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