const fs = require("fs");
const path = require("path");
const { ethers } = require("hardhat");
const crypto = require("crypto");

class DeploymentGuard {
  constructor(deploymentDir) {
    this.deploymentDir = deploymentDir;
    this.lockFile = path.join(deploymentDir, ".deployment.lock");
    this.checksumFile = path.join(deploymentDir, ".deployment.checksums");
  }

  // Acquire deployment lock
  async acquireLock() {
    // Check for existing lock
    if (fs.existsSync(this.lockFile)) {
      const lockData = JSON.parse(fs.readFileSync(this.lockFile, 'utf8'));
      const lockAge = Date.now() - lockData.timestamp;
      
      // Check if lock is stale (older than 30 minutes)
      if (lockAge > 30 * 60 * 1000) {
        console.log("⚠️  Found stale deployment lock, removing...");
        fs.unlinkSync(this.lockFile);
      } else {
        throw new Error(
          `Deployment already in progress (PID: ${lockData.pid}, ` +
          `started ${Math.round(lockAge / 1000)}s ago). ` +
          `Remove ${this.lockFile} if this is an error.`
        );
      }
    }

    // Create lock
    const lockData = {
      pid: process.pid,
      timestamp: Date.now(),
      network: process.env.HARDHAT_NETWORK,
      user: process.env.USER || 'unknown'
    };

    fs.writeFileSync(this.lockFile, JSON.stringify(lockData, null, 2));
    
    // Ensure lock is removed on exit
    process.on('exit', () => this.releaseLock());
    process.on('SIGINT', () => {
      this.releaseLock();
      process.exit(1);
    });
    process.on('SIGTERM', () => {
      this.releaseLock();
      process.exit(1);
    });

    console.log("🔒 Deployment lock acquired");
  }

  // Release deployment lock
  releaseLock() {
    if (fs.existsSync(this.lockFile)) {
      fs.unlinkSync(this.lockFile);
      console.log("🔓 Deployment lock released");
    }
  }

  // Verify bytecode integrity
  async verifyBytecode(address, expectedBytecode, contractName) {
    console.log(`🔍 Verifying bytecode for ${contractName}...`);
    
    const deployedBytecode = await ethers.provider.getCode(address);
    
    if (deployedBytecode === '0x') {
      throw new Error(`No contract deployed at ${address}`);
    }

    // Remove constructor arguments and metadata from bytecode comparison
    const cleanExpected = this.cleanBytecode(expectedBytecode);
    const cleanDeployed = this.cleanBytecode(deployedBytecode);

    if (!cleanDeployed.includes(cleanExpected.slice(0, 1000))) {
      throw new Error(
        `Bytecode mismatch for ${contractName} at ${address}. ` +
        `This could indicate a compromised deployment.`
      );
    }

    console.log(`✅ Bytecode verified for ${contractName}`);
    return true;
  }

  // Clean bytecode for comparison
  cleanBytecode(bytecode) {
    // Remove 0x prefix
    let clean = bytecode.startsWith('0x') ? bytecode.slice(2) : bytecode;
    
    // Remove Solidity metadata hash (last 53 bytes)
    // Format: a264697066735822{32 bytes IPFS hash}64736f6c63{3 bytes version}0033
    const metadataLength = 53 * 2; // 53 bytes = 106 hex chars
    if (clean.length > metadataLength) {
      const metadataStart = clean.length - metadataLength;
      if (clean.slice(metadataStart, metadataStart + 12) === 'a264697066735822') {
        clean = clean.slice(0, metadataStart);
      }
    }
    
    return clean;
  }

  // Generate deployment checksum
  generateChecksum(deploymentData) {
    const hash = crypto.createHash('sha256');
    hash.update(JSON.stringify(deploymentData, null, 2));
    return hash.digest('hex');
  }

  // Save deployment checksums
  async saveChecksums(deploymentResults) {
    const checksums = {};
    
    for (const [contractName, contractData] of Object.entries(deploymentResults.contracts)) {
      const bytecode = await ethers.provider.getCode(contractData.address);
      const checksum = this.generateChecksum({
        name: contractName,
        address: contractData.address,
        bytecode: bytecode,
        constructorArgs: contractData.constructorArgs || [],
        deploymentBlock: contractData.blockNumber
      });
      
      checksums[contractName] = {
        address: contractData.address,
        checksum: checksum,
        timestamp: new Date().toISOString()
      };
    }

    fs.writeFileSync(this.checksumFile, JSON.stringify(checksums, null, 2));
    console.log("📝 Deployment checksums saved");
    
    return checksums;
  }

