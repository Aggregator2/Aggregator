console.log('Environment variables check:');
console.log('ZEROX_API_KEY:', process.env.ZEROX_API_KEY ? 'Set (' + process.env.ZEROX_API_KEY.substring(0, 8) + '...)' : 'Not set');
console.log('ONEINCH_API_KEY:', process.env.ONEINCH_API_KEY ? 'Set' : 'Not set');
console.log('COINGECKO_API_KEY:', process.env.COINGECKO_API_KEY ? 'Set' : 'Not set');
console.log('TRON_API_KEY:', process.env.TRON_API_KEY ? 'Set (' + process.env.TRON_API_KEY.substring(0, 8) + '...)' : 'Not set');

// Load dotenv
require('dotenv').config();

console.log('\nAfter loading dotenv:');
console.log('ZEROX_API_KEY:', process.env.ZEROX_API_KEY ? 'Set (' + process.env.ZEROX_API_KEY.substring(0, 8) + '...)' : 'Not set');
console.log('ONEINCH_API_KEY:', process.env.ONEINCH_API_KEY ? 'Set' : 'Not set');
console.log('COINGECKO_API_KEY:', process.env.COINGECKO_API_KEY ? 'Set' : 'Not set');
console.log('TRON_API_KEY:', process.env.TRON_API_KEY ? 'Set (' + process.env.TRON_API_KEY.substring(0, 8) + '...)' : 'Not set');