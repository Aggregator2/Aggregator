import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { createLogger } from '../../utils/production-logger';
import { getPrismaClient } from '../../config/database.config';
import {
  ApiKey,
  ApiKeyType,
  ApiKeyScope,
  ApiKeyPermission,
  ApiKeyWithSecret,
  CreateApiKeyInput,
  UpdateApiKeyInput,
  ApiKeyValidationResult,
  ApiKeyUsageStats,
  SCOPE_PERMISSIONS
} from '../../types/apiKey';

const logger = createLogger('ApiKeyService');
const prisma = getPrismaClient();

export class ApiKeyService {
  private static instance: ApiKeyService;
  private readonly SALT_ROUNDS = 10;
  private readonly KEY_LENGTH = 32; // 256 bits
  private readonly SECRET_LENGTH = 64; // 512 bits
  
  private constructor() {}
  
  static getInstance(): ApiKeyService {
    if (!ApiKeyService.instance) {
      ApiKeyService.instance = new ApiKeyService();
    }
    return ApiKeyService.instance;
  }
  
  /**
   * Generate a new API key
   */
  async createApiKey(input: CreateApiKeyInput): Promise<ApiKeyWithSecret> {
    const timer = logger.startTimer('create_api_key');
    
    try {
      // Generate the API key and secret
      const keyType = input.type || ApiKeyType.TEST;
      const prefix = keyType === ApiKeyType.LIVE ? 'ocp_live_' : 'ocp_test_';
      const rawKey = this.generateSecureToken(this.KEY_LENGTH);
      const apiKey = `${prefix}${rawKey}`;
      const secretKey = this.generateSecureToken(this.SECRET_LENGTH);
      
      // Hash the keys
      const hashedKey = await bcrypt.hash(apiKey, this.SALT_ROUNDS);
      const hashedSecretKey = await bcrypt.hash(secretKey, this.SALT_ROUNDS);
      
      // Get last 4 characters for identification
      const lastFourChars = rawKey.slice(-4);
      
      // Determine permissions based on scope
      let permissions = input.permissions;
      if (!permissions && input.scope) {
        permissions = SCOPE_PERMISSIONS[input.scope];
      } else if (!permissions) {
        permissions = SCOPE_PERMISSIONS[ApiKeyScope.READ_ONLY];
      }
      
      // Create the API key record
      const apiKeyRecord = await prisma.ApiKey.create({
        data: {
          hashedKey,
          userId: input.userId,
          name: input.name,
          type: keyType,
          scope: input.scope || ApiKeyScope.READ_ONLY,
          permissions: permissions as any,
          prefix,
          lastFourChars,
          hashedSecretKey,
          ipWhitelist: input.ipWhitelist || [],
          allowedOrigins: input.allowedOrigins,
          rateLimit: input.rateLimit || 1000,
          expiresAt: input.expiresAt,
          description: input.description,
          metadata: input.metadata
        }
      });
      
      timer();
      logger.info('API key created', {
        userId: input.userId,
        keyId: apiKeyRecord.id,
        type: keyType,
        scope: input.scope
      });
      
      // Return the full key (only shown once)
      return {
        ...this.mapToApiKey(apiKeyRecord),
        key: apiKey,
        secretKey
      };
      
    } catch (error) {
      timer();
      logger.error('Failed to create API key', error, input);
      throw error;
    }
  }
  
