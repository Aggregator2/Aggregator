import React, { useState, useEffect } from 'react';

export default function WorkingBG() {
  const [mounted, setMounted] = useState(false);
  const [theme, setTheme] = useState('dark');

  // Only render after client mount to avoid hydration issues
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div style={{ 
        width: '100vw', 
        height: '100vh', 
        background: '#0a0a0b',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'white'
      }}>
        Loading...
      </div>
    );
  }

  return (
    <div style={{ 
      position: 'relative', 
      width: '100vw', 
      height: '100vh',
      overflow: 'hidden',
      background: theme === 'dark' 
        ? 'linear-gradient(135deg, #0a0a0b 0%, #121214 50%, #0a0a0b 100%)'
        : 'linear-gradient(135deg, #fefefe 0%, #f9fafb 50%, #fefefe 100%)'
    }}>
      
      {/* Simple floating tokens */}
      {[0, 1, 2, 3, 4, 5].map(i => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: `${15 + (i * 15)}%`,
            top: `${20 + (i * 10)}%`,
            width: '50px',
            height: '50px',
            background: theme === 'dark' ? '#627eea15' : '#4f46e510',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '24px',
            color: theme === 'dark' ? '#627eea40' : '#4f46e530',
            animation: `float-${i % 3} ${6 + i}s ease-in-out infinite`,
            animationDelay: `${i * 0.5}s`
          }}
        >
          {['₿', 'Ξ', '◊', '◯', '⟐', '◈'][i]}
        </div>
      ))}

      {/* Floating particles */}
      {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => (
        <div
          key={`particle-${i}`}
          style={{
            position: 'absolute',
            left: `${Math.random() * 100}%`,
            top: `${100 + (Math.random() * 20)}%`,
            width: '4px',
            height: '4px',
            background: theme === 'dark' ? '#627eea20' : '#4f46e515',
            borderRadius: '50%',
            animation: `drift ${12 + (i % 4)}s linear infinite`,
            animationDelay: `${i * 2}s`
          }}
        />
      ))}

      {/* Content overlay */}
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
          backdropFilter: 'blur(15px)',
          padding: '40px',
          borderRadius: '20px',
          border: `1px solid ${theme === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'}`,
          color: theme === 'dark' ? 'white' : 'black',
          textAlign: 'center',
          maxWidth: '500px'
        }}>
          <h1 style={{ marginTop: 0 }}>🎉 Working Animated Background!</h1>
          <p>This uses simple CSS animations that work everywhere!</p>
          <p>Look around this box - you should see floating crypto tokens and particles moving in the background.</p>
          
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
              marginTop: '20px'
            }}
          >
            Switch to {theme === 'dark' ? 'Light' : 'Dark'} Theme ✨
          </button>
        </div>
      </div>

      {/* CSS Animations */}
      <style jsx>{`
        @keyframes float-0 {
          0%, 100% { transform: translateY(0px) rotate(0deg); }
          50% { transform: translateY(-20px) rotate(5deg); }
        }
        
        @keyframes float-1 {
          0%, 100% { transform: translateX(0px) translateY(0px) rotate(0deg); }
          33% { transform: translateX(10px) translateY(-15px) rotate(-3deg); }
          66% { transform: translateX(-5px) translateY(-10px) rotate(4deg); }
        }
        
        @keyframes float-2 {
          0%, 100% { transform: translateX(0px) translateY(0px) rotate(0deg); }
          25% { transform: translateX(-8px) translateY(-12px) rotate(2deg); }
          75% { transform: translateX(12px) translateY(-18px) rotate(-6deg); }
        }
        
        @keyframes drift {
          0% { 
            transform: translateY(0px) translateX(0px); 
            opacity: 0; 
          }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { 
            transform: translateY(-100vh) translateX(30px); 
            opacity: 0; 
          }
        }
      `}</style>
    </div>
  );
}