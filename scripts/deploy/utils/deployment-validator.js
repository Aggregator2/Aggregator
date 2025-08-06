const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

class DeploymentValidator {
  constructor() {
    this.errors = [];
    this.warnings = [];
  }

  // Validate deployment configuration
  validateConfig(config, network) {
    console.log("🔍 Validating deployment configuration...");
    
    // Validate network config exists
    if (!config.networks[network]) {
      this.errors.push(`Network configuration not found for ${network}`);
      return false;
    }

    const networkConfig = config.networks[network];
    const params = config.deployment.parameters;

    // Validate addresses
    this.validateAddresses(networkConfig.contracts);

    // Validate parameters
    this.validateParameters(params);

    // Validate roles
    this.validateRoles(config.deployment.roles);

    // Check for warnings
    this.checkWarnings(config, network);

    return this.errors.length === 0;
  }

  validateAddresses(contracts) {
    for (const [name, address] of Object.entries(contracts)) {
      if (!ethers.utils.isAddress(address)) {
        this.errors.push(`Invalid address for ${name}: ${address}`);
      }
      
      // Check for zero address
      if (address === ethers.constants.AddressZero) {
        this.errors.push(`Zero address provided for ${name}`);
      }
    }
  }

  validateParameters(params) {
    // Validate escrow parameters
    if (params.escrow) {
      const { feePercentage, minLockDuration, maxLockDuration, emergencyWithdrawDelay } = params.escrow;
      
      // Fee percentage (0-10000 basis points = 0-100%)
      if (feePercentage < 0 || feePercentage > 10000) {
        this.errors.push(`Invalid fee percentage: ${feePercentage}. Must be between 0 and 10000`);
      }
      
      // Lock durations
      if (minLockDuration >= maxLockDuration) {
        this.errors.push(`Min lock duration (${minLockDuration}) must be less than max (${maxLockDuration})`);
      }
      
      if (minLockDuration < 60) {
        this.warnings.push(`Min lock duration (${minLockDuration}s) is very short`);
      }
      
      if (maxLockDuration > 365 * 24 * 60 * 60) {
        this.warnings.push(`Max lock duration (${maxLockDuration}s) is over 1 year`);
      }
      
      if (emergencyWithdrawDelay < 86400) {
        this.warnings.push(`Emergency withdraw delay (${emergencyWithdrawDelay}s) is less than 24 hours`);
      }
    }

    // Validate state channel parameters
    if (params.stateChannel) {
      const { challengePeriod, minChannelDeposit } = params.stateChannel;
      
      if (challengePeriod < 3600) {
        this.warnings.push(`Challenge period (${challengePeriod}s) is less than 1 hour`);
      }
      
      if (ethers.BigNumber.from(minChannelDeposit).eq(0)) {
        this.errors.push("Min channel deposit cannot be zero");
      }
    }

    // Validate security parameters
    if (params.security?.circuitBreaker) {
      const { withdrawalLimit, withdrawalPeriod, cooldownPeriod } = params.security.circuitBreaker;
      
      if (ethers.BigNumber.from(withdrawalLimit).eq(0)) {
        this.errors.push("Withdrawal limit cannot be zero");
      }
      
      if (cooldownPeriod >= withdrawalPeriod) {
        this.errors.push("Cooldown period must be less than withdrawal period");
      }
    }
  }

  validateRoles(roles) {
    const expectedRoles = [
      'DEFAULT_ADMIN_ROLE',
      'PAUSER_ROLE',
      'OPERATOR_ROLE',
      'ARBITER_ROLE',
      'FEE_COLLECTOR_ROLE'
    ];

    for (const role of expectedRoles) {
      if (!roles[role]) {
        this.errors.push(`Missing role definition: ${role}`);
      }
      
      // Validate role format (should be bytes32)
      if (roles[role] && !roles[role].match(/^0x[a-fA-F0-9]{64}$/)) {
        this.errors.push(`Invalid role format for ${role}: ${roles[role]}`);
      }
    }
  }

