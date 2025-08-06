// Settlement Connector - Bridges off-chain orders to on-chain settlement
const { ethers } = require('ethers');
const FixedEscrowABI = require('../artifacts/contracts/FixedEscrow.sol/FixedEscrow.json').abi;

class SettlementConnector {
  constructor(config) {
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    this.escrowAddress = config.escrowAddress || process.env.ESCROW_CONTRACT_ADDRESS;
    this.privateKey = config.privateKey || process.env.SETTLEMENT_PRIVATE_KEY;
    
    if (this.privateKey) {
      this.signer = new ethers.Wallet(this.privateKey, this.provider);
    }
  }

  /**
   * Settles matched orders on-chain
   * @param {Object} buyOrder - The buy order
   * @param {Object} sellOrder - The sell order
   * @returns {Object} Transaction receipt
   */
  async settleMatchedOrders(buyOrder, sellOrder) {
    console.log('🔄 Initiating on-chain settlement...');
    
    // 1. Verify orders match
    if (!this.validateMatch(buyOrder, sellOrder)) {
      throw new Error('Orders do not match');
    }

    // 2. Create settlement transaction
    const escrow = new ethers.Contract(this.escrowAddress, FixedEscrowABI, this.signer);
    
    try {
      // For production, you'd call your actual settlement method
      // This is a simplified example
      const tx = await escrow.settleOrders(
        [buyOrder, sellOrder],
        [buyOrder.signature, sellOrder.signature],
        {
          gasLimit: 500000 // Adjust based on your contract
        }
      );

      console.log('📤 Settlement transaction sent:', tx.hash);
      
      // Wait for confirmation
      const receipt = await tx.wait();
      console.log('✅ Settlement confirmed on-chain!');
      
      return {
        success: true,
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString()
      };
      
    } catch (error) {
      console.error('❌ Settlement failed:', error);
      throw error;
    }
  }

  /**
   * Validates that orders match
   */
  validateMatch(buyOrder, sellOrder) {
    return (
      buyOrder.buyToken.toLowerCase() === sellOrder.sellToken.toLowerCase() &&
      buyOrder.sellToken.toLowerCase() === sellOrder.buyToken.toLowerCase() &&
      BigInt(buyOrder.buyAmount) >= BigInt(sellOrder.sellAmount) &&
      BigInt(sellOrder.buyAmount) <= BigInt(buyOrder.sellAmount)
    );
  }

  /**
   * Monitors pending settlements
   */
  async monitorSettlement(txHash) {
    const receipt = await this.provider.waitForTransaction(txHash);
    return receipt.status === 1 ? 'success' : 'failed';
  }
}

// Export for use in your API
module.exports = { SettlementConnector };

/* 
USAGE IN YOUR API:

const settlement = new SettlementConnector({
  rpcUrl: 'https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY',
  escrowAddress: '0x...your-escrow-contract',
  privateKey: 'your-settlement-bot-private-key'
});

// When orders match in your system:
const result = await settlement.settleMatchedOrders(buyOrder, sellOrder);
*/