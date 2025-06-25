import { NextApiRequest, NextApiResponse } from 'next';
import { ethers } from 'ethers';
import { tevmValidator } from '../../src/services/tevmValidationService';
import { orderStore } from '../../utils/orderStore';

// EIP-712 Domain
const EIP712_DOMAIN = {
  name: 'SwappiQ',
  version: '1',
  chainId: 31337,
  verifyingContract: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
};

const EIP712_TYPES = {
  Order: [
    { name: 'sellToken', type: 'address' },
    { name: 'buyToken', type: 'address' },
    { name: 'sellAmount', type: 'uint256' },
    { name: 'buyAmount', type: 'uint256' },
    { name: 'validTo', type: 'uint32' },
    { name: 'appData', type: 'bytes32' },
    { name: 'feeAmount', type: 'uint256' },
    { name: 'kind', type: 'string' },
    { name: 'partiallyFillable', type: 'bool' },
    { name: 'receiver', type: 'address' },
    { name: 'user', type: 'address' },
    { name: 'signingScheme', type: 'string' },
    { name: 'nonce', type: 'uint256' },
    { name: 'wallet', type: 'address' },
  ],
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { order, signature } = req.body;

    // Basic validation
    if (!order || !signature) {
      return res.status(400).json({ error: 'Missing order or signature' });
    }

    // Validate required fields
    const requiredFields = [
      'sellToken',
      'buyToken',
      'sellAmount',
      'buyAmount',
      'validTo',
      'user',
      'wallet',
      'signingScheme',
    ];

    for (const field of requiredFields) {
      if (!order[field]) {
        return res.status(400).json({ error: `Missing required field: ${field}` });
      }
    }

    // Check if order is expired
    const currentTime = Math.floor(Date.now() / 1000);
    if (order.validTo < currentTime) {
      return res.status(400).json({ error: 'Order expired' });
    }

    // Validate token addresses
    if (!ethers.isAddress(order.sellToken) || !ethers.isAddress(order.buyToken)) {
      return res.status(400).json({ error: 'Invalid token address' });
    }

    // Verify EIP-712 signature
    try {
      const recoveredAddress = ethers.verifyTypedData(
        EIP712_DOMAIN,
        EIP712_TYPES,
        order,
        signature
      );

      if (recoveredAddress.toLowerCase() !== order.user.toLowerCase()) {
        return res.status(400).json({ error: 'Signature verification failed' });
      }
    } catch (error) {
      console.error('Signature verification error:', error);
      return res.status(400).json({ error: 'Invalid signature format' });
    }

    // Initialize TEVM validator if not already done
    await tevmValidator.initialize();

    // Perform TEVM validation
    console.log('Performing TEVM validation for order:', order.user);
    
    const validationResult = await tevmValidator.validateOrder(order);
    
    if (!validationResult.isValid) {
      console.log('TEVM validation failed:', validationResult.reason);
      
      // Log validation failure to notifications
      return res.status(400).json({
        error: 'Order validation failed',
        reason: validationResult.reason,
        details: {
          type: 'validation_error',
          message: validationResult.reason,
        },
      });
    }

    // Estimate gas if validation passed
    const gasEstimate = await tevmValidator.estimateOrderGas(order);
    
    // Generate order ID
    const orderId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Store order with validation metadata
    const orderWithMetadata = {
      ...order,
      id: orderId,
      status: 'pending',
      timestamp: new Date().toISOString(),
      signature,
      validationPassed: true,
      estimatedGas: gasEstimate?.toString(),
    };

    orderStore.set(orderId, orderWithMetadata);

    // Simulate order execution in background
    setTimeout(async () => {
      try {
        // Simulate different outcomes
        const rand = Math.random();
        let newStatus: string;
        let txHash: string | undefined;

        if (rand < 0.7) {
          // 70% success rate
          newStatus = 'filled';
          txHash = `0x${Math.random().toString(16).substr(2, 64)}`;
        } else if (rand < 0.9) {
          // 20% failure rate
          newStatus = 'failed';
        } else {
          // 10% timeout
          newStatus = 'timeout';
        }

        const updatedOrder = {
          ...orderWithMetadata,
          status: newStatus,
          ...(txHash && { txHash }),
          completedAt: new Date().toISOString(),
        };

        orderStore.set(orderId, updatedOrder);
        console.log(`Order ${orderId} ${newStatus}`);
      } catch (error) {
        console.error('Order execution error:', error);
      }
    }, 1000); // 1 second delay for immediate processing

    // Return success response
    res.status(200).json({
      orderId,
      status: 'pending',
      message: 'Order submitted successfully',
      gasEstimate: gasEstimate?.toString(),
      validationDetails: {
        balanceChecked: true,
        approvalChecked: order.sellToken !== ethers.ZeroAddress,
        simulationPassed: true,
      },
    });
  } catch (error) {
    console.error('Order submission error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}