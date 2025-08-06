# UI Components Documentation

## Table of Contents
1. [Overview](#overview)
2. [Component Architecture](#component-architecture)
3. [Real-time Dashboard](#real-time-dashboard)
4. [Order Book Visualization](#order-book-visualization)
5. [P&L Tracking Dashboard](#pl-tracking-dashboard)
6. [WebSocket Integration](#websocket-integration)
7. [Styling and Theming](#styling-and-theming)
8. [Performance Optimization](#performance-optimization)
9. [Accessibility](#accessibility)
10. [Mobile Responsiveness](#mobile-responsiveness)

## Overview

The UI components provide real-time visualization and monitoring capabilities for the trading system. Built with React, Material-UI, and advanced charting libraries, these components offer:

- **Real-time Updates**: WebSocket-based live data streaming
- **Interactive Visualizations**: D3.js and Recharts for complex data visualization
- **Responsive Design**: Mobile-first approach with Material-UI
- **Performance Optimized**: Efficient rendering with React optimization techniques
- **Accessibility**: WCAG 2.1 compliant components

## Component Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Dashboard Components                      │
├──────────────┬────────────────┬────────────────────────────┤
│RealtimeDashboard│OrderBookVisualization│PnLTrackingDashboard│
├──────────────┴────────────────┴────────────────────────────┤
│                     Shared Components                        │
├─────────────────────────┬───────────────────────────────────┤
│   Material-UI Components│      Charting Libraries           │
├─────────────────────────┴───────────────────────────────────┤
│                    WebSocket Manager                         │
└─────────────────────────────────────────────────────────────┘
```

## Real-time Dashboard

### Overview
The main monitoring dashboard providing system-wide visibility.

Located at: `/workspace/observability/dashboards/RealtimeDashboard.tsx`

### Features

#### System Health Monitoring
- Real-time CPU and memory usage
- Service status indicators
- Latency metrics
- Active connections count

#### Settlement Metrics
- Success/failure/pending breakdown
- Average settlement time
- Total volume processed
- Success rate percentage

#### Order Book Depth
- Combined depth chart
- Spread and mid-price indicators
- Bid/ask volume visualization
- Real-time price updates

#### User Activity Heatmap
- Active users over time
- Trade volume trends
- Top traders leaderboard
- Activity patterns

#### P&L Overview
- Real-time P&L tracking
- Trend indicators
- P&L by trading pair
- Historical comparison

### Component Props

```typescript
interface DashboardConfig {
  wsUrl: string;          // WebSocket endpoint
  refreshInterval: number; // Update interval in ms
  theme: 'light' | 'dark'; // Theme mode
}

<RealtimeDashboard config={config} />
```

### Usage Example

```typescript
import { RealtimeDashboard } from './observability/dashboards/RealtimeDashboard';

const App = () => {
  const dashboardConfig = {
    wsUrl: 'wss://api.trading.com/ws',
    refreshInterval: 5000,
    theme: 'light'
  };

  return <RealtimeDashboard config={dashboardConfig} />;
};
```

### Data Structure

```typescript
// System Health Data
interface SystemHealth {
  status: 'healthy' | 'degraded' | 'critical';
  services: {
    name: string;
    status: 'up' | 'down';
    latency: number;
    errorRate: number;
  }[];
  metrics: {
    cpu: number;
    memory: number;
    eventLoopLag: number;
    activeConnections: number;
  };
}

// Settlement Metrics
interface SettlementMetrics {
  total: number;
  successful: number;
  failed: number;
  pending: number;
  avgTime: number;
  volume: number;
  successRate: number;
}
```

### WebSocket Events

```typescript
// Subscribe to dashboard events
ws.on('system_health', (data: SystemHealth) => {
  // Update system health display
});

ws.on('settlement_metrics', (data: SettlementMetrics) => {
  // Update settlement charts
});

ws.on('user_activity', (data: UserActivity) => {
  // Update activity heatmap
});
```

## Order Book Visualization

### Overview
Advanced order book visualization with multiple view modes.

Located at: `/workspace/observability/dashboards/OrderBookVisualization.tsx`

### View Modes

#### 1. Depth Chart (Default)
- D3.js-based market depth visualization
- Cumulative volume areas
- Interactive tooltips
- Mid-price indicator
- Zoom and pan support

```typescript
// Depth chart implementation
const DepthChart: React.FC = () => {
  // Uses D3.js for rendering
  // Bid area in green, ask area in red
  // Cumulative volume on Y-axis
  // Price on X-axis
};
```

#### 2. Heatmap Visualization
- Canvas-based performance optimization
- Color-coded volume intensity
- Price levels on X-axis
- Bid/ask split view
- Real-time updates

```typescript
// Heatmap colors
const colorScale = scaleSequential(interpolateRdYlGn)
  .domain([0, maxVolume]);
```

#### 3. Order Flow Animation
- Real-time order flow visualization
- Animated order entries
- Size-based visual encoding
- Direction indicators
- Historical trail effect

```typescript
// Order flow data
interface OrderFlow {
  id: string;
  side: 'bid' | 'ask';
  price: number;
  volume: number;
  timestamp: number;
}
```

#### 4. 3D Visualization (Planned)
- Three.js-based 3D order book
- Interactive camera controls
- Volume mountains
- Time-based animation

### Component Props

```typescript
interface OrderBookVisualizationProps {
  data: OrderBookData;
  onPairChange: (pair: string) => void;
  availablePairs: string[];
}

interface OrderBookData {
  pair: string;
  timestamp: number;
  bids: Order[];
  asks: Order[];
  spread: number;
  midPrice: number;
  imbalance: number;
  depth: {
    bid: number;
    ask: number;
  };
}

interface Order {
  price: number;
  volume: number;
  total: number;
  orderCount: number;
  averageSize: number;
}
```

### Usage Example

```typescript
const OrderBookExample = () => {
  const [selectedPair, setSelectedPair] = useState('ETH/USDT');
  const [orderBookData, setOrderBookData] = useState<OrderBookData>(initialData);

  return (
    <OrderBookVisualization
      data={orderBookData}
      onPairChange={setSelectedPair}
      availablePairs={['BTC/USDT', 'ETH/USDT', 'SOL/USDT']}
    />
  );
};
```

### Market Metrics Display

```typescript
// Displayed metrics
const metrics = [
  { label: 'Spread', value: data.spread },
  { label: 'Mid Price', value: data.midPrice },
  { label: 'Bid Depth', value: data.depth.bid },
  { label: 'Ask Depth', value: data.depth.ask },
  { label: 'Imbalance', value: data.imbalance }
];
```

### Customization Options

```typescript
// View controls
<ToggleButtonGroup value={viewMode} onChange={setViewMode}>
  <ToggleButton value="depth">Depth Chart</ToggleButton>
  <ToggleButton value="heatmap">Heatmap</ToggleButton>
  <ToggleButton value="flow">Order Flow</ToggleButton>
  <ToggleButton value="3d">3D View</ToggleButton>
</ToggleButtonGroup>

// Animation toggle
<Switch 
  checked={showAnimations} 
  onChange={setShowAnimations}
/>

// Depth level slider
<Slider
  value={depthLevels}
  onChange={setDepthLevels}
  min={5}
  max={50}
  step={5}
/>
```

## P&L Tracking Dashboard

### Overview
Comprehensive profit and loss tracking with performance analytics.

Located at: `/workspace/observability/dashboards/PnLTrackingDashboard.tsx`

### Features

#### P&L Overview Card
- Animated total P&L display
- Realized vs unrealized breakdown
- Fee tracking
- Win rate calculation
- Trend indicators

```typescript
// P&L summary data
interface PnLSummary {
  totalRealized: number;
  totalUnrealized: number;
  totalFees: number;
  netPnL: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  sharpeRatio: number;
  maxDrawdown: number;
}
```

#### Performance Metrics
- **Profit Factor**: Ratio of gross profit to gross loss
- **Sharpe Ratio**: Risk-adjusted returns
- **Max Drawdown**: Largest peak-to-trough decline
- **Win/Loss Statistics**: Average win, average loss, win rate

```typescript
// Performance calculation
const calculateMetrics = (trades: Trade[]): PerformanceMetrics => {
  // Sharpe Ratio: (avgReturn / stdDev) * sqrt(252)
  // Profit Factor: totalWins / totalLosses
  // Max Drawdown: largest percentage decline
};
```

#### P&L Timeline Chart
- Cumulative P&L line
- Realized P&L area
- Unrealized P&L area
- Interactive tooltips
- Time range selection

```typescript
// Chart configuration
<LineChart data={pnlTimeline}>
  <Line dataKey="cumulative" stroke="#ff9800" strokeWidth={3} />
  <Line dataKey="realized" stroke="#4caf50" />
  <Line dataKey="unrealized" stroke="#2196f3" />
</LineChart>
```

#### P&L by Trading Pair
- Bar chart visualization
- Profit/loss color coding
- Trade count overlay
- Sortable display

```typescript
// P&L aggregation by pair
const pnlByPair = trades.reduce((acc, trade) => {
  acc[trade.pair] = (acc[trade.pair] || 0) + trade.pnl;
  return acc;
}, {});
```

#### Open Positions Table
- Real-time position tracking
- Entry vs current price
- Unrealized P&L calculation
- Position duration
- Quick actions

```typescript
interface Position {
  id: string;
  pair: string;
  side: 'long' | 'short';
  entryPrice: number;
  currentPrice: number;
  quantity: number;
  unrealizedPnL: number;
  openTime: number;
}
```

#### Recent Trades Table
- Chronological trade history
- P&L per trade
- Fee breakdown
- Execution details
- Export functionality

### Component Props

```typescript
interface PnLTrackingProps {
  userId?: string;      // Filter by user
  isAdmin?: boolean;    // Admin view with all users
}

<PnLTrackingDashboard userId="user123" isAdmin={false} />
```

### View Modes

```typescript
type ViewMode = 'overview' | 'detailed' | 'analysis';

// Overview: Summary cards and main charts
// Detailed: Full position and trade tables
// Analysis: Advanced analytics (coming soon)
```

### Data Filtering

```typescript
// Time range filter
<Select value={timeRange} onChange={setTimeRange}>
  <MenuItem value="24h">24 Hours</MenuItem>
  <MenuItem value="7d">7 Days</MenuItem>
  <MenuItem value="30d">30 Days</MenuItem>
  <MenuItem value="all">All Time</MenuItem>
</Select>

// Trading pair filter
<Select value={selectedPair} onChange={setSelectedPair}>
  <MenuItem value="all">All Pairs</MenuItem>
  <MenuItem value="BTC/USDT">BTC/USDT</MenuItem>
  <MenuItem value="ETH/USDT">ETH/USDT</MenuItem>
</Select>
```

### Export Functionality

```typescript
const exportReport = () => {
  const data = {
    summary: pnlSummary,
    positions: openPositions,
    trades: recentTrades,
    metrics: performanceMetrics
  };
  
  // Generate CSV or PDF report
  downloadReport(data, format);
};
```

## WebSocket Integration

### Overview
Real-time data streaming for all dashboard components.

### WebSocket Manager

```typescript
export class DashboardWebSocket {
  private ws: WebSocket | null = null;
  private reconnectInterval: number = 5000;
  private listeners: Map<string, Set<Function>> = new Map();
  
  connect(url: string): void {
    this.ws = new WebSocket(url);
    this.setupEventHandlers();
  }
  
  on(event: string, callback: Function): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }
  
  send(data: any): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }
}
```

### Event Types

```typescript
// System events
type SystemEvent = 
  | 'system_health'
  | 'service_status'
  | 'performance_metrics';

// Trading events
type TradingEvent = 
  | 'orderbook_depth'
  | 'trade_executed'
  | 'order_matched'
  | 'settlement_complete';

// User events
type UserEvent = 
  | 'user_activity'
  | 'pnl_update'
  | 'position_change';
```

### Reconnection Strategy

```typescript
private handleDisconnect(): void {
  console.log('WebSocket disconnected, reconnecting...');
  
  setTimeout(() => {
    this.connect(this.url);
  }, this.reconnectInterval);
  
  // Exponential backoff
  this.reconnectInterval = Math.min(
    this.reconnectInterval * 2,
    30000 // Max 30 seconds
  );
}
```

### Message Protocol

```typescript
interface WebSocketMessage {
  type: string;      // Event type
  payload: any;      // Event data
  timestamp: number; // Server timestamp
  sequence: number;  // Message sequence number
}

// Subscribe to channels
ws.send({
  action: 'subscribe',
  channels: ['orderbook', 'trades', 'pnl']
});

// Unsubscribe from channels
ws.send({
  action: 'unsubscribe',
  channels: ['orderbook']
});
```

## Styling and Theming

### Material-UI Theme

```typescript
import { createTheme } from '@mui/material/styles';

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#2196f3',
      light: '#64b5f6',
      dark: '#1976d2'
    },
    secondary: {
      main: '#ff9800',
      light: '#ffb74d',
      dark: '#f57c00'
    },
    success: {
      main: '#4caf50',
      light: '#81c784',
      dark: '#388e3c'
    },
    error: {
      main: '#f44336',
      light: '#e57373',
      dark: '#d32f2f'
    },
    background: {
      default: '#fafafa',
      paper: '#ffffff'
    }
  },
  typography: {
    fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
    h4: {
      fontWeight: 600
    },
    h6: {
      fontWeight: 500
    }
  },
  shape: {
    borderRadius: 8
  },
  shadows: [
    'none',
    '0px 2px 4px rgba(0,0,0,0.05)',
    '0px 4px 8px rgba(0,0,0,0.1)',
    '0px 8px 16px rgba(0,0,0,0.15)',
    // ... more shadow definitions
  ]
});
```

### Dark Mode Support

```typescript
const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#90caf9'
    },
    background: {
      default: '#121212',
      paper: '#1e1e1e'
    }
  }
});

