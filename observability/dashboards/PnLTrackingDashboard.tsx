import React, { useState, useEffect, useMemo } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Grid,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  IconButton,
  Tooltip,
  Button,
  ButtonGroup,
  ToggleButton,
  ToggleButtonGroup,
  LinearProgress,
  Avatar,
  AvatarGroup,
  Divider,
  TextField,
  InputAdornment
} from '@mui/material';
import {
  TrendingUp,
  TrendingDown,
  AccountBalance,
  ShowChart,
  PieChart as PieChartIcon,
  Timeline,
  Download,
  Refresh,
  FilterList,
  Search,
  ArrowUpward,
  ArrowDownward
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
  Sankey,
  Rectangle,
  Treemap,
  RadialBarChart,
  RadialBar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis
} from 'recharts';
import { format, subDays, startOfDay, endOfDay } from 'date-fns';
import { animated, useSpring } from 'react-spring';
import * as d3 from 'd3';

interface PnLData {
  timestamp: number;
  userId?: string;
  pair?: string;
  realized: number;
  unrealized: number;
  fees: number;
  gross: number;
  net: number;
  positions: Position[];
  trades: Trade[];
}

interface Position {
  id: string;
  pair: string;
  side: 'long' | 'short';
  entryPrice: number;
  currentPrice: number;
  quantity: number;
  realizedPnL: number;
  unrealizedPnL: number;
  fees: number;
  openTime: number;
  closeTime?: number;
}

interface Trade {
  id: string;
  pair: string;
  side: 'buy' | 'sell';
  price: number;
  quantity: number;
  fee: number;
  pnl: number;
  timestamp: number;
}

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
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
}

interface PnLTrackingProps {
  userId?: string;
  isAdmin?: boolean;
}

