#!/usr/bin/env node
import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Configuration
const POLLING_INTERVAL = 10000; // 10 seconds
const LOG_FILE = path.join(process.cwd(), "revenue-wallet-monitoring.log");

// Token addresses to monitor (add more as needed)
const TOKENS_TO_MONITOR = {
  USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
  DAI: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
  WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
};

// ERC-20 ABI for balance and transfer events
const ERC20_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
];

class RevenueWalletMonitor {
  constructor() {
    // Validate environment variables
    if (!process.env.REVENUE_WALLET) {
      throw new Error("REVENUE_WALLET not set in environment variables");
    }

    this.revenueWallet = process.env.REVENUE_WALLET;
    this.providers = this.initializeProviders();
    this.balances = new Map();
    this.transactionHistory = [];
  }

  initializeProviders() {
    const providers = new Map();
    
    // Initialize providers for different chains
    if (process.env.ETHEREUM_RPC) {
      providers.set("ethereum", {
        provider: new ethers.JsonRpcProvider(process.env.ETHEREUM_RPC),
        chainId: 1,
        name: "Ethereum",
      });
    }
    
    if (process.env.ARBITRUM_RPC) {
      providers.set("arbitrum", {
        provider: new ethers.JsonRpcProvider(process.env.ARBITRUM_RPC),
        chainId: 42161,
        name: "Arbitrum",
      });
    }
    
    if (process.env.POLYGON_RPC) {
      providers.set("polygon", {
        provider: new ethers.JsonRpcProvider(process.env.POLYGON_RPC),
        chainId: 137,
        name: "Polygon",
      });
    }

    return providers;
  }

  async start() {
    console.log(`\n=== Revenue Wallet Monitor Started ===`);
    console.log(`Monitoring wallet: ${this.revenueWallet}`);
    console.log(`Chains: ${Array.from(this.providers.keys()).join(", ")}`);
    console.log(`Log file: ${LOG_FILE}\n`);

    // Initial balance check
    await this.checkAllBalances();

    // Set up event listeners
    this.setupEventListeners();

    // Start polling
    setInterval(() => this.checkAllBalances(), POLLING_INTERVAL);

    console.log("Monitoring active. Press Ctrl+C to stop.\n");
  }

  async checkAllBalances() {
    const timestamp = new Date().toISOString();
    const balanceReport = [];

    for (const [chainName, chainData] of this.providers) {
      try {
        // Check native token balance
        const nativeBalance = await chainData.provider.getBalance(this.revenueWallet);
        const nativeBalanceEth = ethers.formatEther(nativeBalance);
        
        const nativeKey = `${chainName}-native`;
        const previousNative = this.balances.get(nativeKey) || "0";
        
        if (nativeBalanceEth !== previousNative) {
          const change = parseFloat(nativeBalanceEth) - parseFloat(previousNative);
          console.log(
            `[${timestamp}] ${chainData.name} ETH Balance Changed: ${previousNative} → ${nativeBalanceEth} (${change > 0 ? "+" : ""}${change.toFixed(6)})`
          );
          this.logTransaction({
            timestamp,
            chain: chainData.name,
            token: "ETH",
            previousBalance: previousNative,
            newBalance: nativeBalanceEth,
            change: change.toFixed(6),
            type: change > 0 ? "INCOMING" : "OUTGOING",
          });
        }
        
        this.balances.set(nativeKey, nativeBalanceEth);
        balanceReport.push({
          chain: chainData.name,
          token: "ETH",
          balance: nativeBalanceEth,
        });

        // Check ERC-20 token balances (only on Ethereum mainnet for now)
        if (chainName === "ethereum") {
          for (const [tokenSymbol, tokenAddress] of Object.entries(TOKENS_TO_MONITOR)) {
            try {
              const tokenContract = new ethers.Contract(
                tokenAddress,
                ERC20_ABI,
                chainData.provider
              );
              
              const [balance, decimals] = await Promise.all([
                tokenContract.balanceOf(this.revenueWallet),
                tokenContract.decimals(),
              ]);
              
              const formattedBalance = ethers.formatUnits(balance, decimals);
              const tokenKey = `${chainName}-${tokenSymbol}`;
              const previousBalance = this.balances.get(tokenKey) || "0";
              
              if (formattedBalance !== previousBalance) {
                const change = parseFloat(formattedBalance) - parseFloat(previousBalance);
                console.log(
                  `[${timestamp}] ${chainData.name} ${tokenSymbol} Balance Changed: ${previousBalance} → ${formattedBalance} (${change > 0 ? "+" : ""}${change.toFixed(6)})`
                );
                this.logTransaction({
                  timestamp,
                  chain: chainData.name,
                  token: tokenSymbol,
                  previousBalance,
                  newBalance: formattedBalance,
                  change: change.toFixed(6),
                  type: change > 0 ? "INCOMING" : "OUTGOING",
                });
              }
              
              this.balances.set(tokenKey, formattedBalance);
              
              if (parseFloat(formattedBalance) > 0) {
                balanceReport.push({
                  chain: chainData.name,
                  token: tokenSymbol,
                  balance: formattedBalance,
                });
              }
            } catch (error) {
              console.error(`Error checking ${tokenSymbol} balance:`, error.message);
            }
          }
        }
      } catch (error) {
        console.error(`Error checking balances on ${chainName}:`, error.message);
      }
    }

    // Display current balances summary
    if (this.balances.size > 0) {
      console.log("\n=== Current Wallet Balances ===");
      balanceReport.forEach(({ chain, token, balance }) => {
        if (parseFloat(balance) > 0) {
          console.log(`${chain} - ${token}: ${balance}`);
        }
      });
      console.log("===========================\n");
    }
  }

