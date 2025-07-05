
import { NextApiRequest, NextApiResponse, NextApiHandler } from 'next';
import { ApiKeyService, ApiKeyPermission } from '../services/apiKeyService';
import jwt from 'jsonwebtoken';

export function withApiKey(handler: NextApiHandler, requiredPermission?: ApiKeyPermission) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized: Missing or invalid API key' });
    }

    const apiKey = authHeader.split(' ')[1];
    const keyDetails = await ApiKeyService.validateApiKey(apiKey);

    if (!keyDetails) {
      return res.status(401).json({ error: 'Unauthorized: Invalid or expired API key' });
    }

    if (requiredPermission && !ApiKeyService.hasPermission(keyDetails, requiredPermission)) {
      return res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
    }

    // Attach key details to the request object for use in the handler
    (req as any).apiKey = keyDetails;

    return handler(req, res);
  };
}

export async function validateWebSocketConnection(apiKey: string): Promise<any | null> {
  if (!apiKey) {
    return null;
  }

  const keyDetails = await ApiKeyService.validateApiKey(apiKey);

  if (!keyDetails) {
    return null;
  }

  return keyDetails;
}

// JWT Authentication Middleware
export interface AuthenticatedRequest extends NextApiRequest {
  user?: any;
}

export function requireAuth(handler: NextApiHandler) {
  return async (req: AuthenticatedRequest, res: NextApiResponse) => {
    const authHeader = req.headers.authorization || req.headers.Authorization || req.headers.AUTHORIZATION;

    if (!authHeader || typeof authHeader !== 'string') {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      const secret = process.env.JWT_SECRET;
      if (!secret) {
        console.error('JWT_SECRET not configured');
        return res.status(401).json({ error: 'Invalid token' });
      }

      const decoded = jwt.verify(token, secret);
      req.user = decoded;
      return handler(req, res);
    } catch (error) {
      // Don't expose specific JWT errors to client
      return res.status(401).json({ error: 'Invalid token' });
    }
  };
}
