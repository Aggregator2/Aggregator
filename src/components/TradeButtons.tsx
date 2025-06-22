// TradeButtons Component
import React from 'react';

interface TradeButtonsProps {
  onBuy: () => void;
  onSell: () => void;
}

export const TradeButtons: React.FC<TradeButtonsProps> = ({ onBuy, onSell }) => {
  return (
    <div className='trade-buttons'>
      <button onClick={onBuy}>Buy</button>
      <button onClick={onSell}>Sell</button>
    </div>
  );
};