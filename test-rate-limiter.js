/**
 * Test script for LiFi Rate Limiter implementation
 */

const { lifiRateLimitService } = require('./src/services/rateLimiter');
const { multiChainQuoteService } = require('./src/services/multiChainQuoteService');

async function testRateLimiter() {
  console.log('🧪 Testing LiFi Rate Limiter Implementation\n');

  // Test 1: Rate limit checking
  console.log('1. Testing rate limit checking...');
  
  for (let i = 0; i < 5; i++) {
    const result = lifiRateLimitService.canMakeRequest('test-key');
    console.log(`Request ${i + 1}:`, result.allowed ? 'ALLOWED' : `BLOCKED (retry in ${result.retryAfter}ms)`);
    
    if (result.allowed && result.remaining !== undefined) {
      console.log(`  Remaining requests: ${result.remaining}`);
    }
  }

  // Test 2: Cache functionality
  console.log('\n2. Testing quote caching...');
  
  const testParams = {
    fromChainId: 1,
    toChainId: 1,
    fromTokenAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
    toTokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
    fromAmount: '1000000000000000000' // 1 ETH
  };

  // Test cache miss
  let cachedQuote = lifiRateLimitService.getCachedQuote(testParams);
  console.log('Cache miss test:', cachedQuote ? 'FAILED' : 'PASSED');

  // Test cache set and get
  const mockQuote = {
    buyAmount: '2400000000', // 2400 USDC
    source: 'LiFi',
    estimatedGas: '200000'
  };

  lifiRateLimitService.cacheQuote(testParams, mockQuote);
  cachedQuote = lifiRateLimitService.getCachedQuote(testParams);
  console.log('Cache hit test:', cachedQuote && cachedQuote.buyAmount === mockQuote.buyAmount ? 'PASSED' : 'FAILED');

  // Test 3: Rate limit handling
  console.log('\n3. Testing rate limit handling...');
  
  // Simulate rate limit hit
  lifiRateLimitService.handleRateLimit(60, 'test-key'); // 60 seconds
  const blockedResult = lifiRateLimitService.canMakeRequest('test-key');
  console.log('Rate limit enforcement:', !blockedResult.allowed ? 'PASSED' : 'FAILED');
  console.log(`Retry after: ${Math.ceil((blockedResult.retryAfter || 0) / 1000)} seconds`);

  // Test 4: Cache statistics
  console.log('\n4. Cache statistics:');
  const stats = lifiRateLimitService.getCacheStats();
  console.log('Quote cache:', `${stats.quoteCache.size}/${stats.quoteCache.maxSize} items`);
  console.log('Route cache:', `${stats.routeCache.size}/${stats.routeCache.maxSize} items`);

  // Test 5: Test actual quote with rate limiting (if API key available)
  if (process.env.LIFI_API_KEY) {
    console.log('\n5. Testing actual quote with rate limiting...');
    
    try {
      const startTime = Date.now();
      const quote = await multiChainQuoteService.getQuote({
        sellToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
        buyToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
        sellAmount: '1000000000000000000', // 1 ETH
        chainId: 1,
        slippage: 0.5
      });
      const duration = Date.now() - startTime;
      
      console.log(`✅ Quote successful in ${duration}ms`);
      console.log(`Buy amount: ${quote.buyAmount}`);
      console.log(`Source: ${quote.source}`);
      
      // Test cache hit on second request
      const startTime2 = Date.now();
      const quote2 = await multiChainQuoteService.getQuote({
        sellToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        buyToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        sellAmount: '1000000000000000000',
        chainId: 1,
        slippage: 0.5
      });
      const duration2 = Date.now() - startTime2;
      
      console.log(`Second request (should be cached): ${duration2}ms`);
      console.log(`Cache hit: ${duration2 < 100 ? 'YES' : 'NO'}`);
      
    } catch (error) {
      console.log(`❌ Quote failed: ${error.message}`);
      
      if (error.message.includes('rate limit')) {
        console.log('✅ Rate limiting is working properly');
      }
    }
  } else {
    console.log('\n5. Skipping API test (no LIFI_API_KEY found)');
  }

  console.log('\n🏁 Rate limiter testing complete!');
}

// Test backoff functionality
async function testExponentialBackoff() {
  console.log('\n🔄 Testing exponential backoff...');
  
  const rateLimiter = new (require('./src/services/rateLimiter')).LiFiRateLimitService();
  
  // Reset state
  rateLimiter.resetRateLimit('backoff-test');
  
  // Simulate multiple rate limit hits
  for (let i = 0; i < 5; i++) {
    rateLimiter.handleRateLimit(10, 'backoff-test'); // 10 second base
    const result = rateLimiter.canMakeRequest('backoff-test');
    
    const waitTime = Math.ceil((result.retryAfter || 0) / 1000);
    console.log(`Backoff attempt ${i + 1}: ${waitTime} seconds`);
  }
}

// Run tests
async function runAllTests() {
  try {
    await testRateLimiter();
    await testExponentialBackoff();
  } catch (error) {
    console.error('Test failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  runAllTests();
}

module.exports = { testRateLimiter, testExponentialBackoff };