// Theme toggle
const [themeMode, setThemeMode] = useState<'light' | 'dark'>('light');
const theme = themeMode === 'light' ? lightTheme : darkTheme;
```

### Custom Styling

```typescript
// Using Material-UI's sx prop
<Box
  sx={{
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    p: 3,
    borderRadius: 2,
    bgcolor: 'background.paper',
    boxShadow: 3
  }}
>
  {/* Content */}
</Box>

// Using styled components
import { styled } from '@mui/material/styles';

const StyledCard = styled(Card)(({ theme }) => ({
  padding: theme.spacing(3),
  borderRadius: theme.shape.borderRadius * 2,
  transition: 'all 0.3s ease',
  '&:hover': {
    transform: 'translateY(-4px)',
    boxShadow: theme.shadows[8]
  }
}));
```

### Chart Styling

```typescript
// Recharts theme
const chartTheme = {
  axis: {
    style: {
      fontSize: 12,
      fill: theme.palette.text.secondary
    }
  },
  grid: {
    stroke: theme.palette.divider,
    strokeDasharray: '3 3'
  },
  tooltip: {
    contentStyle: {
      backgroundColor: theme.palette.background.paper,
      border: `1px solid ${theme.palette.divider}`,
      borderRadius: theme.shape.borderRadius
    }
  }
};

