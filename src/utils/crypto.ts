import crypto from 'crypto';

export function generateApiKey(): string {
  return `mm_${crypto.randomBytes(32).toString('hex')}`;
}

export function generateWebhookSecret(): string {
  return crypto.randomBytes(32).toString('base64');
}

export function signPayload(payload: any, secret: string): string {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(JSON.stringify(payload));
  return hmac.digest('hex');
}

export function verifySignature(
  payload: any,
  signature: string,
  secret: string
): boolean {
  const expectedSignature = signPayload(payload, secret);
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

export function generateNonce(): string {
  return crypto.randomBytes(16).toString('hex');
}

export function hashApiKey(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}