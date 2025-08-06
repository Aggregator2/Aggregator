import { Server } from 'socket.io';

const ioHandler = (req, res) => {
  if (!res.socket.server.io) {
    console.log('*First use, starting socket.io');

    const io = new Server(res.socket.server, {
      path: '/api/socketio',
      cors: {
        origin: '*',
        methods: ['GET', 'POST']
      }
    });

    // Store active subscriptions
    const subscriptions = new Map();

    io.on('connection', (socket) => {
      console.log('WebSocket client connected:', socket.id);

      socket.on('subscribe', (data) => {
        const { channel, pair } = data;
        console.log(`Client ${socket.id} subscribing to ${channel} for ${pair}`);
        
        if (!subscriptions.has(socket.id)) {
          subscriptions.set(socket.id, new Set());
        }
        
        subscriptions.get(socket.id).add(`${channel}:${pair}`);
        socket.join(`${channel}:${pair}`);
        
        // Send initial data
        if (channel === 'orderBook') {
          socket.emit('message', {
            type: 'orderBook',
            data: {
              pair,
              bids: [],
              asks: [],
              timestamp: Date.now()
            }
          });
        }
      });

      socket.on('unsubscribe', (data) => {
        const { channel, pair } = data;
        const roomName = `${channel}:${pair}`;
        socket.leave(roomName);
        
        if (subscriptions.has(socket.id)) {
          subscriptions.get(socket.id).delete(roomName);
        }
      });

      socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
        subscriptions.delete(socket.id);
      });
    });

    // Simulate real-time updates
    setInterval(() => {
      // Emit order book updates
      io.to('orderBook:ETH/USDC').emit('message', {
        type: 'orderBook',
        data: {
          pair: 'ETH/USDC',
          bids: [
            { price: 1990 + Math.random() * 10, quantity: Math.random() * 10 }
          ],
          asks: [
            { price: 2000 + Math.random() * 10, quantity: Math.random() * 10 }
          ],
          timestamp: Date.now()
        }
      });

      // Emit trade updates
      if (Math.random() > 0.7) {
        io.to('trades:ETH/USDC').emit('message', {
          type: 'trade',
          data: {
            pair: 'ETH/USDC',
            price: 1995 + Math.random() * 10,
            quantity: Math.random() * 5,
            side: Math.random() > 0.5 ? 'buy' : 'sell',
            timestamp: Date.now()
          }
        });
      }
    }, 2000);

    res.socket.server.io = io;
  } else {
    console.log('socket.io already running');
  }
  res.end();
};

export const config = {
  api: {
    bodyParser: false,
  },
};

export default ioHandler;