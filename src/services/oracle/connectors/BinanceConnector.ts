import { BaseExchangeConnector } from './BaseExchangeConnector';
import { PriceData } from '../types';

export class BinanceConnector extends BaseExchangeConnector {
  name = 'Binance';

  protected getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    
    if (this.config.apiKey) {
      headers['X-MBX-APIKEY'] = this.config.apiKey;
    }
    
    return headers;
  }

  async fetchPrice(symbol: string): Promise<PriceData> {
    const normalizedSymbol = this.normalizeSymbol(symbol);
    
    return this.rateLimitedRequest(async () => {
      const response = await this.api.get('/api/v3/ticker/24hr', {
        params: { symbol: normalizedSymbol }
      });
      
      return this.parseResponse(response.data, symbol);
    });
  }

  protected parseResponse(data: any, symbol: string): PriceData {
    return {
      symbol,
      price: parseFloat(data.lastPrice),
      volume24h: parseFloat(data.volume),
      timestamp: Date.now(),
      source: this.name
    };
  }
}