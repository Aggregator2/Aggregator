// Example: How to secure API endpoints with different authentication levels

import { NextApiRequest, NextApiResponse } from 'next';
import { 
  withAuth, 
  authenticatedEndpoint, 
  adminEndpoint,
  secureEndpoints,
  PermissionLevel,
  SecureRequest
} from '@/src/middleware/authWrapper';

// Example 1: Simple authenticated endpoint
const simpleAuthExample = authenticatedEndpoint(async (req: SecureRequest, res: NextApiResponse) => {
  // User is guaranteed to be authenticated here
  const userId = req.user?.id;
  
  res.status(200).json({
    message: 'Authenticated endpoint',
    userId: userId
  });
});

// Example 2: Admin-only endpoint
const adminOnlyExample = adminEndpoint(async (req: SecureRequest, res: NextApiResponse) => {
  // Only admin users can access this
  res.status(200).json({
    message: 'Admin endpoint',
    user: req.user
  });
});

// Example 3: Custom permissions
const customPermissionsExample = withAuth(
  async (req: SecureRequest, res: NextApiResponse) => {
    res.status(200).json({
      message: 'Custom permissions endpoint',
      userRole: req.user?.role
    });
  },
  {
    roles: ['market_maker', 'admin'],
    permissions: ['trading.execute']
  }
);

// Example 4: Different auth for different HTTP methods
export default secureEndpoints({
  // Public GET
  GET: {
    handler: async (req, res) => {
      res.status(200).json({ 
        message: 'Public data',
        data: ['item1', 'item2']
      });
    },
    auth: { level: PermissionLevel.PUBLIC }
  },
  
  // Authenticated POST
  POST: {
    handler: async (req: SecureRequest, res) => {
      const userId = req.user?.id;
      res.status(201).json({ 
        message: 'Created by user',
        userId,
        data: req.body
      });
    },
    auth: { level: PermissionLevel.AUTHENTICATED }
  },
  
  // Admin DELETE
  DELETE: {
    handler: async (req: SecureRequest, res) => {
      res.status(200).json({ 
        message: 'Deleted by admin',
        adminId: req.user?.id
      });
    },
    auth: { level: PermissionLevel.ADMIN }
  }
});

// Example 5: Converting existing endpoint
// BEFORE:
/*
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Unprotected endpoint
  const orders = await getOrders();
  res.status(200).json(orders);
}
*/

// AFTER:
/*
import { authenticatedEndpoint } from '@/src/middleware/authWrapper';

export default authenticatedEndpoint(async (req, res) => {
  // Now protected - only authenticated users can access
  const orders = await getOrders();
  res.status(200).json(orders);
});
*/

// Example 6: Migrating from requireAuth
// BEFORE:
/*
import { requireAuth } from '@/src/middleware/auth';

export default requireAuth(async (req, res) => {
  // Handler code
});
*/

// AFTER (equivalent but with more features):
/*
import { authenticatedEndpoint } from '@/src/middleware/authWrapper';

export default authenticatedEndpoint(async (req, res) => {
  // Handler code - same functionality but with better error handling
});
*/