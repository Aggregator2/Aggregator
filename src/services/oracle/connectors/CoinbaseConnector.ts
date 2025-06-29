import { BaseExchangeConnector } from './BaseExchangeConnector';
import { PriceData } from '../types';

export class CoinbaseConnector extends BaseExchangeConnector {
  name = 'Coinbase';

  protected getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'User-Agent': 'Oracle-Service/1.0'
    };
  }

  async fetchPrice(symbol: string): Promise<PriceData> {
    const [base, quote] = symbol.split('/');
    const productId = `${base}-${quote}`;
    
    return this.rateLimitedRequest(async () => {
      const [ticker, stats] = await Promise.all([
        this.api.get(`/products/${productId}/ticker`),
        this.api.get(`/products/${productId}/stats`)
      ]);
      
      return this.parseResponse({ ticker: ticker.data, stats: stats.data }, symbol);
    });
  }

  protected parseResponse(data: any, symbol: string): PriceData {
    return {
      symbol,
      price: parseFloat(data.ticker.price),
      volume24h: parseFloat(data.stats.volume),
      timestamp: Date.now(),
      source: this.name
    };
  }
}