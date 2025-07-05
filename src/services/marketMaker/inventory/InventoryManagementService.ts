import { PrismaClient, MarketMakerInventory, InventoryEvent, InventoryEventType } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { EventEmitter } from 'events';
import { logger } from '../../../utils/logger';

export interface InventoryUpdate {
  marketMakerId: string;
  currency: string;
  amount: string;
  eventType: InventoryEventType;
  referenceId?: string;
  referenceType?: string;
  description?: string;
}

export interface InventoryAlert {
  type: 'LOW_BALANCE' | 'HIGH_EXPOSURE' | 'IMBALANCE';
  marketMakerId: string;
  currency: string;
  currentBalance: Decimal;
  threshold: Decimal;
  message: string;
}

export interface InventorySnapshot {
  marketMakerId: string;
  timestamp: Date;
  balances: Array<{
    currency: string;
    balance: Decimal;
    available: Decimal;
    locked: Decimal;
    usdValue?: Decimal;
  }>;
  totalUsdValue: Decimal;
}

export interface ReconciliationResult {
  marketMakerId: string;
  currency: string;
  systemBalance: Decimal;
  externalBalance: Decimal;
  discrepancy: Decimal;
  isReconciled: boolean;
  timestamp: Date;
  adjustmentRequired: boolean;
}

export interface ReconciliationReport {
  marketMakerId: string;
  reconciliationDate: Date;
  totalCurrencies: number;
  reconciledCount: number;
  discrepancyCount: number;
  totalDiscrepancyValue: Decimal;
  details: ReconciliationResult[];
}

export class InventoryManagementService extends EventEmitter {
  private prisma: PrismaClient;
  private alertThresholds: Map<string, { low: Decimal; high: Decimal }> = new Map();
  private reconciliationTolerance = new Decimal(0.01); // 1 cent tolerance

  constructor() {
    super();
    this.prisma = new PrismaClient();
    this.initializeDefaultThresholds();
  }

  private initializeDefaultThresholds(): void {
    // Default thresholds for common currencies
    this.alertThresholds.set('BTC', { low: new Decimal(0.1), high: new Decimal(100) });
    this.alertThresholds.set('ETH', { low: new Decimal(1), high: new Decimal(1000) });
    this.alertThresholds.set('USDT', { low: new Decimal(1000), high: new Decimal(10000000) });
    this.alertThresholds.set('USDC', { low: new Decimal(1000), high: new Decimal(10000000) });
  }