// D3.js styling
const svg = d3.select(ref.current)
  .style('font-family', theme.typography.fontFamily)
  .style('font-size', '12px');

svg.selectAll('.axis')
  .style('color', theme.palette.text.secondary);
```

## Performance Optimization

### React Optimization

#### 1. Memoization
```typescript
import { memo, useMemo, useCallback } from 'react';

// Memoize expensive calculations
const expensiveData = useMemo(() => {
  return processLargeDataset(rawData);
}, [rawData]);

// Memoize callbacks
const handleUpdate = useCallback((data) => {
  updateChart(data);
}, []);

// Memoize components
const MemoizedChart = memo(ChartComponent, (prevProps, nextProps) => {
  return prevProps.data === nextProps.data;
});
```

#### 2. Virtual Scrolling
```typescript
import { FixedSizeList } from 'react-window';

const VirtualizedTable = ({ data }) => (
  <FixedSizeList
    height={600}
    itemCount={data.length}
    itemSize={50}
    width="100%"
  >
    {({ index, style }) => (
      <div style={style}>
        <TableRow data={data[index]} />
      </div>
    )}
  </FixedSizeList>
);
```

#### 3. Lazy Loading
```typescript
import { lazy, Suspense } from 'react';

const OrderBookVisualization = lazy(() => 
  import('./OrderBookVisualization')
);

