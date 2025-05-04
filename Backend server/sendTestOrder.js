const axios = require('axios');

async function sendOrder() {
    try {
        const res = await axios.post('http://localhost:3000/orders', {
            type: 'buy',
            price: 100,
            amount: 5
        });
        console.log('✅ Order Sent:', res.data);
    } catch (error) {
        console.error('❌ Error Sending Order:', error.message);
    }
}

sendOrder();
