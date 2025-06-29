import { ethers } from 'ethers';
import {
  LiquidityAggregator,
  UniswapV2Connector,
  SushiSwapConnector,
  CurveConnector,
  BalancerConnector,
  MarketMakerConnector,
  Token,
  TokenPair,
  OrderRequest
} from './index';

async function main() {
  // Initialize provider (you can use Infura, Alchemy, etc.)
  const provider = new ethers.JsonRpcProvider('https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY');
  
  // Create aggregator instance
  const aggregator = new LiquidityAggregator();
  
  // Add DEX connectors
  aggregator.addConnector(new UniswapV2Connector(provider));
  aggregator.addConnector(new SushiSwapConnector(provider));
  aggregator.addConnector(new CurveConnector(provider));
  aggregator.addConnector(new BalancerConnector(provider));
  
  // Add market maker connectors
  aggregator.addConnector(new MarketMakerConnector(
    'MM1',
    'wss://mm1.example.com/ws',
    'your-api-key',
    1
  ));
  
  aggregator.addConnector(new MarketMakerConnector(
    'MM2',
    'wss://mm2.example.com/ws',
    'your-api-key',
    1
  ));
  
  // Define tokens
  const WETH: Token = {
    address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    symbol: 'WETH',
    decimals: 18,
    chainId: 1
  };
  
  const USDC: Token = {
    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    symbol: 'USDC',
    decimals: 6,
    chainId: 1
  };
  
  const DAI: Token = {
    address: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
    symbol: 'DAI',
    decimals: 18,
    chainId: 1
  };
  
  // Example 1: Get best route for a swap
  console.log('\\n=== Finding Best Route ===');
  const swapRequest: OrderRequest = {
    tokenIn: WETH,
    tokenOut: USDC,
    amountIn: ethers.parseEther('1'), // 1 WETH
    slippageTolerance: 50, // 0.5%
    deadline: Math.floor(Date.now() / 1000) + 300 // 5 minutes
  };
  
  const bestRoute = await aggregator.findBestRoute(swapRequest);
  
  if (bestRoute) {
    console.log('Best route found:');
    console.log('Path:', bestRoute.path.map(t => t.symbol).join(' -> '));
    console.log('Total output:', ethers.formatUnits(bestRoute.totalAmountOut, USDC.decimals), 'USDC');
    console.log('Price impact:', bestRoute.priceImpact / 100, '%');
    console.log('Estimated gas:', bestRoute.totalGasEstimate.toString());
    console.log('\\nRoute details:');
    bestRoute.quotes.forEach((quote, i) => {
      console.log(`  Step ${i + 1}: ${quote.source.name}`);
      console.log(`    ${ethers.formatUnits(quote.amountIn, quote.tokenIn.decimals)} ${quote.tokenIn.symbol}`);
      console.log(`    -> ${ethers.formatUnits(quote.amountOut, quote.tokenOut.decimals)} ${quote.tokenOut.symbol}`);
      console.log(`    Price: ${quote.price}`);
    });
  }
  
  // Example 2: Get all quotes from all sources
  console.log('\\n=== Getting All Quotes ===');
  const allQuotes = await aggregator.getQuotes(swapRequest);
  
  console.log(`Found ${allQuotes.length} quotes:`);
  allQuotes.forEach(quote => {
    console.log(`  ${quote.source.name}: ${ethers.formatUnits(quote.amountOut, USDC.decimals)} USDC`);
  });
  
  // Example 3: Subscribe to liquidity updates
  console.log('\\n=== Subscribing to Liquidity Updates ===');
  const pair: TokenPair = { tokenA: WETH, tokenB: USDC };
  
  const unsubscribeLiquidity = aggregator.subscribeToLiquidityUpdates(
    pair,
    (pools) => {
      console.log(`\\nLiquidity update - ${pools.length} pools:`);
      pools.forEach(pool => {
        const reserveA = ethers.formatUnits(pool.reserves.tokenA, pool.pair.tokenA.decimals);
        const reserveB = ethers.formatUnits(pool.reserves.tokenB, pool.pair.tokenB.decimals);
        console.log(`  ${pool.source.name}: ${reserveA} ${pool.pair.tokenA.symbol} / ${reserveB} ${pool.pair.tokenB.symbol}`);
      });
    }
  );
  
  // Example 4: Subscribe to price updates
  console.log('\\n=== Subscribing to Price Updates ===');
  const unsubscribePrice = aggregator.subscribeToPriceUpdates(
    pair,
    (bestPrice) => {
      console.log(`Best WETH/USDC price: ${bestPrice.toFixed(2)}`);
    }
  );
  
  // Example 5: Get all available liquidity
  console.log('\\n=== Getting All Liquidity ===');
  const allPools = await aggregator.getAllLiquidity(pair);
  
  console.log(`Found ${allPools.length} liquidity pools`);
  
  // Example 6: Multi-hop routing
  console.log('\\n=== Testing Multi-hop Route ===');
  const multiHopRequest: OrderRequest = {
    tokenIn: WETH,
    tokenOut: DAI,
    amountIn: ethers.parseEther('1'),
    slippageTolerance: 100, // 1%
  };
  
  const multiHopRoute = await aggregator.findBestRoute(multiHopRequest);
  
  if (multiHopRoute && multiHopRoute.path.length > 2) {
    console.log('Multi-hop route found:');
    console.log('Path:', multiHopRoute.path.map(t => t.symbol).join(' -> '));
    console.log('Total output:', ethers.formatUnits(multiHopRoute.totalAmountOut, DAI.decimals), 'DAI');
  }
  
  // Keep running for 30 seconds to see updates
  console.log('\\n=== Monitoring for 30 seconds... ===');
  await new Promise(resolve => setTimeout(resolve, 30000));
  
  // Cleanup
  console.log('\\n=== Cleaning up... ===');
  unsubscribeLiquidity();
  unsubscribePrice();
  await aggregator.stop();
  
  console.log('Done!');
}

// Run the example
main().catch(console.error);