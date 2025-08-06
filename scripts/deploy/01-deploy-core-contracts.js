const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log(`\n🚀 Deploying Core Contracts to ${network.name}...\n`);

  // Load deployment configuration
  const configPath = path.join(__dirname, "../../deployment/deployment-config.json");
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  
  const networkConfig = config.networks[network.name];
  if (!networkConfig) {
    throw new Error(`Network configuration not found for ${network.name}`);
  }

  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);
  console.log("Account balance:", (await deployer.getBalance()).toString());

  // Deployment results storage
  const deploymentResults = {
    network: network.name,
    chainId: networkConfig.chainId,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {}
  };

  try {
    // 1. Deploy Escrow Contract
    console.log("\n📋 Deploying Escrow Contract...");
    const Escrow = await ethers.getContractFactory("SecureEscrowV2");
    const escrow = await Escrow.deploy(
      networkConfig.contracts.UniswapV2Router,
      config.deployment.parameters.escrow.feePercentage,
      config.deployment.parameters.escrow.minLockDuration,
      config.deployment.parameters.escrow.maxLockDuration
    );
    await escrow.deployed();
    console.log("✅ Escrow deployed to:", escrow.address);
    
    deploymentResults.contracts.Escrow = {
      address: escrow.address,
      constructorArgs: [
        networkConfig.contracts.UniswapV2Router,
        config.deployment.parameters.escrow.feePercentage,
        config.deployment.parameters.escrow.minLockDuration,
        config.deployment.parameters.escrow.maxLockDuration
      ]
    };

    // 2. Deploy StateChannelFactory
    console.log("\n📋 Deploying StateChannelFactory...");
    const StateChannelFactory = await ethers.getContractFactory("StateChannelFactory");
    const stateChannelFactory = await StateChannelFactory.deploy(
      config.deployment.parameters.stateChannel.challengePeriod,
      config.deployment.parameters.stateChannel.minChannelDeposit
    );
    await stateChannelFactory.deployed();
    console.log("✅ StateChannelFactory deployed to:", stateChannelFactory.address);
    
    deploymentResults.contracts.StateChannelFactory = {
      address: stateChannelFactory.address,
      constructorArgs: [
        config.deployment.parameters.stateChannel.challengePeriod,
        config.deployment.parameters.stateChannel.minChannelDeposit
      ]
    };

    // 3. Deploy SettlementWithProofs
    console.log("\n📋 Deploying SettlementWithProofs...");
    const SettlementWithProofs = await ethers.getContractFactory("SettlementWithProofs");
    const settlement = await SettlementWithProofs.deploy(
      config.deployment.parameters.settlement.batchSize,
      config.deployment.parameters.settlement.settlementDelay,
      config.deployment.parameters.settlement.merkleTreeDepth
    );
    await settlement.deployed();
    console.log("✅ SettlementWithProofs deployed to:", settlement.address);
    
    deploymentResults.contracts.SettlementWithProofs = {
      address: settlement.address,
      constructorArgs: [
        config.deployment.parameters.settlement.batchSize,
        config.deployment.parameters.settlement.settlementDelay,
        config.deployment.parameters.settlement.merkleTreeDepth
      ]
    };

    // 4. Wait for confirmations
    console.log(`\n⏳ Waiting for ${networkConfig.confirmations} confirmations...`);
    await Promise.all([
      escrow.deployTransaction.wait(networkConfig.confirmations),
      stateChannelFactory.deployTransaction.wait(networkConfig.confirmations),
      settlement.deployTransaction.wait(networkConfig.confirmations)
    ]);
    console.log("✅ All contracts confirmed!");

    // 5. Initialize contracts
    console.log("\n🔧 Initializing contracts...");

    // Set fee recipient for Escrow
    if (process.env.FEE_RECIPIENT_ADDRESS) {
      const tx1 = await escrow.setFeeRecipient(process.env.FEE_RECIPIENT_ADDRESS);
      await tx1.wait();
      console.log("✅ Fee recipient set for Escrow");
    }

    // Grant roles
    const PAUSER_ROLE = config.deployment.roles.PAUSER_ROLE;
    const OPERATOR_ROLE = config.deployment.roles.OPERATOR_ROLE;

    if (process.env.EMERGENCY_ADMIN_ADDRESS) {
      const tx2 = await escrow.grantRole(PAUSER_ROLE, process.env.EMERGENCY_ADMIN_ADDRESS);
      await tx2.wait();
      console.log("✅ PAUSER_ROLE granted to emergency admin");
    }

    // 6. Save deployment results
    const deploymentDir = path.join(__dirname, "../../deployments", network.name);
    if (!fs.existsSync(deploymentDir)) {
      fs.mkdirSync(deploymentDir, { recursive: true });
    }

    const deploymentFile = path.join(deploymentDir, "core-contracts.json");
    fs.writeFileSync(deploymentFile, JSON.stringify(deploymentResults, null, 2));
    console.log(`\n📁 Deployment results saved to: ${deploymentFile}`);

    // 7. Generate ABI files
    console.log("\n📄 Generating ABI files...");
    const abiDir = path.join(deploymentDir, "abis");
    if (!fs.existsSync(abiDir)) {
      fs.mkdirSync(abiDir, { recursive: true });
    }

    // Save ABIs
    const contracts = {
      Escrow: escrow,
      StateChannelFactory: stateChannelFactory,
      SettlementWithProofs: settlement
    };

    for (const [name, contract] of Object.entries(contracts)) {
      const artifact = await ethers.getContractFactory(name);
      const abiFile = path.join(abiDir, `${name}.json`);
      fs.writeFileSync(abiFile, JSON.stringify(artifact.interface.format('json'), null, 2));
    }

    console.log("\n✅ Core contracts deployment completed successfully!");
    console.log("\n📊 Deployment Summary:");
    console.log("====================");
    console.log(`Network: ${network.name} (${networkConfig.chainId})`);
    console.log(`Escrow: ${escrow.address}`);
    console.log(`StateChannelFactory: ${stateChannelFactory.address}`);
    console.log(`SettlementWithProofs: ${settlement.address}`);

    return deploymentResults;

  } catch (error) {
    console.error("\n❌ Deployment failed:", error);
    
    // Save partial results if any
    if (Object.keys(deploymentResults.contracts).length > 0) {
      const errorFile = path.join(__dirname, "../../deployments", network.name, `core-contracts-error-${Date.now()}.json`);
      fs.writeFileSync(errorFile, JSON.stringify({ ...deploymentResults, error: error.message }, null, 2));
      console.log(`\n📁 Partial deployment results saved to: ${errorFile}`);
    }
    
    throw error;
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