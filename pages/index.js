import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import SwapWidget from '../components/SwapWidget';
import Nav from '../components/Nav';
import Footer from '../components/Footer';
import styles from '../components/homepage.module.css';

export default function Home() {
  const [userAddress, setUserAddress] = useState('');
  const [orders, setOrders] = useState([]);
  const [toastMessage, setToastMessage] = useState('');

  const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

  useEffect(() => {
    refreshOrders();
    const interval = setInterval(refreshOrders, 5000);
    return () => clearInterval(interval);
  }, []);

  const connectWallet = async () => {
    try {
      if (!window.ethereum) return alert('MetaMask required');
      const provider = new ethers.providers.Web3Provider(window.ethereum, 'any');
      await provider.send('eth_requestAccounts', []);
      const signer = provider.getSigner();
      const address = await signer.getAddress();
      setUserAddress(address);
      showToast('Wallet connected');
    } catch (err) {
      console.error('Wallet connection failed:', err);
      showToast('Wallet connection failed');
    }
  };

  const refreshOrders = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/orders`);
      const orders = await response.json();
      setOrders(orders);
    } catch (err) {
      console.error('Failed to refresh orders:', err);
    }
  };

  const showToast = (message) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(''), 3000);
  };

  // Example: expects SwapWidget to call this with an order object
  const handleSubmitOrder = async (order) => {
    try {
      const provider = new ethers.providers.Web3Provider(window.ethereum, 'any');
      const signer = provider.getSigner();

      const encoded = ethers.utils.defaultAbiCoder.encode(
        ['string', 'string', 'uint256', 'uint256', 'uint256', 'address', 'string'],
        [
          order.sellToken,
          order.buyToken,
          order.sellAmount,
          order.buyAmount,
          order.validTo,
          order.user,
          order.side,
        ]
      );
      const hash = ethers.utils.keccak256(encoded);
      const signature = await signer.signMessage(ethers.utils.arrayify(hash));
      const signedOrder = { ...order, signature };

      const url = `${API_BASE_URL}/orders`;
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(signedOrder),
      });

      showToast('Order Submitted');
      refreshOrders();
    } catch (err) {
      console.error('Order submission failed:', err);
      showToast('Order submission failed');
    }
  };

  return (
    <>
      <Nav account={userAddress} connectWallet={connectWallet} />
      <div className={styles.container}>
        {toastMessage && <div className={styles.toast}>{toastMessage}</div>}
        <main className={styles.main}>
          <SwapWidget
            userAddress={userAddress}
            onConnect={connectWallet}
            onSubmitOrder={handleSubmitOrder}
            orders={orders}
          />
          {/* Example order book display */}
          <div style={{ marginTop: 24 }}>
            <h3>Order Book</h3>
            <ul>
              {orders.map((order, i) => (
                <li key={i}>
                  {order.side} {order.sellAmount} {order.sellToken} → {order.buyAmount} {order.buyToken} ({order.user?.slice(0, 6)}...)
                </li>
              ))}
            </ul>
          </div>
        </main>
      </div>
      <Footer />
    </>
  );
}