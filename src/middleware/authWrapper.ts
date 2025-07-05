import { NextApiRequest, NextApiResponse, NextApiHandler } from 'next';
import { requireAuth, AuthenticatedRequest } from './auth';
import jwt from 'jsonwebtoken';

// Permission levels
export enum PermissionLevel {
  PUBLIC = 'public',
  AUTHENTICATED = 'authenticated',
  ADMIN = 'admin',
  MARKET_MAKER = 'market_maker'
}

// Extended request type with user and permissions
export interface SecureRequest extends AuthenticatedRequest {
  user?: {
    id: string;
    email?: string;
    role?: string;
    permissions?: string[];
  };
}

// Role-based access control
export function withAuth(
  handler: NextApiHandler,
  options?: {
    level?: PermissionLevel;
    roles?: string[];
    permissions?: string[];
  }
) {
  return async (req: SecureRequest, res: NextApiResponse) => {
    const { level = PermissionLevel.AUTHENTICATED, roles = [], permissions = [] } = options || {};
    
    // Public endpoints don't need authentication
    if (level === PermissionLevel.PUBLIC) {
      return handler(req, res);
    }
    
    // Check for authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        error: 'Unauthorized',
        message: 'Missing or invalid authorization header'
      });
    }
    
    const token = authHeader.split(' ')[1];
    
    try {
      const secret = process.env.JWT_SECRET;
      if (!secret) {
        console.error('JWT_SECRET not configured');
        return res.status(500).json({ error: 'Server configuration error' });
      }
      
      // Verify and decode token
      const decoded = jwt.verify(token, secret) as any;
      req.user = {
        id: decoded.userId || decoded.id,
        email: decoded.email,
        role: decoded.role || 'user',
        permissions: decoded.permissions || []
      };
      
      // Check role-based permissions
      if (level === PermissionLevel.ADMIN && req.user.role !== 'admin') {
        return res.status(403).json({ 
          error: 'Forbidden',
          message: 'Admin access required'
        });
      }
      
      if (level === PermissionLevel.MARKET_MAKER && 
          req.user.role !== 'market_maker' && 
          req.user.role !== 'admin') {
        return res.status(403).json({ 
          error: 'Forbidden',
          message: 'Market maker access required'
        });
      }
      
      // Check specific roles if provided
      if (roles.length > 0 && !roles.includes(req.user.role)) {
        return res.status(403).json({ 
          error: 'Forbidden',
          message: `One of these roles required: ${roles.join(', ')}`
        });
      }
      
      // Check specific permissions if provided
      if (permissions.length > 0) {
        const hasPermission = permissions.some(perm => 
          req.user.permissions?.includes(perm)
        );
        if (!hasPermission) {
          return res.status(403).json({ 
            error: 'Forbidden',
            message: `Missing required permissions: ${permissions.join(', ')}`
          });
        }
      }
      
      // All checks passed, proceed to handler
      return handler(req, res);
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        return res.status(401).json({ 
          error: 'Unauthorized',
          message: 'Token expired'
        });
      } else if (error instanceof jwt.JsonWebTokenError) {
        return res.status(401).json({ 
          error: 'Unauthorized',
          message: 'Invalid token'
        });
      }
      
      console.error('Auth error:', error);
      return res.status(401).json({ 
        error: 'Unauthorized',
        message: 'Authentication failed'
      });
    }
  };
}

// Convenience wrappers
export const publicEndpoint = (handler: NextApiHandler) => 
  withAuth(handler, { level: PermissionLevel.PUBLIC });

export const authenticatedEndpoint = (handler: NextApiHandler) => 
  withAuth(handler, { level: PermissionLevel.AUTHENTICATED });

export const adminEndpoint = (handler: NextApiHandler) => 
  withAuth(handler, { level: PermissionLevel.ADMIN });

export const marketMakerEndpoint = (handler: NextApiHandler) => 
  withAuth(handler, { level: PermissionLevel.MARKET_MAKER });

// Batch authentication wrapper for multiple handlers
export function secureEndpoints(handlers: {
  [method: string]: {
    handler: NextApiHandler;
    auth?: {
      level?: PermissionLevel;
      roles?: string[];
      permissions?: string[];
    };
  };
}) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    const method = req.method?.toUpperCase();
    
    if (!method || !handlers[method]) {
      return res.status(405).json({ 
        error: 'Method not allowed',
        allowed: Object.keys(handlers)
      });
    }
    
    const { handler, auth } = handlers[method];
    const securedHandler = auth ? withAuth(handler, auth) : handler;
    
    return securedHandler(req, res);
  };
}

// Example usage:
/*
// Single endpoint with auth
export default authenticatedEndpoint(async (req, res) => {
  // Your handler code
});

// Multiple methods with different auth levels
export default secureEndpoints({
  GET: {
    handler: getHandler,
    auth: { level: PermissionLevel.PUBLIC }
  },
  POST: {
    handler: postHandler,
    auth: { level: PermissionLevel.AUTHENTICATED }
  },
  DELETE: {
    handler: deleteHandler,
    auth: { level: PermissionLevel.ADMIN }
  }
});
*/