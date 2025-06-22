import type { NextApiRequest, NextApiResponse } from 'next';
import { CrossChainTokenResolver } from '../../../src/services/crossChainTokenResolver';
import { ethers } from 'ethers';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { tokenAddress, sourceChainId, targetChainId } = req.body;

    // Validate inputs
    if (!tokenAddress || !sourceChainId) {
      return res.status(400).json({ 
        error: 'Missing required parameters: tokenAddress, sourceChainId' 
      });
    }

    // Validate address format (skip for native token)
    if (tokenAddress.toLowerCase() !== '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' &&
        tokenAddress.toLowerCase() !== '0x0000000000000000000000000000000000000000' &&
        !ethers.isAddress(tokenAddress)) {
      return res.status(400).json({ 
        error: 'Invalid token address format' 
      });
    }

    // If targetChainId is provided, resolve the token on that chain
    if (targetChainId) {
      const resolvedAddress = await CrossChainTokenResolver.resolveTokenAddress(
        tokenAddress,
        sourceChainId,
        targetChainId
      );

      if (resolvedAddress) {
        const tokenInfo = await CrossChainTokenResolver.getTokenInfo(resolvedAddress, targetChainId);
        return res.status(200).json({
          available: true,
          sourceAddress: tokenAddress,
          targetAddress: resolvedAddress,
          targetChainId,
          tokenInfo
        });
      } else {
        return res.status(200).json({
          available: false,
          sourceAddress: tokenAddress,
          targetChainId,
          message: `Token not available on chain ${targetChainId}`
        });
      }
    } else {
      // Get all available chains for this token
      const tokenInfo = await CrossChainTokenResolver.getTokenInfo(tokenAddress, sourceChainId);
      const availableChains = await CrossChainTokenResolver.getAvailableChains(tokenAddress);

      return res.status(200).json({
        tokenAddress,
        sourceChainId,
        tokenInfo,
        availableChains,
        totalChains: availableChains.length
      });
    }
  } catch (error: any) {
    console.error('Error checking token availability:', error);
    return res.status(500).json({ 
      error: 'Failed to check token availability',
      details: error.message
    });
  }
}