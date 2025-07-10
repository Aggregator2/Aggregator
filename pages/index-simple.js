import React, { useState, useEffect } from 'react';
import Head from 'next/head';

export default function Home() {
  const [health, setHealth] = useState({ status: 'checking' });
  const [tokens, setTokens] = useState([]);
  const [quote, setQuote] = useState(null);
  const [loading, setLoading] = useState(false);
  
  // Form state
  const [sellToken, setSellToken] = useState('ETH');
  const [buyToken, setBuyToken] = useState('USDT');
  const [sellAmount, setSellAmount] = useState('');

  useEffect(() => {
    // Check health on mount
    fetch('/api/health')
      .then(res => res.json())
      .then(data => setHealth(data))
      .catch(() => setHealth({ status: 'error' }));

    // Load tokens
    fetch('/api/tokens/comprehensive')
      .then(res => res.json())
      .then(data => setTokens(data.tokens || []))
      .catch(() => setTokens([]));
  }, []);

  const handleGetQuote = async () => {
    if (!sellAmount) return;
    
    setLoading(true);
    try {
      const res = await fetch('/api/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sellToken, buyToken, sellAmount })
      });
      const data = await res.json();
      setQuote(data);
    } catch (error) {
      console.error('Quote error:', error);
    }
    setLoading(false);
  };

  return (
    <>
      <Head>
        <title>Swappiq - Cross-Chain Trading Platform</title>
        <meta name="description" content="Trade across multiple blockchains with Swappiq" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <div style={{ minHeight: '100vh', background: '#0a0a0b', color: 'white', fontFamily: 'system-ui' }}>
        {/* Header */}
        <header style={{ background: '#111', padding: '20px 0', borderBottom: '1px solid #333' }}>
          <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '0 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h1 style={{ fontSize: '24px', fontWeight: 'bold', color: '#3b82f6' }}>Swappiq</h1>
            <nav>
              <a href="#swap" style={{ color: 'white', textDecoration: 'none', marginLeft: '20px' }}>Swap</a>
              <a href="/api/health" style={{ color: 'white', textDecoration: 'none', marginLeft: '20px' }}>API</a>
            </nav>
          </div>
        </header>

        {/* Main Content */}
        <main style={{ maxWidth: '1200px', margin: '0 auto', padding: '40px 20px' }}>
          {/* Health Status */}
          <div style={{ background: '#1a1a1a', padding: '20px', borderRadius: '8px', marginBottom: '30px' }}>
            <h2 style={{ fontSize: '18px', marginBottom: '10px' }}>System Status</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{
                width: '12px',
                height: '12px',
                borderRadius: '50%',
                background: health.status === 'healthy' ? '#10b981' : health.status === 'error' ? '#ef4444' : '#f59e0b'
              }} />
              <span>{health.status === 'healthy' ? 'All systems operational' : health.status === 'error' ? 'System error' : 'Checking...'}</span>
            </div>
          </div>

          {/* Swap Widget */}
          <div style={{ background: '#1a1a1a', padding: '30px', borderRadius: '8px', maxWidth: '500px', margin: '0 auto' }}>
            <h2 style={{ fontSize: '24px', marginBottom: '20px', textAlign: 'center' }}>Swap Tokens</h2>
            
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', color: '#9ca3af' }}>From</label>
              <div style={{ display: 'flex', gap: '10px' }}>
                <select 
                  value={sellToken}
                  onChange={(e) => setSellToken(e.target.value)}
                  style={{
                    padding: '12px',
                    borderRadius: '6px',
                    background: '#2a2a2a',
                    border: '1px solid #333',
                    color: 'white',
                    fontSize: '16px'
                  }}
                >
                  {tokens.map(token => (
                    <option key={token.symbol} value={token.symbol}>{token.symbol}</option>
                  ))}
                </select>
                <input
                  type="number"
                  placeholder="0.0"
                  value={sellAmount}
                  onChange={(e) => setSellAmount(e.target.value)}
                  style={{
                    flex: 1,
                    padding: '12px',
                    borderRadius: '6px',
                    background: '#2a2a2a',
                    border: '1px solid #333',
                    color: 'white',
                    fontSize: '16px'
                  }}
                />
              </div>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', color: '#9ca3af' }}>To</label>
              <div style={{ display: 'flex', gap: '10px' }}>
                <select 
                  value={buyToken}
                  onChange={(e) => setBuyToken(e.target.value)}
                  style={{
                    padding: '12px',
                    borderRadius: '6px',
                    background: '#2a2a2a',
                    border: '1px solid #333',
                    color: 'white',
                    fontSize: '16px'
                  }}
                >
                  {tokens.map(token => (
                    <option key={token.symbol} value={token.symbol}>{token.symbol}</option>
                  ))}
                </select>
                <input
                  type="text"
                  placeholder="0.0"
                  value={quote ? quote.buyAmount : ''}
                  readOnly
                  style={{
                    flex: 1,
                    padding: '12px',
                    borderRadius: '6px',
                    background: '#2a2a2a',
                    border: '1px solid #333',
                    color: 'white',
                    fontSize: '16px'
                  }}
                />
              </div>
            </div>

            <button
              onClick={handleGetQuote}
              disabled={loading || !sellAmount}
              style={{
                width: '100%',
                padding: '14px',
                borderRadius: '6px',
                background: loading || !sellAmount ? '#4b5563' : '#3b82f6',
                color: 'white',
                fontSize: '16px',
                fontWeight: '500',
                border: 'none',
                cursor: loading || !sellAmount ? 'not-allowed' : 'pointer'
              }}
            >
              {loading ? 'Getting Quote...' : 'Get Quote'}
            </button>

            {quote && (
              <div style={{ marginTop: '20px', padding: '15px', background: '#2a2a2a', borderRadius: '6px' }}>
                <div style={{ fontSize: '14px', color: '#9ca3af' }}>
                  <div>Price: 1 {sellToken} = {quote.price} {buyToken}</div>
                  <div>Estimated Gas: {quote.estimatedGas}</div>
                </div>
              </div>
            )}
          </div>

          {/* Features */}
          <div style={{ marginTop: '60px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '20px' }}>
            <div style={{ background: '#1a1a1a', padding: '20px', borderRadius: '8px' }}>
              <h3 style={{ fontSize: '18px', marginBottom: '10px', color: '#3b82f6' }}>Cross-Chain Trading</h3>
              <p style={{ color: '#9ca3af', fontSize: '14px' }}>Trade seamlessly across multiple blockchains with our advanced routing system.</p>
            </div>
            <div style={{ background: '#1a1a1a', padding: '20px', borderRadius: '8px' }}>
              <h3 style={{ fontSize: '18px', marginBottom: '10px', color: '#3b82f6' }}>Best Prices</h3>
              <p style={{ color: '#9ca3af', fontSize: '14px' }}>Our smart routing finds the best prices across multiple liquidity sources.</p>
            </div>
            <div style={{ background: '#1a1a1a', padding: '20px', borderRadius: '8px' }}>
              <h3 style={{ fontSize: '18px', marginBottom: '10px', color: '#3b82f6' }}>Secure Settlement</h3>
              <p style={{ color: '#9ca3af', fontSize: '14px' }}>Advanced settlement engine with merkle proof verification for maximum security.</p>
            </div>
          </div>
        </main>

        {/* Footer */}
        <footer style={{ marginTop: '80px', padding: '40px 20px', borderTop: '1px solid #333', textAlign: 'center' }}>
          <p style={{ color: '#6b7280', fontSize: '14px' }}>© 2025 SwappiQ. All rights reserved.</p>
        </footer>
      </div>
    </>
  );
}