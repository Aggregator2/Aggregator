/**
 * @fileoverview Request signing utilities for secure API authentication
 * @author SwappiQ Protocol
 * @description Production-grade request signing with multiple algorithms and security features
 */

import { createHmac, createHash, randomBytes, timingSafeEqual } from 'crypto';
import { AuthCredentials, SignedRequest } from '../types/api.js';

export interface SigningOptions {
  algorithm?: 'HMAC-SHA256' | 'HMAC-SHA512' | 'Ed25519';
  includeBody?: boolean;
  includeHeaders?: string[];
  timestampTolerance?: number;
  nonce?: boolean;
}

export interface SignatureComponents {
  method: string;
  path: string;
  timestamp: string;
  nonce?: string;
  body?: string;
  headers?: string;
}

/**
 * Enterprise-grade request signer with multiple security algorithms
 */
export class RequestSigner {
  private readonly credentials?: AuthCredentials;
  private readonly defaultOptions: Required<SigningOptions>;

  constructor(credentials?: AuthCredentials, options: SigningOptions = {}) {
    this.credentials = credentials;
    this.defaultOptions = {
      algorithm: 'HMAC-SHA256',
      includeBody: true,
      includeHeaders: ['content-type', 'x-timestamp'],
      timestampTolerance: 30000, // 30 seconds
      nonce: true,
      ...options
    };
  }

  /**
   * Sign an HTTP request for API authentication
   */
  async signRequest(
    request: Omit<SignedRequest, 'signature' | 'headers'>,
    options: SigningOptions = {}
  ): Promise<SignedRequest> {
    if (!this.credentials) {
      throw new Error('Authentication credentials not provided');
    }

    const opts = { ...this.defaultOptions, ...options };
    const timestamp = request.timestamp || Date.now().toString();
    const nonce = opts.nonce ? this.generateNonce() : undefined;

    // Build signature components
    const components = this.buildSignatureComponents({
      method: request.method,
      path: request.path,
      timestamp,
      nonce,
      body: opts.includeBody ? request.body : undefined
    }, opts);

    // Generate signature
    const signature = await this.generateSignature(components, opts.algorithm);

    // Build headers
    const headers = this.buildAuthHeaders({
      apiKey: this.credentials.apiKey,
      timestamp,
      nonce,
      signature,
      passphrase: this.credentials.passphrase
    });

    return {
      ...request,
      timestamp,
      signature,
      headers
    };
  }

  /**
   * Verify a signed request (for webhook validation)
   */
  async verifyRequest(
    request: SignedRequest,
    secret: string,
    options: SigningOptions = {}
  ): Promise<boolean> {
    try {
      const opts = { ...this.defaultOptions, ...options };
      
      // Check timestamp tolerance
      if (opts.timestampTolerance > 0) {
        const requestTime = parseInt(request.timestamp);
        const currentTime = Date.now();
        const timeDiff = Math.abs(currentTime - requestTime);
        
        if (timeDiff > opts.timestampTolerance) {
          return false;
        }
      }

      // Reconstruct signature components
      const components = this.buildSignatureComponents({
        method: request.method,
        path: request.path,
        timestamp: request.timestamp,
        nonce: this.extractNonceFromHeaders(request.headers),
        body: opts.includeBody ? request.body : undefined
      }, opts);

      // Generate expected signature
      const expectedSignature = await this.generateSignatureWithSecret(
        components,
        secret,
        opts.algorithm
      );

      // Timing-safe comparison
      return this.compareSignatures(request.signature, expectedSignature);

    } catch (error) {
      console.error('Request verification failed:', error);
      return false;
    }
  }

  /**
   * Generate signature from components
   */
  private async generateSignature(
    components: SignatureComponents,
    algorithm: string
  ): Promise<string> {
    if (!this.credentials?.apiSecret) {
      throw new Error('API secret not provided');
    }

    return this.generateSignatureWithSecret(components, this.credentials.apiSecret, algorithm);
  }

