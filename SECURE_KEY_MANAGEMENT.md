# Secure Key Management Guide

## ⚠️ IMPORTANT: Private Key Security

**NEVER commit private keys to version control!** This includes:
- Private keys in `.env` files
- Private keys in configuration files
- Private keys in source code
- Private keys in documentation

## Your Private Keys Backup

Your private keys have been securely backed up to: `.env.backup.SECURE`

**IMPORTANT**: 
1. Copy this file to a secure location outside the repository
2. Delete the backup file after securing it elsewhere
3. This file is in `.gitignore` but should not remain in the project directory

## Local Development Setup

For local development, the system now automatically uses Hardhat test accounts:

```javascript
// Test Account #0 (automatically used for main operations)
Address: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
Private Key: 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

// Test Account #1 (automatically used for revenue operations)
Address: 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
Private Key: 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
```

The system will automatically use these when no private keys are found in `.env`.

## Production Deployment

### Option 1: Environment Variables (Recommended for most platforms)

Set environment variables in your hosting platform:

**Vercel:**
```bash
vercel env add PRIVATE_KEY
vercel env add REVENUE_PRIVATE_KEY
```

**Heroku:**
```bash
heroku config:set PRIVATE_KEY=your_private_key
heroku config:set REVENUE_PRIVATE_KEY=your_revenue_private_key
```

**AWS Elastic Beanstalk:**
```bash
eb setenv PRIVATE_KEY=your_private_key REVENUE_PRIVATE_KEY=your_revenue_private_key
```

### Option 2: Secure Key Management Services

For enterprise deployments, use dedicated key management services:

1. **AWS Key Management Service (KMS)**
   ```javascript
   const AWS = require('aws-sdk');
   const kms = new AWS.KMS();
   
   // Decrypt private key from KMS
   const decryptedKey = await kms.decrypt({
     CiphertextBlob: Buffer.from(encryptedKey, 'base64')
   }).promise();
   ```

2. **HashiCorp Vault**
   ```javascript
   const vault = require('node-vault')();
   const secret = await vault.read('secret/data/private-keys');
   const privateKey = secret.data.data.PRIVATE_KEY;
   ```

3. **Azure Key Vault**
   ```javascript
   const { SecretClient } = require("@azure/keyvault-secrets");
   const client = new SecretClient(vaultUrl, credential);
   const secret = await client.getSecret("private-key");
   ```

4. **Google Cloud Secret Manager**
   ```javascript
   const {SecretManagerServiceClient} = require('@google-cloud/secret-manager');
   const client = new SecretManagerServiceClient();
   const [version] = await client.accessSecretVersion({name});
   ```

## Security Checklist

- [ ] Private keys removed from `.env` file
- [ ] `.env` file is in `.gitignore`
- [ ] Backup file moved to secure location
- [ ] Test accounts working for local development
- [ ] Production deployment method chosen
- [ ] All exposed keys rotated (if any were committed)
- [ ] Team informed about new security practices

## Rotating Compromised Keys

If keys were accidentally exposed:

1. **Generate new wallets immediately**
2. **Transfer any funds to new wallets**
3. **Update all services with new addresses**
4. **Revoke access from old keys where possible**
5. **Monitor old addresses for unauthorized activity**

## Using the Secure Config Helper

The application now includes a secure configuration helper at `utils/secureConfig.js`:

```javascript
const { getPrivateKey, getRevenuePrivateKey, validateSecurityConfig } = require('./utils/secureConfig');

// Automatically uses test accounts in development, requires env vars in production
const privateKey = getPrivateKey();
const revenuePrivateKey = getRevenuePrivateKey();

// Validate configuration (throws error if test keys used in production)
validateSecurityConfig();
```

## Additional Security Resources

- [Ethereum Security Best Practices](https://consensys.github.io/smart-contract-best-practices/)
- [Web3 Security Considerations](https://ethereum.org/en/developers/docs/security/)
- [OWASP Cryptographic Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html)