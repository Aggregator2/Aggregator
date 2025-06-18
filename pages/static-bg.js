export default function StaticBG() {
  return (
    <>
      <div style={{ 
        position: 'relative', 
        width: '100vw', 
        height: '100vh',
        overflow: 'hidden',
        background: 'linear-gradient(135deg, #0a0a0b 0%, #121214 50%, #0a0a0b 100%)'
      }}>
        
        {/* Token 1 */}
        <div className="token token-1">₿</div>
        
        {/* Token 2 */}
        <div className="token token-2">Ξ</div>
        
        {/* Token 3 */}
        <div className="token token-3">◊</div>
        
        {/* Token 4 */}
        <div className="token token-4">◯</div>
        
        {/* Token 5 */}
        <div className="token token-5">⟐</div>
        
        {/* Particles */}
        <div className="particle particle-1"></div>
        <div className="particle particle-2"></div>
        <div className="particle particle-3"></div>
        <div className="particle particle-4"></div>
        <div className="particle particle-5"></div>
        <div className="particle particle-6"></div>
        <div className="particle particle-7"></div>
        <div className="particle particle-8"></div>

        {/* Content */}
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
            backdropFilter: 'blur(15px)',
            padding: '40px',
            borderRadius: '20px',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            color: 'white',
            textAlign: 'center',
            maxWidth: '500px'
          }}>
            <h1 style={{ marginTop: 0, fontSize: '28px' }}>🎉 Static Animated Background</h1>
            <p style={{ fontSize: '16px', lineHeight: '1.6' }}>
              This is a pure CSS animated background with no JavaScript!
            </p>
            <p style={{ fontSize: '14px', opacity: 0.8 }}>
              ✓ No hydration issues<br/>
              ✓ No WebGL required<br/>
              ✓ Works everywhere<br/>
              ✓ Floating crypto tokens<br/>
              ✓ Smooth animations
            </p>
            <div style={{
              marginTop: '30px',
              padding: '15px',
              background: 'rgba(98, 126, 234, 0.1)',
              borderRadius: '10px',
              border: '1px solid rgba(98, 126, 234, 0.2)'
            }}>
              <strong>Success!</strong> You should see floating tokens around this box.
            </div>
          </div>
        </div>
      </div>

      {/* Global CSS */}
      <style jsx global>{`
        .token {
          position: absolute;
          width: 50px;
          height: 50px;
          background: rgba(98, 126, 234, 0.15);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 24px;
          color: rgba(98, 126, 234, 0.6);
          border: 1px solid rgba(98, 126, 234, 0.1);
        }
        
        .token-1 {
          left: 10%;
          top: 20%;
          animation: float1 8s ease-in-out infinite;
        }
        
        .token-2 {
          left: 80%;
          top: 15%;
          animation: float2 10s ease-in-out infinite;
          animation-delay: 1s;
        }
        
        .token-3 {
          left: 15%;
          top: 70%;
          animation: float3 9s ease-in-out infinite;
          animation-delay: 2s;
        }
        
        .token-4 {
          left: 85%;
          top: 75%;
          animation: float1 11s ease-in-out infinite;
          animation-delay: 3s;
        }
        
        .token-5 {
          left: 50%;
          top: 10%;
          animation: float2 7s ease-in-out infinite;
          animation-delay: 1.5s;
        }
        
        .particle {
          position: absolute;
          width: 3px;
          height: 3px;
          background: rgba(98, 126, 234, 0.3);
          border-radius: 50%;
        }
        
        .particle-1 {
          left: 20%;
          top: 110%;
          animation: drift 15s linear infinite;
        }
        
        .particle-2 {
          left: 40%;
          top: 110%;
          animation: drift 18s linear infinite;
          animation-delay: 2s;
        }
        
        .particle-3 {
          left: 60%;
          top: 110%;
          animation: drift 12s linear infinite;
          animation-delay: 4s;
        }
        
        .particle-4 {
          left: 80%;
          top: 110%;
          animation: drift 16s linear infinite;
          animation-delay: 1s;
        }
        
        .particle-5 {
          left: 30%;
          top: 110%;
          animation: drift 14s linear infinite;
          animation-delay: 3s;
        }
        
        .particle-6 {
          left: 70%;
          top: 110%;
          animation: drift 13s linear infinite;
          animation-delay: 5s;
        }
        
        .particle-7 {
          left: 10%;
          top: 110%;
          animation: drift 17s linear infinite;
          animation-delay: 6s;
        }
        
        .particle-8 {
          left: 90%;
          top: 110%;
          animation: drift 11s linear infinite;
          animation-delay: 2.5s;
        }
        
        @keyframes float1 {
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
        
        @keyframes float2 {
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
        
        @keyframes float3 {
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
            transform: translateY(0px) translateX(0px); 
            opacity: 0; 
          }
          10% { 
            opacity: 1; 
          }
          90% { 
            opacity: 1; 
          }
          100% { 
            transform: translateY(-120vh) translateX(50px); 
            opacity: 0; 
          }
        }
        
        @media (prefers-reduced-motion: reduce) {
          .token,
          .particle {
            animation: none !important;
          }
        }
      `}</style>
    </>
  );
}