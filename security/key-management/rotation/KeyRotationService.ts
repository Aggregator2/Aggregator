import { EventEmitter } from 'events';
import { CronJob } from 'cron';
import { HSMProvider } from '../hsm/HSMProvider';
import { AWSKMSProvider } from '../kms/AWSKMSProvider';
import { VaultProvider } from '../vault/VaultProvider';
import * as crypto from 'crypto';

export interface RotationPolicy {
  id: string;
  name: string;
  provider: 'hsm' | 'kms' | 'vault';
  keyPattern?: RegExp;
  keyIds?: string[];
  schedule: string; // Cron expression
  maxAge?: number; // Maximum key age in days
  algorithm?: string;
  notificationChannels: NotificationChannel[];
  preRotationHooks?: Hook[];
  postRotationHooks?: Hook[];
  enabled: boolean;
}

export interface NotificationChannel {
  type: 'email' | 'slack' | 'webhook';
  config: any;
}

export interface Hook {
  name: string;
  type: 'validation' | 'backup' | 'update' | 'custom';
  handler: (context: RotationContext) => Promise<void>;
}

export interface RotationContext {
  policy: RotationPolicy;
  oldKeyId: string;
  newKeyId?: string;
  provider: string;
  timestamp: Date;
  metadata?: any;
}

export interface RotationResult {
  policyId: string;
  oldKeyId: string;
  newKeyId: string;
  provider: string;
  timestamp: Date;
  duration: number;
  status: 'success' | 'failed';
  error?: string;
}

export interface RotationHistory {
  results: RotationResult[];
  lastRotation?: Date;
  nextRotation?: Date;
}

export class KeyRotationService extends EventEmitter {
  private policies: Map<string, RotationPolicy> = new Map();
  private jobs: Map<string, CronJob> = new Map();
  private history: Map<string, RotationHistory> = new Map();
  private providers: {
    hsm?: HSMProvider;
    kms?: AWSKMSProvider;
    vault?: VaultProvider;
  } = {};
  private rotationInProgress: Set<string> = new Set();

  constructor() {
    super();
  }

  async initialize(providers: {
    hsm?: HSMProvider;
    kms?: AWSKMSProvider;
    vault?: VaultProvider;
  }): Promise<void> {
    console.log('🔄 Initializing Key Rotation Service...');

    this.providers = providers;

    // Validate at least one provider is available
    if (!providers.hsm && !providers.kms && !providers.vault) {
      throw new Error('At least one key provider must be configured');
    }

    console.log('✅ Key Rotation Service initialized');
    this.emit('initialized');
  }

  addPolicy(policy: RotationPolicy): void {
    // Validate policy
    this.validatePolicy(policy);

    // Store policy
    this.policies.set(policy.id, policy);

    // Initialize history
    if (!this.history.has(policy.id)) {
      this.history.set(policy.id, { results: [] });
    }

    // Schedule rotation job if enabled
    if (policy.enabled) {
      this.scheduleRotation(policy);
    }

    console.log(`✅ Added rotation policy: ${policy.name}`);
    this.emit('policy-added', policy);
  }

  removePolicy(policyId: string): void {
    const policy = this.policies.get(policyId);
    if (!policy) {
      throw new Error(`Policy not found: ${policyId}`);
    }

    // Stop scheduled job
    const job = this.jobs.get(policyId);
    if (job) {
      job.stop();
      this.jobs.delete(policyId);
    }

    // Remove policy
    this.policies.delete(policyId);

    console.log(`✅ Removed rotation policy: ${policy.name}`);
    this.emit('policy-removed', policy);
  }

  enablePolicy(policyId: string): void {
    const policy = this.policies.get(policyId);
    if (!policy) {
      throw new Error(`Policy not found: ${policyId}`);
    }

    policy.enabled = true;
    this.scheduleRotation(policy);

    console.log(`✅ Enabled rotation policy: ${policy.name}`);
  }

