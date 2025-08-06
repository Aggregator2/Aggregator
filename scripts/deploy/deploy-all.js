const { network } = require("hardhat");
const fs = require("fs");
const path = require("path");

// Import all deployment scripts
const deployCoreContracts = require("./01-deploy-core-contracts");
const deploySecurityModules = require("./02-deploy-security-modules");
const deployVerificationContracts = require("./03-deploy-verification-contracts");
const verifyContracts = require("./verify-contracts");
const initializeContracts = require("./initialize-contracts");
const validateDeployment = require("./validate-deployment");

async function main() {
  console.log(`\n🚀 Starting full deployment process on ${network.name}...\n`);
  console.log("This will:");
  console.log("1. Deploy core contracts (Escrow, StateChannel, Settlement)");
  console.log("2. Deploy security modules (CircuitBreaker, MEVProtection, etc.)");
  console.log("3. Deploy verification contracts (ZKProof, BLS, FraudProof)");
  console.log("4. Verify all contracts on Etherscan (if applicable)");
  console.log("5. Initialize contracts with roles and parameters");
  console.log("6. Validate the entire deployment\n");

  const startTime = Date.now();
  
  try {
    // Step 1: Deploy Core Contracts
    console.log("\n" + "=".repeat(60));
    console.log("STEP 1: DEPLOYING CORE CONTRACTS");
    console.log("=".repeat(60));
    await deployCoreContracts();
    
    // Step 2: Deploy Security Modules
    console.log("\n" + "=".repeat(60));
    console.log("STEP 2: DEPLOYING SECURITY MODULES");
    console.log("=".repeat(60));
    await deploySecurityModules();
    
    // Step 3: Deploy Verification Contracts
    console.log("\n" + "=".repeat(60));
    console.log("STEP 3: DEPLOYING VERIFICATION CONTRACTS");
    console.log("=".repeat(60));
    await deployVerificationContracts();
    
    // Step 4: Verify Contracts (only on public networks)
    const verifiableNetworks = ['mainnet', 'goerli', 'sepolia', 'arbitrum', 'arbitrumGoerli', 'polygon', 'polygonMumbai', 'optimism', 'optimismGoerli'];
    if (verifiableNetworks.includes(network.name)) {
      console.log("\n" + "=".repeat(60));
      console.log("STEP 4: VERIFYING CONTRACTS ON ETHERSCAN");
      console.log("=".repeat(60));
      
      // Add a delay before verification to ensure contracts are indexed
      console.log("\n⏳ Waiting 30 seconds for contract indexing...");
      await new Promise(resolve => setTimeout(resolve, 30000));
      
      await verifyContracts();
    } else {
      console.log("\n" + "=".repeat(60));
      console.log("STEP 4: SKIPPING VERIFICATION (LOCAL NETWORK)");
      console.log("=".repeat(60));
    }
    
    // Step 5: Initialize Contracts
    console.log("\n" + "=".repeat(60));
    console.log("STEP 5: INITIALIZING CONTRACTS");
    console.log("=".repeat(60));
    await initializeContracts();
    
    // Step 6: Validate Deployment
    console.log("\n" + "=".repeat(60));
    console.log("STEP 6: VALIDATING DEPLOYMENT");
    console.log("=".repeat(60));
    await validateDeployment();
    
    // Calculate deployment time
    const deploymentTime = Math.round((Date.now() - startTime) / 1000);
    const minutes = Math.floor(deploymentTime / 60);
    const seconds = deploymentTime % 60;
    
    // Generate deployment report
    console.log("\n" + "=".repeat(60));
    console.log("🎉 DEPLOYMENT COMPLETED SUCCESSFULLY!");
    console.log("=".repeat(60));
    console.log(`\n📊 Deployment Statistics:`);
    console.log(`   Network: ${network.name}`);
    console.log(`   Total Time: ${minutes}m ${seconds}s`);
    
    // Load and display deployment summary
    const summaryPath = path.join(__dirname, "../../deployments", network.name, "deployment-summary.json");
    if (fs.existsSync(summaryPath)) {
      const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
      
      console.log("\n📋 Deployed Contracts:");
      
      if (summary.contracts.core) {
        console.log("\n   Core Contracts:");
        Object.entries(summary.contracts.core).forEach(([name, data]) => {
          console.log(`   - ${name}: ${data.address}`);
        });
      }
      
      if (summary.contracts.security) {
        console.log("\n   Security Modules:");
        Object.entries(summary.contracts.security).forEach(([name, data]) => {
          console.log(`   - ${name}: ${data.address}`);
        });
      }
      
      if (summary.contracts.verification) {
        console.log("\n   Verification Contracts:");
        Object.entries(summary.contracts.verification).forEach(([name, data]) => {
          console.log(`   - ${name}: ${data.address}`);
        });
      }
    }
    
    console.log("\n📁 Deployment artifacts saved to:");
    console.log(`   ${path.join(__dirname, "../../deployments", network.name)}`);
    
    console.log("\n🔧 Next Steps:");
    console.log("1. Review the validation results");
    console.log("2. Update your .env file with the deployed contract addresses");
    console.log("3. Run integration tests against the deployed contracts");
    console.log("4. Monitor contract interactions and gas usage");
    
    if (network.name === 'mainnet') {
      console.log("\n⚠️  MAINNET DEPLOYMENT CHECKLIST:");
      console.log("   [ ] Transfer ownership to multisig wallet");
      console.log("   [ ] Renounce unnecessary admin roles");
      console.log("   [ ] Set up monitoring and alerts");
      console.log("   [ ] Prepare incident response procedures");
      console.log("   [ ] Document all contract addresses");
    }
    
  } catch (error) {
    console.error("\n❌ Deployment failed:", error);
    
    // Try to save error report
    try {
      const errorReport = {
        network: network.name,
        timestamp: new Date().toISOString(),
        error: error.message,
        stack: error.stack
      };
      
      const errorPath = path.join(__dirname, "../../deployments", network.name, `deployment-error-${Date.now()}.json`);
      fs.writeFileSync(errorPath, JSON.stringify(errorReport, null, 2));
      console.log(`\n📁 Error report saved to: ${errorPath}`);
    } catch (saveError) {
      console.error("Failed to save error report:", saveError);
    }
    
    throw error;
  }
}

// Execute full deployment
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = main;