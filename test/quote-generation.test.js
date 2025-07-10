const axios = require('axios');

class QuoteGenerationTest {
  constructor(baseUrl = 'http://localhost:3000') {
    this.baseUrl = baseUrl;
    
    // Token addresses
    this.tokens = {
      WETH: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      USDC: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      USDT: '0xdac17f958d2ee523a2206206994597c13d831ec7',
      DAI: '0x6b175474e89094c44da98b954eedeac495271d0f',
      WBTC: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
      UNKNOWN: '0x1234567890123456789012345678901234567890'
    };
    
    // Token decimals
    this.decimals = {
      WETH: 18,
      USDC: 6,
      USDT: 6,
      DAI: 18,
      WBTC: 8
    };
  }
  
  async getQuote(sellToken, buyToken, sellAmount, slippageTolerance = 0.5) {
    try {
      const response = await axios.post(`${this.baseUrl}/api/quote-profitable`, {
        sellToken,
        buyToken,
        sellAmount,
        chainId: 1,
        toChainId: 1,
        slippageTolerance: slippageTolerance.toString()
      });
      return response.data;
    } catch (error) {
      if (error.response) {
        throw new Error(`Quote API error: ${error.response.data.error || error.response.statusText}`);
      }
      throw error;
    }
  }
  
  parseAmount(amount, decimals) {
    return parseFloat(amount) / Math.pow(10, decimals);
  }
  
  toBaseUnits(amount, decimals) {
    return (parseFloat(amount) * Math.pow(10, decimals)).toString();
  }
  
  // Test 1: Basic WETH to USDC Swap
  async testBasicWETHtoUSDC() {
    console.log('\n=== Test 1: Basic WETH to USDC Swap ===');
    
    const sellAmount = this.toBaseUnits('1', this.decimals.WETH);
    const quote = await this.getQuote(this.tokens.WETH, this.tokens.USDC, sellAmount);
    
    const buyAmount = this.parseAmount(quote.buyAmount, this.decimals.USDC);
    const minReceived = this.parseAmount(quote.minReceived, this.decimals.USDC);
    const lpFee = this.parseAmount(quote.lpFee, this.decimals.WETH);
    
    console.log(`Sell Amount: 1 WETH`);
    console.log(`Buy Amount: ${buyAmount.toFixed(2)} USDC`);
    console.log(`Minimum Received: ${minReceived.toFixed(2)} USDC`);
    console.log(`LP Fee: ${lpFee.toFixed(6)} WETH`);
    
    // Assertions
    const expectedBuyAmount = 1994; // ~$2000 ETH price with 0.3% fee
    const expectedMinReceived = 1984; // With 0.5% slippage
    const expectedLpFee = 0.003;
    
    const buyAmountOk = Math.abs(buyAmount - expectedBuyAmount) < 10;
    const minReceivedOk = Math.abs(minReceived - expectedMinReceived) < 10;
    const lpFeeOk = Math.abs(lpFee - expectedLpFee) < 0.0001;
    
    console.log(`\nResults:`);
    console.log(`- Buy amount correct: ${buyAmountOk ? '✅' : '❌'} (expected ~${expectedBuyAmount})`);
    console.log(`- Min received correct: ${minReceivedOk ? '✅' : '❌'} (expected ~${expectedMinReceived})`);
    console.log(`- LP fee correct: ${lpFeeOk ? '✅' : '❌'} (expected ${expectedLpFee})`);
    
    return buyAmountOk && minReceivedOk && lpFeeOk;
  }
  
