import { useState } from 'react';

const USDC = {
  address: '0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  symbol: 'USDC',
  decimals: 6,
  name: 'USD Coin',
  logoURI: 'https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png',
};

const DAI = {
  address: '0x6b175474e89094c44da98b954eedeac495271d0f',
  symbol: 'DAI',
  decimals: 18,
  name: 'Dai Stablecoin',
  logoURI: 'https://assets.coingecko.com/coins/images/9956/small/4943.png',
};

export function useSwapSettings() {
  const [showRecipient, setShowRecipient] = useState(false);
  return { showRecipient, setShowRecipient };
}

export function useSwapDeadlineState() {
  const [deadline, setDeadline] = useState(20); // Example default deadline
  return [deadline, setDeadline];
}

export function useSwapRecipientToggleState() {
  const [recipient, setRecipient] = useState('');
  return [recipient, setRecipient];
}

export function useSwapDerivedState() {
  const [inputCurrency] = useState(USDC); // Use the predefined USDC object
  const [outputCurrency] = useState(DAI); // Use the predefined DAI object

  const [inputCurrencyAmount] = useState(100); // User is selling 100 USDC
  const [outputCurrencyAmount] = useState(99.5); // User expects to receive 99.5 DAI
  const [inputCurrencyBalance] = useState(1000); // User has 1000 USDC in their wallet
  const [outputCurrencyBalance] = useState(500); // User has 500 DAI in their wallet
  const [inputCurrencyFiatAmount] = useState(100); // $100 worth of USDC
  const [outputCurrencyFiatAmount] = useState(99.5); // $99.5 worth of DAI

  const [recipient] = useState(''); // Default recipient is empty
  const [orderKind] = useState('sell'); // Default order kind is "sell"

  return {
    inputCurrency,
    outputCurrency,
    inputCurrencyAmount,
    outputCurrencyAmount,
    inputCurrencyBalance,
    outputCurrencyBalance,
    inputCurrencyFiatAmount,
    outputCurrencyFiatAmount,
    recipient,
    orderKind,
  };
}

const SwapWidget = () => {
  const {
    inputCurrency,
    outputCurrency,
    inputCurrencyAmount,
    outputCurrencyAmount,
    inputCurrencyBalance,
    outputCurrencyBalance,
    inputCurrencyFiatAmount,
    outputCurrencyFiatAmount,
    recipient,
    orderKind,
  } = useSwapDerivedState();

  // Use the destructured values here
};