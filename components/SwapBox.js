// SwapBox logic
// components/SwapBox.js
import { useState } from 'react';
import { ethers } from 'ethers';

export default function SwapBox({ account }) {
  const [fromToken, setFromToken] = useState('ETH');
  const [toToken, setToToken] = useState('DAI');
  const [amount, setAmount] = useState('');
  const [bestQuote, setBestQuote] = useState(null);

  const getQuotes = async () => {
    if (!amount || !account) return;
    try {
      // Fetch 0x quote (Arbitrum endpoint)
      const zeroXRes = await fetch(
        `https://arbitrum.api.0x.org/swap/v1/quote?sellToken=${fromToken}&buyToken=${toToken}&sellAmount=${amount}`
      );
      const zeroX = await zeroXRes.json();
      const zeroXPrice = zeroX.price ? parseFloat(zeroX.price) : null;
      const zeroXQuote = { source: '0x', price: zeroXPrice, amount: parseFloat(zeroX.buyAmount) };

      // Only use 0x quote
      setBestQuote(zeroXQuote);
    } catch (err) {
      console.error('Quote error', err);
    }
  };

  const handleSwitch = () => {
    setFromToken(prev => {
      setToToken(prev);
      return toToken;
    });
    // sellAmount stays the same, so useEffect will trigger fetchQuote
  };

  const buyAmount = bestQuote?.amount
    ? ethers.utils.formatUnits(bestQuote.amount, 18)
    : "0";

  const sellUsd = amount && bestQuote?.price
    ? (parseFloat(amount) * bestQuote.price).toLocaleString(undefined, { maximumFractionDigits: 2 })
    : null;

  const buyUsd = buyAmount && bestQuote?.price
    ? (parseFloat(buyAmount) * bestQuote.price).toLocaleString(undefined, { maximumFractionDigits: 2 })
    : null;

  return (
    <div className="max-w-md mx-auto p-6 bg-white shadow rounded">
      <h2 className="text-xl font-semibold mb-4">Get Best Quote</h2>
      <div className="flex space-x-2 mb-4">
        <select value={fromToken} onChange={e => setFromToken(e.target.value)} className="border p-2 rounded flex-grow">
          <option>ETH</option>
          <option>BTC</option>
        </select>
        <select value={toToken} onChange={e => setToToken(e.target.value)} className="border p-2 rounded flex-grow">
          <option>DAI</option>
          <option>USDC</option>
        </select>
      </div>
      <input
        type="number"
        placeholder="Amount"
        value={amount}
        onChange={e => setAmount(e.target.value)}
        className="border p-2 rounded w-full mb-4"
      />
      <button
        onClick={getQuotes}
        disabled={!account}
        className={`w-full py-2 rounded mb-4 ${account ? 'bg-blue-600 text-white' : 'bg-gray-300 text-gray-600'}`}
      >
        {account ? 'Get Quotes' : 'Connect Wallet to Continue'}
      </button>
      {bestQuote && (
        <div className="mt-4 p-4 bg-gray-100 rounded">
          <h3 className="font-medium">Best Price Found</h3>
          <p>
            {buyAmount} {toToken} for {amount} {fromToken} ({bestQuote.source})
          </p>
          <p className="text-green-700 font-semibold">Price: {bestQuote.price}</p>
          {bestQuote.source !== 'CoW Swap' && (
            <div className="mt-2 inline-block px-2 py-1 bg-yellow-200 text-yellow-800 text-sm rounded">
              Auto on-chain fallback if needed
            </div>
          )}
        </div>
      )}
      {bestQuote && (
        <button className="mt-4 w-full bg-green-600 text-white py-2 rounded">
          Execute Trade
        </button>
      )}
      <button
        className="mt-4 w-full py-2 rounded bg-gray-200 text-gray-700"
        onClick={handleSwitch}
        type="button"
        title="Swap tokens"
        aria-label="Swap tokens"
      >
        <span style={{ fontSize: 22, color: "#2563eb", lineHeight: 1 }}>⇅</span>
      </button>
      <div className="flex justify-between text-sm text-gray-500 mt-2">
        <div className="text-right">
          Sell Value: <span className="font-medium">{sellUsd ? `$${sellUsd}` : "$0.00"}</span>
        </div>
        <div className="text-right">
          Buy Value: <span className="font-medium">{buyUsd ? `$${buyUsd}` : "$0.00"}</span>
        </div>
      </div>
    </div>
  );
}
