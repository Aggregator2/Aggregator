#!/usr/bin/env node
import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { getRevenueAccumulator } from "../src/services/revenueAccumulator.js";

// Load environment variables
dotenv.config();

// Configuration
const EVENT_LOG_FILE = path.join(process.cwd(), "revenue-events.log");
const STATE_FILE = path.join(process.cwd(), ".revenue-listener-state.json");

// Contract ABIs
const SWAP_CONTRACT_ABI = [
  "event Swap(address indexed user, address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut, uint256 fee)",
  "event FeeCollected(address indexed token, uint256 amount, uint256 timestamp)",
  "event RevenueDistributed(address indexed token, uint256 amount, address indexed recipient)",
];

const ESCROW_CONTRACT_ABI = [
  "event EscrowCreated(bytes32 indexed escrowId, address indexed depositor, uint256 amount)",
  "event EscrowReleased(bytes32 indexed escrowId, address indexed recipient, uint256 amount)",
  "event EscrowFeeCollected(bytes32 indexed escrowId, uint256 feeAmount)",
];

class RevenueEventListener {
  constructor() {
    this.providers = new Map();
    this.contracts = new Map();
    this.lastProcessedBlocks = this.loadState();
    this.revenueAccumulator = getRevenueAccumulator();
    this.eventQueue = [];
    this.isProcessing = false;
  }

  loadState() {
    try {
      if (fs.existsSync(STATE_FILE)) {
        const data = fs.readFileSync(STATE_FILE, "utf-8");
        return new Map(Object.entries(JSON.parse(data)));
      }
    } catch (error) {
      console.error("Error loading state:", error);
    }
    return new Map();
  }

  saveState() {
    try {
      const state = Object.fromEntries(this.lastProcessedBlocks);
      fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    } catch (error) {
      console.error("Error saving state:", error);
    }
  }

  async initialize() {
    console.log("\n=== Revenue Event Listener Starting ===");
    
    // Initialize providers for each chain
    const chains = [
      { 
        name: "ethereum", 
        rpcUrl: process.env.ETHEREUM_RPC, 
        chainId: 1,
        contracts: {
          swap: process.env.ETHEREUM_SWAP_CONTRACT,
          escrow: process.env.ETHEREUM_ESCROW_CONTRACT,
        }
      },
      { 
        name: "arbitrum", 
        rpcUrl: process.env.ARBITRUM_RPC, 
        chainId: 42161,
        contracts: {
          swap: process.env.ARBITRUM_SWAP_CONTRACT,
          escrow: process.env.ARBITRUM_ESCROW_CONTRACT,
        }
      },
      { 
        name: "polygon", 
        rpcUrl: process.env.POLYGON_RPC, 
        chainId: 137,
        contracts: {
          swap: process.env.POLYGON_SWAP_CONTRACT,
          escrow: process.env.POLYGON_ESCROW_CONTRACT,
        }
      },
    ];

    for (const chain of chains) {
      if (chain.rpcUrl) {
        try {
          const provider = new ethers.JsonRpcProvider(chain.rpcUrl);
          this.providers.set(chain.name, { provider, chainId: chain.chainId });
          
          // Initialize contracts
          if (chain.contracts.swap) {
            const swapContract = new ethers.Contract(
              chain.contracts.swap,
              SWAP_CONTRACT_ABI,
              provider
            );
            this.contracts.set(`${chain.name}-swap`, swapContract);
            console.log(`✓ Connected to ${chain.name} swap contract: ${chain.contracts.swap}`);
          }
          
          if (chain.contracts.escrow) {
            const escrowContract = new ethers.Contract(
              chain.contracts.escrow,
              ESCROW_CONTRACT_ABI,
              provider
            );
            this.contracts.set(`${chain.name}-escrow`, escrowContract);
            console.log(`✓ Connected to ${chain.name} escrow contract: ${chain.contracts.escrow}`);
          }
          
          // Get current block number if not in state
          if (!this.lastProcessedBlocks.has(chain.name)) {
            const currentBlock = await provider.getBlockNumber();
            this.lastProcessedBlocks.set(chain.name, currentBlock);
            console.log(`✓ Starting from block ${currentBlock} on ${chain.name}`);
          }
        } catch (error) {
          console.error(`✗ Failed to initialize ${chain.name}:`, error.message);
        }
      }
    }
    
    console.log("\n=== Event Listener Ready ===\n");
  }

  async start() {
    await this.initialize();
    
    // Set up event listeners for each contract
    this.setupEventListeners();
    
    // Start processing queue
    this.startQueueProcessor();
    
    // Catch up on missed events
    await this.catchUpMissedEvents();
    
    console.log("Listening for revenue events. Press Ctrl+C to stop.\n");
  }

