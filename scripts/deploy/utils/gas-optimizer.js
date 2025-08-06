const { ethers } = require("hardhat");

class GasOptimizer {
  constructor(network) {
    this.network = network;
    this.gasHistory = [];
  }

  // Get optimized gas settings based on network conditions
  async getOptimizedGasSettings() {
    console.log("⛽ Analyzing gas prices...");
    
    const provider = ethers.provider;
    const block = await provider.getBlock("latest");
    const gasPrice = await provider.getGasPrice();
    
    // Get fee history for better gas estimation
    const feeHistory = await this.getFeeHistory();
    
    // Network-specific optimizations
    const settings = this.getNetworkSpecificSettings();
    
    // EIP-1559 networks
    if (this.isEIP1559Network()) {
      const { maxFeePerGas, maxPriorityFeePerGas } = await this.calculateEIP1559Fees(
        block,
        feeHistory
      );
      
      return {
        maxFeePerGas,
        maxPriorityFeePerGas,
        gasLimit: settings.gasLimit
      };
    }
    
    // Legacy gas pricing
    return {
      gasPrice: this.calculateOptimalGasPrice(gasPrice, feeHistory),
      gasLimit: settings.gasLimit
    };
  }

  // Get fee history for gas optimization
  async getFeeHistory() {
    try {
      const blockCount = 10;
      const rewardPercentiles = [25, 50, 75];
      
      const feeHistory = await ethers.provider.send("eth_feeHistory", [
        ethers.utils.hexValue(blockCount),
        "latest",
        rewardPercentiles
      ]);
      
      return feeHistory;
    } catch (error) {
      console.log("Fee history not available, using fallback");
      return null;
    }
  }

  // Calculate EIP-1559 fees
  async calculateEIP1559Fees(block, feeHistory) {
    let maxPriorityFeePerGas;
    let maxFeePerGas;
    
    if (feeHistory && feeHistory.reward) {
      // Use median priority fee from history
      const priorityFees = feeHistory.reward
        .map(rewards => rewards[1]) // 50th percentile
        .filter(fee => fee)
        .map(fee => ethers.BigNumber.from(fee));
      
      if (priorityFees.length > 0) {
        // Calculate median
        priorityFees.sort((a, b) => a.sub(b).toNumber());
        maxPriorityFeePerGas = priorityFees[Math.floor(priorityFees.length / 2)];
      }
    }
    
    // Fallback if no history
    if (!maxPriorityFeePerGas) {
      maxPriorityFeePerGas = ethers.utils.parseUnits("2", "gwei");
    }
    
    // Add buffer for priority fee
    maxPriorityFeePerGas = maxPriorityFeePerGas.mul(120).div(100); // 20% buffer
    
    // Calculate max fee
    const baseFee = block.baseFeePerGas || ethers.utils.parseUnits("30", "gwei");
    const buffer = baseFee.mul(2); // 2x buffer for base fee spikes
    maxFeePerGas = baseFee.add(buffer).add(maxPriorityFeePerGas);
    
    // Apply network-specific caps
    const caps = this.getGasCaps();
    if (caps.maxFeePerGas && maxFeePerGas.gt(caps.maxFeePerGas)) {
      maxFeePerGas = caps.maxFeePerGas;
    }
    if (caps.maxPriorityFeePerGas && maxPriorityFeePerGas.gt(caps.maxPriorityFeePerGas)) {
      maxPriorityFeePerGas = caps.maxPriorityFeePerGas;
    }
    
    console.log(`📊 EIP-1559 Gas Settings:`);
    console.log(`   Max Fee: ${ethers.utils.formatUnits(maxFeePerGas, "gwei")} gwei`);
    console.log(`   Max Priority Fee: ${ethers.utils.formatUnits(maxPriorityFeePerGas, "gwei")} gwei`);
    
    return { maxFeePerGas, maxPriorityFeePerGas };
  }

