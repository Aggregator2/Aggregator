import { PrismaClient, MarketMaker, MarketMakerStatus } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcrypt';
import { logger } from '../../../utils/logger';
import { generateApiKey } from '../../../utils/crypto';

export interface MarketMakerApplication {
  name: string;
  email: string;
  companyName: string;
  websocketUrl?: string;
  webhookUrl?: string;
  supportedPairs: string[];
  minQuoteSize?: string;
  maxQuoteSize?: string;
  quoteExpiry?: number;
  settlementAddress?: string;
  metadata?: {
    contactPerson?: string;
    phoneNumber?: string;
    tradingVolume?: string;
    supportsPrivateFlow?: boolean;
    apiDocumentationUrl?: string;
  };
}

export interface OnboardingSteps {
  applicationSubmitted: boolean;
  kycCompleted: boolean;
  technicalIntegrationTested: boolean;
  contractsSigned: boolean;
  approved: boolean;
}

export class MarketMakerOnboardingService {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
  }

  async submitApplication(application: MarketMakerApplication): Promise<{
    marketMaker: MarketMaker;
    apiKey: string;
    onboardingSteps: OnboardingSteps;
  }> {
    try {
      // Generate unique code and API credentials
      const code = this.generateMarketMakerCode(application.companyName);
      const apiKey = generateApiKey();
      const apiSecret = await bcrypt.hash(uuidv4(), 10);

      // Create market maker with pending status
      const marketMaker = await this.prisma.MarketMaker.create({
        data: {
          name: application.name,
          code,
          status: MarketMakerStatus.PENDING,
          apiKey,
          apiSecret,
          websocketUrl: application.websocketUrl,
          webhookUrl: application.webhookUrl,
          supportedPairs: application.supportedPairs,
          minQuoteSize: application.minQuoteSize ? parseFloat(application.minQuoteSize) : 0,
          maxQuoteSize: application.maxQuoteSize ? parseFloat(application.maxQuoteSize) : 1000000,
          quoteExpiry: application.quoteExpiry || 30000,
          settlementAddress: application.settlementAddress,
          metadata: {
            ...application.metadata,
            email: application.email,
            companyName: application.companyName,
            onboardingSteps: {
              applicationSubmitted: true,
              kycCompleted: false,
              technicalIntegrationTested: false,
              contractsSigned: false,
              approved: false,
            },
            applicationDate: new Date(),
          },
          isActive: false,
        },
      });

      // Create default fee structure
      await this.createDefaultFeeStructure(marketMaker.id);

      // Send welcome email (placeholder)
      await this.sendWelcomeEmail(application.email, marketMaker.name, apiKey);

      logger.info(`Market maker application submitted: ${marketMaker.id}`);

      return {
        marketMaker,
        apiKey,
        onboardingSteps: {
          applicationSubmitted: true,
          kycCompleted: false,
          technicalIntegrationTested: false,
          contractsSigned: false,
          approved: false,
        },
      };
    } catch (error) {
      logger.error('Error submitting market maker application:', error);
      throw error;
    }
  }

  private generateMarketMakerCode(companyName: string): string {
    const prefix = companyName
      .toUpperCase()
      .replace(/[^A-Z]/g, '')
      .substring(0, 3);
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    return `${prefix}${random}`;
  }

  async updateOnboardingStep(
    marketMakerId: string,
    step: keyof OnboardingSteps,
    completed: boolean
  ): Promise<MarketMaker> {
    const marketMaker = await this.prisma.MarketMaker.findUnique({
      where: { id: marketMakerId },
    });

    if (!marketMaker) {
      throw new Error('Market maker not found');
    }

    const metadata = marketMaker.metadata as any;
    const onboardingSteps = metadata.onboardingSteps || {};
    onboardingSteps[step] = completed;

    // Check if all steps are completed
    const allStepsCompleted = Object.values(onboardingSteps).every(v => v === true);

    const updatedMarketMaker = await this.prisma.MarketMaker.update({
      where: { id: marketMakerId },
      data: {
        metadata: {
          ...metadata,
          onboardingSteps,
        },
        status: allStepsCompleted ? MarketMakerStatus.ACTIVE : marketMaker.status,
        isActive: allStepsCompleted,
      },
    });

    if (allStepsCompleted) {
      await this.onboardingComplete(marketMakerId);
    }

    return updatedMarketMaker;
  }

  async testTechnicalIntegration(marketMakerId: string): Promise<{
    websocketTest: boolean;
    webhookTest: boolean;
    quoteTest: boolean;
    errors: string[];
  }> {
    const marketMaker = await this.prisma.MarketMaker.findUnique({
      where: { id: marketMakerId },
    });

    if (!marketMaker) {
      throw new Error('Market maker not found');
    }

    const errors: string[] = [];
    let websocketTest = false;
    let webhookTest = false;
    let quoteTest = false;

    // Test WebSocket connection
    if (marketMaker.websocketUrl) {
      try {
        // Placeholder for actual WebSocket test
        websocketTest = true;
        logger.info(`WebSocket test passed for ${marketMaker.name}`);
      } catch (error) {
        errors.push('WebSocket connection failed');
        logger.error(`WebSocket test failed for ${marketMaker.name}:`, error);
      }
    }

    // Test webhook endpoint
    if (marketMaker.webhookUrl) {
      try {
        // Placeholder for actual webhook test
        webhookTest = true;
        logger.info(`Webhook test passed for ${marketMaker.name}`);
      } catch (error) {
        errors.push('Webhook endpoint unreachable');
        logger.error(`Webhook test failed for ${marketMaker.name}:`, error);
      }
    }

    // Test quote generation
    try {
      // Placeholder for actual quote test
      quoteTest = true;
      logger.info(`Quote test passed for ${marketMaker.name}`);
    } catch (error) {
      errors.push('Quote generation failed');
      logger.error(`Quote test failed for ${marketMaker.name}:`, error);
    }

    const allTestsPassed = websocketTest && webhookTest && quoteTest;

    if (allTestsPassed) {
      await this.updateOnboardingStep(marketMakerId, 'technicalIntegrationTested', true);
    }

    return {
      websocketTest,
      webhookTest,
      quoteTest,
      errors,
    };
  }

  async generateApiCredentials(marketMakerId: string): Promise<{
    apiKey: string;
    apiSecret: string;
  }> {
    const newApiKey = generateApiKey();
    const newApiSecret = uuidv4();
    const hashedApiSecret = await bcrypt.hash(newApiSecret, 10);

    await this.prisma.MarketMaker.update({
      where: { id: marketMakerId },
      data: {
        apiKey: newApiKey,
        apiSecret: hashedApiSecret,
      },
    });

    return {
      apiKey: newApiKey,
      apiSecret: newApiSecret,
    };
  }

  async updateSupportedPairs(
    marketMakerId: string,
    pairs: Array<{
      baseCurrency: string;
      quoteCurrency: string;
      minSize?: string;
      maxSize?: string;
      spreadBps?: number;
    }>
  ): Promise<void> {
    // Remove existing pairs
    await this.prisma.MarketMakerPair.deleteMany({
      where: { marketMakerId },
    });

    // Add new pairs
    const pairData = pairs.map(pair => ({
      marketMakerId,
      baseCurrency: pair.baseCurrency,
      quoteCurrency: pair.quoteCurrency,
      minSize: pair.minSize ? parseFloat(pair.minSize) : 0.001,
      maxSize: pair.maxSize ? parseFloat(pair.maxSize) : 10000,
      spreadBps: pair.spreadBps || 10,
      isActive: true,
    }));

    await this.prisma.MarketMakerPair.createMany({
      data: pairData,
    });

    // Update supported pairs list
    const supportedPairs = pairs.map(p => `${p.baseCurrency}/${p.quoteCurrency}`);
    await this.prisma.MarketMaker.update({
      where: { id: marketMakerId },
      data: { supportedPairs },
    });
  }

  private async createDefaultFeeStructure(marketMakerId: string): Promise<void> {
    await this.prisma.feeStructure.createMany({
      data: [
        {
          marketMakerId,
          tierName: 'Default Maker Rebate',
          feeType: 'MAKER_REBATE',
          minVolume: 0,
          feeBps: -5, // 0.05% rebate
          isActive: true,
          priority: 1,
        },
        {
          marketMakerId,
          tierName: 'Default Taker Fee',
          feeType: 'TAKER_FEE',
          minVolume: 0,
          feeBps: 10, // 0.10% fee
          isActive: true,
          priority: 1,
        },
      ],
    });
  }

  private async onboardingComplete(marketMakerId: string): Promise<void> {
    const marketMaker = await this.prisma.MarketMaker.findUnique({
      where: { id: marketMakerId },
    });

    if (!marketMaker) {
      return;
    }

    // Initialize inventory for supported currencies
    const currencies = new Set<string>();
    marketMaker.supportedPairs.forEach(pair => {
      const [base, quote] = pair.split('/');
      currencies.add(base);
      currencies.add(quote);
    });

    const inventoryData = Array.from(currencies).map(currency => ({
      marketMakerId,
      currency,
      balance: 0,
      available: 0,
      locked: 0,
    }));

    await this.prisma.MarketMakerInventory.createMany({
      data: inventoryData,
      skipDuplicates: true,
    });

    // Send activation email (placeholder)
    const metadata = marketMaker.metadata as any;
    if (metadata.email) {
      await this.sendActivationEmail(metadata.email, marketMaker.name);
    }

    logger.info(`Market maker onboarding completed: ${marketMaker.name}`);
  }

  private async sendWelcomeEmail(email: string, name: string, apiKey: string): Promise<void> {
    // Placeholder for email sending
    logger.info(`Welcome email sent to ${email} for ${name}`);
  }

  private async sendActivationEmail(email: string, name: string): Promise<void> {
    // Placeholder for email sending
    logger.info(`Activation email sent to ${email} for ${name}`);
  }

  async getOnboardingStatus(marketMakerId: string): Promise<{
    marketMaker: MarketMaker;
    onboardingSteps: OnboardingSteps;
    progress: number;
  }> {
    const marketMaker = await this.prisma.MarketMaker.findUnique({
      where: { id: marketMakerId },
    });

    if (!marketMaker) {
      throw new Error('Market maker not found');
    }

    const metadata = marketMaker.metadata as any;
    const onboardingSteps = metadata.onboardingSteps || {
      applicationSubmitted: false,
      kycCompleted: false,
      technicalIntegrationTested: false,
      contractsSigned: false,
      approved: false,
    };

    const completedSteps = Object.values(onboardingSteps).filter(v => v === true).length;
    const totalSteps = Object.keys(onboardingSteps).length;
    const progress = (completedSteps / totalSteps) * 100;

    return {
      marketMaker,
      onboardingSteps,
      progress,
    };
  }
}