  disablePolicy(policyId: string): void {
    const policy = this.policies.get(policyId);
    if (!policy) {
      throw new Error(`Policy not found: ${policyId}`);
    }

    policy.enabled = false;

    // Stop scheduled job
    const job = this.jobs.get(policyId);
    if (job) {
      job.stop();
      this.jobs.delete(policyId);
    }

    console.log(`✅ Disabled rotation policy: ${policy.name}`);
  }

  private validatePolicy(policy: RotationPolicy): void {
    // Validate provider exists
    if (!this.providers[policy.provider]) {
      throw new Error(`Provider not configured: ${policy.provider}`);
    }

    // Validate either keyPattern or keyIds is provided
    if (!policy.keyPattern && (!policy.keyIds || policy.keyIds.length === 0)) {
      throw new Error('Either keyPattern or keyIds must be specified');
    }

    // Validate cron expression
    try {
      new CronJob(policy.schedule, () => {});
    } catch (error) {
      throw new Error(`Invalid cron expression: ${policy.schedule}`);
    }
  }

  private scheduleRotation(policy: RotationPolicy): void {
    // Remove existing job if any
    const existingJob = this.jobs.get(policy.id);
    if (existingJob) {
      existingJob.stop();
    }

    // Create new cron job
    const job = new CronJob(policy.schedule, async () => {
      await this.executeRotation(policy);
    });

    job.start();
    this.jobs.set(policy.id, job);

    // Calculate next rotation time
    const nextRotation = job.nextDates(1)[0];
    const history = this.history.get(policy.id)!;
    history.nextRotation = nextRotation.toDate();

    console.log(`⏰ Scheduled rotation for policy ${policy.name}: ${nextRotation}`);
  }

  async executeRotation(policy: RotationPolicy): Promise<void> {
    console.log(`🔄 Executing rotation for policy: ${policy.name}`);

    // Check if rotation is already in progress
    if (this.rotationInProgress.has(policy.id)) {
      console.warn(`⚠️ Rotation already in progress for policy: ${policy.name}`);
      return;
    }

    this.rotationInProgress.add(policy.id);
    const startTime = Date.now();

    try {
      // Get keys to rotate
      const keysToRotate = await this.getKeysToRotate(policy);

      if (keysToRotate.length === 0) {
        console.log(`ℹ️ No keys to rotate for policy: ${policy.name}`);
        return;
      }

      console.log(`📋 Found ${keysToRotate.length} keys to rotate`);

      // Rotate each key
      for (const keyId of keysToRotate) {
        await this.rotateKey(policy, keyId);
      }

      // Update history
      const history = this.history.get(policy.id)!;
      history.lastRotation = new Date();

      this.emit('rotation-completed', {
        policyId: policy.id,
        keysRotated: keysToRotate.length,
        duration: Date.now() - startTime
      });

    } catch (error) {
      console.error(`❌ Rotation failed for policy ${policy.name}:`, error);
      this.emit('rotation-failed', {
        policyId: policy.id,
        error: error.message
      });
    } finally {
      this.rotationInProgress.delete(policy.id);
    }
  }

  private async getKeysToRotate(policy: RotationPolicy): Promise<string[]> {
    const provider = this.providers[policy.provider];
    if (!provider) {
      throw new Error(`Provider not available: ${policy.provider}`);
    }

    let allKeys: any[] = [];
    const keysToRotate: string[] = [];

    // Get all keys from provider
    switch (policy.provider) {
      case 'hsm':
        allKeys = (provider as HSMProvider).getKeys();
        break;
      case 'kms':
        allKeys = (provider as AWSKMSProvider).getKeys();
        break;
      case 'vault':
        // Vault doesn't have a getKeys method, use specified keyIds
        if (policy.keyIds) {
          return policy.keyIds;
        }
        break;
    }

    // Filter keys based on policy
    for (const key of allKeys) {
      const keyId = key.id || key.keyId;
      const keyLabel = key.label || key.alias || keyId;

      // Check if key matches pattern
      if (policy.keyPattern && !policy.keyPattern.test(keyLabel)) {
        continue;
      }

      // Check if key is in specified list
      if (policy.keyIds && !policy.keyIds.includes(keyId)) {
        continue;
      }

      // Check key age if maxAge is specified
      if (policy.maxAge) {
        const keyAge = Date.now() - (key.created || key.creationDate).getTime();
        const maxAgeMs = policy.maxAge * 24 * 60 * 60 * 1000;

        if (keyAge < maxAgeMs) {
          continue;
        }
      }

      keysToRotate.push(keyId);
    }

    return keysToRotate;
  }

