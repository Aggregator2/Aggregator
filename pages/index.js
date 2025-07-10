import React from 'react';
import Head from 'next/head';
import SwapWidget from '../components/SwapWidget';

export default function Home() {
  return (
    <>
      <Head>
        <title>Swappiq - Cross-Chain Trading Platform</title>
        <meta name="description" content="Trade across multiple blockchains with Swappiq" />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <div style={{ 
        minHeight: '100vh', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        background: '#0a0a0b',
        position: 'relative',
        overflow: 'hidden'
      }}>
        <SwapWidget />
      </div>
    </>
  );
}