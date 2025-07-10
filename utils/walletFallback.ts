// Fallback wallet detection for various providers

export interface WalletProvider {
  name: string;
  detected: boolean;
  provider?: any;
}

// Check for various wallet providers
export function detectWalletProviders(): WalletProvider[] {
  if (typeof window === 'undefined') {
    return [];
  }

  const providers: WalletProvider[] = [];

  // MetaMask
  if (window.ethereum?.isMetaMask) {
    providers.push({
      name: 'MetaMask',
      detected: true,
      provider: window.ethereum
    });
  }

  // Coinbase Wallet
  if (window.ethereum?.isCoinbaseWallet) {
    providers.push({
      name: 'Coinbase Wallet',
      detected: true,
      provider: window.ethereum
    });
  }

  // Trust Wallet
  if (window.ethereum?.isTrust) {
    providers.push({
      name: 'Trust Wallet',
      detected: true,
      provider: window.ethereum
    });
  }

  // Generic Ethereum provider
  if (window.ethereum && !providers.length) {
    providers.push({
      name: 'Unknown Ethereum Wallet',
      detected: true,
      provider: window.ethereum
    });
  }

  // Web3 legacy
  if ((window as any).web3?.currentProvider) {
    providers.push({
      name: 'Legacy Web3 Provider',
      detected: true,
      provider: (window as any).web3.currentProvider
    });
  }

  return providers;
}

// Get the best available provider
export function getBestProvider(): any {
  const providers = detectWalletProviders();
  
  // Prefer MetaMask
  const metamask = providers.find(p => p.name === 'MetaMask');
  if (metamask) return metamask.provider;
  
  // Then any ethereum provider
  const ethereum = providers.find(p => p.provider && p.name.includes('Ethereum'));
  if (ethereum) return ethereum.provider;
  
  // Finally any provider
  return providers[0]?.provider || null;
}

// Inject MetaMask detection fix
export function injectMetaMaskFix() {
  if (typeof window === 'undefined') return;
  
  // Sometimes MetaMask takes time to inject, this helps detect it
  if (!window.ethereum && (window as any).web3?.currentProvider) {
    console.log('[Wallet] Injecting ethereum provider from web3');
    window.ethereum = (window as any).web3.currentProvider;
  }
  
  // Add isMetaMask property if it's missing but provider looks like MetaMask
  if (window.ethereum && !window.ethereum.isMetaMask) {
    const provider = window.ethereum as any;
    if (provider._metamask || provider.constructor?.name === 'MetaMaskInpageProvider') {
      console.log('[Wallet] Adding missing isMetaMask property');
      provider.isMetaMask = true;
    }
  }
}