  private async rotateKey(policy: RotationPolicy, keyId: string): Promise<void> {
    const context: RotationContext = {
      policy,
      oldKeyId: keyId,
      provider: policy.provider,
      timestamp: new Date()
    };

    const result: RotationResult = {
      policyId: policy.id,
      oldKeyId: keyId,
      newKeyId: '',
      provider: policy.provider,
      timestamp: new Date(),
      duration: 0,
      status: 'failed'
    };

    const startTime = Date.now();

    try {
      // Execute pre-rotation hooks
      if (policy.preRotationHooks) {
        for (const hook of policy.preRotationHooks) {
          await this.executeHook(hook, context);
        }
      }

      // Perform rotation based on provider
      let newKeyId: string;

      switch (policy.provider) {
        case 'hsm':
          const hsmProvider = this.providers.hsm!;
          const newHsmKey = await hsmProvider.rotateKey(keyId);
          newKeyId = newHsmKey.id;
          break;

        case 'kms':
          const kmsProvider = this.providers.kms!;
          const newKmsKey = await kmsProvider.rotateKey(keyId);
          newKeyId = newKmsKey.keyId;
          break;

        case 'vault':
          const vaultProvider = this.providers.vault!;
          await vaultProvider.rotateTransitKey(keyId);
          newKeyId = keyId; // Vault rotates in-place
          break;

        default:
          throw new Error(`Unsupported provider: ${policy.provider}`);
      }

      context.newKeyId = newKeyId;
      result.newKeyId = newKeyId;
      result.status = 'success';

      // Execute post-rotation hooks
      if (policy.postRotationHooks) {
        for (const hook of policy.postRotationHooks) {
          await this.executeHook(hook, context);
        }
      }

      // Send notifications
      await this.sendNotifications(policy, context, 'success');

      console.log(`✅ Rotated key ${keyId} -> ${newKeyId}`);

    } catch (error) {
      result.error = error.message;
      
      // Send failure notifications
      await this.sendNotifications(policy, context, 'failure', error.message);

      throw error;

    } finally {
      result.duration = Date.now() - startTime;

      // Record in history
      const history = this.history.get(policy.id)!;
      history.results.push(result);

      // Keep only last 100 results
      if (history.results.length > 100) {
        history.results = history.results.slice(-100);
      }

      this.emit('key-rotated', result);
    }
  }

  private async executeHook(hook: Hook, context: RotationContext): Promise<void> {
    console.log(`🪝 Executing hook: ${hook.name}`);

    try {
      await hook.handler(context);
      console.log(`✅ Hook completed: ${hook.name}`);
    } catch (error) {
      console.error(`❌ Hook failed: ${hook.name}`, error);
      throw new Error(`Hook ${hook.name} failed: ${error.message}`);
    }
  }

  private async sendNotifications(
    policy: RotationPolicy,
    context: RotationContext,
    status: 'success' | 'failure',
    error?: string
  ): Promise<void> {
    for (const channel of policy.notificationChannels) {
      try {
        await this.sendNotification(channel, {
          policy: policy.name,
          status,
          oldKeyId: context.oldKeyId,
          newKeyId: context.newKeyId,
          timestamp: context.timestamp,
          error
        });
      } catch (err) {
        console.error(`Failed to send notification via ${channel.type}:`, err);
      }
    }
  }

  private async sendNotification(channel: NotificationChannel, data: any): Promise<void> {
    switch (channel.type) {
      case 'webhook':
        await fetch(channel.config.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...channel.config.headers
          },
          body: JSON.stringify(data)
        });
        break;

      case 'email':
        // Would integrate with email service
        console.log(`📧 Email notification: ${JSON.stringify(data)}`);
        break;

