import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { UnauthorizedError, ForbiddenError } from './errorHandler';

// Extend Express Request to include user
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        role: string;
        permissions?: string[];
      };
    }
  }
}

// JWT configuration
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

// User roles
export enum UserRole {
  ADMIN = 'admin',
  TRADER = 'trader',
  MARKET_MAKER = 'market_maker',
  USER = 'user'
}

// Permissions
export enum Permission {
  CREATE_ORDER = 'create_order',
  CANCEL_ORDER = 'cancel_order',
  VIEW_ALL_ORDERS = 'view_all_orders',
  MANAGE_SETTLEMENTS = 'manage_settlements',
  VIEW_ALL_TRADES = 'view_all_trades',
  MANAGE_ACCOUNTS = 'manage_accounts',
  ACCESS_ADMIN_PANEL = 'access_admin_panel'
}

// Role permissions mapping
const rolePermissions: Record<UserRole, Permission[]> = {
  [UserRole.ADMIN]: Object.values(Permission),
  [UserRole.TRADER]: [
    Permission.CREATE_ORDER,
    Permission.CANCEL_ORDER,
    Permission.VIEW_ALL_TRADES
  ],
  [UserRole.MARKET_MAKER]: [
    Permission.CREATE_ORDER,
    Permission.CANCEL_ORDER,
    Permission.VIEW_ALL_ORDERS,
    Permission.VIEW_ALL_TRADES
  ],
  [UserRole.USER]: [
    Permission.CREATE_ORDER,
    Permission.CANCEL_ORDER
  ]
};

// Generate JWT token
export const generateToken = (user: {
  id: string;
  email: string;
  role: string;
}): string => {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      permissions: rolePermissions[user.role as UserRole] || []
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
};

// Verify JWT token
export const verifyToken = (token: string): any => {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    throw new UnauthorizedError('Invalid or expired token');
  }
};

// Authentication middleware
export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Extract token from header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedError('No token provided');
    }

    const token = authHeader.substring(7);
    
    // Verify token
    const decoded = verifyToken(token);
    
    // Attach user to request
    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
      permissions: decoded.permissions
    };

    next();
  } catch (error) {
    next(error);
  }
};

// Optional authentication middleware (doesn't fail if no token)
export const optionalAuthenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const decoded = verifyToken(token);
      
      req.user = {
        id: decoded.id,
        email: decoded.email,
        role: decoded.role,
        permissions: decoded.permissions
      };
    }
    next();
  } catch (error) {
    // Don't fail on authentication errors for optional auth
    next();
  }
};

// Authorization middleware - check for specific permissions
export const authorize = (...requiredPermissions: Permission[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new UnauthorizedError('Authentication required'));
      return;
    }

    const userPermissions = req.user.permissions || [];
    const hasPermission = requiredPermissions.every(permission => 
      userPermissions.includes(permission)
    );

    if (!hasPermission) {
      next(new ForbiddenError('Insufficient permissions'));
      return;
    }

    next();
  };
};

// Role-based authorization middleware
export const authorizeRole = (...allowedRoles: UserRole[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new UnauthorizedError('Authentication required'));
      return;
    }

    if (!allowedRoles.includes(req.user.role as UserRole)) {
      next(new ForbiddenError('Insufficient role privileges'));
      return;
    }

    next();
  };
};

// API key authentication middleware
export const authenticateApiKey = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const apiKey = req.headers['x-api-key'] as string;
  
  if (!apiKey) {
    next(new UnauthorizedError('API key required'));
    return;
  }

  // In a real implementation, validate against stored API keys
  // This is a placeholder implementation
  if (apiKey !== process.env.VALID_API_KEY) {
    next(new UnauthorizedError('Invalid API key'));
    return;
  }

  // You might want to attach API key info to request
  req.user = {
    id: 'api-key-user',
    email: 'api@system.com',
    role: UserRole.TRADER,
    permissions: rolePermissions[UserRole.TRADER]
  };

  next();
};