  async updateBalance(update: InventoryUpdate): Promise<MarketMakerInventory> {
    const amount = new Decimal(update.amount);
    
    // Get or create inventory record
    let inventory = await this.prisma.MarketMakerInventory.findUnique({
      where: {
        marketMakerId_currency: {
          marketMakerId: update.marketMakerId,
          currency: update.currency,
        },
      },
    });

    if (!inventory) {
      inventory = await this.prisma.MarketMakerInventory.create({
        data: {
          marketMakerId: update.marketMakerId,
          currency: update.currency,
          balance: new Decimal(0),
          available: new Decimal(0),
          locked: new Decimal(0),
        },
      });
    }

    const balanceBefore = inventory.balance;
    let balanceAfter = balanceBefore;
    let availableAfter = inventory.available;
    let lockedAfter = inventory.locked;

    // Update balance based on event type
    switch (update.eventType) {
      case 'DEPOSIT':
        balanceAfter = balanceBefore.add(amount);
        availableAfter = availableAfter.add(amount);
        break;
      
      case 'WITHDRAWAL':
        if (availableAfter.lt(amount)) {
          throw new Error('Insufficient available balance');
        }
        balanceAfter = balanceBefore.sub(amount);
        availableAfter = availableAfter.sub(amount);
        break;
      
      case 'TRADE_BUY':
        balanceAfter = balanceBefore.add(amount);
        availableAfter = availableAfter.add(amount);
        break;
      
      case 'TRADE_SELL':
        if (availableAfter.lt(amount)) {
          throw new Error('Insufficient available balance for trade');
        }
        balanceAfter = balanceBefore.sub(amount);
        availableAfter = availableAfter.sub(amount);
        break;
      
      case 'FEE':
        balanceAfter = balanceBefore.sub(amount);
        availableAfter = availableAfter.sub(amount);
        break;
      
      case 'REBATE':
        balanceAfter = balanceBefore.add(amount);
        availableAfter = availableAfter.add(amount);
        break;
      
      case 'ADJUSTMENT':
        balanceAfter = balanceBefore.add(amount); // Can be negative
        availableAfter = availableAfter.add(amount);
        break;
    }

    // Update inventory
    const updatedInventory = await this.prisma.MarketMakerInventory.update({
      where: { id: inventory.id },
      data: {
        balance: balanceAfter,
        available: availableAfter,
        locked: lockedAfter,
        lastUpdated: new Date(),
      },
    });

    // Create inventory event
    await this.prisma.InventoryEvent.create({
      data: {
        inventoryId: inventory.id,
        marketMakerId: update.marketMakerId,
        eventType: update.eventType,
        currency: update.currency,
        amount,
        balanceBefore,
        balanceAfter,
        referenceId: update.referenceId,
        referenceType: update.referenceType,
        description: update.description,
      },
    });

    // Check for alerts
    await this.checkAlerts(update.marketMakerId, update.currency, balanceAfter);

    // Emit balance update event
    this.emit('inventory:updated', {
      marketMakerId: update.marketMakerId,
      currency: update.currency,
      balanceBefore: balanceBefore.toString(),
      balanceAfter: balanceAfter.toString(),
      eventType: update.eventType,
    });

    return updatedInventory;
  }

  async lockFunds(
    marketMakerId: string,
    currency: string,
    amount: string
  ): Promise<void> {
    const lockAmount = new Decimal(amount);

    const inventory = await this.prisma.MarketMakerInventory.findUnique({
      where: {
        marketMakerId_currency: {
          marketMakerId,
          currency,
        },
      },
    });

    if (!inventory) {
      throw new Error('Inventory not found');
    }

    if (inventory.available.lt(lockAmount)) {
      throw new Error('Insufficient available balance to lock');
    }

    await this.prisma.MarketMakerInventory.update({
      where: { id: inventory.id },
      data: {
        available: inventory.available.sub(lockAmount),
        locked: inventory.locked.add(lockAmount),
      },
    });

    logger.info(
      `Locked ${lockAmount} ${currency} for market maker ${marketMakerId}`
    );
  }

  async unlockFunds(
    marketMakerId: string,
    currency: string,
    amount: string
  ): Promise<void> {
    const unlockAmount = new Decimal(amount);

    const inventory = await this.prisma.MarketMakerInventory.findUnique({
      where: {
        marketMakerId_currency: {
          marketMakerId,
          currency,
        },
      },
    });

    if (!inventory) {
      throw new Error('Inventory not found');
    }

    if (inventory.locked.lt(unlockAmount)) {
      throw new Error('Insufficient locked balance to unlock');
    }

    await this.prisma.MarketMakerInventory.update({
      where: { id: inventory.id },
      data: {
        available: inventory.available.add(unlockAmount),
        locked: inventory.locked.sub(unlockAmount),
      },
    });

    logger.info(
      `Unlocked ${unlockAmount} ${currency} for market maker ${marketMakerId}`
    );
  }

  async getInventorySnapshot(
    marketMakerId: string,
    prices?: Map<string, number>
  ): Promise<InventorySnapshot> {
    const inventories = await this.prisma.MarketMakerInventory.findMany({
      where: { marketMakerId },
    });

    const balances = inventories.map(inv => {
      const usdPrice = prices?.get(inv.currency) || 0;
      const usdValue = inv.balance.mul(usdPrice);

      return {
        currency: inv.currency,
        balance: inv.balance,
        available: inv.available,
        locked: inv.locked,
        usdValue,
      };
    });

    const totalUsdValue = balances.reduce(
      (sum, b) => sum.add(b.usdValue || new Decimal(0)),
      new Decimal(0)
    );

    return {
      marketMakerId,
      timestamp: new Date(),
      balances,
      totalUsdValue,
    };
  }

