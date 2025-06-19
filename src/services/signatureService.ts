import { ethers } from 'ethers';
import { nonceService } from './nonceService';
import { logger } from '../utils/logger';

export interface OrderData {
  orderNumber: string;
  userId: string;
  totalAmount: string;
  currency: string;
  items: Array<{
    productId: string;
    quantity: number;
    price: string;
  }>;
  nonce: string;
  deadline: number;
  chainId: number;
}

export class SignatureService {
  private readonly DOMAIN_NAME = 'Aggregator DEX';
  private readonly DOMAIN_VERSION = '1';

  getDomain(chainId: number) {
    return {
      name: this.DOMAIN_NAME,
      version: this.DOMAIN_VERSION,
      chainId,
      verifyingContract: process.env.ESCROW_CONTRACT_ADDRESS || '0x0000000000000000000000000000000000000000'
    };
  }

  getOrderTypes() {
    return {
      Order: [
        { name: 'orderNumber', type: 'string' },
        { name: 'userId', type: 'string' },
        { name: 'totalAmount', type: 'uint256' },
        { name: 'currency', type: 'string' },
        { name: 'items', type: 'Item[]' },
        { name: 'nonce', type: 'string' },
        { name: 'deadline', type: 'uint256' }
      ],
      Item: [
        { name: 'productId', type: 'string' },
        { name: 'quantity', type: 'uint256' },
        { name: 'price', type: 'uint256' }
      ]
    };
  }

  async createOrderHash(orderData: OrderData): Promise<string> {
    const domain = this.getDomain(orderData.chainId);
    const types = this.getOrderTypes();

    // Convert string amounts to wei
    const orderValue = {
      ...orderData,
      totalAmount: ethers.parseEther(orderData.totalAmount).toString(),
      items: orderData.items.map(item => ({
        ...item,
        price: ethers.parseEther(item.price).toString()
      }))
    };

    const hash = ethers.TypedDataEncoder.hash(domain, types, orderValue);
    return hash;
  }

  async verifyOrderSignature(
    orderData: OrderData,
    signature: string,
    expectedSigner: string
  ): Promise<boolean> {
    try {
      // Validate nonce first
      const isValidNonce = await nonceService.validateNonce(expectedSigner, orderData.nonce);
      if (!isValidNonce) {
        logger.warn('Invalid or reused nonce', { 
          signer: expectedSigner, 
          nonce: orderData.nonce 
        });
        return false;
      }

      // Check deadline
      if (orderData.deadline < Date.now() / 1000) {
        logger.warn('Order expired', { 
          deadline: orderData.deadline, 
          now: Date.now() / 1000 
        });
        return false;
      }

      const domain = this.getDomain(orderData.chainId);
      const types = this.getOrderTypes();

      // Convert string amounts to wei for verification
      const orderValue = {
        ...orderData,
        totalAmount: ethers.parseEther(orderData.totalAmount).toString(),
        items: orderData.items.map(item => ({
          ...item,
          price: ethers.parseEther(item.price).toString()
        }))
      };

      const recoveredAddress = ethers.verifyTypedData(
        domain,
        types,
        orderValue,
        signature
      );

      const isValid = recoveredAddress.toLowerCase() === expectedSigner.toLowerCase();
      
      if (isValid) {
        logger.info('Valid signature verified', { 
          signer: expectedSigner, 
          orderNumber: orderData.orderNumber 
        });
      } else {
        logger.warn('Invalid signature', { 
          expected: expectedSigner, 
          recovered: recoveredAddress,
          orderNumber: orderData.orderNumber 
        });
      }

      return isValid;
    } catch (error) {
      logger.error('Signature verification error:', error);
      return false;
    }
  }

  async createQuoteSignature(
    quoteData: {
      quoteId: string;
      tokenIn: string;
      tokenOut: string;
      amountIn: string;
      amountOut: string;
      price: string;
      validUntil: number;
      chainId: number;
    }
  ): Promise<{ signature: string; hash: string }> {
    const domain = this.getDomain(quoteData.chainId);
    
    const types = {
      Quote: [
        { name: 'quoteId', type: 'string' },
        { name: 'tokenIn', type: 'address' },
        { name: 'tokenOut', type: 'address' },
        { name: 'amountIn', type: 'uint256' },
        { name: 'amountOut', type: 'uint256' },
        { name: 'price', type: 'uint256' },
        { name: 'validUntil', type: 'uint256' }
      ]
    };

    const value = {
      ...quoteData,
      amountIn: ethers.parseEther(quoteData.amountIn).toString(),
      amountOut: ethers.parseEther(quoteData.amountOut).toString(),
      price: ethers.parseEther(quoteData.price).toString()
    };

    // In production, this would use a secure key management service
    const signer = new ethers.Wallet(process.env.PRIVATE_KEY || '0x0');
    
    const signature = await signer.signTypedData(domain, types, value);
    const hash = ethers.TypedDataEncoder.hash(domain, types, value);

    // Store quote for validation
    await nonceService.storeQuote(quoteData.quoteId, {
      ...quoteData,
      signature,
      hash,
      signer: signer.address
    }, quoteData.validUntil - Math.floor(Date.now() / 1000));

    return { signature, hash };
  }

  async verifyQuoteSignature(
    quoteId: string,
    signature: string
  ): Promise<{ valid: boolean; quoteData?: any }> {
    try {
      const storedQuote = await nonceService.getQuote(quoteId);
      if (!storedQuote) {
        return { valid: false };
      }

      // Check if quote has already been used
      const canUse = await nonceService.validateQuoteUsage(quoteId);
      if (!canUse) {
        logger.warn('Quote already used', { quoteId });
        return { valid: false };
      }

      // Verify the signature matches
      if (storedQuote.signature !== signature) {
        logger.warn('Signature mismatch', { quoteId });
        return { valid: false };
      }

      return { valid: true, quoteData: storedQuote };
    } catch (error) {
      logger.error('Quote verification error:', error);
      return { valid: false };
    }
  }
}

export const signatureService = new SignatureService();