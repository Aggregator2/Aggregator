import { useState, useCallback, ReactNode } from 'react';
import OrderToast, { OrderToastProps } from '../components/OrderToast';

interface OrderToastData extends Omit<OrderToastProps, 'onClose'> {
  id: string;
}

export function useOrderToast() {
  const [orderToasts, setOrderToasts] = useState<OrderToastData[]>([]);

  const showOrderToast = useCallback((
    orderId: string,
    status: OrderToastProps['status'],
    sellToken: string,
    buyToken: string,
    sellAmount: string,
    buyAmount: string,
    txHash?: string,
    duration?: number
  ) => {
    const id = `${orderId}-${Date.now()}`;
    const newToast: OrderToastData = {
      id,
      orderId,
      status,
      sellToken,
      buyToken,
      sellAmount,
      buyAmount,
      txHash,
      duration,
    };
    
    setOrderToasts(prev => [...prev, newToast]);
    
    return id;
  }, []);

  const hideOrderToast = useCallback((id: string) => {
    setOrderToasts(prev => prev.filter(toast => toast.id !== id));
  }, []);

  const showOrderSubmitted = useCallback((
    orderId: string,
    sellToken: string,
    buyToken: string,
    sellAmount: string,
    buyAmount: string
  ) => showOrderToast(orderId, 'submitted', sellToken, buyToken, sellAmount, buyAmount), 
  [showOrderToast]);

  const showOrderFilled = useCallback((
    orderId: string,
    sellToken: string,
    buyToken: string,
    sellAmount: string,
    buyAmount: string,
    txHash: string
  ) => showOrderToast(orderId, 'filled', sellToken, buyToken, sellAmount, buyAmount, txHash, 8000), 
  [showOrderToast]);

  const showOrderFailed = useCallback((
    orderId: string,
    sellToken: string,
    buyToken: string,
    sellAmount: string,
    buyAmount: string
  ) => showOrderToast(orderId, 'failed', sellToken, buyToken, sellAmount, buyAmount), 
  [showOrderToast]);

  const showOrderPending = useCallback((
    orderId: string,
    sellToken: string,
    buyToken: string,
    sellAmount: string,
    buyAmount: string
  ) => showOrderToast(orderId, 'pending', sellToken, buyToken, sellAmount, buyAmount), 
  [showOrderToast]);

  const OrderToastContainer = useCallback((): ReactNode => (
    <>
      {orderToasts.map(toast => (
        <OrderToast
          key={toast.id}
          orderId={toast.orderId}
          status={toast.status}
          sellToken={toast.sellToken}
          buyToken={toast.buyToken}
          sellAmount={toast.sellAmount}
          buyAmount={toast.buyAmount}
          txHash={toast.txHash}
          onClose={() => hideOrderToast(toast.id)}
          duration={toast.duration}
        />
      ))}
    </>
  ), [orderToasts, hideOrderToast]);

  return {
    showOrderToast,
    showOrderSubmitted,
    showOrderFilled,
    showOrderFailed,
    showOrderPending,
    hideOrderToast,
    OrderToastContainer,
  };
}