  // Calculate optimal gas price for legacy networks
  calculateOptimalGasPrice(currentGasPrice, feeHistory) {
    let optimalPrice = currentGasPrice;
    
    // Add 10% buffer for faster inclusion
    optimalPrice = optimalPrice.mul(110).div(100);
    
    // Apply network-specific caps
    const caps = this.getGasCaps();
    if (caps.maxGasPrice && optimalPrice.gt(caps.maxGasPrice)) {
      optimalPrice = caps.maxGasPrice;
    }
    
    console.log(`📊 Legacy Gas Price: ${ethers.utils.formatUnits(optimalPrice, "gwei")} gwei`);
    
    return optimalPrice;
  }

  // Check if network supports EIP-1559
  isEIP1559Network() {
    const eip1559Networks = [
      'mainnet',
      'goerli',
      'sepolia',
      'polygon',
      'polygonMumbai',
      'arbitrum',
      'arbitrumGoerli'
    ];
    
    return eip1559Networks.includes(this.network);
  }

  // Get network-specific settings
  getNetworkSpecificSettings() {
    const settings = {
      mainnet: {
        gasLimit: 8000000,
        confirmations: 2,
        timeout: 300000 // 5 minutes
      },
      arbitrum: {
        gasLimit: 20000000,
        confirmations: 1,
        timeout: 60000 // 1 minute
      },
      polygon: {
        gasLimit: 15000000,
        confirmations: 3,
        timeout: 120000 // 2 minutes
      },
      optimism: {
        gasLimit: 15000000,
        confirmations: 1,
        timeout: 60000 // 1 minute
      },
      // Testnets
      goerli: {
        gasLimit: 8000000,
        confirmations: 1,
        timeout: 120000
      },
      sepolia: {
        gasLimit: 8000000,
        confirmations: 1,
        timeout: 120000
      }
    };
    
    return settings[this.network] || {
      gasLimit: 8000000,
      confirmations: 1,
      timeout: 120000
    };
  }

  // Get gas price caps
  getGasCaps() {
    const caps = {
      mainnet: {
        maxFeePerGas: ethers.utils.parseUnits("300", "gwei"),
        maxPriorityFeePerGas: ethers.utils.parseUnits("10", "gwei"),
        maxGasPrice: ethers.utils.parseUnits("300", "gwei")
      },
      polygon: {
        maxFeePerGas: ethers.utils.parseUnits("500", "gwei"),
        maxPriorityFeePerGas: ethers.utils.parseUnits("50", "gwei"),
        maxGasPrice: ethers.utils.parseUnits("500", "gwei")
      },
      arbitrum: {
        maxFeePerGas: ethers.utils.parseUnits("10", "gwei"),
        maxPriorityFeePerGas: ethers.utils.parseUnits("1", "gwei"),
        maxGasPrice: ethers.utils.parseUnits("10", "gwei")
      }
    };
    
    return caps[this.network] || {
      maxFeePerGas: ethers.utils.parseUnits("1000", "gwei"),
      maxPriorityFeePerGas: ethers.utils.parseUnits("100", "gwei"),
      maxGasPrice: ethers.utils.parseUnits("1000", "gwei")
    };
  }

