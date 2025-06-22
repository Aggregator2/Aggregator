import { expect } from 'chai';
import { ethers } from 'ethers';
import sinon from 'sinon';
import { CrossChainRouter } from './CrossChainRouter';
import { CrossChainSwapRequest, SwapRoute } from './types';

describe('CrossChainRouter', () => {
  let router: CrossChainRouter;
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    router = new CrossChainRouter();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('getRoutes', () => {
    it('should find routes for ETH to USDC cross-chain swap', async () => {
      const request: CrossChainSwapRequest = {
        sourceChainId: 1,
        destinationChainId: 56,
        sourceToken: ethers.constants.AddressZero,
        destinationToken: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
        sourceAmount: ethers.utils.parseEther('1').toString(),
        recipientAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD7e'
      };

      // Mock the pathfinder response
      const mockRoutes: SwapRoute[] = [
        {
          id: 'route-1',
          steps: [
            {
              type: 'swap',
              chainId: 1,
              protocol: '1inch',
              fromToken: {
                address: ethers.constants.AddressZero,
                symbol: 'ETH',
                name: 'Ethereum',
                decimals: 18,
                chainId: 1
              },
              toToken: {
                address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
                symbol: 'USDC',
                name: 'USD Coin',
                decimals: 6,
                chainId: 1
              },
              fromAmount: ethers.utils.parseEther('1').toString(),
              estimatedToAmount: ethers.utils.parseUnits('2000', 6).toString(),
              gasCost: '200000'
            },
            {
              type: 'bridge',
              chainId: 1,
              protocol: 'lifi',
              fromToken: {
                address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
                symbol: 'USDC',
                name: 'USD Coin',
                decimals: 6,
                chainId: 1
              },
              toToken: {
                address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
                symbol: 'USDC',
                name: 'USD Coin',
                decimals: 6,
                chainId: 56
              },
              fromAmount: ethers.utils.parseUnits('2000', 6).toString(),
              estimatedToAmount: ethers.utils.parseUnits('1995', 6).toString(),
              gasCost: '300000'
            }
          ],
          estimatedOutput: ethers.utils.parseUnits('1995', 6).toString(),
          totalFeeUSD: 5,
          totalGasCostUSD: 10,
          estimatedTime: 600,
          priceImpact: 25,
          reliability: 95
        }
      ];

      // Stub the pathfinder
      sandbox.stub(router['pathFinder'], 'findOptimalRoute').resolves(mockRoutes);

      const routes = await router.getRoutes(request);

      expect(routes).to.have.lengthOf(1);
      expect(routes[0].steps).to.have.lengthOf(2);
      expect(routes[0].steps[0].type).to.equal('swap');
      expect(routes[0].steps[1].type).to.equal('bridge');
      expect(routes[0].estimatedOutput).to.equal(ethers.utils.parseUnits('1995', 6).toString());
    });

    it('should throw error for invalid request', async () => {
      const invalidRequest: CrossChainSwapRequest = {
        sourceChainId: 1,
        destinationChainId: 56,
        sourceToken: '',
        destinationToken: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
        sourceAmount: '0',
        recipientAddress: '0xInvalidAddress'
      };

      try {
        await router.getRoutes(invalidRequest);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.include('Invalid swap request');
      }
    });

    it('should throw error when no routes found', async () => {
      const request: CrossChainSwapRequest = {
        sourceChainId: 1,
        destinationChainId: 56,
        sourceToken: '0xObscureToken',
        destinationToken: '0xAnotherObscureToken',
        sourceAmount: '1000000',
        recipientAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD7e'
      };

      sandbox.stub(router['pathFinder'], 'findOptimalRoute').resolves([]);

      try {
        await router.getRoutes(request);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.include('No routes found');
      }
    });
  });

  describe('getQuote', () => {
    it('should return quote for best route', async () => {
      const request: CrossChainSwapRequest = {
        sourceChainId: 1,
        destinationChainId: 56,
        sourceToken: ethers.constants.AddressZero,
        destinationToken: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
        sourceAmount: ethers.utils.parseEther('1').toString(),
        recipientAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD7e'
      };

      const mockRoute: SwapRoute = {
        id: 'route-1',
        steps: [],
        estimatedOutput: ethers.utils.parseUnits('1995', 6).toString(),
        totalFeeUSD: 5,
        totalGasCostUSD: 10,
        estimatedTime: 600,
        priceImpact: 25,
        reliability: 95
      };

      sandbox.stub(router, 'getRoutes').resolves([mockRoute]);

      const quote = await router.getQuote(request);

      expect(quote.outputAmount).to.equal(ethers.utils.parseUnits('1995', 6).toString());
      expect(quote.totalFeeUSD).to.equal(15);
      expect(quote.priceImpact).to.equal(25);
      expect(quote.executionTime).to.equal(600);
    });
  });

  describe('getSupportedChains', () => {
    it('should return supported chain IDs', () => {
      const chains = router.getSupportedChains();
      
      expect(chains).to.be.an('array');
      expect(chains).to.include(1);    // Ethereum
      expect(chains).to.include(56);   // BSC
      expect(chains).to.include(137);  // Polygon
    });
  });

  describe('estimateGasCosts', () => {
    it('should calculate gas costs for a route', async () => {
      const route: SwapRoute = {
        id: 'test-route',
        steps: [
          {
            type: 'swap',
            chainId: 1,
            protocol: '1inch',
            fromToken: {} as any,
            toToken: {} as any,
            fromAmount: '1000',
            estimatedToAmount: '1000',
            gasCost: '200000'
          },
          {
            type: 'bridge',
            chainId: 1,
            protocol: 'lifi',
            fromToken: {} as any,
            toToken: {} as any,
            fromAmount: '1000',
            estimatedToAmount: '1000',
            gasCost: '300000'
          }
        ],
        estimatedOutput: '1000',
        totalFeeUSD: 0,
        totalGasCostUSD: 0,
        estimatedTime: 0,
        priceImpact: 0,
        reliability: 0
      };

      // Mock gas price and native token price
      sandbox.stub(router['tokenService'], 'getGasPrice').resolves(ethers.utils.parseUnits('30', 'gwei'));
      sandbox.stub(router['tokenService'], 'getNativeTokenPrice').resolves(2000); // $2000 ETH

      const gasCosts = await router.estimateGasCosts(route);

      expect(gasCosts.totalGasUnits).to.equal('500000');
      expect(gasCosts.breakdown).to.have.lengthOf(2);
      expect(gasCosts.totalGasCostUSD).to.be.greaterThan(0);
    });
  });

  describe('buildTransaction', () => {
    it('should build transaction for swap step', async () => {
      const route: SwapRoute = {
        id: 'test-route',
        steps: [
          {
            type: 'swap',
            chainId: 1,
            protocol: '1inch',
            fromToken: {
              address: ethers.constants.AddressZero,
              symbol: 'ETH',
              name: 'Ethereum',
              decimals: 18,
              chainId: 1
            },
            toToken: {
              address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
              symbol: 'USDC',
              name: 'USD Coin',
              decimals: 6,
              chainId: 1
            },
            fromAmount: ethers.utils.parseEther('1').toString(),
            estimatedToAmount: ethers.utils.parseUnits('2000', 6).toString(),
            gasCost: '200000'
          }
        ],
        estimatedOutput: '2000',
        totalFeeUSD: 0,
        totalGasCostUSD: 0,
        estimatedTime: 0,
        priceImpact: 0,
        reliability: 0
      };

      const mockTx = {
        to: '0x1111111254fb6c44bAC0beD2854e76F90643097d',
        data: '0x12345678',
        value: '0',
        gas: '200000'
      };

      sandbox.stub(router['dexAggregator'], 'getBuildTx').resolves(mockTx);

      const tx = await router.buildTransaction(route, 0, '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD7e');

      expect(tx.to).to.equal(mockTx.to);
      expect(tx.data).to.equal(mockTx.data);
      expect(tx.value).to.equal(mockTx.value);
      expect(tx.chainId).to.equal(1);
    });
  });
});

