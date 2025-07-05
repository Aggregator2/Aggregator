import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import { format } from 'date-fns';
import { orderApiService } from '../../services/api/OrderApiService';

const Modal = styled.div<{ isOpen: boolean }>`
  display: ${props => props.isOpen ? 'flex' : 'none'};
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.8);
  align-items: center;
  justify-content: center;
  z-index: 1000;
  backdrop-filter: blur(4px);
`;

const ModalContent = styled.div`
  background: #1a1a1a;
  border-radius: 12px;
  width: 90%;
  max-width: 800px;
  max-height: 90vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
  border: 1px solid #333;
`;

const Header = styled.div`
  padding: 24px;
  border-bottom: 1px solid #333;
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

const Title = styled.h2`
  margin: 0;
  font-size: 20px;
  color: #fff;
`;

const CloseButton = styled.button`
  background: none;
  border: none;
  color: #666;
  font-size: 24px;
  cursor: pointer;
  padding: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: all 0.2s;
  
  &:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
  }
`;

const Content = styled.div`
  padding: 24px;
  overflow-y: auto;
  flex: 1;
  
  &::-webkit-scrollbar {
    width: 8px;
  }
  
  &::-webkit-scrollbar-track {
    background: #111;
  }
  
  &::-webkit-scrollbar-thumb {
    background: #444;
    border-radius: 4px;
  }
`;

const Section = styled.div`
  margin-bottom: 32px;
  
  &:last-child {
    margin-bottom: 0;
  }
`;

const SectionTitle = styled.h3`
  margin: 0 0 16px 0;
  font-size: 16px;
  color: #fff;
  display: flex;
  align-items: center;
  gap: 8px;
`;

const StatusBadge = styled.span<{ status: string }>`
  padding: 4px 12px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
  background: ${props => {
    switch (props.status) {
      case 'settled': return 'rgba(0, 255, 136, 0.2)';
      case 'pending': return 'rgba(255, 170, 0, 0.2)';
      case 'failed': return 'rgba(255, 68, 68, 0.2)';
      default: return 'rgba(136, 136, 136, 0.2)';
    }
  }};
  color: ${props => {
    switch (props.status) {
      case 'settled': return '#00ff88';
      case 'pending': return '#ffaa00';
      case 'failed': return '#ff4444';
      default: return '#888';
    }
  }};
`;

const InfoGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
  margin-bottom: 24px;
`;

const InfoItem = styled.div`
  background: rgba(255, 255, 255, 0.03);
  padding: 16px;
  border-radius: 8px;
  border: 1px solid #333;
`;

const InfoLabel = styled.div`
  font-size: 12px;
  color: #888;
  margin-bottom: 4px;
  text-transform: uppercase;
`;

const InfoValue = styled.div`
  font-size: 14px;
  color: #fff;
  font-weight: 500;
`;

const ProofTable = styled.table`
  width: 100%;
  border-collapse: collapse;
`;

const ProofTableHeader = styled.thead`
  tr {
    border-bottom: 1px solid #333;
  }
  
  th {
    padding: 12px;
    text-align: left;
    font-size: 12px;
    color: #888;
    text-transform: uppercase;
    font-weight: 500;
  }
`;

const ProofTableRow = styled.tr`
  border-bottom: 1px solid #222;
  
  &:hover {
    background: rgba(255, 255, 255, 0.03);
  }
  
  td {
    padding: 12px;
    font-size: 14px;
    color: #fff;
  }
`;

const BlockchainProof = styled.div`
  background: rgba(0, 102, 255, 0.1);
  border: 1px solid rgba(0, 102, 255, 0.3);
  padding: 16px;
  border-radius: 8px;
  margin-top: 16px;
`;

const ProofHash = styled.code`
  font-family: 'Courier New', monospace;
  font-size: 12px;
  color: #0066ff;
  word-break: break-all;
`;

const ExplorerLink = styled.a`
  color: #0066ff;
  text-decoration: none;
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 8px;
  
  &:hover {
    text-decoration: underline;
  }
`;

const LoadingState = styled.div`
  text-align: center;
  padding: 40px;
  color: #666;
`;

const ErrorState = styled.div`
  background: rgba(255, 68, 68, 0.1);
  border: 1px solid rgba(255, 68, 68, 0.3);
  padding: 16px;
  border-radius: 8px;
  color: #ff4444;
  font-size: 14px;
`;

const EmptyState = styled.div`
  text-align: center;
  padding: 40px;
  color: #666;
  font-size: 14px;
`;

interface DisputeModalProps {
  isOpen: boolean;
  onClose: () => void;
  orderId: string;
  orderDetails?: {
    pair: string;
    side: string;
    type: string;
    quantity: number;
    filledQuantity: number;
    status: string;
  };
}