  // Wait for good gas prices
  async waitForGoodGasPrice(maxWaitTime = 300000) { // 5 minutes default
    console.log("⏳ Waiting for favorable gas prices...");
    
    const startTime = Date.now();
    const targetGasPrice = this.getTargetGasPrice();
    
    while (Date.now() - startTime < maxWaitTime) {
      const currentGasPrice = await ethers.provider.getGasPrice();
      
      if (currentGasPrice.lte(targetGasPrice)) {
        console.log("✅ Gas prices are favorable!");
        return true;
      }
      
      console.log(`Current: ${ethers.utils.formatUnits(currentGasPrice, "gwei")} gwei, ` +
                  `Target: ${ethers.utils.formatUnits(targetGasPrice, "gwei")} gwei`);
      
      // Wait 10 seconds before checking again
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
    
    console.log("⚠️  Timeout waiting for good gas prices, proceeding anyway");
    return false;
  }

  // Get target gas price for waiting
  getTargetGasPrice() {
    const targets = {
      mainnet: ethers.utils.parseUnits("50", "gwei"),
      polygon: ethers.utils.parseUnits("100", "gwei"),
      arbitrum: ethers.utils.parseUnits("1", "gwei"),
      optimism: ethers.utils.parseUnits("1", "gwei")
    };
    
    return targets[this.network] || ethers.utils.parseUnits("30", "gwei");
  }

  // Track gas usage
  trackGasUsage(txReceipt, operation) {
    const gasUsed = txReceipt.gasUsed;
    const effectiveGasPrice = txReceipt.effectiveGasPrice || txReceipt.gasPrice;
    const gasCost = gasUsed.mul(effectiveGasPrice);
    
    this.gasHistory.push({
      operation,
      gasUsed: gasUsed.toString(),
      gasPrice: ethers.utils.formatUnits(effectiveGasPrice, "gwei"),
      cost: ethers.utils.formatEther(gasCost),
      timestamp: Date.now()
    });
    
    console.log(`⛽ ${operation}: ${gasUsed} gas @ ${ethers.utils.formatUnits(effectiveGasPrice, "gwei")} gwei = ${ethers.utils.formatEther(gasCost)} ETH`);
  }

  // Get gas usage summary
  getGasSummary() {
    if (this.gasHistory.length === 0) {
      return { totalCost: "0", operations: 0 };
    }
    
    const totalCost = this.gasHistory.reduce((sum, record) => {
      return sum.add(ethers.utils.parseEther(record.cost));
    }, ethers.BigNumber.from(0));
    
    return {
      totalCost: ethers.utils.formatEther(totalCost),
      operations: this.gasHistory.length,
      history: this.gasHistory
    };
  }

  // Batch transaction optimization
  async optimizeBatchTransaction(transactions) {
    console.log(`🔄 Optimizing batch of ${transactions.length} transactions...`);
    
    // Sort by priority
    const prioritized = transactions.sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return (priorityOrder[a.priority] || 2) - (priorityOrder[b.priority] || 2);
    });
    
    // Group similar transactions
    const grouped = this.groupTransactions(prioritized);
    
    // Estimate gas for batches
    const batches = [];
    for (const group of grouped) {
      const batch = await this.createOptimalBatch(group);
      batches.push(batch);
    }
    
    return batches;
  }

  // Group similar transactions
  groupTransactions(transactions) {
    const groups = {};
    
    for (const tx of transactions) {
      const key = `${tx.to}-${tx.type || 'default'}`;
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(tx);
    }
    
    return Object.values(groups);
  }

  // Create optimal batch
  async createOptimalBatch(transactions) {
    const gasEstimates = await Promise.all(
      transactions.map(tx => this.estimateGasWithBuffer(tx))
    );
    
    const totalGas = gasEstimates.reduce((sum, gas) => sum.add(gas), ethers.BigNumber.from(0));
    
    // Check if batch fits in block
    const blockGasLimit = await this.getBlockGasLimit();
    if (totalGas.gt(blockGasLimit.mul(90).div(100))) { // 90% of block gas limit
      // Split batch
      const mid = Math.floor(transactions.length / 2);
      return [
        await this.createOptimalBatch(transactions.slice(0, mid)),
        await this.createOptimalBatch(transactions.slice(mid))
      ].flat();
    }
    
    return {
      transactions,
      estimatedGas: totalGas,
      gasEstimates
    };
  }

  // Estimate gas with buffer
  async estimateGasWithBuffer(tx) {
    try {
      const estimated = await ethers.provider.estimateGas(tx);
      // Add 20% buffer
      return estimated.mul(120).div(100);
    } catch (error) {
      console.warn(`Failed to estimate gas for ${tx.to}: ${error.message}`);
      // Return default high estimate
      return ethers.BigNumber.from(500000);
    }
  }

  // Get block gas limit
  async getBlockGasLimit() {
    const block = await ethers.provider.getBlock("latest");
    return block.gasLimit;
  }
}

module.exports = GasOptimizer;