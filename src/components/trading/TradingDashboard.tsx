import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import { useEnhancedWebSocket } from '../../hooks/useEnhancedWebSocket';
import { OrderBookWidget } from './OrderBookWidget';
import { RecentTradesWidget } from './RecentTradesWidget';
import { MarketTickerWidget } from './MarketTickerWidget';
import { UserOrdersWidget } from './UserOrdersWidget';

const DashboardContainer = styled.div`
  width: 100%;
  height: 100vh;
  background: #0d0d0d;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const TopBar = styled.div`
  background: #1a1a1a;
  border-bottom: 1px solid #333;
  padding: 0 20px;
  min-height: 60px;
  display: flex;
  align-items: center;
  gap: 24px;
`;

const MainContent = styled.div`
  flex: 1;
  display: grid;
  grid-template-columns: 320px 1fr 320px;
  grid-template-rows: 1fr 300px;
  gap: 16px;
  padding: 16px;
  overflow: hidden;
`;

const Panel = styled.div`
  background: #1a1a1a;
  border-radius: 8px;
  overflow: hidden;
`;

const ChartPanel = styled(Panel)`
  grid-column: 2;
  grid-row: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #666;
  font-size: 18px;
`;

const OrdersPanel = styled(Panel)`
  grid-column: 1 / 4;
  grid-row: 2;
`;

const ConnectionIndicator = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  padding: 8px 16px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 6px;
  font-size: 12px;
`;

const StatusDot = styled.div<{ connected: boolean }>`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${props => props.connected ? '#00ff88' : '#ff4444'};
  animation: ${props => props.connected ? 'pulse 2s infinite' : 'none'};
  
  @keyframes pulse {
    0% {
      box-shadow: 0 0 0 0 rgba(0, 255, 136, 0.7);
    }
    70% {
      box-shadow: 0 0 0 10px rgba(0, 255, 136, 0);
    }
    100% {
      box-shadow: 0 0 0 0 rgba(0, 255, 136, 0);
    }
  }
`;

const PairSelector = styled.select`
  background: #222;
  border: 1px solid #333;
  color: #fff;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
  
  &:focus {
    outline: none;
    border-color: #0066ff;
  }
`;

interface TradingDashboardProps {
  authToken?: string;
  wsUrl?: string;
  onCancelOrder?: (orderId: string) => void;
}

export const TradingDashboard: React.FC<TradingDashboardProps> = ({
  authToken,
  wsUrl,
  onCancelOrder
}) => {
  const [selectedPair, setSelectedPair] = useState('ETH/USDC');
  const [availablePairs] = useState(['ETH/USDC', 'BTC/USDC', 'ETH/USDT', 'BTC/USDT']);
  
  const ws = useEnhancedWebSocket({
    url: wsUrl,
    authToken,
    onConnected: () => {
      console.log('WebSocket connected');
    },
    onDisconnected: (reason) => {
      console.log('WebSocket disconnected:', reason);
    },
    onError: (error) => {
      console.error('WebSocket error:', error);
    },
    onAuthenticated: (data) => {
      console.log('WebSocket authenticated:', data);
    }
  });

  // Log connection state changes
  useEffect(() => {
    console.log('WebSocket connection state:', ws.connectionState);
  }, [ws.connectionState]);

  // Subscribe to settlement events
  useEffect(() => {
    if (!ws.isConnected) return;

    const handleEpochStarted = (data: any) => {
      console.log('Settlement epoch started:', data);
    };

    const handleEpochFinalized = (data: any) => {
      console.log('Settlement epoch finalized:', data);
    };

    const handleSettlementConfirmed = (data: any) => {
      console.log('Settlement confirmed:', data);
    };

    ws.on('settlement:epoch:started', handleEpochStarted);
    ws.on('settlement:epoch:finalized', handleEpochFinalized);
    ws.on('settlement:confirmed', handleSettlementConfirmed);

    return () => {
      ws.off('settlement:epoch:started', handleEpochStarted);
      ws.off('settlement:epoch:finalized', handleEpochFinalized);
      ws.off('settlement:confirmed', handleSettlementConfirmed);
    };
  }, [ws.isConnected]);

  return (
    <DashboardContainer>
      <TopBar>
        <PairSelector 
          value={selectedPair} 
          onChange={(e) => setSelectedPair(e.target.value)}
        >
          {availablePairs.map(pair => (
            <option key={pair} value={pair}>{pair}</option>
          ))}
        </PairSelector>
        
        <MarketTickerWidget pair={selectedPair} compact />
        
        <ConnectionIndicator>
          <StatusDot connected={ws.isConnected} />
          <span style={{ color: ws.isConnected ? '#00ff88' : '#ff4444' }}>
            {ws.connectionState}
          </span>
          {ws.isConnected && ws.latency > 0 && (
            <span style={{ color: '#666' }}>({ws.latency}ms)</span>
          )}
        </ConnectionIndicator>
      </TopBar>
      
      <MainContent>
        <Panel>
          <OrderBookWidget pair={selectedPair} />
        </Panel>
        
        <ChartPanel>
          Trading Chart (Not Implemented)
        </ChartPanel>
        
        <Panel>
          <RecentTradesWidget pair={selectedPair} />
        </Panel>
        
        <OrdersPanel>
          <UserOrdersWidget onCancelOrder={onCancelOrder} />
        </OrdersPanel>
      </MainContent>
    </DashboardContainer>
  );
};