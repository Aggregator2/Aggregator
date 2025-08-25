import React, { useState, useEffect } from 'react';
import Head from 'next/head';

export default function RevenueDashboard() {
  const [revenueData, setRevenueData] = useState({
    totalRevenue: 0,
    feeCount: 0,
    lastCollection: null,
    walletBalances: {},
    revenueWallet: 'Loading...'
  });
  const [loading, setLoading] = useState(false);
  const [alert, setAlert] = useState(null);

  useEffect(() => {
    loadRevenueWallet();
    refreshData();
    const interval = setInterval(refreshData, 10000);
    return () => clearInterval(interval);
  }, []);

  const loadRevenueWallet = () => {
    const wallet = process.env.NEXT_PUBLIC_REVENUE_WALLET || 'Not configured';
    setRevenueData(prev => ({ ...prev, revenueWallet: wallet }));
  };

  const refreshData = async () => {
    try {
      const [stateRes, balancesRes] = await Promise.all([
        fetch('/api/revenue/state'),
        fetch('/api/revenue/balances')
      ]);

      const stateData = await stateRes.json();
      const balancesData = await balancesRes.json();

      if (stateData.success) {
        setRevenueData(prev => ({
          ...prev,
          totalRevenue: stateData.state.totalRevenueUSD || 0,
          feeCount: stateData.state.feeCount || 0,
          lastCollection: stateData.state.lastTransferTimestamp
        }));
      }

      if (balancesData.success) {
        setRevenueData(prev => ({
          ...prev,
          walletBalances: balancesData.balances || {},
          revenueWallet: balancesData.revenueWallet || prev.revenueWallet
        }));
      }
    } catch (error) {
      console.error('Error refreshing data:', error);
    }
  };

  const forceTransfer = async () => {
    const adminKey = prompt('Enter admin key:');
    if (!adminKey) return;

    setLoading(true);
    try {
      const response = await fetch('/api/revenue/force-transfer', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Key': adminKey
        }
      });

      const data = await response.json();
      if (data.success) {
        setAlert({ type: 'success', message: 'Transfer initiated successfully!' });
        setTimeout(refreshData, 2000);
      } else {
        setAlert({ type: 'error', message: data.error || 'Transfer failed' });
      }
    } catch (error) {
      setAlert({ type: 'error', message: 'Network error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>Revenue Dashboard - Swappiq</title>
        <meta name="description" content="Monitor revenue and fee collections" />
      </Head>

      <div style={{ minHeight: '100vh', background: '#0a0b0d', color: '#e0e0e0', padding: '20px' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <h1 style={{ color: '#00d4ff', textAlign: 'center', marginBottom: '30px' }}>
            Revenue Verification Dashboard
          </h1>

          {alert && (
            <div style={{
              padding: '15px',
              borderRadius: '8px',
              marginBottom: '20px',
              background: alert.type === 'success' ? '#00ff8822' : '#ff444422',
              border: `1px solid ${alert.type === 'success' ? '#00ff8844' : '#ff444444'}`,
              color: alert.type === 'success' ? '#00ff88' : '#ff4444'
            }}>
              {alert.message}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px', marginBottom: '30px' }}>
            {/* Revenue Summary */}
            <div style={{ background: '#1a1d21', padding: '20px', borderRadius: '12px', border: '1px solid #2a2d31' }}>
              <h2 style={{ color: '#00d4ff', marginBottom: '20px' }}>💰 Revenue Summary</h2>
              <div style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '10px' }}>
                ${revenueData.totalRevenue.toFixed(2)}
              </div>
              <div style={{ color: '#888' }}>Total Accumulated Revenue</div>
              <div style={{ marginTop: '15px', color: '#00d4ff' }}>
                Transfer Threshold: $50.00
              </div>
            </div>

            {/* Wallet Info */}
            <div style={{ background: '#1a1d21', padding: '20px', borderRadius: '12px', border: '1px solid #2a2d31' }}>
              <h2 style={{ color: '#00d4ff', marginBottom: '20px' }}>🔗 Revenue Wallet</h2>
              <div style={{ fontFamily: 'monospace', fontSize: '0.9rem', wordBreak: 'break-all' }}>
                {revenueData.revenueWallet}
              </div>
              <div style={{ marginTop: '20px' }}>
                {Object.entries(revenueData.walletBalances).map(([chain, tokens]) => (
                  <div key={chain} style={{ marginBottom: '10px' }}>
                    <strong>{chain}:</strong>
                    {Object.entries(tokens).map(([token, balance]) => (
                      <div key={token} style={{ marginLeft: '10px', color: '#888' }}>
                        {token}: {parseFloat(balance).toFixed(6)}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>

            {/* Fee Collections */}
            <div style={{ background: '#1a1d21', padding: '20px', borderRadius: '12px', border: '1px solid #2a2d31' }}>
              <h2 style={{ color: '#00d4ff', marginBottom: '20px' }}>📊 Fee Collections</h2>
              <div style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '10px' }}>
                {revenueData.feeCount}
              </div>
              <div style={{ color: '#888' }}>Total Fee Events</div>
              {revenueData.lastCollection && (
                <div style={{ marginTop: '15px', color: '#888', fontSize: '0.9rem' }}>
                  Last Transfer: {new Date(revenueData.lastCollection).toLocaleString()}
                </div>
              )}
            </div>
          </div>

          {/* Controls */}
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button
              onClick={refreshData}
              style={{
                padding: '10px 20px',
                borderRadius: '8px',
                border: 'none',
                background: '#00d4ff',
                color: '#000',
                fontWeight: 'bold',
                cursor: 'pointer'
              }}
            >
              🔄 Refresh Data
            </button>
            <button
              onClick={forceTransfer}
              disabled={loading}
              style={{
                padding: '10px 20px',
                borderRadius: '8px',
                border: 'none',
                background: '#ff4444',
                color: '#fff',
                fontWeight: 'bold',
                cursor: 'pointer',
                opacity: loading ? 0.5 : 1
              }}
            >
              💸 Force Transfer
            </button>
          </div>

          {/* Instructions */}
          <div style={{ marginTop: '40px', background: '#1a1d21', padding: '20px', borderRadius: '12px', border: '1px solid #2a2d31' }}>
            <h3 style={{ color: '#00d4ff', marginBottom: '15px' }}>📖 Quick Guide</h3>
            <ol style={{ lineHeight: '1.8' }}>
              <li>Run the wallet monitor: <code>node scripts/monitor-revenue-wallet.js</code></li>
              <li>Start event listener: <code>node scripts/revenue-event-listener.js</code></li>
              <li>Test fee collection: <code>node scripts/test-revenue-system.js</code></li>
              <li>Revenue transfers automatically at $50 threshold</li>
              <li>Use "Force Transfer" for manual transfers</li>
            </ol>
          </div>
        </div>
      </div>
    </>
  );
}