  // Test 2: Stablecoin to Stablecoin (USDC to DAI)
  async testStablecoinToStablecoin() {
    console.log('\n=== Test 2: Stablecoin to Stablecoin (USDC to DAI) ===');
    
    const sellAmount = this.toBaseUnits('100', this.decimals.USDC);
    const quote = await this.getQuote(this.tokens.USDC, this.tokens.DAI, sellAmount);
    
    const buyAmount = this.parseAmount(quote.buyAmount, this.decimals.DAI);
    const minReceived = this.parseAmount(quote.minReceived, this.decimals.DAI);
    
    console.log(`Sell Amount: 100 USDC`);
    console.log(`Buy Amount: ${buyAmount.toFixed(2)} DAI`);
    console.log(`Minimum Received: ${minReceived.toFixed(2)} DAI`);
    
    // Assertions for 1:1 stablecoins with 0.3% fee
    const expectedBuyAmount = 99.7;
    const expectedMinReceived = 99.2; // With 0.5% slippage
    
    const buyAmountOk = Math.abs(buyAmount - expectedBuyAmount) < 0.1;
    const minReceivedOk = Math.abs(minReceived - expectedMinReceived) < 0.1;
    
    console.log(`\nResults:`);
    console.log(`- Buy amount correct: ${buyAmountOk ? '✅' : '❌'} (expected ~${expectedBuyAmount})`);
    console.log(`- Min received correct: ${minReceivedOk ? '✅' : '❌'} (expected ~${expectedMinReceived})`);
    
    return buyAmountOk && minReceivedOk;
  }
  
  // Test 3: Small Amount Test (WETH to USDC)
  async testSmallAmount() {
    console.log('\n=== Test 3: Small Amount Test (WETH to USDC) ===');
    
    const sellAmount = this.toBaseUnits('0.001', this.decimals.WETH);
    const quote = await this.getQuote(this.tokens.WETH, this.tokens.USDC, sellAmount);
    
    const buyAmount = this.parseAmount(quote.buyAmount, this.decimals.USDC);
    const minReceived = this.parseAmount(quote.minReceived, this.decimals.USDC);
    
    console.log(`Sell Amount: 0.001 WETH`);
    console.log(`Buy Amount: ${buyAmount.toFixed(3)} USDC`);
    console.log(`Minimum Received: ${minReceived.toFixed(3)} USDC`);
    
    // Assertions
    const expectedBuyAmount = 1.994;
    const expectedMinReceived = 1.984;
    
    const buyAmountOk = Math.abs(buyAmount - expectedBuyAmount) < 0.01;
    const minReceivedOk = Math.abs(minReceived - expectedMinReceived) < 0.01;
    
    console.log(`\nResults:`);
    console.log(`- Buy amount correct: ${buyAmountOk ? '✅' : '❌'} (expected ~${expectedBuyAmount})`);
    console.log(`- Min received correct: ${minReceivedOk ? '✅' : '❌'} (expected ~${expectedMinReceived})`);
    
    return buyAmountOk && minReceivedOk;
  }
  
  // Test 4: Large Amount Test
  async testLargeAmount() {
    console.log('\n=== Test 4: Large Amount Test ===');
    
    const sellAmount = this.toBaseUnits('100', this.decimals.WETH);
    const quote = await this.getQuote(this.tokens.WETH, this.tokens.USDC, sellAmount);
    
    const buyAmount = this.parseAmount(quote.buyAmount, this.decimals.USDC);
    const lpFee = this.parseAmount(quote.lpFee, this.decimals.WETH);
    
    console.log(`Sell Amount: 100 WETH`);
    console.log(`Buy Amount: ${buyAmount.toFixed(0)} USDC`);
    console.log(`LP Fee: ${lpFee.toFixed(1)} WETH`);
    
    // Assertions
    const expectedBuyAmount = 199400; // 100 * 2000 * 0.997
    const expectedLpFee = 0.3; // 100 * 0.003
    
    const buyAmountOk = Math.abs(buyAmount - expectedBuyAmount) < 1000;
    const lpFeeOk = Math.abs(lpFee - expectedLpFee) < 0.01;
    
    console.log(`\nResults:`);
    console.log(`- Buy amount correct: ${buyAmountOk ? '✅' : '❌'} (expected ~${expectedBuyAmount})`);
    console.log(`- LP fee correct: ${lpFeeOk ? '✅' : '❌'} (expected ${expectedLpFee})`);
    
    return buyAmountOk && lpFeeOk;
  }
  
