import React, { useState } from 'react';
import CSSAnimatedBackground from '../src/components/CSSAnimatedBackground';

export default function CSSBGTest() {
  const [theme, setTheme] = useState('dark');
  const [density, setDensity] = useState(0.7);
  
  return (
    <div style={{ 
      position: 'relative', 
      width: '100vw', 
      height: '100vh',
      overflow: 'hidden'
    }}>
      {/* CSS Background - No WebGL Required */}
      <CSSAnimatedBackground 
        theme={theme}
        density={density}
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
          background: theme === 'dark' ? 'rgba(0, 0, 0, 0.85)' : 'rgba(255, 255, 255, 0.85)',
          backdropFilter: 'blur(10px)',
          padding: '40px',
          borderRadius: '20px',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          color: theme === 'dark' ? 'white' : 'black',
          textAlign: 'center',
          maxWidth: '500px'
        }}>
          <h1 style={{ marginTop: 0 }}>✅ CSS Animated Background</h1>
          <p>This version works without WebGL using pure CSS animations!</p>
          
          <div style={{ margin: '20px 0' }}>
            <label style={{ display: 'block', marginBottom: '10px' }}>
              Density: {Math.round(density * 100)}%
            </label>
            <input 
              type="range" 
              min="0.3" 
              max="1" 
              step="0.1" 
              value={density}
              onChange={(e) => setDensity(parseFloat(e.target.value))}
              style={{ width: '200px' }}
            />
          </div>
          
          <button 
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            style={{
              padding: '12px 24px',
              background: theme === 'dark' ? '#4f46e5' : '#6366f1',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '16px',
              marginTop: '10px'
            }}
          >
            Switch to {theme === 'dark' ? 'Light' : 'Dark'} Theme
          </button>
          
          <div style={{ 
            marginTop: '20px', 
            fontSize: '14px', 
            opacity: 0.7 
          }}>
            <p>✓ No WebGL required</p>
            <p>✓ Works on all browsers</p>
            <p>✓ Floating tokens and particles</p>
            <p>✓ Animated wave at bottom</p>
          </div>
        </div>
      </div>
    </div>
  );
}