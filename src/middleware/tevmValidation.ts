import { NextApiRequest, NextApiResponse } from 'next';
import { tevmValidator } from '../services/tevmValidationService';

export interface ValidatedRequest extends NextApiRequest {
  validationResult?: {
    isValid: boolean;
    reason?: string;
    gasEstimate?: string;
  };
}

/**
 * Middleware to validate orders using TEVM before processing
 */
export function withTevmValidation(
  handler: (req: ValidatedRequest, res: NextApiResponse) => Promise<void>
) {
  return async (req: ValidatedRequest, res: NextApiResponse) => {
    // Only validate POST requests with order data
    if (req.method === 'POST' && req.body?.order) {
      try {
        // Initialize TEVM if needed
        await tevmValidator.initialize();

        // Validate the order
        const validationResult = await tevmValidator.validateOrder(req.body.order);

        // Attach validation result to request
        req.validationResult = {
          isValid: validationResult.isValid,
          reason: validationResult.reason,
          gasEstimate: validationResult.gasEstimate?.toString(),
        };

        // If validation fails, return error response
        if (!validationResult.isValid) {
          return res.status(400).json({
            error: 'Order validation failed',
            reason: validationResult.reason,
            validationDetails: req.validationResult,
          });
        }
      } catch (error) {
        console.error('TEVM validation middleware error:', error);
        // Log error but don't block the request
        req.validationResult = {
          isValid: false,
          reason: 'Validation service error',
        };
      }
    }

    // Continue to handler
    return handler(req, res);
  };
}

/**
 * Standalone validation endpoint for pre-flight checks
 */
export async function validateOrderEndpoint(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { order } = req.body;

    if (!order) {
      return res.status(400).json({ error: 'Missing order data' });
    }

    // Initialize TEVM
    await tevmValidator.initialize();

    // Validate order
    const validationResult = await tevmValidator.validateOrder(order);

    // Get gas estimate if valid
    let gasEstimate = null;
    if (validationResult.isValid) {
      gasEstimate = await tevmValidator.estimateOrderGas(order);
    }

    return res.status(200).json({
      isValid: validationResult.isValid,
      reason: validationResult.reason,
      gasEstimate: gasEstimate?.toString(),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Validation endpoint error:', error);
    return res.status(500).json({
      error: 'Validation failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}