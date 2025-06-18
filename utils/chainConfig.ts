// Chain configuration for Arbitrum One
export const ARBITRUM_CHAIN_CONFIG = {
  chainId: '0xa4b1', // 42161 in hex
  chainName: 'Arbitrum One',
  nativeCurrency: {
    name: 'Ethereum',
    symbol: 'ETH',
    decimals: 18,
  },
  rpcUrls: [
    'https://arb1.arbitrum.io/rpc',
    'https://arbitrum-one.publicnode.com',
  ],
  blockExplorerUrls: ['https://arbiscan.io/'],
};

// Function to add Arbitrum chain to MetaMask
export async function addArbitrumChain() {
  if (typeof window !== 'undefined' && window.ethereum) {
    try {
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [ARBITRUM_CHAIN_CONFIG],
      });
      return { success: true };
    } catch (error) {
      console.error('Failed to add Arbitrum chain:', error);
      return { success: false, error: error.message };
    }
  }
  return { success: false, error: 'MetaMask not available' };
}

// Function to switch to Arbitrum chain
export async function switchToArbitrum() {
  if (typeof window !== 'undefined' && window.ethereum) {
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: ARBITRUM_CHAIN_CONFIG.chainId }],
      });
      return { success: true };
    } catch (error) {
      // If chain is not added, try to add it
      if (error.code === 4902) {
        return await addArbitrumChain();
      }
      console.error('Failed to switch to Arbitrum chain:', error);
      return { success: false, error: error.message };
    }
  }
  return { success: false, error: 'MetaMask not available' };
}