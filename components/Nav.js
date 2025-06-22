// Nav component - simplified, no wallet connection button
export default function Nav({ account, connectWallet }) {
  return (
    <nav style={{ 
      backgroundColor: 'transparent', 
      padding: '16px 24px', 
      color: '#fff', 
      display: 'flex', 
      justifyContent: 'center',
      alignItems: 'center',
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      zIndex: 50
    }}>
      <div style={{ fontSize: '20px', fontWeight: '700' }}>Meta Aggregator</div>
    </nav>
  );
}