export const DisputeModal: React.FC<DisputeModalProps> = ({
  isOpen,
  onClose,
  orderId,
  orderDetails,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settlementData, setSettlementData] = useState<any>(null);

  useEffect(() => {
    if (isOpen && orderId) {
      loadSettlementProof();
    }
  }, [isOpen, orderId]);

  const loadSettlementProof = async () => {
    try {
      setLoading(true);
      setError(null);
      const proof = await orderApiService.getSettlementProof(orderId);
      setSettlementData(proof);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load settlement proof');
      setSettlementData(null);
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (timestamp: string | Date | number): string => {
    if (!timestamp) return '-';
    return format(new Date(timestamp), 'MMM dd, yyyy HH:mm:ss');
  };

  const formatAmount = (amount: number): string => {
    if (amount >= 1000) return amount.toFixed(2);
    if (amount >= 1) return amount.toFixed(4);
    return amount.toFixed(8);
  };

  const getExplorerUrl = (hash: string, chainId?: number): string => {
    // Map chain ID to explorer URLs
    const explorers: { [key: number]: string } = {
      1: 'https://etherscan.io/tx/',
      137: 'https://polygonscan.com/tx/',
      42161: 'https://arbiscan.io/tx/',
      10: 'https://optimistic.etherscan.io/tx/',
      56: 'https://bscscan.com/tx/',
    };
    
    const baseUrl = explorers[chainId || 1] || explorers[1];
    return `${baseUrl}${hash}`;
  };

  return (
    <Modal isOpen={isOpen} onClick={onClose}>
      <ModalContent onClick={(e) => e.stopPropagation()}>
        <Header>
          <Title>Settlement Proof - Order #{orderId.slice(0, 8)}</Title>
          <CloseButton onClick={onClose}>×</CloseButton>
        </Header>
        
        <Content>
          {loading && (
            <LoadingState>Loading settlement proof...</LoadingState>
          )}
          
          {error && !loading && (
            <ErrorState>{error}</ErrorState>
          )}
          
          {settlementData && !loading && (
            <>
              <Section>
                <SectionTitle>Order Details</SectionTitle>
                <InfoGrid>
                  <InfoItem>
                    <InfoLabel>Trading Pair</InfoLabel>
                    <InfoValue>{settlementData.order.pair}</InfoValue>
                  </InfoItem>
                  <InfoItem>
                    <InfoLabel>Side</InfoLabel>
                    <InfoValue>{settlementData.order.side}</InfoValue>
                  </InfoItem>
                  <InfoItem>
                    <InfoLabel>Order Type</InfoLabel>
                    <InfoValue>{settlementData.order.type}</InfoValue>
                  </InfoItem>
                  <InfoItem>
                    <InfoLabel>Quantity</InfoLabel>
                    <InfoValue>{formatAmount(settlementData.order.quantity)}</InfoValue>
                  </InfoItem>
                  <InfoItem>
                    <InfoLabel>Filled Quantity</InfoLabel>
                    <InfoValue>{formatAmount(settlementData.order.filledQuantity)}</InfoValue>
                  </InfoItem>
                  <InfoItem>
                    <InfoLabel>Order Status</InfoLabel>
                    <InfoValue>
                      <StatusBadge status={settlementData.order.status.toLowerCase()}>
                        {settlementData.order.status}
                      </StatusBadge>
                    </InfoValue>
                  </InfoItem>
                </InfoGrid>
              </Section>

              <Section>
                <SectionTitle>
                  Settlement Summary
                  <StatusBadge status={settlementData.summary.pendingTrades === 0 ? 'settled' : 'pending'}>
                    {settlementData.summary.settledTrades}/{settlementData.summary.totalTrades} Settled
                  </StatusBadge>
                </SectionTitle>
                
                {settlementData.settlementProofs.length === 0 ? (
                  <EmptyState>No settlements found for this order</EmptyState>
                ) : (
                  <ProofTable>
                    <ProofTableHeader>
                      <tr>
                        <th>Trade ID</th>
                        <th>Settlement Time</th>
                        <th>Amount</th>
                        <th>Price</th>
                        <th>Fee</th>
                        <th>Balance Change</th>
                        <th>Status</th>
                      </tr>
                    </ProofTableHeader>
                    <tbody>
                      {settlementData.settlementProofs.map((proof: any) => (
                        <ProofTableRow key={proof.tradeId}>
                          <td>{proof.tradeId.slice(0, 8)}...</td>
                          <td>{formatTime(proof.settlementTime)}</td>
                          <td>{formatAmount(proof.amount)}</td>
                          <td>{formatAmount(proof.price)}</td>
                          <td>{formatAmount(proof.fee)}</td>
                          <td>{proof.balanceChange ? formatAmount(proof.balanceChange) : '-'}</td>
                          <td>
                            <StatusBadge status={proof.status}>
                              {proof.status}
                            </StatusBadge>
                          </td>
                        </ProofTableRow>
                      ))}
                    </tbody>
                  </ProofTable>
                )}
              </Section>

              {settlementData.settlementProofs.some((p: any) => p.blockchainProof) && (
                <Section>
                  <SectionTitle>Blockchain Proofs</SectionTitle>
                  {settlementData.settlementProofs
                    .filter((p: any) => p.blockchainProof)
                    .map((proof: any) => (
                      <BlockchainProof key={proof.tradeId}>
                        <InfoLabel>Epoch #{proof.epochNumber} - Settlement Transaction</InfoLabel>
                        <ProofHash>{proof.blockchainProof}</ProofHash>
                        <ExplorerLink 
                          href={getExplorerUrl(proof.blockchainProof)}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          View on Explorer →
                        </ExplorerLink>
                      </BlockchainProof>
                    ))}
                </Section>
              )}
            </>
          )}
        </Content>
      </ModalContent>
    </Modal>
  );
};