const Dashboard = () => (
  <Suspense fallback={<CircularProgress />}>
    <OrderBookVisualization />
  </Suspense>
);
```

### Data Optimization

#### 1. Data Aggregation
```typescript
// Aggregate data on backend
const aggregateOrderBook = (orders: Order[]) => {
  // Group by price levels
  const aggregated = orders.reduce((acc, order) => {
    const priceLevel = Math.round(order.price / 0.1) * 0.1;
    acc[priceLevel] = (acc[priceLevel] || 0) + order.volume;
    return acc;
  }, {});
  
  return Object.entries(aggregated).map(([price, volume]) => ({
    price: parseFloat(price),
    volume
  }));
};
```

#### 2. Throttling and Debouncing
```typescript
import { throttle, debounce } from 'lodash';

// Throttle high-frequency updates
const throttledUpdate = throttle((data) => {
  updateDashboard(data);
}, 100); // Max 10 updates per second

// Debounce search inputs
const debouncedSearch = debounce((query) => {
  searchTrades(query);
}, 300);
```

#### 3. Request Batching
```typescript
class BatchProcessor {
  private queue: any[] = [];
  private timer: NodeJS.Timeout | null = null;
  
  add(item: any) {
    this.queue.push(item);
    
    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.process();
      }, 50);
    }
  }
  
  private process() {
    const batch = [...this.queue];
    this.queue = [];
    this.timer = null;
    
    // Process batch
    processBatch(batch);
  }
}
```

### Rendering Optimization

#### 1. Canvas for Heavy Graphics
```typescript
// Use canvas for heatmaps
const drawHeatmap = (canvas: HTMLCanvasElement, data: any[]) => {
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.createImageData(width, height);
  
  // Direct pixel manipulation
  for (let i = 0; i < data.length; i++) {
    const color = colorScale(data[i].value);
    const pixelIndex = i * 4;
    imageData.data[pixelIndex] = color.r;
    imageData.data[pixelIndex + 1] = color.g;
    imageData.data[pixelIndex + 2] = color.b;
    imageData.data[pixelIndex + 3] = 255;
  }
  
  ctx.putImageData(imageData, 0, 0);
};
```

#### 2. RAF for Animations
```typescript
const animate = () => {
  requestAnimationFrame(() => {
    // Update animation frame
    updateAnimation();
    
    if (isAnimating) {
      animate();
    }
  });
};
```

#### 3. Web Workers for Heavy Computation
```typescript
// worker.ts
self.addEventListener('message', (e) => {
  const { type, data } = e.data;
  
  switch (type) {
    case 'PROCESS_DATA':
      const result = heavyComputation(data);
      self.postMessage({ type: 'RESULT', data: result });
      break;
  }
});

