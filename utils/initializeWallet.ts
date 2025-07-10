// Initialize wallet detection on app mount

import { injectMetaMaskFix, detectWalletProviders } from './walletFallback';

let initialized = false;

export function initializeWalletDetection() {
  if (initialized || typeof window === 'undefined') {
    return;
  }

  initialized = true;
  console.log('[Wallet] Initializing wallet detection...');

  // Inject fixes immediately
  injectMetaMaskFix();

  // Also check after a delay (some wallets inject late)
  setTimeout(() => {
    console.log('[Wallet] Checking for late-injected wallets...');
    injectMetaMaskFix();
    
    const providers = detectWalletProviders();
    console.log('[Wallet] Detected providers:', providers.map(p => p.name));
    
    // If no ethereum provider but we have providers, set the first one
    if (!window.ethereum && providers.length > 0) {
      console.log('[Wallet] Setting ethereum provider to:', providers[0].name);
      window.ethereum = providers[0].provider;
    }
  }, 1000);

  // Listen for provider changes
  if (window.ethereum) {
    window.ethereum.on('connect', (connectInfo: any) => {
      console.log('[Wallet] Provider connected:', connectInfo);
    });

    window.ethereum.on('disconnect', (error: any) => {
      console.log('[Wallet] Provider disconnected:', error);
    });
  }
}