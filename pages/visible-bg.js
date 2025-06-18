import React, { useEffect, useState } from 'react';

export default function VisibleBG() {
  const [Component, setComponent] = useState(null);

  useEffect(() => {
    // Simple test to see if Three.js loads
    Promise.all([
      import('three'),
      import('@react-three/fiber'),
      import('../src/components/AnimatedBackground')
    ]).then(([three, fiber, bg]) => {
      console.log('Three.js loaded:', !!three);
      console.log('React Three Fiber loaded:', !!fiber);
      console.log('AnimatedBackground loaded:', !!bg.default);
      setComponent(() => bg.default);
    }).catch(err => {
      console.error('Import error:', err);
    });
  }, []);

  if (!Component) {
    return (
      <div style={{ 
        width: '100vw', 
        height: '100vh', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        background: '#000',
        color: '#fff',
        flexDirection: 'column'
      }}>
        <h1>Loading Three.js Components...</h1>
        <p>Check browser console for details</p>
        <p style={{ marginTop: '20px', fontSize: '14px', opacity: 0.7 }}>
          Press F12 to open developer console
        </p>
      </div>
    );
  }

  // Create a custom theme with more visible colors for testing
  const testTheme = {
    dark: {
      background: 'linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%)',
      tokenColors: ['#627eea80', '#f7931a80', '#9945ff80', '#00d4aa80', '#ff6b6b80'], // 50% opacity
      lineColor: '#627eea60',
      waveColor: '#627eea40',
      particleColor: '#627eea80',
      glowColor: '#627eea30',
      overlayOpacity: 0
    }
  };

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh' }}>
      <Component 
        theme="dark"
        density={1.0}  // Maximum density
        animationSpeed={0.8}  // Faster animation
        showOverlay={false}  // No overlay
      />
      
      <div style={{
        position: 'fixed',
        top: '20px',
        left: '20px',
        background: 'rgba(0, 0, 0, 0.8)',
        padding: '20px',
        borderRadius: '10px',
        color: 'white',
        maxWidth: '400px',
        zIndex: 100
      }}>
        <h2 style={{ margin: '0 0 10px 0' }}>Visible Background Test</h2>
        <p style={{ margin: '5px 0' }}>✅ Three.js modules loaded</p>
        <p style={{ margin: '5px 0' }}>🎨 Using high opacity (50-80%) for testing</p>
        <p style={{ margin: '5px 0' }}>🚀 Maximum density and speed</p>
        <p style={{ margin: '5px 0', fontSize: '14px', opacity: 0.7 }}>
          You should see floating tokens, lines, waves, and particles
        </p>
      </div>
    </div>
  );
}