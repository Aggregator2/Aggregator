import { KeyManagementOrchestrator, KeyManagementConfig } from './KeyManagementOrchestrator';
import { RotationHooks } from './rotation/KeyRotationService';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function main() {
  console.log('🔐 Secure Key Management System Example\n');

  // Configuration
  const config: KeyManagementConfig = {
    // HSM Configuration (for settlement keys)
    hsm: {
      library: process.env.HSM_LIBRARY || '/usr/lib/softhsm/libsofthsm2.so',
      slot: 0,
      pin: process.env.HSM_PIN || '1234',
      keyLabel: 'trading-system',
      mechanism: {
        sign: 0x00000001, // CKM_RSA_PKCS
        verify: 0x00000001,
        encrypt: 0x00000009, // CKM_RSA_PKCS_OAEP
        decrypt: 0x00000009
      },
      retry: {
        attempts: 3,
        delay: 1000
      }
    },

    // AWS KMS Configuration (for API keys)
    kms: {
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: process.env.AWS_ACCESS_KEY_ID ? {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!
      } : undefined,
      defaultKeySpec: 'RSA_2048',
      defaultKeyUsage: 'SIGN_VERIFY',
      multiRegion: true
    },

    // HashiCorp Vault Configuration (for database credentials)
    vault: {
      address: process.env.VAULT_ADDR || 'http://localhost:8200',
      token: process.env.VAULT_TOKEN,
      mount: {
        kv: 'secret',
        transit: 'transit',
        database: 'database',
        pki: 'pki'
      },
      retry: {
        attempts: 3,
        delay: 1000
      }
    },

    // Secure Enclave Configuration
    enclave: {
      attestationRequired: true,
      maxWorkers: 4,
      memoryLimit: 512, // MB
      cpuLimit: 50, // percentage
      allowedOperations: new Set(['sign', 'verify', 'encrypt', 'decrypt', 'derive']),
      isolationLevel: 'process',
      keyDerivationFunction: 'argon2',
      auditLog: true,
      secureMemory: true
    },

    // Key Rotation Configuration
    rotation: {
      enabled: true,
      policies: [
        {
          id: 'settlement-keys',
          name: 'Settlement Key Rotation',
          provider: 'hsm',
          keyPattern: /^SETTLEMENT_/,
          schedule: '0 0 * * 0', // Weekly on Sunday at midnight
          maxAge: 30, // 30 days
          notificationChannels: [
            {
              type: 'webhook',
              config: {
                url: 'https://api.example.com/webhooks/key-rotation',
                headers: { 'Authorization': 'Bearer secret' }
              }
            }
          ],
          preRotationHooks: [
            RotationHooks.backupKey('/secure/backups/keys'),
            RotationHooks.validateKey()
          ],
          postRotationHooks: [
            RotationHooks.updateConfig('/app/config/keys.json'),
            RotationHooks.distributeKey(['api-server', 'settlement-service'])
          ],
          enabled: true
        },
        {
          id: 'api-keys',
          name: 'API Key Rotation',
          provider: 'kms',
          keyPattern: /^API_KEY_/,
          schedule: '0 0 1 * *', // Monthly on the 1st
          maxAge: 90, // 90 days
          notificationChannels: [
            {
              type: 'email',
              config: {
                to: ['security@example.com'],
                subject: 'API Key Rotation Notification'
              }
            }
          ],
          enabled: true
        },
        {
          id: 'database-creds',
          name: 'Database Credential Rotation',
          provider: 'vault',
          keyIds: ['postgres-admin', 'postgres-app'],
          schedule: '0 0 */7 * *', // Every 7 days
          notificationChannels: [],
          enabled: true
        }
      ]
    },

    // Audit Configuration
    audit: {
      enabled: true,
      storage: 'database',
      retention: 365, // 1 year
      encryption: true
    },

    // Key Hierarchy Configuration
    keyHierarchy: {
      masterKeyProvider: 'hsm',
      keyDerivationPath: 'm/44\'/60\'/0\'/0'
    }
  };

  // Initialize the orchestrator
  const keyManager = new KeyManagementOrchestrator(config);
  
  try {
    await keyManager.initialize();
    console.log('\n✅ Key Management System initialized successfully!\n');

    // Example 1: Create a new settlement signing key in HSM
    console.log('📝 Example 1: Creating settlement signing key...');
    const settlementKey = await keyManager.createKey({
      type: 'signing',
      purpose: 'SETTLEMENT_SIGNATURES',
      provider: 'hsm',
      algorithm: 'ECDSA',
      rotationSchedule: '0 0 * * 0' // Weekly
    });
    console.log(`✅ Created settlement key: ${settlementKey.id}\n`);

    // Example 2: Sign a settlement transaction
    console.log('📝 Example 2: Signing settlement transaction...');
    const settlementData = Buffer.from(JSON.stringify({
      orderId: '12345',
      amount: '1000.00',
      currency: 'USD',
      timestamp: Date.now()
    }));
    
    const signature = await keyManager.sign(settlementData, settlementKey.id, 'SHA256');
    console.log(`✅ Signature: ${signature.toString('hex').substring(0, 64)}...\n`);

    // Example 3: Create and encrypt API key
    console.log('📝 Example 3: Generating encrypted API key...');
    const apiKeyData = await keyManager.generateAPIKey({
      service: 'trading-api',
      permissions: ['read:orders', 'write:orders', 'read:balances'],
      expiry: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) // 90 days
    });
    console.log(`✅ API Key ID: ${apiKeyData.keyId}`);
    console.log(`✅ API Key: ${apiKeyData.apiKey.substring(0, 20)}...`);
    console.log(`✅ Secret: ${apiKeyData.secret.substring(0, 20)}...\n`);

    // Example 4: Get database credentials from Vault
    console.log('📝 Example 4: Retrieving database credentials...');
    const dbCreds = await keyManager.getDatabaseCredentials('postgres', 'app-role');
    console.log(`✅ Database Username: ${dbCreds.username}`);
    console.log(`✅ Password: ${dbCreds.password.substring(0, 10)}...`);
    console.log(`✅ TTL: ${dbCreds.ttl} seconds\n`);

    // Example 5: Encrypt sensitive data using KMS
    console.log('📝 Example 5: Encrypting sensitive data...');
    const sensitiveData = Buffer.from('This is highly sensitive trading data');
    
    const encryptionKey = await keyManager.createKey({
      type: 'encryption',
      purpose: 'DATA_ENCRYPTION',
      provider: 'kms'
    });
    
    const encrypted = await keyManager.encrypt(sensitiveData, encryptionKey.id, {
      context: 'trading-data',
      version: '1.0'
    });
    console.log(`✅ Encrypted data: ${encrypted.ciphertext.toString('base64').substring(0, 50)}...`);
    console.log(`✅ Encryption metadata:`, encrypted.metadata, '\n');

    // Example 6: Verify API key
    console.log('📝 Example 6: Validating API key...');
    const validation = await keyManager.validateAPIKey(apiKeyData.apiKey, apiKeyData.secret);
    console.log(`✅ API Key Valid: ${validation.valid}`);
    console.log(`✅ Permissions: ${validation.permissions?.join(', ')}\n`);

    // Example 7: Manual key rotation
    console.log('📝 Example 7: Manually rotating a key...');
    const rotationService = keyManager['rotationService'];
    if (rotationService) {
      const newKeyId = await rotationService.rotateKeyNow('hsm', settlementKey.id);
      console.log(`✅ Rotated key ${settlementKey.id} -> ${newKeyId}\n`);
    }

    // Example 8: View system statistics
    console.log('📊 System Statistics:');
    const stats = keyManager.getStats();
    console.log(`  - Providers: ${stats.providers.join(', ')}`);
    console.log(`  - Total Keys: ${stats.totalKeys}`);
    console.log(`  - Keys by Type: ${JSON.stringify(stats.keysByType)}`);
    console.log(`  - Keys by Provider: ${JSON.stringify(stats.keysByProvider)}`);
    console.log(`  - Operation Success Rate: ${stats.operationSuccessRate.toFixed(2)}%\n`);

    // Example 9: Query audit logs
    console.log('📝 Example 9: Querying audit logs...');
    const auditLogger = keyManager['auditLogger'];
    if (auditLogger) {
      const recentLogs = await auditLogger.query({
        startTime: new Date(Date.now() - 60 * 60 * 1000), // Last hour
        action: ['key_created', 'data_encrypted', 'data_signed'],
        limit: 10
      });
      console.log(`✅ Found ${recentLogs.length} audit entries\n`);
    }

    // Example 10: Secure enclave operation
    console.log('📝 Example 10: Using secure enclave...');
    const enclave = keyManager['enclave'];
    if (enclave) {
      const enclaveData = Buffer.from('Highly sensitive operation data');
      const enclaveResult = await enclave.sign(enclaveData, 'enclave-key-1');
      console.log(`✅ Enclave signature: ${enclaveResult.toString('hex').substring(0, 64)}...`);
      console.log(`✅ Enclave stats:`, enclave.getStats(), '\n');
    }

    // Graceful shutdown
    console.log('🛑 Shutting down Key Management System...');
    await keyManager.close();
    console.log('✅ Shutdown complete');

  } catch (error) {
    console.error('❌ Error:', error);
    await keyManager.close();
    process.exit(1);
  }
}

// Error handling
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

// Run the example
main().catch(console.error);