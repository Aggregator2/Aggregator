import { NextApiRequest, NextApiResponse } from 'next';
import { ApiKeyService } from '../services/apiKey/ApiKeyService';
import { ApiKeyPermission, ApiKeyValidationResult, RateLimitInfo } from '../types/apiKey';
import { createLogger } from '../utils/production-logger';

const logger = createLogger('ApiKeyAuth');
const apiKeyService = ApiKeyService.getInstance();

export interface AuthenticatedRequest extends NextApiRequest {
  apiKey?: {
    id: string;
    userId: string;
    permissions: ApiKeyPermission[];
    rateLimit: RateLimitInfo;
  };
}

export type ApiHandler = (
  req: AuthenticatedRequest,
  res: NextApiResponse
) => Promise<void> | void;

/**
 * Middleware to authenticate API requests using API keys
 */
export function withApiKeyAuth(
  handler: ApiHandler,
  requiredPermissions: ApiKeyPermission[] = []
): ApiHandler {
  return async (req: AuthenticatedRequest, res: NextApiResponse) => {
    const startTime = Date.now();
    
    try {
      // Extract API key from Authorization header
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return sendAuthError(res, 'Missing or invalid Authorization header', 401);
      }
      
      const apiKey = authHeader.substring(7); // Remove 'Bearer ' prefix
      
      // Validate API key format
      if (!apiKey.startsWith('ocp_')) {
        return sendAuthError(res, 'Invalid API key format', 401);
      }
      
      // Get client IP address
      const ipAddress = getClientIp(req);
      
      // Validate API key
      const validation = await apiKeyService.validateApiKey(
        apiKey,
        ipAddress,
        requiredPermissions
      );
      
      if (!validation.valid) {
        return handleValidationError(res, validation);
      }
      
      // Attach API key info to request
      req.apiKey = {
        id: validation.apiKey!.id,
        userId: validation.apiKey!.userId,
        permissions: validation.apiKey!.permissions,
        rateLimit: {
          limit: validation.apiKey!.rateLimit,
          remaining: validation.rateLimitRemaining!,
          resetAt: validation.rateLimitResetAt!
        }
      };
      
      // Set rate limit headers
      setRateLimitHeaders(res, req.apiKey.rateLimit);
      
      // Track response for usage stats
      const originalSend = res.send;
      const originalJson = res.json;
      let responseSize = 0;
      
      res.send = function(data: any) {
        responseSize = Buffer.byteLength(JSON.stringify(data));
        return originalSend.call(this, data);
      };
      
      res.json = function(data: any) {
        responseSize = Buffer.byteLength(JSON.stringify(data));
        return originalJson.call(this, data);
      };
      
      // Add response tracking
      res.on('finish', () => {
        const responseTime = Date.now() - startTime;
        const endpoint = `${req.method} ${req.url?.split('?')[0]}`;
        
        // Track usage asynchronously
        apiKeyService.trackUsage(
          req.apiKey!.id,
          endpoint,
          res.statusCode,
          responseTime,
          responseSize
        ).catch(error => {
          logger.error('Failed to track API usage', error);
        });
      });
      
      // Call the actual handler
      return handler(req, res);
      
    } catch (error) {
      logger.error('API key authentication error', error);
      return sendAuthError(res, 'Authentication failed', 500);
    }
  };
}

/**
 * Helper to require specific permissions
 */
export function requirePermissions(...permissions: ApiKeyPermission[]) {
  return (handler: ApiHandler) => withApiKeyAuth(handler, permissions);
}

/**
 * Get client IP address from request
 */
function getClientIp(req: NextApiRequest): string {
  // Check standard headers
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return (typeof forwarded === 'string' ? forwarded : forwarded[0]).split(',')[0].trim();
  }
  
  const realIp = req.headers['x-real-ip'];
  if (realIp) {
    return typeof realIp === 'string' ? realIp : realIp[0];
  }
  
  // Fallback to socket address
  return req.socket.remoteAddress || '';
}

/**
 * Send authentication error response
 */
function sendAuthError(res: NextApiResponse, message: string, status: number): void {
  res.status(status).json({
    error: message,
    code: 'AUTHENTICATION_ERROR'
  });
}

/**
 * Handle validation errors
 */
function handleValidationError(res: NextApiResponse, validation: ApiKeyValidationResult): void {
  switch (validation.errorCode) {
    case 'INVALID_KEY':
      return sendAuthError(res, validation.error || 'Invalid API key', 401);
      
    case 'EXPIRED':
      return sendAuthError(res, validation.error || 'API key has expired', 401);
      
    case 'REVOKED':
      return sendAuthError(res, validation.error || 'API key has been revoked', 401);
      
    case 'IP_BLOCKED':
      return sendAuthError(res, validation.error || 'IP address not authorized', 403);
      
    case 'RATE_LIMITED':
      res.setHeader('Retry-After', '3600'); // 1 hour
      if (validation.rateLimitResetAt) {
        setRateLimitHeaders(res, {
          limit: 0,
          remaining: 0,
          resetAt: validation.rateLimitResetAt,
          retryAfter: Math.ceil((validation.rateLimitResetAt.getTime() - Date.now()) / 1000)
        });
      }
      return res.status(429).json({
        error: validation.error || 'Rate limit exceeded',
        code: 'RATE_LIMITED',
        retryAfter: 3600
      });
      
    case 'INSUFFICIENT_PERMISSIONS':
      return sendAuthError(res, validation.error || 'Insufficient permissions', 403);
      
    default:
      return sendAuthError(res, 'Authentication failed', 401);
  }
}

/**
 * Set rate limit headers
 */
function setRateLimitHeaders(res: NextApiResponse, rateLimit: RateLimitInfo): void {
  res.setHeader('X-RateLimit-Limit', rateLimit.limit.toString());
  res.setHeader('X-RateLimit-Remaining', rateLimit.remaining.toString());
  res.setHeader('X-RateLimit-Reset', Math.floor(rateLimit.resetAt.getTime() / 1000).toString());
  
  if (rateLimit.retryAfter) {
    res.setHeader('Retry-After', rateLimit.retryAfter.toString());
  }
}

/**
 * Middleware for webhook signature validation
 */
export function withWebhookSignature(
  handler: ApiHandler,
  getSecret: (req: AuthenticatedRequest) => Promise<string | null>
): ApiHandler {
  return async (req: AuthenticatedRequest, res: NextApiResponse) => {
    try {
      // Get the raw body
      const rawBody = JSON.stringify(req.body);
      
      // Get signature from header
      const signature = req.headers['x-ocp-signature'];
      if (!signature || typeof signature !== 'string') {
        return res.status(401).json({
          error: 'Missing webhook signature',
          code: 'INVALID_SIGNATURE'
        });
      }
      
      // Get the secret
      const secret = await getSecret(req);
      if (!secret) {
        return res.status(401).json({
          error: 'Webhook not configured',
          code: 'WEBHOOK_NOT_FOUND'
        });
      }
      
      // Verify signature
      const crypto = require('crypto');
      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(rawBody)
        .digest('hex');
      
      if (!crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
      )) {
        return res.status(401).json({
          error: 'Invalid webhook signature',
          code: 'INVALID_SIGNATURE'
        });
      }
      
      // Call the handler
      return handler(req, res);
      
    } catch (error) {
      logger.error('Webhook signature validation error', error);
      return res.status(500).json({
        error: 'Signature validation failed',
        code: 'INTERNAL_ERROR'
      });
    }
  };
}