import React from 'react';

export interface EthFlowProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function EthFlowModal({ isOpen, onClose, onConfirm }: EthFlowProps) {
  if (!isOpen) return null;

  return (
    <div>
      <h3>ETH Flow Modal</h3>
      <p>Confirm your ETH transaction.</p>
      <button onClick={onConfirm}>Confirm</button>
      <button onClick={onClose}>Cancel</button>
    </div>
  );
}