import React, { useState } from 'react';
import { useUserOrders } from '../src/hooks/useUserOrders';
import { OrderStatus } from '../src/services/matchingEngine/types';
import { formatNumber, formatTime } from '../src/utils/format';

export interface UserOrdersProps {
  className?: string;
}

export const UserOrders: React.FC<UserOrdersProps> = ({ className = '' }) => {
  const [activeTab, setActiveTab] = useState<'active' | 'history'>('active');
  const {
    activeOrders,
    filledOrders,
    cancelledOrders,
    loading,
    error,
    cancelOrder,
    cancelAllOrders,
    connected,
    authenticated
  } = useUserOrders();

  const displayOrders = activeTab === 'active' 
    ? activeOrders 
    : [...filledOrders, ...cancelledOrders].sort((a, b) => b.timestamp - a.timestamp);

  const handleCancelOrder = async (orderId: string) => {
    if (confirm('Are you sure you want to cancel this order?')) {
      cancelOrder(orderId);
    }
  };

  const handleCancelAll = async () => {
    if (confirm('Are you sure you want to cancel all orders?')) {
      cancelAllOrders();
    }
  };

  if (!authenticated) {
    return (
      <div className={`user-orders-unauthenticated ${className}`}>
        <div className="text-center p-8 text-gray-600">
          Please connect your wallet to view orders
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={`user-orders-loading ${className}`}>
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/3 mb-4"></div>
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-12 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`user-orders-error ${className}`}>
        <div className="text-red-600 text-center p-4">
          <p>Failed to load orders</p>
          <p className="text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`user-orders ${className}`}>
      <div className="user-orders-header mb-4">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold">My Orders</h3>
          {activeTab === 'active' && activeOrders.length > 0 && (
            <button
              onClick={handleCancelAll}
              className="text-sm text-red-600 hover:text-red-800"
            >
              Cancel All
            </button>
          )}
        </div>

        <div className="tabs flex gap-4 border-b">
          <button
            className={`tab pb-2 px-1 ${
              activeTab === 'active' 
                ? 'border-b-2 border-blue-500 font-medium' 
                : 'text-gray-600'
            }`}
            onClick={() => setActiveTab('active')}
          >
            Active ({activeOrders.length})
          </button>
          <button
            className={`tab pb-2 px-1 ${
              activeTab === 'history' 
                ? 'border-b-2 border-blue-500 font-medium' 
                : 'text-gray-600'
            }`}
            onClick={() => setActiveTab('history')}
          >
            History ({filledOrders.length + cancelledOrders.length})
          </button>
        </div>
      </div>

      <div className="user-orders-content">
        {displayOrders.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            No {activeTab === 'active' ? 'active' : 'historical'} orders
          </div>
        ) : (
          <div className="orders-list space-y-2">
            {displayOrders.map((order) => (
              <div
                key={order.id}
                className="order-item border rounded-lg p-4 hover:shadow-md transition-shadow"
              >
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <div className="text-xs text-gray-600">Pair</div>
                    <div className="font-medium">{order.pair}</div>
                  </div>
                  
                  <div>
                    <div className="text-xs text-gray-600">Side</div>
                    <div className={`font-medium ${
                      order.side === 'BUY' ? 'text-green-600' : 'text-red-600'
                    }`}>
                      {order.side}
                    </div>
                  </div>
                  
                  <div>
                    <div className="text-xs text-gray-600">Price</div>
                    <div>{formatNumber(order.price, 2)}</div>
                  </div>
                  
                  <div>
                    <div className="text-xs text-gray-600">Amount</div>
                    <div>
                      {formatNumber(order.filledQuantity, 4)} / {formatNumber(order.quantity, 4)}
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex justify-between items-center">
                  <div className="flex items-center gap-4 text-xs text-gray-600">
                    <span>{formatTime(order.timestamp)}</span>
                    <span className={`px-2 py-1 rounded ${getStatusColor(order.status)}`}>
                      {order.status}
                    </span>
                  </div>
                  
                  {activeTab === 'active' && (
                    <button
                      onClick={() => handleCancelOrder(order.id)}
                      className="text-sm text-red-600 hover:text-red-800"
                    >
                      Cancel
                    </button>
                  )}
                </div>

                {order.filledQuantity > 0 && (
                  <div className="mt-2">
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-blue-500 h-2 rounded-full"
                        style={{
                          width: `${(order.filledQuantity / order.quantity) * 100}%`
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

function getStatusColor(status: OrderStatus): string {
  switch (status) {
    case OrderStatus.NEW:
      return 'bg-blue-100 text-blue-800';
    case OrderStatus.PARTIALLY_FILLED:
      return 'bg-yellow-100 text-yellow-800';
    case OrderStatus.FILLED:
      return 'bg-green-100 text-green-800';
    case OrderStatus.CANCELLED:
      return 'bg-gray-100 text-gray-800';
    case OrderStatus.REJECTED:
      return 'bg-red-100 text-red-800';
    case OrderStatus.EXPIRED:
      return 'bg-orange-100 text-orange-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
}