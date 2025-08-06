const { getMetricsCollector } = require('./metrics-collector');
const { ethers } = require('hardhat');
const axios = require('axios');

class GasTracker {
  constructor(config = {}) {
    this.config = {
      updateInterval: config.updateInterval || 30000, // 30 seconds
      networks: config.networks || ['mainnet', 'arbitrum', 'polygon', 'optimism'],
      ethGasStationApi: config.ethGasStationApi || process.env.ETH_GAS_STATION_API,
      ...config
    };
    
    this.metrics = getMetricsCollector();
    this.isTracking = false;
    
    // Gas consumption tracking
    this.gasConsumption = {
      byOperation: {},
      byNetwork: {},
      byContract: {},
      total: 0
    };
    
    // Gas price history
    this.gasPriceHistory = new Map(); // network -> price history
    this.maxHistorySize = 2880; // 24 hours at 30s intervals
    
    // Cost tracking
    this.costTracking = {
      hourly: {},
      daily: {},
      weekly: {},
      monthly: {}
    };
    
    // Optimization suggestions
    this.optimizationThresholds = {
      highGasPrice: 100, // gwei
      lowGasPrice: 20, // gwei
      batchThreshold: 5, // min orders for batching
      gasLimit: 8000000 // block gas limit warning
    };
  }

  async start() {
    if (this.isTracking) return;
    
    console.log('⛽ Starting gas tracking...');
    this.isTracking = true;
    
    // Start gas price monitoring
    await this.updateGasPrices();
    this.gasPriceInterval = setInterval(() => {
      this.updateGasPrices();
    }, this.config.updateInterval);
    
    // Start cost aggregation
    this.startCostAggregation();
    
    console.log('✅ Gas tracking started');
  }

  async updateGasPrices() {
    for (const network of this.config.networks) {
      try {
        const gasPrice = await this.fetchGasPrice(network);
        await this.recordGasPrice(network, gasPrice);
        
        // Check for optimization opportunities
        this.checkOptimizationOpportunities(network, gasPrice);
      } catch (error) {
        console.error(`Failed to update gas price for ${network}:`, error);
      }
    }
  }

  async fetchGasPrice(network) {
    let gasData = {};
    
    switch (network) {
      case 'mainnet':
        gasData = await this.fetchEthereumGasPrice();
        break;
      case 'arbitrum':
        gasData = await this.fetchArbitrumGasPrice();
        break;
      case 'polygon':
        gasData = await this.fetchPolygonGasPrice();
        break;
      case 'optimism':
        gasData = await this.fetchOptimismGasPrice();
        break;
      default:
        throw new Error(`Unsupported network: ${network}`);
    }
    
    return gasData;
  }

  async fetchEthereumGasPrice() {
    try {
      // Try ETH Gas Station API first
      if (this.config.ethGasStationApi) {
        const response = await axios.get(
          `https://ethgasstation.info/api/ethgasAPI.json?api-key=${this.config.ethGasStationApi}`
        );
        
        return {
          slow: response.data.safeLow / 10, // Convert to gwei
          standard: response.data.average / 10,
          fast: response.data.fast / 10,
          instant: response.data.fastest / 10,
          baseFee: response.data.block_base_fee / 10 || null,
          timestamp: Date.now()
        };
      }
    } catch (error) {
      console.warn('ETH Gas Station API failed, falling back to provider');
    }
    
    // Fallback to provider
    const provider = new ethers.providers.JsonRpcProvider(
      process.env.MAINNET_RPC_URL || 'https://eth-mainnet.public.blastapi.io'
    );
    
    const gasPrice = await provider.getGasPrice();
    const block = await provider.getBlock('latest');
    
    return {
      slow: parseFloat(ethers.utils.formatUnits(gasPrice.mul(80).div(100), 'gwei')),
      standard: parseFloat(ethers.utils.formatUnits(gasPrice, 'gwei')),
      fast: parseFloat(ethers.utils.formatUnits(gasPrice.mul(120).div(100), 'gwei')),
      instant: parseFloat(ethers.utils.formatUnits(gasPrice.mul(150).div(100), 'gwei')),
      baseFee: block.baseFeePerGas 
        ? parseFloat(ethers.utils.formatUnits(block.baseFeePerGas, 'gwei'))
        : null,
      timestamp: Date.now()
    };
  }

