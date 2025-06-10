import { ethers, Signer, TypedDataDomain, Wallet, TypedDataEncoder } from "ethers";
import { Quote } from "../types/Quote";
import { quoteTypes } from "../types/quoteTypes";

/**
 * Signs a Quote object using EIP-712 via ethers.js v6.
 * @param signer - ethers.js Wallet instance
 * @param domain - EIP-712 domain object
 * @param quote - Quote object to sign
 * @returns Promise<string> - The signature
 */
export async function signQuote(
  signer: Wallet,
  domain: TypedDataDomain,
  quote: Quote
): Promise<string> {
  // Debug log
  console.log("Signing Quote:", quote);
  console.log("quoteTypes:", quoteTypes.Quote.map(f => `${f.name}: ${f.type}`));
  for (const [key, value] of Object.entries(quote)) {
    console.log(`${key}:`, value, typeof value);
  }

  // Validate input
  if (!quote.userAddress || !ethers.isAddress(quote.userAddress)) {
    throw new Error("❌ Invalid or missing userAddress in quote");
  }
  if (!quote.quoteId) {
    throw new Error("❌ Missing quoteId in quote");
  }
  if (!quote.content) {
    throw new Error("❌ Missing content in quote");
  }
  if (!signer || !signer.address) {
    throw new Error("❌ Invalid signer");
  }

  // Hash the typed data
  const digest = TypedDataEncoder.hash(domain, quoteTypes, quote);
  // Sign the digest
  const signature = await signer.signMessage(digest);
  return signature;
}

// Returns a MetaMask EIP-712 signature for the given order using ethers.js v5
export async function signOrderWithEIP712(order: any, domain: any, types: any): Promise<string> {
  if (!window.ethereum) throw new Error("MetaMask not found");
  const provider = new ethers.providers.Web3Provider(window.ethereum);
  const signer = provider.getSigner();
  return await signer._signTypedData(domain, types, order);
}