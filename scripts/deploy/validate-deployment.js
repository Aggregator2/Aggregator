const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");
const DeploymentHelpers = require("./deployment-helpers");

// Color codes for console output
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m"
};

async function validateDeployment() {
  console.log(`\n${colors.blue}🔍 Validating deployment on ${network.name}...${colors.reset}\n`);

  const helpers = new DeploymentHelpers(network.name);
  const [signer] = await ethers.getSigners();
  
  const validationResults = {
    network: network.name,
    timestamp: new Date().toISOString(),
    validator: signer.address,
    checks: [],
    summary: {
      total: 0,
      passed: 0,
      failed: 0,
      warnings: 0
    }
  };

  try {
    // Load deployment data
    const deployment = await helpers.loadDeployment();
    const config = helpers.config;
    const networkConfig = config.networks[network.name];

    // 1. Validate Contract Deployments
    console.log("=== Checking Contract Deployments ===\n");
    
    const contractGroups = ['core', 'security', 'verification'];
    for (const group of contractGroups) {
      if (deployment.contracts[group]) {
        for (const [name, contractData] of Object.entries(deployment.contracts[group])) {
          const check = await validateContract(name, contractData.address);
          validationResults.checks.push(check);
          printCheckResult(check);
        }
      }
    }

    // 2. Validate Contract Interactions
    console.log("\n=== Checking Contract Interactions ===\n");

    // Check Escrow can interact with Uniswap
    if (deployment.contracts.core?.Escrow) {
      const escrow = await helpers.getContract("SecureEscrowV2", deployment.contracts.core.Escrow.address);
      const check = {
        name: "Escrow Uniswap Integration",
        category: "interaction",
        status: "pending",
        details: {}
      };

      try {
        const uniswapRouter = await escrow.uniswapRouter();
        check.status = uniswapRouter === networkConfig.contracts.UniswapV2Router ? "passed" : "failed";
        check.details = {
          expected: networkConfig.contracts.UniswapV2Router,
          actual: uniswapRouter
        };
      } catch (error) {
        check.status = "failed";
        check.error = error.message;
      }

      validationResults.checks.push(check);
      printCheckResult(check);
    }

    // 3. Validate Access Control
    console.log("\n=== Checking Access Control ===\n");

    // Check role assignments
    const rolesToCheck = [
      { contract: "Escrow", role: "PAUSER_ROLE", expected: process.env.EMERGENCY_ADMIN_ADDRESS },
      { contract: "CircuitBreaker", role: "PAUSER_ROLE", expected: process.env.EMERGENCY_ADMIN_ADDRESS },
      { contract: "StateChannelFactory", role: "OPERATOR_ROLE", expected: process.env.OPERATOR_ADDRESS }
    ];

    for (const roleCheck of rolesToCheck) {
      if (!roleCheck.expected) continue;
      
      const contractData = deployment.contracts.core?.[roleCheck.contract] || 
                          deployment.contracts.security?.[roleCheck.contract];
      
      if (contractData) {
        const check = await validateRole(
          roleCheck.contract,
          contractData.address,
          config.deployment.roles[roleCheck.role],
          roleCheck.expected
        );
        validationResults.checks.push(check);
        printCheckResult(check);
      }
    }

    // 4. Validate Contract Parameters
    console.log("\n=== Checking Contract Parameters ===\n");

    // Validate Escrow parameters
    if (deployment.contracts.core?.Escrow) {
      const escrow = await helpers.getContract("SecureEscrowV2", deployment.contracts.core.Escrow.address);
      const params = config.deployment.parameters.escrow;
      
      const checks = [
        { name: "feePercentage", getter: "feePercentage", expected: params.feePercentage },
        { name: "minLockDuration", getter: "minLockDuration", expected: params.minLockDuration },
        { name: "maxLockDuration", getter: "maxLockDuration", expected: params.maxLockDuration }
      ];

      for (const param of checks) {
        const check = await validateParameter(
          "Escrow",
          escrow,
          param.name,
          param.getter,
          param.expected
        );
        validationResults.checks.push(check);
        printCheckResult(check);
      }
    }

    // 5. Validate Network Configuration
    console.log("\n=== Checking Network Configuration ===\n");

    // Check chain ID
    const chainId = await signer.getChainId();
    const chainCheck = {
      name: "Chain ID",
      category: "network",
      status: chainId === networkConfig.chainId ? "passed" : "failed",
      details: {
        expected: networkConfig.chainId,
        actual: chainId
      }
    };
    validationResults.checks.push(chainCheck);
    printCheckResult(chainCheck);

    // 6. Validate Contract Verification Status
    console.log("\n=== Checking Contract Verification ===\n");

    const verificationPath = path.join(__dirname, "../../deployments", network.name, "verification-results.json");
    if (fs.existsSync(verificationPath)) {
      const verificationResults = JSON.parse(fs.readFileSync(verificationPath, 'utf8'));
      
      for (const [contractName, result] of Object.entries(verificationResults.results)) {
        const check = {
          name: `${contractName} Verification`,
          category: "verification",
          status: result.success ? "passed" : "failed",
          details: result
        };
        validationResults.checks.push(check);
        printCheckResult(check);
      }
    } else {
      const check = {
        name: "Contract Verification",
        category: "verification",
        status: "warning",
        details: "Verification results not found. Run verify-contracts.js"
      };
      validationResults.checks.push(check);
      printCheckResult(check);
    }

    // 7. Validate Security Settings
    console.log("\n=== Checking Security Settings ===\n");

    // Check if critical contracts are pausable
    const pausableContracts = ["Escrow", "StateChannelFactory"];
    for (const contractName of pausableContracts) {
      const contractData = deployment.contracts.core?.[contractName];
      if (contractData) {
        const contract = await helpers.getContract(contractName, contractData.address);
        const check = {
          name: `${contractName} Pausable`,
          category: "security",
          status: "pending"
        };

        try {
          const isPaused = await contract.paused();
          check.status = "passed";
          check.details = { paused: isPaused };
        } catch (error) {
          check.status = "warning";
          check.details = "Contract may not be pausable";
        }

        validationResults.checks.push(check);
        printCheckResult(check);
      }
    }

    // Calculate summary
    validationResults.checks.forEach(check => {
      validationResults.summary.total++;
      if (check.status === "passed") validationResults.summary.passed++;
      else if (check.status === "failed") validationResults.summary.failed++;
      else if (check.status === "warning") validationResults.summary.warnings++;
    });

    // Save validation results
    const resultsPath = path.join(__dirname, "../../deployments", network.name, "validation-results.json");
    fs.writeFileSync(resultsPath, JSON.stringify(validationResults, null, 2));

    // Print summary
    console.log("\n" + "=".repeat(50));
    console.log(`${colors.blue}📊 Validation Summary${colors.reset}`);
    console.log("=".repeat(50));
    console.log(`Total Checks: ${validationResults.summary.total}`);
    console.log(`${colors.green}✅ Passed: ${validationResults.summary.passed}${colors.reset}`);
    console.log(`${colors.red}❌ Failed: ${validationResults.summary.failed}${colors.reset}`);
    console.log(`${colors.yellow}⚠️  Warnings: ${validationResults.summary.warnings}${colors.reset}`);
    console.log("\n📁 Results saved to:", resultsPath);

    if (validationResults.summary.failed > 0) {
      console.log(`\n${colors.red}❌ Deployment validation failed with ${validationResults.summary.failed} errors${colors.reset}`);
      process.exit(1);
    } else if (validationResults.summary.warnings > 0) {
      console.log(`\n${colors.yellow}⚠️  Deployment validation passed with ${validationResults.summary.warnings} warnings${colors.reset}`);
    } else {
      console.log(`\n${colors.green}✅ Deployment validation passed successfully!${colors.reset}`);
    }

  } catch (error) {
    console.error(`\n${colors.red}❌ Validation failed:${colors.reset}`, error);
    throw error;
  }
}