  /**
   * Validate an API key
   */
  async validateApiKey(
    apiKey: string,
    ipAddress?: string,
    requiredPermissions?: ApiKeyPermission[]
  ): Promise<ApiKeyValidationResult> {
    try {
      // Extract prefix to optimize query
      const prefix = apiKey.substring(0, 9); // 'ocp_test_' or 'ocp_live_'
      
      // Find potential matches by prefix and last 4 chars
      const lastFourChars = apiKey.slice(-4);
      const potentialKeys = await prisma.ApiKey.findMany({
        where: {
          prefix,
          lastFourChars,
          revokedAt: null
        }
      });
      
      // Find the matching key
      let matchingKey = null;
      for (const key of potentialKeys) {
        const isMatch = await bcrypt.compare(apiKey, key.hashedKey);
        if (isMatch) {
          matchingKey = key;
          break;
        }
      }
      
      if (!matchingKey) {
        return {
          valid: false,
          error: 'Invalid API key',
          errorCode: 'INVALID_KEY'
        };
      }
      
      // Check if expired
      if (matchingKey.expiresAt && new Date() > matchingKey.expiresAt) {
        return {
          valid: false,
          error: 'API key has expired',
          errorCode: 'EXPIRED'
        };
      }
      
      // Check if revoked
      if (matchingKey.revokedAt) {
        return {
          valid: false,
          error: 'API key has been revoked',
          errorCode: 'REVOKED'
        };
      }
      
      // Check IP whitelist
      if (ipAddress && matchingKey.ipWhitelist && Array.isArray(matchingKey.ipWhitelist)) {
        const ipWhitelist = matchingKey.ipWhitelist as string[];
        if (ipWhitelist.length > 0 && !ipWhitelist.includes(ipAddress)) {
          return {
            valid: false,
            error: 'IP address not whitelisted',
            errorCode: 'IP_BLOCKED'
          };
        }
      }
      
      // Check permissions
      if (requiredPermissions && requiredPermissions.length > 0) {
        const keyPermissions = matchingKey.permissions as ApiKeyPermission[];
        const hasAllPermissions = requiredPermissions.every(
          perm => keyPermissions.includes(perm)
        );
        
        if (!hasAllPermissions) {
          return {
            valid: false,
            error: 'Insufficient permissions',
            errorCode: 'INSUFFICIENT_PERMISSIONS'
          };
        }
      }
      
      // Check rate limit
      const rateLimitInfo = await this.checkRateLimit(matchingKey.id, matchingKey.rateLimit);
      if (!rateLimitInfo.allowed) {
        return {
          valid: false,
          error: 'Rate limit exceeded',
          errorCode: 'RATE_LIMITED',
          rateLimitRemaining: 0,
          rateLimitResetAt: rateLimitInfo.resetAt
        };
      }
      
      // Update last used timestamp
      await prisma.ApiKey.update({
        where: { id: matchingKey.id },
        data: {
          lastUsedAt: new Date(),
          totalRequests: { increment: 1 }
        }
      });
      
      return {
        valid: true,
        apiKey: this.mapToApiKey(matchingKey),
        rateLimitRemaining: rateLimitInfo.remaining,
        rateLimitResetAt: rateLimitInfo.resetAt
      };
      
    } catch (error) {
      logger.error('API key validation error', error);
      return {
        valid: false,
        error: 'Internal error during validation',
        errorCode: 'INVALID_KEY'
      };
    }
  }
  
  /**
   * Get API key by ID
   */
  async getApiKey(keyId: string, userId: string): Promise<ApiKey | null> {
    const apiKey = await prisma.ApiKey.findFirst({
      where: {
        id: keyId,
        userId,
        revokedAt: null
      }
    });
    
    return apiKey ? this.mapToApiKey(apiKey) : null;
  }
  
  /**
   * List user's API keys
   */
  async listApiKeys(userId: string): Promise<ApiKey[]> {
    const keys = await prisma.ApiKey.findMany({
      where: {
        userId,
        revokedAt: null
      },
      orderBy: { createdAt: 'desc' }
    });
    
    return keys.map(key => this.mapToApiKey(key));
  }
  
  /**
   * Update API key
   */
  async updateApiKey(
    keyId: string,
    userId: string,
    input: UpdateApiKeyInput
  ): Promise<ApiKey> {
    const apiKey = await prisma.ApiKey.update({
      where: {
        id: keyId,
        userId // Ensure user owns the key
      },
      data: {
        ...(input.name && { name: input.name }),
        ...(input.permissions && { permissions: input.permissions as any }),
        ...(input.ipWhitelist && { ipWhitelist: input.ipWhitelist }),
        ...(input.allowedOrigins && { allowedOrigins: input.allowedOrigins }),
        ...(input.rateLimit && { rateLimit: input.rateLimit }),
        ...(input.expiresAt !== undefined && { expiresAt: input.expiresAt }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.metadata && { metadata: input.metadata })
      }
    });
    
    logger.info('API key updated', { keyId, userId });
    
    return this.mapToApiKey(apiKey);
  }
  
  /**
   * Revoke API key
   */
  async revokeApiKey(keyId: string, userId: string): Promise<void> {
    await prisma.ApiKey.update({
      where: {
        id: keyId,
        userId // Ensure user owns the key
      },
      data: {
        revokedAt: new Date()
      }
    });
    
    logger.info('API key revoked', { keyId, userId });
  }
  
  /**
   * Rotate API key (revoke old, create new)
   */
  async rotateApiKey(keyId: string, userId: string): Promise<ApiKeyWithSecret> {
    // Get existing key
    const existingKey = await this.getApiKey(keyId, userId);
    if (!existingKey) {
      throw new Error('API key not found');
    }
    
    // Revoke the old key
    await this.revokeApiKey(keyId, userId);
    
    // Create new key with same settings
    return this.createApiKey({
      userId,
      name: `${existingKey.name} (Rotated)`,
      type: existingKey.type as ApiKeyType,
      scope: existingKey.scope as ApiKeyScope,
      permissions: existingKey.permissions,
      ipWhitelist: existingKey.ipWhitelist,
      allowedOrigins: existingKey.allowedOrigins,
      rateLimit: existingKey.rateLimit,
      description: existingKey.description,
      metadata: existingKey.metadata
    });
  }
  