  /**
   * Generate signature with provided secret
   */
  private async generateSignatureWithSecret(
    components: SignatureComponents,
    secret: string,
    algorithm: string
  ): Promise<string> {
    const message = this.buildSignatureString(components);

    switch (algorithm) {
      case 'HMAC-SHA256':
        return createHmac('sha256', secret)
          .update(message)
          .digest('hex');

      case 'HMAC-SHA512':
        return createHmac('sha512', secret)
          .update(message)
          .digest('hex');

      case 'Ed25519':
        // For Ed25519, we'd typically use a specialized crypto library
        // This is a simplified implementation using HMAC-SHA256 as fallback
        console.warn('Ed25519 not fully implemented, falling back to HMAC-SHA256');
        return createHmac('sha256', secret)
          .update(message)
          .digest('hex');

      default:
        throw new Error(`Unsupported signing algorithm: ${algorithm}`);
    }
  }

  /**
   * Build signature components for message construction
   */
  private buildSignatureComponents(
    base: Partial<SignatureComponents>,
    options: SigningOptions
  ): SignatureComponents {
    const components: SignatureComponents = {
      method: base.method || '',
      path: base.path || '',
      timestamp: base.timestamp || Date.now().toString()
    };

    if (base.nonce) {
      components.nonce = base.nonce;
    }

    if (options.includeBody && base.body !== undefined) {
      components.body = this.normalizeBody(base.body);
    }

    if (options.includeHeaders && options.includeHeaders.length > 0) {
      components.headers = this.buildHeadersString(base.headers || {}, options.includeHeaders);
    }

    return components;
  }

  /**
   * Build the string to be signed
   */
  private buildSignatureString(components: SignatureComponents): string {
    const parts: string[] = [
      components.method.toUpperCase(),
      components.path,
      components.timestamp
    ];

    if (components.nonce) {
      parts.push(components.nonce);
    }

    if (components.body !== undefined) {
      parts.push(components.body);
    }

    if (components.headers) {
      parts.push(components.headers);
    }

    return parts.join('\n');
  }

  /**
   * Build authentication headers
   */
  private buildAuthHeaders(auth: {
    apiKey: string;
    timestamp: string;
    nonce?: string;
    signature: string;
    passphrase?: string;
  }): Record<string, string> {
    const headers: Record<string, string> = {
      'X-API-Key': auth.apiKey,
      'X-Timestamp': auth.timestamp,
      'X-Signature': auth.signature
    };

    if (auth.nonce) {
      headers['X-Nonce'] = auth.nonce;
    }

    if (auth.passphrase) {
      headers['X-Passphrase'] = auth.passphrase;
    }

    return headers;
  }

  /**
   * Generate cryptographically secure nonce
   */
  private generateNonce(length: number = 16): string {
    return randomBytes(length).toString('hex');
  }

  /**
   * Normalize request body for consistent signing
   */
  private normalizeBody(body: string): string {
    if (!body) return '';
    
    try {
      // Parse and re-stringify JSON to normalize formatting
      const parsed = JSON.parse(body);
      return JSON.stringify(parsed, Object.keys(parsed).sort());
    } catch {
      // If not JSON, return as-is
      return body;
    }
  }

  /**
   * Build headers string for signing
   */
  private buildHeadersString(
    headers: Record<string, string>,
    includeHeaders: string[]
  ): string {
    const normalizedHeaders: Record<string, string> = {};
    
    // Normalize header names to lowercase
    for (const [key, value] of Object.entries(headers)) {
      normalizedHeaders[key.toLowerCase()] = value;
    }

    // Build signed headers string
    const signedHeaders = includeHeaders
      .map(header => header.toLowerCase())
      .sort()
      .map(header => `${header}:${normalizedHeaders[header] || ''}`)
      .join('\n');

    return signedHeaders;
  }

