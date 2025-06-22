import { EventEmitter } from 'events';

interface PriceUpdate {
  tokenAddress: string;
  chainId: number;
  price: number;
  change24h: number;
  timestamp: number;
}

interface QuoteUpdate {
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  buyAmount: string;
  price: number;
  source: string;
  timestamp: number;
}

interface WebSocketConfig {
  url: string;
  reconnectInterval: number;
  heartbeatInterval: number;
  maxReconnectAttempts: number;
}

class PriceWebSocketService extends EventEmitter {
  private static instance: PriceWebSocketService;
  private ws: WebSocket | null = null;
  private config: WebSocketConfig;
  private reconnectAttempts = 0;
  private heartbeatTimer: NodeJS.Timer | null = null;
  private reconnectTimer: NodeJS.Timer | null = null;
  private subscribedTokens: Set<string> = new Set();
  private priceCache: Map<string, PriceUpdate> = new Map();
  
  // Performance metrics
  private metrics = {
    messagesReceived: 0,
    reconnections: 0,
    lastMessageTime: 0,
    connectionStartTime: 0,
    bytesReceived: 0
  };

  private constructor() {
    super();
    
    this.config = {
      url: process.env.NEXT_PUBLIC_WS_URL || 'wss://stream.binance.com:9443/ws',
      reconnectInterval: 5000,
      heartbeatInterval: 30000,
      maxReconnectAttempts: 10
    };
  }

  static getInstance(): PriceWebSocketService {
    if (!PriceWebSocketService.instance) {
      PriceWebSocketService.instance = new PriceWebSocketService();
    }
    return PriceWebSocketService.instance;
  }

  connect(): void {
    if (typeof window === 'undefined') {
      console.warn('WebSocket not available in server environment');
      return;
    }

    if (this.ws?.readyState === WebSocket.OPEN) {
      console.log('WebSocket already connected');
      return;
    }

    try {
      console.log('Connecting to WebSocket...');
      this.metrics.connectionStartTime = Date.now();
      
      // For demo purposes, we'll create a mock WebSocket connection
      // In production, this would connect to a real price feed service
      this.createMockWebSocket();
      
    } catch (error) {
      console.error('WebSocket connection failed:', error);
      this.scheduleReconnect();
    }
  }

  private createMockWebSocket() {
    // Simulate WebSocket behavior for testing
    const mockWs = {
      readyState: WebSocket.OPEN,
      send: (data: string) => {
        console.log('Mock WS send:', data);
      },
      close: () => {
        console.log('Mock WS closed');
      }
    };

    this.ws = mockWs as any;
    this.emit('connected');
    this.startHeartbeat();
    
    // Simulate price updates
    this.simulatePriceUpdates();
  }

