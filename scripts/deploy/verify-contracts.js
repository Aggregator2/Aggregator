const { run, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function verifyContract(address, constructorArguments, contractPath) {
  try {
    console.log(`\n🔍 Verifying ${contractPath || "contract"} at ${address}...`);
    
    const verificationArgs = {
      address: address,
      constructorArguments: constructorArguments
    };
    
    if (contractPath) {
      verificationArgs.contract = contractPath;
    }
    
    await run("verify:verify", verificationArgs);
    
    console.log(`✅ Verified successfully!`);
    return { success: true };
  } catch (error) {
    if (error.message.includes("already verified")) {
      console.log(`✅ Contract already verified!`);
      return { success: true, alreadyVerified: true };
    }
    console.error(`❌ Verification failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function main() {
  console.log(`\n🚀 Starting contract verification on ${network.name}...\n`);

  // Check if we're on a supported network
  const supportedNetworks = ['mainnet', 'goerli', 'sepolia', 'arbitrum', 'arbitrumGoerli', 'polygon', 'polygonMumbai', 'optimism', 'optimismGoerli'];
  if (!supportedNetworks.includes(network.name)) {
    console.log(`⚠️  Network ${network.name} is not supported for verification`);
    return;
  }

  // Load deployment results
  const deploymentDir = path.join(__dirname, "../../deployments", network.name);
  const summaryPath = path.join(deploymentDir, "deployment-summary.json");
  
  if (!fs.existsSync(summaryPath)) {
    throw new Error(`No deployment found for ${network.name}. Run deployment scripts first.`);
  }

  const deployment = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  
  console.log(`📋 Found deployment from ${deployment.timestamp}`);
  console.log(`📋 Deployer: ${deployment.deployer}`);

  const verificationResults = {
    network: network.name,
    timestamp: new Date().toISOString(),
    results: {}
  };

  // Verify Core Contracts
  console.log("\n=== Verifying Core Contracts ===");
  
  if (deployment.contracts.core) {
    for (const [name, contract] of Object.entries(deployment.contracts.core)) {
      let contractPath;
      
      // Map contract names to their file paths
      switch(name) {
        case "Escrow":
          contractPath = "contracts/SecureEscrowV2.sol:SecureEscrowV2";
          break;
        case "StateChannelFactory":
          contractPath = "contracts/stateChannels/StateChannelFactory.sol:StateChannelFactory";
          break;
        case "SettlementWithProofs":
          contractPath = "contracts/settlement/SettlementWithProofs.sol:SettlementWithProofs";
          break;
      }
      
      const result = await verifyContract(
        contract.address,
        contract.constructorArgs || [],
        contractPath
      );
      
      verificationResults.results[name] = {
        address: contract.address,
        ...result
      };
      
      // Add delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }

  // Verify Security Modules
  console.log("\n=== Verifying Security Modules ===");
  
  if (deployment.contracts.security) {
    for (const [name, contract] of Object.entries(deployment.contracts.security)) {
      let contractPath;
      
      // Map contract names to their file paths
      switch(name) {
        case "CircuitBreaker":
          contractPath = "contracts/security/CircuitBreaker.sol:CircuitBreaker";
          break;
        case "MEVProtection":
          contractPath = "contracts/security/MEVProtection.sol:MEVProtection";
          break;
        case "GasProtection":
          contractPath = "contracts/security/GasProtection.sol:GasProtection";
          break;
        case "SignatureVerifier":
          contractPath = "contracts/security/SignatureVerifier.sol:SignatureVerifier";
          break;
      }
      
      const result = await verifyContract(
        contract.address,
        contract.constructorArgs || [],
        contractPath
      );
      
      verificationResults.results[name] = {
        address: contract.address,
        ...result
      };
      
      // Add delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }

  // Verify Verification Contracts
  console.log("\n=== Verifying Verification Contracts ===");
  
  if (deployment.contracts.verification) {
    for (const [name, contract] of Object.entries(deployment.contracts.verification)) {
      let contractPath;
      
      // Map contract names to their file paths
      switch(name) {
        case "ZKProofVerifier":
          contractPath = "contracts/verification/ZKProofVerifier.sol:ZKProofVerifier";
          break;
        case "BLSSignatureVerifier":
          contractPath = "contracts/verification/BLSSignatureVerifier.sol:BLSSignatureVerifier";
          break;
        case "FraudProofVerifier":
          contractPath = "contracts/verification/FraudProofVerifier.sol:FraudProofVerifier";
          break;
      }
      
      const result = await verifyContract(
        contract.address,
        contract.constructorArgs || [],
        contractPath
      );
      
      verificationResults.results[name] = {
        address: contract.address,
        ...result
      };
      
      // Add delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }

  // Save verification results
  const verificationFile = path.join(deploymentDir, "verification-results.json");
  fs.writeFileSync(verificationFile, JSON.stringify(verificationResults, null, 2));
  console.log(`\n📁 Verification results saved to: ${verificationFile}`);

  // Generate summary
  console.log("\n📊 Verification Summary:");
  console.log("======================");
  
  let totalContracts = 0;
  let verifiedContracts = 0;
  let alreadyVerified = 0;
  let failedContracts = 0;

  for (const [name, result] of Object.entries(verificationResults.results)) {
    totalContracts++;
    if (result.success) {
      if (result.alreadyVerified) {
        alreadyVerified++;
        console.log(`✅ ${name}: Already verified`);
      } else {
        verifiedContracts++;
        console.log(`✅ ${name}: Newly verified`);
      }
    } else {
      failedContracts++;
      console.log(`❌ ${name}: Failed - ${result.error}`);
    }
  }

  console.log("\n📈 Statistics:");
  console.log(`Total contracts: ${totalContracts}`);
  console.log(`Newly verified: ${verifiedContracts}`);
  console.log(`Already verified: ${alreadyVerified}`);
  console.log(`Failed: ${failedContracts}`);

  if (failedContracts > 0) {
    console.log("\n⚠️  Some contracts failed to verify. Check the results above.");
  } else {
    console.log("\n✅ All contracts verified successfully!");
  }
}

// Execute verification
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = main;