  /**
   * Extract nonce from request headers
   */
  private extractNonceFromHeaders(headers: Record<string, string>): string | undefined {
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === 'x-nonce') {
        return value;
      }
    }
    return undefined;
  }

  /**
   * Timing-safe signature comparison with enhanced security
   */
  private compareSignatures(signature1: string, signature2: string): boolean {
    // Always ensure equal length comparison for timing safety
    const len1 = signature1.length;
    const len2 = signature2.length;
    const maxLen = Math.max(len1, len2);
    
    // Pad shorter string with zeros to ensure constant-time comparison
    const padded1 = signature1.padEnd(maxLen, '0');
    const padded2 = signature2.padEnd(maxLen, '0');

    try {
      // Convert to buffers for timing-safe comparison
      const buffer1 = Buffer.from(padded1, 'hex');
      const buffer2 = Buffer.from(padded2, 'hex');
      
      // Additional length check after conversion
      if (buffer1.length !== buffer2.length) {
        return false;
      }
      
      // Use timing-safe comparison and verify original lengths match
      return timingSafeEqual(buffer1, buffer2) && len1 === len2;
    } catch (error) {
      // Secure fallback - no timing attack vulnerability
      let result = 0;
      
      // Always compare full padded length for timing safety
      for (let i = 0; i < maxLen; i++) {
        const char1 = i < len1 ? padded1.charCodeAt(i) : 0;
        const char2 = i < len2 ? padded2.charCodeAt(i) : 0;
        result |= char1 ^ char2;
      }
      
      // Only return true if both result is 0 AND lengths match
      return result === 0 && len1 === len2;
    }
  }

  /**
   * Create signature for webhook payload
   */
  createWebhookSignature(payload: string, secret: string, algorithm = 'sha256'): string {
    return createHmac(algorithm, secret)
      .update(payload)
      .digest('hex');
  }

  /**
   * Verify webhook signature
   */
  verifyWebhookSignature(
    payload: string,
    signature: string,
    secret: string,
    algorithm = 'sha256'
  ): boolean {
    const expectedSignature = this.createWebhookSignature(payload, secret, algorithm);
    return this.compareSignatures(signature, expectedSignature);
  }

  /**
   * Generate API key pair for development/testing
   */
  static generateApiKeyPair(): { apiKey: string; apiSecret: string } {
    const apiKey = 'sk_' + randomBytes(16).toString('hex');
    const apiSecret = randomBytes(32).toString('hex');
    
    return { apiKey, apiSecret };
  }

  /**
   * Hash sensitive data for logging
   */
  static hashForLogging(data: string): string {
    return createHash('sha256').update(data).digest('hex').substring(0, 8);
  }

  /**
   * Validate API key format
   */
  static validateApiKey(apiKey: string): boolean {
    // API keys should start with 'sk_' and be 35 characters total
    return /^sk_[a-f0-9]{32}$/.test(apiKey);
  }

  /**
   * Validate API secret format
   */
  static validateApiSecret(apiSecret: string): boolean {
    // API secrets should be 64 hex characters
    return /^[a-f0-9]{64}$/.test(apiSecret);
  }
}

/**
 * Utility function to create a configured request signer
 */
export function createRequestSigner(
  credentials: AuthCredentials,
  options?: SigningOptions
): RequestSigner {
  return new RequestSigner(credentials, options);
}

/**
 * Utility function for quick request signing
 */
export async function signRequest(
  request: Omit<SignedRequest, 'signature' | 'headers'>,
  credentials: AuthCredentials,
  options?: SigningOptions
): Promise<SignedRequest> {
  const signer = new RequestSigner(credentials, options);
  return signer.signRequest(request, options);
}

/**
 * Utility function for webhook signature verification
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string,
  algorithm = 'sha256'
): boolean {
  const signer = new RequestSigner();
  return signer.verifyWebhookSignature(payload, signature, secret, algorithm);
}