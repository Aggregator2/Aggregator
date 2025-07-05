import React from 'react';
import { useTrades } from '../../hooks/useEnhancedWebSocket';
import styled from 'styled-components';
import { format } from 'date-fns';

const TradesContainer = styled.div`
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

const TradesSection = styled.div`
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

const HeaderRow = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  padding: 8px 16px;
  font-size: 11px;
  color: #888;
  font-weight: 500;
  text-transform: uppercase;
  border-bottom: 1px solid #333;
  position: sticky;
  top: 0;
  background: #1a1a1a;
  z-index: 1;
`;

const TradeRow = styled.div<{ side: 'BUY' | 'SELL'; isNew?: boolean }>`
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  padding: 6px 16px;
  font-size: 12px;
  color: #fff;
  animation: ${props => props.isNew ? 'flash 0.5s ease-out' : 'none'};
  
  &:hover {
    background: rgba(255, 255, 255, 0.05);
  }
  
  @keyframes flash {
    0% {
      background: ${props => props.side === 'BUY' 
        ? 'rgba(0, 255, 136, 0.3)' 
        : 'rgba(255, 68, 68, 0.3)'};
    }
    100% {
      background: transparent;
    }
  }
`;

const Price = styled.span<{ side: 'BUY' | 'SELL' }>`
  color: ${props => props.side === 'BUY' ? '#00ff88' : '#ff4444'};
  font-weight: 500;
`;

const TimeStamp = styled.span`
  color: #888;
  font-size: 11px;
`;

const LoadingMessage = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #666;
  font-size: 14px;
`;

const Stats = styled.div`
  padding: 12px 16px;
  border-top: 1px solid #333;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  font-size: 12px;
`;

const StatItem = styled.div`
  display: flex;
  justify-content: space-between;
  
  span:first-child {
    color: #888;
  }
  
  span:last-child {
    color: #fff;
    font-weight: 500;
  }
`;

interface RecentTradesWidgetProps {
  pair: string;
  limit?: number;
  showStats?: boolean;
}

export const RecentTradesWidget: React.FC<RecentTradesWidgetProps> = ({ 
  pair, 
  limit = 50,
  showStats = true 
}) => {
  const { trades, loading } = useTrades(pair, limit);
  const [newTradeIds, setNewTradeIds] = React.useState<Set<string>>(new Set());

  // Track new trades for animation
  React.useEffect(() => {
    if (trades.length > 0) {
      const latestTradeId = trades[0].id;
      if (!newTradeIds.has(latestTradeId)) {
        setNewTradeIds(new Set([latestTradeId]));
        setTimeout(() => {
          setNewTradeIds(new Set());
        }, 500);
      }
    }
  }, [trades]);

  // Calculate stats
  const stats = React.useMemo(() => {
    if (!trades.length) {
      return { buyVolume: 0, sellVolume: 0, avgPrice: 0, totalVolume: 0 };
    }

    let buyVolume = 0;
    let sellVolume = 0;
    let totalValue = 0;
    let totalVolume = 0;

    trades.forEach(trade => {
      const volume = trade.quantity;
      const value = trade.price * trade.quantity;
      
      if (trade.takerSide === 'BUY') {
        buyVolume += volume;
      } else {
        sellVolume += volume;
      }
      
      totalVolume += volume;
      totalValue += value;
    });

    const avgPrice = totalVolume > 0 ? totalValue / totalVolume : 0;

    return { buyVolume, sellVolume, avgPrice, totalVolume };
  }, [trades]);

  // Format time
  const formatTime = (timestamp: number): string => {
    return format(new Date(timestamp), 'HH:mm:ss');
  };

  // Format price
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
      <TradesContainer>
        <Header>
          <Title>Recent Trades - {pair}</Title>
        </Header>
        <LoadingMessage>Loading trades...</LoadingMessage>
      </TradesContainer>
    );
  }

  return (
    <TradesContainer>
      <Header>
        <Title>Recent Trades - {pair}</Title>
      </Header>
      
      <HeaderRow>
        <span>Price</span>
        <span style={{ textAlign: 'right' }}>Size</span>
        <span style={{ textAlign: 'right' }}>Time</span>
      </HeaderRow>
      
      <TradesSection>
        {trades.map((trade) => (
          <TradeRow 
            key={trade.id} 
            side={trade.takerSide}
            isNew={newTradeIds.has(trade.id)}
          >
            <Price side={trade.takerSide}>{formatPrice(trade.price)}</Price>
            <span style={{ textAlign: 'right' }}>{formatQuantity(trade.quantity)}</span>
            <TimeStamp style={{ textAlign: 'right' }}>
              {formatTime(trade.timestamp)}
            </TimeStamp>
          </TradeRow>
        ))}
      </TradesSection>
      
      {showStats && (
        <Stats>
          <StatItem>
            <span>Buy Vol</span>
            <span style={{ color: '#00ff88' }}>{formatQuantity(stats.buyVolume)}</span>
          </StatItem>
          <StatItem>
            <span>Sell Vol</span>
            <span style={{ color: '#ff4444' }}>{formatQuantity(stats.sellVolume)}</span>
          </StatItem>
          <StatItem>
            <span>Avg Price</span>
            <span>{formatPrice(stats.avgPrice)}</span>
          </StatItem>
          <StatItem>
            <span>Total Vol</span>
            <span>{formatQuantity(stats.totalVolume)}</span>
          </StatItem>
        </Stats>
      )}
    </TradesContainer>
  );
};