  async getInventoryHistory(
    marketMakerId: string,
    currency?: string,
    startDate?: Date,
    endDate?: Date,
    limit: number = 100
  ): Promise<InventoryEvent[]> {
    const where: any = { marketMakerId };
    
    if (currency) {
      where.currency = currency;
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = startDate;
      if (endDate) where.createdAt.lte = endDate;
    }

    return this.prisma.InventoryEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        inventory: true,
      },
    });
  }

  async reconcileInventory(
    marketMakerId: string,
    externalBalances: Map<string, string>
  ): Promise<{
    discrepancies: Array<{
      currency: string;
      internalBalance: Decimal;
      externalBalance: Decimal;
      difference: Decimal;
    }>;
    totalDiscrepancy: Decimal;
  }> {
    const inventories = await this.prisma.MarketMakerInventory.findMany({
      where: { marketMakerId },
    });

    const discrepancies: Array<{
      currency: string;
      internalBalance: Decimal;
      externalBalance: Decimal;
      difference: Decimal;
    }> = [];

    for (const inventory of inventories) {
      const externalBalance = externalBalances.get(inventory.currency);
      if (externalBalance) {
        const external = new Decimal(externalBalance);
        const difference = inventory.balance.sub(external).abs();

        if (difference.gt(0.00001)) { // Small tolerance for rounding
          discrepancies.push({
            currency: inventory.currency,
            internalBalance: inventory.balance,
            externalBalance: external,
            difference,
          });
        }
      }
    }

    // Check for currencies in external but not internal
    for (const [currency, balance] of externalBalances) {
      const inventory = inventories.find(inv => inv.currency === currency);
      if (!inventory && new Decimal(balance).gt(0)) {
        discrepancies.push({
          currency,
          internalBalance: new Decimal(0),
          externalBalance: new Decimal(balance),
          difference: new Decimal(balance),
        });
      }
    }

    const totalDiscrepancy = discrepancies.reduce(
      (sum, d) => sum.add(d.difference),
      new Decimal(0)
    );

    if (totalDiscrepancy.gt(0)) {
      logger.warn(
        `Inventory reconciliation found ${discrepancies.length} discrepancies ` +
        `for market maker ${marketMakerId}`
      );

      this.emit('inventory:discrepancy', {
        marketMakerId,
        discrepancies,
        totalDiscrepancy: totalDiscrepancy.toString(),
      });
    }

    return { discrepancies, totalDiscrepancy };
  }

  private async checkAlerts(
    marketMakerId: string,
    currency: string,
    balance: Decimal
  ): Promise<void> {
    const thresholds = this.alertThresholds.get(currency);
    if (!thresholds) return;

    const alerts: InventoryAlert[] = [];

    if (balance.lt(thresholds.low)) {
      alerts.push({
        type: 'LOW_BALANCE',
        marketMakerId,
        currency,
        currentBalance: balance,
        threshold: thresholds.low,
        message: `Low ${currency} balance: ${balance.toFixed(8)} (threshold: ${thresholds.low})`,
      });
    }

    if (balance.gt(thresholds.high)) {
      alerts.push({
        type: 'HIGH_EXPOSURE',
        marketMakerId,
        currency,
        currentBalance: balance,
        threshold: thresholds.high,
        message: `High ${currency} exposure: ${balance.toFixed(8)} (threshold: ${thresholds.high})`,
      });
    }

    for (const alert of alerts) {
      this.emit('inventory:alert', alert);
      logger.warn(`Inventory alert: ${alert.message}`);
    }
  }

  async setAlertThreshold(
    currency: string,
    low: string,
    high: string
  ): Promise<void> {
    this.alertThresholds.set(currency, {
      low: new Decimal(low),
      high: new Decimal(high),
    });
  }

  async calculateImbalance(
    marketMakerId: string,
    baseCurrency: string,
    quoteCurrency: string
  ): Promise<{
    baseBalance: Decimal;
    quoteBalance: Decimal;
    imbalanceRatio: Decimal;
    recommendedAction?: 'BUY_BASE' | 'SELL_BASE' | 'BALANCED';
  }> {
    const [baseInventory, quoteInventory] = await Promise.all([
      this.prisma.MarketMakerInventory.findUnique({
        where: {
          marketMakerId_currency: {
            marketMakerId,
            currency: baseCurrency,
          },
        },
      }),
      this.prisma.MarketMakerInventory.findUnique({
        where: {
          marketMakerId_currency: {
            marketMakerId,
            currency: quoteCurrency,
          },
        },
      }),
    ]);

    const baseBalance = baseInventory?.balance || new Decimal(0);
    const quoteBalance = quoteInventory?.balance || new Decimal(0);

    // Calculate imbalance ratio (simplified - should use market prices)
    const totalValue = baseBalance.add(quoteBalance);
    const imbalanceRatio = totalValue.gt(0)
      ? baseBalance.div(totalValue).sub(0.5).abs().mul(100)
      : new Decimal(0);

    let recommendedAction: 'BUY_BASE' | 'SELL_BASE' | 'BALANCED' | undefined;
    if (imbalanceRatio.gt(10)) {
      recommendedAction = baseBalance.div(totalValue).lt(0.5) ? 'BUY_BASE' : 'SELL_BASE';
    } else {
      recommendedAction = 'BALANCED';
    }

    return {
      baseBalance,
      quoteBalance,
      imbalanceRatio,
      recommendedAction,
    };
  }

  async reconcileInventory(
    marketMakerId: string,
    externalBalances: Array<{ currency: string; balance: string }>
  ): Promise<ReconciliationReport> {
    try {
      const systemInventory = await this.prisma.MarketMakerInventory.findMany({
        where: { marketMakerId },
      });

      const results: ReconciliationResult[] = [];
      let discrepancyCount = 0;
      let totalDiscrepancyValue = new Decimal(0);

      // Create a map of external balances for easy lookup
      const externalMap = new Map(
        externalBalances.map(b => [b.currency, new Decimal(b.balance)])
      );

      // Reconcile each currency
      for (const inventory of systemInventory) {
        const systemBalance = inventory.balance;
        const externalBalance = externalMap.get(inventory.currency) || new Decimal(0);
        const discrepancy = systemBalance.sub(externalBalance).abs();
        const isReconciled = discrepancy.lte(this.reconciliationTolerance);

        if (!isReconciled) {
          discrepancyCount++;
          totalDiscrepancyValue = totalDiscrepancyValue.add(discrepancy);
          
          // Log alert for significant discrepancies
          if (discrepancy.gt(inventory.balance.mul(0.01))) { // > 1% discrepancy
            logger.warn(`Significant inventory discrepancy for ${marketMakerId} ${inventory.currency}:`, {
              systemBalance: systemBalance.toString(),
              externalBalance: externalBalance.toString(),
              discrepancy: discrepancy.toString(),
            });
            
            this.emit('inventory:discrepancy', {
              marketMakerId,
              currency: inventory.currency,
              systemBalance,
              externalBalance,
              discrepancy,
            });
          }
        }

        results.push({
          marketMakerId,
          currency: inventory.currency,
          systemBalance,
          externalBalance,
          discrepancy,
          isReconciled,
          timestamp: new Date(),
          adjustmentRequired: !isReconciled && discrepancy.gt(this.reconciliationTolerance),
        });

        // Remove from external map to track unmatched external balances
        externalMap.delete(inventory.currency);
      }

      // Check for currencies in external system but not in our system
      for (const [currency, balance] of externalMap) {
        if (balance.gt(0)) {
          results.push({
            marketMakerId,
            currency,
            systemBalance: new Decimal(0),
            externalBalance: balance,
            discrepancy: balance,
            isReconciled: false,
            timestamp: new Date(),
            adjustmentRequired: true,
          });
          discrepancyCount++;
          totalDiscrepancyValue = totalDiscrepancyValue.add(balance);
        }
      }

      // Create reconciliation report
      const report: ReconciliationReport = {
        marketMakerId,
        reconciliationDate: new Date(),
        totalCurrencies: results.length,
        reconciledCount: results.filter(r => r.isReconciled).length,
        discrepancyCount,
        totalDiscrepancyValue,
        details: results,
      };

      // Store reconciliation event
      await this.storeReconciliationEvent(report);

      return report;
    } catch (error) {
      logger.error(`Error reconciling inventory for ${marketMakerId}:`, error);
      throw error;
    }
  }

  private async storeReconciliationEvent(report: ReconciliationReport): Promise<void> {
    await this.prisma.InventoryEvent.create({
      data: {
        marketMakerId: report.marketMakerId,
        eventType: 'RECONCILIATION',
        currency: 'MULTI',
        amount: new Decimal(0),
        balanceBefore: new Decimal(0),
        balanceAfter: new Decimal(0),
        description: `Inventory reconciliation: ${report.reconciledCount}/${report.totalCurrencies} reconciled`,
        metadata: {
          report,
        },
      },
    });
  }

  async performInventoryAdjustment(
    marketMakerId: string,
    currency: string,
    adjustmentAmount: Decimal,
    reason: string
  ): Promise<MarketMakerInventory> {
    const inventory = await this.updateBalance({
      marketMakerId,
      currency,
      amount: adjustmentAmount.toString(),
      eventType: 'ADJUSTMENT',
      description: `Manual adjustment: ${reason}`,
    });

    this.emit('inventory:adjusted', {
      marketMakerId,
      currency,
      adjustmentAmount,
      reason,
      newBalance: inventory.balance,
    });

    return inventory;
  }

  async getReconciliationHistory(
    marketMakerId: string,
    limit: number = 10
  ): Promise<ReconciliationReport[]> {
    const events = await this.prisma.InventoryEvent.findMany({
      where: {
        marketMakerId,
        eventType: 'RECONCILIATION',
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return events
      .map(e => (e.metadata as any)?.report)
      .filter(r => r !== undefined) as ReconciliationReport[];
  }

  async scheduleAutomaticReconciliation(
    marketMakerId: string,
    intervalHours: number = 24
  ): Promise<void> {
    // In a production system, this would use a job scheduler
    setInterval(async () => {
      try {
        // Fetch external balances (would integrate with external API)
        const externalBalances = await this.fetchExternalBalances(marketMakerId);
        const report = await this.reconcileInventory(marketMakerId, externalBalances);
        
        if (report.discrepancyCount > 0) {
          logger.warn(`Reconciliation discrepancies found for ${marketMakerId}:`, {
            discrepancyCount: report.discrepancyCount,
            totalValue: report.totalDiscrepancyValue.toString(),
          });
        }
      } catch (error) {
        logger.error(`Automatic reconciliation failed for ${marketMakerId}:`, error);
      }
    }, intervalHours * 60 * 60 * 1000);
  }

  private async fetchExternalBalances(
    marketMakerId: string
  ): Promise<Array<{ currency: string; balance: string }>> {
    // This would integrate with the market maker's external API
    // For now, return mock data
    const marketMaker = await this.prisma.MarketMaker.findUnique({
      where: { id: marketMakerId },
      include: { inventory: true },
    });

    if (!marketMaker) {
      throw new Error('Market maker not found');
    }

    // Mock external balances with slight variations
    return marketMaker.inventory.map(inv => ({
      currency: inv.currency,
      balance: inv.balance.mul(new Decimal(0.99 + Math.random() * 0.02)).toString(),
    }));
  }
}