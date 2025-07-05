import React, { useState, useEffect, useCallback } from 'react';
// Temporarily comment out missing UI imports
// import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
// import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
// import { Button } from '@/components/ui/button';
// import { Badge } from '@/components/ui/badge';
// import { Progress } from '@/components/ui/progress';
// import { Alert, AlertDescription } from '@/components/ui/alert';

// Temporary placeholder components
const Card = ({ children, className }: any) => <div className={className}>{children}</div>;
const CardContent = ({ children, className }: any) => <div className={className}>{children}</div>;
const CardDescription = ({ children }: any) => <p>{children}</p>;
const CardHeader = ({ children }: any) => <div>{children}</div>;
const CardTitle = ({ children }: any) => <h3>{children}</h3>;
const Tabs = ({ children, defaultValue, onValueChange }: any) => <div>{children}</div>;
const TabsContent = ({ children, value }: any) => <div>{children}</div>;
const TabsList = ({ children }: any) => <div>{children}</div>;
const TabsTrigger = ({ children, value }: any) => <button>{children}</button>;
const Button = ({ children, onClick, disabled, variant, size }: any) => <button onClick={onClick} disabled={disabled}>{children}</button>;
const Badge = ({ children, variant }: any) => <span>{children}</span>;
const Progress = ({ value }: any) => <div>Progress: {value}%</div>;
const Alert = ({ children }: any) => <div>{children}</div>;
const AlertDescription = ({ children }: any) => <p>{children}</p>;
// import {
//   LineChart,
//   Line,
//   AreaChart,
//   Area,
//   BarChart,
//   Bar,
//   XAxis,
//   YAxis,
//   CartesianGrid,
//   Tooltip,
//   ResponsiveContainer,
//   Legend
// } from 'recharts';

// Placeholder components for recharts
const LineChart = ({ children, data }: any) => <div>{children}</div>;
const Line = (props: any) => null;
const AreaChart = ({ children, data }: any) => <div>{children}</div>;
const Area = (props: any) => null;
const BarChart = ({ children, data }: any) => <div>{children}</div>;
const Bar = (props: any) => null;
const XAxis = (props: any) => null;
const YAxis = (props: any) => null;
const CartesianGrid = (props: any) => null;
const Tooltip = (props: any) => null;
const ResponsiveContainer = ({ children }: any) => <div>{children}</div>;
const Legend = (props: any) => null;
// import { Activity, Zap, Users, DollarSign, AlertTriangle, CheckCircle2 } from 'lucide-react';
// import { useWebSocket } from '@/hooks/useWebSocket';
// import { formatAmount, formatNumber } from '@/utils/format';

// Placeholder components and functions
const Activity = ({ className }: { className?: string }) => <span className={className}>📊</span>;
const Zap = ({ className }: { className?: string }) => <span className={className}>⚡</span>;
const Users = ({ className }: { className?: string }) => <span className={className}>👥</span>;
const DollarSign = ({ className }: { className?: string }) => <span className={className}>💲</span>;
const AlertTriangle = ({ className }: { className?: string }) => <span className={className}>⚠️</span>;
const CheckCircle2 = ({ className }: { className?: string }) => <span className={className}>✅</span>;
const useWebSocket = () => ({ 
  socket: { 
    connected: false,
    emit: (event: string, data?: any) => {},
    on: (event: string, handler: Function) => {},
    off: (event: string, handler: Function) => {}
  }, 
  connected: false, 
  send: () => {}, 
  subscribe: () => {}, 
  unsubscribe: () => {} 
});
const formatAmount = (amount: string) => amount;
const formatNumber = (num: number) => num.toString();

interface ChannelState {
  channelId: string;
  status: 'active' | 'settling' | 'finalized' | 'closed';
  participants: string[];
  balances: Record<string, string>;
  nonce: number;
  totalTrades: number;
  totalVolume: string;
  lastActivity: number;
}

