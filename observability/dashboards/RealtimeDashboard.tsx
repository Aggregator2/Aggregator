import React, { useState, useEffect, useRef } from 'react';
import { 
  Grid, 
  Paper, 
  Typography, 
  Box, 
  Card, 
  CardContent,
  LinearProgress,
  Chip,
  Alert,
  IconButton,
  Tooltip
} from '@mui/material';
import { 
  TrendingUp, 
  TrendingDown, 
  Warning, 
  CheckCircle,
  RefreshOutlined,
  FullscreenOutlined
} from '@mui/icons-material';
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  Treemap,
  ComposedChart
} from 'recharts';
import { format } from 'date-fns';
import useWebSocket from 'react-use-websocket';

interface DashboardConfig {
  wsUrl: string;
  refreshInterval: number;
  theme: 'light' | 'dark';
}

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

interface OrderBookDepth {
  timestamp: number;
  pair: string;
  bids: { price: number; volume: number; total: number }[];
  asks: { price: number; volume: number; total: number }[];
  spread: number;
  midPrice: number;
}

interface SettlementMetrics {
  total: number;
  successful: number;
  failed: number;
  pending: number;
  avgTime: number;
  volume: number;
  successRate: number;
}

interface UserActivity {
  timestamp: number;
  activeUsers: number;
  newUsers: number;
  trades: number;
  volume: number;
  topTraders: { userId: string; volume: number; trades: number }[];
}

interface PnLData {
  timestamp: number;
  realized: number;
  unrealized: number;
  total: number;
  byPair: { pair: string; pnl: number }[];
  byUser: { userId: string; pnl: number }[];
}

