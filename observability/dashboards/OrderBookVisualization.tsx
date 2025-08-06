import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Box, 
  Card, 
  CardContent, 
  Typography, 
  Select, 
  MenuItem, 
  FormControl,
  InputLabel,
  Chip,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Grid,
  Button,
  ButtonGroup,
  ToggleButton,
  ToggleButtonGroup,
  Slider,
  Switch,
  FormControlLabel
} from '@mui/material';
import { 
  ShowChart, 
  BarChart as BarChartIcon,
  BubbleChart,
  Timeline,
  Speed
} from '@mui/icons-material';
import * as d3 from 'd3';
import { scaleLinear, scaleBand, scaleSequential } from 'd3-scale';
import { interpolateRdYlGn } from 'd3-scale-chromatic';
import { animated, useSpring, config } from 'react-spring';

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

interface MarketDepthLevel {
  price: number;
  bidVolume: number;
  askVolume: number;
  bidOrders: number;
  askOrders: number;
  cumulativeBid: number;
  cumulativeAsk: number;
}

interface OrderBookVisualizationProps {
  data: OrderBookData;
  onPairChange: (pair: string) => void;
  availablePairs: string[];
}

export const OrderBookVisualization: React.FC<OrderBookVisualizationProps> = ({
  data,
  onPairChange,
  availablePairs
}) => {
  const [viewMode, setViewMode] = useState<'depth' | 'heatmap' | 'flow' | '3d'>('depth');
  const [priceRange, setPriceRange] = useState<[number, number]>([0, 100]);
  const [depthLevels, setDepthLevels] = useState(20);
  const [showAnimations, setShowAnimations] = useState(true);
  const [autoScale, setAutoScale] = useState(true);
  
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Calculate market depth levels
  const marketDepthLevels = useMemo((): MarketDepthLevel[] => {
    if (!data) return [];

    const levels: MarketDepthLevel[] = [];
    const allPrices = new Set<number>();

    // Collect all unique prices
    data.bids.forEach(bid => allPrices.add(bid.price));
    data.asks.forEach(ask => allPrices.add(ask.price));

    // Sort prices
    const sortedPrices = Array.from(allPrices).sort((a, b) => a - b);

    // Create depth levels
    let cumulativeBid = 0;
    let cumulativeAsk = 0;

    sortedPrices.forEach(price => {
      const bid = data.bids.find(b => b.price === price);
      const ask = data.asks.find(a => a.price === price);

      if (bid) cumulativeBid += bid.volume;
      if (ask) cumulativeAsk += ask.volume;

      levels.push({
        price,
        bidVolume: bid?.volume || 0,
        askVolume: ask?.volume || 0,
        bidOrders: bid?.orderCount || 0,
        askOrders: ask?.orderCount || 0,
        cumulativeBid: bid ? cumulativeBid : 0,
        cumulativeAsk: ask ? cumulativeAsk : 0
      });
    });

    return levels;
  }, [data]);

  // Depth Chart Visualization
  const DepthChart: React.FC = () => {
    useEffect(() => {
      if (!svgRef.current || !data) return;

      const svg = d3.select(svgRef.current);
      svg.selectAll('*').remove();

      const margin = { top: 20, right: 30, bottom: 40, left: 60 };
      const width = containerRef.current?.clientWidth || 800;
      const height = 400;
      const innerWidth = width - margin.left - margin.right;
      const innerHeight = height - margin.top - margin.bottom;

      const g = svg
        .attr('width', width)
        .attr('height', height)
        .append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`);

      // Scales
      const xScale = scaleLinear()
        .domain([
          Math.min(...marketDepthLevels.map(d => d.price)),
          Math.max(...marketDepthLevels.map(d => d.price))
        ])
        .range([0, innerWidth]);

      const yScale = scaleLinear()
        .domain([
          0,
          Math.max(
            ...marketDepthLevels.map(d => Math.max(d.cumulativeBid, d.cumulativeAsk))
          )
        ])
        .range([innerHeight, 0]);

      // Area generators
      const bidArea = d3.area<MarketDepthLevel>()
        .x(d => xScale(d.price))
        .y0(innerHeight)
        .y1(d => yScale(d.cumulativeBid))
        .curve(d3.curveStepAfter);

      const askArea = d3.area<MarketDepthLevel>()
        .x(d => xScale(d.price))
        .y0(innerHeight)
        .y1(d => yScale(d.cumulativeAsk))
        .curve(d3.curveStepBefore);

      // Draw areas
      g.append('path')
        .datum(marketDepthLevels.filter(d => d.bidVolume > 0))
        .attr('fill', '#4caf50')
        .attr('fill-opacity', 0.3)
        .attr('stroke', '#4caf50')
        .attr('stroke-width', 2)
        .attr('d', bidArea);

      g.append('path')
        .datum(marketDepthLevels.filter(d => d.askVolume > 0))
        .attr('fill', '#f44336')
        .attr('fill-opacity', 0.3)
        .attr('stroke', '#f44336')
        .attr('stroke-width', 2)
        .attr('d', askArea);

      // Mid price line
      g.append('line')
        .attr('x1', xScale(data.midPrice))
        .attr('y1', 0)
        .attr('x2', xScale(data.midPrice))
        .attr('y2', innerHeight)
        .attr('stroke', '#ff9800')
        .attr('stroke-width', 2)
        .attr('stroke-dasharray', '5,5');

      // Axes
      g.append('g')
        .attr('transform', `translate(0,${innerHeight})`)
        .call(d3.axisBottom(xScale).tickFormat(d => `$${d}`));

      g.append('g')
        .call(d3.axisLeft(yScale).tickFormat(d => `${d}`));

      // Labels
      g.append('text')
        .attr('transform', 'rotate(-90)')
        .attr('y', 0 - margin.left)
        .attr('x', 0 - innerHeight / 2)
        .attr('dy', '1em')
        .style('text-anchor', 'middle')
        .text('Cumulative Volume');

      g.append('text')
        .attr('transform', `translate(${innerWidth / 2}, ${innerHeight + margin.bottom})`)
        .style('text-anchor', 'middle')
        .text('Price');

    }, [data, marketDepthLevels]);

    return (
      <Box ref={containerRef} width="100%" height={400}>
        <svg ref={svgRef}></svg>
      </Box>
    );
  };

  // Heatmap Visualization
  const HeatmapVisualization: React.FC = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
      if (!canvasRef.current || !data) return;

      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const width = canvas.width = containerRef.current?.clientWidth || 800;
      const height = canvas.height = 400;

      // Clear canvas
      ctx.clearRect(0, 0, width, height);

      const levels = marketDepthLevels.slice(0, depthLevels);
      const cellWidth = width / levels.length;
      const cellHeight = height / 2;

      // Color scale
      const colorScale = scaleSequential(interpolateRdYlGn)
        .domain([0, Math.max(...levels.map(l => Math.max(l.bidVolume, l.askVolume)))]);

      // Draw heatmap
      levels.forEach((level, i) => {
        // Bid side
        ctx.fillStyle = colorScale(level.bidVolume);
        ctx.fillRect(i * cellWidth, 0, cellWidth - 1, cellHeight - 1);

        // Ask side
        ctx.fillStyle = colorScale(level.askVolume);
        ctx.fillRect(i * cellWidth, cellHeight, cellWidth - 1, cellHeight - 1);

        // Price labels
        if (i % 5 === 0) {
          ctx.fillStyle = '#000';
          ctx.font = '10px Arial';
          ctx.save();
          ctx.translate(i * cellWidth + cellWidth / 2, height - 5);
          ctx.rotate(-Math.PI / 4);
          ctx.fillText(`$${level.price.toFixed(2)}`, 0, 0);
          ctx.restore();
        }
      });

      // Labels
      ctx.fillStyle = '#000';
      ctx.font = '14px Arial';
      ctx.fillText('BIDS', 10, 20);
      ctx.fillText('ASKS', 10, cellHeight + 20);

    }, [data, marketDepthLevels, depthLevels]);

    return (
      <Box ref={containerRef} width="100%" height={400}>
        <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />
      </Box>
    );
  };

  // Order Flow Visualization
  const OrderFlowVisualization: React.FC = () => {
    const [flowData, setFlowData] = useState<any[]>([]);

    useEffect(() => {
      // Simulate order flow data
      const interval = setInterval(() => {
        const newFlow = {
          id: Date.now(),
          side: Math.random() > 0.5 ? 'bid' : 'ask',
          price: data.midPrice + (Math.random() - 0.5) * 10,
          volume: Math.random() * 1000,
          timestamp: Date.now()
        };

        setFlowData(prev => [...prev.slice(-50), newFlow]);
      }, 500);

      return () => clearInterval(interval);
    }, [data]);

    const springProps = useSpring({
      from: { opacity: 0, transform: 'scale(0.8)' },
      to: { opacity: 1, transform: 'scale(1)' },
      config: config.gentle
    });

    return (
      <Box height={400} overflow="hidden" position="relative">
        {flowData.map((flow, index) => (
          <animated.div
            key={flow.id}
            style={{
              ...springProps,
              position: 'absolute',
              left: `${(flow.price - data.midPrice + 50) * 8}px`,
              top: `${index * 7}px`,
              width: `${Math.log(flow.volume) * 10}px`,
              height: '5px',
              backgroundColor: flow.side === 'bid' ? '#4caf50' : '#f44336',
              borderRadius: '2px',
              opacity: 1 - index / flowData.length
            }}
          />
        ))}
        
        <Box
          position="absolute"
          left="50%"
          top={0}
          bottom={0}
          width={2}
          bgcolor="warning.main"
          style={{ transform: 'translateX(-50%)' }}
        />
      </Box>
    );
  };

  // Order Book Table
  const OrderBookTable: React.FC = () => {
    const maxRows = 15;
    const bids = data.bids.slice(0, maxRows);
    const asks = data.asks.slice(0, maxRows);

    return (
      <Grid container spacing={2}>
        <Grid item xs={6}>
          <Typography variant="subtitle2" color="success.main" gutterBottom>
            BIDS
          </Typography>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Price</TableCell>
                  <TableCell align="right">Volume</TableCell>
                  <TableCell align="right">Total</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {bids.map((bid, index) => (
                  <TableRow key={index}>
                    <TableCell style={{ color: '#4caf50' }}>
                      ${bid.price.toFixed(2)}
                    </TableCell>
                    <TableCell align="right">{bid.volume.toFixed(4)}</TableCell>
                    <TableCell align="right">{bid.total.toFixed(4)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Grid>

        <Grid item xs={6}>
          <Typography variant="subtitle2" color="error.main" gutterBottom>
            ASKS
          </Typography>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Price</TableCell>
                  <TableCell align="right">Volume</TableCell>
                  <TableCell align="right">Total</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {asks.map((ask, index) => (
                  <TableRow key={index}>
                    <TableCell style={{ color: '#f44336' }}>
                      ${ask.price.toFixed(2)}
                    </TableCell>
                    <TableCell align="right">{ask.volume.toFixed(4)}</TableCell>
                    <TableCell align="right">{ask.total.toFixed(4)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Grid>
      </Grid>
    );
  };

  // Market Metrics
  const MarketMetrics: React.FC = () => {
    const metrics = [
      { label: 'Spread', value: `$${data.spread.toFixed(2)}`, color: 'warning' },
      { label: 'Mid Price', value: `$${data.midPrice.toFixed(2)}`, color: 'info' },
      { label: 'Bid Depth', value: data.depth.bid.toFixed(2), color: 'success' },
      { label: 'Ask Depth', value: data.depth.ask.toFixed(2), color: 'error' },
      { 
        label: 'Imbalance', 
        value: `${(data.imbalance * 100).toFixed(1)}%`, 
        color: data.imbalance > 0 ? 'success' : 'error' 
      }
    ];

    return (
      <Box display="flex" gap={2} flexWrap="wrap" mb={2}>
        {metrics.map((metric, index) => (
          <Chip
            key={index}
            label={`${metric.label}: ${metric.value}`}
            color={metric.color as any}
            variant="outlined"
          />
        ))}
      </Box>
    );
  };

  return (
    <Card elevation={3}>
      <CardContent>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
          <Typography variant="h5">Order Book - {data.pair}</Typography>
          
          <Box display="flex" gap={2} alignItems="center">
            <FormControl size="small" style={{ minWidth: 120 }}>
              <InputLabel>Trading Pair</InputLabel>
              <Select
                value={data.pair}
                onChange={(e) => onPairChange(e.target.value)}
                label="Trading Pair"
              >
                {availablePairs.map(pair => (
                  <MenuItem key={pair} value={pair}>{pair}</MenuItem>
                ))}
              </Select>
            </FormControl>

            <ToggleButtonGroup
              value={viewMode}
              exclusive
              onChange={(e, newMode) => newMode && setViewMode(newMode)}
              size="small"
            >
              <ToggleButton value="depth">
                <ShowChart />
              </ToggleButton>
              <ToggleButton value="heatmap">
                <BarChartIcon />
              </ToggleButton>
              <ToggleButton value="flow">
                <Timeline />
              </ToggleButton>
              <ToggleButton value="3d">
                <BubbleChart />
              </ToggleButton>
            </ToggleButtonGroup>

            <FormControlLabel
              control={
                <Switch
                  checked={showAnimations}
                  onChange={(e) => setShowAnimations(e.target.checked)}
                  size="small"
                />
              }
              label="Animations"
            />
          </Box>
        </Box>

        <MarketMetrics />

        <Box mt={3}>
          {viewMode === 'depth' && <DepthChart />}
          {viewMode === 'heatmap' && <HeatmapVisualization />}
          {viewMode === 'flow' && <OrderFlowVisualization />}
          {viewMode === '3d' && (
            <Box height={400} display="flex" alignItems="center" justifyContent="center">
              <Typography color="textSecondary">3D visualization coming soon...</Typography>
            </Box>
          )}
        </Box>

        <Box mt={3}>
          <Typography variant="h6" gutterBottom>Order Book</Typography>
          <OrderBookTable />
        </Box>

        {viewMode === 'depth' && (
          <Box mt={3}>
            <Typography variant="subtitle2" gutterBottom>Depth Levels</Typography>
            <Slider
              value={depthLevels}
              onChange={(e, value) => setDepthLevels(value as number)}
              min={5}
              max={50}
              step={5}
              marks
              valueLabelDisplay="auto"
            />
          </Box>
        )}
      </CardContent>
    </Card>
  );
};