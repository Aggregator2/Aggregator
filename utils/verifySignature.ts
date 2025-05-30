import { ethers } from "ethers";

/**
 * Verifies an EIP-712 signature for an order.
 * @param order The order object.
 * @param signature The signature to verify.
 * @param expectedSigner The expected signer address (checks against recovered address).
 * @param domain The EIP-712 domain.
 * @param types The EIP-712 types.
 * @returns true if valid, false otherwise.
 */
export function verifySignature(
  order: any,
  signature: string,
  expectedSigner: string,
  domain: any,
  types: any
): boolean {
  try {
    const recovered = ethers.utils.verifyTypedData(domain, types, order, signature);
    return recovered.toLowerCase() === expectedSigner.toLowerCase();
  } catch (err) {
    return false;
  }
}

const domain = {
  name: "MetaAggregator",
  version: "1",
  chainId: 31337, // make sure it's not '11155111' or anything else
  verifyingContract: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512"
};