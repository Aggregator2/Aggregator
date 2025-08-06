import React from 'react';
import ReactDOM from 'react-dom/client';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { RealtimeDashboard } from '../dashboards/RealtimeDashboard';
import { OrderBookVisualization } from '../dashboards/OrderBookVisualization';
import { PnLTrackingDashboard } from '../dashboards/PnLTrackingDashboard';

// Dashboard configuration
const dashboardConfig = {
  wsUrl: process.env.NEXT_PUBLIC_WS_URL || 'wss://localhost:8080/ws',
  refreshInterval: 5000,
  theme: 'light' as const
};

// Material-UI theme
const theme = createTheme({
  palette: {
    mode: dashboardConfig.theme,
    primary: {
      main: '#2196f3',
    },
    secondary: {
      main: '#ff9800',
    },
    success: {
      main: '#4caf50',
    },
    error: {
      main: '#f44336',
    },
  },
  typography: {
    fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
  },
});

// Mock order book data for demonstration
const mockOrderBookData = {
  pair: 'ETH/USDT',
  timestamp: Date.now(),
  bids: Array.from({ length: 20 }, (_, i) => ({
    price: 2000 - i * 5,
    volume: Math.random() * 10,
    total: 0,
    orderCount: Math.floor(Math.random() * 5) + 1,
    averageSize: Math.random() * 2
  })),
  asks: Array.from({ length: 20 }, (_, i) => ({
    price: 2001 + i * 5,
    volume: Math.random() * 10,
    total: 0,
    orderCount: Math.floor(Math.random() * 5) + 1,
    averageSize: Math.random() * 2
  })),
  spread: 1,
  midPrice: 2000.5,
  imbalance: 0.05,
  depth: {
    bid: 150.5,
    ask: 148.2
  }
};

// Calculate cumulative totals
let bidTotal = 0;
mockOrderBookData.bids.forEach(bid => {
  bidTotal += bid.volume;
  bid.total = bidTotal;
});

let askTotal = 0;
mockOrderBookData.asks.forEach(ask => {
  askTotal += ask.volume;
  ask.total = askTotal;
});

// Available trading pairs
const availablePairs = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT'];

// Main App Component
const App: React.FC = () => {
  const [selectedView, setSelectedView] = React.useState<'main' | 'orderbook' | 'pnl'>('main');
  const [orderBookPair, setOrderBookPair] = React.useState('ETH/USDT');
  const [currentUser, setCurrentUser] = React.useState<string>('user123');
  const [isAdmin, setIsAdmin] = React.useState(false);

  const handlePairChange = (pair: string) => {
    setOrderBookPair(pair);
    // In real implementation, fetch new order book data for the selected pair
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <div style={{ minHeight: '100vh', backgroundColor: theme.palette.background.default }}>
        {/* Navigation */}
        <div style={{ 
          padding: '16px', 
          borderBottom: `1px solid ${theme.palette.divider}`,
          backgroundColor: theme.palette.background.paper
        }}>
          <button onClick={() => setSelectedView('main')} style={{ marginRight: '8px' }}>
            Main Dashboard
          </button>
          <button onClick={() => setSelectedView('orderbook')} style={{ marginRight: '8px' }}>
            Order Book
          </button>
          <button onClick={() => setSelectedView('pnl')} style={{ marginRight: '8px' }}>
            P&L Tracking
          </button>
          <label style={{ marginLeft: '16px' }}>
            <input 
              type="checkbox" 
              checked={isAdmin} 
              onChange={(e) => setIsAdmin(e.target.checked)}
            />
            Admin View
          </label>
        </div>

        {/* Content */}
        {selectedView === 'main' && (
          <RealtimeDashboard config={dashboardConfig} />
        )}
        
        {selectedView === 'orderbook' && (
          <div style={{ padding: '24px' }}>
            <OrderBookVisualization
              data={mockOrderBookData}
              onPairChange={handlePairChange}
              availablePairs={availablePairs}
            />
          </div>
        )}
        
        {selectedView === 'pnl' && (
          <PnLTrackingDashboard 
            userId={currentUser}
            isAdmin={isAdmin}
          />
        )}
      </div>
    </ThemeProvider>
  );
};

// Mount the app
const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(<App />);

// WebSocket setup for real-time updates
export class DashboardWebSocket {
  private ws: WebSocket | null = null;
  private reconnectInterval: number = 5000;
  private listeners: Map<string, Set<Function>> = new Map();

  connect(url: string): void {
    try {
      this.ws = new WebSocket(url);
      
      this.ws.onopen = () => {
        console.log('Dashboard WebSocket connected');
        this.emit('connected', {});
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.emit(data.type, data.payload);
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.emit('error', error);
      };

      this.ws.onclose = () => {
        console.log('WebSocket disconnected, reconnecting...');
        this.emit('disconnected', {});
        setTimeout(() => this.connect(url), this.reconnectInterval);
      };

    } catch (error) {
      console.error('Failed to connect WebSocket:', error);
      setTimeout(() => this.connect(url), this.reconnectInterval);
    }
  }

  on(event: string, callback: Function): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }

  off(event: string, callback: Function): void {
    this.listeners.get(event)?.delete(callback);
  }

  private emit(event: string, data: any): void {
    this.listeners.get(event)?.forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error(`Error in ${event} handler:`, error);
      }
    });
  }

  send(data: any): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

// Export for use in other components
export const dashboardWS = new DashboardWebSocket();