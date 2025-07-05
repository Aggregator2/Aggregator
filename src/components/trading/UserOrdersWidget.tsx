import React, { useState } from 'react';
import { useUserOrders } from '../../hooks/useEnhancedWebSocket';
import styled from 'styled-components';
import { format } from 'date-fns';

const Container = styled.div`
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
`;

const Title = styled.h3`
  margin: 0 0 8px 0;
  font-size: 16px;
  color: #fff;
`;

const TabContainer = styled.div`
  display: flex;
  gap: 16px;
`;

const Tab = styled.button<{ active: boolean }>`
  background: none;
  border: none;
  padding: 8px 0;
  font-size: 14px;
  color: ${props => props.active ? '#fff' : '#666'};
  border-bottom: 2px solid ${props => props.active ? '#0066ff' : 'transparent'};
  cursor: pointer;
  transition: all 0.2s;
  
  &:hover {
    color: #fff;
  }
`;

const OrdersSection = styled.div`
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

const Table = styled.table`
  width: 100%;
  font-size: 12px;
`;

const TableHeader = styled.thead`
  position: sticky;
  top: 0;
  background: #1a1a1a;
  z-index: 1;
  
  th {
    padding: 8px 16px;
    text-align: left;
    color: #888;
    font-weight: 500;
    text-transform: uppercase;
    font-size: 11px;
    border-bottom: 1px solid #333;
  }
`;

const TableRow = styled.tr`
  &:hover {
    background: rgba(255, 255, 255, 0.05);
  }
  
  td {
    padding: 8px 16px;
    color: #fff;
    border-bottom: 1px solid #222;
  }
`;

const Side = styled.span<{ side: 'BUY' | 'SELL' }>`
  color: ${props => props.side === 'BUY' ? '#00ff88' : '#ff4444'};
  font-weight: 500;
`;

const Status = styled.span<{ status: string }>`
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
  background: ${props => {
    switch (props.status) {
      case 'OPEN': return 'rgba(0, 102, 255, 0.2)';
      case 'PARTIALLY_FILLED': return 'rgba(255, 170, 0, 0.2)';
      case 'FILLED': return 'rgba(0, 255, 136, 0.2)';
      case 'CANCELLED': return 'rgba(255, 68, 68, 0.2)';
      default: return 'rgba(136, 136, 136, 0.2)';
    }
  }};
  color: ${props => {
    switch (props.status) {
      case 'OPEN': return '#0066ff';
      case 'PARTIALLY_FILLED': return '#ffaa00';
      case 'FILLED': return '#00ff88';
      case 'CANCELLED': return '#ff4444';
      default: return '#888';
    }
  }};
`;

const CancelButton = styled.button`
  background: none;
  border: 1px solid #ff4444;
  color: #ff4444;
  padding: 4px 12px;
  border-radius: 4px;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.2s;
  
  &:hover {
    background: #ff4444;
    color: #fff;
  }
  
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const EmptyState = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: #666;
  font-size: 14px;
`;

interface UserOrdersWidgetProps {
  onCancelOrder?: (orderId: string) => void;
}

export const UserOrdersWidget: React.FC<UserOrdersWidgetProps> = ({ 
  onCancelOrder 
}) => {
  const { openOrders, orderHistory, loading } = useUserOrders();
  const [activeTab, setActiveTab] = useState<'open' | 'history'>('open');
  const [cancellingOrders, setCancellingOrders] = useState<Set<string>>(new Set());

  const handleCancelOrder = async (orderId: string) => {
    if (!onCancelOrder) return;
    
    setCancellingOrders(prev => new Set(prev).add(orderId));
    try {
      await onCancelOrder(orderId);
    } catch (error) {
      console.error('Failed to cancel order:', error);
    } finally {
      setCancellingOrders(prev => {
        const next = new Set(prev);
        next.delete(orderId);
        return next;
      });
    }
  };

  const formatTime = (timestamp: number): string => {
    return format(new Date(timestamp), 'MM/dd HH:mm:ss');
  };

  const formatPrice = (price: number): string => {
    if (price >= 1000) return price.toFixed(2);
    if (price >= 1) return price.toFixed(4);
    return price.toFixed(6);
  };

  const formatQuantity = (quantity: number): string => {
    if (quantity >= 1000) return quantity.toFixed(0);
    if (quantity >= 1) return quantity.toFixed(3);
    return quantity.toFixed(6);
  };

  const orders = activeTab === 'open' ? openOrders : orderHistory;

  if (loading) {
    return (
      <Container>
        <Header>
          <Title>My Orders</Title>
        </Header>
        <EmptyState>Loading orders...</EmptyState>
      </Container>
    );
  }

  return (
    <Container>
      <Header>
        <Title>My Orders</Title>
        <TabContainer>
          <Tab 
            active={activeTab === 'open'} 
            onClick={() => setActiveTab('open')}
          >
            Open Orders ({openOrders.length})
          </Tab>
          <Tab 
            active={activeTab === 'history'} 
            onClick={() => setActiveTab('history')}
          >
            Order History
          </Tab>
        </TabContainer>
      </Header>
      
      <OrdersSection>
        {orders.length === 0 ? (
          <EmptyState>
            {activeTab === 'open' ? 'No open orders' : 'No order history'}
          </EmptyState>
        ) : (
          <Table>
            <TableHeader>
              <tr>
                <th>Time</th>
                <th>Pair</th>
                <th>Type</th>
                <th>Side</th>
                <th>Price</th>
                <th>Amount</th>
                <th>Filled</th>
                <th>Status</th>
                {activeTab === 'open' && <th>Action</th>}
              </tr>
            </TableHeader>
            <tbody>
              {orders.map(order => (
                <TableRow key={order.id}>
                  <td>{formatTime(order.timestamp)}</td>
                  <td>{order.pair}</td>
                  <td>{order.type}</td>
                  <td>
                    <Side side={order.side}>{order.side}</Side>
                  </td>
                  <td>{formatPrice(order.price)}</td>
                  <td>{formatQuantity(order.quantity)}</td>
                  <td>
                    {formatQuantity(order.filledQuantity)} 
                    ({((order.filledQuantity / order.quantity) * 100).toFixed(1)}%)
                  </td>
                  <td>
                    <Status status={order.status}>
                      {order.status.replace('_', ' ')}
                    </Status>
                  </td>
                  {activeTab === 'open' && (
                    <td>
                      <CancelButton
                        onClick={() => handleCancelOrder(order.id)}
                        disabled={cancellingOrders.has(order.id)}
                      >
                        {cancellingOrders.has(order.id) ? 'Cancelling...' : 'Cancel'}
                      </CancelButton>
                    </td>
                  )}
                </TableRow>
              ))}
            </tbody>
          </Table>
        )}
      </OrdersSection>
    </Container>
  );
};