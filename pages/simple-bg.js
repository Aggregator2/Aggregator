import React, { useEffect, useState } from 'react';

export default function SimpleBG() {
  const [AnimatedBackground, setAnimatedBackground] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Dynamically import the component
    import('../src/components/AnimatedBackground')
      .then((module) => {
        setAnimatedBackground(() => module.default);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load AnimatedBackground:', err);
        setError(err.message);
        setLoading(false);
      });
  }, []);

  return (
    <div style={{ 
      position: 'relative', 
      width: '100vw', 
      height: '100vh',
      overflow: 'hidden',
      background: '#0a0a0b'
    }}>
      {loading && (
        <div style={{ 
          position: 'absolute', 
          top: '50%', 
          left: '50%', 
          transform: 'translate(-50%, -50%)',
          color: 'white',
          fontSize: '20px'
        }}>
          Loading animated background...
        </div>
      )}
      
      {error && (
        <div style={{ 
          position: 'absolute', 
          top: '50%', 
          left: '50%', 
          transform: 'translate(-50%, -50%)',
          color: 'red',
          fontSize: '20px',
          maxWidth: '80%',
          textAlign: 'center'
        }}>
          Error loading background: {error}
        </div>
      )}
      
      {AnimatedBackground && !error && (
        <AnimatedBackground 
          theme="dark"
          density={0.8}
          showOverlay={false}
        />
      )}
      
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
          background: 'rgba(20, 20, 25, 0.9)',
          backdropFilter: 'blur(10px)',
          padding: '40px',
          borderRadius: '20px',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          color: 'white',
          textAlign: 'center',
          maxWidth: '600px'
        }}>
          <h1 style={{ marginTop: 0 }}>Simple Background Test</h1>
          <p>Status: {loading ? 'Loading...' : error ? 'Error!' : 'Loaded!'}</p>
          <p style={{ fontSize: '14px', opacity: 0.7 }}>
            Check the browser console (F12) for any errors.
          </p>
        </div>
      </div>
    </div>
  );
}