  private simulatePriceUpdates() {
    // Common tokens with realistic prices
    const tokens = [
      { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', symbol: 'WETH', basePrice: 2000 },
      { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', basePrice: 1 },
      { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', symbol: 'USDT', basePrice: 1 },
      { address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', symbol: 'DAI', basePrice: 1 },
      { address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', symbol: 'WBTC', basePrice: 40000 }
    ];

    setInterval(() => {
      tokens.forEach(token => {
        // Simulate price fluctuation (±2%)
        const priceChange = (Math.random() - 0.5) * 0.04;
        const newPrice = token.basePrice * (1 + priceChange);
        const change24h = (Math.random() - 0.5) * 10; // ±5%
        
        const update: PriceUpdate = {
          tokenAddress: token.address,
          chainId: 1,
          price: newPrice,
          change24h,
          timestamp: Date.now()
        };
        
        this.handlePriceUpdate(update);
      });
    }, 2000); // Update every 2 seconds
  }

  private handlePriceUpdate(update: PriceUpdate) {
    this.metrics.messagesReceived++;
    this.metrics.lastMessageTime = Date.now();
    
    // Cache the update
    const key = `${update.chainId}-${update.tokenAddress}`;
    this.priceCache.set(key, update);
    
    // Emit events
    this.emit('priceUpdate', update);
    
    // Also emit token-specific event
    this.emit(`price:${update.tokenAddress}`, update);
  }

  subscribeToToken(tokenAddress: string, chainId: number = 1): void {
    const key = `${chainId}-${tokenAddress.toLowerCase()}`;
    this.subscribedTokens.add(key);
    
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        method: 'SUBSCRIBE',
        params: [`${tokenAddress}@ticker`],
        id: Date.now()
      }));
    }
    
    // Return cached price if available
    const cached = this.priceCache.get(key);
    if (cached) {
      this.emit(`price:${tokenAddress}`, cached);
    }
  }

  unsubscribeFromToken(tokenAddress: string, chainId: number = 1): void {
    const key = `${chainId}-${tokenAddress.toLowerCase()}`;
    this.subscribedTokens.delete(key);
    
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        method: 'UNSUBSCRIBE',
        params: [`${tokenAddress}@ticker`],
        id: Date.now()
      }));
    }
  }

  subscribeToQuotePair(sellToken: string, buyToken: string, chainId: number = 1): void {
    const pairKey = `quote:${chainId}:${sellToken}:${buyToken}`;
    
    // Subscribe to both tokens for price updates
    this.subscribeToToken(sellToken, chainId);
    this.subscribeToToken(buyToken, chainId);
    
    // Emit synthetic quote updates based on price changes
    this.on(`price:${sellToken}`, () => this.emitQuoteUpdate(sellToken, buyToken, chainId));
    this.on(`price:${buyToken}`, () => this.emitQuoteUpdate(sellToken, buyToken, chainId));
  }

  private emitQuoteUpdate(sellToken: string, buyToken: string, chainId: number) {
    const sellKey = `${chainId}-${sellToken.toLowerCase()}`;
    const buyKey = `${chainId}-${buyToken.toLowerCase()}`;
    
    const sellPrice = this.priceCache.get(sellKey);
    const buyPrice = this.priceCache.get(buyKey);
    
    if (sellPrice && buyPrice) {
      const quoteUpdate: QuoteUpdate = {
        sellToken,
        buyToken,
        sellAmount: '1000000000000000000', // 1 token
        buyAmount: ((sellPrice.price / buyPrice.price) * 1e18).toString(),
        price: sellPrice.price / buyPrice.price,
        source: 'websocket',
        timestamp: Date.now()
      };
      
      this.emit('quoteUpdate', quoteUpdate);
      this.emit(`quote:${sellToken}:${buyToken}`, quoteUpdate);
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, this.config.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      this.emit('maxReconnectAttemptsReached');
      return;
    }

    const delay = Math.min(
      this.config.reconnectInterval * Math.pow(2, this.reconnectAttempts),
      30000 // Max 30 seconds
    );

    console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts + 1})`);
    
    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts++;
      this.metrics.reconnections++;
      this.connect();
    }, delay);
  }

  disconnect(): void {
    console.log('Disconnecting WebSocket...');
    
    this.stopHeartbeat();
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    this.emit('disconnected');
  }

  getConnectionStatus(): {
    connected: boolean;
    uptime: number;
    messagesReceived: number;
    reconnections: number;
    lastMessageAge: number;
  } {
    const now = Date.now();
    
    return {
      connected: this.ws?.readyState === WebSocket.OPEN,
      uptime: this.metrics.connectionStartTime ? now - this.metrics.connectionStartTime : 0,
      messagesReceived: this.metrics.messagesReceived,
      reconnections: this.metrics.reconnections,
      lastMessageAge: this.metrics.lastMessageTime ? now - this.metrics.lastMessageTime : Infinity
    };
  }

  getLatestPrice(tokenAddress: string, chainId: number = 1): PriceUpdate | null {
    const key = `${chainId}-${tokenAddress.toLowerCase()}`;
    return this.priceCache.get(key) || null;
  }

  // Check if price data is stale (older than 30 seconds)
  isPriceStale(tokenAddress: string, chainId: number = 1): boolean {
    const price = this.getLatestPrice(tokenAddress, chainId);
    if (!price) return true;
    
    return Date.now() - price.timestamp > 30000;
  }
}

export const priceWebSocketService = PriceWebSocketService.getInstance();