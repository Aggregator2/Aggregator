import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { domain, types } from "../../../lib/eip712";
import { signatureService } from "../../../src/services/signatureService";

describe("EIP-712 Signature Handling Tests", function () {
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let carol: SignerWithAddress;
  let attacker: SignerWithAddress;
  
  const TEST_CHAIN_ID = 31337; // Hardhat network
  const VERIFYING_CONTRACT = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";

  beforeEach(async function () {
    [alice, bob, carol, attacker] = await ethers.getSigners();
  });

  describe("Domain Separator Configuration", function () {
    it("Should generate correct domain separator", async function () {
      const expectedDomain = {
        name: "MetaAggregator",
        version: "1",
        chainId: TEST_CHAIN_ID,
        verifyingContract: VERIFYING_CONTRACT
      };
      
      expect(domain.name).to.equal(expectedDomain.name);
      expect(domain.version).to.equal(expectedDomain.version);
      expect(domain.chainId).to.equal(expectedDomain.chainId);
      expect(domain.verifyingContract).to.equal(expectedDomain.verifyingContract);
      
      // Verify domain separator hash
      const domainSeparator = ethers.utils._TypedDataEncoder.hashDomain(domain);
      expect(domainSeparator).to.be.a('string');
      expect(domainSeparator).to.have.lengthOf(66); // 0x + 64 hex chars
    });

    it("Should handle different chain IDs correctly", async function () {
      const chains = [
        { id: 1, name: "Ethereum Mainnet" },
        { id: 137, name: "Polygon" },
        { id: 42161, name: "Arbitrum One" },
        { id: 10, name: "Optimism" }
      ];
      
      for (const chain of chains) {
        const chainDomain = {
          ...domain,
          chainId: chain.id
        };
        
        const separator1 = ethers.utils._TypedDataEncoder.hashDomain(chainDomain);
        const separator2 = ethers.utils._TypedDataEncoder.hashDomain(chainDomain);
        
        // Same chain ID should produce same separator
        expect(separator1).to.equal(separator2);
        
        // Different chain IDs should produce different separators
        if (chain.id !== TEST_CHAIN_ID) {
          const testSeparator = ethers.utils._TypedDataEncoder.hashDomain(domain);
          expect(separator1).to.not.equal(testSeparator);
        }
      }
    });

    it("Should validate verifying contract address", async function () {
      const invalidAddresses = [
        "0x0",
        "0x00",
        "invalid",
        "0xG234567890123456789012345678901234567890", // Invalid hex
        "0x12345", // Too short
      ];
      
      for (const addr of invalidAddresses) {
        expect(() => {
          ethers.utils._TypedDataEncoder.hashDomain({
            ...domain,
            verifyingContract: addr
          });
        }).to.throw();
      }
    });
  });

  describe("Order Signing and Verification", function () {
    it("Should sign and verify basic order", async function () {
      const order = {
        sellToken: "0x0000000000000000000000000000000000000001",
        buyToken: "0x0000000000000000000000000000000000000002",
        sellAmount: ethers.utils.parseEther("100"),
        buyAmount: ethers.utils.parseEther("200"),
        validTo: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
        user: alice.address,
        receiver: alice.address,
        appData: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
        feeAmount: ethers.utils.parseEther("1"),
        partiallyFillable: true,
        kind: "sell",
        signingScheme: "eip712"
      };
      
      // Sign the order
      const signature = await alice._signTypedData(domain, types, order);
      
      // Verify signature
      const recoveredAddress = ethers.utils.verifyTypedData(
        domain,
        types,
        order,
        signature
      );
      
      expect(recoveredAddress.toLowerCase()).to.equal(alice.address.toLowerCase());
    });

    it("Should handle complex nested order structures", async function () {
      const complexTypes = {
        Order: [
          { name: "details", type: "OrderDetails" },
          { name: "execution", type: "ExecutionParams" },
          { name: "metadata", type: "OrderMetadata" }
        ],
        OrderDetails: [
          { name: "sellToken", type: "address" },
          { name: "buyToken", type: "address" },
          { name: "amounts", type: "TokenAmounts" }
        ],
        TokenAmounts: [
          { name: "sellAmount", type: "uint256" },
          { name: "buyAmount", type: "uint256" },
          { name: "feeAmount", type: "uint256" }
        ],
        ExecutionParams: [
          { name: "validTo", type: "uint256" },
          { name: "partiallyFillable", type: "bool" },
          { name: "limitPrice", type: "uint256" }
        ],
        OrderMetadata: [
          { name: "user", type: "address" },
          { name: "receiver", type: "address" },
          { name: "nonce", type: "uint256" }
        ]
      };
      
      const complexOrder = {
        details: {
          sellToken: "0x0000000000000000000000000000000000000001",
          buyToken: "0x0000000000000000000000000000000000000002",
          amounts: {
            sellAmount: ethers.utils.parseEther("100"),
            buyAmount: ethers.utils.parseEther("200"),
            feeAmount: ethers.utils.parseEther("1")
          }
        },
        execution: {
          validTo: Math.floor(Date.now() / 1000) + 3600,
          partiallyFillable: true,
          limitPrice: ethers.utils.parseEther("2.1")
        },
        metadata: {
          user: alice.address,
          receiver: bob.address,
          nonce: 12345
        }
      };
      
      const signature = await alice._signTypedData(domain, complexTypes, complexOrder);
      const recovered = ethers.utils.verifyTypedData(domain, complexTypes, complexOrder, signature);
      
      expect(recovered.toLowerCase()).to.equal(alice.address.toLowerCase());
    });

    it("Should handle batch order signing", async function () {
      const orders = [];
      const signatures = [];
      
      // Create and sign multiple orders
      for (let i = 0; i < 10; i++) {
        const order = {
          sellToken: "0x0000000000000000000000000000000000000001",
          buyToken: "0x0000000000000000000000000000000000000002",
          sellAmount: ethers.utils.parseEther((100 + i).toString()),
          buyAmount: ethers.utils.parseEther((200 + i * 2).toString()),
          validTo: Math.floor(Date.now() / 1000) + 3600,
          user: alice.address,
          receiver: alice.address,
          appData: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
          feeAmount: ethers.utils.parseEther("1"),
          partiallyFillable: true,
          kind: "sell",
          signingScheme: "eip712"
        };
        
        orders.push(order);
        signatures.push(await alice._signTypedData(domain, types, order));
      }
      
      // Verify all signatures
      for (let i = 0; i < orders.length; i++) {
        const recovered = ethers.utils.verifyTypedData(
          domain,
          types,
          orders[i],
          signatures[i]
        );
        expect(recovered.toLowerCase()).to.equal(alice.address.toLowerCase());
      }
    });

    it("Should use SignatureService for order operations", async function () {
      const orderData = {
        orderNumber: "ORD-001",
        userId: alice.address,
        totalAmount: "100.5",
        currency: "ETH",
        items: [
          {
            productId: "PROD-001",
            quantity: 2,
            price: "50.25"
          }
        ],
        nonce: "nonce-" + Date.now(),
        deadline: Math.floor(Date.now() / 1000) + 3600,
        chainId: TEST_CHAIN_ID
      };
      
      // Create order hash
      const orderHash = await signatureService.createOrderHash(orderData);
      expect(orderHash).to.be.a('string');
      expect(orderHash).to.have.lengthOf(66);
      
      // Sign the order using SignatureService types
      const serviceDomain = signatureService.getDomain(TEST_CHAIN_ID);
      const serviceTypes = signatureService.getOrderTypes();
      
      const orderValue = {
        ...orderData,
        totalAmount: ethers.utils.parseEther(orderData.totalAmount).toString(),
        items: orderData.items.map(item => ({
          ...item,
          price: ethers.utils.parseEther(item.price).toString()
        }))
      };
      
      const signature = await alice._signTypedData(serviceDomain, serviceTypes, orderValue);
      
      // Verify using service
      const isValid = await signatureService.verifyOrderSignature(
        orderData,
        signature,
        alice.address
      );
      
      expect(isValid).to.be.true;
    });
  });

  describe("Signature Recovery", function () {
    it("Should recover signer from valid signature", async function () {
      const message = {
        sellToken: "0x0000000000000000000000000000000000000001",
        buyToken: "0x0000000000000000000000000000000000000002",
        sellAmount: ethers.utils.parseEther("50"),
        buyAmount: ethers.utils.parseEther("100"),
        validTo: Math.floor(Date.now() / 1000) + 3600,
        user: bob.address,
        receiver: bob.address,
        appData: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
        feeAmount: ethers.utils.parseEther("0.5"),
        partiallyFillable: false,
        kind: "buy",
        signingScheme: "eip712"
      };
      
      const signature = await bob._signTypedData(domain, types, message);
      
      // Recover using different methods
      const recovered1 = ethers.utils.verifyTypedData(domain, types, message, signature);
      
      // Manual recovery
      const messageHash = ethers.utils._TypedDataEncoder.hash(domain, types, message);
      const recovered2 = ethers.utils.recoverAddress(messageHash, signature);
      
      expect(recovered1.toLowerCase()).to.equal(bob.address.toLowerCase());
      expect(recovered2.toLowerCase()).to.equal(bob.address.toLowerCase());
    });

    it("Should handle signature malleability", async function () {
      const message = {
        sellToken: "0x0000000000000000000000000000000000000001",
        buyToken: "0x0000000000000000000000000000000000000002",
        sellAmount: ethers.utils.parseEther("100"),
        buyAmount: ethers.utils.parseEther("200"),
        validTo: Math.floor(Date.now() / 1000) + 3600,
        user: alice.address,
        receiver: alice.address,
        appData: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
        feeAmount: ethers.utils.parseEther("1"),
        partiallyFillable: true,
        kind: "sell",
        signingScheme: "eip712"
      };
      
      const signature = await alice._signTypedData(domain, types, message);
      
      // Parse signature components
      const sig = ethers.utils.splitSignature(signature);
      
      // Check v value (should be 27 or 28 for Ethereum signatures)
      expect([27, 28]).to.include(sig.v);
      
      // Create malleable signature by flipping s value
      const n = ethers.BigNumber.from("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");
      const malleableS = n.sub(ethers.BigNumber.from(sig.s));
      
      const malleableSignature = ethers.utils.joinSignature({
        r: sig.r,
        s: malleableS,
        v: sig.v === 27 ? 28 : 27
      });
      
      // Both signatures should recover to same address
      const recovered1 = ethers.utils.verifyTypedData(domain, types, message, signature);
      const recovered2 = ethers.utils.verifyTypedData(domain, types, message, malleableSignature);
      
      expect(recovered1.toLowerCase()).to.equal(alice.address.toLowerCase());
      expect(recovered2.toLowerCase()).to.equal(alice.address.toLowerCase());
    });

    it("Should reject signatures with invalid v values", async function () {
      const message = {
        sellToken: "0x0000000000000000000000000000000000000001",
        buyToken: "0x0000000000000000000000000000000000000002",
        sellAmount: ethers.utils.parseEther("100"),
        buyAmount: ethers.utils.parseEther("200"),
        validTo: Math.floor(Date.now() / 1000) + 3600,
        user: alice.address,
        receiver: alice.address,
        appData: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
        feeAmount: ethers.utils.parseEther("1"),
        partiallyFillable: true,
        kind: "sell",
        signingScheme: "eip712"
      };
      
      const signature = await alice._signTypedData(domain, types, message);
      const sig = ethers.utils.splitSignature(signature);
      
      // Create invalid signatures
      const invalidSignatures = [
        ethers.utils.joinSignature({ ...sig, v: 0 }),
        ethers.utils.joinSignature({ ...sig, v: 1 }),
        ethers.utils.joinSignature({ ...sig, v: 26 }),
        ethers.utils.joinSignature({ ...sig, v: 29 }),
        ethers.utils.joinSignature({ ...sig, v: 255 })
      ];
      
      for (const invalidSig of invalidSignatures) {
        expect(() => {
          ethers.utils.verifyTypedData(domain, types, message, invalidSig);
        }).to.throw();
      }
    });
  });

  describe("Typed Data Structure Validation", function () {
    it("Should validate required fields", async function () {
      const validOrder = {
        sellToken: "0x0000000000000000000000000000000000000001",
        buyToken: "0x0000000000000000000000000000000000000002",
        sellAmount: ethers.utils.parseEther("100"),
        buyAmount: ethers.utils.parseEther("200"),
        validTo: Math.floor(Date.now() / 1000) + 3600,
        user: alice.address,
        receiver: alice.address,
        appData: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
        feeAmount: ethers.utils.parseEther("1"),
        partiallyFillable: true,
        kind: "sell",
        signingScheme: "eip712"
      };
      
      // Test missing fields
      const requiredFields = Object.keys(validOrder);
      
      for (const field of requiredFields) {
        const invalidOrder = { ...validOrder };
        delete invalidOrder[field];
        
        await expect(
          alice._signTypedData(domain, types, invalidOrder)
        ).to.be.rejected;
      }
    });

    it("Should validate field types", async function () {
      const baseOrder = {
        sellToken: "0x0000000000000000000000000000000000000001",
        buyToken: "0x0000000000000000000000000000000000000002",
        sellAmount: ethers.utils.parseEther("100"),
        buyAmount: ethers.utils.parseEther("200"),
        validTo: Math.floor(Date.now() / 1000) + 3600,
        user: alice.address,
        receiver: alice.address,
        appData: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
        feeAmount: ethers.utils.parseEther("1"),
        partiallyFillable: true,
        kind: "sell",
        signingScheme: "eip712"
      };
      
      // Test invalid addresses
      const invalidAddressOrder = {
        ...baseOrder,
        sellToken: "not-an-address"
      };
      
      await expect(
        alice._signTypedData(domain, types, invalidAddressOrder)
      ).to.be.rejected;
      
      // Test invalid uint256
      const invalidAmountOrder = {
        ...baseOrder,
        sellAmount: "not-a-number"
      };
      
      await expect(
        alice._signTypedData(domain, types, invalidAmountOrder)
      ).to.be.rejected;
      
      // Test invalid boolean
      const invalidBoolOrder = {
        ...baseOrder,
        partiallyFillable: "yes" // Should be boolean
      };
      
      await expect(
        alice._signTypedData(domain, types, invalidBoolOrder)
      ).to.be.rejected;
    });

    it("Should handle dynamic arrays in typed data", async function () {
      const arrayTypes = {
        BatchOrder: [
          { name: "orders", type: "Order[]" },
          { name: "batchId", type: "uint256" },
          { name: "executor", type: "address" }
        ],
        Order: [
          { name: "sellToken", type: "address" },
          { name: "buyToken", type: "address" },
          { name: "sellAmount", type: "uint256" },
          { name: "buyAmount", type: "uint256" },
          { name: "validTo", type: "uint256" },
          { name: "user", type: "address" },
          { name: "receiver", type: "address" },
          { name: "appData", type: "bytes" },
          { name: "feeAmount", type: "uint256" },
          { name: "partiallyFillable", type: "bool" },
          { name: "kind", type: "string" },
          { name: "signingScheme", type: "string" }
        ]
      };
      
      const batchOrder = {
        orders: [
          {
            sellToken: "0x0000000000000000000000000000000000000001",
            buyToken: "0x0000000000000000000000000000000000000002",
            sellAmount: ethers.utils.parseEther("100"),
            buyAmount: ethers.utils.parseEther("200"),
            validTo: Math.floor(Date.now() / 1000) + 3600,
            user: alice.address,
            receiver: alice.address,
            appData: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
            feeAmount: ethers.utils.parseEther("1"),
            partiallyFillable: true,
            kind: "sell",
            signingScheme: "eip712"
          },
          {
            sellToken: "0x0000000000000000000000000000000000000003",
            buyToken: "0x0000000000000000000000000000000000000004",
            sellAmount: ethers.utils.parseEther("50"),
            buyAmount: ethers.utils.parseEther("75"),
            validTo: Math.floor(Date.now() / 1000) + 7200,
            user: alice.address,
            receiver: bob.address,
            appData: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
            feeAmount: ethers.utils.parseEther("0.5"),
            partiallyFillable: false,
            kind: "buy",
            signingScheme: "eip712"
          }
        ],
        batchId: 12345,
        executor: carol.address
      };
      
      const signature = await alice._signTypedData(domain, arrayTypes, batchOrder);
      const recovered = ethers.utils.verifyTypedData(domain, arrayTypes, batchOrder, signature);
      
      expect(recovered.toLowerCase()).to.equal(alice.address.toLowerCase());
    });
  });

  describe("Signature Replay Protection", function () {
    it("Should include nonce in signed data", async function () {
      const orderWithNonce = (nonce: number) => ({
        sellToken: "0x0000000000000000000000000000000000000001",
        buyToken: "0x0000000000000000000000000000000000000002",
        sellAmount: ethers.utils.parseEther("100"),
        buyAmount: ethers.utils.parseEther("200"),
        validTo: Math.floor(Date.now() / 1000) + 3600,
        user: alice.address,
        receiver: alice.address,
        appData: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
        feeAmount: ethers.utils.parseEther("1"),
        partiallyFillable: true,
        kind: "sell",
        signingScheme: "eip712",
        nonce: nonce
      });
      
      const typesWithNonce = {
        Order: [
          ...types.Order,
          { name: "nonce", type: "uint256" }
        ]
      };
      
      const order1 = orderWithNonce(1);
      const order2 = orderWithNonce(2);
      
      const sig1 = await alice._signTypedData(domain, typesWithNonce, order1);
      const sig2 = await alice._signTypedData(domain, typesWithNonce, order2);
      
      // Different nonces should produce different signatures
      expect(sig1).to.not.equal(sig2);
      
      // Same order with same nonce should produce same signature
      const sig1Again = await alice._signTypedData(domain, typesWithNonce, order1);
      expect(sig1).to.equal(sig1Again);
    });

    it("Should include deadline/expiry in signed data", async function () {
      const baseOrder = {
        sellToken: "0x0000000000000000000000000000000000000001",
        buyToken: "0x0000000000000000000000000000000000000002",
        sellAmount: ethers.utils.parseEther("100"),
        buyAmount: ethers.utils.parseEther("200"),
        user: alice.address,
        receiver: alice.address,
        appData: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
        feeAmount: ethers.utils.parseEther("1"),
        partiallyFillable: true,
        kind: "sell",
        signingScheme: "eip712"
      };
      
      const now = Math.floor(Date.now() / 1000);
      
      const order1 = { ...baseOrder, validTo: now + 3600 }; // 1 hour
      const order2 = { ...baseOrder, validTo: now + 7200 }; // 2 hours
      
      const sig1 = await alice._signTypedData(domain, types, order1);
      const sig2 = await alice._signTypedData(domain, types, order2);
      
      // Different deadlines should produce different signatures
      expect(sig1).to.not.equal(sig2);
    });

    it("Should prevent cross-chain replay attacks", async function () {
      const order = {
        sellToken: "0x0000000000000000000000000000000000000001",
        buyToken: "0x0000000000000000000000000000000000000002",
        sellAmount: ethers.utils.parseEther("100"),
        buyAmount: ethers.utils.parseEther("200"),
        validTo: Math.floor(Date.now() / 1000) + 3600,
        user: alice.address,
        receiver: alice.address,
        appData: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
        feeAmount: ethers.utils.parseEther("1"),
        partiallyFillable: true,
        kind: "sell",
        signingScheme: "eip712"
      };
      
      // Sign on chain 1
      const domain1 = { ...domain, chainId: 1 };
      const sig1 = await alice._signTypedData(domain1, types, order);
      
      // Sign on chain 137 (Polygon)
      const domain137 = { ...domain, chainId: 137 };
      const sig137 = await alice._signTypedData(domain137, types, order);
      
      // Signatures should be different
      expect(sig1).to.not.equal(sig137);
      
      // Verify signature is only valid on correct chain
      const recovered1 = ethers.utils.verifyTypedData(domain1, types, order, sig1);
      expect(recovered1.toLowerCase()).to.equal(alice.address.toLowerCase());
      
      // sig1 should not verify with domain137
      const messageHash1 = ethers.utils._TypedDataEncoder.hash(domain1, types, order);
      const messageHash137 = ethers.utils._TypedDataEncoder.hash(domain137, types, order);
      expect(messageHash1).to.not.equal(messageHash137);
    });

    it("Should handle order cancellation", async function () {
      const cancelTypes = {
        OrderCancellation: [
          { name: "orderHash", type: "bytes32" },
          { name: "canceller", type: "address" },
          { name: "timestamp", type: "uint256" },
          { name: "reason", type: "string" }
        ]
      };
      
      // Create an order
      const order = {
        sellToken: "0x0000000000000000000000000000000000000001",
        buyToken: "0x0000000000000000000000000000000000000002",
        sellAmount: ethers.utils.parseEther("100"),
        buyAmount: ethers.utils.parseEther("200"),
        validTo: Math.floor(Date.now() / 1000) + 3600,
        user: alice.address,
        receiver: alice.address,
        appData: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
        feeAmount: ethers.utils.parseEther("1"),
        partiallyFillable: true,
        kind: "sell",
        signingScheme: "eip712"
      };
      
      const orderHash = ethers.utils._TypedDataEncoder.hash(domain, types, order);
      
      // Create cancellation
      const cancellation = {
        orderHash: orderHash,
        canceller: alice.address,
        timestamp: Math.floor(Date.now() / 1000),
        reason: "Price changed"
      };
      
      const cancellationSig = await alice._signTypedData(domain, cancelTypes, cancellation);
      const recoveredCanceller = ethers.utils.verifyTypedData(
        domain,
        cancelTypes,
        cancellation,
        cancellationSig
      );
      
      expect(recoveredCanceller.toLowerCase()).to.equal(alice.address.toLowerCase());
    });
  });

  describe("Cross-chain Signature Compatibility", function () {
    it("Should maintain signature format across different chains", async function () {
      const chains = [
        { id: 1, name: "mainnet" },
        { id: 137, name: "polygon" },
        { id: 42161, name: "arbitrum" },
        { id: 10, name: "optimism" },
        { id: 56, name: "bsc" },
        { id: 43114, name: "avalanche" }
      ];
      
      const order = {
        sellToken: "0x0000000000000000000000000000000000000001",
        buyToken: "0x0000000000000000000000000000000000000002",
        sellAmount: ethers.utils.parseEther("100"),
        buyAmount: ethers.utils.parseEther("200"),
        validTo: Math.floor(Date.now() / 1000) + 3600,
        user: alice.address,
        receiver: alice.address,
        appData: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
        feeAmount: ethers.utils.parseEther("1"),
        partiallyFillable: true,
        kind: "sell",
        signingScheme: "eip712"
      };
      
      const signatures = new Map();
      
      for (const chain of chains) {
        const chainDomain = { ...domain, chainId: chain.id };
        const signature = await alice._signTypedData(chainDomain, types, order);
        
        // Verify signature format
        expect(signature).to.match(/^0x[0-9a-fA-F]{130}$/); // 65 bytes = 130 hex chars
        
        const sig = ethers.utils.splitSignature(signature);
        expect(sig.r).to.match(/^0x[0-9a-fA-F]{64}$/);
        expect(sig.s).to.match(/^0x[0-9a-fA-F]{64}$/);
        expect([27, 28]).to.include(sig.v);
        
        signatures.set(chain.id, signature);
      }
      
      // All signatures should be different (due to different chain IDs)
      const uniqueSignatures = new Set(signatures.values());
      expect(uniqueSignatures.size).to.equal(chains.length);
    });

    it("Should handle EIP-1271 contract signatures", async function () {
      // Simulate contract wallet signature
      const contractWalletTypes = {
        EIP1271Signature: [
          { name: "signer", type: "address" },
          { name: "signature", type: "bytes" },
          { name: "contractAddress", type: "address" },
          { name: "nonce", type: "uint256" }
        ]
      };
      
      const order = {
        sellToken: "0x0000000000000000000000000000000000000001",
        buyToken: "0x0000000000000000000000000000000000000002",
        sellAmount: ethers.utils.parseEther("100"),
        buyAmount: ethers.utils.parseEther("200"),
        validTo: Math.floor(Date.now() / 1000) + 3600,
        user: alice.address,
        receiver: alice.address,
        appData: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
        feeAmount: ethers.utils.parseEther("1"),
        partiallyFillable: true,
        kind: "sell",
        signingScheme: "eip712"
      };
      
      // EOA signature
      const eoaSignature = await alice._signTypedData(domain, types, order);
      
      // Wrap in EIP-1271 format
      const eip1271Sig = {
        signer: alice.address,
        signature: eoaSignature,
        contractAddress: "0x0000000000000000000000000000000000000003", // Mock contract
        nonce: 1
      };
      
      const contractSig = await alice._signTypedData(
        domain,
        contractWalletTypes,
        eip1271Sig
      );
      
      expect(contractSig).to.be.a('string');
      expect(contractSig).to.have.lengthOf(132); // 0x + 130 chars
    });
  });

  describe("Quote Signature Operations", function () {
    it("Should create and verify quote signatures", async function () {
      const quoteData = {
        quoteId: "QUOTE-" + Date.now(),
        tokenIn: "0x0000000000000000000000000000000000000001",
        tokenOut: "0x0000000000000000000000000000000000000002",
        amountIn: "100",
        amountOut: "200",
        price: "2.0",
        validUntil: Math.floor(Date.now() / 1000) + 300, // 5 minutes
        chainId: TEST_CHAIN_ID
      };
      
      // Mock private key for testing
      process.env.PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
      
      const { signature, hash } = await signatureService.createQuoteSignature(quoteData);
      
      expect(signature).to.be.a('string');
      expect(signature).to.have.lengthOf(132);
      expect(hash).to.be.a('string');
      expect(hash).to.have.lengthOf(66);
      
      // Verify the quote
      const verifyResult = await signatureService.verifyQuoteSignature(
        quoteData.quoteId,
        signature
      );
      
      expect(verifyResult.valid).to.be.true;
      expect(verifyResult.quoteData).to.exist;
    });

    it("Should reject expired quotes", async function () {
      const quoteData = {
        quoteId: "QUOTE-EXPIRED-" + Date.now(),
        tokenIn: "0x0000000000000000000000000000000000000001",
        tokenOut: "0x0000000000000000000000000000000000000002",
        amountIn: "100",
        amountOut: "200",
        price: "2.0",
        validUntil: Math.floor(Date.now() / 1000) - 100, // Already expired
        chainId: TEST_CHAIN_ID
      };
      
      process.env.PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
      
      const { signature } = await signatureService.createQuoteSignature(quoteData);
      
      // Manually mark as expired in the service
      const verifyResult = await signatureService.verifyQuoteSignature(
        quoteData.quoteId,
        signature
      );
      
      // Quote should not be found or marked as expired
      expect(verifyResult.valid).to.be.false;
    });
  });

  describe("Performance Tests", function () {
    it("Should efficiently sign and verify large batches", async function () {
      this.timeout(30000);
      
      const batchSize = 1000;
      const orders = [];
      const signatures = [];
      
      console.log(`\nGenerating ${batchSize} orders...`);
      const genStart = Date.now();
      
      for (let i = 0; i < batchSize; i++) {
        orders.push({
          sellToken: "0x0000000000000000000000000000000000000001",
          buyToken: "0x0000000000000000000000000000000000000002",
          sellAmount: ethers.utils.parseEther((100 + i).toString()),
          buyAmount: ethers.utils.parseEther((200 + i).toString()),
          validTo: Math.floor(Date.now() / 1000) + 3600,
          user: alice.address,
          receiver: alice.address,
          appData: ethers.utils.id("order-" + i),
          feeAmount: ethers.utils.parseEther("1"),
          partiallyFillable: true,
          kind: "sell",
          signingScheme: "eip712"
        });
      }
      
      const genTime = Date.now() - genStart;
      console.log(`Order generation time: ${genTime}ms`);
      
      // Sign all orders
      console.log(`Signing ${batchSize} orders...`);
      const signStart = Date.now();
      
      for (const order of orders) {
        signatures.push(await alice._signTypedData(domain, types, order));
      }
      
      const signTime = Date.now() - signStart;
      const signThroughput = (batchSize / signTime) * 1000;
      console.log(`Signing time: ${signTime}ms (${signThroughput.toFixed(2)} signatures/sec)`);
      
      // Verify all signatures
      console.log(`Verifying ${batchSize} signatures...`);
      const verifyStart = Date.now();
      
      for (let i = 0; i < batchSize; i++) {
        const recovered = ethers.utils.verifyTypedData(
          domain,
          types,
          orders[i],
          signatures[i]
        );
        expect(recovered.toLowerCase()).to.equal(alice.address.toLowerCase());
      }
      
      const verifyTime = Date.now() - verifyStart;
      const verifyThroughput = (batchSize / verifyTime) * 1000;
      console.log(`Verification time: ${verifyTime}ms (${verifyThroughput.toFixed(2)} verifications/sec)`);
      
      // Performance assertions
      expect(signThroughput).to.be.greaterThan(100); // At least 100 signatures/sec
      expect(verifyThroughput).to.be.greaterThan(500); // At least 500 verifications/sec
    });

    it("Should cache domain separator calculations", async function () {
      const iterations = 1000;
      
      // First calculation (no cache)
      const firstStart = Date.now();
      const firstSeparator = ethers.utils._TypedDataEncoder.hashDomain(domain);
      const firstTime = Date.now() - firstStart;
      
      // Subsequent calculations (should use cache)
      const cachedStart = Date.now();
      for (let i = 0; i < iterations; i++) {
        const separator = ethers.utils._TypedDataEncoder.hashDomain(domain);
        expect(separator).to.equal(firstSeparator);
      }
      const cachedTime = Date.now() - cachedStart;
      
      const avgCachedTime = cachedTime / iterations;
      console.log(`
        Domain Separator Performance:
        - First calculation: ${firstTime}ms
        - Avg cached calculation: ${avgCachedTime.toFixed(4)}ms
        - Speedup: ${(firstTime / avgCachedTime).toFixed(2)}x
      `);
      
      expect(avgCachedTime).to.be.lessThan(firstTime);
    });
  });
});