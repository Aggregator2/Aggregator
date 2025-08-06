const io = require('socket.io-client');

async function testWebSocket() {
    console.log('🧪 Testing WebSocket Real-time Updates');
    console.log('======================================\n');

    // First, trigger the WebSocket initialization
    await fetch('http://localhost:3000/api/ws');
    
    const socket = io('http://localhost:3000', {
        path: '/api/socketio'
    });
    
    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            console.log('❌ WebSocket connection timeout');
            socket.close();
            resolve();
        }, 5000);

        socket.on('connect', () => {
            console.log('✅ WebSocket connected successfully');
            
            // Subscribe to order book updates
            socket.emit('subscribe', {
                channel: 'orderBook',
                pair: 'ETH/USDC'
            });
            
            // Subscribe to trade updates
            socket.emit('subscribe', {
                channel: 'trades',
                pair: 'ETH/USDC'
            });
            
            console.log('📤 Subscribed to orderBook and trades channels');
        });

        socket.on('message', (message) => {
            console.log('📥 Received message:', message.type || 'unknown');
            
            if (message.type === 'orderBook') {
                console.log('  Order Book Update - Bids:', message.data.bids?.length || 0, 'Asks:', message.data.asks?.length || 0);
            } else if (message.type === 'trade') {
                console.log('  Trade Update - Price:', message.data.price, 'Quantity:', message.data.quantity);
            }
        });

        socket.on('error', (error) => {
            console.log('❌ WebSocket error:', error.message);
            clearTimeout(timeout);
            resolve();
        });

        socket.on('disconnect', () => {
            console.log('🔌 WebSocket disconnected');
            clearTimeout(timeout);
            resolve();
        });
        
        // Close after 3 seconds
        setTimeout(() => {
            console.log('\n✅ WebSocket test completed');
            socket.close();
            clearTimeout(timeout);
            resolve();
        }, 3000);
    });
}

testWebSocket().catch(console.error);