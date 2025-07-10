import React, { useState } from 'react';
import { connectWallet, attemptReconnection, getSavedWalletConnection, getConnectedAccounts, isMetaMaskInstalled } from '../utils/walletConnection';

export function DebugWalletConnection() {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<string[]>([]);

  const runWalletTests = async () => {
    setLoading(true);
    setResults([]);
    const logs: string[] = [];

    try {
      // Test 1: Check window.ethereum
      logs.push('🔍 Test 1: Checking window.ethereum...');
      if (typeof window !== 'undefined') {
        if (window.ethereum) {
          logs.push('✅ window.ethereum exists');
          logs.push(`   isMetaMask: ${window.ethereum.isMetaMask || false}`);
        } else {
          logs.push('❌ window.ethereum is undefined');
        }
      } else {
        logs.push('❌ window is undefined (SSR?)');
      }

      // Test 2: Check MetaMask installation
      logs.push('🔍 Test 2: Checking MetaMask installation...');
      const isInstalled = isMetaMaskInstalled();
      logs.push(`${isInstalled ? '✅' : '❌'} MetaMask ${isInstalled ? 'is' : 'is not'} installed`);

      // Test 3: Check saved connection
      logs.push('🔍 Test 3: Checking saved connection...');
      const savedConnection = getSavedWalletConnection();
      if (savedConnection.connected) {
        logs.push(`✅ Found saved connection: ${savedConnection.address}`);
        logs.push(`   Chain ID: ${savedConnection.chainId || 'unknown'}`);
      } else {
        logs.push('ℹ️ No saved connection found');
      }

      // Test 4: Get current accounts
      logs.push('🔍 Test 4: Getting current accounts...');
      try {
        const accounts = await getConnectedAccounts();
        if (accounts.length > 0) {
          logs.push(`✅ Found ${accounts.length} connected account(s):`);
          accounts.forEach((acc, i) => logs.push(`   ${i + 1}. ${acc}`));
        } else {
          logs.push('ℹ️ No accounts currently connected');
        }
      } catch (error: any) {
        logs.push(`❌ Error getting accounts: ${error.message}`);
      }

      // Test 5: Try reconnection
      logs.push('🔍 Test 5: Attempting auto-reconnection...');
      try {
        const reconnectResult = await attemptReconnection();
        if (reconnectResult.success) {
          logs.push(`✅ Reconnected successfully: ${reconnectResult.address}`);
        } else {
          logs.push(`ℹ️ Reconnection failed: ${reconnectResult.error}`);
        }
      } catch (error: any) {
        logs.push(`❌ Reconnection error: ${error.message}`);
      }

      // Test 6: Try manual connection
      logs.push('🔍 Test 6: Testing manual connection...');
      try {
        const connectResult = await connectWallet({ timeout: 10000 });
        if (connectResult.success) {
          logs.push(`✅ Connected successfully: ${connectResult.address}`);
        } else {
          logs.push(`❌ Connection failed: ${connectResult.error}`);
          logs.push(`   Error code: ${connectResult.errorCode}`);
        }
      } catch (error: any) {
        logs.push(`❌ Connection error: ${error.message}`);
      }

      // Test 7: Check chain ID
      if (window.ethereum) {
        logs.push('🔍 Test 7: Checking chain ID...');
        try {
          const chainId = await window.ethereum.request({ method: 'eth_chainId' });
          logs.push(`✅ Current chain ID: ${chainId} (${parseInt(chainId, 16)})`);
        } catch (error: any) {
          logs.push(`❌ Error getting chain ID: ${error.message}`);
        }
      }

    } catch (error: any) {
      logs.push(`❌ General Error: ${error.message}`);
    }

    setResults(logs);
    setLoading(false);
  };

  return (
    <div style={{
      position: 'fixed',
      top: '20px',
      right: '20px',
      background: 'rgba(0, 0, 0, 0.9)',
      color: 'white',
      padding: '15px',
      borderRadius: '8px',
      maxWidth: '500px',
      maxHeight: '400px',
      overflow: 'auto',
      fontSize: '12px',
      fontFamily: 'monospace',
      zIndex: 9999
    }}>
      <h3 style={{ margin: '0 0 10px 0', fontSize: '14px' }}>Wallet Connection Debug</h3>
      <button
        onClick={runWalletTests}
        disabled={loading}
        style={{
          background: loading ? '#666' : '#007bff',
          color: 'white',
          border: 'none',
          padding: '8px 16px',
          borderRadius: '4px',
          cursor: loading ? 'not-allowed' : 'pointer',
          marginBottom: '10px',
          width: '100%'
        }}
      >
        {loading ? 'Running Tests...' : 'Debug Wallet Connection'}
      </button>
      
      {results.length > 0 && (
        <div style={{ whiteSpace: 'pre-wrap' }}>
          {results.map((log, i) => (
            <div key={i} style={{ marginBottom: '5px' }}>{log}</div>
          ))}
        </div>
      )}
    </div>
  );
}