  setupEventListeners() {
    for (const [chainName, chainData] of this.providers) {
      // Listen for incoming ETH transfers
      chainData.provider.on(
        {
          address: null,
          topics: [
            ethers.id("Transfer(address,address,uint256)"),
            null,
            ethers.zeroPadValue(this.revenueWallet, 32),
          ],
        },
        (log) => {
          this.handleTransferEvent(chainName, chainData, log);
        }
      );

      // Listen for outgoing ETH transfers
      chainData.provider.on(
        {
          address: null,
          topics: [
            ethers.id("Transfer(address,address,uint256)"),
            ethers.zeroPadValue(this.revenueWallet, 32),
            null,
          ],
        },
        (log) => {
          this.handleTransferEvent(chainName, chainData, log);
        }
      );
    }
  }

  async handleTransferEvent(chainName, chainData, log) {
    try {
      const timestamp = new Date().toISOString();
      
      // For ERC-20 transfers
      if (log.address !== ethers.ZeroAddress) {
        const tokenContract = new ethers.Contract(log.address, ERC20_ABI, chainData.provider);
        const [symbol, decimals] = await Promise.all([
          tokenContract.symbol().catch(() => "UNKNOWN"),
          tokenContract.decimals().catch(() => 18),
        ]);
        
        const transferInterface = new ethers.Interface(ERC20_ABI);
        const parsedLog = transferInterface.parseLog(log);
        const amount = ethers.formatUnits(parsedLog.args.value, decimals);
        
        const isIncoming = parsedLog.args.to.toLowerCase() === this.revenueWallet.toLowerCase();
        
        console.log(
          `\n[${timestamp}] 🔔 ${isIncoming ? "INCOMING" : "OUTGOING"} Transfer Detected!`
        );
        console.log(`Chain: ${chainData.name}`);
        console.log(`Token: ${symbol}`);
        console.log(`Amount: ${amount}`);
        console.log(`From: ${parsedLog.args.from}`);
        console.log(`To: ${parsedLog.args.to}`);
        console.log(`Tx Hash: ${log.transactionHash}\n`);
        
        this.logTransaction({
          timestamp,
          chain: chainData.name,
          token: symbol,
          amount,
          from: parsedLog.args.from,
          to: parsedLog.args.to,
          txHash: log.transactionHash,
          type: isIncoming ? "INCOMING" : "OUTGOING",
          blockNumber: log.blockNumber,
        });
      }
    } catch (error) {
      console.error("Error handling transfer event:", error);
    }
  }

  logTransaction(transaction) {
    this.transactionHistory.push(transaction);
    
    // Write to log file
    const logEntry = `${JSON.stringify(transaction)}\n`;
    fs.appendFileSync(LOG_FILE, logEntry);
    
    // Keep only last 100 transactions in memory
    if (this.transactionHistory.length > 100) {
      this.transactionHistory.shift();
    }
  }

  async getTransactionHistory() {
    return this.transactionHistory;
  }

  async generateReport() {
    const report = {
      timestamp: new Date().toISOString(),
      revenueWallet: this.revenueWallet,
      currentBalances: {},
      recentTransactions: this.transactionHistory.slice(-20),
      totalIncoming: {},
      totalOutgoing: {},
    };

    // Current balances
    for (const [key, balance] of this.balances) {
      const [chain, token] = key.split("-");
      if (!report.currentBalances[chain]) {
        report.currentBalances[chain] = {};
      }
      report.currentBalances[chain][token] = balance;
    }

    // Calculate totals from transaction history
    for (const tx of this.transactionHistory) {
      if (tx.type === "INCOMING" && tx.amount) {
        const key = `${tx.chain}-${tx.token}`;
        report.totalIncoming[key] = (report.totalIncoming[key] || 0) + parseFloat(tx.amount);
      } else if (tx.type === "OUTGOING" && tx.amount) {
        const key = `${tx.chain}-${tx.token}`;
        report.totalOutgoing[key] = (report.totalOutgoing[key] || 0) + parseFloat(tx.amount);
      }
    }

    return report;
  }
}

// Signal handlers for graceful shutdown
process.on("SIGINT", () => {
  console.log("\n\nShutting down revenue wallet monitor...");
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\n\nShutting down revenue wallet monitor...");
  process.exit(0);
});

// Start the monitor
const monitor = new RevenueWalletMonitor();
monitor.start().catch((error) => {
  console.error("Failed to start revenue wallet monitor:", error);
  process.exit(1);
});

// Export for testing
export { RevenueWalletMonitor };