interface HFTMetrics {
  totalTrades: number;
  avgLatency: number;
  p99Latency: number;
  throughput: number;
  pendingQueueSize: number;
  signatureVerificationTime: number;
}

interface ChannelMetrics {
  channelId: string;
  trades: {
    total: number;
    successful: number;
    failed: number;
  };
  latency: {
    avg: number;
    p99: number;
  };
  throughput: {
    tradesPerSecond: number;
    volumePerSecond: string;
  };
}

export const StateChannelDashboard: React.FC = () => {
  const [channels, setChannels] = useState<ChannelState[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
  const [hftMetrics, setHftMetrics] = useState<HFTMetrics | null>(null);
  const [channelMetrics, setChannelMetrics] = useState<ChannelMetrics[]>([]);
  const [latencyHistory, setLatencyHistory] = useState<any[]>([]);
  const [throughputHistory, setThroughputHistory] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  
  const { socket, connected } = useWebSocket();

  // Fetch initial data
  useEffect(() => {
    fetchChannels();
    fetchMetrics();
  }, []);

  // WebSocket subscriptions
  useEffect(() => {
    if (!socket || !connected) return;

    // Subscribe to metrics updates
    socket.emit('subscribe', { channel: 'channel_metrics' });
    
    // Subscribe to selected channel updates
    if (selectedChannel) {
      socket.emit('subscribe', { channel: `state_channel:${selectedChannel}` });
      socket.emit('subscribe', { channel: `instant_trades:${selectedChannel}` });
    }

    // Handle incoming messages
    socket.on('metrics:update', handleMetricsUpdate);
    socket.on('channel:update', handleChannelUpdate);
    socket.on('channel:event', handleChannelEvent);
    socket.on('alert', handleAlert);

    return () => {
      socket.off('metrics:update');
      socket.off('channel:update');
      socket.off('channel:event');
      socket.off('alert');
    };
  }, [socket, connected, selectedChannel]);

  const fetchChannels = async () => {
    try {
      const response = await fetch('/api/channels');
      const data = await response.json();
      setChannels(data.channels || []);
    } catch (error) {
      console.error('Failed to fetch channels:', error);
    }
  };

  const fetchMetrics = async () => {
    try {
      const response = await fetch('/api/channels/metrics');
      const data = await response.json();
      setHftMetrics(data.hft);
      setChannelMetrics(data.channels || []);
    } catch (error) {
      console.error('Failed to fetch metrics:', error);
    }
  };

  const handleMetricsUpdate = (data: any) => {
    setHftMetrics(data.data);
    
    // Update history for charts
    const timestamp = new Date(data.timestamp).toLocaleTimeString();
    
    setLatencyHistory(prev => {
      const updated = [...prev, {
        time: timestamp,
        avg: data.data.avgLatency,
        p99: data.data.p99Latency
      }];
      return updated.slice(-30); // Keep last 30 points
    });
    
    setThroughputHistory(prev => {
      const updated = [...prev, {
        time: timestamp,
        tps: data.data.throughput
      }];
      return updated.slice(-30);
    });
  };

  const handleChannelUpdate = (data: any) => {
    setChannels(prev => prev.map(ch => 
      ch.channelId === data.data.channelId 
        ? { ...ch, ...data.data.state, lastActivity: data.timestamp }
        : ch
    ));
  };

  const handleChannelEvent = (data: any) => {
    // Handle specific channel events
    if (data.event === 'trade_executed') {
      // Update trade count
      setChannels(prev => prev.map(ch => 
        ch.channelId === data.data.channelId 
          ? { ...ch, totalTrades: ch.totalTrades + 1 }
          : ch
      ));
    }
  };

  const handleAlert = (alert: any) => {
    setAlerts(prev => [...prev, { ...alert, id: Date.now() }]);
    
    // Auto-dismiss after 10 seconds
    setTimeout(() => {
      setAlerts(prev => prev.filter(a => a.id !== alert.id));
    }, 10000);
  };

  const createChannel = async () => {
    // Implementation for creating a new channel
    // This would open a modal to collect participants and parameters
  };

  const settleChannel = async (channelId: string, type: string) => {
    try {
      const response = await fetch(`/api/channels/${channelId}/settle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settlementType: type })
      });
      
      if (response.ok) {
        fetchChannels();
      }
    } catch (error) {
      console.error('Failed to settle channel:', error);
    }
  };

  return (
    <div className="container mx-auto p-4 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">State Channel Dashboard</h1>
          <p className="text-muted-foreground">
            Manage high-frequency trading channels
          </p>
        </div>
        <div className="flex gap-2">
          <Badge variant={connected ? 'default' : 'destructive'}>
            {connected ? 'Connected' : 'Disconnected'}
          </Badge>
          <Button onClick={createChannel}>Create Channel</Button>
        </div>
      </div>

      {/* Alerts */}
      {alerts.map(alert => (
        <Alert key={alert.id} variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{alert.message}</AlertDescription>
        </Alert>
      ))}

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Channels</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {channels.filter(ch => ch.status === 'active').length}
            </div>
            <p className="text-xs text-muted-foreground">
              {channels.length} total channels
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Trades</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatNumber(hftMetrics?.totalTrades || 0)}
            </div>
            <p className="text-xs text-muted-foreground">
              {hftMetrics?.throughput.toFixed(2)} TPS
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Latency</CardTitle>
            <Zap className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {hftMetrics?.avgLatency.toFixed(2)} ms
            </div>
            <p className="text-xs text-muted-foreground">
              P99: {hftMetrics?.p99Latency.toFixed(2)} ms
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Queue Size</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {hftMetrics?.pendingQueueSize || 0}
            </div>
            <Progress value={(hftMetrics?.pendingQueueSize || 0) / 100 * 100} />
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      <Tabs defaultValue="channels" className="space-y-4">
        <TabsList>
          <TabsTrigger value="channels">Channels</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="trades">Trades</TabsTrigger>
        </TabsList>

        <TabsContent value="channels" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Active Channels</CardTitle>
              <CardDescription>Monitor and manage state channels</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {channels.map(channel => (
                  <div
                    key={channel.channelId}
                    className="flex items-center justify-between p-4 border rounded-lg hover:bg-accent cursor-pointer"
                    onClick={() => setSelectedChannel(channel.channelId)}
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">
                          {channel.channelId.slice(0, 8)}...
                        </h3>
                        <Badge variant={
                          channel.status === 'active' ? 'default' : 
                          channel.status === 'settling' ? 'warning' : 
                          'secondary'
                        }>
                          {channel.status}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {channel.participants.length} participants • 
                        {channel.totalTrades} trades • 
                        {formatAmount(channel.totalVolume)} volume
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e: React.MouseEvent) => {
                          e.stopPropagation();
                          settleChannel(channel.channelId, 'periodic');
                        }}
                      >
                        Settle
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={(e: React.MouseEvent) => {
                          e.stopPropagation();
                          settleChannel(channel.channelId, 'final');
                        }}
                      >
                        Close
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="performance" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Latency Trends</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={latencyHistory}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="time" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Line 
                      type="monotone" 
                      dataKey="avg" 
                      stroke="#8884d8" 
                      name="Average"
                    />
                    <Line 
                      type="monotone" 
                      dataKey="p99" 
                      stroke="#82ca9d" 
                      name="P99"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Throughput</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={throughputHistory}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="time" />
                    <YAxis />
                    <Tooltip />
                    <Area 
                      type="monotone" 
                      dataKey="tps" 
                      stroke="#8884d8" 
                      fill="#8884d8" 
                      fillOpacity={0.6}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="trades" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Recent Trades</CardTitle>
              <CardDescription>
                Live feed of instant trades across all channels
              </CardDescription>
            </CardHeader>
            <CardContent>
              {/* Trade list would go here */}
              <div className="text-center py-8 text-muted-foreground">
                Select a channel to view trades
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};