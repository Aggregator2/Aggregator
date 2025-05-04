const axios = require('axios');

async function sendOrder() {
    try {
        const res = await axios.post('http://localhost:3000/orders', {
            type: 'sell',
            price: 100,
            amount: 5
        });
        console.log('✅ Sell Order Sent:', res.data);
    } catch (error) {
        console.error('❌ Error Sending Sell Order:', error.message);
    }
}

sendOrder();