export const RealtimeDashboard: React.FC<{ config: DashboardConfig }> = ({ config }) => {
  const [systemHealth, setSystemHealth] = useState<SystemHealth | null>(null);
  const [orderBookDepth, setOrderBookDepth] = useState<Record<string, OrderBookDepth>>({});
  const [settlementMetrics, setSettlementMetrics] = useState<SettlementMetrics | null>(null);
  const [userActivity, setUserActivity] = useState<UserActivity[]>([]);
  const [pnlData, setPnlData] = useState<PnLData[]>([]);
  const [selectedPair, setSelectedPair] = useState('ETH/USDT');
  const [timeRange, setTimeRange] = useState('1h');
  
  const { sendMessage, lastMessage, readyState } = useWebSocket(config.wsUrl);

  useEffect(() => {
    if (lastMessage !== null) {
      const data = JSON.parse(lastMessage.data);
      
      switch (data.type) {
        case 'system_health':
          setSystemHealth(data.payload);
          break;
        case 'orderbook_depth':
          setOrderBookDepth(prev => ({
            ...prev,
            [data.payload.pair]: data.payload
          }));
          break;
        case 'settlement_metrics':
          setSettlementMetrics(data.payload);
          break;
        case 'user_activity':
          setUserActivity(prev => [...prev.slice(-100), data.payload]);
          break;
        case 'pnl_update':
          setPnlData(prev => [...prev.slice(-100), data.payload]);
          break;
      }
    }
  }, [lastMessage]);

  // System Health Overview
  const SystemHealthCard: React.FC = () => {
    if (!systemHealth) return <LinearProgress />;

    const getStatusColor = (status: string) => {
      switch (status) {
        case 'healthy': return '#4caf50';
        case 'degraded': return '#ff9800';
        case 'critical': return '#f44336';
        default: return '#9e9e9e';
      }
    };

    return (
      <Card elevation={3}>
        <CardContent>
          <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
            <Typography variant="h6">System Health</Typography>
            <Chip 
              label={systemHealth.status.toUpperCase()} 
              style={{ backgroundColor: getStatusColor(systemHealth.status), color: 'white' }}
            />
          </Box>
          
          <Grid container spacing={2}>
            <Grid item xs={6}>
              <Box mb={2}>
                <Typography variant="body2" color="textSecondary">CPU Usage</Typography>
                <Box display="flex" alignItems="center">
                  <Box width="100%" mr={1}>
                    <LinearProgress 
                      variant="determinate" 
                      value={systemHealth.metrics.cpu} 
                      color={systemHealth.metrics.cpu > 80 ? 'error' : 'primary'}
                    />
                  </Box>
                  <Typography variant="body2">{systemHealth.metrics.cpu}%</Typography>
                </Box>
              </Box>
            </Grid>
            
            <Grid item xs={6}>
              <Box mb={2}>
                <Typography variant="body2" color="textSecondary">Memory Usage</Typography>
                <Box display="flex" alignItems="center">
                  <Box width="100%" mr={1}>
                    <LinearProgress 
                      variant="determinate" 
                      value={systemHealth.metrics.memory} 
                      color={systemHealth.metrics.memory > 80 ? 'error' : 'primary'}
                    />
                  </Box>
                  <Typography variant="body2">{systemHealth.metrics.memory}%</Typography>
                </Box>
              </Box>
            </Grid>
          </Grid>

          <Box mt={2}>
            <Typography variant="body2" color="textSecondary" gutterBottom>Services</Typography>
            {systemHealth.services.map(service => (
              <Box key={service.name} display="flex" justifyContent="space-between" alignItems="center" py={0.5}>
                <Typography variant="body2">{service.name}</Typography>
                <Box display="flex" alignItems="center" gap={1}>
                  <Chip 
                    size="small" 
                    label={`${service.latency}ms`}
                    color={service.latency > 100 ? 'warning' : 'default'}
                  />
                  {service.status === 'up' ? 
                    <CheckCircle fontSize="small" color="success" /> : 
                    <Warning fontSize="small" color="error" />
                  }
                </Box>
              </Box>
            ))}
          </Box>
        </CardContent>
      </Card>
    );
  };

  // Order Book Depth Visualization
  const OrderBookDepthChart: React.FC = () => {
    const data = orderBookDepth[selectedPair];
    if (!data) return <LinearProgress />;

    const chartData = [
      ...data.bids.slice(0, 10).reverse().map(bid => ({
        price: bid.price,
        bidVolume: bid.volume,
        bidTotal: bid.total,
        askVolume: 0,
        askTotal: 0
      })),
      ...data.asks.slice(0, 10).map(ask => ({
        price: ask.price,
        bidVolume: 0,
        bidTotal: 0,
        askVolume: ask.volume,
        askTotal: ask.total
      }))
    ];

    return (
      <Card elevation={3}>
        <CardContent>
          <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
            <Typography variant="h6">Order Book Depth - {selectedPair}</Typography>
            <Box display="flex" gap={1}>
              <Chip label={`Spread: ${data.spread.toFixed(2)}`} size="small" />
              <Chip label={`Mid: $${data.midPrice.toFixed(2)}`} size="small" />
            </Box>
          </Box>
          
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="price" />
              <YAxis yAxisId="left" orientation="left" />
              <YAxis yAxisId="right" orientation="right" />
              <RechartsTooltip />
              <Legend />
              
              <Bar yAxisId="left" dataKey="bidVolume" fill="#4caf50" name="Bid Volume" />
              <Bar yAxisId="left" dataKey="askVolume" fill="#f44336" name="Ask Volume" />
              
              <Line 
                yAxisId="right" 
                type="monotone" 
                dataKey="bidTotal" 
                stroke="#2e7d32" 
                name="Bid Total"
                strokeWidth={2}
              />
              <Line 
                yAxisId="right" 
                type="monotone" 
                dataKey="askTotal" 
                stroke="#c62828" 
                name="Ask Total"
                strokeWidth={2}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    );
  };

  // Settlement Success Rates
  const SettlementSuccessChart: React.FC = () => {
    if (!settlementMetrics) return <LinearProgress />;

    const pieData = [
      { name: 'Successful', value: settlementMetrics.successful, color: '#4caf50' },
      { name: 'Failed', value: settlementMetrics.failed, color: '#f44336' },
      { name: 'Pending', value: settlementMetrics.pending, color: '#ff9800' }
    ];

    return (
      <Card elevation={3}>
        <CardContent>
          <Typography variant="h6" gutterBottom>Settlement Metrics</Typography>
          
          <Grid container spacing={2}>
            <Grid item xs={12} md={6}>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    outerRadius={70}
                    fill="#8884d8"
                    dataKey="value"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <RechartsTooltip />
                </PieChart>
              </ResponsiveContainer>
            </Grid>
            
            <Grid item xs={12} md={6}>
              <Box height={200} display="flex" flexDirection="column" justifyContent="center">
                <Box display="flex" justifyContent="space-between" mb={1}>
                  <Typography variant="body2">Success Rate</Typography>
                  <Typography variant="body2" fontWeight="bold">
                    {settlementMetrics.successRate.toFixed(2)}%
                  </Typography>
                </Box>
                <Box display="flex" justifyContent="space-between" mb={1}>
                  <Typography variant="body2">Total Settlements</Typography>
                  <Typography variant="body2" fontWeight="bold">
                    {settlementMetrics.total.toLocaleString()}
                  </Typography>
                </Box>
                <Box display="flex" justifyContent="space-between" mb={1}>
                  <Typography variant="body2">Avg Settlement Time</Typography>
                  <Typography variant="body2" fontWeight="bold">
                    {settlementMetrics.avgTime.toFixed(1)}s
                  </Typography>
                </Box>
                <Box display="flex" justifyContent="space-between">
                  <Typography variant="body2">Total Volume</Typography>
                  <Typography variant="body2" fontWeight="bold">
                    ${settlementMetrics.volume.toLocaleString()}
                  </Typography>
                </Box>
              </Box>
            </Grid>
          </Grid>
        </CardContent>
      </Card>
    );
  };

  // User Activity Heatmap
  const UserActivityHeatmap: React.FC = () => {
    if (userActivity.length === 0) return <LinearProgress />;

    const recentActivity = userActivity.slice(-24);
    const heatmapData = recentActivity.map(activity => ({
      time: format(new Date(activity.timestamp), 'HH:mm'),
      users: activity.activeUsers,
      trades: activity.trades,
      volume: activity.volume / 1000 // in thousands
    }));

    return (
      <Card elevation={3}>
        <CardContent>
          <Typography variant="h6" gutterBottom>User Activity (24h)</Typography>
          
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={heatmapData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time" />
              <YAxis yAxisId="left" />
              <YAxis yAxisId="right" orientation="right" />
              <RechartsTooltip />
              <Legend />
              
              <Line 
                yAxisId="left"
                type="monotone" 
                dataKey="users" 
                stroke="#2196f3" 
                strokeWidth={2}
                name="Active Users"
              />
              <Line 
                yAxisId="left"
                type="monotone" 
                dataKey="trades" 
                stroke="#ff9800" 
                strokeWidth={2}
                name="Trades"
              />
              <Area
                yAxisId="right"
                type="monotone"
                dataKey="volume"
                stroke="#4caf50"
                fill="#4caf50"
                fillOpacity={0.3}
                name="Volume (K)"
              />
            </LineChart>
          </ResponsiveContainer>

          {userActivity[userActivity.length - 1]?.topTraders && (
            <Box mt={2}>
              <Typography variant="body2" color="textSecondary" gutterBottom>
                Top Traders (Last Hour)
              </Typography>
              <Box display="flex" gap={1} flexWrap="wrap">
                {userActivity[userActivity.length - 1].topTraders.slice(0, 5).map((trader, index) => (
                  <Chip
                    key={trader.userId}
                    label={`#${index + 1} ${trader.userId.substring(0, 8)}... ($${(trader.volume / 1000).toFixed(1)}k)`}
                    size="small"
                    color={index === 0 ? 'primary' : 'default'}
                  />
                ))}
              </Box>
            </Box>
          )}
        </CardContent>
      </Card>
    );
  };

  // P&L Tracking
  const PnLTrackingChart: React.FC = () => {
    if (pnlData.length === 0) return <LinearProgress />;

    const chartData = pnlData.slice(-20).map(data => ({
      time: format(new Date(data.timestamp), 'HH:mm'),
      realized: data.realized,
      unrealized: data.unrealized,
      total: data.total
    }));

    const latestPnL = pnlData[pnlData.length - 1];
    const totalPnL = latestPnL?.total || 0;
    const pnlColor = totalPnL >= 0 ? '#4caf50' : '#f44336';

    return (
      <Card elevation={3}>
        <CardContent>
          <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
            <Typography variant="h6">P&L Tracking</Typography>
            <Box display="flex" alignItems="center" gap={1}>
              {totalPnL >= 0 ? <TrendingUp color="success" /> : <TrendingDown color="error" />}
              <Typography variant="h6" style={{ color: pnlColor }}>
                ${Math.abs(totalPnL).toLocaleString()}
              </Typography>
            </Box>
          </Box>
          
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time" />
              <YAxis />
              <RechartsTooltip />
              <Legend />
              
              <Area
                type="monotone"
                dataKey="realized"
                stackId="1"
                stroke="#2196f3"
                fill="#2196f3"
                name="Realized P&L"
              />
              <Area
                type="monotone"
                dataKey="unrealized"
                stackId="1"
                stroke="#ff9800"
                fill="#ff9800"
                name="Unrealized P&L"
              />
              <Line
                type="monotone"
                dataKey="total"
                stroke={pnlColor}
                strokeWidth={3}
                name="Total P&L"
              />
            </AreaChart>
          </ResponsiveContainer>

          {latestPnL?.byPair && (
            <Box mt={2}>
              <Typography variant="body2" color="textSecondary" gutterBottom>
                P&L by Trading Pair
              </Typography>
              <Grid container spacing={1}>
                {latestPnL.byPair.slice(0, 6).map(({ pair, pnl }) => (
                  <Grid item xs={4} key={pair}>
                    <Box 
                      p={1} 
                      bgcolor={pnl >= 0 ? 'success.light' : 'error.light'}
                      borderRadius={1}
                      textAlign="center"
                    >
                      <Typography variant="caption">{pair}</Typography>
                      <Typography variant="body2" fontWeight="bold">
                        ${pnl.toFixed(2)}
                      </Typography>
                    </Box>
                  </Grid>
                ))}
              </Grid>
            </Box>
          )}
        </CardContent>
      </Card>
    );
  };

  // Main Dashboard Layout
  return (
    <Box p={3}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4">Trading System Dashboard</Typography>
        <Box display="flex" gap={1}>
          <Tooltip title="Refresh">
            <IconButton onClick={() => sendMessage(JSON.stringify({ action: 'refresh' }))}>
              <RefreshOutlined />
            </IconButton>
          </Tooltip>
          <Tooltip title="Fullscreen">
            <IconButton onClick={() => document.documentElement.requestFullscreen()}>
              <FullscreenOutlined />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      <Grid container spacing={3}>
        {/* System Health */}
        <Grid item xs={12} md={4}>
          <SystemHealthCard />
        </Grid>

        {/* Settlement Metrics */}
        <Grid item xs={12} md={8}>
          <SettlementSuccessChart />
        </Grid>

        {/* Order Book Depth */}
        <Grid item xs={12}>
          <OrderBookDepthChart />
        </Grid>

        {/* User Activity */}
        <Grid item xs={12} md={6}>
          <UserActivityHeatmap />
        </Grid>

        {/* P&L Tracking */}
        <Grid item xs={12} md={6}>
          <PnLTrackingChart />
        </Grid>
      </Grid>

      {/* WebSocket Connection Status */}
      <Box position="fixed" bottom={16} right={16}>
        <Chip
          label={readyState === 1 ? 'Connected' : 'Disconnected'}
          color={readyState === 1 ? 'success' : 'error'}
          size="small"
        />
      </Box>
    </Box>
  );
};