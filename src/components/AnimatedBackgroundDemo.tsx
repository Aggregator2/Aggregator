import React, { useState } from 'react'
import AnimatedBackground from './AnimatedBackground'

/**
 * Demo component showing AnimatedBackground with best practices
 * Demonstrates minimal visual noise and professional polish
 */
export default function AnimatedBackgroundDemo() {
  const [theme, setTheme] = useState<'light' | 'dark'>('dark')
  const [density, setDensity] = useState(0.7)
  const [showOverlay, setShowOverlay] = useState(true)

  return (
    <div style={{ 
      position: 'relative', 
      width: '100vw', 
      height: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    }}>
      {/* Animated Background Layer */}
      <AnimatedBackground 
        theme={theme} 
        density={density}
        showOverlay={showOverlay}
        animationSpeed={0.5}
      />
      
      {/* Content Layer - Widget Container */}
      <div style={{
        position: 'relative',
        zIndex: 10,
        background: theme === 'dark' 
          ? 'rgba(18, 18, 20, 0.85)' 
          : 'rgba(255, 255, 255, 0.85)',
        backdropFilter: 'blur(20px) saturate(150%)',
        WebkitBackdropFilter: 'blur(20px) saturate(150%)',
        borderRadius: '20px',
        padding: '32px',
        border: theme === 'dark' 
          ? '1px solid rgba(255, 255, 255, 0.08)' 
          : '1px solid rgba(0, 0, 0, 0.06)',
        boxShadow: theme === 'dark'
          ? '0 24px 48px -12px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05)'
          : '0 24px 48px -12px rgba(0, 0, 0, 0.1), 0 0 0 1px rgba(0, 0, 0, 0.02)',
        color: theme === 'dark' ? '#ffffff' : '#1a1a1c',
        maxWidth: '440px',
        width: '90%',
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
      }}>
        {/* Header */}
        <div style={{ 
          marginBottom: '28px',
          textAlign: 'center'
        }}>
          <h2 style={{ 
            margin: '0 0 8px 0', 
            fontSize: '28px',
            fontWeight: '600',
            letterSpacing: '-0.02em',
            background: theme === 'dark'
              ? 'linear-gradient(135deg, #ffffff 0%, #e0e0e0 100%)'
              : 'linear-gradient(135deg, #1a1a1c 0%, #4a4a4c 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text'
          }}>
            Meta Aggregator
          </h2>
          <p style={{ 
            margin: 0,
            fontSize: '14px',
            opacity: 0.6,
            letterSpacing: '0.01em'
          }}>
            Professional animated background demo
          </p>
        </div>
        
        {/* Controls Section */}
        <div style={{ 
          background: theme === 'dark' 
            ? 'rgba(255, 255, 255, 0.03)' 
            : 'rgba(0, 0, 0, 0.02)',
          borderRadius: '12px',
          padding: '20px',
          marginBottom: '24px'
        }}>
          {/* Density Control */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ 
              display: 'block', 
              fontSize: '13px', 
              fontWeight: '500',
              marginBottom: '8px',
              opacity: 0.8
            }}>
              Animation Density: {Math.round(density * 100)}%
            </label>
            <input 
              type="range" 
              min="0.1" 
              max="1" 
              step="0.1" 
              value={density}
              onChange={(e) => setDensity(parseFloat(e.target.value))}
              style={{
                width: '100%',
                height: '6px',
                borderRadius: '3px',
                background: theme === 'dark' 
                  ? 'rgba(255, 255, 255, 0.1)' 
                  : 'rgba(0, 0, 0, 0.1)',
                outline: 'none',
                WebkitAppearance: 'none',
                cursor: 'pointer'
              }}
            />
          </div>
          
          {/* Overlay Toggle */}
          <label style={{ 
            display: 'flex', 
            alignItems: 'center',
            fontSize: '13px',
            fontWeight: '500',
            opacity: 0.8,
            cursor: 'pointer'
          }}>
            <input 
              type="checkbox" 
              checked={showOverlay}
              onChange={(e) => setShowOverlay(e.target.checked)}
              style={{ marginRight: '8px' }}
            />
            Show readability overlay
          </label>
        </div>
        
        {/* Example Widget Content */}
        <div style={{ 
          background: theme === 'dark' 
            ? 'rgba(255, 255, 255, 0.03)' 
            : 'rgba(0, 0, 0, 0.02)',
          borderRadius: '12px',
          padding: '16px',
          marginBottom: '24px',
          fontSize: '14px',
          lineHeight: '1.6',
          opacity: 0.8
        }}>
          <p style={{ margin: '0 0 12px 0' }}>
            This background implements all best practices:
          </p>
          <ul style={{ 
            margin: 0, 
            paddingLeft: '20px',
            fontSize: '13px'
          }}>
            <li>Minimal visual noise with low opacity</li>
            <li>Slow, natural motion using easing curves</li>
            <li>Performance optimized with instancing</li>
            <li>Responsive design for all devices</li>
            <li>Theme-aware color schemes</li>
          </ul>
        </div>
        
        {/* Theme Toggle Button */}
        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          style={{
            width: '100%',
            padding: '14px 24px',
            borderRadius: '10px',
            border: 'none',
            background: theme === 'dark' 
              ? 'linear-gradient(135deg, rgba(98, 126, 234, 0.9), rgba(153, 69, 255, 0.9))' 
              : 'linear-gradient(135deg, rgba(79, 70, 229, 0.9), rgba(139, 92, 246, 0.9))',
            color: 'white',
            fontSize: '15px',
            fontWeight: '500',
            cursor: 'pointer',
            transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
            letterSpacing: '0.01em',
            boxShadow: theme === 'dark'
              ? '0 4px 12px rgba(98, 126, 234, 0.3)'
              : '0 4px 12px rgba(79, 70, 229, 0.3)'
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.transform = 'translateY(-1px)'
            e.currentTarget.style.boxShadow = theme === 'dark'
              ? '0 6px 20px rgba(98, 126, 234, 0.4)'
              : '0 6px 20px rgba(79, 70, 229, 0.4)'
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.transform = 'translateY(0)'
            e.currentTarget.style.boxShadow = theme === 'dark'
              ? '0 4px 12px rgba(98, 126, 234, 0.3)'
              : '0 4px 12px rgba(79, 70, 229, 0.3)'
          }}
        >
          Switch to {theme === 'dark' ? 'Light' : 'Dark'} Theme
        </button>
        
        {/* Footer */}
        <div style={{ 
          marginTop: '20px', 
          fontSize: '12px', 
          opacity: 0.5,
          textAlign: 'center',
          letterSpacing: '0.02em'
        }}>
          Powered by React Three Fiber • Inspired by Uniswap
        </div>
      </div>
    </div>
  )
}