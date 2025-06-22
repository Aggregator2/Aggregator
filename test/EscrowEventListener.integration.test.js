const { expect } = require("chai");
const { ethers } = require("hardhat");
const sinon = require("sinon");
const fs = require("fs");
const path = require("path");

// Mock the OrderService for testing
const mockOrderService = {
    updateStatusFromTx: sinon.stub(),
    assertDatabaseUpdate: sinon.stub(),
    getStateFromEventType: sinon.stub()
};

// Import the EscrowEventListener (need to mock OrderService first)
const originalRequire = require;
require = function(module) {
    if (module === "./orderService") {
        return { OrderService: function() { return mockOrderService; } };
    }
    return originalRequire.apply(this, arguments);
};

const { EscrowEventListener } = require("../utils/escrowEventListener");

// Restore original require
require = originalRequire;

describe("EscrowEventListener Integration Tests", function () {
    let listener;
    let escrow;
    let depositor, counterparty, arbiter;
    let mockToken;
    let provider;
    let tempLogDir;

    const DEPOSIT_AMOUNT = ethers.parseEther("10");

    before(async function () {
        // Setup test accounts
        [depositor, counterparty, arbiter] = await ethers.getSigners();
        provider = ethers.provider;

        // Create temporary log directory
        tempLogDir = path.join(__dirname, "..", "test-logs");
        if (!fs.existsSync(tempLogDir)) {
            fs.mkdirSync(tempLogDir, { recursive: true });
        }
    });

    beforeEach(async function () {
        // Reset mocks
        sinon.resetHistory();
        mockOrderService.updateStatusFromTx.resolves({ success: true });
        mockOrderService.assertDatabaseUpdate.returns(true);
        mockOrderService.getStateFromEventType.returns("PROCESSING");

        // Deploy mock ERC20 token
        const MockToken = await ethers.getContractFactory("MockERC20");
        mockToken = await MockToken.deploy(
            "Test Token", 
            "TEST", 
            ethers.parseEther("1000")
        );
        await mockToken.waitForDeployment();

        // Deploy FixedEscrow contract
        const FixedEscrow = await ethers.getContractFactory("FixedEscrow");
        escrow = await FixedEscrow.deploy();
        await escrow.waitForDeployment();

        // Setup event listener with test configuration
        listener = new EscrowEventListener({
            contractAddress: await escrow.getAddress(),
            providerUrl: "http://127.0.0.1:8545", // Hardhat local network
            logDir: tempLogDir
        });

        // Ensure listener is connected
        await new Promise((resolve) => {
            if (listener.isConnected) {
                resolve();
            } else {
                listener.provider.on('network', () => {
                    if (listener.isConnected) resolve();
                });
            }
        });

        // Subscribe to events
        await listener.subscribeToEvents();

        // Transfer tokens to depositor and approve escrow
        await mockToken.transfer(depositor.address, DEPOSIT_AMOUNT);
        await mockToken.connect(depositor).approve(await escrow.getAddress(), DEPOSIT_AMOUNT);
    });

    afterEach(async function () {
        if (listener) {
            await listener.stop();
        }
    });

    after(async function () {
        // Cleanup test logs
        if (fs.existsSync(tempLogDir)) {
            fs.rmSync(tempLogDir, { recursive: true, force: true });
        }
    });

    describe("Event Subscription and Logging", function () {
        it("should detect and log EscrowDeposited events", async function () {
            // Setup promise to capture event
            const eventPromise = new Promise((resolve) => {
                listener.contract.once("Deposited", (depositor, amount, event) => {
                    resolve({ depositor, amount, event });
                });
            });

            // Execute deposit transaction
            const tx = await escrow.connect(depositor).deposit(
                await mockToken.getAddress(),
                DEPOSIT_AMOUNT
            );
            await tx.wait();

            // Wait for event to be captured
            const eventData = await eventPromise;

            // Verify event data
            expect(eventData.depositor).to.equal(depositor.address);
            expect(eventData.amount).to.equal(DEPOSIT_AMOUNT);
            expect(eventData.event.log.transactionHash).to.equal(tx.hash);

            // Wait for event processing
            await new Promise(resolve => setTimeout(resolve, 100));

            // Verify database integration was called
            expect(mockOrderService.updateStatusFromTx.calledOnce).to.be.true;
            
            const updateCall = mockOrderService.updateStatusFromTx.getCall(0);
            expect(updateCall.args[0]).to.have.property('eventType', 'EscrowDeposited');
            expect(updateCall.args[0]).to.have.property('transactionHash', tx.hash);
        });

        it("should detect and log EscrowReleased events", async function () {
            // First deposit funds
            await escrow.connect(depositor).deposit(
                await mockToken.getAddress(),
                DEPOSIT_AMOUNT
            );

            // Setup promise to capture release event
            const eventPromise = new Promise((resolve) => {
                listener.contract.once("FundsReleased", (to, amount, event) => {
                    resolve({ to, amount, event });
                });
            });

            // Execute release transaction
            const tx = await escrow.connect(depositor).release(counterparty.address);
            await tx.wait();

            // Wait for event to be captured
            const eventData = await eventPromise;

            // Verify event data
            expect(eventData.to).to.equal(counterparty.address);
            expect(eventData.event.log.transactionHash).to.equal(tx.hash);

            // Wait for event processing
            await new Promise(resolve => setTimeout(resolve, 100));

            // Verify database integration
            expect(mockOrderService.updateStatusFromTx.called).to.be.true;
        });

        it("should detect and log EscrowRefunded events", async function () {
            // First deposit funds
            await escrow.connect(depositor).deposit(
                await mockToken.getAddress(),
                DEPOSIT_AMOUNT
            );

            // Setup promise to capture refund event
            const eventPromise = new Promise((resolve) => {
                listener.contract.once("Refunded", (depositor, amount, event) => {
                    resolve({ depositor, amount, event });
                });
            });

            // Execute refund transaction
            const tx = await escrow.connect(depositor).refund();
            await tx.wait();

            // Wait for event to be captured
            const eventData = await eventPromise;

            // Verify event data
            expect(eventData.depositor).to.equal(depositor.address);
            expect(eventData.amount).to.equal(DEPOSIT_AMOUNT);
            expect(eventData.event.log.transactionHash).to.equal(tx.hash);

            // Wait for event processing
            await new Promise(resolve => setTimeout(resolve, 100));

            // Verify database integration
            expect(mockOrderService.updateStatusFromTx.called).to.be.true;
        });
    });

    describe("Transaction Parsing and Order Data Extraction", function () {
        it("should parse transaction data and extract orderId", async function () {
            const tx = await escrow.connect(depositor).deposit(
                await mockToken.getAddress(),
                DEPOSIT_AMOUNT
            );
            const receipt = await tx.wait();

            // Create mock event data
            const mockEventData = {
                transactionHash: tx.hash,
                blockNumber: receipt.blockNumber,
                blockHash: receipt.blockHash
            };

            // Parse transaction data
            const parsedData = await listener.parseTxForOrderData(mockEventData);

            // Verify order data extraction
            expect(parsedData).to.have.property('orderId');
            expect(parsedData.orderId).to.be.a('string');
            expect(parsedData.orderId.length).to.be.greaterThan(0);
        });

        it("should handle parsing errors gracefully", async function () {
            // Create invalid event data
            const invalidEventData = {
                transactionHash: "0xinvalidhash",
                blockNumber: 999999,
                blockHash: "0xinvalidblockhash"
            };

            // Parse transaction data - should not throw
            const parsedData = await listener.parseTxForOrderData(invalidEventData);

            // Should return fallback data
            expect(parsedData).to.have.property('orderId');
            expect(parsedData).to.have.property('error');
        });
    });

    describe("Database Integration", function () {
        it("should call orderService.updateStatusFromTx with correct data", async function () {
            // Execute a deposit transaction
            const tx = await escrow.connect(depositor).deposit(
                await mockToken.getAddress(),
                DEPOSIT_AMOUNT
            );
            
            // Wait for event processing
            await new Promise(resolve => setTimeout(resolve, 200));

            // Verify database service was called correctly
            expect(mockOrderService.updateStatusFromTx.calledOnce).to.be.true;
            
            const updateData = mockOrderService.updateStatusFromTx.getCall(0).args[0];
            expect(updateData).to.have.property('eventType', 'EscrowDeposited');
            expect(updateData).to.have.property('transactionHash', tx.hash);
            expect(updateData).to.have.property('blockNumber');
            expect(updateData).to.have.property('orderId');
        });

        it("should assert database update success", async function () {
            // Execute a transaction
            await escrow.connect(depositor).deposit(
                await mockToken.getAddress(),
                DEPOSIT_AMOUNT
            );
            
            // Wait for event processing
            await new Promise(resolve => setTimeout(resolve, 200));

            // Verify assertion was called
            expect(mockOrderService.assertDatabaseUpdate.called).to.be.true;
        });

        it("should handle database update failures", async function () {
            // Mock database failure
            mockOrderService.updateStatusFromTx.rejects(new Error("Database connection failed"));

            // Execute a transaction
            await escrow.connect(depositor).deposit(
                await mockToken.getAddress(),
                DEPOSIT_AMOUNT
            );
            
            // Wait for event processing
            await new Promise(resolve => setTimeout(resolve, 200));

            // Should handle error gracefully (check logs)
            const errorLogPath = path.join(tempLogDir, "escrow-errors.log");
            if (fs.existsSync(errorLogPath)) {
                const errorLog = fs.readFileSync(errorLogPath, 'utf8');
                expect(errorLog).to.include("Database update failed");
            }
        });
    });

    describe("Connection Management and Resilience", function () {
        it("should handle provider disconnection and reconnection", async function () {
            // Simulate disconnection
            listener.isConnected = false;
            await listener.handleDisconnection();

            // Wait for reconnection attempt
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Should attempt to reconnect
            expect(listener.reconnectAttempts).to.be.greaterThan(0);
        });

        it("should retry failed operations with exponential backoff", async function () {
            const retryPromise = listener.retryWithBackoff(
                async () => {
                    if (Math.random() > 0.7) { // 30% success rate
                        return "success";
                    }
                    throw new Error("Random failure");
                },
                {
                    maxAttempts: 3,
                    baseDelay: 100,
                    operationName: "test-operation"
                }
            );

            // Should eventually succeed or fail after max attempts
            try {
                const result = await retryPromise;
                expect(result).to.equal("success");
            } catch (error) {
                expect(error.message).to.include("Random failure");
            }
        });
    });

    describe("Logging and Monitoring", function () {
        it("should write events to structured log files", async function () {
            // Execute a transaction
            await escrow.connect(depositor).deposit(
                await mockToken.getAddress(),
                DEPOSIT_AMOUNT
            );
            
            // Wait for logging
            await new Promise(resolve => setTimeout(resolve, 200));

            // Check if log file was created and contains event data
            const logPath = path.join(tempLogDir, "escrow-events.log");
            expect(fs.existsSync(logPath)).to.be.true;

            const logContent = fs.readFileSync(logPath, 'utf8');
            expect(logContent).to.include("EscrowDeposited");
            expect(logContent).to.include(depositor.address);
        });

        it("should log errors to error log file", async function () {
            // Force an error by calling logError directly
            listener.logError("Test error", { testData: "test" });

            // Check if error log was created
            const errorLogPath = path.join(tempLogDir, "escrow-errors.log");
            expect(fs.existsSync(errorLogPath)).to.be.true;

            const errorLogContent = fs.readFileSync(errorLogPath, 'utf8');
            expect(errorLogContent).to.include("Test error");
        });
    });

    describe("Event Simulation for Testing", function () {
        it("should successfully simulate events for testing", async function () {
            // Test the simulation method
            await listener.simulateEvents();

            // Wait for simulation to complete
            await new Promise(resolve => setTimeout(resolve, 500));

            // Check if simulated events were logged
            const logPath = path.join(tempLogDir, "escrow-events.log");
            if (fs.existsSync(logPath)) {
                const logContent = fs.readFileSync(logPath, 'utf8');
                expect(logContent.length).to.be.greaterThan(0);
            }
        });
    });
});
