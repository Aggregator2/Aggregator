const { ethers } = require("hardhat");

class EdgeCaseHandler {
  constructor() {
    this.retryCount = 3;
    this.retryDelay = 5000; // 5 seconds
  }

  // Retry deployment with exponential backoff
  async retryDeployment(deployFunc, contractName, attempt = 1) {
    try {
      console.log(`🔄 Deploying ${contractName} (attempt ${attempt}/${this.retryCount})...`);
      return await deployFunc();
    } catch (error) {
      if (attempt >= this.retryCount) {
        throw new Error(`Failed to deploy ${contractName} after ${this.retryCount} attempts: ${error.message}`);
      }

      console.warn(`⚠️  Deployment failed, retrying in ${this.retryDelay * attempt}ms...`);
      await this.delay(this.retryDelay * attempt);
      
      return await this.retryDeployment(deployFunc, contractName, attempt + 1);
    }
  }

  // Handle nonce issues
  async handleNonceError(signer, error) {
    if (error.message.includes("nonce") || error.code === "NONCE_EXPIRED") {
      console.log("🔧 Handling nonce mismatch...");
      
      // Get current nonce from network
      const currentNonce = await signer.getTransactionCount("latest");
      const pendingNonce = await signer.getTransactionCount("pending");
      
      console.log(`Current nonce: ${currentNonce}, Pending nonce: ${pendingNonce}`);
      
      // Wait for pending transactions
      if (pendingNonce > currentNonce) {
        console.log("⏳ Waiting for pending transactions...");
        await this.waitForPendingTransactions(signer, pendingNonce);
      }
      
      return true;
    }
    return false;
  }

