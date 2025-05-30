import { ethers } from "ethers";

// Returns a MetaMask EIP-712 signature for the given order using ethers.js v5
export async function signOrderWithEIP712(order: any, domain: any, types: any): Promise<string> {
  if (!window.ethereum) throw new Error("MetaMask not found");
  const provider = new ethers.providers.Web3Provider(window.ethereum);
  const signer = provider.getSigner();
  return await signer._signTypedData(domain, types, order);
}