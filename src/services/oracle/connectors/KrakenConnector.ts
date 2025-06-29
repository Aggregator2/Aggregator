import { BaseExchangeConnector } from './BaseExchangeConnector';
import { PriceData } from '../types';

export class KrakenConnector extends BaseExchangeConnector {
  name = 'Kraken';

  protected getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    
    if (this.config.apiKey) {
      headers['API-Key'] = this.config.apiKey;
    }
    
    return headers;
  }

  async fetchPrice(symbol: string): Promise<PriceData> {
    const krakenSymbol = this.convertToKrakenSymbol(symbol);
    
    return this.rateLimitedRequest(async () => {
      const response = await this.api.get('/0/public/Ticker', {
        params: { pair: krakenSymbol }
      });
      
      const data = response.data.result[krakenSymbol];
      return this.parseResponse(data, symbol);
    });
  }

  protected parseResponse(data: any, symbol: string): PriceData {
    return {
      symbol,
      price: parseFloat(data.c[0]),
      volume24h: parseFloat(data.v[1]),
      timestamp: Date.now(),
      source: this.name
    };
  }

  private convertToKrakenSymbol(symbol: string): string {
    const [base, quote] = symbol.split('/');
    const krakenBase = base === 'BTC' ? 'XBT' : base;
    return `${krakenBase}${quote}`;
  }
}