  // Wait for pending transactions to clear
  async waitForPendingTransactions(signer, targetNonce, maxWait = 60000) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWait) {
      const currentNonce = await signer.getTransactionCount("latest");
      
      if (currentNonce >= targetNonce) {
        console.log("✅ Pending transactions cleared");
        return;
      }
      
      await this.delay(2000);
    }
    
    throw new Error("Timeout waiting for pending transactions");
  }

  // Handle gas estimation errors
  async handleGasEstimationError(transaction, error) {
    if (error.message.includes("gas required exceeds allowance") || 
        error.message.includes("insufficient funds")) {
      console.log("⛽ Handling gas estimation error...");
      
      // Try with higher gas limit
      const gasLimit = ethers.BigNumber.from(8000000);
      console.log(`Retrying with gas limit: ${gasLimit.toString()}`);
      
      return {
        ...transaction,
        gasLimit: gasLimit
      };
    }
    
    if (error.message.includes("execution reverted")) {
      // Extract revert reason
      const reason = this.extractRevertReason(error);
      throw new Error(`Transaction would revert: ${reason}`);
    }
    
    return null;
  }

  // Extract revert reason from error
  extractRevertReason(error) {
    // Try to extract custom error or revert string
    if (error.reason) return error.reason;
    if (error.error?.reason) return error.error.reason;
    
    // Try to decode error data
    if (error.error?.data) {
      try {
        const errorInterface = new ethers.utils.Interface([
          "error Error(string)",
          "error Panic(uint256)"
        ]);
        
        const decoded = errorInterface.parseError(error.error.data);
        return decoded.args[0] || "Unknown error";
      } catch {
        return error.error.data;
      }
    }
    
    return "Unknown revert reason";
  }

  // Handle network congestion
  async handleNetworkCongestion(provider, maxWaitTime = 300000) {
    console.log("🌐 Checking network congestion...");
    
    const startTime = Date.now();
    let consecutiveHighGas = 0;
    const highGasThreshold = ethers.utils.parseUnits("200", "gwei");
    
    while (Date.now() - startTime < maxWaitTime) {
      try {
        const block = await provider.getBlock("latest");
        const gasPrice = await provider.getGasPrice();
        
        // Check if blocks are being produced
        if (block) {
          console.log(`Block ${block.number} - Gas: ${ethers.utils.formatUnits(gasPrice, "gwei")} gwei`);
          
          if (gasPrice.lte(highGasThreshold)) {
            return true; // Network is not congested
          }
          
          consecutiveHighGas++;
          if (consecutiveHighGas > 5) {
            console.warn("⚠️  Network appears congested, proceeding anyway");
            return true;
          }
        }
      } catch (error) {
        console.warn("Failed to check network status:", error.message);
      }
      
      await this.delay(10000); // Check every 10 seconds
    }
    
    throw new Error("Network congestion timeout");
  }

  // Handle RPC errors
  async handleRPCError(error, operation, provider) {
    const rpcErrors = [
      "TIMEOUT",
      "NETWORK_ERROR", 
      "SERVER_ERROR",
      "connection reset",
      "ECONNREFUSED"
    ];
    
    const hasRPCError = rpcErrors.some(e => 
      error.message.includes(e) || error.code === e
    );
    
    if (hasRPCError) {
      console.log("🔌 Handling RPC error...");
      
      // Try to switch to backup RPC
      const backupRPC = this.getBackupRPC(provider.connection.url);
      if (backupRPC) {
        console.log(`Switching to backup RPC: ${backupRPC}`);
        return new ethers.providers.JsonRpcProvider(backupRPC);
      }
      
      // Wait and retry
      console.log("Waiting 10 seconds before retry...");
      await this.delay(10000);
      return true;
    }
    
    return false;
  }

  // Get backup RPC endpoint
  getBackupRPC(currentRPC) {
    const backupRPCs = {
      'mainnet': [
        process.env.MAINNET_BACKUP_RPC,
        'https://eth-mainnet.public.blastapi.io',
        'https://rpc.ankr.com/eth'
      ],
      'polygon': [
        process.env.POLYGON_BACKUP_RPC,
        'https://polygon-rpc.com',
        'https://rpc.ankr.com/polygon'
      ],
      'arbitrum': [
        process.env.ARBITRUM_BACKUP_RPC,
        'https://arb1.arbitrum.io/rpc',
        'https://rpc.ankr.com/arbitrum'
      ]
    };
    
    // Detect network from RPC URL
    for (const [network, rpcs] of Object.entries(backupRPCs)) {
      if (currentRPC.includes(network)) {
        return rpcs.find(rpc => rpc && rpc !== currentRPC);
      }
    }
    
    return null;
  }

  // Handle contract size limit
  async handleContractSizeLimit(contractFactory, contractName) {
    const bytecode = contractFactory.bytecode;
    const size = (bytecode.length - 2) / 2; // Remove 0x and convert to bytes
    
    if (size > 24576) {
      console.error(`❌ ${contractName} exceeds 24KB limit: ${size} bytes`);
      
      // Suggest optimizations
      console.log("\n💡 Suggestions to reduce contract size:");
      console.log("1. Enable optimizer in hardhat.config.js");
      console.log("2. Extract libraries for reusable code");
      console.log("3. Remove unnecessary error messages");
      console.log("4. Use shorter variable names in production");
      console.log("5. Remove development-only code");
      
      throw new Error(`Contract ${contractName} too large: ${size} bytes (limit: 24576)`);
    }
    
    if (size > 20000) {
      console.warn(`⚠️  ${contractName} is large: ${size} bytes (limit: 24576)`);
    }
  }

  // Handle insufficient balance
  async handleInsufficientBalance(signer, requiredAmount) {
    const balance = await signer.getBalance();
    
    if (balance.lt(requiredAmount)) {
      const deficit = requiredAmount.sub(balance);
      
      console.error(`❌ Insufficient balance for deployment`);
      console.log(`Current balance: ${ethers.utils.formatEther(balance)} ETH`);
      console.log(`Required: ${ethers.utils.formatEther(requiredAmount)} ETH`);
      console.log(`Deficit: ${ethers.utils.formatEther(deficit)} ETH`);
      
      throw new Error(
        `Insufficient balance: need ${ethers.utils.formatEther(deficit)} more ETH`
      );
    }
  }

  // Handle transaction replacement
  async handleTransactionReplacement(transaction, error) {
    if (error.code === "TRANSACTION_REPLACED") {
      console.log("🔄 Transaction was replaced");
      
      const { replacement, receipt, cancelled } = error;
      
      if (cancelled) {
        throw new Error("Transaction was cancelled");
      }
      
      if (receipt) {
        console.log("✅ Replacement transaction confirmed");
        return receipt;
      }
      
      // Wait for replacement
      console.log("⏳ Waiting for replacement transaction...");
      return await replacement.wait();
    }
    
    return null;
  }

  // Validate transaction receipt
  validateReceipt(receipt, contractName) {
    if (!receipt) {
      throw new Error(`No receipt received for ${contractName}`);
    }
    
    if (receipt.status === 0) {
      throw new Error(`${contractName} deployment transaction failed`);
    }
    
    if (!receipt.contractAddress) {
      throw new Error(`No contract address in receipt for ${contractName}`);
    }
    
    console.log(`✅ ${contractName} deployment confirmed`);
    console.log(`   Block: ${receipt.blockNumber}`);
    console.log(`   Gas used: ${receipt.gasUsed.toString()}`);
    
    return true;
  }

  // Handle fork detection
  async detectAndHandleFork(provider) {
    console.log("🔍 Checking for chain reorg...");
    
    const blocks = [];
    const blockCount = 5;
    
    // Get recent blocks
    for (let i = 0; i < blockCount; i++) {
      const block = await provider.getBlock("latest" - i);
      blocks.push(block);
    }
    
    // Wait and check again
    await this.delay(5000);
    
    // Verify blocks still exist
    for (const block of blocks) {
      try {
        const currentBlock = await provider.getBlock(block.hash);
        if (!currentBlock) {
          console.warn("⚠️  Possible chain reorg detected!");
          return true;
        }
      } catch (error) {
        console.warn("⚠️  Block verification failed:", error.message);
        return true;
      }
    }
    
    console.log("✅ No chain reorg detected");
    return false;
  }

  // Utility delay function
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Create comprehensive error handler
  async handleDeploymentError(error, context) {
    console.error(`\n❌ Deployment error in ${context.operation}:`);
    console.error(error.message);
    
    // Try specific handlers
    if (await this.handleNonceError(context.signer, error)) {
      return { retry: true };
    }
    
    if (await this.handleRPCError(error, context.operation, context.provider)) {
      return { retry: true };
    }
    
    const gasFixed = await this.handleGasEstimationError(context.transaction, error);
    if (gasFixed) {
      return { retry: true, transaction: gasFixed };
    }
    
    const receipt = await this.handleTransactionReplacement(context.transaction, error);
    if (receipt) {
      return { retry: false, receipt };
    }
    
    // Check for specific error types
    if (error.message.includes("insufficient funds")) {
      await this.handleInsufficientBalance(context.signer, context.estimatedCost);
    }
    
    // If no specific handler, throw original error
    throw error;
  }
}

module.exports = EdgeCaseHandler;