  // Verify deployment checksums
  async verifyChecksums() {
    if (!fs.existsSync(this.checksumFile)) {
      console.log("⚠️  No checksums file found");
      return { valid: true, missing: true };
    }

    const savedChecksums = JSON.parse(fs.readFileSync(this.checksumFile, 'utf8'));
    const results = { valid: true, contracts: {} };

    for (const [contractName, checksumData] of Object.entries(savedChecksums)) {
      const bytecode = await ethers.provider.getCode(checksumData.address);
      const currentChecksum = this.generateChecksum({
        name: contractName,
        address: checksumData.address,
        bytecode: bytecode
      });

      const isValid = currentChecksum === checksumData.checksum;
      results.contracts[contractName] = {
        valid: isValid,
        address: checksumData.address
      };

      if (!isValid) {
        results.valid = false;
        console.error(`❌ Checksum mismatch for ${contractName}`);
      }
    }

    return results;
  }

  // Check for duplicate deployments
  async checkDuplicateDeployment(contractName, deploymentType) {
    const deploymentFile = path.join(this.deploymentDir, `${deploymentType}.json`);
    
    if (fs.existsSync(deploymentFile)) {
      const existingDeployment = JSON.parse(fs.readFileSync(deploymentFile, 'utf8'));
      
      if (existingDeployment.contracts && existingDeployment.contracts[contractName]) {
        const address = existingDeployment.contracts[contractName].address;
        const code = await ethers.provider.getCode(address);
        
        if (code !== '0x') {
          console.warn(`⚠️  ${contractName} already deployed at ${address}`);
          
          // Ask for confirmation in interactive mode
          if (process.env.CI !== 'true') {
            const readline = require('readline').createInterface({
              input: process.stdin,
              output: process.stdout
            });
            
            return new Promise((resolve) => {
              readline.question(
                `Continue with new deployment? (y/N): `,
                (answer) => {
                  readline.close();
                  resolve(answer.toLowerCase() === 'y');
                }
              );
            });
          }
        }
      }
    }
    
    return true;
  }

  // Backup deployment configuration
  async backupConfiguration(config) {
    const backupDir = path.join(this.deploymentDir, 'backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(backupDir, `config-${timestamp}.json`);

    // Include environment snapshot
    const backup = {
      config: config,
      environment: {
        network: process.env.HARDHAT_NETWORK,
        node_version: process.version,
        timestamp: timestamp,
        git_commit: await this.getGitCommit(),
        env_vars: this.getSafeEnvVars()
      }
    };

    fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2));
    console.log(`💾 Configuration backed up to ${backupFile}`);

    // Keep only last 10 backups
    this.cleanupOldBackups(backupDir, 10);
  }

  // Get current git commit
  async getGitCommit() {
    try {
      const { execSync } = require('child_process');
      return execSync('git rev-parse HEAD').toString().trim();
    } catch (error) {
      return 'unknown';
    }
  }

  // Get safe environment variables (no secrets)
  getSafeEnvVars() {
    const safeVars = {};
    const allowedVars = [
      'HARDHAT_NETWORK',
      'FEE_RECIPIENT_ADDRESS',
      'EMERGENCY_ADMIN_ADDRESS',
      'OPERATOR_ADDRESS',
      'ARBITER_ADDRESS',
      'TREASURY_ADDRESS',
      'MULTISIG_ADDRESS'
    ];

    for (const varName of allowedVars) {
      if (process.env[varName]) {
        safeVars[varName] = process.env[varName];
      }
    }

    return safeVars;
  }

  // Cleanup old backups
  cleanupOldBackups(backupDir, keepCount) {
    const files = fs.readdirSync(backupDir)
      .filter(f => f.startsWith('config-'))
      .map(f => ({
        name: f,
        path: path.join(backupDir, f),
        time: fs.statSync(path.join(backupDir, f)).mtime
      }))
      .sort((a, b) => b.time - a.time);

    if (files.length > keepCount) {
      const toDelete = files.slice(keepCount);
      for (const file of toDelete) {
        fs.unlinkSync(file.path);
      }
      console.log(`🧹 Cleaned up ${toDelete.length} old backup(s)`);
    }
  }

  // Create deployment snapshot
  async createSnapshot(deploymentResults) {
    const snapshot = {
      ...deploymentResults,
      checksums: await this.saveChecksums(deploymentResults),
      gitCommit: await this.getGitCommit(),
      verifiedAt: new Date().toISOString()
    };

    const snapshotFile = path.join(
      this.deploymentDir,
      `deployment-snapshot-${Date.now()}.json`
    );
    
    fs.writeFileSync(snapshotFile, JSON.stringify(snapshot, null, 2));
    console.log(`📸 Deployment snapshot saved to ${snapshotFile}`);

    return snapshot;
  }

  // Verify deployment integrity
  async verifyIntegrity(deploymentFile) {
    console.log("🔐 Verifying deployment integrity...");

    if (!fs.existsSync(deploymentFile)) {
      throw new Error(`Deployment file not found: ${deploymentFile}`);
    }

    const deployment = JSON.parse(fs.readFileSync(deploymentFile, 'utf8'));
    const checksumResults = await this.verifyChecksums();

    if (!checksumResults.valid) {
      throw new Error("Deployment integrity check failed - checksums don't match");
    }

    console.log("✅ Deployment integrity verified");
    return true;
  }
}

module.exports = DeploymentGuard;