      case 'slack':
        // Would integrate with Slack API
        console.log(`💬 Slack notification: ${JSON.stringify(data)}`);
        break;
    }
  }

  // Manual rotation
  async rotateNow(policyId: string): Promise<void> {
    const policy = this.policies.get(policyId);
    if (!policy) {
      throw new Error(`Policy not found: ${policyId}`);
    }

    await this.executeRotation(policy);
  }

  async rotateKeyNow(provider: 'hsm' | 'kms' | 'vault', keyId: string): Promise<string> {
    const providerInstance = this.providers[provider];
    if (!providerInstance) {
      throw new Error(`Provider not configured: ${provider}`);
    }

    console.log(`🔄 Manually rotating key: ${keyId}`);

    switch (provider) {
      case 'hsm':
        const newHsmKey = await (providerInstance as HSMProvider).rotateKey(keyId);
        return newHsmKey.id;

      case 'kms':
        const newKmsKey = await (providerInstance as AWSKMSProvider).rotateKey(keyId);
        return newKmsKey.keyId;

      case 'vault':
        await (providerInstance as VaultProvider).rotateTransitKey(keyId);
        return keyId; // Vault rotates in-place

      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }

  // History and monitoring
  getHistory(policyId?: string): RotationHistory | Map<string, RotationHistory> {
    if (policyId) {
      const history = this.history.get(policyId);
      if (!history) {
        throw new Error(`No history found for policy: ${policyId}`);
      }
      return history;
    }

    return new Map(this.history);
  }

  getNextRotations(): { policyId: string; policyName: string; nextRotation: Date }[] {
    const rotations: any[] = [];

    for (const [policyId, policy] of this.policies) {
      if (!policy.enabled) continue;

      const job = this.jobs.get(policyId);
      if (job) {
        const nextDate = job.nextDates(1)[0];
        rotations.push({
          policyId,
          policyName: policy.name,
          nextRotation: nextDate.toDate()
        });
      }
    }

    return rotations.sort((a, b) => a.nextRotation.getTime() - b.nextRotation.getTime());
  }

  getStats(): {
    totalPolicies: number;
    enabledPolicies: number;
    rotationsInProgress: number;
    totalRotations: number;
    failedRotations: number;
  } {
    let totalRotations = 0;
    let failedRotations = 0;

    for (const history of this.history.values()) {
      totalRotations += history.results.length;
      failedRotations += history.results.filter(r => r.status === 'failed').length;
    }

    return {
      totalPolicies: this.policies.size,
      enabledPolicies: Array.from(this.policies.values()).filter(p => p.enabled).length,
      rotationsInProgress: this.rotationInProgress.size,
      totalRotations,
      failedRotations
    };
  }

  // Cleanup
  stop(): void {
    // Stop all cron jobs
    for (const job of this.jobs.values()) {
      job.stop();
    }
    this.jobs.clear();

    console.log('🛑 Key Rotation Service stopped');
    this.emit('stopped');
  }
}

// Pre-built hooks
export const RotationHooks = {
  // Backup old key before rotation
  backupKey: (backupLocation: string): Hook => ({
    name: 'backup-key',
    type: 'backup',
    handler: async (context) => {
      console.log(`Backing up key ${context.oldKeyId} to ${backupLocation}`);
      // Implementation would backup key metadata
    }
  }),

  // Validate new key after rotation
  validateKey: (): Hook => ({
    name: 'validate-key',
    type: 'validation',
    handler: async (context) => {
      if (!context.newKeyId) {
        throw new Error('New key ID not found');
      }
      console.log(`Validating new key ${context.newKeyId}`);
      // Implementation would test key operations
    }
  }),

  // Update application configuration
  updateConfig: (configPath: string): Hook => ({
    name: 'update-config',
    type: 'update',
    handler: async (context) => {
      console.log(`Updating config at ${configPath} with new key ${context.newKeyId}`);
      // Implementation would update configuration files
    }
  }),

  // Distribute new key to services
  distributeKey: (services: string[]): Hook => ({
    name: 'distribute-key',
    type: 'update',
    handler: async (context) => {
      console.log(`Distributing new key ${context.newKeyId} to services: ${services.join(', ')}`);
      // Implementation would push key updates to services
    }
  })
};