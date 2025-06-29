import { WebSocket } from 'ws';
import { BaseConnector } from '../BaseConnector';
import { IMarketMakerConnector } from '../../interfaces/connectors';
import { 
  Token, 
  TokenPair, 
  PriceQuote, 
  LiquidityPool, 
  OrderRequest, 
  WebSocketMessage,
  MarketMakerQuote 
} from '../../interfaces/types';

export class MarketMakerConnector extends BaseConnector implements IMarketMakerConnector {
  private ws?: WebSocket;
  private wsUrl: string;
  private apiKey: string;
  private quoteCallbacks: Map<string, Set<(quote: MarketMakerQuote) => void>> = new Map();
  private latestQuotes: Map<string, MarketMakerQuote> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  
  constructor(
    name: string,
    wsUrl: string,
    apiKey: string,
    chainId: number = 1
  ) {
    super({
      name,
      type: 'MM',
      chainId
    });
    this.wsUrl = wsUrl;
    this.apiKey = apiKey;
  }
  
  protected async doConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        }
      });
      
      this.ws.on('open', () => {
        console.log(`Connected to ${this.source.name} market maker`);
        this.reconnectAttempts = 0;
        resolve();
      });
      
      this.ws.on('message', (data: Buffer) => {
        this.handleMessage(data.toString());
      });
      
      this.ws.on('error', (error) => {
        console.error(`${this.source.name} WebSocket error:`, error);
        reject(error);
      });
      
      this.ws.on('close', () => {
        console.log(`Disconnected from ${this.source.name} market maker`);
        this.attemptReconnect();
      });
    });
  }
  
  protected async doDisconnect(): Promise<void> {
    if (this.ws) {
      this.ws.close();
      this.ws = undefined;
    }
    this.quoteCallbacks.clear();
    this.latestQuotes.clear();
  }
  
  private attemptReconnect(): void {
    if (this.reconnectAttempts < this.maxReconnectAttempts && this.connected) {
      this.reconnectAttempts++;
      console.log(`Attempting to reconnect to ${this.source.name} (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
      
      setTimeout(() => {
        this.doConnect().catch(console.error);
      }, this.reconnectDelay * this.reconnectAttempts);
    }
  }
  
  private handleMessage(data: string): void {
    try {
      const message: WebSocketMessage = JSON.parse(data);
      
      switch (message.type) {
        case 'update':
          this.handleQuoteUpdate(message.data);
          break;
        case 'quote':
          // Handle specific quote responses
          break;
      }
    } catch (error) {
      console.error('Error parsing WebSocket message:', error);
    }
  }
  
  private handleQuoteUpdate(quote: MarketMakerQuote): void {
    this.latestQuotes.set(quote.pair, quote);
    
    const callbacks = this.quoteCallbacks.get(quote.pair);
    if (callbacks) {
      callbacks.forEach(cb => cb(quote));
    }
  }
  
  subscribeToQuotes(
    pairs: string[],
    callback: (quote: MarketMakerQuote) => void
  ): () => void {
    // Subscribe to pairs
    pairs.forEach(pair => {
      if (!this.quoteCallbacks.has(pair)) {
        this.quoteCallbacks.set(pair, new Set());
        
        // Send subscription message
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({
            type: 'subscribe',
            data: { pairs: [pair] }
          }));
        }
      }
      this.quoteCallbacks.get(pair)!.add(callback);
    });
    
    // Return unsubscribe function
    return () => {
      pairs.forEach(pair => {
        const callbacks = this.quoteCallbacks.get(pair);
        if (callbacks) {
          callbacks.delete(callback);
          if (callbacks.size === 0) {
            this.quoteCallbacks.delete(pair);
            
            // Send unsubscribe message
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
              this.ws.send(JSON.stringify({
                type: 'unsubscribe',
                data: { pairs: [pair] }
              }));
            }
          }
        }
      });
    };
  }
  
  async requestQuote(request: OrderRequest): Promise<PriceQuote> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error(`${this.source.name} market maker not connected`);
    }
    
    return new Promise((resolve, reject) => {
      const requestId = Date.now().toString();
      
      // Send quote request
      this.ws!.send(JSON.stringify({
        type: 'quote',
        data: {
          id: requestId,
          tokenIn: request.tokenIn.symbol,
          tokenOut: request.tokenOut.symbol,
          amountIn: request.amountIn.toString(),
          side: 'buy'
        }
      }));
      
      // Set up response handler with timeout
      const timeout = setTimeout(() => {
        reject(new Error('Quote request timeout'));
      }, 5000);
      
      const messageHandler = (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());
          if (message.type === 'quote' && message.data.id === requestId) {
            clearTimeout(timeout);
            this.ws!.off('message', messageHandler);
            
            const quote: PriceQuote = {
              source: this.source,
              tokenIn: request.tokenIn,
              tokenOut: request.tokenOut,
              amountIn: request.amountIn,
              amountOut: BigInt(message.data.amountOut),
              price: message.data.price,
              priceImpact: message.data.priceImpact || 0,
              timestamp: Date.now()
            };
            
            resolve(quote);
          }
        } catch (error) {
          // Ignore parsing errors for other messages
        }
      };
      
      this.ws!.on('message', messageHandler);
    });
  }
  
  async getQuote(request: OrderRequest): Promise<PriceQuote | null> {
    try {
      return await this.requestQuote(request);
    } catch (error) {
      console.error(`Error getting quote from ${this.source.name}:`, error);
      return null;
    }
  }
  
  async getLiquidityPools(pair: TokenPair): Promise<LiquidityPool[]> {
    // Market makers don't have traditional liquidity pools
    // Instead, we can represent their available liquidity
    const pairString = `${pair.tokenA.symbol}/${pair.tokenB.symbol}`;
    const quote = this.latestQuotes.get(pairString);
    
    if (!quote) {
      return [];
    }
    
    // Convert quote to liquidity pool representation
    return [{
      source: this.source,
      pair,
      reserves: {
        tokenA: BigInt(quote.bidSize * 10 ** pair.tokenA.decimals),
        tokenB: BigInt(quote.askSize * 10 ** pair.tokenB.decimals)
      },
      fee: 10, // 0.1% typical MM fee
      lastUpdate: quote.timestamp
    }];
  }
}