describe('Edge Cases and Error Handling', () => {
  let router: CrossChainRouter;
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    router = new CrossChainRouter();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should handle bridge failure gracefully', async () => {
    const request: CrossChainSwapRequest = {
      sourceChainId: 1,
      destinationChainId: 56,
      sourceToken: ethers.constants.AddressZero,
      destinationToken: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
      sourceAmount: ethers.utils.parseEther('1').toString(),
      recipientAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD7e'
    };

    // Mock insufficient balance
    sandbox.stub(router['tokenService'], 'getTokenBalance').resolves('0');

    const result = await router.executeSwap(request);

    expect(result.success).to.be.false;
    expect(result.error).to.include('Insufficient balance');
  });

  it('should handle high slippage scenarios', async () => {
    const request: CrossChainSwapRequest = {
      sourceChainId: 1,
      destinationChainId: 56,
      sourceToken: ethers.constants.AddressZero,
      destinationToken: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
      sourceAmount: ethers.utils.parseEther('1').toString(),
      recipientAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD7e',
      maxPriceImpact: 100 // 1% max impact
    };

    const mockRoute: SwapRoute = {
      id: 'high-impact-route',
      steps: [],
      estimatedOutput: '1900000000', // 1900 USDC
      totalFeeUSD: 5,
      totalGasCostUSD: 10,
      estimatedTime: 600,
      priceImpact: 500, // 5% impact - too high
      reliability: 95
    };

    sandbox.stub(router['pathFinder'], 'findOptimalRoute').resolves([mockRoute]);

    const routes = await router.getRoutes(request);
    
    // Router should still return the route, but user can check price impact
    expect(routes[0].priceImpact).to.equal(500);
  });

  it('should handle network congestion', async () => {
    const route: SwapRoute = {
      id: 'test-route',
      steps: [{
        type: 'swap',
        chainId: 1,
        protocol: '1inch',
        fromToken: {} as any,
        toToken: {} as any,
        fromAmount: '1000',
        estimatedToAmount: '1000',
        gasCost: '200000',
        gasPrice: ethers.utils.parseUnits('200', 'gwei').toString() // High gas price
      }],
      estimatedOutput: '1000',
      totalFeeUSD: 0,
      totalGasCostUSD: 0,
      estimatedTime: 0,
      priceImpact: 0,
      reliability: 0
    };

    sandbox.stub(router['tokenService'], 'getGasPrice').resolves(ethers.utils.parseUnits('200', 'gwei'));
    sandbox.stub(router['tokenService'], 'getNativeTokenPrice').resolves(2000);

    const gasCosts = await router.estimateGasCosts(route);
    
    // Gas cost should be high due to congestion
    expect(gasCosts.totalGasCostUSD).to.be.greaterThan(50);
  });
});