  // Test 5: Custom Slippage Test
  async testCustomSlippage() {
    console.log('\n=== Test 5: Custom Slippage Test ===');
    
    const sellAmount = this.toBaseUnits('1', this.decimals.WETH);
    const quote = await this.getQuote(this.tokens.WETH, this.tokens.USDC, sellAmount, 2.0);
    
    const buyAmount = this.parseAmount(quote.buyAmount, this.decimals.USDC);
    const minReceived = this.parseAmount(quote.minReceived, this.decimals.USDC);
    
    console.log(`Sell Amount: 1 WETH`);
    console.log(`Slippage: 2%`);
    console.log(`Buy Amount: ${buyAmount.toFixed(2)} USDC`);
    console.log(`Minimum Received: ${minReceived.toFixed(2)} USDC`);
    
    // Assertions
    const expectedBuyAmount = 1994;
    const expectedMinReceived = 1954; // 2% less than 1994
    
    const buyAmountOk = Math.abs(buyAmount - expectedBuyAmount) < 10;
    const minReceivedOk = Math.abs(minReceived - expectedMinReceived) < 10;
    
    console.log(`\nResults:`);
    console.log(`- Buy amount correct: ${buyAmountOk ? '✅' : '❌'} (expected ~${expectedBuyAmount})`);
    console.log(`- Min received correct: ${minReceivedOk ? '✅' : '❌'} (expected ~${expectedMinReceived})`);
    
    return buyAmountOk && minReceivedOk;
  }
  
  // Test 6: Zero/Invalid Amount Test
  async testZeroAmount() {
    console.log('\n=== Test 6: Zero/Invalid Amount Test ===');
    
    try {
      await this.getQuote(this.tokens.WETH, this.tokens.USDC, '0');
      console.log('❌ Expected error for zero amount but got success');
      return false;
    } catch (error) {
      console.log('✅ Correctly rejected zero amount with error:', error.message);
    }
    
    try {
      await this.getQuote(this.tokens.WETH, this.tokens.USDC, '');
      console.log('❌ Expected error for empty amount but got success');
      return false;
    } catch (error) {
      console.log('✅ Correctly rejected empty amount with error:', error.message);
    }
    
    return true;
  }
  
  // Test 7: Reverse Pair Test (USDC to WETH)
  async testReversePair() {
    console.log('\n=== Test 7: Reverse Pair Test (USDC to WETH) ===');
    
    const sellAmount = this.toBaseUnits('2000', this.decimals.USDC);
    const quote = await this.getQuote(this.tokens.USDC, this.tokens.WETH, sellAmount);
    
    const buyAmount = this.parseAmount(quote.buyAmount, this.decimals.WETH);
    
    console.log(`Sell Amount: 2000 USDC`);
    console.log(`Buy Amount: ${buyAmount.toFixed(6)} WETH`);
    
    // Assertions
    const expectedBuyAmount = 0.997; // 2000 / 2000 * 0.997
    
    const buyAmountOk = Math.abs(buyAmount - expectedBuyAmount) < 0.01;
    
    console.log(`\nResults:`);
    console.log(`- Buy amount correct: ${buyAmountOk ? '✅' : '❌'} (expected ~${expectedBuyAmount})`);
    
    return buyAmountOk;
  }
  
  // Test 8: Unknown Token Test
  async testUnknownToken() {
    console.log('\n=== Test 8: Unknown Token Test ===');
    
    const sellAmount = this.toBaseUnits('1', 18); // Assume 18 decimals
    const quote = await this.getQuote(this.tokens.UNKNOWN, this.tokens.USDC, sellAmount);
    
    const buyAmount = this.parseAmount(quote.buyAmount, this.decimals.USDC);
    
    console.log(`Sell Amount: 1 UNKNOWN`);
    console.log(`Buy Amount: ${buyAmount.toFixed(2)} USDC`);
    console.log(`Price used: ${quote.price}`);
    
    // Should generate consistent pricing based on token address
    const quoteOk = buyAmount > 0 && quote.price !== null;
    
    console.log(`\nResults:`);
    console.log(`- Quote generated: ${quoteOk ? '✅' : '❌'}`);
    console.log(`- Price is deterministic based on address`);
    
    return quoteOk;
  }
  