export const PnLTrackingDashboard: React.FC<PnLTrackingProps> = ({ userId, isAdmin = false }) => {
  const [timeRange, setTimeRange] = useState('24h');
  const [selectedPair, setSelectedPair] = useState('all');
  const [viewMode, setViewMode] = useState<'overview' | 'detailed' | 'analysis'>('overview');
  const [pnlData, setPnlData] = useState<PnLData[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' }>({
    key: 'net',
    direction: 'desc'
  });

  // Mock data generation
  useEffect(() => {
    const generateMockData = () => {
      const pairs = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT'];
      const data: PnLData[] = [];
      
      for (let i = 0; i < 100; i++) {
        const timestamp = Date.now() - i * 3600000;
        const realized = (Math.random() - 0.5) * 10000;
        const unrealized = (Math.random() - 0.5) * 5000;
        const fees = Math.abs(realized) * 0.001;
        
        data.push({
          timestamp,
          userId: isAdmin ? `user${Math.floor(Math.random() * 10)}` : userId,
          pair: pairs[Math.floor(Math.random() * pairs.length)],
          realized,
          unrealized,
          fees,
          gross: realized + unrealized,
          net: realized + unrealized - fees,
          positions: generateMockPositions(),
          trades: generateMockTrades()
        });
      }
      
      setPnlData(data);
      setLoading(false);
    };

    const generateMockPositions = (): Position[] => {
      const positions: Position[] = [];
      const pairs = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'];
      
      for (let i = 0; i < 3; i++) {
        const entryPrice = 40000 + Math.random() * 10000;
        const currentPrice = entryPrice * (1 + (Math.random() - 0.5) * 0.1);
        const quantity = Math.random() * 2;
        const side = Math.random() > 0.5 ? 'long' : 'short';
        const pnl = (currentPrice - entryPrice) * quantity * (side === 'long' ? 1 : -1);
        
        positions.push({
          id: `pos${i}`,
          pair: pairs[i],
          side,
          entryPrice,
          currentPrice,
          quantity,
          realizedPnL: 0,
          unrealizedPnL: pnl,
          fees: Math.abs(pnl) * 0.001,
          openTime: Date.now() - Math.random() * 86400000
        });
      }
      
      return positions;
    };

    const generateMockTrades = (): Trade[] => {
      const trades: Trade[] = [];
      const pairs = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'];
      
      for (let i = 0; i < 10; i++) {
        const price = 40000 + Math.random() * 10000;
        const quantity = Math.random() * 2;
        const fee = price * quantity * 0.001;
        const pnl = (Math.random() - 0.5) * 1000;
        
        trades.push({
          id: `trade${i}`,
          pair: pairs[Math.floor(Math.random() * pairs.length)],
          side: Math.random() > 0.5 ? 'buy' : 'sell',
          price,
          quantity,
          fee,
          pnl,
          timestamp: Date.now() - Math.random() * 86400000
        });
      }
      
      return trades.sort((a, b) => b.timestamp - a.timestamp);
    };

    generateMockData();
    const interval = setInterval(generateMockData, 30000);
    return () => clearInterval(interval);
  }, [userId, isAdmin]);

  // Calculate summary statistics
  const summary = useMemo((): PnLSummary => {
    const filteredData = pnlData.filter(d => {
      if (selectedPair !== 'all' && d.pair !== selectedPair) return false;
      // Add time range filtering here
      return true;
    });

    const totalRealized = filteredData.reduce((sum, d) => sum + d.realized, 0);
    const totalUnrealized = filteredData.reduce((sum, d) => sum + d.unrealized, 0);
    const totalFees = filteredData.reduce((sum, d) => sum + d.fees, 0);
    const netPnL = totalRealized + totalUnrealized - totalFees;

    const allTrades = filteredData.flatMap(d => d.trades);
    const winningTrades = allTrades.filter(t => t.pnl > 0);
    const losingTrades = allTrades.filter(t => t.pnl < 0);
    
    const winRate = allTrades.length > 0 ? (winningTrades.length / allTrades.length) * 100 : 0;
    const avgWin = winningTrades.length > 0 
      ? winningTrades.reduce((sum, t) => sum + t.pnl, 0) / winningTrades.length 
      : 0;
    const avgLoss = losingTrades.length > 0 
      ? Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0) / losingTrades.length)
      : 0;
    const profitFactor = avgLoss > 0 ? avgWin / avgLoss : 0;

    // Calculate Sharpe Ratio (simplified)
    const returns = filteredData.map(d => d.net);
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const stdDev = Math.sqrt(
      returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length
    );
    const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0;

    // Calculate max drawdown
    let peak = 0;
    let maxDrawdown = 0;
    let runningTotal = 0;
    
    filteredData.forEach(d => {
      runningTotal += d.net;
      if (runningTotal > peak) {
        peak = runningTotal;
      }
      const drawdown = (peak - runningTotal) / peak;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    });

    return {
      totalRealized,
      totalUnrealized,
      totalFees,
      netPnL,
      winRate,
      avgWin,
      avgLoss,
      profitFactor,
      sharpeRatio,
      maxDrawdown: maxDrawdown * 100,
      totalTrades: allTrades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length
    };
  }, [pnlData, selectedPair]);

  // PnL Overview Card
  const PnLOverviewCard: React.FC = () => {
    const pnlColor = summary.netPnL >= 0 ? '#4caf50' : '#f44336';
    
    const springProps = useSpring({
      from: { number: 0 },
      to: { number: summary.netPnL },
      config: { duration: 1000 }
    });

    return (
      <Card elevation={3}>
        <CardContent>
          <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
            <Typography variant="h6">P&L Overview</Typography>
            {summary.netPnL >= 0 ? 
              <TrendingUp style={{ color: pnlColor }} /> : 
              <TrendingDown style={{ color: pnlColor }} />
            }
          </Box>

          <Box textAlign="center" mb={3}>
            <animated.div style={{ fontSize: '2.5rem', fontWeight: 'bold', color: pnlColor }}>
              {springProps.number.to(n => `$${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`)}
            </animated.div>
            <Typography variant="body2" color="textSecondary">Net P&L</Typography>
          </Box>

          <Grid container spacing={2}>
            <Grid item xs={6}>
              <Box>
                <Typography variant="body2" color="textSecondary">Realized</Typography>
                <Typography variant="h6" color={summary.totalRealized >= 0 ? 'success.main' : 'error.main'}>
                  ${summary.totalRealized.toFixed(2)}
                </Typography>
              </Box>
            </Grid>
            <Grid item xs={6}>
              <Box>
                <Typography variant="body2" color="textSecondary">Unrealized</Typography>
                <Typography variant="h6" color={summary.totalUnrealized >= 0 ? 'success.main' : 'error.main'}>
                  ${summary.totalUnrealized.toFixed(2)}
                </Typography>
              </Box>
            </Grid>
            <Grid item xs={6}>
              <Box>
                <Typography variant="body2" color="textSecondary">Fees</Typography>
                <Typography variant="h6" color="warning.main">
                  -${summary.totalFees.toFixed(2)}
                </Typography>
              </Box>
            </Grid>
            <Grid item xs={6}>
              <Box>
                <Typography variant="body2" color="textSecondary">Win Rate</Typography>
                <Typography variant="h6" color={summary.winRate >= 50 ? 'success.main' : 'error.main'}>
                  {summary.winRate.toFixed(1)}%
                </Typography>
              </Box>
            </Grid>
          </Grid>
        </CardContent>
      </Card>
    );
  };

  // Performance Metrics Card
  const PerformanceMetricsCard: React.FC = () => {
    const metrics = [
      { label: 'Profit Factor', value: summary.profitFactor.toFixed(2), good: summary.profitFactor > 1.5 },
      { label: 'Sharpe Ratio', value: summary.sharpeRatio.toFixed(2), good: summary.sharpeRatio > 1 },
      { label: 'Max Drawdown', value: `${summary.maxDrawdown.toFixed(1)}%`, good: summary.maxDrawdown < 20 },
      { label: 'Avg Win', value: `$${summary.avgWin.toFixed(2)}`, good: true },
      { label: 'Avg Loss', value: `$${summary.avgLoss.toFixed(2)}`, good: false },
      { label: 'Total Trades', value: summary.totalTrades, good: true }
    ];

    return (
      <Card elevation={3}>
        <CardContent>
          <Typography variant="h6" gutterBottom>Performance Metrics</Typography>
          <Grid container spacing={2}>
            {metrics.map((metric, index) => (
              <Grid item xs={4} key={index}>
                <Box textAlign="center" p={1}>
                  <Typography variant="body2" color="textSecondary">
                    {metric.label}
                  </Typography>
                  <Typography 
                    variant="h6" 
                    color={metric.good ? 'success.main' : 'error.main'}
                  >
                    {metric.value}
                  </Typography>
                </Box>
              </Grid>
            ))}
          </Grid>
        </CardContent>
      </Card>
    );
  };

  // PnL Chart
  const PnLChart: React.FC = () => {
    const chartData = pnlData
      .filter(d => selectedPair === 'all' || d.pair === selectedPair)
      .map(d => ({
        time: format(new Date(d.timestamp), 'HH:mm'),
        realized: d.realized,
        unrealized: d.unrealized,
        net: d.net,
        cumulative: 0 // Will be calculated
      }));

    // Calculate cumulative P&L
    let cumulative = 0;
    chartData.forEach(d => {
      cumulative += d.net;
      d.cumulative = cumulative;
    });

    return (
      <Card elevation={3}>
        <CardContent>
          <Typography variant="h6" gutterBottom>P&L Timeline</Typography>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time" />
              <YAxis />
              <RechartsTooltip />
              <Legend />
              
              <Line 
                type="monotone" 
                dataKey="cumulative" 
                stroke="#ff9800" 
                strokeWidth={3}
                name="Cumulative P&L"
              />
              <Line 
                type="monotone" 
                dataKey="realized" 
                stroke="#4caf50" 
                strokeWidth={2}
                name="Realized"
              />
              <Line 
                type="monotone" 
                dataKey="unrealized" 
                stroke="#2196f3" 
                strokeWidth={2}
                name="Unrealized"
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    );
  };

  // PnL by Trading Pair
  const PnLByPairChart: React.FC = () => {
    const pairData = useMemo(() => {
      const grouped = pnlData.reduce((acc, d) => {
        if (!d.pair) return acc;
        if (!acc[d.pair]) {
          acc[d.pair] = { pair: d.pair, pnl: 0, trades: 0 };
        }
        acc[d.pair].pnl += d.net;
        acc[d.pair].trades += d.trades.length;
        return acc;
      }, {} as Record<string, any>);

      return Object.values(grouped)
        .sort((a, b) => b.pnl - a.pnl)
        .map(d => ({
          ...d,
          color: d.pnl >= 0 ? '#4caf50' : '#f44336'
        }));
    }, [pnlData]);

    return (
      <Card elevation={3}>
        <CardContent>
          <Typography variant="h6" gutterBottom>P&L by Trading Pair</Typography>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={pairData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="pair" />
              <YAxis />
              <RechartsTooltip />
              
              <Bar dataKey="pnl" name="P&L">
                {pairData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    );
  };

  // Open Positions Table
  const OpenPositionsTable: React.FC = () => {
    const openPositions = pnlData
      .flatMap(d => d.positions)
      .filter(p => !p.closeTime)
      .sort((a, b) => b.unrealizedPnL - a.unrealizedPnL);

    return (
      <Card elevation={3}>
        <CardContent>
          <Typography variant="h6" gutterBottom>Open Positions</Typography>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Pair</TableCell>
                  <TableCell>Side</TableCell>
                  <TableCell align="right">Entry</TableCell>
                  <TableCell align="right">Current</TableCell>
                  <TableCell align="right">Quantity</TableCell>
                  <TableCell align="right">Unrealized P&L</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {openPositions.slice(0, 10).map((position) => (
                  <TableRow key={position.id}>
                    <TableCell>{position.pair}</TableCell>
                    <TableCell>
                      <Chip 
                        label={position.side} 
                        size="small"
                        color={position.side === 'long' ? 'success' : 'error'}
                      />
                    </TableCell>
                    <TableCell align="right">${position.entryPrice.toFixed(2)}</TableCell>
                    <TableCell align="right">${position.currentPrice.toFixed(2)}</TableCell>
                    <TableCell align="right">{position.quantity.toFixed(4)}</TableCell>
                    <TableCell 
                      align="right"
                      style={{ color: position.unrealizedPnL >= 0 ? '#4caf50' : '#f44336' }}
                    >
                      ${position.unrealizedPnL.toFixed(2)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>
    );
  };

  // Recent Trades Table
  const RecentTradesTable: React.FC = () => {
    const recentTrades = pnlData
      .flatMap(d => d.trades)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 20);

    return (
      <Card elevation={3}>
        <CardContent>
          <Typography variant="h6" gutterBottom>Recent Trades</Typography>
          <TableContainer component={Paper} variant="outlined" style={{ maxHeight: 400 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>Time</TableCell>
                  <TableCell>Pair</TableCell>
                  <TableCell>Side</TableCell>
                  <TableCell align="right">Price</TableCell>
                  <TableCell align="right">Quantity</TableCell>
                  <TableCell align="right">Fee</TableCell>
                  <TableCell align="right">P&L</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {recentTrades.map((trade) => (
                  <TableRow key={trade.id}>
                    <TableCell>{format(new Date(trade.timestamp), 'HH:mm:ss')}</TableCell>
                    <TableCell>{trade.pair}</TableCell>
                    <TableCell>
                      <Chip 
                        label={trade.side} 
                        size="small"
                        color={trade.side === 'buy' ? 'success' : 'error'}
                      />
                    </TableCell>
                    <TableCell align="right">${trade.price.toFixed(2)}</TableCell>
                    <TableCell align="right">{trade.quantity.toFixed(4)}</TableCell>
                    <TableCell align="right">${trade.fee.toFixed(2)}</TableCell>
                    <TableCell 
                      align="right"
                      style={{ 
                        color: trade.pnl >= 0 ? '#4caf50' : '#f44336',
                        fontWeight: 'bold'
                      }}
                    >
                      ${trade.pnl.toFixed(2)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>
    );
  };

  if (loading) {
    return <LinearProgress />;
  }

  return (
    <Box p={3}>
      {/* Header */}
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4">P&L Tracking</Typography>
        
        <Box display="flex" gap={2} alignItems="center">
          <FormControl size="small" style={{ minWidth: 120 }}>
            <InputLabel>Time Range</InputLabel>
            <Select value={timeRange} onChange={(e) => setTimeRange(e.target.value)} label="Time Range">
              <MenuItem value="24h">24 Hours</MenuItem>
              <MenuItem value="7d">7 Days</MenuItem>
              <MenuItem value="30d">30 Days</MenuItem>
              <MenuItem value="all">All Time</MenuItem>
            </Select>
          </FormControl>

          <FormControl size="small" style={{ minWidth: 120 }}>
            <InputLabel>Trading Pair</InputLabel>
            <Select value={selectedPair} onChange={(e) => setSelectedPair(e.target.value)} label="Trading Pair">
              <MenuItem value="all">All Pairs</MenuItem>
              <MenuItem value="BTC/USDT">BTC/USDT</MenuItem>
              <MenuItem value="ETH/USDT">ETH/USDT</MenuItem>
              <MenuItem value="SOL/USDT">SOL/USDT</MenuItem>
            </Select>
          </FormControl>

          <ToggleButtonGroup
            value={viewMode}
            exclusive
            onChange={(e, newMode) => newMode && setViewMode(newMode)}
            size="small"
          >
            <ToggleButton value="overview">Overview</ToggleButton>
            <ToggleButton value="detailed">Detailed</ToggleButton>
            <ToggleButton value="analysis">Analysis</ToggleButton>
          </ToggleButtonGroup>

          <Tooltip title="Export Report">
            <IconButton>
              <Download />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* Main Content */}
      <Grid container spacing={3}>
        {/* Overview Section */}
        {viewMode === 'overview' && (
          <>
            <Grid item xs={12} md={4}>
              <PnLOverviewCard />
            </Grid>
            <Grid item xs={12} md={8}>
              <PerformanceMetricsCard />
            </Grid>
            <Grid item xs={12}>
              <PnLChart />
            </Grid>
            <Grid item xs={12} md={6}>
              <PnLByPairChart />
            </Grid>
            <Grid item xs={12} md={6}>
              <OpenPositionsTable />
            </Grid>
          </>
        )}

        {/* Detailed Section */}
        {viewMode === 'detailed' && (
          <>
            <Grid item xs={12}>
              <RecentTradesTable />
            </Grid>
            <Grid item xs={12}>
              <OpenPositionsTable />
            </Grid>
          </>
        )}

        {/* Analysis Section */}
        {viewMode === 'analysis' && (
          <Grid item xs={12}>
            <Card elevation={3}>
              <CardContent>
                <Typography variant="h6">Advanced Analytics Coming Soon...</Typography>
              </CardContent>
            </Card>
          </Grid>
        )}
      </Grid>
    </Box>
  );
};