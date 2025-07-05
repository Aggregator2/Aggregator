import { PrismaClient, FeeStructure, MarketMakerTrade, FeeType } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { EventEmitter } from 'events';
import { logger } from '../../../utils/logger';

export interface FeeConfiguration {
  marketMakerId: string;
  feeType: FeeType;
  tierName: string;
  volumeThreshold: Decimal;
  feeBps: number;
  rebateBps?: number;
  flatFee?: Decimal;
  flatRebate?: Decimal;
  validFrom: Date;
  validUntil?: Date;
}

export interface VolumeDiscount {
  tier: string;
  volumeThreshold: Decimal;
  discountBps: number;
}

export interface RebateDistribution {
  marketMakerId: string;
  period: Date;
  totalVolume: Decimal;
  totalFees: Decimal;
  totalRebates: Decimal;
  netFees: Decimal;
  tier: string;
  trades: number;
}

export class FeeRebateService extends EventEmitter {
  private prisma: PrismaClient;
  private volumeTiers: VolumeDiscount[] = [
    { tier: 'BRONZE', volumeThreshold: new Decimal(0), discountBps: 0 },
    { tier: 'SILVER', volumeThreshold: new Decimal(100000), discountBps: 500 }, // 5% discount
    { tier: 'GOLD', volumeThreshold: new Decimal(1000000), discountBps: 1000 }, // 10% discount
    { tier: 'PLATINUM', volumeThreshold: new Decimal(10000000), discountBps: 1500 }, // 15% discount
    { tier: 'DIAMOND', volumeThreshold: new Decimal(50000000), discountBps: 2000 }, // 20% discount
  ];

  constructor() {
    super();
    this.prisma = new PrismaClient();
  }

  async createFeeStructure(config: FeeConfiguration): Promise<FeeStructure> {
    try {
      // Deactivate existing fee structures for this market maker and type
      await this.prisma.feeStructure.updateMany({
        where: {
          marketMakerId: config.marketMakerId,
          feeType: config.feeType,
          isActive: true,
        },
        data: { isActive: false },
      });

      // Create new fee structure
      const feeStructure = await this.prisma.feeStructure.create({
        data: {
          marketMakerId: config.marketMakerId,
          feeType: config.feeType,
          tierName: config.tierName,
          volumeThreshold: config.volumeThreshold,
          feeBps: config.feeBps,
          rebateBps: config.rebateBps,
          flatFee: config.flatFee,
          flatRebate: config.flatRebate,
          priority: await this.getNextPriority(config.marketMakerId),
          isActive: true,
          validFrom: config.validFrom,
          validUntil: config.validUntil,
          metadata: {
            createdAt: new Date().toISOString(),
            volumeTiers: this.volumeTiers,
          },
        },
      });

      this.emit('fee_structure:created', feeStructure);
      return feeStructure;
    } catch (error) {
      logger.error('Error creating fee structure:', error);
      throw error;
    }
  }

  private async getNextPriority(marketMakerId: string): Promise<number> {
    const maxPriority = await this.prisma.feeStructure.aggregate({
      where: { marketMakerId },
      _max: { priority: true },
    });
    return (maxPriority._max.priority || 0) + 1;
  }

  async calculateTradeFees(trade: MarketMakerTrade): Promise<{
    fee: Decimal;
    rebate: Decimal;
    netFee: Decimal;
    appliedTier: string;
  }> {
    const tradeValue = trade.price.mul(trade.size);
    
    // Get market maker's current volume tier
    const volumeTier = await this.getVolumeTier(trade.marketMakerId, trade.executedAt);
    
    // Get applicable fee structure
    const feeStructure = await this.getApplicableFeeStructure(
      trade.marketMakerId,
      trade.side === 'BUY' ? FeeType.TAKER_FEE : FeeType.MAKER_REBATE,
      volumeTier.tier
    );

    if (!feeStructure) {
      return {
        fee: new Decimal(0),
        rebate: new Decimal(0),
        netFee: new Decimal(0),
        appliedTier: 'DEFAULT',
      };
    }

    // Calculate base fee
    const baseFee = tradeValue.mul(feeStructure.feeBps).div(10000);
    const fee = feeStructure.flatFee ? baseFee.add(feeStructure.flatFee) : baseFee;

    // Calculate rebate (for maker orders)
    let rebate = new Decimal(0);
    if (trade.side === 'SELL' && feeStructure.rebateBps) {
      const baseRebate = tradeValue.mul(feeStructure.rebateBps).div(10000);
      rebate = feeStructure.flatRebate ? baseRebate.add(feeStructure.flatRebate) : baseRebate;
    }

    // Apply volume discount
    const discount = fee.mul(volumeTier.discountBps).div(10000);
    const finalFee = fee.sub(discount);

    return {
      fee: finalFee,
      rebate,
      netFee: finalFee.sub(rebate),
      appliedTier: volumeTier.tier,
    };
  }

