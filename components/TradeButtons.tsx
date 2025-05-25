import React from 'react';

interface TradeButtonsProps {
  isTradeContextReady: boolean;
  openNativeWrapModal: () => void;
  hasEnoughWrappedBalanceForSwap: boolean;
}

export function TradeButtons({
  isTradeContextReady,
  openNativeWrapModal,
  hasEnoughWrappedBalanceForSwap,
}: TradeButtonsProps) {
  return (
    <div>
      <button
        onClick={openNativeWrapModal}
        disabled={!isTradeContextReady || !hasEnoughWrappedBalanceForSwap}
      >
        Execute Trade
      </button>
    </div>
  );
}