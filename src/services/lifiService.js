"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.lifiService = void 0;
const axios_1 = require("axios");
const sdk_1 = require("@lifi/sdk");
const devLogger_1 = require("../utils/devLogger");
const LIFI_BASE_URL = 'https://li.quest/v1';
class LifiService {
    constructor() {
        this.chainsCache = new Map();
        this.tokensCache = new Map();
        this.cacheTimestamp = 0;
        this.CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours
    }
    async getChains() {
        try {
            // Use SDK method
            const chains = await (0, sdk_1.getChains)();
            // Cache chains
            chains.forEach((chain) => {
                this.chainsCache.set(chain.id, chain);
            });
            return chains;
        }
        catch (error) {
            devLogger_1.lifiLogger.error('Error fetching LI.FI chains:', error);
            throw error;
        }
    }
    async getTokens(chainId) {
        // Check cache first
        if (chainId && this.tokensCache.has(chainId) && Date.now() - this.cacheTimestamp < this.CACHE_DURATION) {
            return this.tokensCache.get(chainId);
        }
        try {
            // Use SDK method - if no chainId, get ALL tokens
            const tokensResponse = await (0, sdk_1.getTokens)(chainId ? { chains: [chainId] } : {});
            if (chainId) {
                const tokens = tokensResponse.tokens[chainId] || [];
                // Cache tokens for specific chain
                this.tokensCache.set(chainId, tokens);
                this.cacheTimestamp = Date.now();
                return tokens;
            }
            else {
                // Return all tokens from all chains
                const allTokens = [];
                Object.entries(tokensResponse.tokens).forEach(([chain, tokens]) => {
                    allTokens.push(...tokens);
                });
                return allTokens;
            }
        }
        catch (error) {
            devLogger_1.lifiLogger.error(`Error fetching tokens:`, error);
            throw error;
        }
    }
    async getAllTokens() {
        const chains = await this.getChains();
        const allTokens = new Map();
        // Fetch tokens for all chains in parallel
        const promises = chains.map(async (chain) => {
            try {
                const tokens = await this.getTokens(chain.id);
                allTokens.set(chain.id, tokens);
            }
            catch (error) {
                devLogger_1.lifiLogger.error(`Failed to fetch tokens for chain ${chain.id}:`, error);
                allTokens.set(chain.id, []);
            }
        });
        await Promise.all(promises);
        return allTokens;
    }
    async getQuote(request) {
        try {
            // Use SDK method with correct parameters
            const quoteRequest = {
                fromChain: request.fromChain.toString(),
                toChain: request.toChain.toString(),
                fromToken: request.fromToken,
                toToken: request.toToken,
                fromAmount: request.fromAmount,
                fromAddress: request.fromAddress,
                toAddress: request.toAddress || request.fromAddress,
                slippage: (request.slippage || 0.5) / 100, // Convert percentage to decimal
                integrator: 'multi-chain-swap',
                allowBridges: ['hop', 'cbridge', 'stargate', 'across', 'optimism', 'arbitrum', 'polygon']
            };
            const quote = await (0, sdk_1.getQuote)(quoteRequest);
            return quote.routes || [];
        }
        catch (error) {
            devLogger_1.lifiLogger.error('Error fetching LI.FI quote:', error);
            // If it's a 400 error, it might be because the token pair is not supported
            if (error.response?.status === 400) {
                devLogger_1.lifiLogger.error('LI.FI quote error details:', error.response?.data);
                throw new Error('Quote not available for this token pair');
            }
            throw error;
        }
    }
    async executeSwap(route, userAddress) {
        try {
            const response = await axios_1.default.post(`${LIFI_BASE_URL}/advanced/routes`, {
                route,
                fromAddress: userAddress,
                toAddress: userAddress,
                integrator: 'multi-chain-swap'
            }, {
                headers: {
                    'x-lifi-api-key': process.env.LIFI_API_KEY
                }
            });
            return response.data;
        }
        catch (error) {
            devLogger_1.lifiLogger.error('Error executing LI.FI swap:', error);
            throw error;
        }
    }
    // Clear cache method for manual refresh
    clearCache() {
        this.chainsCache.clear();
        this.tokensCache.clear();
        this.cacheTimestamp = 0;
    }
    // Get cached data if available
    getCachedChains() {
        return Array.from(this.chainsCache.values());
    }
    getCachedTokens(chainId) {
        if (chainId) {
            return this.tokensCache.get(chainId) || [];
        }
        // Return all cached tokens
        const allTokens = [];
        this.tokensCache.forEach(tokens => {
            allTokens.push(...tokens);
        });
        return allTokens;
    }
}
exports.lifiService = new LifiService();
