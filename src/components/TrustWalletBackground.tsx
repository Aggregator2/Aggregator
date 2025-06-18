import React, { useState, useEffect } from 'react'

interface TrustWalletBackgroundProps {
  theme?: 'light' | 'dark'
  onThemeChange?: (theme: 'light' | 'dark') => void
  showThemeToggle?: boolean
  className?: string
}

export default function TrustWalletBackground({
  theme = 'dark',
  onThemeChange,
  showThemeToggle = true,
  className = ''
}: TrustWalletBackgroundProps) {
  const [currentTheme, setCurrentTheme] = useState(theme)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const handleThemeToggle = () => {
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark'
    setCurrentTheme(newTheme)
    if (onThemeChange) {
      onThemeChange(newTheme)
    }
  }

  if (!mounted) {
    return null // Avoid hydration issues
  }

  return (
    <>
      <div 
        className={`trustwallet-background trustwallet-background--${currentTheme} ${className}`}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          background: currentTheme === 'dark' 
            ? 'linear-gradient(135deg, #0a0a0b 0%, #121214 50%, #0a0a0b 100%)'
            : 'linear-gradient(135deg, #fefefe 0%, #f8fafc 50%, #fefefe 100%)',
          overflow: 'hidden',
          pointerEvents: 'none',
          zIndex: 0
        }}
      >
        {/* Bitcoin Tokens */}
        <div className={`token token-btc-1 ${currentTheme}`}>
          <img 
            src="https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/bitcoin/info/logo.png" 
            alt="Bitcoin" 
          />
        </div>
        <div className={`token token-btc-2 ${currentTheme}`}>
          <img 
            src="https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/bitcoin/info/logo.png" 
            alt="Bitcoin" 
          />
        </div>

        {/* Ethereum Tokens */}
        <div className={`token token-eth-1 ${currentTheme}`}>
          <img 
            src="https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png" 
            alt="Ethereum" 
          />
        </div>
        <div className={`token token-eth-2 ${currentTheme}`}>
          <img 
            src="https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png" 
            alt="Ethereum" 
          />
        </div>

        {/* Solana Tokens */}
        <div className={`token token-sol-1 ${currentTheme}`}>
          <img 
            src="https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/info/logo.png" 
            alt="Solana" 
          />
        </div>
        <div className={`token token-sol-2 ${currentTheme}`}>
          <img 
            src="https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/info/logo.png" 
            alt="Solana" 
          />
        </div>

        {/* Cardano Tokens */}
        <div className={`token token-ada-1 ${currentTheme}`}>
          <img 
            src="https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/cardano/info/logo.png" 
            alt="Cardano" 
          />
        </div>
        <div className={`token token-ada-2 ${currentTheme}`}>
          <img 
            src="https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/cardano/info/logo.png" 
            alt="Cardano" 
          />
        </div>

        {/* Floating Particles */}
        {Array.from({ length: 12 }, (_, i) => (
          <div key={i} className={`particle particle-${i + 1} ${currentTheme}`} />
        ))}

        {/* Animated Wave */}
        <div className="wave-container">
          <div className={`wave ${currentTheme}`} />
        </div>
      </div>

      {/* Theme Toggle Switch */}
      {showThemeToggle && (
        <div 
          className="theme-toggle-container"
          style={{
            position: 'fixed',
            top: '20px',
            right: '20px',
            zIndex: 100,
            pointerEvents: 'auto'
          }}
        >
          <div 
            className={`theme-toggle ${currentTheme}`}
            onClick={handleThemeToggle}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 12px',
              background: currentTheme === 'dark' 
                ? 'rgba(255, 255, 255, 0.1)' 
                : 'rgba(0, 0, 0, 0.1)',
              backdropFilter: 'blur(10px)',
              borderRadius: '20px',
              border: `1px solid ${currentTheme === 'dark' ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.2)'}`,
              cursor: 'pointer',
              transition: 'all 0.3s ease',
              userSelect: 'none'
            }}
          >
            <span style={{
              fontSize: '16px',
              transition: 'all 0.3s ease',
              opacity: currentTheme === 'dark' ? 0.5 : 1
            }}>
              ☀️
            </span>
            
            <div style={{
              width: '40px',
              height: '20px',
              background: currentTheme === 'dark' 
                ? 'linear-gradient(135deg, #4f46e5, #7c3aed)' 
                : 'linear-gradient(135deg, #f59e0b, #f97316)',
              borderRadius: '10px',
              position: 'relative',
              transition: 'all 0.3s ease'
            }}>
              <div style={{
                width: '16px',
                height: '16px',
                background: 'white',
                borderRadius: '50%',
                position: 'absolute',
                top: '2px',
                left: currentTheme === 'dark' ? '22px' : '2px',
                transition: 'all 0.3s ease',
                boxShadow: '0 2px 4px rgba(0, 0, 0, 0.2)'
              }} />
            </div>
            
            <span style={{
              fontSize: '16px',
              transition: 'all 0.3s ease',
              opacity: currentTheme === 'dark' ? 1 : 0.5
            }}>
              🌙
            </span>
          </div>
        </div>
      )}

      {/* CSS Styles */}
      <style jsx>{`
        .token {
          position: absolute;
          width: 70px;
          height: 70px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 2px solid;
          backdrop-filter: blur(10px);
          overflow: hidden;
          transition: all 0.3s ease;
        }

        .token.dark {
          background: rgba(255, 255, 255, 0.08);
          border-color: rgba(255, 255, 255, 0.15);
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        }

        .token.light {
          background: rgba(255, 255, 255, 0.9);
          border-color: rgba(0, 0, 0, 0.1);
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
        }

        .token img {
          width: 45px;
          height: 45px;
          border-radius: 50%;
          object-fit: cover;
        }

        /* Token Positions */
        .token-btc-1 {
          left: 8%;
          top: 15%;
          animation: float1 14s ease-in-out infinite;
        }

        .token-eth-1 {
          left: 85%;
          top: 20%;
          animation: float2 16s ease-in-out infinite;
          animation-delay: 2s;
        }

        .token-sol-1 {
          left: 12%;
          top: 70%;
          animation: float3 12s ease-in-out infinite;
          animation-delay: 4s;
        }

        .token-ada-1 {
          left: 88%;
          top: 75%;
          animation: float1 18s ease-in-out infinite;
          animation-delay: 1s;
        }

        .token-btc-2 {
          left: 50%;
          top: 8%;
          animation: float2 13s ease-in-out infinite;
          animation-delay: 3s;
        }

        .token-eth-2 {
          left: 25%;
          top: 40%;
          animation: float3 15s ease-in-out infinite;
          animation-delay: 0.5s;
        }

        .token-sol-2 {
          left: 75%;
          top: 45%;
          animation: float1 11s ease-in-out infinite;
          animation-delay: 5s;
        }

        .token-ada-2 {
          left: 45%;
          top: 80%;
          animation: float2 17s ease-in-out infinite;
          animation-delay: 2.5s;
        }

        .particle {
          position: absolute;
          width: 4px;
          height: 4px;
          border-radius: 50%;
          box-shadow: 0 0 10px rgba(98, 126, 234, 0.4);
        }

        .particle.dark {
          background: rgba(98, 126, 234, 0.6);
        }

        .particle.light {
          background: rgba(79, 70, 229, 0.4);
          box-shadow: 0 0 10px rgba(79, 70, 229, 0.3);
        }

        .particle-1 { left: 15%; animation: drift 20s linear infinite; }
        .particle-2 { left: 35%; animation: drift 24s linear infinite; animation-delay: 3s; }
        .particle-3 { left: 55%; animation: drift 18s linear infinite; animation-delay: 6s; }
        .particle-4 { left: 75%; animation: drift 22s linear infinite; animation-delay: 2s; }
        .particle-5 { left: 25%; animation: drift 21s linear infinite; animation-delay: 8s; }
        .particle-6 { left: 65%; animation: drift 19s linear infinite; animation-delay: 4s; }
        .particle-7 { left: 5%; animation: drift 23s linear infinite; animation-delay: 7s; }
        .particle-8 { left: 85%; animation: drift 17s linear infinite; animation-delay: 1s; }
        .particle-9 { left: 45%; animation: drift 25s linear infinite; animation-delay: 5s; }
        .particle-10 { left: 95%; animation: drift 16s linear infinite; animation-delay: 9s; }
        .particle-11 { left: 8%; animation: drift 26s linear infinite; animation-delay: 3.5s; }
        .particle-12 { left: 92%; animation: drift 15s linear infinite; animation-delay: 6.5s; }

        .wave-container {
          position: absolute;
          bottom: 0;
          left: 0;
          width: 100%;
          height: 120px;
          overflow: hidden;
        }

        .wave {
          position: absolute;
          bottom: 0;
          left: 0;
          width: 200%;
          height: 100px;
          clip-path: polygon(0 60%, 100% 40%, 100% 100%, 0% 100%);
          animation: waveMove 25s ease-in-out infinite;
        }

        .wave.dark {
          background: linear-gradient(45deg, transparent, rgba(98, 126, 234, 0.08), transparent);
        }

        .wave.light {
          background: linear-gradient(45deg, transparent, rgba(79, 70, 229, 0.06), transparent);
        }

        .theme-toggle:hover {
          transform: scale(1.05);
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
        }

        @keyframes float1 {
          0%, 100% { transform: translateY(0px) rotate(0deg) scale(1); }
          25% { transform: translateY(-30px) rotate(10deg) scale(1.05); }
          50% { transform: translateY(-20px) rotate(-6deg) scale(0.95); }
          75% { transform: translateY(-35px) rotate(15deg) scale(1.1); }
        }

        @keyframes float2 {
          0%, 100% { transform: translateX(0px) translateY(0px) rotate(0deg) scale(1); }
          25% { transform: translateX(25px) translateY(-25px) rotate(-10deg) scale(0.9); }
          50% { transform: translateX(-15px) translateY(-30px) rotate(8deg) scale(1.1); }
          75% { transform: translateX(20px) translateY(-15px) rotate(-12deg) scale(0.95); }
        }

        @keyframes float3 {
          0%, 100% { transform: translateX(0px) translateY(0px) rotate(0deg) scale(1); }
          33% { transform: translateX(-20px) translateY(-25px) rotate(9deg) scale(1.05); }
          66% { transform: translateX(22px) translateY(-18px) rotate(-11deg) scale(0.9); }
        }

        @keyframes drift {
          0% { 
            transform: translateY(100vh) translateX(0px); 
            opacity: 0; 
          }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { 
            transform: translateY(-10vh) translateX(70px); 
            opacity: 0; 
          }
        }

        @keyframes waveMove {
          0%, 100% { 
            transform: translateX(-50%) scaleY(1);
            clip-path: polygon(0 60%, 100% 40%, 100% 100%, 0% 100%); 
          }
          25% { 
            transform: translateX(-45%) scaleY(1.3);
            clip-path: polygon(0 50%, 100% 60%, 100% 100%, 0% 100%); 
          }
          50% { 
            transform: translateX(-40%) scaleY(0.7);
            clip-path: polygon(0 70%, 100% 30%, 100% 100%, 0% 100%); 
          }
          75% { 
            transform: translateX(-35%) scaleY(1.2);
            clip-path: polygon(0 40%, 100% 50%, 100% 100%, 0% 100%); 
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .token, .particle, .wave {
            animation: none !important;
          }
        }

        @media (max-width: 768px) {
          .token {
            width: 60px;
            height: 60px;
          }
          
          .token img {
            width: 35px;
            height: 35px;
          }

          .theme-toggle-container {
            top: 10px !important;
            right: 10px !important;
          }
        }
      `}</style>
    </>
  )
}