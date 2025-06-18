import React from 'react'

// CSS-based animated background that works without WebGL/Three.js
interface CSSAnimatedBackgroundProps {
  theme?: 'light' | 'dark'
  className?: string
  density?: number
  showOverlay?: boolean
}

export default function CSSAnimatedBackground({
  theme = 'dark',
  className,
  density = 0.7,
  showOverlay = true
}: CSSAnimatedBackgroundProps) {
  
  const tokenCount = Math.floor((theme === 'dark' ? 8 : 6) * density)
  const particleCount = Math.floor((theme === 'dark' ? 12 : 8) * density)
  
  const themeColors = {
    dark: {
      background: 'linear-gradient(135deg, #0a0a0b 0%, #121214 50%, #0a0a0b 100%)',
      tokenColor: '#627eea20',
      particleColor: '#627eea15',
      waveColor: '#627eea10'
    },
    light: {
      background: 'linear-gradient(135deg, #fefefe 0%, #f9fafb 50%, #fefefe 100%)',
      tokenColor: '#4f46e510',
      particleColor: '#4f46e508',
      waveColor: '#4f46e506'
    }
  }
  
  const currentTheme = themeColors[theme]
  
  return (
    <div 
      className={`css-animated-background css-animated-background--${theme} ${className || ''}`}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        background: currentTheme.background,
        pointerEvents: 'none',
        zIndex: 0,
        overflow: 'hidden'
      }}
    >
      {/* Floating Tokens */}
      {Array.from({ length: tokenCount }, (_, i) => (
        <div
          key={`token-${i}`}
          className="floating-token"
          style={{
            position: 'absolute',
            left: `${10 + (i * 80 / tokenCount)}%`,
            top: `${20 + (i * 60 / tokenCount)}%`,
            width: '40px',
            height: '40px',
            background: currentTheme.tokenColor,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '20px',
            color: theme === 'dark' ? '#627eea40' : '#4f46e530',
            animation: `float-${i % 3} ${8 + (i % 4)}s ease-in-out infinite`,
            animationDelay: `${i * 0.5}s`
          }}
        >
          {['₿', 'Ξ', '◊', '◯'][i % 4]}
        </div>
      ))}
      
      {/* Floating Particles */}
      {Array.from({ length: particleCount }, (_, i) => (
        <div
          key={`particle-${i}`}
          className="floating-particle"
          style={{
            position: 'absolute',
            left: `${Math.random() * 100}%`,
            top: `${Math.random() * 100}%`,
            width: '3px',
            height: '3px',
            background: currentTheme.particleColor,
            borderRadius: '50%',
            animation: `drift ${15 + (i % 5)}s linear infinite`,
            animationDelay: `${Math.random() * 10}s`
          }}
        />
      ))}
      
      {/* Wave at bottom */}
      <div
        className="price-wave"
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          width: '100%',
          height: '100px',
          background: `linear-gradient(45deg, transparent, ${currentTheme.waveColor}, transparent)`,
          clipPath: 'polygon(0 50%, 100% 30%, 100% 100%, 0% 100%)',
          animation: 'wave 20s ease-in-out infinite'
        }}
      />
      
      {/* Overlay for readability */}
      {showOverlay && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: theme === 'dark' 
              ? 'radial-gradient(circle at center, transparent 0%, rgba(0, 0, 0, 0.03) 100%)'
              : 'radial-gradient(circle at center, transparent 0%, rgba(255, 255, 255, 0.02) 100%)',
            pointerEvents: 'none'
          }}
        />
      )}
      
      {/* CSS Animations */}
      <style jsx>{`
        @keyframes float-0 {
          0%, 100% { 
            transform: translateY(0px) rotate(0deg); 
          }
          25% { 
            transform: translateY(-20px) rotate(5deg); 
          }
          50% { 
            transform: translateY(-10px) rotate(-3deg); 
          }
          75% { 
            transform: translateY(-25px) rotate(7deg); 
          }
        }
        
        @keyframes float-1 {
          0%, 100% { 
            transform: translateX(0px) translateY(0px) rotate(0deg); 
          }
          25% { 
            transform: translateX(15px) translateY(-15px) rotate(-5deg); 
          }
          50% { 
            transform: translateX(-5px) translateY(-20px) rotate(3deg); 
          }
          75% { 
            transform: translateX(10px) translateY(-5px) rotate(-7deg); 
          }
        }
        
        @keyframes float-2 {
          0%, 100% { 
            transform: translateX(0px) translateY(0px) rotate(0deg); 
          }
          33% { 
            transform: translateX(-10px) translateY(-18px) rotate(4deg); 
          }
          66% { 
            transform: translateX(12px) translateY(-8px) rotate(-6deg); 
          }
        }
        
        @keyframes drift {
          0% { 
            transform: translateY(100vh) translateX(0px); 
            opacity: 0; 
          }
          10% { 
            opacity: 1; 
          }
          90% { 
            opacity: 1; 
          }
          100% { 
            transform: translateY(-100px) translateX(50px); 
            opacity: 0; 
          }
        }
        
        @keyframes wave {
          0%, 100% { 
            clip-path: polygon(0 50%, 100% 30%, 100% 100%, 0% 100%); 
          }
          25% { 
            clip-path: polygon(0 40%, 100% 50%, 100% 100%, 0% 100%); 
          }
          50% { 
            clip-path: polygon(0 60%, 100% 20%, 100% 100%, 0% 100%); 
          }
          75% { 
            clip-path: polygon(0 30%, 100% 40%, 100% 100%, 0% 100%); 
          }
        }
        
        .css-animated-background {
          contain: layout style paint;
        }
        
        @media (prefers-reduced-motion: reduce) {
          .floating-token,
          .floating-particle,
          .price-wave {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  )
}