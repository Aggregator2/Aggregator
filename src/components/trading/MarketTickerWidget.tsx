import React from 'react';
import { useTicker } from '../../hooks/useEnhancedWebSocket';
import styled from 'styled-components';

const TickerContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 12px 20px;
  background: #1a1a1a;
  border-radius: 8px;
  overflow-x: auto;
  
  &::-webkit-scrollbar {
    height: 4px;
  }
  
  &::-webkit-scrollbar-track {
    background: #1a1a1a;
  }
  
  &::-webkit-scrollbar-thumb {
    background: #444;
    border-radius: 2px;
  }
`;

const TickerItem = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: fit-content;
`;

const Label = styled.div`
  font-size: 11px;
  color: #888;
  text-transform: uppercase;
`;

const Value = styled.div<{ color?: string }>`
  font-size: 14px;
  font-weight: 500;
  color: ${props => props.color || '#fff'};
`;

const PriceChange = styled.div<{ positive: boolean }>`
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: ${props => props.positive ? '#00ff88' : '#ff4444'};
  
  &::before {
    content: ${props => props.positive ? '"▲"' : '"▼"'};
    font-size: 10px;
  }
`;

const Pair = styled.div`
  font-size: 18px;
  font-weight: 600;
  color: #fff;
`;

interface MarketTickerWidgetProps {
  pair: string;
  compact?: boolean;
}

export const MarketTickerWidget: React.FC<MarketTickerWidgetProps> = ({ 
  pair,
  compact = false 
}) => {
  const ticker = useTicker(pair);

  if (!ticker) {
    return (
      <TickerContainer>
        <TickerItem>
          <Label>Loading...</Label>
        </TickerItem>
      </TickerContainer>
    );
  }

  const formatPrice = (price: number): string => {
    if (price >= 1000) return price.toFixed(2);
    if (price >= 1) return price.toFixed(4);
    return price.toFixed(6);
  };

  const formatVolume = (volume: number): string => {
    if (volume >= 1000000) return `${(volume / 1000000).toFixed(2)}M`;
    if (volume >= 1000) return `${(volume / 1000).toFixed(2)}K`;
    return volume.toFixed(2);
  };

  const changePositive = ticker.change24h >= 0;

  if (compact) {
    return (
      <TickerContainer>
        <Pair>{pair}</Pair>
        
        <TickerItem>
          <Value color={changePositive ? '#00ff88' : '#ff4444'}>
            {formatPrice(ticker.lastPrice)}
          </Value>
          <PriceChange positive={changePositive}>
            {Math.abs(ticker.change24h).toFixed(2)}%
          </PriceChange>
        </TickerItem>
        
        <TickerItem>
          <Label>24h Vol</Label>
          <Value>{formatVolume(ticker.volume24h)}</Value>
        </TickerItem>
      </TickerContainer>
    );
  }

  return (
    <TickerContainer>
      <Pair>{pair}</Pair>
      
      <TickerItem>
        <Label>Last Price</Label>
        <Value color={changePositive ? '#00ff88' : '#ff4444'}>
          {formatPrice(ticker.lastPrice)}
        </Value>
      </TickerItem>
      
      <TickerItem>
        <Label>24h Change</Label>
        <PriceChange positive={changePositive}>
          {Math.abs(ticker.change24h).toFixed(2)}%
        </PriceChange>
      </TickerItem>
      
      <TickerItem>
        <Label>24h High</Label>
        <Value>{formatPrice(ticker.high24h)}</Value>
      </TickerItem>
      
      <TickerItem>
        <Label>24h Low</Label>
        <Value>{formatPrice(ticker.low24h)}</Value>
      </TickerItem>
      
      <TickerItem>
        <Label>24h Volume</Label>
        <Value>{formatVolume(ticker.volume24h)}</Value>
      </TickerItem>
      
      <TickerItem>
        <Label>Bid</Label>
        <Value color="#00ff88">{formatPrice(ticker.bidPrice)}</Value>
      </TickerItem>
      
      <TickerItem>
        <Label>Ask</Label>
        <Value color="#ff4444">{formatPrice(ticker.askPrice)}</Value>
      </TickerItem>
    </TickerContainer>
  );
};