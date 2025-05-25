import React from 'react';

interface SwapConfirmModalProps {
  doTrade: () => void;
  recipient: string | null;
  priceImpact: number;
  inputCurrencyInfo: any;
  outputCurrencyInfo: any;
}

export function SwapConfirmModal({
  doTrade,
  recipient,
  priceImpact,
  inputCurrencyInfo,
  outputCurrencyInfo,
}: SwapConfirmModalProps) {
  return (
    <div>
      <h3>Confirm Swap</h3>
      <p>Recipient: {recipient || 'None'}</p>
      <p>Price Impact: {priceImpact}%</p>
      <p>Input: {JSON.stringify(inputCurrencyInfo)}</p>
      <p>Output: {JSON.stringify(outputCurrencyInfo)}</p>
      <button onClick={doTrade}>Confirm</button>
    </div>
  );
}