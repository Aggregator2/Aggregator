import crypto from 'crypto';
import { Request } from 'express';

export class WebhookSecurity {
  private static readonly SIGNATURE_ALGORITHM = 'sha256';
  private static readonly SIGNATURE_ENCODING = 'hex';
  private static readonly SIGNATURE_HEADER = 'X-Webhook-Signature';
  private static readonly TIMESTAMP_HEADER = 'X-Webhook-Timestamp';
  private static readonly EVENT_ID_HEADER = 'X-Webhook-Event-ID';
  private static readonly REPLAY_TOLERANCE = 300; // 5 minutes in seconds

  /**
   * Generate HMAC signature for webhook payload
   */
  static generateSignature(
    secret: string,
    payload: string | Buffer,
    timestamp: number
  ): string {
    const message = `${timestamp}.${payload}`;
    const hmac = crypto.createHmac(this.SIGNATURE_ALGORITHM, secret);
    hmac.update(message);
    return `${this.SIGNATURE_ALGORITHM}=${hmac.digest(this.SIGNATURE_ENCODING)}`;
  }

  /**
   * Verify webhook signature
   */
  static verifySignature(
    secret: string,
    payload: string | Buffer,
    signature: string,
    timestamp: number
  ): boolean {
    try {
      const expectedSignature = this.generateSignature(secret, payload, timestamp);
      return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
      );
    } catch (error) {
      return false;
    }
  }

  /**
   * Verify webhook request
   */
  static verifyWebhookRequest(
    req: Request,
    secret: string,
    options?: {
      replayTolerance?: number;
      validateTimestamp?: boolean;
    }
  ): { valid: boolean; error?: string } {
    const signature = req.headers[this.SIGNATURE_HEADER.toLowerCase()] as string;
    const timestamp = req.headers[this.TIMESTAMP_HEADER.toLowerCase()] as string;
    const eventId = req.headers[this.EVENT_ID_HEADER.toLowerCase()] as string;

    // Check required headers
    if (!signature) {
      return { valid: false, error: 'Missing signature header' };
    }

    if (!timestamp) {
      return { valid: false, error: 'Missing timestamp header' };
    }

    if (!eventId) {
      return { valid: false, error: 'Missing event ID header' };
    }

    // Validate timestamp format
    const timestampNum = parseInt(timestamp, 10);
    if (isNaN(timestampNum)) {
      return { valid: false, error: 'Invalid timestamp format' };
    }

    // Check replay attack
    if (options?.validateTimestamp !== false) {
      const tolerance = options?.replayTolerance || this.REPLAY_TOLERANCE;
      const currentTime = Math.floor(Date.now() / 1000);
      const timeDiff = Math.abs(currentTime - timestampNum);

      if (timeDiff > tolerance) {
        return { 
          valid: false, 
          error: `Timestamp too old. Difference: ${timeDiff}s, tolerance: ${tolerance}s` 
        };
      }
    }

    // Get raw body
    const rawBody = (req as any).rawBody || JSON.stringify(req.body);

    // Verify signature
    const isValid = this.verifySignature(secret, rawBody, signature, timestampNum);

    if (!isValid) {
      return { valid: false, error: 'Invalid signature' };
    }

    return { valid: true };
  }

  /**
   * Generate webhook headers
   */
  static generateWebhookHeaders(
    secret: string,
    payload: string | Buffer,
    eventId: string
  ): Record<string, string> {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = this.generateSignature(secret, payload, timestamp);

    return {
      [this.SIGNATURE_HEADER]: signature,
      [this.TIMESTAMP_HEADER]: timestamp.toString(),
      [this.EVENT_ID_HEADER]: eventId,
      'Content-Type': 'application/json',
      'User-Agent': 'TradingPlatform-Webhook/1.0'
    };
  }

  /**
   * Validate IP whitelist
   */
  static validateIpWhitelist(
    requestIp: string,
    whitelist: string[]
  ): boolean {
    if (!whitelist || whitelist.length === 0) {
      return true; // No whitelist means all IPs are allowed
    }

    // Normalize IP address
    const normalizedIp = this.normalizeIp(requestIp);

    return whitelist.some(allowedIp => {
      if (allowedIp.includes('/')) {
        // CIDR notation
        return this.isIpInCidr(normalizedIp, allowedIp);
      } else {
        // Exact match
        return normalizedIp === this.normalizeIp(allowedIp);
      }
    });
  }

  /**
   * Generate secure webhook secret
   */
  static generateSecret(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Hash sensitive data for logging
   */
  static hashForLogging(data: string): string {
    return crypto
      .createHash('sha256')
      .update(data)
      .digest('hex')
      .substring(0, 16);
  }

  /**
   * Create event ID to prevent duplicates
   */
  static generateEventId(
    eventType: string,
    entityId: string,
    timestamp?: number
  ): string {
    const ts = timestamp || Date.now();
    const data = `${eventType}:${entityId}:${ts}`;
    return `evt_${crypto
      .createHash('sha256')
      .update(data)
      .digest('hex')
      .substring(0, 16)}`;
  }

  /**
   * Normalize IP address
   */
  private static normalizeIp(ip: string): string {
    // Remove IPv6 prefix for IPv4 addresses
    if (ip.startsWith('::ffff:')) {
      return ip.substring(7);
    }
    return ip;
  }

  /**
   * Check if IP is in CIDR range
   */
  private static isIpInCidr(ip: string, cidr: string): boolean {
    const [range, bits = '32'] = cidr.split('/');
    const mask = parseInt(bits, 10);

    const ipParts = ip.split('.').map(Number);
    const rangeParts = range.split('.').map(Number);

    if (ipParts.length !== 4 || rangeParts.length !== 4) {
      return false;
    }

    const ipNum = ipParts.reduce((acc, part) => (acc << 8) + part, 0);
    const rangeNum = rangeParts.reduce((acc, part) => (acc << 8) + part, 0);

    const maskBits = 0xffffffff << (32 - mask);

    return (ipNum & maskBits) === (rangeNum & maskBits);
  }
}

// Middleware for webhook endpoint protection
export function webhookEndpointProtection(
  secretProvider: (webhookId: string) => Promise<string | null>
) {
  return async (req: Request, res: any, next: any) => {
    try {
      // Extract webhook ID from request
      const webhookId = req.params.webhookId || req.body.webhookId;
      
      if (!webhookId) {
        return res.status(400).json({ error: 'Webhook ID required' });
      }

      // Get webhook secret
      const secret = await secretProvider(webhookId);
      
      if (!secret) {
        return res.status(404).json({ error: 'Webhook not found' });
      }

      // Verify request
      const verification = WebhookSecurity.verifyWebhookRequest(req, secret);
      
      if (!verification.valid) {
        return res.status(401).json({ 
          error: 'Webhook verification failed',
          details: verification.error 
        });
      }

      // Add webhook context to request
      (req as any).webhook = {
        id: webhookId,
        eventId: req.headers['x-webhook-event-id'],
        timestamp: parseInt(req.headers['x-webhook-timestamp'] as string, 10)
      };

      next();
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}