  private async getVolumeTier(
    marketMakerId: string,
    date: Date
  ): Promise<VolumeDiscount> {
    // Calculate 30-day rolling volume
    const thirtyDaysAgo = new Date(date);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const volumeResult = await this.prisma.MarketMakerTrade.aggregate({
      where: {
        marketMakerId,
        executedAt: {
          gte: thirtyDaysAgo,
          lte: date,
        },
      },
      _sum: {
        quoteAmount: true,
      },
    });

    const totalVolume = volumeResult._sum.quoteAmount || new Decimal(0);

    // Find applicable tier
    let applicableTier = this.volumeTiers[0];
    for (const tier of this.volumeTiers) {
      if (totalVolume.gte(tier.volumeThreshold)) {
        applicableTier = tier;
      }
    }

    return applicableTier;
  }

  private async getApplicableFeeStructure(
    marketMakerId: string,
    feeType: FeeType,
    tierName: string
  ): Promise<FeeStructure | null> {
    return await this.prisma.feeStructure.findFirst({
      where: {
        marketMakerId,
        feeType,
        tierName,
        isActive: true,
        validFrom: { lte: new Date() },
        OR: [
          { validUntil: null },
          { validUntil: { gte: new Date() } },
        ],
      },
      orderBy: { priority: 'desc' },
    });
  }

  async processRebateDistribution(
    marketMakerId: string,
    startDate: Date,
    endDate: Date
  ): Promise<RebateDistribution> {
    try {
      // Get all trades in the period
      const trades = await this.prisma.MarketMakerTrade.findMany({
        where: {
          marketMakerId,
          executedAt: {
            gte: startDate,
            lte: endDate,
          },
        },
      });

      let totalVolume = new Decimal(0);
      let totalFees = new Decimal(0);
      let totalRebates = new Decimal(0);

      // Calculate fees and rebates for each trade
      for (const trade of trades) {
        const { fee, rebate } = await this.calculateTradeFees(trade);
        
        totalVolume = totalVolume.add(trade.price.mul(trade.size));
        totalFees = totalFees.add(fee);
        totalRebates = totalRebates.add(rebate);

        // Update trade with calculated fees
        await this.prisma.MarketMakerTrade.update({
          where: { id: trade.id },
          data: {
            fee,
            rebate,
          },
        });
      }

      const volumeTier = await this.getVolumeTier(marketMakerId, endDate);
      const netFees = totalFees.sub(totalRebates);

      const distribution: RebateDistribution = {
        marketMakerId,
        period: startDate,
        totalVolume,
        totalFees,
        totalRebates,
        netFees,
        tier: volumeTier.tier,
        trades: trades.length,
      };

      // Record the distribution
      await this.recordRebateDistribution(distribution);
      
      this.emit('rebate:distributed', distribution);
      return distribution;
    } catch (error) {
      logger.error(`Error processing rebate distribution for ${marketMakerId}:`, error);
      throw error;
    }
  }

  private async recordRebateDistribution(distribution: RebateDistribution): Promise<void> {
    // Store rebate distribution in the database
    await this.prisma.InventoryEvent.create({
      data: {
        marketMakerId: distribution.marketMakerId,
        eventType: 'REBATE',
        currency: 'USDT', // Assuming rebates are in USDT
        amount: distribution.totalRebates,
        balanceBefore: new Decimal(0), // Would need to fetch actual balance
        balanceAfter: distribution.totalRebates,
        description: `Rebate distribution for period ${distribution.period.toISOString()}`,
        metadata: {
          distribution,
        },
      },
    });
  }

  async getFeeSchedule(marketMakerId: string): Promise<{
    currentTier: string;
    volumeLast30Days: Decimal;
    feeStructures: FeeStructure[];
    volumeTiers: VolumeDiscount[];
  }> {
    const volumeTier = await this.getVolumeTier(marketMakerId, new Date());
    
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const volumeResult = await this.prisma.MarketMakerTrade.aggregate({
      where: {
        marketMakerId,
        executedAt: { gte: thirtyDaysAgo },
      },
      _sum: { quoteAmount: true },
    });

    const feeStructures = await this.prisma.feeStructure.findMany({
      where: {
        marketMakerId,
        isActive: true,
      },
      orderBy: { priority: 'desc' },
    });

    return {
      currentTier: volumeTier.tier,
      volumeLast30Days: volumeResult._sum.quoteAmount || new Decimal(0),
      feeStructures,
      volumeTiers: this.volumeTiers,
    };
  }

  async simulateFeeImpact(
    marketMakerId: string,
    tradeSize: Decimal,
    tradePrice: Decimal,
    side: 'BUY' | 'SELL'
  ): Promise<{
    estimatedFee: Decimal;
    estimatedRebate: Decimal;
    netCost: Decimal;
    effectivePrice: Decimal;
    appliedTier: string;
  }> {
    const mockTrade: Partial<MarketMakerTrade> = {
      marketMakerId,
      size: tradeSize,
      price: tradePrice,
      side,
      executedAt: new Date(),
    };

    const { fee, rebate, appliedTier } = await this.calculateTradeFees(mockTrade as MarketMakerTrade);
    const netCost = fee.sub(rebate);
    const totalCost = tradePrice.mul(tradeSize).add(netCost);
    const effectivePrice = totalCost.div(tradeSize);

    return {
      estimatedFee: fee,
      estimatedRebate: rebate,
      netCost,
      effectivePrice,
      appliedTier,
    };
  }
}