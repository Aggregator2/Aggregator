import Link from 'next/link';

// Nav component
export default function Nav({ account, connectWallet }) {
  return (
    <div style={{ backgroundColor: '#000', padding: '10px', color: '#fff', display: 'flex', justifyContent: 'space-between' }}>
      <div>Meta Aggregator</div>
      <div>
        {account ? (
          <span>{account.substring(0, 6)}...{account.slice(-4)}</span>
        ) : (
          <button onClick={connectWallet} style={{ backgroundColor: '#00BCD4', color: '#fff', padding: '10px', border: 'none', borderRadius: '5px' }}>
            Connect Wallet
          </button>
        )}
      </div>
    </div>
  );
}
