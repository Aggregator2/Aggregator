// Contract Interactions
import { ethers } from 'ethers';

export const interactWithEscrow = (contractAddress: string, provider: ethers.BrowserProvider) => {
  const contract = new ethers.Contract(contractAddress, [
    'function deposit() payable',
    'function releaseWithSignature(bytes signature) public',
    'function getBalance() public view returns (uint)',
  ], provider);

  return {
    deposit: () => contract.deposit(),
    releaseWithSignature: (signature: string) => contract.releaseWithSignature(signature),
    getBalance: () => contract.getBalance(),
  };
};