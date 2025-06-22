"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.gasOptimizationService = void 0;
const ethers_1 = require("ethers");
const axios_1 = require("axios");
class GasOptimizationService {
    constructor() {
        this.provider = null;
        this.gasHistoryCache = new Map();
        this.ETH_PRICE_URL = 'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd';
        this.ethPriceUSD = 2000; // Default fallback
        this.initializeProvider();
        this.updateETHPrice();
    }
    static getInstance() {
        if (!GasOptimizationService.instance) {
            GasOptimizationService.instance = new GasOptimizationService();
        }
        return GasOptimizationService.instance;
    }
    async initializeProvider() {
        if (typeof window !== 'undefined' && window.ethereum) {
            this.provider = new ethers_1.ethers.BrowserProvider(window.ethereum);
        }
        else {
            // Fallback to public RPC
            this.provider = new ethers_1.ethers.JsonRpcProvider('https://eth.llamarpc.com');
        }
    }
    async updateETHPrice() {
        try {
            const response = await axios_1.default.get(this.ETH_PRICE_URL);
            this.ethPriceUSD = response.data.ethereum.usd;
        }
        catch (error) {
            console.error('Failed to fetch ETH price:', error);
        }
        // Update every 5 minutes
        setTimeout(() => this.updateETHPrice(), 5 * 60 * 1000);
    }
    async estimateGasForRoute(routeCalldata, to, from, value = '0') {
        if (!this.provider) {
            throw new Error('Provider not initialized');
        }
        const startTime = performance.now();
        try {
            // Get current gas prices
            const [gasPrice, block, feeData] = await Promise.all([
                this.provider.getGasPrice(),
                this.provider.getBlock('latest'),
                this.provider.getFeeData()
            ]);
            // Estimate gas for the transaction
            const gasEstimate = await this.provider.estimateGas({
                to,
                from,
                data: routeCalldata,
                value
            });
            // Add 10% buffer for safety
            const bufferedGasEstimate = (gasEstimate * 110n) / 100n;
            // Calculate total cost
            const totalCostWei = bufferedGasEstimate * gasPrice;
            const totalCostETH = Number(ethers_1.ethers.formatEther(totalCostWei));
            const totalCostUSD = totalCostETH * this.ethPriceUSD;
            const executionTime = performance.now() - startTime;
            const estimate = {
                estimatedGas: bufferedGasEstimate,
                gasPrice,
                maxFeePerGas: feeData.maxFeePerGas || undefined,
                maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || undefined,
                totalCostWei,
                totalCostUSD,
                executionTime
            };
            // Cache the estimate
            this.addToGasHistory(to, estimate);
            return estimate;
        }
        catch (error) {
            console.error('Gas estimation failed:', error);
            // Return a high estimate as fallback
            const fallbackGas = 300000n; // 300k gas
            const gasPrice = await this.provider.getGasPrice();
            const totalCostWei = fallbackGas * gasPrice;
            return {
                estimatedGas: fallbackGas,
                gasPrice,
                totalCostWei,
                totalCostUSD: Number(ethers_1.ethers.formatEther(totalCostWei)) * this.ethPriceUSD,
                executionTime: performance.now() - startTime
            };
        }
    }
    async compareRoutes(aggregatorCalldata, directDEXCalldatas, routerAddress, userAddress, inputAmount, expectedOutputs) {
        // Estimate gas for aggregator route
        const aggregatorGas = await this.estimateGasForRoute(aggregatorCalldata, routerAddress, userAddress, inputAmount);
        // Estimate gas for each DEX route
        const dexEstimates = await Promise.all(directDEXCalldatas.map(async (dex) => {
            const gasEstimate = await this.estimateGasForRoute(dex.calldata, routerAddress, userAddress, inputAmount);
            const expectedOutput = expectedOutputs.dexes.find(d => d.protocol === dex.protocol);
            return {
                protocol: dex.protocol,
                gasEstimate,
                outputAmount: expectedOutput?.output || '0',
                priceImpact: this.calculatePriceImpact(inputAmount, expectedOutput?.output || '0')
            };
        }));
        // Find the most gas-efficient direct route
        const mostEfficientDEX = dexEstimates.reduce((best, current) => current.gasEstimate.totalCostWei < best.gasEstimate.totalCostWei ? current : best);
        // Calculate savings
        const gasSavingsWei = mostEfficientDEX.gasEstimate.totalCostWei - aggregatorGas.totalCostWei;
        const gasSavingsPercent = Number(gasSavingsWei * 100n / mostEfficientDEX.gasEstimate.totalCostWei);
        const aggregatorOutputBN = BigInt(expectedOutputs.aggregator);
        const bestDEXOutputBN = BigInt(mostEfficientDEX.outputAmount);
        const outputImprovement = aggregatorOutputBN - bestDEXOutputBN;
        const outputImprovementPercent = bestDEXOutputBN > 0n
            ? Number(outputImprovement * 100n / bestDEXOutputBN)
            : 0;
        return {
            aggregatorRoute: {
                protocol: 'Meta-Aggregator',
                gasEstimate: aggregatorGas,
                outputAmount: expectedOutputs.aggregator,
                priceImpact: this.calculatePriceImpact(inputAmount, expectedOutputs.aggregator),
                steps: this.countRouteSteps(aggregatorCalldata)
            },
            directDEXRoutes: dexEstimates,
            savings: {
                gasSavingsWei,
                gasSavingsUSD: Number(ethers_1.ethers.formatEther(gasSavingsWei)) * this.ethPriceUSD,
                gasSavingsPercent,
                outputImprovement: Number(ethers_1.ethers.formatUnits(outputImprovement, 18)),
                outputImprovementPercent
            }
        };
    }
    calculatePriceImpact(inputAmount, outputAmount) {
        // Simplified price impact calculation
        // In production, this would use actual pool reserves
        try {
            const input = BigInt(inputAmount);
            const output = BigInt(outputAmount);
            if (input === 0n)
                return 0;
            // Assume a constant product AMM model
            const expectedOutput = input; // 1:1 for simplicity
            const actualOutput = output;
            const impact = Number((expectedOutput - actualOutput) * 10000n / expectedOutput) / 100;
            return Math.max(0, impact);
        }
        catch {
            return 0;
        }
    }
    countRouteSteps(calldata) {
        // Count the number of swaps in the route based on calldata patterns
        // This is a simplified version - in production, decode the actual calldata
        const swapSignatures = [
            '0x38ed1739', // swapExactTokensForTokens
            '0x8803dbee', // swapTokensForExactTokens
            '0x7ff36ab5', // swapExactETHForTokens
        ];
        let steps = 0;
        for (const sig of swapSignatures) {
            const matches = calldata.match(new RegExp(sig, 'g'));
            if (matches) {
                steps += matches.length;
            }
        }
        return Math.max(1, steps);
    }
    addToGasHistory(contract, estimate) {
        const history = this.gasHistoryCache.get(contract) || [];
        history.push(estimate);
        // Keep only last 100 estimates
        if (history.length > 100) {
            history.shift();
        }
        this.gasHistoryCache.set(contract, history);
    }
    getGasHistory(contract) {
        return this.gasHistoryCache.get(contract) || [];
    }
    getAverageGasForContract(contract) {
        const history = this.getGasHistory(contract);
        if (history.length === 0)
            return null;
        const avgGas = history.reduce((sum, est) => sum + est.estimatedGas, 0n) / BigInt(history.length);
        const avgCostWei = history.reduce((sum, est) => sum + est.totalCostWei, 0n) / BigInt(history.length);
        const avgCostUSD = history.reduce((sum, est) => sum + est.totalCostUSD, 0) / history.length;
        const avgTime = history.reduce((sum, est) => sum + est.executionTime, 0) / history.length;
        return {
            estimatedGas: avgGas,
            gasPrice: history[history.length - 1].gasPrice, // Use latest gas price
            totalCostWei: avgCostWei,
            totalCostUSD: avgCostUSD,
            executionTime: avgTime
        };
    }
    // Optimize route for gas efficiency
    async optimizeRoute(routes, userAddress, slippageTolerance) {
        const gasComparison = new Map();
        // Estimate gas for each route
        const routesWithGas = await Promise.all(routes.map(async (route) => {
            try {
                const gasEstimate = await this.estimateGasForRoute(route.calldata, route.routerAddress, userAddress, route.value || '0');
                gasComparison.set(route.id, gasEstimate);
                return {
                    ...route,
                    gasEstimate,
                    totalCost: gasEstimate.totalCostUSD + (Number(route.protocolFee || 0) / 1e18 * this.ethPriceUSD)
                };
            }
            catch (error) {
                console.error(`Failed to estimate gas for route ${route.id}:`, error);
                return null;
            }
        }));
        // Filter out failed estimates
        const validRoutes = routesWithGas.filter(r => r !== null);
        // Sort by total cost (gas + protocol fees)
        validRoutes.sort((a, b) => a.totalCost - b.totalCost);
        // The optimal route is the one with lowest total cost
        const optimalRoute = validRoutes[0];
        const alternativeRoutes = validRoutes.slice(1, 4); // Top 3 alternatives
        return {
            optimalRoute,
            alternativeRoutes,
            gasComparison
        };
    }
    // Get gas price statistics
    async getGasPriceStats() {
        if (!this.provider) {
            throw new Error('Provider not initialized');
        }
        const [gasPrice, block, feeData] = await Promise.all([
            this.provider.getGasPrice(),
            this.provider.getBlock('latest'),
            this.provider.getFeeData()
        ]);
        // Calculate different gas price tiers
        const standard = gasPrice;
        const slow = (standard * 90n) / 100n; // 90% of standard
        const fast = (standard * 120n) / 100n; // 120% of standard
        const instant = (standard * 150n) / 100n; // 150% of standard
        return {
            slow,
            standard,
            fast,
            instant,
            baseFee: block?.baseFeePerGas
        };
    }
}
exports.gasOptimizationService = GasOptimizationService.getInstance();
