import React, { useMemo } from 'react';
import { useOrderBook } from '../../hooks/useEnhancedWebSocket';
import styled from 'styled-components';

const OrderBookContainer = styled.div`
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #1a1a1a;
  border-radius: 8px;
  overflow: hidden;
`;

const Header = styled.div`
  padding: 12px 16px;
  border-bottom: 1px solid #333;
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

const Title = styled.h3`
  margin: 0;
  font-size: 16px;
  color: #fff;
`;

const ConnectionStatus = styled.div<{ connected: boolean }>`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${props => props.connected ? '#00ff88' : '#ff4444'};
`;

const BookContainer = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const Section = styled.div`
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  
  &::-webkit-scrollbar {
    width: 4px;
  }
  
  &::-webkit-scrollbar-track {
    background: #1a1a1a;
  }
  
  &::-webkit-scrollbar-thumb {
    background: #444;
    border-radius: 2px;
  }
`;

const OrderRow = styled.div<{ side: 'buy' | 'sell' }>`
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  padding: 4px 16px;
  font-size: 12px;
  color: #fff;
  position: relative;
  
  &:hover {
    background: rgba(255, 255, 255, 0.05);
  }
  
  &::before {
    content: '';
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    background: ${props => props.side === 'buy' 
      ? 'rgba(0, 255, 136, 0.1)' 
      : 'rgba(255, 68, 68, 0.1)'};
    width: var(--depth-width);
    z-index: -1;
  }
`;

const HeaderRow = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  padding: 8px 16px;
  font-size: 11px;
  color: #888;
  font-weight: 500;
  text-transform: uppercase;
  border-bottom: 1px solid #333;
`;

const Price = styled.span<{ side: 'buy' | 'sell' }>`
  color: ${props => props.side === 'buy' ? '#00ff88' : '#ff4444'};
  font-weight: 500;
`;

const SpreadRow = styled.div`
  padding: 8px 16px;
  background: #222;
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: #888;
`;

const LoadingMessage = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #666;
  font-size: 14px;
`;

interface OrderBookWidgetProps {
  pair: string;
  maxRows?: number;
  showSpread?: boolean;
}

export const OrderBookWidget: React.FC<OrderBookWidgetProps> = ({ 
  pair, 
  maxRows = 15,
  showSpread = true 
}) => {
  const { orderBook, loading } = useOrderBook(pair);

  // Calculate spread and max volumes
  const { spread, spreadPercent, maxBidVolume, maxAskVolume } = useMemo(() => {
    if (!orderBook || !orderBook.bids.length || !orderBook.asks.length) {
      return { spread: 0, spreadPercent: 0, maxBidVolume: 0, maxAskVolume: 0 };
    }

    const bestBid = orderBook.bids[0].price;
    const bestAsk = orderBook.asks[0].price;
    const spread = bestAsk - bestBid;
    const spreadPercent = (spread / bestAsk) * 100;

    const maxBidVolume = Math.max(...orderBook.bids.slice(0, maxRows).map((b: any) => b.quantity));
    const maxAskVolume = Math.max(...orderBook.asks.slice(0, maxRows).map((a: any) => a.quantity));

    return { spread, spreadPercent, maxBidVolume, maxAskVolume };
  }, [orderBook, maxRows]);

  // Format price with appropriate decimals
  const formatPrice = (price: number): string => {
    if (price >= 1000) return price.toFixed(2);
    if (price >= 1) return price.toFixed(4);
    return price.toFixed(6);
  };

  // Format quantity
  const formatQuantity = (quantity: number): string => {
    if (quantity >= 1000) return quantity.toFixed(0);
    if (quantity >= 1) return quantity.toFixed(3);
    return quantity.toFixed(6);
  };

  if (loading) {
    return (
      <OrderBookContainer>
        <Header>
          <Title>Order Book - {pair}</Title>
          <ConnectionStatus connected={false} />
        </Header>
        <LoadingMessage>Loading order book...</LoadingMessage>
      </OrderBookContainer>
    );
  }

  if (!orderBook) {
    return (
      <OrderBookContainer>
        <Header>
          <Title>Order Book - {pair}</Title>
          <ConnectionStatus connected={false} />
        </Header>
        <LoadingMessage>No data available</LoadingMessage>
      </OrderBookContainer>
    );
  }

  return (
    <OrderBookContainer>
      <Header>
        <Title>Order Book - {pair}</Title>
        <ConnectionStatus connected={true} />
      </Header>
      
      <BookContainer>
        {/* Asks (Sells) - reversed so best ask is at bottom */}
        <Section>
          <HeaderRow>
            <span>Price</span>
            <span style={{ textAlign: 'right' }}>Size</span>
            <span style={{ textAlign: 'right' }}>Total</span>
          </HeaderRow>
          
          {orderBook.asks
            .slice(0, maxRows)
            .reverse()
            .map((ask: any, index: number) => {
              const depthPercent = (ask.quantity / maxAskVolume) * 100;
              const total = ask.price * ask.quantity;
              
              return (
                <OrderRow 
                  key={`ask-${index}`} 
                  side="sell"
                  style={{ '--depth-width': `${depthPercent}%` } as any}
                >
                  <Price side="sell">{formatPrice(ask.price)}</Price>
                  <span style={{ textAlign: 'right' }}>{formatQuantity(ask.quantity)}</span>
                  <span style={{ textAlign: 'right' }}>{formatPrice(total)}</span>
                </OrderRow>
              );
            })}
        </Section>

        {/* Spread */}
        {showSpread && (
          <SpreadRow>
            <span>Spread</span>
            <span>{formatPrice(spread)} ({spreadPercent.toFixed(2)}%)</span>
          </SpreadRow>
        )}

        {/* Bids (Buys) */}
        <Section>
          {orderBook.bids
            .slice(0, maxRows)
            .map((bid: any, index: number) => {
              const depthPercent = (bid.quantity / maxBidVolume) * 100;
              const total = bid.price * bid.quantity;
              
              return (
                <OrderRow 
                  key={`bid-${index}`} 
                  side="buy"
                  style={{ '--depth-width': `${depthPercent}%` } as any}
                >
                  <Price side="buy">{formatPrice(bid.price)}</Price>
                  <span style={{ textAlign: 'right' }}>{formatQuantity(bid.quantity)}</span>
                  <span style={{ textAlign: 'right' }}>{formatPrice(total)}</span>
                </OrderRow>
              );
            })}
        </Section>
      </BookContainer>
    </OrderBookContainer>
  );
};