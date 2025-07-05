import { PrismaClient, MarketMaker } from '@prisma/client';
import { MarketMakerConnector } from '../../liquidity-aggregator/MarketMakerConnector';
import { logger } from '../../../utils/logger';

export class MarketMakerConnectorManager {
  private connectors: Map<string, MarketMakerConnector> = new Map();
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async getConnector(marketMakerId: string): Promise<MarketMakerConnector | null> {
    // Check if connector already exists
    if (this.connectors.has(marketMakerId)) {
      return this.connectors.get(marketMakerId)!;
    }

    // Get market maker details
    const marketMaker = await this.prisma.MarketMaker.findUnique({
      where: { id: marketMakerId },
    });

    if (!marketMaker || !marketMaker.isActive) {
      return null;
    }

    // Create new connector
    try {
      const connector = await this.createConnector(marketMaker);
      this.connectors.set(marketMakerId, connector);
      return connector;
    } catch (error) {
      logger.error(`Failed to create connector for MM ${marketMakerId}:`, error);
      return null;
    }
  }

  private async createConnector(marketMaker: MarketMaker): Promise<MarketMakerConnector> {
    const config = {
      name: marketMaker.name,
      websocketUrl: marketMaker.websocketUrl || '',
      apiKey: marketMaker.apiKey,
      apiSecret: marketMaker.apiSecret,
      supportedPairs: marketMaker.supportedPairs,
    };

    const connector = new MarketMakerConnector(config);
    
    // Set up event handlers
    connector.on('quote', (quote) => {
      logger.debug(`Received quote from ${marketMaker.name}:`, quote);
    });

    connector.on('error', (error) => {
      logger.error(`Connector error for ${marketMaker.name}:`, error);
    });

    connector.on('disconnected', () => {
      logger.warn(`Connector disconnected for ${marketMaker.name}`);
      this.connectors.delete(marketMaker.id);
    });

    // Connect
    await connector.connect();
    
    return connector;
  }

  async disconnectAll(): Promise<void> {
    const disconnectPromises = Array.from(this.connectors.values()).map(
      connector => connector.disconnect()
    );
    await Promise.all(disconnectPromises);
    this.connectors.clear();
  }

  async cleanup(): Promise<void> {
    await this.disconnectAll();
  }

  getActiveConnectors(): number {
    return this.connectors.size;
  }

  isConnected(marketMakerId: string): boolean {
    const connector = this.connectors.get(marketMakerId);
    return connector ? connector.isConnected() : false;
  }
}