import { ethers } from "ethers";

export interface ReleaseMessage {
  escrow: string;
  to: string;
  token: string;
  amount: string; // Use string to avoid JS number precision issues
}

export interface EIP712Domain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: string;
}

/**
 * Signs a release message using EIP-712.
 * @param signer ethers.Signer instance
 * @param domain EIP712Domain object
 * @param message ReleaseMessage object
 * @returns The EIP-712 signature as a string
 */
export async function signRelease(
  signer: ethers.Signer,
  domain: EIP712Domain,
  message: ReleaseMessage
): Promise<string> {
  const types = {
    Release: [
      { name: "escrow", type: "address" },
      { name: "to", type: "address" },
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
    ],
  };

  return await (signer as ethers.Signer & { _signTypedData: any })._signTypedData(
    domain,
    types,
    message
  );
}