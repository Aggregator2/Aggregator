import { Request, Response, NextFunction } from 'express';
import { z, ZodError, ZodSchema } from 'zod';
import { ValidationError } from '../utils/errors';
import { SUPPORTED_CHAINS } from '../types/token';
import { providerService } from '../services/blockchain/providerService';

export const validate = (schema: ZodSchema) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validated = await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params
      });

      req.body = validated.body || req.body;
      req.query = validated.query || req.query;
      req.params = validated.params || req.params;

      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const errors = error.errors.map(err => ({
          field: err.path.join('.'),
          message: err.message
        }));
        
        return next(new ValidationError('Validation failed', errors));
      }
      next(error);
    }
  };
};

// Common validators
export const validators = {
  // Ethereum address validation
  ethereumAddress: z.string().refine(
    (val) => /^0x[a-fA-F0-9]{40}$/.test(val),
    'Invalid Ethereum address'
  ),

  // Chain-aware address validation
  blockchainAddress: (chainId: number) => z.string().refine(
    async (val) => providerService.validateAddress(chainId, val),
    'Invalid address for the specified chain'
  ),

  // Positive decimal number
  positiveDecimal: z.string().refine(
    (val) => /^\d+(\.\d+)?$/.test(val) && parseFloat(val) > 0,
    'Must be a positive number'
  ),

  // Chain ID validation
  chainId: z.number().refine(
    (val) => Object.keys(SUPPORTED_CHAINS).includes(val.toString()),
    'Unsupported chain ID'
  ),

  // Signature validation
  signature: z.string().regex(
    /^0x[a-fA-F0-9]{130}$/,
    'Invalid signature format'
  ),

  // Nonce validation
  nonce: z.string().regex(
    /^\d+-[a-zA-Z0-9]+$/,
    'Invalid nonce format'
  ),

  // Pagination
  pagination: z.object({
    page: z.string().transform(Number).pipe(z.number().positive()).default('1'),
    limit: z.string().transform(Number).pipe(z.number().positive().max(100)).default('10')
  })
};

// Request schemas
export const schemas = {
  // Order placement
  placeOrder: z.object({
    body: z.object({
      userId: z.string().uuid(),
      items: z.array(z.object({
        productId: z.string().uuid(),
        quantity: z.number().positive().int()
      })).min(1),
      paymentMethod: z.string().optional(),
      shippingAddress: z.object({
        street: z.string(),
        city: z.string(),
        state: z.string(),
        zipCode: z.string(),
        country: z.string()
      }).optional(),
      billingAddress: z.object({
        street: z.string(),
        city: z.string(),
        state: z.string(),
        zipCode: z.string(),
        country: z.string()
      }).optional(),
      notes: z.string().max(500).optional()
    })
  }),

  // Signed order submission
  submitSignedOrder: z.object({
    body: z.object({
      orderData: z.object({
        orderNumber: z.string(),
        userId: z.string(),
        totalAmount: validators.positiveDecimal,
        currency: z.string(),
        items: z.array(z.object({
          productId: z.string(),
          quantity: z.number().positive(),
          price: validators.positiveDecimal
        })),
        nonce: validators.nonce,
        deadline: z.number().positive(),
        chainId: validators.chainId
      }),
      signature: validators.signature,
      walletAddress: validators.ethereumAddress
    })
  }),

  // Token search
  searchTokens: z.object({
    query: z.object({
      q: z.string().min(1),
      chainId: z.string().transform(Number).pipe(validators.chainId).optional()
    })
  }),

  // Quote request
  requestQuote: z.object({
    body: z.object({
      tokenIn: z.string(),
      tokenOut: z.string(),
      amountIn: validators.positiveDecimal,
      chainId: validators.chainId,
      slippage: z.number().min(0).max(50).optional().default(0.5)
    })
  }),

  // User registration
  register: z.object({
    body: z.object({
      email: z.string().email(),
      password: z.string().min(8).regex(
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/,
        'Password must contain uppercase, lowercase, number and special character'
      ),
      walletAddress: validators.ethereumAddress.optional(),
      firstName: z.string().min(1).max(50).optional(),
      lastName: z.string().min(1).max(50).optional()
    })
  }),

  // Product creation
  createProduct: z.object({
    body: z.object({
      name: z.string().min(1).max(200),
      description: z.string().max(1000).optional(),
      price: validators.positiveDecimal,
      currency: z.string().default('USD'),
      stock: z.number().int().min(0),
      isActive: z.boolean().default(true)
    })
  }),

  // Blog post creation
  createBlogPost: z.object({
    body: z.object({
      title: z.string().min(1).max(200),
      content: z.string().min(1),
      excerpt: z.string().max(500).optional(),
      tags: z.array(z.string()).optional(),
      published: z.boolean().default(false),
      authorId: z.string().uuid()
    })
  })
};

// Sanitization middleware
export const sanitizeInput = (req: Request, res: Response, next: NextFunction) => {
  // Remove any potential XSS attempts
  const sanitize = (obj: any): any => {
    if (typeof obj === 'string') {
      // Basic XSS prevention - in production use a library like DOMPurify
      return obj
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .replace(/\//g, '&#x2F;');
    }
    if (Array.isArray(obj)) {
      return obj.map(sanitize);
    }
    if (obj && typeof obj === 'object') {
      const sanitized: any = {};
      for (const key in obj) {
        sanitized[key] = sanitize(obj[key]);
      }
      return sanitized;
    }
    return obj;
  };

  req.body = sanitize(req.body);
  req.query = sanitize(req.query);
  req.params = sanitize(req.params);

  next();
};