#!/usr/bin/env node
/**
 * Automated Secrets Rotation System
 */

const crypto = require('crypto');

class SecureSecretsRotator {
  constructor() {
    this.rotationPolicies = {
      jwt_secret: { rotation_days: 30 },
      encryption_key: { rotation_days: 90 },
      api_keys: { rotation_days: 14 },
      database_passwords: { rotation_days: 60 }
    };
    this.rotationLog = [];
  }

  async checkRotationRequirements() {
    const rotationPlan = {
      rotation_needed: false,
      secrets_to_rotate: [],
      timestamp: new Date().toISOString()
    };

    for (const [secretType, policy] of Object.entries(this.rotationPolicies)) {
      const lastRotation = await this.getLastRotationDate(secretType);
      const daysSinceRotation = this.calculateDaysSince(lastRotation);
      
      if (daysSinceRotation >= policy.rotation_days) {
        rotationPlan.rotation_needed = true;
        rotationPlan.secrets_to_rotate.push(secretType);
      }
    }

    return rotationPlan;
  }

  generateStrongSecret(length = 32) {
    return crypto.randomBytes(length).toString('base64url');
  }

  async getLastRotationDate(secretType) {
    // Demo: jwt_secret is 45 days old (needs rotation)
    const daysAgo = secretType === 'jwt_secret' ? 45 : 10;
    return new Date(Date.now() - (daysAgo * 24 * 60 * 60 * 1000));
  }

  calculateDaysSince(date) {
    const now = new Date();
    const diffTime = Math.abs(now - date);
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }

  async rotateSecrets(secretType) {
    console.log(`Rotating secrets for: ${secretType}`);
    const newSecret = this.generateStrongSecret();
    console.log(`Generated new ${secretType}: ${newSecret.substring(0, 8)}...`);
    return newSecret;
  }
}

async function main() {
  const rotator = new SecureSecretsRotator();
  const plan = await rotator.checkRotationRequirements();
  
  console.log('Rotation Plan:', JSON.stringify(plan, null, 2));
  
  if (plan.rotation_needed) {
    for (const secretType of plan.secrets_to_rotate) {
      await rotator.rotateSecrets(secretType);
    }
  }
}

if (require.main === module) {
  main();
}

module.exports = SecureSecretsRotator;