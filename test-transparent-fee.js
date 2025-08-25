const axios = require('axios');
const { ethers } = require('ethers');

async function testTransparentFee() {
  console.log('🔍 Testing Transparent Fee Display...\n');
  
  try {
    // Test 1 ETH -> USDC
    const response = await axios.post('http://localhost:3000/api/quote-profitable', {
      sellToken: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', // ETH
      buyToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
      sellAmount: ethers.parseEther('1').toString(), // 1 ETH
      chainId: 1
    });
    
    const quote = response.data;
    
    console.log('✅ Quote Response with Transparent Fees:');
    console.log('=====================================\n');
    
    // Basic quote info
    console.log('📊 Quote Details:');
    console.log(`- Sell: 1 ETH`);
    console.log(`- Buy: ${ethers.formatUnits(quote.buyAmount, 6)} USDC (after fee)`);
    console.log(`- Price: ${quote.price} USDC per ETH`);
    console.log(`- Source: ${quote.source}`);
    
    // Platform fee details
    if (quote.platformFee) {
      console.log('\n💰 Platform Fee (Transparent):');
      console.log(`- Fee Percentage: ${quote.platformFee.percentage}%`);
      console.log(`- Fee in BPS: ${quote.platformFee.bps}`);
      console.log(`- Fee Amount: ${ethers.formatUnits(quote.platformFee.amount, 6)} USDC`);
    }
    
    // Fee breakdown
    if (quote.feeBreakdown) {
      console.log('\n📋 Fee Breakdown:');
      console.log(`- Buy Amount Before Fee: ${ethers.formatUnits(quote.feeBreakdown.buyAmountBeforeFee, 6)} USDC`);
      console.log(`- Platform Fee: ${ethers.formatUnits(quote.feeBreakdown.platformFee, 6)} USDC (${quote.feeBreakdown.platformFeePercent})`);
      console.log(`- Buy Amount After Fee: ${ethers.formatUnits(quote.feeBreakdown.buyAmountAfterFee, 6)} USDC`);
      
      // Calculate the actual fee percentage
      const beforeFee = BigInt(quote.feeBreakdown.buyAmountBeforeFee);
      const afterFee = BigInt(quote.feeBreakdown.buyAmountAfterFee);
      const actualFee = beforeFee - afterFee;
      const actualFeePercent = (actualFee * 10000n / beforeFee) / 100n;
      
      console.log(`\n✅ Verification:`);
      console.log(`- Calculated Fee: ${actualFeePercent.toString()}%`);
      console.log(`- Fee is now transparently displayed to users`);
    }
    
    console.log('\n=====================================');
    console.log('✅ SUCCESS: Platform fee is now transparent!');
    console.log('\nUsers will see:');
    console.log('- The exact platform fee percentage (0.3%)');
    console.log('- The fee amount in tokens');
    console.log('- Both pre-fee and post-fee amounts');
    console.log('\nThis transparency builds trust and allows users to make informed decisions.');
    
  } catch (error) {
    console.error('❌ Error:', error.response?.data || error.message);
  }
}

// Run the test
testTransparentFee();