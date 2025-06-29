console.log('Starting simple test...');

import { Token, OrderRequest } from './interfaces/types';

const WETH: Token = {
  address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  symbol: 'WETH',
  decimals: 18,
  chainId: 1
};

console.log('Token created:', WETH);

// Test SmartOrderRouter
import { SmartOrderRouter } from './core/SmartOrderRouter';
const router = new SmartOrderRouter();
console.log('Router created');

// Test BaseConnector
import { BaseConnector } from './connectors/BaseConnector';
console.log('BaseConnector imported');

console.log('Simple test completed!');