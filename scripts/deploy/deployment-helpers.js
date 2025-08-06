const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

class DeploymentHelpers {
  constructor(network) {
    this.network = network;
    this.configPath = path.join(__dirname, "../../deployment/deployment-config.json");
    this.config = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
    this.roles = this.config.deployment.roles;
  }

  // Load deployment results for a specific network
  async loadDeployment(contractType = "deployment-summary") {
    const deploymentPath = path.join(__dirname, "../../deployments", this.network, `${contractType}.json`);
    if (!fs.existsSync(deploymentPath)) {
      throw new Error(`Deployment file not found: ${deploymentPath}`);
    }
    return JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
  }

  // Get contract instance
  async getContract(contractName, address) {
    return await ethers.getContractAt(contractName, address);
  }

  // Grant role to an address
  async grantRole(contract, role, address, signer) {
    console.log(`\n🔐 Granting ${this.getRoleName(role)} to ${address}...`);
    const tx = await contract.connect(signer || contract.signer).grantRole(role, address);
    await tx.wait();
    console.log(`✅ Role granted successfully`);
    return tx;
  }

  // Revoke role from an address
  async revokeRole(contract, role, address, signer) {
    console.log(`\n🔓 Revoking ${this.getRoleName(role)} from ${address}...`);
    const tx = await contract.connect(signer || contract.signer).revokeRole(role, address);
    await tx.wait();
    console.log(`✅ Role revoked successfully`);
    return tx;
  }

  // Setup all roles for a deployment
  async setupRoles(deployment, roleAssignments) {
    console.log("\n🔧 Setting up roles...");
    const results = [];

    for (const assignment of roleAssignments) {
      const { contractName, contractAddress, role, addresses } = assignment;
      const contract = await this.getContract(contractName, contractAddress);

      for (const address of addresses) {
        try {
          const tx = await this.grantRole(contract, role, address);
          results.push({
            contract: contractName,
            role: this.getRoleName(role),
            address: address,
            success: true,
            txHash: tx.hash
          });
        } catch (error) {
          results.push({
            contract: contractName,
            role: this.getRoleName(role),
            address: address,
            success: false,
            error: error.message
          });
        }
      }
    }

    return results;
  }

  // Initialize contract parameters
  async initializeParameters(contract, parameters) {
    console.log("\n⚙️  Initializing contract parameters...");
    const results = [];

    for (const [method, value] of Object.entries(parameters)) {
      try {
        console.log(`Setting ${method} to ${value}...`);
        const tx = await contract[method](value);
        await tx.wait();
        results.push({
          method,
          value,
          success: true,
          txHash: tx.hash
        });
        console.log(`✅ ${method} set successfully`);
      } catch (error) {
        results.push({
          method,
          value,
          success: false,
          error: error.message
        });
        console.log(`❌ Failed to set ${method}: ${error.message}`);
      }
    }

    return results;
  }

  // Transfer ownership
  async transferOwnership(contract, newOwner) {
    console.log(`\n👑 Transferring ownership to ${newOwner}...`);
    const tx = await contract.transferOwnership(newOwner);
    await tx.wait();
    console.log(`✅ Ownership transferred successfully`);
    return tx;
  }

  // Pause/Unpause contract
  async pauseContract(contract, pause = true) {
    const action = pause ? "Pausing" : "Unpausing";
    console.log(`\n⏸️  ${action} contract...`);
    const tx = pause ? await contract.pause() : await contract.unpause();
    await tx.wait();
    console.log(`✅ Contract ${pause ? "paused" : "unpaused"} successfully`);
    return tx;
  }

  // Setup fee recipients
  async setupFeeRecipients(contracts, feeRecipient) {
    console.log(`\n💰 Setting up fee recipients to ${feeRecipient}...`);
    const results = [];

    for (const [name, address] of Object.entries(contracts)) {
      try {
        const contract = await this.getContract(name, address);
        if (contract.setFeeRecipient) {
          const tx = await contract.setFeeRecipient(feeRecipient);
          await tx.wait();
          results.push({
            contract: name,
            success: true,
            txHash: tx.hash
          });
          console.log(`✅ Fee recipient set for ${name}`);
        } else {
          results.push({
            contract: name,
            success: false,
            error: "No setFeeRecipient method"
          });
        }
      } catch (error) {
        results.push({
          contract: name,
          success: false,
          error: error.message
        });
      }
    }

    return results;
  }

  // Verify contract configuration
  async verifyConfiguration(contract, expectedConfig) {
    console.log("\n🔍 Verifying contract configuration...");
    const results = [];

    for (const [getter, expectedValue] of Object.entries(expectedConfig)) {
      try {
        const actualValue = await contract[getter]();
        const match = actualValue.toString() === expectedValue.toString();
        results.push({
          parameter: getter,
          expected: expectedValue,
          actual: actualValue.toString(),
          match
        });
        
        if (match) {
          console.log(`✅ ${getter}: ${actualValue}`);
        } else {
          console.log(`❌ ${getter}: expected ${expectedValue}, got ${actualValue}`);
        }
      } catch (error) {
        results.push({
          parameter: getter,
          expected: expectedValue,
          error: error.message
        });
        console.log(`❌ Failed to read ${getter}: ${error.message}`);
      }
    }

    return results;
  }

  // Get role name from bytes32
  getRoleName(role) {
    const roleNames = {
      [this.roles.DEFAULT_ADMIN_ROLE]: "DEFAULT_ADMIN_ROLE",
      [this.roles.PAUSER_ROLE]: "PAUSER_ROLE",
      [this.roles.OPERATOR_ROLE]: "OPERATOR_ROLE",
      [this.roles.ARBITER_ROLE]: "ARBITER_ROLE",
      [this.roles.FEE_COLLECTOR_ROLE]: "FEE_COLLECTOR_ROLE"
    };
    return roleNames[role] || role;
  }

  // Save initialization results
  async saveInitializationResults(results, filename) {
    const deploymentDir = path.join(__dirname, "../../deployments", this.network);
    const filepath = path.join(deploymentDir, filename);
    fs.writeFileSync(filepath, JSON.stringify(results, null, 2));
    console.log(`\n📁 Results saved to: ${filepath}`);
  }

  // Create initialization script for a specific deployment
  async generateInitializationScript(deployment) {
    const script = `
// Auto-generated initialization script for ${this.network}
// Generated at: ${new Date().toISOString()}

const { ethers } = require("hardhat");
const DeploymentHelpers = require("./deployment-helpers");

async function main() {
  const helpers = new DeploymentHelpers("${this.network}");
  const [deployer] = await ethers.getSigners();
  
  console.log("Initializing contracts on ${this.network}...");
  console.log("Deployer:", deployer.address);

  // Load deployment
  const deployment = await helpers.loadDeployment();

  // TODO: Add your initialization logic here
  // Example:
  // const escrow = await helpers.getContract("SecureEscrowV2", deployment.contracts.core.Escrow.address);
  // await helpers.initializeParameters(escrow, {
  //   setFeeRecipient: process.env.FEE_RECIPIENT_ADDRESS,
  //   setEmergencyWithdrawDelay: 259200
  // });

  console.log("\\n✅ Initialization completed!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
`;

    const scriptPath = path.join(__dirname, `initialize-${this.network}.js`);
    fs.writeFileSync(scriptPath, script);
    console.log(`\n📄 Initialization script generated: ${scriptPath}`);
    return scriptPath;
  }
}

module.exports = DeploymentHelpers;