// Helper functions
async function validateContract(name, address) {
  const check = {
    name: `${name} Deployment`,
    category: "deployment",
    status: "pending",
    address: address
  };

  try {
    const code = await ethers.provider.getCode(address);
    if (code === "0x") {
      check.status = "failed";
      check.error = "No contract code at address";
    } else {
      check.status = "passed";
      check.details = { codeSize: code.length };
    }
  } catch (error) {
    check.status = "failed";
    check.error = error.message;
  }

  return check;
}

async function validateRole(contractName, address, role, expectedAddress) {
  const check = {
    name: `${contractName} Role Assignment`,
    category: "access-control",
    status: "pending",
    details: {
      role: role,
      expected: expectedAddress
    }
  };

  try {
    const contract = await ethers.getContractAt(contractName, address);
    const hasRole = await contract.hasRole(role, expectedAddress);
    check.status = hasRole ? "passed" : "failed";
    check.details.hasRole = hasRole;
  } catch (error) {
    check.status = "failed";
    check.error = error.message;
  }

  return check;
}

async function validateParameter(contractName, contract, paramName, getter, expected) {
  const check = {
    name: `${contractName}.${paramName}`,
    category: "parameter",
    status: "pending",
    details: {
      expected: expected
    }
  };

  try {
    const actual = await contract[getter]();
    check.details.actual = actual.toString();
    check.status = actual.toString() === expected.toString() ? "passed" : "failed";
  } catch (error) {
    check.status = "failed";
    check.error = error.message;
  }

  return check;
}

function printCheckResult(check) {
  const statusSymbol = {
    passed: `${colors.green}✅`,
    failed: `${colors.red}❌`,
    warning: `${colors.yellow}⚠️ `,
    pending: "⏳"
  };

  const status = statusSymbol[check.status] || "❓";
  console.log(`${status} ${check.name}${colors.reset}`);
  
  if (check.error) {
    console.log(`   ${colors.red}Error: ${check.error}${colors.reset}`);
  }
  
  if (check.details && check.status === "failed") {
    if (check.details.expected !== undefined && check.details.actual !== undefined) {
      console.log(`   Expected: ${check.details.expected}`);
      console.log(`   Actual: ${check.details.actual}`);
    }
  }
}

// Execute validation
if (require.main === module) {
  validateDeployment()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = validateDeployment;