  setupEventListeners() {
    // Swap contract events
    for (const [key, contract] of this.contracts) {
      if (key.includes("-swap")) {
        const chainName = key.split("-")[0];
        
        // Listen for Swap events
        contract.on("Swap", async (user, tokenIn, tokenOut, amountIn, amountOut, fee, event) => {
          this.queueEvent({
            type: "Swap",
            chain: chainName,
            data: { user, tokenIn, tokenOut, amountIn, amountOut, fee },
            event,
          });
        });
        
        // Listen for FeeCollected events
        contract.on("FeeCollected", async (token, amount, timestamp, event) => {
          this.queueEvent({
            type: "FeeCollected",
            chain: chainName,
            data: { token, amount, timestamp },
            event,
          });
        });
        
        // Listen for RevenueDistributed events
        contract.on("RevenueDistributed", async (token, amount, recipient, event) => {
          this.queueEvent({
            type: "RevenueDistributed",
            chain: chainName,
            data: { token, amount, recipient },
            event,
          });
        });
      }
      
      // Escrow contract events
      if (key.includes("-escrow")) {
        const chainName = key.split("-")[0];
        
        // Listen for EscrowFeeCollected events
        contract.on("EscrowFeeCollected", async (escrowId, feeAmount, event) => {
          this.queueEvent({
            type: "EscrowFeeCollected",
            chain: chainName,
            data: { escrowId, feeAmount },
            event,
          });
        });
      }
    }
  }

  queueEvent(eventData) {
    this.eventQueue.push(eventData);
    console.log(`[${new Date().toISOString()}] Queued ${eventData.type} event from ${eventData.chain}`);
  }

  async startQueueProcessor() {
    setInterval(async () => {
      if (!this.isProcessing && this.eventQueue.length > 0) {
        this.isProcessing = true;
        
        while (this.eventQueue.length > 0) {
          const event = this.eventQueue.shift();
          await this.processEvent(event);
        }
        
        this.isProcessing = false;
      }
    }, 1000); // Process queue every second
  }

  async processEvent(eventData) {
    const { type, chain, data, event } = eventData;
    const timestamp = new Date().toISOString();
    
    console.log(`\n[${timestamp}] Processing ${type} event from ${chain}`);
    console.log(`Block: ${event.blockNumber}, Tx: ${event.transactionHash}`);
    
    try {
      switch (type) {
        case "Swap":
          await this.handleSwapEvent(chain, data, event);
          break;
          
        case "FeeCollected":
          await this.handleFeeCollectedEvent(chain, data, event);
          break;
          
        case "RevenueDistributed":
          await this.handleRevenueDistributedEvent(chain, data, event);
          break;
          
        case "EscrowFeeCollected":
          await this.handleEscrowFeeEvent(chain, data, event);
          break;
      }
      
      // Update last processed block
      const currentBlock = this.lastProcessedBlocks.get(chain) || 0;
      if (event.blockNumber > currentBlock) {
        this.lastProcessedBlocks.set(chain, event.blockNumber);
        this.saveState();
      }
      
      // Log event
      this.logEvent({
        timestamp,
        type,
        chain,
        blockNumber: event.blockNumber,
        transactionHash: event.transactionHash,
        data,
      });
    } catch (error) {
      console.error(`Error processing ${type} event:`, error);
    }
  }

  async handleSwapEvent(chain, data, event) {
    const { user, tokenIn, tokenOut, amountIn, amountOut, fee } = data;
    
    console.log(`User: ${user}`);
    console.log(`Token In: ${tokenIn} (Amount: ${ethers.formatUnits(amountIn, 18)})`);
    console.log(`Token Out: ${tokenOut} (Amount: ${ethers.formatUnits(amountOut, 18)})`);
    console.log(`Fee Collected: ${ethers.formatUnits(fee, 18)}`);
    
    // If fee is collected, add to revenue accumulator
    if (fee > 0n) {
      // Get token price (you'd implement proper price fetching here)
      const tokenPrice = await this.getTokenPrice(tokenOut, chain);
      
      await this.revenueAccumulator.addFeeCollection({
        feeAmount: fee.toString(),
        feeToken: tokenOut,
        tokenUsdPrice: tokenPrice,
        timestamp: Date.now(),
        chainId: this.providers.get(chain).chainId,
      });
    }
  }

  async handleFeeCollectedEvent(chain, data, event) {
    const { token, amount, timestamp } = data;
    
    console.log(`Fee Token: ${token}`);
    console.log(`Fee Amount: ${ethers.formatUnits(amount, 18)}`);
    console.log(`Collection Time: ${new Date(Number(timestamp) * 1000).toISOString()}`);
    
    // Get token price
    const tokenPrice = await this.getTokenPrice(token, chain);
    
    // Add to revenue accumulator
    await this.revenueAccumulator.addFeeCollection({
      feeAmount: amount.toString(),
      feeToken: token === ethers.ZeroAddress ? "ETH" : token,
      tokenUsdPrice: tokenPrice,
      timestamp: Number(timestamp) * 1000,
      chainId: this.providers.get(chain).chainId,
    });
  }

