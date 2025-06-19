import type { NextApiRequest, NextApiResponse } from 'next';
import { tokenListManager } from '../../../src/services/tokenListManager';
import { TOKEN_LIST_SOURCES } from '../../../src/config/tokens/tokenLists';
import { SUPPORTED_CHAINS } from '../../../src/types/token';
import { logger } from '../../../src/utils/logger';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method === 'GET') {
    return handleGetLists(req, res);
  } else if (req.method === 'POST') {
    return handleSyncLists(req, res);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}

async function handleGetLists(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { chainId, includeTokens } = req.query;

    if (chainId) {
      const chainIdNum = parseInt(chainId as string);
      
      if (!SUPPORTED_CHAINS[chainIdNum]) {
        return res.status(400).json({ error: 'Unsupported chain ID' });
      }

      const tokens = await tokenListManager.getTokensByChain(
        chainIdNum,
        includeTokens === 'true' ? 100 : 0
      );

      const relevantSources = TOKEN_LIST_SOURCES.filter(source => 
        source.chainIds.includes(chainIdNum)
      );

      return res.status(200).json({
        chainId: chainIdNum,
        chainName: SUPPORTED_CHAINS[chainIdNum].name,
        sources: relevantSources.map(source => ({
          name: source.name,
          description: source.description,
          priority: source.priority,
          updateFrequency: source.updateFrequency
        })),
        tokenCount: tokens.length,
        ...(includeTokens === 'true' && { tokens })
      });
    }

    // Return information about all token lists
    const listInfo = TOKEN_LIST_SOURCES.map(source => ({
      name: source.name,
      description: source.description,
      supportedChains: source.chainIds.map(id => ({
        chainId: id,
        chainName: SUPPORTED_CHAINS[id]?.name || 'Unknown'
      })),
      priority: source.priority,
      updateFrequency: source.updateFrequency,
      url: source.url
    }));

    const stats = {
      totalSources: TOKEN_LIST_SOURCES.length,
      sourcesByPriority: {
        high: TOKEN_LIST_SOURCES.filter(s => s.priority >= 90).length,
        medium: TOKEN_LIST_SOURCES.filter(s => s.priority >= 70 && s.priority < 90).length,
        low: TOKEN_LIST_SOURCES.filter(s => s.priority < 70).length
      },
      supportedChains: Object.keys(SUPPORTED_CHAINS).length
    };

    res.status(200).json({
      sources: listInfo,
      stats
    });
  } catch (error) {
    logger.error('Error fetching token lists:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleSyncLists(req: NextApiRequest, res: NextApiResponse) {
  try {
    // This endpoint should be protected in production
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { sources, chainIds } = req.body;

    if (sources && Array.isArray(sources)) {
      // Sync specific sources
      const sourcesToSync = TOKEN_LIST_SOURCES.filter(source =>
        sources.includes(source.name)
      );

      if (sourcesToSync.length === 0) {
        return res.status(400).json({ error: 'No valid sources specified' });
      }

      logger.info(`Manual sync requested for sources: ${sources.join(', ')}`);
      
      // This would trigger the sync in the background
      // In production, you might want to use a job queue
      tokenListManager.fetchAllTokenLists().catch(error => {
        logger.error('Background sync failed:', error);
      });

      return res.status(200).json({
        message: 'Token list sync started',
        sources: sourcesToSync.map(s => s.name),
        status: 'in_progress'
      });
    }

    if (chainIds && Array.isArray(chainIds)) {
      // Sync specific chains
      const validChainIds = chainIds.filter(id => SUPPORTED_CHAINS[id]);
      
      if (validChainIds.length === 0) {
        return res.status(400).json({ error: 'No valid chain IDs specified' });
      }

      logger.info(`Manual sync requested for chains: ${validChainIds.join(', ')}`);

      // Sync tokens for specific chains
      for (const chainId of validChainIds) {
        tokenListManager.fetchTokensFromChainAPI(chainId).catch(error => {
          logger.error(`Failed to sync chain ${chainId}:`, error);
        });
      }

      return res.status(200).json({
        message: 'Chain-specific sync started',
        chainIds: validChainIds,
        status: 'in_progress'
      });
    }

    // Full sync
    logger.info('Full token list sync requested');
    tokenListManager.fetchAllTokenLists().catch(error => {
      logger.error('Full sync failed:', error);
    });

    res.status(200).json({
      message: 'Full token list sync started',
      status: 'in_progress',
      estimatedDuration: '2-5 minutes'
    });
  } catch (error) {
    logger.error('Error syncing token lists:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}