  async fetchArbitrumGasPrice() {
    const provider = new ethers.providers.JsonRpcProvider(
      process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc'
    );
    
    const gasPrice = await provider.getGasPrice();
    
    // Arbitrum has relatively stable gas prices
    return {
      slow: parseFloat(ethers.utils.formatUnits(gasPrice.mul(90).div(100), 'gwei')),
      standard: parseFloat(ethers.utils.formatUnits(gasPrice, 'gwei')),
      fast: parseFloat(ethers.utils.formatUnits(gasPrice.mul(110).div(100), 'gwei')),
      instant: parseFloat(ethers.utils.formatUnits(gasPrice.mul(120).div(100), 'gwei')),
      timestamp: Date.now()
    };
  }

  async fetchPolygonGasPrice() {
    try {
      // Try Polygon gas station
      const response = await axios.get('https://gasstation-mainnet.matic.network/v2');
      
      return {
        slow: response.data.safeLow.maxFee,
        standard: response.data.standard.maxFee,
        fast: response.data.fast.maxFee,
        instant: response.data.fast.maxFee * 1.2,
        baseFee: response.data.estimatedBaseFee,
        timestamp: Date.now()
      };
    } catch (error) {
      // Fallback to provider
      const provider = new ethers.providers.JsonRpcProvider(
        process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com'
      );
      
      const gasPrice = await provider.getGasPrice();
      
      return {
        slow: parseFloat(ethers.utils.formatUnits(gasPrice.mul(80).div(100), 'gwei')),
        standard: parseFloat(ethers.utils.formatUnits(gasPrice, 'gwei')),
        fast: parseFloat(ethers.utils.formatUnits(gasPrice.mul(150).div(100), 'gwei')),
        instant: parseFloat(ethers.utils.formatUnits(gasPrice.mul(200).div(100), 'gwei')),
        timestamp: Date.now()
      };
    }
  }

  async fetchOptimismGasPrice() {
    const provider = new ethers.providers.JsonRpcProvider(
      process.env.OPTIMISM_RPC_URL || 'https://mainnet.optimism.io'
    );
    
    const gasPrice = await provider.getGasPrice();
    
    return {
      slow: parseFloat(ethers.utils.formatUnits(gasPrice.mul(90).div(100), 'gwei')),
      standard: parseFloat(ethers.utils.formatUnits(gasPrice, 'gwei')),
      fast: parseFloat(ethers.utils.formatUnits(gasPrice.mul(110).div(100), 'gwei')),
      instant: parseFloat(ethers.utils.formatUnits(gasPrice.mul(125).div(100), 'gwei')),
      timestamp: Date.now()
    };
  }

  async recordGasPrice(network, gasData) {
    // Update metrics
    await this.metrics.setGauge(`gas.price.${network}.slow`, gasData.slow);
    await this.metrics.setGauge(`gas.price.${network}.standard`, gasData.standard);
    await this.metrics.setGauge(`gas.price.${network}.fast`, gasData.fast);
    await this.metrics.setGauge(`gas.price.${network}.instant`, gasData.instant);
    
    if (gasData.baseFee) {
      await this.metrics.setGauge(`gas.price.${network}.base_fee`, gasData.baseFee);
    }
    
    // Store in history
    if (!this.gasPriceHistory.has(network)) {
      this.gasPriceHistory.set(network, []);
    }
    
    const history = this.gasPriceHistory.get(network);
    history.push(gasData);
    
    // Maintain size limit
    if (history.length > this.maxHistorySize) {
      history.shift();
    }
  }

