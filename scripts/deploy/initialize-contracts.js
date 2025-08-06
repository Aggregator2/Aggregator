const { ethers, network } = require("hardhat");
const DeploymentHelpers = require("./deployment-helpers");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log(`\n🚀 Initializing contracts on ${network.name}...\n`);

  const helpers = new DeploymentHelpers(network.name);
  const [deployer] = await ethers.getSigners();
  
  console.log("Initializing with account:", deployer.address);
  console.log("Account balance:", (await deployer.getBalance()).toString());

  try {
    // Load deployment summary
    const deployment = await helpers.loadDeployment();
    const config = helpers.config;

    const initResults = {
      network: network.name,
      timestamp: new Date().toISOString(),
      deployer: deployer.address,
      roleAssignments: [],
      parameterSettings: [],
      feeRecipients: [],
      verifications: []
    };

    // 1. Initialize Core Contracts
    console.log("\n=== Initializing Core Contracts ===");
    
    if (deployment.contracts.core) {
      // Initialize Escrow
      if (deployment.contracts.core.Escrow) {
        console.log("\n📋 Initializing Escrow...");
        const escrow = await helpers.getContract("SecureEscrowV2", deployment.contracts.core.Escrow.address);
        
        // Set fee recipient
        if (process.env.FEE_RECIPIENT_ADDRESS) {
          const feeResults = await helpers.setupFeeRecipients(
            { Escrow: deployment.contracts.core.Escrow.address },
            process.env.FEE_RECIPIENT_ADDRESS
          );
          initResults.feeRecipients.push(...feeResults);
        }

        // Initialize parameters
        const escrowParams = await helpers.initializeParameters(escrow, {
          setEmergencyWithdrawDelay: config.deployment.parameters.escrow.emergencyWithdrawDelay
        });
        initResults.parameterSettings.push(...escrowParams);

        // Verify configuration
        const escrowVerification = await helpers.verifyConfiguration(escrow, {
          feePercentage: config.deployment.parameters.escrow.feePercentage,
          minLockDuration: config.deployment.parameters.escrow.minLockDuration,
          maxLockDuration: config.deployment.parameters.escrow.maxLockDuration
        });
        initResults.verifications.push({ contract: "Escrow", checks: escrowVerification });
      }

      // Initialize StateChannelFactory
      if (deployment.contracts.core.StateChannelFactory) {
        console.log("\n📋 Initializing StateChannelFactory...");
        const factory = await helpers.getContract("StateChannelFactory", deployment.contracts.core.StateChannelFactory.address);
        
        // Verify configuration
        const factoryVerification = await helpers.verifyConfiguration(factory, {
          challengePeriod: config.deployment.parameters.stateChannel.challengePeriod,
          minChannelDeposit: config.deployment.parameters.stateChannel.minChannelDeposit
        });
        initResults.verifications.push({ contract: "StateChannelFactory", checks: factoryVerification });
      }
    }

    // 2. Setup Roles
    console.log("\n=== Setting Up Roles ===");
    
    const roleAssignments = [];

    // Prepare role assignments based on environment variables
    if (process.env.EMERGENCY_ADMIN_ADDRESS) {
      // Assign PAUSER_ROLE to emergency admin for all pausable contracts
      if (deployment.contracts.core.Escrow) {
        roleAssignments.push({
          contractName: "SecureEscrowV2",
          contractAddress: deployment.contracts.core.Escrow.address,
          role: config.deployment.roles.PAUSER_ROLE,
          addresses: [process.env.EMERGENCY_ADMIN_ADDRESS]
        });
      }

      if (deployment.contracts.security && deployment.contracts.security.CircuitBreaker) {
        roleAssignments.push({
          contractName: "CircuitBreaker",
          contractAddress: deployment.contracts.security.CircuitBreaker.address,
          role: config.deployment.roles.PAUSER_ROLE,
          addresses: [process.env.EMERGENCY_ADMIN_ADDRESS]
        });
      }
    }

    if (process.env.OPERATOR_ADDRESS) {
      // Assign OPERATOR_ROLE to operator address
      if (deployment.contracts.core.StateChannelFactory) {
        roleAssignments.push({
          contractName: "StateChannelFactory",
          contractAddress: deployment.contracts.core.StateChannelFactory.address,
          role: config.deployment.roles.OPERATOR_ROLE,
          addresses: [process.env.OPERATOR_ADDRESS]
        });
      }
    }

    if (process.env.ARBITER_ADDRESS) {
      // Assign ARBITER_ROLE for dispute resolution
      if (deployment.contracts.core.Escrow) {
        roleAssignments.push({
          contractName: "SecureEscrowV2",
          contractAddress: deployment.contracts.core.Escrow.address,
          role: config.deployment.roles.ARBITER_ROLE,
          addresses: [process.env.ARBITER_ADDRESS]
        });
      }
    }

    // Execute role assignments
    if (roleAssignments.length > 0) {
      const roleResults = await helpers.setupRoles(deployment, roleAssignments);
      initResults.roleAssignments = roleResults;
    }

    // 3. Configure Security Modules
    console.log("\n=== Configuring Security Modules ===");
    
    if (deployment.contracts.security) {
      // Configure MEVProtection
      if (deployment.contracts.security.MEVProtection) {
        console.log("\n📋 Configuring MEVProtection...");
        const mevProtection = await helpers.getContract("MEVProtection", deployment.contracts.security.MEVProtection.address);
        
        // Verify configuration
        const mevVerification = await helpers.verifyConfiguration(mevProtection, {
          minDelay: config.deployment.parameters.security.mevProtection.minDelay,
          maxDelay: config.deployment.parameters.security.mevProtection.maxDelay,
          priorityFeeThreshold: config.deployment.parameters.security.mevProtection.priorityFeeThreshold
        });
        initResults.verifications.push({ contract: "MEVProtection", checks: mevVerification });
      }

      // Configure CircuitBreaker
      if (deployment.contracts.security.CircuitBreaker) {
        console.log("\n📋 Configuring CircuitBreaker...");
        const circuitBreaker = await helpers.getContract("CircuitBreaker", deployment.contracts.security.CircuitBreaker.address);
        
        // Verify configuration
        const cbVerification = await helpers.verifyConfiguration(circuitBreaker, {
          withdrawalLimit: config.deployment.parameters.security.circuitBreaker.withdrawalLimit,
          withdrawalPeriod: config.deployment.parameters.security.circuitBreaker.withdrawalPeriod,
          cooldownPeriod: config.deployment.parameters.security.circuitBreaker.cooldownPeriod
        });
        initResults.verifications.push({ contract: "CircuitBreaker", checks: cbVerification });
      }
    }

    // 4. Save initialization results
    await helpers.saveInitializationResults(initResults, "initialization-results.json");

    // 5. Generate summary
    console.log("\n📊 Initialization Summary:");
    console.log("========================");
    console.log(`Network: ${network.name}`);
    console.log(`Deployer: ${deployer.address}`);
    
    console.log("\n📝 Role Assignments:");
    const successfulRoles = initResults.roleAssignments.filter(r => r.success);
    const failedRoles = initResults.roleAssignments.filter(r => !r.success);
    console.log(`✅ Successful: ${successfulRoles.length}`);
    console.log(`❌ Failed: ${failedRoles.length}`);
    
    console.log("\n⚙️  Parameter Settings:");
    const successfulParams = initResults.parameterSettings.filter(p => p.success);
    const failedParams = initResults.parameterSettings.filter(p => !p.success);
    console.log(`✅ Successful: ${successfulParams.length}`);
    console.log(`❌ Failed: ${failedParams.length}`);
    
    console.log("\n💰 Fee Recipients:");
    const successfulFees = initResults.feeRecipients.filter(f => f.success);
    const failedFees = initResults.feeRecipients.filter(f => !f.success);
    console.log(`✅ Successful: ${successfulFees.length}`);
    console.log(`❌ Failed: ${failedFees.length}`);
    
    console.log("\n🔍 Configuration Verifications:");
    for (const verification of initResults.verifications) {
      const passed = verification.checks.filter(c => c.match).length;
      const total = verification.checks.length;
      console.log(`${verification.contract}: ${passed}/${total} checks passed`);
    }

    if (failedRoles.length > 0 || failedParams.length > 0 || failedFees.length > 0) {
      console.log("\n⚠️  Some operations failed. Check the detailed results file.");
    } else {
      console.log("\n✅ All initialization steps completed successfully!");
    }

    return initResults;

  } catch (error) {
    console.error("\n❌ Initialization failed:", error);
    throw error;
  }
}

// Execute initialization
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = main;