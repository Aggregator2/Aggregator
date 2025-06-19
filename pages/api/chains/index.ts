import type { NextApiRequest, NextApiResponse } from 'next';
import { SUPPORTED_CHAINS } from '../../../src/types/token';
import { getPopularTokensForChain } from '../../../src/config/tokens/popularTokens';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { includeTokens } = req.query;
    
    const chains = Object.entries(SUPPORTED_CHAINS).map(([chainIdStr, config]) => {
      const chainId = parseInt(chainIdStr);
      const popularTokens = getPopularTokensForChain(chainId);
      
      return {
        chainId,
        name: config.name,
        nativeCurrency: config.nativeCurrency,
        blockExplorer: config.blockExplorer,
        type: config.type,
        popularTokenCount: popularTokens.length,
        ...(includeTokens === 'true' && {
          popularTokens: popularTokens.slice(0, 5) // Include top 5 popular tokens
        })
      };
    });

    // Sort by chain type and then by name
    const sortedChains = chains.sort((a, b) => {
      const typeOrder = ['EVM', 'SOLANA', 'COSMOS', 'TRON', 'ALGORAND', 'STELLAR', 'CARDANO', 'TEZOS'];
      const aTypeIndex = typeOrder.indexOf(a.type);
      const bTypeIndex = typeOrder.indexOf(b.type);
      
      if (aTypeIndex !== bTypeIndex) {
        return aTypeIndex - bTypeIndex;
      }
      
      return a.name.localeCompare(b.name);
    });

    return res.status(200).json({
      totalChains: sortedChains.length,
      chains: sortedChains,
      chainTypes: {
        EVM: sortedChains.filter(c => c.type === 'EVM').length,
        SOLANA: sortedChains.filter(c => c.type === 'SOLANA').length,
        COSMOS: sortedChains.filter(c => c.type === 'COSMOS').length,
        TRON: sortedChains.filter(c => c.type === 'TRON').length,
        ALGORAND: sortedChains.filter(c => c.type === 'ALGORAND').length,
        STELLAR: sortedChains.filter(c => c.type === 'STELLAR').length,
        CARDANO: sortedChains.filter(c => c.type === 'CARDANO').length,
        TEZOS: sortedChains.filter(c => c.type === 'TEZOS').length
      }
    });
  } catch (error) {
    console.error('Error fetching chains:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}