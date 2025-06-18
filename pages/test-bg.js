import React, { useState } from 'react';
import dynamic from 'next/dynamic';

// Dynamically import to avoid SSR issues with Three.js
const AnimatedBackground = dynamic(
  () => import('../src/components/AnimatedBackground'),
  { ssr: false }
);

export default function TestBG() {
  const [theme, setTheme] = useState('dark');
  
  return (
    <div style={{ 
      position: 'relative', 
      width: '100vw', 
      height: '100vh',
      overflow: 'hidden'
    }}>
      {/* Background Layer */}
      <AnimatedBackground 
        theme={theme}
        density={0.6}
        showOverlay={true}
      />
      
      {/* Content Layer */}
      <div style={{
        position: 'relative',
        zIndex: 10,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        padding: '20px'
      }}>
        <div style={{
          background: theme === 'dark' ? 'rgba(0, 0, 0, 0.8)' : 'rgba(255, 255, 255, 0.8)',
          backdropFilter: 'blur(10px)',
          padding: '40px',
          borderRadius: '20px',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          color: theme === 'dark' ? 'white' : 'black',
          textAlign: 'center',
          maxWidth: '500px'
        }}>
          <h1>Animated Background Test</h1>
          <p>If you can see floating crypto tokens and particles behind this box, the background is working!</p>
          <button 
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            style={{
              padding: '10px 20px',
              marginTop: '20px',
              background: theme === 'dark' ? '#4f46e5' : '#6366f1',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '16px'
            }}
          >
            Switch to {theme === 'dark' ? 'Light' : 'Dark'} Theme
          </button>
        </div>
      </div>
    </div>
  );
}