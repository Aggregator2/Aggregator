const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log(`\n🛡️ Deploying Security Modules to ${network.name}...\n`);

  // Load deployment configuration
  const configPath = path.join(__dirname, "../../deployment/deployment-config.json");
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  
  const networkConfig = config.networks[network.name];
  if (!networkConfig) {
    throw new Error(`Network configuration not found for ${network.name}`);
  }

  // Load core contracts deployment
  const coreContractsPath = path.join(__dirname, "../../deployments", network.name, "core-contracts.json");
  if (!fs.existsSync(coreContractsPath)) {
    throw new Error("Core contracts must be deployed first. Run 01-deploy-core-contracts.js");
  }
  const coreContracts = JSON.parse(fs.readFileSync(coreContractsPath, 'utf8'));

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
    contracts: {}
  };

  try {
    // 1. Deploy CircuitBreaker
    console.log("\n📋 Deploying CircuitBreaker...");
    const CircuitBreaker = await ethers.getContractFactory("CircuitBreaker");
    const circuitBreaker = await CircuitBreaker.deploy(
      config.deployment.parameters.security.circuitBreaker.withdrawalLimit,
      config.deployment.parameters.security.circuitBreaker.withdrawalPeriod,
      config.deployment.parameters.security.circuitBreaker.cooldownPeriod
    );
    await circuitBreaker.deployed();
    console.log("✅ CircuitBreaker deployed to:", circuitBreaker.address);
    
    deploymentResults.contracts.CircuitBreaker = {
      address: circuitBreaker.address,
      constructorArgs: [
        config.deployment.parameters.security.circuitBreaker.withdrawalLimit,
        config.deployment.parameters.security.circuitBreaker.withdrawalPeriod,
        config.deployment.parameters.security.circuitBreaker.cooldownPeriod
      ]
    };

    // 2. Deploy MEVProtection
    console.log("\n📋 Deploying MEVProtection...");
    const MEVProtection = await ethers.getContractFactory("MEVProtection");
    const mevProtection = await MEVProtection.deploy(
      config.deployment.parameters.security.mevProtection.minDelay,
      config.deployment.parameters.security.mevProtection.maxDelay,
      config.deployment.parameters.security.mevProtection.priorityFeeThreshold
    );
    await mevProtection.deployed();
    console.log("✅ MEVProtection deployed to:", mevProtection.address);
    
    deploymentResults.contracts.MEVProtection = {
      address: mevProtection.address,
      constructorArgs: [
        config.deployment.parameters.security.mevProtection.minDelay,
        config.deployment.parameters.security.mevProtection.maxDelay,
        config.deployment.parameters.security.mevProtection.priorityFeeThreshold
      ]
    };

    // 3. Deploy GasProtection
    console.log("\n📋 Deploying GasProtection...");
    const GasProtection = await ethers.getContractFactory("GasProtection");
    const gasProtection = await GasProtection.deploy();
    await gasProtection.deployed();
    console.log("✅ GasProtection deployed to:", gasProtection.address);
    
    deploymentResults.contracts.GasProtection = {
      address: gasProtection.address,
      constructorArgs: []
    };

    // 4. Deploy SignatureVerifier
    console.log("\n📋 Deploying SignatureVerifier...");
    const SignatureVerifier = await ethers.getContractFactory("SignatureVerifier");
    const signatureVerifier = await SignatureVerifier.deploy();
    await signatureVerifier.deployed();
    console.log("✅ SignatureVerifier deployed to:", signatureVerifier.address);
    
    deploymentResults.contracts.SignatureVerifier = {
      address: signatureVerifier.address,
      constructorArgs: []
    };

    // 5. Wait for confirmations
    console.log(`\n⏳ Waiting for ${networkConfig.confirmations} confirmations...`);
    await Promise.all([
      circuitBreaker.deployTransaction.wait(networkConfig.confirmations),
      mevProtection.deployTransaction.wait(networkConfig.confirmations),
      gasProtection.deployTransaction.wait(networkConfig.confirmations),
      signatureVerifier.deployTransaction.wait(networkConfig.confirmations)
    ]);
    console.log("✅ All security modules confirmed!");

    // 6. Configure security modules with core contracts
    console.log("\n🔧 Configuring security modules...");

    // Grant roles to CircuitBreaker
    const PAUSER_ROLE = config.deployment.roles.PAUSER_ROLE;
    const OPERATOR_ROLE = config.deployment.roles.OPERATOR_ROLE;

    // Get core contract instances
    const escrow = await ethers.getContractAt("SecureEscrowV2", coreContracts.contracts.Escrow.address);
    const stateChannelFactory = await ethers.getContractAt("StateChannelFactory", coreContracts.contracts.StateChannelFactory.address);

    // Grant CircuitBreaker permission to pause contracts
    const tx1 = await escrow.grantRole(PAUSER_ROLE, circuitBreaker.address);
    await tx1.wait();
    console.log("✅ CircuitBreaker granted PAUSER_ROLE on Escrow");

    // Configure MEVProtection for core contracts
    const tx2 = await mevProtection.addProtectedContract(escrow.address);
    await tx2.wait();
    console.log("✅ Escrow added to MEVProtection");

    const tx3 = await mevProtection.addProtectedContract(stateChannelFactory.address);
    await tx3.wait();
    console.log("✅ StateChannelFactory added to MEVProtection");

    // Set up emergency admin if provided
    if (process.env.EMERGENCY_ADMIN_ADDRESS) {
      const tx4 = await circuitBreaker.grantRole(PAUSER_ROLE, process.env.EMERGENCY_ADMIN_ADDRESS);
      await tx4.wait();
      console.log("✅ Emergency admin granted PAUSER_ROLE on CircuitBreaker");
    }

    // 7. Save deployment results
    const deploymentDir = path.join(__dirname, "../../deployments", network.name);
    const deploymentFile = path.join(deploymentDir, "security-modules.json");
    fs.writeFileSync(deploymentFile, JSON.stringify(deploymentResults, null, 2));
    console.log(`\n📁 Deployment results saved to: ${deploymentFile}`);

    // 8. Generate ABI files
    console.log("\n📄 Generating ABI files...");
    const abiDir = path.join(deploymentDir, "abis");
    
    const contracts = {
      CircuitBreaker: circuitBreaker,
      MEVProtection: mevProtection,
      GasProtection: gasProtection,
      SignatureVerifier: signatureVerifier
    };

    for (const [name, contract] of Object.entries(contracts)) {
      const artifact = await ethers.getContractFactory(name);
      const abiFile = path.join(abiDir, `${name}.json`);
      fs.writeFileSync(abiFile, JSON.stringify(artifact.interface.format('json'), null, 2));
    }

    console.log("\n✅ Security modules deployment completed successfully!");
    console.log("\n📊 Deployment Summary:");
    console.log("====================");
    console.log(`Network: ${network.name} (${networkConfig.chainId})`);
    console.log(`CircuitBreaker: ${circuitBreaker.address}`);
    console.log(`MEVProtection: ${mevProtection.address}`);
    console.log(`GasProtection: ${gasProtection.address}`);
    console.log(`SignatureVerifier: ${signatureVerifier.address}`);

    return deploymentResults;

  } catch (error) {
    console.error("\n❌ Deployment failed:", error);
    
    // Save partial results if any
    if (Object.keys(deploymentResults.contracts).length > 0) {
      const errorFile = path.join(__dirname, "../../deployments", network.name, `security-modules-error-${Date.now()}.json`);
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