import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { act } from 'react-dom/test-utils';
import WalletHeader from '../../components/WalletHeader';
import { useToast } from '../../hooks/useToast';
import { useOrderToast } from '../../hooks/useOrderToast';
import Toast from '../../components/Toast';
import OrderToast from '../../components/OrderToast';

// Mock ethers
jest.mock('ethers', () => ({
  ethers: {
    BrowserProvider: jest.fn().mockImplementation(() => ({
      getBalance: jest.fn().mockResolvedValue(BigInt('1000000000000000000')),
    })),
    formatEther: jest.fn().mockReturnValue('1.0'),
  },
}));

describe('Notification System Tests', () => {
  // Test data
  const mockNotifications = [
    {
      id: '1',
      type: 'success' as const,
      message: 'Order submitted: 1 ETH → DAI',
      timestamp: new Date(),
      details: { orderId: 'order123' },
    },
    {
      id: '2',
      type: 'error' as const,
      message: 'Order failed: Insufficient balance',
      timestamp: new Date(),
      details: { error: 'INSUFFICIENT_BALANCE' },
    },
    {
      id: '3',
      type: 'pending' as const,
      message: 'Order processing...',
      timestamp: new Date(),
    },
    {
      id: '4',
      type: 'info' as const,
      message: 'Market update: High volatility detected',
      timestamp: new Date(),
    },
  ];

  const mockOrders = [
    {
      id: 'order1',
      sellToken: '0xToken1',
      buyToken: '0xToken2',
      sellAmount: '1000000000000000000',
      buyAmount: '2000000000000000000',
      status: 'filled' as const,
      timestamp: new Date(),
      txHash: '0xabc123',
    },
    {
      id: 'order2',
      sellToken: '0xToken3',
      buyToken: '0xToken4',
      sellAmount: '500000000000000000',
      buyAmount: '1000000000000000000',
      status: 'pending' as const,
      timestamp: new Date(),
    },
  ];

  describe('WalletHeader Notifications', () => {
    it('should render notification dropdown with correct count', () => {
      const { container } = render(
        <WalletHeader
          walletAddress="0x1234567890123456789012345678901234567890"
          onConnect={jest.fn()}
          onDisconnect={jest.fn()}
          notifications={mockNotifications}
        />
      );

      // Find notification button by looking for SVG bell icon
      const notificationButton = container.querySelector('button svg path[d*="M15 17h5l-1.405"]')?.closest('button');
      expect(notificationButton).toBeInTheDocument();

      // Check unread count
      const badge = container.querySelector('[class*="notificationBadge"]');
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent('4');
    });

    it('should toggle notification dropdown on click', async () => {
      const { container } = render(
        <WalletHeader
          walletAddress="0x1234567890123456789012345678901234567890"
          onConnect={jest.fn()}
          onDisconnect={jest.fn()}
          notifications={mockNotifications}
        />
      );

      const notificationButton = container.querySelector('button svg path[d*="M15 17h5l-1.405"]')?.closest('button');
      
      // Initially dropdown should not be visible
      expect(container.querySelector('[class*="notificationDropdown"]')).not.toBeInTheDocument();

      // Click to open
      fireEvent.click(notificationButton!);
      await waitFor(() => {
        expect(container.querySelector('[class*="notificationDropdown"]')).toBeInTheDocument();
      });

      // Click to close
      fireEvent.click(notificationButton!);
      await waitFor(() => {
        expect(container.querySelector('[class*="notificationDropdown"]')).not.toBeInTheDocument();
      });
    });

    it('should display all notification types correctly', async () => {
      const { container } = render(
        <WalletHeader
          walletAddress="0x1234567890123456789012345678901234567890"
          onConnect={jest.fn()}
          onDisconnect={jest.fn()}
          notifications={mockNotifications}
        />
      );

      const notificationButton = container.querySelector('button svg path[d*="M15 17h5l-1.405"]')?.closest('button');
      fireEvent.click(notificationButton!);

      await waitFor(() => {
        // Check success notification
        expect(screen.getByText('Order submitted: 1 ETH → DAI')).toBeInTheDocument();
        expect(screen.getByText('✅')).toBeInTheDocument();

        // Check error notification
        expect(screen.getByText('Order failed: Insufficient balance')).toBeInTheDocument();
        expect(screen.getByText('❌')).toBeInTheDocument();

        // Check pending notification
        expect(screen.getByText('Order processing...')).toBeInTheDocument();
        expect(screen.getByText('⏳')).toBeInTheDocument();

        // Check info notification
        expect(screen.getByText('Market update: High volatility detected')).toBeInTheDocument();
        expect(screen.getByText('ℹ️')).toBeInTheDocument();
      });
    });

    it('should handle scrollable notification list with many items', async () => {
      const manyNotifications = Array.from({ length: 20 }, (_, i) => ({
        id: `notif-${i}`,
        type: 'info' as const,
        message: `Notification ${i + 1}`,
        timestamp: new Date(Date.now() - i * 60000), // 1 minute apart
      }));

      const { container } = render(
        <WalletHeader
          walletAddress="0x1234567890123456789012345678901234567890"
          onConnect={jest.fn()}
          onDisconnect={jest.fn()}
          notifications={manyNotifications}
        />
      );

      const notificationButton = container.querySelector('button svg path[d*="M15 17h5l-1.405"]')?.closest('button');
      fireEvent.click(notificationButton!);

      await waitFor(() => {
        const dropdown = container.querySelector('[class*="notificationList"]');
        expect(dropdown).toBeInTheDocument();
        
        // Check if scrollable (max-height should be set)
        const computedStyle = window.getComputedStyle(dropdown!);
        expect(computedStyle.overflowY).toBe('auto');
      });
    });

    it('should clear all notifications when clear button is clicked', async () => {
      const onClearNotifications = jest.fn();
      const { container } = render(
        <WalletHeader
          walletAddress="0x1234567890123456789012345678901234567890"
          onConnect={jest.fn()}
          onDisconnect={jest.fn()}
          notifications={mockNotifications}
          onClearNotifications={onClearNotifications}
        />
      );

      const notificationButton = container.querySelector('button svg path[d*="M15 17h5l-1.405"]')?.closest('button');
      fireEvent.click(notificationButton!);

      await waitFor(() => {
        const clearButton = screen.getByText('Clear All');
        fireEvent.click(clearButton);
        expect(onClearNotifications).toHaveBeenCalled();
      });
    });

    it('should close dropdown when clicking outside', async () => {
      const { container } = render(
        <div>
          <WalletHeader
            walletAddress="0x1234567890123456789012345678901234567890"
            onConnect={jest.fn()}
            onDisconnect={jest.fn()}
            notifications={mockNotifications}
          />
          <div data-testid="outside-element">Outside</div>
        </div>
      );

      const notificationButton = container.querySelector('button svg path[d*="M15 17h5l-1.405"]')?.closest('button');
      fireEvent.click(notificationButton!);

      await waitFor(() => {
        expect(container.querySelector('[class*="notificationDropdown"]')).toBeInTheDocument();
      });

      // Click outside
      fireEvent.mouseDown(screen.getByTestId('outside-element'));

      await waitFor(() => {
        expect(container.querySelector('[class*="notificationDropdown"]')).not.toBeInTheDocument();
      });
    });
  });

  describe('Toast Notifications', () => {
    it('should render toast with correct type and message', () => {
      render(
        <Toast
          type="success"
          message="Transaction successful!"
          onClose={jest.fn()}
        />
      );

      expect(screen.getByText('Transaction successful!')).toBeInTheDocument();
      const toast = screen.getByText('Transaction successful!').closest('div');
      expect(toast).toHaveClass('success');
    });

    it('should auto-dismiss after duration', async () => {
      const onClose = jest.fn();
      jest.useFakeTimers();

      render(
        <Toast
          type="info"
          message="Test message"
          duration={3000}
          onClose={onClose}
        />
      );

      expect(screen.getByText('Test message')).toBeInTheDocument();

      act(() => {
        jest.advanceTimersByTime(3000);
      });

      expect(onClose).toHaveBeenCalled();

      jest.useRealTimers();
    });

    it('should close when close button is clicked', () => {
      const onClose = jest.fn();
      render(
        <Toast
          type="error"
          message="Error message"
          onClose={onClose}
        />
      );

      const closeButton = screen.getByRole('button', { name: /close/i });
      fireEvent.click(closeButton);

      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('Order Toast Notifications', () => {
    it('should display order submitted notification', () => {
      render(
        <OrderToast
          type="submitted"
          sellToken={{ symbol: 'ETH', amount: '1' }}
          buyToken={{ symbol: 'DAI', amount: '2000' }}
          onClose={jest.fn()}
        />
      );

      expect(screen.getByText(/Order submitted/i)).toBeInTheDocument();
      expect(screen.getByText(/1 ETH → 2000 DAI/i)).toBeInTheDocument();
    });

    it('should display order filled notification with tx link', () => {
      render(
        <OrderToast
          type="filled"
          sellToken={{ symbol: 'USDC', amount: '1000' }}
          buyToken={{ symbol: 'ETH', amount: '0.5' }}
          txHash="0xabc123def456"
          onClose={jest.fn()}
        />
      );

      expect(screen.getByText(/Order filled/i)).toBeInTheDocument();
      expect(screen.getByText(/1000 USDC → 0.5 ETH/i)).toBeInTheDocument();
      
      const txLink = screen.getByText(/View transaction/i);
      expect(txLink).toHaveAttribute('href', expect.stringContaining('0xabc123def456'));
    });

    it('should display order failed notification', () => {
      render(
        <OrderToast
          type="failed"
          sellToken={{ symbol: 'WBTC', amount: '0.1' }}
          buyToken={{ symbol: 'USDT', amount: '6000' }}
          error="Slippage too high"
          onClose={jest.fn()}
        />
      );

      expect(screen.getByText(/Order failed/i)).toBeInTheDocument();
      expect(screen.getByText(/Slippage too high/i)).toBeInTheDocument();
    });

    it('should show celebration animation for filled orders', () => {
      const { container } = render(
        <OrderToast
          type="filled"
          sellToken={{ symbol: 'ETH', amount: '1' }}
          buyToken={{ symbol: 'DAI', amount: '2000' }}
          onClose={jest.fn()}
        />
      );

      const celebrationElement = container.querySelector('[class*="celebration"]');
      expect(celebrationElement).toBeInTheDocument();
    });
  });

  describe('useToast Hook', () => {
    const TestComponent = () => {
      const { showError, showSuccess, showWarning, showInfo, ToastContainer } = useToast();

      return (
        <div>
          <button onClick={() => showSuccess('Success!')}>Show Success</button>
          <button onClick={() => showError('Error!')}>Show Error</button>
          <button onClick={() => showWarning('Warning!')}>Show Warning</button>
          <button onClick={() => showInfo('Info!')}>Show Info</button>
          <ToastContainer />
        </div>
      );
    };

    it('should show all toast types', async () => {
      render(<TestComponent />);

      // Test success toast
      fireEvent.click(screen.getByText('Show Success'));
      await waitFor(() => {
        expect(screen.getByText('Success!')).toBeInTheDocument();
      });

      // Test error toast
      fireEvent.click(screen.getByText('Show Error'));
      await waitFor(() => {
        expect(screen.getByText('Error!')).toBeInTheDocument();
      });

      // Test warning toast
      fireEvent.click(screen.getByText('Show Warning'));
      await waitFor(() => {
        expect(screen.getByText('Warning!')).toBeInTheDocument();
      });

      // Test info toast
      fireEvent.click(screen.getByText('Show Info'));
      await waitFor(() => {
        expect(screen.getByText('Info!')).toBeInTheDocument();
      });
    });
  });

  describe('State Updates', () => {
    it('should update notification array correctly', async () => {
      const TestComponent = () => {
        const [notifications, setNotifications] = React.useState<any[]>([]);

        const addNotification = (type: string, message: string) => {
          setNotifications(prev => [...prev, {
            id: Date.now().toString(),
            type,
            message,
            timestamp: new Date(),
          }]);
        };

        return (
          <div>
            <button onClick={() => addNotification('success', 'New notification')}>
              Add Notification
            </button>
            <div data-testid="notification-count">{notifications.length}</div>
            <WalletHeader
              walletAddress="0x123"
              onConnect={jest.fn()}
              onDisconnect={jest.fn()}
              notifications={notifications}
              onClearNotifications={() => setNotifications([])}
            />
          </div>
        );
      };

      render(<TestComponent />);

      expect(screen.getByTestId('notification-count')).toHaveTextContent('0');

      // Add notifications
      fireEvent.click(screen.getByText('Add Notification'));
      fireEvent.click(screen.getByText('Add Notification'));
      fireEvent.click(screen.getByText('Add Notification'));

      await waitFor(() => {
        expect(screen.getByTestId('notification-count')).toHaveTextContent('3');
      });
    });

    it('should handle unread indicators correctly', async () => {
      const recentNotifications = [
        {
          id: '1',
          type: 'success' as const,
          message: 'Recent notification',
          timestamp: new Date(Date.now() - 60000), // 1 minute ago
        },
        {
          id: '2',
          type: 'info' as const,
          message: 'Old notification',
          timestamp: new Date(Date.now() - 600000), // 10 minutes ago
        },
      ];

      const { container } = render(
        <WalletHeader
          walletAddress="0x123"
          onConnect={jest.fn()}
          onDisconnect={jest.fn()}
          notifications={recentNotifications}
        />
      );

      const badge = container.querySelector('[class*="notificationBadge"]');
      expect(badge).toBeInTheDocument();
      // Only notifications from last 5 minutes should be counted as unread
      expect(badge).toHaveTextContent('1');
    });
  });
});