  /**
   * Get API key usage statistics
   */
  async getApiKeyStats(
    keyId: string,
    userId: string,
    period: 'hour' | 'day' | 'week' | 'month'
  ): Promise<ApiKeyUsageStats[]> {
    const stats = await prisma.ApiKeyUsageStats.findMany({
      where: {
        apiKeyId: keyId,
        period,
        apiKey: {
          userId // Ensure user owns the key
        }
      },
      orderBy: { periodStart: 'desc' },
      take: 30 // Last 30 periods
    });
    
    return stats.map(stat => ({
      apiKeyId: stat.apiKeyId,
      period: stat.period as any,
      totalRequests: stat.totalRequests,
      successfulRequests: stat.successfulRequests,
      failedRequests: stat.failedRequests,
      averageResponseTime: stat.avgResponseTime,
      bandwidthUsed: Number(stat.bandwidthUsed),
      endpointUsage: stat.endpointUsage as any,
      statusCodes: stat.statusCodes as any,
      rateLimitExceeded: stat.rateLimitExceeded,
      timestamp: stat.periodStart
    }));
  }
  
  /**
   * Check rate limit for API key
   */
  private async checkRateLimit(
    apiKeyId: string,
    limit: number
  ): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
    const now = new Date();
    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    
    // Count requests in the last hour
    const recentStats = await prisma.ApiKeyUsageStats.findFirst({
      where: {
        apiKeyId,
        period: 'hour',
        periodStart: { gte: hourAgo }
      }
    });
    
    const used = recentStats?.totalRequests || 0;
    const remaining = Math.max(0, limit - used);
    const resetAt = new Date(hourAgo.getTime() + 60 * 60 * 1000);
    
    return {
      allowed: remaining > 0,
      remaining,
      resetAt
    };
  }
  
  /**
   * Generate secure random token
   */
  private generateSecureToken(length: number): string {
    return crypto.randomBytes(length).toString('base64url');
  }
  
  /**
   * Map database record to ApiKey type
   */
  private mapToApiKey(record: any): ApiKey {
    return {
      id: record.id,
      hashedKey: record.hashedKey,
      userId: record.userId,
      name: record.name,
      type: record.type as ApiKeyType,
      scope: record.scope as ApiKeyScope,
      permissions: record.permissions as ApiKeyPermission[],
      prefix: record.prefix,
      lastFourChars: record.lastFourChars,
      hashedSecretKey: record.hashedSecretKey,
      ipWhitelist: record.ipWhitelist || [],
      allowedOrigins: record.allowedOrigins,
      rateLimit: record.rateLimit,
      lastUsedAt: record.lastUsedAt,
      totalRequests: record.totalRequests,
      description: record.description,
      metadata: record.metadata,
      expiresAt: record.expiresAt,
      revokedAt: record.revokedAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    };
  }
  
  /**
   * Track API usage
   */
  async trackUsage(
    apiKeyId: string,
    endpoint: string,
    statusCode: number,
    responseTime: number,
    bandwidthUsed: number
  ): Promise<void> {
    const now = new Date();
    const hourStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours());
    
    // Update or create hourly stats
    await prisma.ApiKeyUsageStats.upsert({
      where: {
        apiKeyId_period_periodStart: {
          apiKeyId,
          period: 'hour',
          periodStart: hourStart
        }
      },
      update: {
        totalRequests: { increment: 1 },
        successfulRequests: statusCode >= 200 && statusCode < 300 ? { increment: 1 } : undefined,
        failedRequests: statusCode >= 400 ? { increment: 1 } : undefined,
        bandwidthUsed: { increment: bandwidthUsed },
        rateLimitExceeded: statusCode === 429 ? { increment: 1 } : undefined
      },
      create: {
        apiKeyId,
        period: 'hour',
        periodStart: hourStart,
        periodEnd: new Date(hourStart.getTime() + 60 * 60 * 1000),
        totalRequests: 1,
        successfulRequests: statusCode >= 200 && statusCode < 300 ? 1 : 0,
        failedRequests: statusCode >= 400 ? 1 : 0,
        avgResponseTime: responseTime,
        maxResponseTime: responseTime,
        minResponseTime: responseTime,
        bandwidthUsed,
        endpointUsage: { [endpoint]: { requests: 1, avgResponseTime: responseTime, errors: statusCode >= 400 ? 1 : 0 } },
        statusCodes: { [statusCode]: 1 },
        errorTypes: {},
        rateLimitExceeded: statusCode === 429 ? 1 : 0
      }
    });
  }
}