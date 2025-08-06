/**
 * Client-side authentication utilities for SwapWidget
 */

/**
 * Generate a client-side JWT token for testing
 * This mimics the server-side token generation for development
 */
export function generateTestJWT(walletAddress: string): string {
  // Create a simple payload
  const payload = {
    userId: walletAddress.toLowerCase(),
    email: `${walletAddress.toLowerCase()}@wallet.local`,
    role: 'user',
    exp: Date.now() + 86400000, // 24 hours
    iat: Date.now()
  };

  // Create a simple base64 encoded token (not cryptographically secure - for testing only)
  const header = btoa(JSON.stringify({ typ: 'JWT', alg: 'HS256' }));
  const payloadB64 = btoa(JSON.stringify(payload));
  
  // For testing, we'll use a simple signature
  // In production, this would need proper signing
  const signature = btoa('test-signature-' + walletAddress);
  
  return `${header}.${payloadB64}.${signature}`;
}

/**
 * Store JWT token in localStorage
 */
export function storeAuthToken(token: string): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem('swappiq_auth_token', token);
  }
}

/**
 * Retrieve JWT token from localStorage
 */
export function getAuthToken(): string | null {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('swappiq_auth_token');
  }
  return null;
}

/**
 * Clear JWT token from localStorage
 */
export function clearAuthToken(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('swappiq_auth_token');
  }
}

/**
 * Check if user is authenticated
 */
export function isAuthenticated(): boolean {
  const token = getAuthToken();
  if (!token) return false;
  
  try {
    // Decode the token to check expiration
    const [, payloadB64] = token.split('.');
    const payload = JSON.parse(atob(payloadB64));
    return payload.exp > Date.now();
  } catch {
    return false;
  }
}