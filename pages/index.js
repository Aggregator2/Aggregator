import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import dynamic from 'next/dynamic';
import SwapWidget from '../components/SwapWidget';
import Nav from '../components/Nav';
import Footer from '../components/Footer';
import styles from '../components/homepage.module.css';
import { isOrderArray } from '../types/wallet';
import Link from 'next/link';

// Use AnimatedBackground - client side only
const AnimatedBackground = dynamic(() => import('../src/components/AnimatedBackground'), {
  ssr: false,
  loading: () => <div style={{ position: 'fixed', inset: 0, background: '#0a0a0b' }} />
});

export default function Home() {
  const [userAddress, setUserAddress] = useState('');
  const [orders, setOrders] = useState([
    // Add some test orders for development
    {
      id: '1',
      status: 'filled',
      timestamp: new Date(Date.now() - 2 * 60 * 1000), // 2 minutes ago
      sellToken: 'ETH',
      buyToken: 'USDC',
      sellAmount: '1.5',
      buyAmount: '3000',
      txHash: '0x123...abc'
    },
    {
      id: '2',
      status: 'pending',
      timestamp: new Date(Date.now() - 1 * 60 * 1000), // 1 minute ago
      sellToken: 'USDC',
      buyToken: 'DAI',
      sellAmount: '1000',
      buyAmount: '999.5',
      txHash: undefined
    }
  ]);
  const [toastMessage, setToastMessage] = useState('');
  const [retryCount, setRetryCount] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Use relative URL to work with any port
  const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';
  const url = `${API_BASE_URL}/api/orders`;

  useEffect(() => {
    // Temporarily disable auto-refresh to prevent request flooding
    // refreshOrders();
    // const interval = setInterval(() => {
    //   if (!isRefreshing) {
    //     refreshOrders();
    //   }
    // }, 30000); // Increased to 30 seconds
    // return () => clearInterval(interval);
  }, [isRefreshing]);

  const connectWallet = async () => {
    showToast('Connecting wallet...');
    
    const { connectWallet: connect } = await import('../utils/walletConnection');
    const result = await connect({
      timeout: 30000,
      onPendingRequest: () => {
        showToast('Connection pending. Please check MetaMask.');
      }
    });
    
    if (result.success) {
      setUserAddress(result.address);
      showToast(`Connected: ${result.address.slice(0, 6)}...${result.address.slice(-4)}`);
    } else {
      console.error('Wallet connection failed:', result.error);
      showToast(result.error || 'Wallet connection failed');
    }
  };

  const refreshOrders = async () => {
    if (isRefreshing) return; // Prevent concurrent requests
    
    setIsRefreshing(true);
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
      
      const response = await fetch(`${API_BASE_URL}/api/orders`, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json'
        }
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      // Reset retry count on success
      setRetryCount(0);
      
      // Ensure data is an array of valid orders before setting
      if (Array.isArray(data)) {
        setOrders(data);
      } else {
        console.warn('Orders API returned non-array data:', data);
        setOrders([]);
      }
      
    } catch (err) {
      console.warn('Failed to refresh orders:', err.message);
      
      // Implement exponential backoff for retries
      const newRetryCount = retryCount + 1;
      setRetryCount(newRetryCount);
      
      // Don't spam errors after multiple failures
      if (newRetryCount <= 3) {
        // Exponential backoff: 2^retryCount seconds
        const retryDelay = Math.pow(2, newRetryCount) * 1000;
        setTimeout(() => {
          if (newRetryCount <= 3) { // Only retry if still under limit
            refreshOrders();
          }
        }, retryDelay);
      } else {
        // After 3 failed attempts, just set empty orders and wait for next interval
        setOrders([]);
        console.warn('Max retry attempts reached. Will retry on next interval.');
      }
    } finally {
      setIsRefreshing(false);
    }
  };

  const showToast = (message) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(''), 3000);
  };

  // Handle EIP-712 signed orders from SwapWidget
  const handleSubmitOrder = async (signedOrderData) => {
    try {
      // SwapWidget already provides the signed order with signature
      const { order, signature } = signedOrderData;
      
      // Submit to the proper solver endpoint
      const url = `${API_BASE_URL}/api/submitOrder`;
      console.log('Submitting order to solver:', url);
      console.log('Order data:', order);
      console.log('Signature:', signature);
      
      // Send order and signature separately as the API expects
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order, signature }),
      });
      
      if (!response.ok) {
        let errorMessage = 'Unknown error';
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorData.message || response.statusText;
        } catch {
          errorMessage = await response.text() || response.statusText;
        }
        console.error('Order submission failed:', response.status, errorMessage);
        throw new Error(`Failed to submit order: ${errorMessage}`);
      }
      
      const result = await response.json();

      // Show different toast messages based on API response status
      if (result.status === "escrow_required") {
        showToast("Order valid — awaiting escrow deposit from maker.");
      } else if (result.status === "settled_offchain") {
        showToast("Order fully matched and settled (simulated).");
      } else {
        showToast(result.message || "Order submitted!");
      }

      refreshOrders();
    } catch (err) {
      console.error('Order submission failed:', err);
      showToast('Order submission failed');
    }
  };

  return (
    <div style={{ 
      margin: 0, 
      padding: 0, 
      height: '100vh', 
      width: '100vw', 
      overflow: 'hidden',
      position: 'relative'
    }}>
      {/* Animated Background */}
      <AnimatedBackground theme="dark" />
      
      <Nav account={userAddress} connectWallet={connectWallet} />
      <div style={{ 
        position: 'absolute', 
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 1, 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        padding: '20px'
      }}>
        {toastMessage && <div className={styles.toast}>{toastMessage}</div>}
        <SwapWidget
          userAddress={userAddress}
          onConnect={connectWallet}
          onSubmitOrder={handleSubmitOrder}
          orders={orders}
        />
      </div>
    </div>
  );
}

// PropTypes for better type checking
Home.propTypes = {
  // This component doesn't receive props, but we can define internal state types
};

// Define PropTypes for child components if needed
SwapWidget.propTypes = {
  userAddress: PropTypes.string,
  onConnect: PropTypes.func.isRequired,
  onSubmitOrder: PropTypes.func.isRequired,
  orders: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string,
    sellToken: PropTypes.string.isRequired,
    buyToken: PropTypes.string.isRequired,
    sellAmount: PropTypes.string.isRequired,
    buyAmount: PropTypes.string.isRequired,
    user: PropTypes.string,
    kind: PropTypes.string
  }))
};