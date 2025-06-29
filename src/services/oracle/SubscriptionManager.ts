import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { PriceSubscription, AggregatedPrice } from './types';

export class SubscriptionManager extends EventEmitter {
  private subscriptions: Map<string, PriceSubscription> = new Map();
  private symbolSubscriptions: Map<string, Set<string>> = new Map();
  private intervals: Map<string, NodeJS.Timeout> = new Map();

  subscribe(
    symbols: string[],
    callback: (price: AggregatedPrice) => void,
    interval: number = 1000
  ): string {
    const id = uuidv4();
    const subscription: PriceSubscription = {
      id,
      symbols,
      callback,
      interval
    };

    this.subscriptions.set(id, subscription);

    symbols.forEach(symbol => {
      if (!this.symbolSubscriptions.has(symbol)) {
        this.symbolSubscriptions.set(symbol, new Set());
      }
      this.symbolSubscriptions.get(symbol)!.add(id);
    });

    this.emit('subscription-created', { id, symbols });
    return id;
  }

  unsubscribe(id: string): boolean {
    const subscription = this.subscriptions.get(id);
    if (!subscription) return false;

    subscription.symbols.forEach(symbol => {
      const subs = this.symbolSubscriptions.get(symbol);
      if (subs) {
        subs.delete(id);
        if (subs.size === 0) {
          this.symbolSubscriptions.delete(symbol);
        }
      }
    });

    this.subscriptions.delete(id);
    this.emit('subscription-removed', { id });
    return true;
  }

  publishPrice(price: AggregatedPrice): void {
    const subscriptionIds = this.symbolSubscriptions.get(price.symbol);
    if (!subscriptionIds) return;

    subscriptionIds.forEach(id => {
      const subscription = this.subscriptions.get(id);
      if (subscription) {
        try {
          subscription.callback(price);
        } catch (error) {
          this.emit('subscription-error', { id, error });
        }
      }
    });

    this.emit('price-published', price);
  }

  getActiveSymbols(): string[] {
    return Array.from(this.symbolSubscriptions.keys());
  }

  getSubscriptionCount(): number {
    return this.subscriptions.size;
  }

  getSubscriptionsBySymbol(symbol: string): PriceSubscription[] {
    const ids = this.symbolSubscriptions.get(symbol);
    if (!ids) return [];

    return Array.from(ids)
      .map(id => this.subscriptions.get(id))
      .filter((sub): sub is PriceSubscription => sub !== undefined);
  }

  updateSubscription(
    id: string,
    updates: Partial<Pick<PriceSubscription, 'symbols' | 'interval'>>
  ): boolean {
    const subscription = this.subscriptions.get(id);
    if (!subscription) return false;

    if (updates.symbols) {
      subscription.symbols.forEach(symbol => {
        const subs = this.symbolSubscriptions.get(symbol);
        if (subs) {
          subs.delete(id);
          if (subs.size === 0) {
            this.symbolSubscriptions.delete(symbol);
          }
        }
      });

      subscription.symbols = updates.symbols;
      updates.symbols.forEach(symbol => {
        if (!this.symbolSubscriptions.has(symbol)) {
          this.symbolSubscriptions.set(symbol, new Set());
        }
        this.symbolSubscriptions.get(symbol)!.add(id);
      });
    }

    if (updates.interval !== undefined) {
      subscription.interval = updates.interval;
    }

    this.emit('subscription-updated', { id, updates });
    return true;
  }

  clearAll(): void {
    this.intervals.forEach(interval => clearInterval(interval));
    this.intervals.clear();
    this.subscriptions.clear();
    this.symbolSubscriptions.clear();
    this.emit('all-subscriptions-cleared');
  }
}