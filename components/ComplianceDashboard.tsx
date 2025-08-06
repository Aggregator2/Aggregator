import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
    Shield, AlertTriangle, Activity, FileText, 
    Globe, User, DollarSign, TrendingUp,
    CheckCircle, XCircle, Clock, Search
} from 'lucide-react';
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

/**
 * Compliance Dashboard for Officers
 * Real-time monitoring and management of compliance activities
 */
const ComplianceDashboard = () => {
    const [activeTab, setActiveTab] = useState('overview');
    const [stats, setStats] = useState({
        totalTransactions: 0,
        flaggedTransactions: 0,
        pendingReviews: 0,
        activeKYCs: 0,
        dailyVolume: 0,
        complianceScore: 0
    });
    const [alerts, setAlerts] = useState([]);
    const [pendingReviews, setPendingReviews] = useState([]);
    const [recentSARs, setRecentSARs] = useState([]);
    const [kycQueue, setKycQueue] = useState([]);
    
    // Load dashboard data
    useEffect(() => {
        loadDashboardData();
        const interval = setInterval(loadDashboardData, 30000); // Refresh every 30 seconds
        return () => clearInterval(interval);
    }, []);
    
    const loadDashboardData = async () => {
        try {
            // Load statistics
            const statsResponse = await fetch('/api/compliance/stats');
            const statsData = await statsResponse.json();
            setStats(statsData);
            
            // Load alerts
            const alertsResponse = await fetch('/api/compliance/alerts');
            const alertsData = await alertsResponse.json();
            setAlerts(alertsData);
            
            // Load pending reviews
            const reviewsResponse = await fetch('/api/compliance/reviews/pending');
            const reviewsData = await reviewsResponse.json();
            setPendingReviews(reviewsData);
            
            // Load recent SARs
            const sarsResponse = await fetch('/api/compliance/sars/recent');
            const sarsData = await sarsResponse.json();
            setRecentSARs(sarsData);
            
            // Load KYC queue
            const kycResponse = await fetch('/api/compliance/kyc/queue');
            const kycData = await kycResponse.json();
            setKycQueue(kycData);
            
        } catch (error) {
            console.error('Failed to load dashboard data:', error);
        }
    };
    
    return (
        <div className="p-6 space-y-6">
            {/* Header */}
            <div className="flex justify-between items-center">
                <h1 className="text-3xl font-bold">Compliance Dashboard</h1>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={loadDashboardData}>
                        Refresh
                    </Button>
                    <Button>
                        Generate Report
                    </Button>
                </div>
            </div>
            
            {/* Critical Alerts */}
            {alerts.filter(a => a.severity === 'critical').length > 0 && (
                <Alert className="border-red-500">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>
                        {alerts.filter(a => a.severity === 'critical').length} critical alerts require immediate attention
                    </AlertDescription>
                </Alert>
            )}
            
            {/* Stats Overview */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
                <StatsCard
                    title="Total Transactions"
                    value={stats.totalTransactions.toLocaleString()}
                    icon={Activity}
                    trend="+12%"
                />
                <StatsCard
                    title="Flagged"
                    value={stats.flaggedTransactions}
                    icon={AlertTriangle}
                    trend="-5%"
                    alert={stats.flaggedTransactions > 10}
                />
                <StatsCard
                    title="Pending Reviews"
                    value={stats.pendingReviews}
                    icon={Clock}
                    alert={stats.pendingReviews > 5}
                />
                <StatsCard
                    title="Active KYCs"
                    value={stats.activeKYCs}
                    icon={User}
                />
                <StatsCard
                    title="Daily Volume"
                    value={`$${(stats.dailyVolume / 1000000).toFixed(1)}M`}
                    icon={DollarSign}
                    trend="+8%"
                />
                <StatsCard
                    title="Compliance Score"
                    value={`${stats.complianceScore}%`}
                    icon={Shield}
                    status={stats.complianceScore > 90 ? 'good' : 'warning'}
                />
            </div>
            
            {/* Main Tabs */}
            <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="grid w-full grid-cols-6">
                    <TabsTrigger value="overview">Overview</TabsTrigger>
                    <TabsTrigger value="transactions">Transactions</TabsTrigger>
                    <TabsTrigger value="kyc">KYC/AML</TabsTrigger>
                    <TabsTrigger value="reports">Reports</TabsTrigger>
                    <TabsTrigger value="rules">Rules</TabsTrigger>
                    <TabsTrigger value="settings">Settings</TabsTrigger>
                </TabsList>
                
                <TabsContent value="overview">
                    <OverviewTab 
                        alerts={alerts}
                        pendingReviews={pendingReviews}
                        recentSARs={recentSARs}
                    />
                </TabsContent>
                
                <TabsContent value="transactions">
                    <TransactionsTab />
                </TabsContent>
                
                <TabsContent value="kyc">
                    <KYCTab kycQueue={kycQueue} />
                </TabsContent>
                
                <TabsContent value="reports">
                    <ReportsTab />
                </TabsContent>
                
                <TabsContent value="rules">
                    <RulesTab />
                </TabsContent>
                
                <TabsContent value="settings">
                    <SettingsTab />
                </TabsContent>
            </Tabs>
        </div>
    );
};

/**
 * Stats Card Component
 */
const StatsCard = ({ title, value, icon: Icon, trend, alert, status }) => {
    return (
        <Card className={alert ? 'border-red-500' : ''}>
            <CardContent className="p-4">
                <div className="flex items-center justify-between">
                    <div>
                        <p className="text-sm text-gray-500">{title}</p>
                        <p className="text-2xl font-bold">{value}</p>
                        {trend && (
                            <p className={`text-sm ${trend.startsWith('+') ? 'text-green-500' : 'text-red-500'}`}>
                                {trend}
                            </p>
                        )}
                    </div>
                    <Icon className={`h-8 w-8 ${alert ? 'text-red-500' : 'text-gray-400'}`} />
                </div>
                {status && (
                    <Badge 
                        variant={status === 'good' ? 'success' : 'warning'}
                        className="mt-2"
                    >
                        {status}
                    </Badge>
                )}
            </CardContent>
        </Card>
    );
};

/**
 * Overview Tab
 */
const OverviewTab = ({ alerts, pendingReviews, recentSARs }) => {
    const riskDistribution = [
        { name: 'Low', value: 45, color: '#10b981' },
        { name: 'Medium', value: 30, color: '#f59e0b' },
        { name: 'High', value: 20, color: '#ef4444' },
        { name: 'Critical', value: 5, color: '#991b1b' }
    ];
    
    const volumeTrend = [
        { time: '00:00', volume: 1.2 },
        { time: '04:00', volume: 0.8 },
        { time: '08:00', volume: 2.1 },
        { time: '12:00', volume: 3.5 },
        { time: '16:00', volume: 4.2 },
        { time: '20:00', volume: 2.8 },
        { time: '24:00', volume: 1.5 }
    ];
    
    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Active Alerts */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <AlertTriangle className="h-5 w-5" />
                        Active Alerts
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="space-y-3">
                        {alerts.slice(0, 5).map((alert, idx) => (
                            <AlertItem key={idx} alert={alert} />
                        ))}
                    </div>
                </CardContent>
            </Card>
            
            {/* Risk Distribution */}
            <Card>
                <CardHeader>
                    <CardTitle>Risk Distribution</CardTitle>
                </CardHeader>
                <CardContent>
                    <ResponsiveContainer width="100%" height={200}>
                        <PieChart>
                            <Pie
                                data={riskDistribution}
                                cx="50%"
                                cy="50%"
                                outerRadius={80}
                                dataKey="value"
                            >
                                {riskDistribution.map((entry, index) => (
                                    <Cell key={index} fill={entry.color} />
                                ))}
                            </Pie>
                            <Tooltip />
                        </PieChart>
                    </ResponsiveContainer>
                    <div className="flex justify-center gap-4 mt-4">
                        {riskDistribution.map((item) => (
                            <div key={item.name} className="flex items-center gap-2">
                                <div 
                                    className="w-3 h-3 rounded-full" 
                                    style={{ backgroundColor: item.color }}
                                />
                                <span className="text-sm">{item.name}</span>
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>
            
            {/* Volume Trend */}
            <Card>
                <CardHeader>
                    <CardTitle>24h Volume Trend</CardTitle>
                </CardHeader>
                <CardContent>
                    <ResponsiveContainer width="100%" height={200}>
                        <LineChart data={volumeTrend}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="time" />
                            <YAxis />
                            <Tooltip />
                            <Line 
                                type="monotone" 
                                dataKey="volume" 
                                stroke="#3b82f6" 
                                strokeWidth={2}
                            />
                        </LineChart>
                    </ResponsiveContainer>
                </CardContent>
            </Card>
            
            {/* Recent SARs */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <FileText className="h-5 w-5" />
                        Recent SARs
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="space-y-3">
                        {recentSARs.slice(0, 5).map((sar, idx) => (
                            <SARItem key={idx} sar={sar} />
                        ))}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
};

/**
 * Alert Item Component
 */
const AlertItem = ({ alert }) => {
    const severityColors = {
        critical: 'text-red-600 bg-red-50',
        high: 'text-orange-600 bg-orange-50',
        medium: 'text-yellow-600 bg-yellow-50',
        low: 'text-blue-600 bg-blue-50'
    };
    
    return (
        <div className="flex items-center justify-between p-3 border rounded-lg">
            <div className="flex items-center gap-3">
                <Badge className={severityColors[alert.severity]}>
                    {alert.severity}
                </Badge>
                <div>
                    <p className="font-medium">{alert.title}</p>
                    <p className="text-sm text-gray-500">{alert.description}</p>
                </div>
            </div>
            <Button size="sm" variant="outline">
                Review
            </Button>
        </div>
    );
};

/**
 * SAR Item Component
 */
const SARItem = ({ sar }) => {
    return (
        <div className="flex items-center justify-between p-3 border rounded-lg">
            <div>
                <p className="font-medium">SAR #{sar.id.slice(-8)}</p>
                <p className="text-sm text-gray-500">
                    {new Date(sar.filedAt).toLocaleDateString()} - ${sar.amount.toLocaleString()}
                </p>
            </div>
            <Badge variant={sar.status === 'filed' ? 'success' : 'warning'}>
                {sar.status}
            </Badge>
        </div>
    );
};

/**
 * Transactions Tab
 */
const TransactionsTab = () => {
    const [transactions, setTransactions] = useState([]);
    const [filter, setFilter] = useState('all');
    const [searchTerm, setSearchTerm] = useState('');
    
    return (
        <div className="space-y-4">
            {/* Filters */}
            <div className="flex gap-4">
                <Input
                    placeholder="Search transactions..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="max-w-sm"
                    icon={<Search className="h-4 w-4" />}
                />
                <Select value={filter} onValueChange={setFilter}>
                    <SelectTrigger className="w-48">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Transactions</SelectItem>
                        <SelectItem value="flagged">Flagged</SelectItem>
                        <SelectItem value="large">Large (>$10k)</SelectItem>
                        <SelectItem value="suspicious">Suspicious</SelectItem>
                    </SelectContent>
                </Select>
                <Button variant="outline">Export</Button>
            </div>
            
            {/* Transaction Table */}
            <Card>
                <CardContent className="p-0">
                    <table className="w-full">
                        <thead className="border-b">
                            <tr>
                                <th className="text-left p-4">ID</th>
                                <th className="text-left p-4">User</th>
                                <th className="text-left p-4">Amount</th>
                                <th className="text-left p-4">Type</th>
                                <th className="text-left p-4">Risk</th>
                                <th className="text-left p-4">Status</th>
                                <th className="text-left p-4">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {/* Transaction rows would be mapped here */}
                        </tbody>
                    </table>
                </CardContent>
            </Card>
        </div>
    );
};

/**
 * KYC Tab
 */
const KYCTab = ({ kycQueue }) => {
    const [selectedKyc, setSelectedKyc] = useState(null);
    
    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* KYC Queue */}
            <Card className="lg:col-span-1">
                <CardHeader>
                    <CardTitle>Verification Queue</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="space-y-3">
                        {kycQueue.map((kyc) => (
                            <div
                                key={kyc.id}
                                className="p-3 border rounded-lg cursor-pointer hover:bg-gray-50"
                                onClick={() => setSelectedKyc(kyc)}
                            >
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="font-medium">{kyc.userName}</p>
                                        <p className="text-sm text-gray-500">{kyc.submittedAt}</p>
                                    </div>
                                    <Badge variant={kyc.priority === 'high' ? 'destructive' : 'default'}>
                                        {kyc.priority}
                                    </Badge>
                                </div>
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>
            
            {/* KYC Details */}
            <Card className="lg:col-span-2">
                <CardHeader>
                    <CardTitle>Verification Details</CardTitle>
                </CardHeader>
                <CardContent>
                    {selectedKyc ? (
                        <KYCDetails kyc={selectedKyc} />
                    ) : (
                        <p className="text-gray-500">Select a verification to review</p>
                    )}
                </CardContent>
            </Card>
        </div>
    );
};

/**
 * KYC Details Component
 */
const KYCDetails = ({ kyc }) => {
    return (
        <div className="space-y-6">
            {/* User Information */}
            <div>
                <h3 className="font-semibold mb-3">User Information</h3>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <p className="text-sm text-gray-500">Name</p>
                        <p className="font-medium">{kyc.userName}</p>
                    </div>
                    <div>
                        <p className="text-sm text-gray-500">Country</p>
                        <p className="font-medium">{kyc.country}</p>
                    </div>
                    <div>
                        <p className="text-sm text-gray-500">Date of Birth</p>
                        <p className="font-medium">{kyc.dateOfBirth}</p>
                    </div>
                    <div>
                        <p className="text-sm text-gray-500">Risk Score</p>
                        <p className="font-medium">{kyc.riskScore}</p>
                    </div>
                </div>
            </div>
            
            {/* Documents */}
            <div>
                <h3 className="font-semibold mb-3">Documents</h3>
                <div className="space-y-2">
                    {kyc.documents?.map((doc, idx) => (
                        <div key={idx} className="flex items-center justify-between p-3 border rounded">
                            <div className="flex items-center gap-3">
                                <FileText className="h-5 w-5 text-gray-400" />
                                <div>
                                    <p className="font-medium">{doc.type}</p>
                                    <p className="text-sm text-gray-500">{doc.status}</p>
                                </div>
                            </div>
                            <Button size="sm" variant="outline">View</Button>
                        </div>
                    ))}
                </div>
            </div>
            
            {/* Actions */}
            <div className="flex gap-3">
                <Button className="flex-1" variant="success">
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Approve
                </Button>
                <Button className="flex-1" variant="destructive">
                    <XCircle className="h-4 w-4 mr-2" />
                    Reject
                </Button>
                <Button className="flex-1" variant="outline">
                    Request Additional
                </Button>
            </div>
        </div>
    );
};

/**
 * Reports Tab
 */
const ReportsTab = () => {
    const [reportType, setReportType] = useState('daily');
    const [dateRange, setDateRange] = useState({ start: '', end: '' });
    
    return (
        <div className="space-y-6">
            {/* Report Generation */}
            <Card>
                <CardHeader>
                    <CardTitle>Generate Reports</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <Select value={reportType} onValueChange={setReportType}>
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="daily">Daily Transaction Report</SelectItem>
                                <SelectItem value="sar">SAR Summary</SelectItem>
                                <SelectItem value="ctr">CTR Report</SelectItem>
                                <SelectItem value="kyc">KYC Status Report</SelectItem>
                                <SelectItem value="compliance">Compliance Overview</SelectItem>
                            </SelectContent>
                        </Select>
                        <Input
                            type="date"
                            placeholder="Start Date"
                            value={dateRange.start}
                            onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
                        />
                        <Input
                            type="date"
                            placeholder="End Date"
                            value={dateRange.end}
                            onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
                        />
                        <Button>Generate Report</Button>
                    </div>
                </CardContent>
            </Card>
            
            {/* Recent Reports */}
            <Card>
                <CardHeader>
                    <CardTitle>Recent Reports</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="space-y-3">
                        {/* Report list would be mapped here */}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
};

/**
 * Rules Tab
 */
const RulesTab = () => {
    const [rules, setRules] = useState([]);
    const [selectedRule, setSelectedRule] = useState(null);
    
    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Rules List */}
            <Card className="lg:col-span-1">
                <CardHeader>
                    <CardTitle>Compliance Rules</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="space-y-3">
                        {/* Rule items would be mapped here */}
                    </div>
                </CardContent>
            </Card>
            
            {/* Rule Editor */}
            <Card className="lg:col-span-2">
                <CardHeader>
                    <CardTitle>Rule Configuration</CardTitle>
                </CardHeader>
                <CardContent>
                    {selectedRule ? (
                        <RuleEditor rule={selectedRule} />
                    ) : (
                        <p className="text-gray-500">Select a rule to configure</p>
                    )}
                </CardContent>
            </Card>
        </div>
    );
};

/**
 * Rule Editor Component
 */
const RuleEditor = ({ rule }) => {
    return (
        <div className="space-y-4">
            <div>
                <label className="block text-sm font-medium mb-2">Rule Name</label>
                <Input value={rule.name} />
            </div>
            <div>
                <label className="block text-sm font-medium mb-2">Description</label>
                <textarea 
                    className="w-full p-2 border rounded"
                    rows={3}
                    value={rule.description}
                />
            </div>
            <div>
                <label className="block text-sm font-medium mb-2">Condition</label>
                <pre className="p-3 bg-gray-100 rounded text-sm">
                    {rule.condition}
                </pre>
            </div>
            <div className="flex gap-3">
                <Button>Save Changes</Button>
                <Button variant="outline">Test Rule</Button>
            </div>
        </div>
    );
};

/**
 * Settings Tab
 */
const SettingsTab = () => {
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Geo-blocking Settings */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Globe className="h-5 w-5" />
                        Geo-blocking Settings
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium mb-2">
                                Blocked Countries
                            </label>
                            <Select>
                                <SelectTrigger>
                                    <SelectValue placeholder="Add country" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="KP">North Korea</SelectItem>
                                    <SelectItem value="IR">Iran</SelectItem>
                                    <SelectItem value="SY">Syria</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div>
                            <label className="flex items-center gap-2">
                                <input type="checkbox" defaultChecked />
                                <span>Enable VPN detection</span>
                            </label>
                        </div>
                    </div>
                </CardContent>
            </Card>
            
            {/* Threshold Settings */}
            <Card>
                <CardHeader>
                    <CardTitle>Threshold Settings</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium mb-2">
                                Large Transaction Threshold
                            </label>
                            <Input type="number" defaultValue="10000" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-2">
                                Daily Limit
                            </label>
                            <Input type="number" defaultValue="50000" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-2">
                                Risk Score Threshold
                            </label>
                            <Input type="number" defaultValue="75" />
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
};

export default ComplianceDashboard;