
import { PrismaClient } from '@prisma/client';
import { randomBytes, createHash } from 'crypto';

const prisma = new PrismaClient();

export enum ApiKeyType {
  TEST = 'test',
  LIVE = 'live',
}

export enum ApiKeyPermission {
  ORDERS_READ = 'orders:read',
  ORDERS_WRITE = 'orders:write',
  SETTLEMENTS_READ = 'settlements:read',
  WEBHOOKS_MANAGE = 'webhooks:manage',
  FULL_ACCESS = 'full_access',
  READ_ONLY = 'read_only',
  TRADING = 'trading',
  REPORTING = 'reporting',
}

export interface ApiKeyCreateOptions {
  name: string;
  userId: string;
  type?: ApiKeyType;
  permissions?: ApiKeyPermission[];
  rateLimit?: number;
  ipWhitelist?: string[];
  expiresAt?: Date;
}

export class ApiKeyService {
  private static readonly KEY_PREFIX = 'ocp';
  private static readonly SECRET_LENGTH = 32;

  public static async createApiKey(options: ApiKeyCreateOptions) {
    const {
      name,
      userId,
      type = ApiKeyType.LIVE,
      permissions = [ApiKeyPermission.FULL_ACCESS],
      rateLimit = 1000,
      ipWhitelist = [],
      expiresAt,
    } = options;

    const apiKey = `${this.KEY_PREFIX}_${type}_${randomBytes(16).toString('hex')}`;
    const secretKey = randomBytes(this.SECRET_LENGTH).toString('hex');

    const hashedKey = this.hashKey(apiKey);
    const hashedSecret = this.hashKey(secretKey);

    const newKey = await prisma.ApiKey.create({
      data: {
        name,
        userId,
        hashedKey,
        permissions,
        rateLimit,
        ipWhitelist,
        expiresAt,
      },
    });

    return {
      apiKey,
      secretKey,
      keyDetails: newKey,
    };
  }

  public static async validateApiKey(apiKey: string): Promise<any | null> {
    const hashedKey = this.hashKey(apiKey);
    const key = await prisma.ApiKey.findUnique({
      where: { hashedKey },
    });

    if (!key) {
      return null;
    }

    if (key.expiresAt && key.expiresAt < new Date()) {
      return null;
    }

    await prisma.ApiKey.update({
      where: { id: key.id },
      data: { lastUsedAt: new Date() },
    });

    return key;
  }

  public static hasPermission(key: any, requiredPermission: ApiKeyPermission): boolean {
    if (key.permissions.includes(ApiKeyPermission.FULL_ACCESS)) {
      return true;
    }
    return key.permissions.includes(requiredPermission);
  }

  private static hashKey(key: string): string {
    return createHash('sha256').update(key).digest('hex');
  }
}
