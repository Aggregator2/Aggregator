import React, { useState } from 'react';

export function DebugTokenLoader() {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<string[]>([]);

  const runDebugTests = async () => {
    setLoading(true);
    setResults([]);
    const logs: string[] = [];

    try {
      // Test 1: Check if @lifi/sdk is loaded
      logs.push('🔍 Test 1: Checking @lifi/sdk availability...');
      try {
        const { getChains, getTokens } = await import('@lifi/sdk');
        logs.push('✅ @lifi/sdk loaded successfully');
        
        // Test 2: Try to fetch chains
        logs.push('🔍 Test 2: Fetching chains...');
        const chainsStart = Date.now();
        const chains = await getChains();
        const chainsTime = Date.now() - chainsStart;
        logs.push(`✅ Fetched ${chains.length} chains in ${chainsTime}ms`);
        
        // Test 3: Try to fetch tokens for Ethereum
        logs.push('🔍 Test 3: Fetching Ethereum tokens...');
        const tokensStart = Date.now();
        const tokensResponse = await getTokens({ chains: [1] });
        const tokensTime = Date.now() - tokensStart;
        const ethTokens = tokensResponse.tokens[1] || [];
        logs.push(`✅ Fetched ${ethTokens.length} Ethereum tokens in ${tokensTime}ms`);
        
        // Test 4: Check token monitoring service
        logs.push('🔍 Test 4: Checking TokenMonitoringService...');
        const { TokenMonitoringService } = await import('../src/services/tokenMonitoringService');
        const cachedTokens = TokenMonitoringService.getCachedTokens();
        logs.push(`ℹ️ TokenMonitoringService has ${cachedTokens.size} chains cached`);
        
        // Test 5: Check lifiService
        logs.push('🔍 Test 5: Checking lifiService...');
        const { lifiService } = await import('../src/services/lifiService');
        const cachedTokensArray = lifiService.getCachedTokens();
        logs.push(`ℹ️ lifiService has ${cachedTokensArray.length} tokens in cache`);
        
        // Test 6: Network connectivity
        logs.push('🔍 Test 6: Testing API endpoint...');
        const apiStart = Date.now();
        const apiResponse = await fetch('/api/test-lifi');
        const apiTime = Date.now() - apiStart;
        const apiData = await apiResponse.json();
        logs.push(`${apiResponse.ok ? '✅' : '❌'} API test endpoint responded in ${apiTime}ms`);
        if (apiData.error) {
          logs.push(`❌ API Error: ${apiData.error.message}`);
        }
        
      } catch (sdkError: any) {
        logs.push(`❌ SDK Error: ${sdkError.message}`);
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
      bottom: '20px',
      right: '20px',
      background: 'rgba(0, 0, 0, 0.9)',
      color: 'white',
      padding: '15px',
      borderRadius: '8px',
      maxWidth: '400px',
      maxHeight: '300px',
      overflow: 'auto',
      fontSize: '12px',
      fontFamily: 'monospace',
      zIndex: 9999
    }}>
      <button
        onClick={runDebugTests}
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
        {loading ? 'Running Tests...' : 'Debug Token Loading'}
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