  checkOptimizationOpportunities(network, gasData) {
    const opportunities = [];
    
    // Check for high gas prices
    if (gasData.standard > this.optimizationThresholds.highGasPrice) {
      opportunities.push({
        type: 'high_gas_price',
        network,
        suggestion: 'Consider delaying non-urgent transactions',
        currentPrice: gasData.standard,
        threshold: this.optimizationThresholds.highGasPrice
      });
    }
    
    // Check for low gas prices (good for batching)
    if (gasData.standard < this.optimizationThresholds.lowGasPrice) {
      opportunities.push({
        type: 'low_gas_price',
        network,
        suggestion: 'Good time for batch settlements or maintenance operations',
        currentPrice: gasData.standard,
        threshold: this.optimizationThresholds.lowGasPrice
      });
    }
    
    // Emit optimization opportunities
    opportunities.forEach(opp => {
      this.metrics.emit('optimization', opp);
    });
  }

  async recordGasConsumption(operation, network, contract, gasUsed, gasPrice) {
    const gasCost = gasUsed * gasPrice;
    
    // Update consumption tracking
    if (!this.gasConsumption.byOperation[operation]) {
      this.gasConsumption.byOperation[operation] = { count: 0, totalGas: 0, totalCost: 0 };
    }
    this.gasConsumption.byOperation[operation].count++;
    this.gasConsumption.byOperation[operation].totalGas += gasUsed;
    this.gasConsumption.byOperation[operation].totalCost += gasCost;
    
    if (!this.gasConsumption.byNetwork[network]) {
      this.gasConsumption.byNetwork[network] = { count: 0, totalGas: 0, totalCost: 0 };
    }
    this.gasConsumption.byNetwork[network].count++;
    this.gasConsumption.byNetwork[network].totalGas += gasUsed;
    this.gasConsumption.byNetwork[network].totalCost += gasCost;
    
    if (!this.gasConsumption.byContract[contract]) {
      this.gasConsumption.byContract[contract] = { count: 0, totalGas: 0, totalCost: 0 };
    }
    this.gasConsumption.byContract[contract].count++;
    this.gasConsumption.byContract[contract].totalGas += gasUsed;
    this.gasConsumption.byContract[contract].totalCost += gasCost;
    
    this.gasConsumption.total += gasUsed;
    
    // Update metrics
    await this.metrics.incrementCounter(`gas.consumption.${operation}`, gasUsed, { network, contract });
    await this.metrics.recordHistogram(`gas.usage.${operation}`, gasUsed, { network });
    await this.metrics.incrementCounter(`gas.cost.${operation}`, gasCost, { network, contract });
    
    // Update cost tracking
    this.updateCostTracking(network, gasCost);
  }

  updateCostTracking(network, cost) {
    const now = new Date();
    const hour = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}`;
    const day = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
    const week = `${now.getFullYear()}-W${this.getWeekNumber(now)}`;
    const month = `${now.getFullYear()}-${now.getMonth()}`;
    
    // Update hourly
    if (!this.costTracking.hourly[hour]) {
      this.costTracking.hourly[hour] = {};
    }
    if (!this.costTracking.hourly[hour][network]) {
      this.costTracking.hourly[hour][network] = 0;
    }
    this.costTracking.hourly[hour][network] += cost;
    
    // Update daily
    if (!this.costTracking.daily[day]) {
      this.costTracking.daily[day] = {};
    }
    if (!this.costTracking.daily[day][network]) {
      this.costTracking.daily[day][network] = 0;
    }
    this.costTracking.daily[day][network] += cost;
    
    // Update weekly
    if (!this.costTracking.weekly[week]) {
      this.costTracking.weekly[week] = {};
    }
    if (!this.costTracking.weekly[week][network]) {
      this.costTracking.weekly[week][network] = 0;
    }
    this.costTracking.weekly[week][network] += cost;
    
    // Update monthly
    if (!this.costTracking.monthly[month]) {
      this.costTracking.monthly[month] = {};
    }
    if (!this.costTracking.monthly[month][network]) {
      this.costTracking.monthly[month][network] = 0;
    }
    this.costTracking.monthly[month][network] += cost;
  }

  getWeekNumber(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  }

  startCostAggregation() {
    // Aggregate costs every hour
    this.costAggregationInterval = setInterval(async () => {
      await this.aggregateCosts();
    }, 3600000); // 1 hour
    
    // Clean up old data daily
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldData();
    }, 86400000); // 24 hours
  }

  async aggregateCosts() {
    const now = new Date();
    const currentHour = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}`;
    
