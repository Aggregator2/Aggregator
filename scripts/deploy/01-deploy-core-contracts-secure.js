const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");
const DeploymentValidator = require("./utils/deployment-validator");
const GasOptimizer = require("./utils/gas-optimizer");
const DeploymentGuard = require("./utils/deployment-guard");

async function main() {
  console.log(`\n🚀 Deploying Core Contracts to ${network.name}...\n`);

  // Initialize utilities
  const validator = new DeploymentValidator();
  const gasOptimizer = new GasOptimizer(network.name);
  const deploymentDir = path.join(__dirname, "../../deployments", network.name);
  
  if (!fs.existsSync(deploymentDir)) {
    fs.mkdirSync(deploymentDir, { recursive: true });
  }
  
  const guard = new DeploymentGuard(deploymentDir);

  try {
    // Acquire deployment lock
    await guard.acquireLock();

    // Load and validate configuration
    const configPath = path.join(__dirname, "../../deployment/deployment-config.json");
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    
    // Validate configuration
    if (!validator.validateConfig(config, network.name)) {
      validator.printResults();
      throw new Error("Configuration validation failed");
    }
    
    const networkConfig = config.networks[network.name];
    
    // Backup configuration
    await guard.backupConfiguration(config);

    // Get deployer
    const [deployer] = await ethers.getSigners();
    console.log("Deploying contracts with account:", deployer.address);
    
    // Check deployer balance
    const balance = await deployer.getBalance();
    const minBalance = ethers.utils.parseEther("0.1");
    if (balance.lt(minBalance)) {
      throw new Error(`Insufficient balance: ${ethers.utils.formatEther(balance)} ETH`);
    }
    console.log("Account balance:", ethers.utils.formatEther(balance), "ETH");

    // Get optimized gas settings
    const gasSettings = await gasOptimizer.getOptimizedGasSettings();
    console.log("\n⛽ Using optimized gas settings");

    // Wait for good gas prices on mainnet
    if (network.name === 'mainnet') {
      await gasOptimizer.waitForGoodGasPrice();
    }

    // Deployment results storage
    const deploymentResults = {
      network: network.name,
      chainId: networkConfig.chainId,
      deployer: deployer.address,
      timestamp: new Date().toISOString(),
      gasSettings: gasSettings,
      contracts: {}
    };

    // Check for duplicate deployments
    const shouldDeploy = await guard.checkDuplicateDeployment("Escrow", "core-contracts");
    if (!shouldDeploy) {
      console.log("Deployment cancelled by user");
      return;
    }

    // 1. Deploy Escrow Contract
    console.log("\n📋 Deploying Escrow Contract...");
    
    // Validate Uniswap router address
    const uniswapRouter = networkConfig.contracts.UniswapV2Router;
    if (!ethers.utils.isAddress(uniswapRouter)) {
      throw new Error(`Invalid UniswapV2Router address: ${uniswapRouter}`);
    }
    
    // Check router has code
    const routerCode = await ethers.provider.getCode(uniswapRouter);
    if (routerCode === '0x') {
      throw new Error(`No contract at UniswapV2Router address: ${uniswapRouter}`);
    }
    
    const Escrow = await ethers.getContractFactory("SecureEscrowV2");
    const escrowArgs = [
      uniswapRouter,
      config.deployment.parameters.escrow.feePercentage,
      config.deployment.parameters.escrow.minLockDuration,
      config.deployment.parameters.escrow.maxLockDuration
    ];
    
    const escrow = await Escrow.deploy(...escrowArgs, gasSettings);
    const escrowReceipt = await escrow.deployTransaction.wait(networkConfig.confirmations);
    
    // Verify deployment
    await guard.verifyBytecode(escrow.address, Escrow.bytecode, "SecureEscrowV2");
    await validator.validateDeployedContract(escrow, Escrow.bytecode, escrowArgs);
    
    console.log("✅ Escrow deployed to:", escrow.address);
    gasOptimizer.trackGasUsage(escrowReceipt, "Escrow deployment");
    
    deploymentResults.contracts.Escrow = {
      address: escrow.address,
      constructorArgs: escrowArgs,
      blockNumber: escrowReceipt.blockNumber,
      transactionHash: escrowReceipt.transactionHash
    };

    // 2. Deploy StateChannelFactory
    console.log("\n📋 Deploying StateChannelFactory...");
    
    const StateChannelFactory = await ethers.getContractFactory("StateChannelFactory");
    const channelArgs = [
      config.deployment.parameters.stateChannel.challengePeriod,
      config.deployment.parameters.stateChannel.minChannelDeposit
    ];
    
    const stateChannelFactory = await StateChannelFactory.deploy(...channelArgs, gasSettings);
    const channelReceipt = await stateChannelFactory.deployTransaction.wait(networkConfig.confirmations);
    
    // Verify deployment
    await guard.verifyBytecode(stateChannelFactory.address, StateChannelFactory.bytecode, "StateChannelFactory");
    await validator.validateDeployedContract(stateChannelFactory, StateChannelFactory.bytecode, channelArgs);
    
    console.log("✅ StateChannelFactory deployed to:", stateChannelFactory.address);
    gasOptimizer.trackGasUsage(channelReceipt, "StateChannelFactory deployment");
    
    deploymentResults.contracts.StateChannelFactory = {
      address: stateChannelFactory.address,
      constructorArgs: channelArgs,
      blockNumber: channelReceipt.blockNumber,
      transactionHash: channelReceipt.transactionHash
    };

    // 3. Deploy SettlementWithProofs
    console.log("\n📋 Deploying SettlementWithProofs...");
    
    const SettlementWithProofs = await ethers.getContractFactory("SettlementWithProofs");
    const settlementArgs = [
      config.deployment.parameters.settlement.batchSize,
      config.deployment.parameters.settlement.settlementDelay,
      config.deployment.parameters.settlement.merkleTreeDepth
    ];
    
    const settlement = await SettlementWithProofs.deploy(...settlementArgs, gasSettings);
    const settlementReceipt = await settlement.deployTransaction.wait(networkConfig.confirmations);
    
    // Verify deployment
    await guard.verifyBytecode(settlement.address, SettlementWithProofs.bytecode, "SettlementWithProofs");
    await validator.validateDeployedContract(settlement, SettlementWithProofs.bytecode, settlementArgs);
    
    console.log("✅ SettlementWithProofs deployed to:", settlement.address);
    gasOptimizer.trackGasUsage(settlementReceipt, "SettlementWithProofs deployment");
    
    deploymentResults.contracts.SettlementWithProofs = {
      address: settlement.address,
      constructorArgs: settlementArgs,
      blockNumber: settlementReceipt.blockNumber,
      transactionHash: settlementReceipt.transactionHash
    };

    // 4. Initialize contracts with basic settings
    console.log("\n🔧 Performing basic initialization...");

    // Set fee recipient if provided
    if (process.env.FEE_RECIPIENT_ADDRESS) {
      if (!ethers.utils.isAddress(process.env.FEE_RECIPIENT_ADDRESS)) {
        throw new Error("Invalid FEE_RECIPIENT_ADDRESS");
      }
      
      console.log("Setting fee recipient...");
      const tx1 = await escrow.setFeeRecipient(process.env.FEE_RECIPIENT_ADDRESS, gasSettings);
      await tx1.wait();
      gasOptimizer.trackGasUsage(await tx1.wait(), "Set fee recipient");
      console.log("✅ Fee recipient set");
    }

    // Transfer ownership to multisig if provided
    if (process.env.MULTISIG_ADDRESS && network.name === 'mainnet') {
      if (!ethers.utils.isAddress(process.env.MULTISIG_ADDRESS)) {
        throw new Error("Invalid MULTISIG_ADDRESS");
      }
      
      console.log("\n🔐 Transferring ownership to multisig...");
      
      // Transfer Escrow ownership
      const tx2 = await escrow.transferOwnership(process.env.MULTISIG_ADDRESS, gasSettings);
      await tx2.wait();
      console.log("✅ Escrow ownership transferred");
      
      // Note: Add similar transfers for other contracts that support ownership
    }

    // 5. Save deployment results
    const deploymentFile = path.join(deploymentDir, "core-contracts.json");
    fs.writeFileSync(deploymentFile, JSON.stringify(deploymentResults, null, 2));
    console.log(`\n📁 Deployment results saved to: ${deploymentFile}`);

    // 6. Create deployment snapshot
    await guard.createSnapshot(deploymentResults);

    // 7. Generate ABI files
    console.log("\n📄 Generating ABI files...");
    const abiDir = path.join(deploymentDir, "abis");
    if (!fs.existsSync(abiDir)) {
      fs.mkdirSync(abiDir, { recursive: true });
    }

    const contracts = {
      Escrow: { factory: Escrow, instance: escrow },
      StateChannelFactory: { factory: StateChannelFactory, instance: stateChannelFactory },
      SettlementWithProofs: { factory: SettlementWithProofs, instance: settlement }
    };

    for (const [name, contract] of Object.entries(contracts)) {
      const abiFile = path.join(abiDir, `${name}.json`);
      fs.writeFileSync(abiFile, JSON.stringify(contract.factory.interface.format('json'), null, 2));
    }

    // 8. Print deployment summary
    const gasSummary = gasOptimizer.getGasSummary();
    
    console.log("\n✅ Core contracts deployment completed successfully!");
    console.log("\n📊 Deployment Summary:");
    console.log("====================");
    console.log(`Network: ${network.name} (${networkConfig.chainId})`);
    console.log(`Escrow: ${escrow.address}`);
    console.log(`StateChannelFactory: ${stateChannelFactory.address}`);
    console.log(`SettlementWithProofs: ${settlement.address}`);
    console.log(`\n⛽ Total gas cost: ${gasSummary.totalCost} ETH`);
    console.log(`Operations: ${gasSummary.operations}`);

    // Validate final deployment
    validator.validateRoleSeparation();
    validator.printResults();

    return deploymentResults;

  } catch (error) {
    console.error("\n❌ Deployment failed:", error);
    
    // Save error report
    const errorReport = {
      network: network.name,
      timestamp: new Date().toISOString(),
      error: error.message,
      stack: error.stack,
      gasHistory: gasOptimizer.gasHistory
    };
    
    const errorFile = path.join(deploymentDir, `core-contracts-error-${Date.now()}.json`);
    fs.writeFileSync(errorFile, JSON.stringify(errorReport, null, 2));
    console.log(`\n📁 Error report saved to: ${errorFile}`);
    
    throw error;
  } finally {
    // Always release lock
    guard.releaseLock();
  }
}

// Execute deployment
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = main;