// main.ts
const worker = new Worker('worker.js');
worker.postMessage({ type: 'PROCESS_DATA', data: largeDataset });
worker.onmessage = (e) => {
  updateUI(e.data.data);
};
```

## Accessibility

### ARIA Labels

```typescript
// Proper ARIA labels
<div
  role="region"
  aria-label="Order Book Visualization"
  aria-live="polite"
  aria-atomic="true"
>
  <canvas
    ref={canvasRef}
    role="img"
    aria-label={`Order book showing ${bids.length} bids and ${asks.length} asks`}
  />
</div>

// Interactive elements
<IconButton
  aria-label="Refresh dashboard data"
  onClick={handleRefresh}
>
  <RefreshIcon />
</IconButton>
```

### Keyboard Navigation

```typescript
// Enable keyboard navigation
const handleKeyDown = (event: KeyboardEvent) => {
  switch (event.key) {
    case 'ArrowLeft':
      navigateToPreviousItem();
      break;
    case 'ArrowRight':
      navigateToNextItem();
      break;
    case 'Enter':
    case ' ':
      selectCurrentItem();
      break;
    case 'Escape':
      closeModal();
      break;
  }
};

// Focus management
const [focusedIndex, setFocusedIndex] = useState(0);

useEffect(() => {
  const element = itemRefs.current[focusedIndex];
  element?.focus();
}, [focusedIndex]);
```

### Screen Reader Support

```typescript
// Announce updates
const announce = (message: string) => {
  const announcement = document.createElement('div');
  announcement.setAttribute('role', 'status');
  announcement.setAttribute('aria-live', 'polite');
  announcement.textContent = message;
  document.body.appendChild(announcement);
  
  setTimeout(() => {
    document.body.removeChild(announcement);
  }, 1000);
};