    // Calculate and publish hourly costs
    if (this.costTracking.hourly[currentHour]) {
      for (const [network, cost] of Object.entries(this.costTracking.hourly[currentHour])) {
        await this.metrics.setGauge(`gas.cost.hourly.${network}`, cost);
      }
    }
    
    // Calculate daily total
    const currentDay = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
    if (this.costTracking.daily[currentDay]) {
      let dailyTotal = 0;
      for (const cost of Object.values(this.costTracking.daily[currentDay])) {
        dailyTotal += cost;
      }
      await this.metrics.setGauge('gas.cost.daily.total', dailyTotal);
    }
  }

  cleanupOldData() {
    const now = new Date();
    const oneDayAgo = now.getTime() - 86400000;
    const oneWeekAgo = now.getTime() - 604800000;
    const oneMonthAgo = now.getTime() - 2592000000;
    
    // Clean hourly data older than 1 day
    for (const hour in this.costTracking.hourly) {
      const [year, month, day, hourNum] = hour.split('-').map(Number);
      const hourDate = new Date(year, month, day, hourNum);
      if (hourDate.getTime() < oneDayAgo) {
        delete this.costTracking.hourly[hour];
      }
    }
    
    // Clean daily data older than 1 week
    for (const day in this.costTracking.daily) {
      const [year, month, dayNum] = day.split('-').map(Number);
      const dayDate = new Date(year, month, dayNum);
      if (dayDate.getTime() < oneWeekAgo) {
        delete this.costTracking.daily[day];
      }
    }
    
    // Clean weekly data older than 1 month
    for (const week in this.costTracking.weekly) {
      const [year, weekStr] = week.split('-W');
      const weekNum = parseInt(weekStr);
      const weekDate = new Date(year, 0, 1 + (weekNum - 1) * 7);
      if (weekDate.getTime() < oneMonthAgo) {
        delete this.costTracking.weekly[week];
      }
    }
  }

  getGasReport(period = 'daily') {
    const report = {
      timestamp: Date.now(),
      period,
      consumption: this.getConsumptionStats(),
      prices: this.getCurrentPrices(),
      costs: this.getCostSummary(period),
      recommendations: this.getOptimizationRecommendations()
    };
    
    return report;
  }

  getConsumptionStats() {
    const stats = {
      total: this.gasConsumption.total,
      byOperation: {},
      byNetwork: {},
      byContract: {}
    };
    
    // Calculate averages by operation
    for (const [op, data] of Object.entries(this.gasConsumption.byOperation)) {
      stats.byOperation[op] = {
        totalGas: data.totalGas,
        avgGasPerTx: data.count > 0 ? data.totalGas / data.count : 0,
        totalCost: data.totalCost,
        avgCostPerTx: data.count > 0 ? data.totalCost / data.count : 0,
        count: data.count
      };
    }
    
    // Similar for network and contract
    for (const [network, data] of Object.entries(this.gasConsumption.byNetwork)) {
      stats.byNetwork[network] = {
        totalGas: data.totalGas,
        totalCost: data.totalCost,
        percentage: this.gasConsumption.total > 0 
          ? (data.totalGas / this.gasConsumption.total) * 100 
          : 0
      };
    }
    
    return stats;
  }

  getCurrentPrices() {
    const prices = {};
    
    for (const [network, history] of this.gasPriceHistory.entries()) {
      if (history.length > 0) {
        const latest = history[history.length - 1];
        const hourAgo = Date.now() - 3600000;
        const hourAgoData = history.filter(h => h.timestamp >= hourAgo);
        
        prices[network] = {
          current: latest,
          hourlyAvg: this.calculateAverage(hourAgoData, 'standard'),
          trend: this.calculateTrend(hourAgoData, 'standard')
        };
      }
    }
    
    return prices;
  }

  calculateAverage(data, field) {
    if (data.length === 0) return 0;
    const sum = data.reduce((acc, d) => acc + d[field], 0);
    return sum / data.length;
  }

  calculateTrend(data, field) {
    if (data.length < 2) return 'stable';
    
    const firstHalf = data.slice(0, Math.floor(data.length / 2));
    const secondHalf = data.slice(Math.floor(data.length / 2));
    
    const firstAvg = this.calculateAverage(firstHalf, field);
    const secondAvg = this.calculateAverage(secondHalf, field);
    
    const changePercent = ((secondAvg - firstAvg) / firstAvg) * 100;
    
    if (changePercent > 10) return 'increasing';
    if (changePercent < -10) return 'decreasing';
    return 'stable';
  }

  getCostSummary(period) {
    const now = new Date();
    let data = {};
    
    switch (period) {
      case 'hourly':
        const currentHour = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}`;
        data = this.costTracking.hourly[currentHour] || {};
        break;
      case 'daily':
        const currentDay = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
        data = this.costTracking.daily[currentDay] || {};
        break;
      case 'weekly':
        const currentWeek = `${now.getFullYear()}-W${this.getWeekNumber(now)}`;
        data = this.costTracking.weekly[currentWeek] || {};
        break;
      case 'monthly':
        const currentMonth = `${now.getFullYear()}-${now.getMonth()}`;
        data = this.costTracking.monthly[currentMonth] || {};
        break;
    }
    
    const total = Object.values(data).reduce((sum, cost) => sum + cost, 0);
    
    return {
      total,
      byNetwork: data,
      currency: 'ETH' // Could be converted to USD with price oracle
    };
  }

  getOptimizationRecommendations() {
    const recommendations = [];
    
    // Analyze gas consumption patterns
    const highGasOperations = Object.entries(this.gasConsumption.byOperation)
      .filter(([op, data]) => data.count > 10 && data.totalGas / data.count > 100000)
      .map(([op]) => op);
    
    if (highGasOperations.length > 0) {
      recommendations.push({
        type: 'batch_operations',
        priority: 'high',
        operations: highGasOperations,
        estimatedSavings: '20-40%',
        description: 'Consider batching these high-gas operations'
      });
    }
    
    // Check for network optimization
    const networkCosts = Object.entries(this.gasConsumption.byNetwork)
      .map(([network, data]) => ({
        network,
        avgCost: data.count > 0 ? data.totalCost / data.count : 0
      }))
      .sort((a, b) => b.avgCost - a.avgCost);
    
    if (networkCosts.length > 1 && networkCosts[0].avgCost > networkCosts[1].avgCost * 2) {
      recommendations.push({
        type: 'network_optimization',
        priority: 'medium',
        currentNetwork: networkCosts[0].network,
        suggestedNetwork: networkCosts[1].network,
        estimatedSavings: `${Math.round((1 - networkCosts[1].avgCost / networkCosts[0].avgCost) * 100)}%`,
        description: 'Consider using a more cost-effective network'
      });
    }
    
    // Time-based recommendations
    const currentPrices = this.getCurrentPrices();
    for (const [network, priceData] of Object.entries(currentPrices)) {
      if (priceData.trend === 'decreasing') {
        recommendations.push({
          type: 'timing_optimization',
          priority: 'low',
          network,
          description: 'Gas prices are decreasing, good time for non-urgent operations'
        });
      }
    }
    
    return recommendations;
  }

  stop() {
    if (!this.isTracking) return;
    
    console.log('🛑 Stopping gas tracking...');
    
    clearInterval(this.gasPriceInterval);
    clearInterval(this.costAggregationInterval);
    clearInterval(this.cleanupInterval);
    
    this.isTracking = false;
    
    console.log('✅ Gas tracking stopped');
  }
}

module.exports = GasTracker;