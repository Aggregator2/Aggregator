const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log(`\n🔍 Deploying Verification Contracts to ${network.name}...\n`);

  // Load deployment configuration
  const configPath = path.join(__dirname, "../../deployment/deployment-config.json");
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  
  const networkConfig = config.networks[network.name];
  if (!networkConfig) {
    throw new Error(`Network configuration not found for ${network.name}`);
  }

  // Load previous deployments
  const deploymentDir = path.join(__dirname, "../../deployments", network.name);
  const coreContractsPath = path.join(deploymentDir, "core-contracts.json");
  const securityModulesPath = path.join(deploymentDir, "security-modules.json");
  
  if (!fs.existsSync(coreContractsPath)) {
    throw new Error("Core contracts must be deployed first. Run 01-deploy-core-contracts.js");
  }
  if (!fs.existsSync(securityModulesPath)) {
    throw new Error("Security modules must be deployed first. Run 02-deploy-security-modules.js");
  }

  const coreContracts = JSON.parse(fs.readFileSync(coreContractsPath, 'utf8'));
  const securityModules = JSON.parse(fs.readFileSync(securityModulesPath, 'utf8'));

  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);
  console.log("Account balance:", (await deployer.getBalance()).toString());

  // Deployment results storage
  const deploymentResults = {
    network: network.name,
    chainId: networkConfig.chainId,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    coreContracts: coreContracts.contracts,
    securityModules: securityModules.contracts,
    contracts: {}
  };

  try {
    // 1. Deploy ZKProofVerifier
    console.log("\n📋 Deploying ZKProofVerifier...");
    const ZKProofVerifier = await ethers.getContractFactory("ZKProofVerifier");
    const zkProofVerifier = await ZKProofVerifier.deploy();
    await zkProofVerifier.deployed();
    console.log("✅ ZKProofVerifier deployed to:", zkProofVerifier.address);
    
    deploymentResults.contracts.ZKProofVerifier = {
      address: zkProofVerifier.address,
      constructorArgs: []
    };

    // 2. Deploy BLSSignatureVerifier
    console.log("\n📋 Deploying BLSSignatureVerifier...");
    const BLSSignatureVerifier = await ethers.getContractFactory("BLSSignatureVerifier");
    const blsSignatureVerifier = await BLSSignatureVerifier.deploy();
    await blsSignatureVerifier.deployed();
    console.log("✅ BLSSignatureVerifier deployed to:", blsSignatureVerifier.address);
    
    deploymentResults.contracts.BLSSignatureVerifier = {
      address: blsSignatureVerifier.address,
      constructorArgs: []
    };

    // 3. Deploy FraudProofVerifier
    console.log("\n📋 Deploying FraudProofVerifier...");
    const FraudProofVerifier = await ethers.getContractFactory("FraudProofVerifier");
    const fraudProofVerifier = await FraudProofVerifier.deploy(
      config.deployment.parameters.stateChannel.challengePeriod
    );
    await fraudProofVerifier.deployed();
    console.log("✅ FraudProofVerifier deployed to:", fraudProofVerifier.address);
    
    deploymentResults.contracts.FraudProofVerifier = {
      address: fraudProofVerifier.address,
      constructorArgs: [
        config.deployment.parameters.stateChannel.challengePeriod
      ]
    };

    // 4. Wait for confirmations
    console.log(`\n⏳ Waiting for ${networkConfig.confirmations} confirmations...`);
    await Promise.all([
      zkProofVerifier.deployTransaction.wait(networkConfig.confirmations),
      blsSignatureVerifier.deployTransaction.wait(networkConfig.confirmations),
      fraudProofVerifier.deployTransaction.wait(networkConfig.confirmations)
    ]);
    console.log("✅ All verification contracts confirmed!");

    // 5. Configure verification contracts with core systems
    console.log("\n🔧 Configuring verification contracts...");

    // Get contract instances
    const settlement = await ethers.getContractAt("SettlementWithProofs", coreContracts.contracts.SettlementWithProofs.address);
    const stateChannelFactory = await ethers.getContractAt("StateChannelFactory", coreContracts.contracts.StateChannelFactory.address);

    // Set verifiers for settlement contract (if it has setter methods)
    try {
      if (settlement.setZKVerifier) {
        const tx1 = await settlement.setZKVerifier(zkProofVerifier.address);
        await tx1.wait();
        console.log("✅ ZKProofVerifier set for SettlementWithProofs");
      }
    } catch (e) {
      console.log("⚠️  SettlementWithProofs doesn't support setZKVerifier");
    }

    // Configure fraud proof verifier for state channels
    try {
      if (stateChannelFactory.setFraudProofVerifier) {
        const tx2 = await stateChannelFactory.setFraudProofVerifier(fraudProofVerifier.address);
        await tx2.wait();
        console.log("✅ FraudProofVerifier set for StateChannelFactory");
      }
    } catch (e) {
      console.log("⚠️  StateChannelFactory doesn't support setFraudProofVerifier");
    }

    // Grant necessary roles
    const OPERATOR_ROLE = config.deployment.roles.OPERATOR_ROLE;
    
    if (process.env.OPERATOR_ADDRESS) {
      const tx3 = await fraudProofVerifier.grantRole(OPERATOR_ROLE, process.env.OPERATOR_ADDRESS);
      await tx3.wait();
      console.log("✅ OPERATOR_ROLE granted to operator address on FraudProofVerifier");
    }

    // 6. Save deployment results
    const deploymentFile = path.join(deploymentDir, "verification-contracts.json");
    fs.writeFileSync(deploymentFile, JSON.stringify(deploymentResults, null, 2));
    console.log(`\n📁 Deployment results saved to: ${deploymentFile}`);

    // 7. Generate ABI files
    console.log("\n📄 Generating ABI files...");
    const abiDir = path.join(deploymentDir, "abis");
    
    const contracts = {
      ZKProofVerifier: zkProofVerifier,
      BLSSignatureVerifier: blsSignatureVerifier,
      FraudProofVerifier: fraudProofVerifier
    };

    for (const [name, contract] of Object.entries(contracts)) {
      const artifact = await ethers.getContractFactory(name);
      const abiFile = path.join(abiDir, `${name}.json`);
      fs.writeFileSync(abiFile, JSON.stringify(artifact.interface.format('json'), null, 2));
    }

    // 8. Create combined deployment summary
    console.log("\n📊 Creating combined deployment summary...");
    const allDeployments = {
      network: network.name,
      chainId: networkConfig.chainId,
      deployer: deployer.address,
      timestamp: new Date().toISOString(),
      contracts: {
        core: coreContracts.contracts,
        security: securityModules.contracts,
        verification: deploymentResults.contracts
      }
    };

    const summaryFile = path.join(deploymentDir, "deployment-summary.json");
    fs.writeFileSync(summaryFile, JSON.stringify(allDeployments, null, 2));

    console.log("\n✅ Verification contracts deployment completed successfully!");
    console.log("\n📊 Deployment Summary:");
    console.log("====================");
    console.log(`Network: ${network.name} (${networkConfig.chainId})`);
    console.log(`ZKProofVerifier: ${zkProofVerifier.address}`);
    console.log(`BLSSignatureVerifier: ${blsSignatureVerifier.address}`);
    console.log(`FraudProofVerifier: ${fraudProofVerifier.address}`);

    return deploymentResults;

  } catch (error) {
    console.error("\n❌ Deployment failed:", error);
    
    // Save partial results if any
    if (Object.keys(deploymentResults.contracts).length > 0) {
      const errorFile = path.join(deploymentDir, `verification-contracts-error-${Date.now()}.json`);
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