  checkWarnings(config, network) {
    // Warn about mainnet deployment
    if (network === 'mainnet') {
      this.warnings.push("⚠️  Deploying to MAINNET - ensure all parameters are production-ready");
      
      // Check for test values
      if (config.deployment.parameters.escrow.feePercentage === 0) {
        this.warnings.push("Fee percentage is 0 for mainnet deployment");
      }
    }

    // Check for missing optional env vars
    const optionalEnvVars = [
      'MULTISIG_ADDRESS',
      'PRICE_ORACLE_ADDRESS',
      'EMERGENCY_ADMIN_ADDRESS'
    ];

    for (const envVar of optionalEnvVars) {
      if (!process.env[envVar]) {
        this.warnings.push(`Optional ${envVar} not set`);
      }
    }
  }

  // Validate deployed contract
  async validateDeployedContract(contract, expectedBytecode, constructorArgs) {
    console.log(`🔍 Validating deployed contract at ${contract.address}...`);

    // Check contract exists
    const code = await ethers.provider.getCode(contract.address);
    if (code === '0x') {
      this.errors.push(`No contract code at address ${contract.address}`);
      return false;
    }

    // Validate contract size (24KB limit)
    const codeSize = (code.length - 2) / 2; // Remove 0x and convert to bytes
    if (codeSize > 24576) {
      this.warnings.push(`Contract size (${codeSize} bytes) is close to 24KB limit`);
    }

    return true;
  }

  // Validate gas settings
  async validateGasSettings(config, network) {
    const networkConfig = config.networks[network];
    const currentGasPrice = await ethers.provider.getGasPrice();
    
    if (networkConfig.gasSettings?.maxFeePerGas) {
      const maxFee = ethers.BigNumber.from(networkConfig.gasSettings.maxFeePerGas);
      if (currentGasPrice.gt(maxFee)) {
        this.errors.push(`Current gas price (${currentGasPrice}) exceeds max fee (${maxFee})`);
      }
    }

    // Warn if gas price is unusually high
    const highGasThreshold = ethers.utils.parseUnits("200", "gwei");
    if (currentGasPrice.gt(highGasThreshold)) {
      this.warnings.push(`Gas price is very high: ${ethers.utils.formatUnits(currentGasPrice, "gwei")} gwei`);
    }

    return this.errors.length === 0;
  }

  // Check role separation
  validateRoleSeparation() {
    const criticalAddresses = [
      process.env.DEPLOYER_ADDRESS,
      process.env.EMERGENCY_ADMIN_ADDRESS,
      process.env.OPERATOR_ADDRESS,
      process.env.FEE_RECIPIENT_ADDRESS,
      process.env.ARBITER_ADDRESS
    ].filter(addr => addr);

    const uniqueAddresses = new Set(criticalAddresses.map(addr => addr.toLowerCase()));
    
    if (uniqueAddresses.size < criticalAddresses.length) {
      this.warnings.push("⚠️  Same address has multiple critical roles - consider role separation");
    }

    // Check deployer is not permanent admin
    if (process.env.DEPLOYER_ADDRESS && 
        process.env.EMERGENCY_ADMIN_ADDRESS &&
        process.env.DEPLOYER_ADDRESS.toLowerCase() === process.env.EMERGENCY_ADMIN_ADDRESS.toLowerCase()) {
      this.warnings.push("⚠️  Deployer is set as emergency admin - transfer ownership after deployment");
    }
  }

  // Get validation summary
  getSummary() {
    return {
      errors: this.errors,
      warnings: this.warnings,
      isValid: this.errors.length === 0,
      errorCount: this.errors.length,
      warningCount: this.warnings.length
    };
  }

  // Print validation results
  printResults() {
    console.log("\n📋 Validation Results:");
    console.log("=".repeat(50));

    if (this.errors.length > 0) {
      console.log("\n❌ Errors:");
      this.errors.forEach(error => console.log(`   - ${error}`));
    }

    if (this.warnings.length > 0) {
      console.log("\n⚠️  Warnings:");
      this.warnings.forEach(warning => console.log(`   - ${warning}`));
    }

    if (this.errors.length === 0 && this.warnings.length === 0) {
      console.log("\n✅ All validations passed!");
    }

    console.log("=".repeat(50));
  }

  // Save validation report
  saveReport(deploymentDir) {
    const report = {
      timestamp: new Date().toISOString(),
      ...this.getSummary()
    };

    const reportPath = path.join(deploymentDir, "validation-report.json");
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\n📁 Validation report saved to: ${reportPath}`);
  }
}

module.exports = DeploymentValidator;