// Descriptive text
<Typography className="sr-only">
  Current P&L: {formatCurrency(pnl)}. 
  {pnl > 0 ? 'Profit' : 'Loss'} of {Math.abs(pnl)} dollars.
</Typography>
```

### Color Contrast

```typescript
// Ensure WCAG AA compliance
const colors = {
  success: {
    light: '#4caf50', // 3.5:1 on white
    dark: '#1b5e20'   // 12:1 on white
  },
  error: {
    light: '#f44336', // 3:1 on white
    dark: '#b71c1c'   // 9.5:1 on white
  }
};

// Use color and icons together
<Chip
  icon={<TrendingUpIcon />}
  label="Profit"
  color="success"
  aria-label="Profit indicator"
/>
```

## Mobile Responsiveness

### Responsive Grid Layout

```typescript
// Material-UI responsive grid
<Grid container spacing={3}>
  <Grid item xs={12} sm={6} md={4} lg={3}>
    <MetricCard />
  </Grid>
  <Grid item xs={12} md={8} lg={9}>
    <ChartContainer />
  </Grid>
</Grid>

// Breakpoint-based rendering
const theme = useTheme();
const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
const isTablet = useMediaQuery(theme.breakpoints.down('md'));

return isMobile ? (
  <MobileLayout />
) : isTablet ? (
  <TabletLayout />
) : (
  <DesktopLayout />
);
```

### Touch Optimization

```typescript
// Touch-friendly interactions
const [touchStart, setTouchStart] = useState<number | null>(null);

const handleTouchStart = (e: TouchEvent) => {
  setTouchStart(e.touches[0].clientX);
};

const handleTouchMove = (e: TouchEvent) => {
  if (!touchStart) return;
  
  const currentTouch = e.touches[0].clientX;
  const diff = touchStart - currentTouch;
  
  if (Math.abs(diff) > 50) {
    if (diff > 0) {
      navigateNext();
    } else {
      navigatePrevious();
    }
    setTouchStart(null);
  }
};

// Larger touch targets
<IconButton
  sx={{
    minWidth: 48,
    minHeight: 48,
    p: 1.5
  }}
>
  <MenuIcon />
</IconButton>
```

### Responsive Charts

```typescript
// Responsive container
<ResponsiveContainer width="100%" height={300}>
  <LineChart data={data}>
    {/* Chart content */}
  </LineChart>
</ResponsiveContainer>

// Dynamic sizing
const useChartDimensions = (ref: RefObject<HTMLDivElement>) => {
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  
  useEffect(() => {
    const handleResize = () => {
      if (ref.current) {
        setDimensions({
          width: ref.current.offsetWidth,
          height: ref.current.offsetHeight
        });
      }
    };
    
    window.addEventListener('resize', handleResize);
    handleResize();
    
    return () => window.removeEventListener('resize', handleResize);
  }, [ref]);
  
  return dimensions;
};
```

### Mobile-Specific Features

```typescript
// Swipeable tabs
import { SwipeableViews } from 'react-swipeable-views';

<SwipeableViews
  index={tabIndex}
  onChangeIndex={setTabIndex}
>
  <TabPanel value={0}>Overview</TabPanel>
  <TabPanel value={1}>Details</TabPanel>
  <TabPanel value={2}>Analysis</TabPanel>
</SwipeableViews>

// Pull to refresh
const [refreshing, setRefreshing] = useState(false);

const handlePullToRefresh = async () => {
  setRefreshing(true);
  await refreshData();
  setRefreshing(false);
};

// Bottom sheet for mobile
<SwipeableDrawer
  anchor="bottom"
  open={mobileMenuOpen}
  onClose={() => setMobileMenuOpen(false)}
  onOpen={() => setMobileMenuOpen(true)}
  swipeAreaWidth={20}
  disableSwipeToOpen={false}
>
  <MobileMenu />
</SwipeableDrawer>
```

## Best Practices

### Component Organization

```typescript
// Feature-based structure
src/
  components/
    dashboards/
      RealtimeDashboard/
        index.tsx
        SystemHealth.tsx
        SettlementMetrics.tsx
        hooks/
          useSystemHealth.ts
          useWebSocket.ts
        styles/
          dashboard.module.css
