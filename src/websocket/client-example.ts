import { io, Socket } from 'socket.io-client';

/**
 * Example WebSocket client with JWT authentication
 */
export class AuthenticatedWebSocketClient {
  private socket: Socket | null = null;
  private token: string;
  private url: string;

  constructor(url: string, token: string) {
    this.url = url;
    this.token = token;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Connect with JWT token in auth object
      this.socket = io(this.url, {
        auth: {
          token: this.token
        },
        // Alternative: use headers
        // extraHeaders: {
        //   Authorization: `Bearer ${this.token}`
        // }
      });

      this.socket.on('connect', () => {
        console.log('Connected to WebSocket server');
        resolve();
      });

      this.socket.on('auth:success', (data) => {
        console.log('Authentication successful:', data);
      });

      this.socket.on('connect_error', (error) => {
        console.error('Connection error:', error.message);
        reject(error);
      });

      this.socket.on('error', (error) => {
        console.error('WebSocket error:', error);
      });

      this.socket.on('disconnect', (reason) => {
        console.log('Disconnected:', reason);
      });
    });
  }

  subscribeToOrderBook(pairs: string[]) {
    if (!this.socket) {
      throw new Error('Not connected');
    }

    this.socket.emit('subscribe:orderbook', pairs);

    this.socket.on('orderbook:snapshot', (data) => {
      console.log('Order book snapshot:', data);
    });

    this.socket.on('orderbook:update', (data) => {
      console.log('Order book update:', data);
    });
  }

  subscribeToUserOrders() {
    if (!this.socket) {
      throw new Error('Not connected');
    }

    this.socket.emit('subscribe:orders');

    this.socket.on('orders:snapshot', (orders) => {
      console.log('User orders:', orders);
    });

    this.socket.on('order:submitted', (order) => {
      console.log('Order submitted:', order);
    });

    this.socket.on('order:filled', (order) => {
      console.log('Order filled:', order);
    });

    this.socket.on('order:cancelled', (order) => {
      console.log('Order cancelled:', order);
    });
  }

  subscribeToNotifications() {
    if (!this.socket) {
      throw new Error('Not connected');
    }

    this.socket.emit('subscribe:notifications');

    this.socket.on('subscribed:notifications', (data) => {
      console.log('Subscribed to notifications:', data);
    });

    this.socket.on('notification', (notification) => {
      console.log('Received notification:', notification);
    });
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }
}

// Usage example
async function example() {
  // Get JWT token from your authentication system
  const token = 'your-jwt-token-here';
  
  const client = new AuthenticatedWebSocketClient('http://localhost:3001', token);
  
  try {
    await client.connect();
    
    // Subscribe to various channels
    client.subscribeToOrderBook(['ETH/USDT', 'BTC/USDT']);
    client.subscribeToUserOrders();
    client.subscribeToNotifications();
    
  } catch (error) {
    console.error('Failed to connect:', error);
  }
}