  // Test 9: Cross-chain Quote Test
  async testCrossChainQuote() {
    console.log('\n=== Test 9: Cross-chain Quote Test ===');
    
    const sellAmount = this.toBaseUnits('1', this.decimals.WETH);
    const response = await axios.post(`${this.baseUrl}/api/quote-profitable`, {
      sellToken: this.tokens.WETH,
      buyToken: this.tokens.USDC,
      sellAmount,
      chainId: 1,
      toChainId: 137, // Polygon
      slippageTolerance: '0.5'
    });
    
    const quote = response.data;
    
    console.log(`Sell Token Chain: ${quote.chainId}`);
    console.log(`Buy Token Chain: ${quote.toChainId}`);
    console.log(`Quote generated: ${quote.buyAmount ? '✅' : '❌'}`);
    
    const crossChainOk = quote.chainId === 1 && quote.toChainId === 137 && quote.buyAmount;
    
    console.log(`\nResults:`);
    console.log(`- Cross-chain quote correct: ${crossChainOk ? '✅' : '❌'}`);
    
    return crossChainOk;
  }
  
  // Test 10: High Slippage Warning Test
  async testHighSlippage() {
    console.log('\n=== Test 10: High Slippage Warning Test ===');
    
    const sellAmount = this.toBaseUnits('1', this.decimals.WETH);
    const quote = await this.getQuote(this.tokens.WETH, this.tokens.USDC, sellAmount, 5.0);
    
    const buyAmount = this.parseAmount(quote.buyAmount, this.decimals.USDC);
    const minReceived = this.parseAmount(quote.minReceived, this.decimals.USDC);
    const slippagePercent = ((buyAmount - minReceived) / buyAmount) * 100;
    
    console.log(`Sell Amount: 1 WETH`);
    console.log(`Slippage: 5%`);
    console.log(`Buy Amount: ${buyAmount.toFixed(2)} USDC`);
    console.log(`Minimum Received: ${minReceived.toFixed(2)} USDC`);
    console.log(`Actual Slippage: ${slippagePercent.toFixed(2)}%`);
    
    // Check if minimum received reflects high slippage
    const expectedMinReceived = buyAmount * 0.95; // 5% slippage
    const slippageOk = Math.abs(minReceived - expectedMinReceived) < 1;
    const warningNeeded = slippagePercent >= 5;
    
    console.log(`\nResults:`);
    console.log(`- Min received reflects 5% slippage: ${slippageOk ? '✅' : '❌'}`);
    console.log(`- High slippage warning needed: ${warningNeeded ? '⚠️ Yes' : 'No'}`);
    
    return slippageOk;
  }
  
  // Run all tests
  async runAllTests() {
    console.log('Starting Quote Generation Tests...\n');
    console.log('API Endpoint:', `${this.baseUrl}/api/quote-profitable`);
    
    const results = [];
    const tests = [
      { name: 'Basic WETH to USDC', fn: () => this.testBasicWETHtoUSDC() },
      { name: 'Stablecoin to Stablecoin', fn: () => this.testStablecoinToStablecoin() },
      { name: 'Small Amount', fn: () => this.testSmallAmount() },
      { name: 'Large Amount', fn: () => this.testLargeAmount() },
      { name: 'Custom Slippage', fn: () => this.testCustomSlippage() },
      { name: 'Zero/Invalid Amount', fn: () => this.testZeroAmount() },
      { name: 'Reverse Pair', fn: () => this.testReversePair() },
      { name: 'Unknown Token', fn: () => this.testUnknownToken() },
      { name: 'Cross-chain Quote', fn: () => this.testCrossChainQuote() },
      { name: 'High Slippage', fn: () => this.testHighSlippage() }
    ];
    
    for (const test of tests) {
      try {
        const passed = await test.fn();
        results.push({ name: test.name, passed });
      } catch (error) {
        console.error(`\n❌ Test "${test.name}" failed with error:`, error.message);
        results.push({ name: test.name, passed: false, error: error.message });
      }
    }
    
    // Summary
    console.log('\n=== Test Summary ===');
    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    
    results.forEach(r => {
      console.log(`${r.passed ? '✅' : '❌'} ${r.name}${r.error ? ` (${r.error})` : ''}`);
    });
    
    console.log(`\nTotal: ${passed} passed, ${failed} failed`);
    
    return failed === 0;
  }
}

// Export for use as module
module.exports = QuoteGenerationTest;

// Run tests if executed directly
if (require.main === module) {
  const tester = new QuoteGenerationTest(process.env.API_URL || 'http://localhost:3000');
  
  tester.runAllTests().then(success => {
    process.exit(success ? 0 : 1);
  }).catch(error => {
    console.error('Test suite failed:', error);
    process.exit(1);
  });
}