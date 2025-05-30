export const domain = {
  name: "MetaAggregator",
  version: "1",
  chainId: 31337, // <-- Hardhat local network
  verifyingContract: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
};

export const types = {
  Order: [
    { name: "sellToken", type: "address" },
    { name: "buyToken", type: "address" },
    { name: "sellAmount", type: "uint256" },
    { name: "buyAmount", type: "uint256" },
    { name: "validTo", type: "uint256" },
    { name: "user", type: "address" },
    { name: "receiver", type: "address" },
    { name: "appData", type: "bytes" },
    { name: "feeAmount", type: "uint256" },
    { name: "partiallyFillable", type: "bool" },
    { name: "kind", type: "string" },
    { name: "signingScheme", type: "string" },
  ],
};