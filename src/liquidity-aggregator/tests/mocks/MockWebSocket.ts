import { EventEmitter } from 'events';

export class MockWebSocket extends EventEmitter {
  public readyState: number = 0;
  public url: string;
  
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  
  constructor(url: string, options?: any) {
    super();
    this.url = url;
    
    // Simulate connection
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      this.emit('open');
    }, 10);
  }
  
  send(data: string): void {
    const message = JSON.parse(data);
    
    // Simulate responses
    setTimeout(() => {
      if (message.type === 'subscribe') {
        // Send mock quote updates
        this.sendMockQuote(message.data.pairs[0]);
      } else if (message.type === 'quote') {
        // Send quote response
        this.emit('message', Buffer.from(JSON.stringify({
          type: 'quote',
          data: {
            id: message.data.id,
            amountOut: '2000000000', // 2000 USDC
            price: 2000,
            priceImpact: 0.1
          }
        })));
      }
    }, 50);
  }
  
  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.emit('close');
  }
  
  private sendMockQuote(pair: string): void {
    setInterval(() => {
      if (this.readyState === MockWebSocket.OPEN) {
        this.emit('message', Buffer.from(JSON.stringify({
          type: 'update',
          data: {
            pair,
            bid: 1995 + Math.random() * 10,
            ask: 2005 + Math.random() * 10,
            bidSize: 100,
            askSize: 100,
            timestamp: Date.now()
          }
        })));
      }
    }, 1000);
  }
  
  on(event: string, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }
  
  off(event: string, listener: (...args: any[]) => void): this {
    return super.off(event, listener);
  }
}