```

### State Management

```typescript
// Use context for shared state
const DashboardContext = createContext<DashboardState>({
  theme: 'light',
  timeRange: '24h',
  selectedPair: 'all'
});

// Custom hooks for data fetching
const useOrderBookData = (pair: string) => {
  const [data, setData] = useState<OrderBookData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  
  useEffect(() => {
    fetchOrderBookData(pair)
      .then(setData)
      .catch(setError)
      .finally(() => setLoading(false));
  }, [pair]);
  
  return { data, loading, error };
};
```

### Error Handling

```typescript
// Error boundary
class DashboardErrorBoundary extends React.Component {
  state = { hasError: false, error: null };
  
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  
  render() {
    if (this.state.hasError) {
      return (
        <Alert severity="error">
          <AlertTitle>Dashboard Error</AlertTitle>
          {this.state.error?.message}
        </Alert>
      );
    }
    
    return this.props.children;
  }
}

// Graceful degradation
const OrderBook = ({ data }) => {
  if (!data) {
    return <EmptyState message="No order book data available" />;
  }
  
  if (data.error) {
    return <ErrorState error={data.error} onRetry={refetch} />;
  }
  
  return <OrderBookVisualization data={data} />;
};
```

### Testing

```typescript
// Component testing
import { render, screen, fireEvent } from '@testing-library/react';

test('renders dashboard with system health', async () => {
  render(<RealtimeDashboard config={mockConfig} />);
  
  expect(screen.getByText('System Health')).toBeInTheDocument();
  
  // Wait for data to load
  const cpuMetric = await screen.findByText(/CPU Usage/);
  expect(cpuMetric).toBeInTheDocument();
});

// Integration testing
test('updates chart on WebSocket message', async () => {
  const { container } = render(<PnLTrackingDashboard />);
  
  // Simulate WebSocket message
  act(() => {
    mockWebSocket.emit('pnl_update', mockPnLData);
  });
  
  // Check chart updated
  const chart = container.querySelector('.recharts-line');
  expect(chart).toBeInTheDocument();
});
```

## Deployment Considerations

### Build Optimization

```typescript
// Webpack configuration
module.exports = {
  optimization: {
    splitChunks: {
      chunks: 'all',
      cacheGroups: {
        vendor: {
          test: /[\\/]node_modules[\\/]/,
          name: 'vendors',
          priority: 10
        },
        charts: {
          test: /[\\/]node_modules[\\/](recharts|d3)/,
          name: 'charts',
          priority: 20
        }
      }
    }
  }
};

// Tree shaking
import { LineChart, Line } from 'recharts'; // Good
// import * as Recharts from 'recharts'; // Bad
```

### CDN Integration

```html
<!-- Preload critical resources -->
<link rel="preload" href="/fonts/roboto.woff2" as="font" crossorigin>
<link rel="preload" href="/js/dashboard.js" as="script">

<!-- Lazy load non-critical resources -->
<script defer src="/js/charts.js"></script>
```

### Performance Monitoring

```typescript
// Real User Monitoring
const measurePerformance = () => {
  const navigation = performance.getEntriesByType('navigation')[0];
  const paint = performance.getEntriesByType('paint');
  
  trackMetric('page_load_time', navigation.loadEventEnd);
  trackMetric('first_paint', paint[0]?.startTime);
  trackMetric('first_contentful_paint', paint[1]?.startTime);
};

// Component render tracking
const ProfiledDashboard = () => (
  <Profiler id="Dashboard" onRender={onRenderCallback}>
    <RealtimeDashboard />
  </Profiler>
);
```

## Conclusion

The UI components provide a comprehensive, real-time monitoring solution for the trading system. Key features include:

1. **Real-time Updates**: WebSocket-based live data streaming
2. **Advanced Visualizations**: D3.js and Recharts for complex data
3. **Responsive Design**: Mobile-first with Material-UI
4. **Performance Optimized**: Virtual scrolling, memoization, and lazy loading
5. **Accessible**: WCAG 2.1 compliant with full keyboard support

For additional examples and implementation details, refer to:
- `/workspace/observability/dashboards/` - Component source code
- `/workspace/observability/examples/` - Usage examples
- `/workspace/observability/README.md` - Quick start guide