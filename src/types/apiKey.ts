// API Key Management Types and Interfaces

export enum ApiKeyType {
  TEST = 'test',
  LIVE = 'live'
}

export enum ApiKeyScope {
  FULL_ACCESS = 'full_access',
  READ_ONLY = 'read_only',
  TRADING = 'trading',
  REPORTING = 'reporting'
}

export enum ApiKeyPermission {
  // Order permissions
  ORDERS_READ = 'orders:read',
  ORDERS_WRITE = 'orders:write',
  ORDERS_CANCEL = 'orders:cancel',
  
  // Settlement permissions
  SETTLEMENTS_READ = 'settlements:read',
  SETTLEMENTS_WRITE = 'settlements:write',
  SETTLEMENTS_APPROVE = 'settlements:approve',
  
  // Webhook permissions
  WEBHOOKS_READ = 'webhooks:read',
  WEBHOOKS_MANAGE = 'webhooks:manage',
  
  // Account permissions
  ACCOUNT_READ = 'account:read',
  ACCOUNT_WRITE = 'account:write',
  
  // Reporting permissions
  REPORTS_READ = 'reports:read',
  REPORTS_EXPORT = 'reports:export',
  
  // Admin permissions
  ADMIN_USERS = 'admin:users',
  ADMIN_SETTINGS = 'admin:settings'
}

export interface ApiKey {
  id: string;
  hashedKey: string;
  userId: string;
  name: string;
  type: ApiKeyType;
  scope: ApiKeyScope;
  permissions: ApiKeyPermission[];
  prefix: string; // 'ocp_test_' or 'ocp_live_'
  lastFourChars: string; // Last 4 chars for identification
  secretKey?: string; // For webhook signatures
  hashedSecretKey?: string;
  
  // Security settings
  ipWhitelist: string[];
  allowedOrigins?: string[];
  
  // Rate limiting
  rateLimit: number; // Requests per hour
  rateLimitRemaining?: number;
  rateLimitResetAt?: Date;
  
  // Usage tracking
  lastUsedAt?: Date;
  totalRequests: number;
  
  // Metadata
  description?: string;
  metadata?: Record<string, any>;
  
  // Lifecycle
  expiresAt?: Date;
  revokedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApiKeyWithSecret extends ApiKey {
  key: string; // The actual API key (only shown once)
  secretKey: string; // The actual secret key (only shown once)
}

export interface CreateApiKeyInput {
  userId: string;
  name: string;
  type: ApiKeyType;
  scope?: ApiKeyScope;
  permissions?: ApiKeyPermission[];
  ipWhitelist?: string[];
  allowedOrigins?: string[];
  rateLimit?: number;
  expiresAt?: Date;
  description?: string;
  metadata?: Record<string, any>;
}

export interface UpdateApiKeyInput {
  name?: string;
  permissions?: ApiKeyPermission[];
  ipWhitelist?: string[];
  allowedOrigins?: string[];
  rateLimit?: number;
  expiresAt?: Date;
  description?: string;
  metadata?: Record<string, any>;
}

export interface ApiKeyUsageStats {
  apiKeyId: string;
  period: 'hour' | 'day' | 'week' | 'month';
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageResponseTime: number;
  bandwidthUsed: number;
  
  // Breakdown by endpoint
  endpointUsage: Record<string, {
    requests: number;
    avgResponseTime: number;
    errors: number;
  }>;
  
  // Breakdown by status code
  statusCodes: Record<string, number>;
  
  // Rate limit hits
  rateLimitExceeded: number;
  
  timestamp: Date;
}

export interface ApiKeyValidationResult {
  valid: boolean;
  apiKey?: ApiKey;
  error?: string;
  errorCode?: 'INVALID_KEY' | 'EXPIRED' | 'REVOKED' | 'IP_BLOCKED' | 'RATE_LIMITED' | 'INSUFFICIENT_PERMISSIONS';
  rateLimitRemaining?: number;
  rateLimitResetAt?: Date;
}

export interface WebhookEndpoint {
  id: string;
  apiKeyId: string;
  url: string;
  events: string[]; // Event types to subscribe to
  active: boolean;
  description?: string;
  
  // Security
  signingSecret: string;
  
  // Delivery settings
  maxRetries: number;
  timeoutSeconds: number;
  
  // Stats
  lastDeliveryAt?: Date;
  lastDeliveryStatus?: 'success' | 'failed';
  failureCount: number;
  successCount: number;
  
  createdAt: Date;
  updatedAt: Date;
}

// Permission mappings for scopes
export const SCOPE_PERMISSIONS: Record<ApiKeyScope, ApiKeyPermission[]> = {
  [ApiKeyScope.FULL_ACCESS]: Object.values(ApiKeyPermission),
  [ApiKeyScope.READ_ONLY]: [
    ApiKeyPermission.ORDERS_READ,
    ApiKeyPermission.SETTLEMENTS_READ,
    ApiKeyPermission.WEBHOOKS_READ,
    ApiKeyPermission.ACCOUNT_READ,
    ApiKeyPermission.REPORTS_READ
  ],
  [ApiKeyScope.TRADING]: [
    ApiKeyPermission.ORDERS_READ,
    ApiKeyPermission.ORDERS_WRITE,
    ApiKeyPermission.ORDERS_CANCEL,
    ApiKeyPermission.SETTLEMENTS_READ,
    ApiKeyPermission.ACCOUNT_READ
  ],
  [ApiKeyScope.REPORTING]: [
    ApiKeyPermission.ORDERS_READ,
    ApiKeyPermission.SETTLEMENTS_READ,
    ApiKeyPermission.REPORTS_READ,
    ApiKeyPermission.REPORTS_EXPORT,
    ApiKeyPermission.ACCOUNT_READ
  ]
};

// Helper to check if a permission is included in a scope
export function hasPermission(
  permissions: ApiKeyPermission[],
  requiredPermission: ApiKeyPermission
): boolean {
  return permissions.includes(requiredPermission);
}

// Helper to get human-readable permission name
export function getPermissionName(permission: ApiKeyPermission): string {
  const names: Record<ApiKeyPermission, string> = {
    [ApiKeyPermission.ORDERS_READ]: 'Read Orders',
    [ApiKeyPermission.ORDERS_WRITE]: 'Create Orders',
    [ApiKeyPermission.ORDERS_CANCEL]: 'Cancel Orders',
    [ApiKeyPermission.SETTLEMENTS_READ]: 'Read Settlements',
    [ApiKeyPermission.SETTLEMENTS_WRITE]: 'Create Settlements',
    [ApiKeyPermission.SETTLEMENTS_APPROVE]: 'Approve Settlements',
    [ApiKeyPermission.WEBHOOKS_READ]: 'Read Webhooks',
    [ApiKeyPermission.WEBHOOKS_MANAGE]: 'Manage Webhooks',
    [ApiKeyPermission.ACCOUNT_READ]: 'Read Account',
    [ApiKeyPermission.ACCOUNT_WRITE]: 'Update Account',
    [ApiKeyPermission.REPORTS_READ]: 'Read Reports',
    [ApiKeyPermission.REPORTS_EXPORT]: 'Export Reports',
    [ApiKeyPermission.ADMIN_USERS]: 'Manage Users',
    [ApiKeyPermission.ADMIN_SETTINGS]: 'Manage Settings'
  };
  
  return names[permission] || permission;
}

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  resetAt: Date;
  retryAfter?: number; // Seconds until reset
}