  async handleRevenueDistributedEvent(chain, data, event) {
    const { token, amount, recipient } = data;
    
    console.log(`✅ Revenue Distributed!`);
    console.log(`Token: ${token}`);
    console.log(`Amount: ${ethers.formatUnits(amount, 18)}`);
    console.log(`Recipient: ${recipient}`);
    
    // Check if this is our revenue wallet
    if (recipient.toLowerCase() === process.env.REVENUE_WALLET?.toLowerCase()) {
      console.log(`🎉 Revenue received in wallet!`);
    }
  }

  async handleEscrowFeeEvent(chain, data, event) {
    const { escrowId, feeAmount } = data;
    
    console.log(`Escrow ID: ${escrowId}`);
    console.log(`Fee Amount: ${ethers.formatUnits(feeAmount, 18)}`);
    
    // Escrow fees are typically in the native token
    const tokenPrice = await this.getTokenPrice(ethers.ZeroAddress, chain);
    
    await this.revenueAccumulator.addFeeCollection({
      feeAmount: feeAmount.toString(),
      feeToken: "ETH",
      tokenUsdPrice: tokenPrice,
      timestamp: Date.now(),
      chainId: this.providers.get(chain).chainId,
    });
  }

  async getTokenPrice(tokenAddress, chain) {
    // Implement actual price fetching logic here
    // For now, return mock prices
    const mockPrices = {
      [ethers.ZeroAddress]: 2000, // ETH
      "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48": 1, // USDC
      "0xdAC17F958D2ee523a2206206994597C13D831ec7": 1, // USDT
      "0x6B175474E89094C44Da98b954EedeAC495271d0F": 1, // DAI
    };
    
    return mockPrices[tokenAddress] || 1;
  }

  async catchUpMissedEvents() {
    console.log("\nChecking for missed events...");
    
    for (const [chainName, { provider, chainId }] of this.providers) {
      try {
        const currentBlock = await provider.getBlockNumber();
        const lastProcessed = this.lastProcessedBlocks.get(chainName) || currentBlock - 1000;
        
        if (currentBlock > lastProcessed + 1) {
          console.log(`Catching up ${currentBlock - lastProcessed} blocks on ${chainName}...`);
          
          // Process in chunks to avoid overwhelming the RPC
          const chunkSize = 1000;
          for (let fromBlock = lastProcessed + 1; fromBlock <= currentBlock; fromBlock += chunkSize) {
            const toBlock = Math.min(fromBlock + chunkSize - 1, currentBlock);
            
            // Query events for each contract
            for (const [key, contract] of this.contracts) {
              if (key.startsWith(chainName)) {
                const events = await contract.queryFilter({}, fromBlock, toBlock);
                
                for (const event of events) {
                  // Process each event
                  await this.processEventFromLog(chainName, event);
                }
              }
            }
          }
          
          this.lastProcessedBlocks.set(chainName, currentBlock);
          this.saveState();
        }
      } catch (error) {
        console.error(`Error catching up events on ${chainName}:`, error.message);
      }
    }
    
    console.log("Finished catching up missed events.\n");
  }

  async processEventFromLog(chain, log) {
    // Parse the event based on its signature
    const eventSignatures = {
      "Swap(address,address,address,uint256,uint256,uint256)": "Swap",
      "FeeCollected(address,uint256,uint256)": "FeeCollected",
      "RevenueDistributed(address,uint256,address)": "RevenueDistributed",
      "EscrowFeeCollected(bytes32,uint256)": "EscrowFeeCollected",
    };
    
    for (const [sig, eventType] of Object.entries(eventSignatures)) {
      if (log.topics[0] === ethers.id(sig)) {
        // Queue the event for processing
        this.queueEvent({
          type: eventType,
          chain,
          data: log.args,
          event: log,
        });
        break;
      }
    }
  }

  logEvent(eventData) {
    const logEntry = `${JSON.stringify(eventData)}\n`;
    fs.appendFileSync(EVENT_LOG_FILE, logEntry);
  }

  async generateEventSummary() {
    const summary = {
      timestamp: new Date().toISOString(),
      lastProcessedBlocks: Object.fromEntries(this.lastProcessedBlocks),
      revenueState: this.revenueAccumulator.getState(),
      queueLength: this.eventQueue.length,
    };
    
    return summary;
  }
}

// Signal handlers
process.on("SIGINT", async () => {
  console.log("\n\nShutting down event listener...");
  // Save state before exit
  listener.saveState();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n\nShutting down event listener...");
  listener.saveState();
  process.exit(0);
});

// Start the listener
const listener = new RevenueEventListener();
listener.start().catch((error) => {
  console.error("Failed to start event listener:", error);
  process.exit(1);
});

export { RevenueEventListener };