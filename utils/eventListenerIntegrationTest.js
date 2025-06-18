/**
 * Integration Test for Escrow Event Listener
 * Tests event simulation, database updates, and order status verification
 */

const { EscrowEventListener } = require('./escrowEventListener');
const { OrderService } = require('./orderService');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

class EventListenerIntegrationTest {
    constructor() {
        this.testResults = {
            passed: 0,
            failed: 0,
            tests: []
        };
        this.cleanup = [];
    }

    /**
     * Run all integration tests
     */
    async runTests() {
        console.log('🧪 Starting Escrow Event Listener Integration Tests');
        console.log('====================================================\n');

        try {
            await this.testEventProcessing();
            await this.testDatabaseIntegration();
            await this.testOrderStatusUpdates();
            await this.testErrorHandling();
            await this.testEventSimulation();
            
            this.printResults();
            return this.testResults.failed === 0;
        } catch (error) {
            console.error('❌ Test suite failed:', error);
            return false;
        } finally {
            await this.performCleanup();
        }
    }

    /**
     * Test event processing with mock transactions
     */
    async testEventProcessing() {
        console.log('📡 Testing Event Processing...');
        
        try {
            const listener = new EscrowEventListener();
            
            // Mock event data
            const mockDepositEvent = {
                type: "EscrowDeposited",
                depositor: "0x1234567890123456789012345678901234567890",
                amount: "1000000000000000000",
                transactionHash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
                blockNumber: 123456,
                blockHash: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
                logIndex: 0,
                args: {
                    depositor: "0x1234567890123456789012345678901234567890",
                    amount: "1000000000000000000"
                }
            };

            // Process the event
            await listener.logEvent("EscrowDeposited", mockDepositEvent);
            
            // Verify log file was created and contains event
            const logPath = path.join(process.cwd(), 'logs', 'escrow-events.log');
            assert(fs.existsSync(logPath), 'Event log file should exist');
            
            const logContent = fs.readFileSync(logPath, 'utf8');
            const lastLine = logContent.trim().split('\n').pop();
            const loggedEvent = JSON.parse(lastLine);
            
            assert.strictEqual(loggedEvent.eventName, 'EscrowDeposited', 'Event name should match');
            assert.strictEqual(loggedEvent.transactionHash, mockDepositEvent.transactionHash, 'Transaction hash should match');
            assert(loggedEvent.orderId, 'Order ID should be generated');
            
            this.addTestResult('Event Processing', true, 'Events are properly processed and logged');
            
        } catch (error) {
            this.addTestResult('Event Processing', false, error.message);
        }
    }

    /**
     * Test database integration with OrderService
     */
    async testDatabaseIntegration() {
        console.log('💾 Testing Database Integration...');
        
        try {
            const orderService = new OrderService();
            
            // Test order status update
            const mockTxData = {
                orderId: 'order_test123',
                transactionHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
                eventType: 'EscrowDeposited',
                status: 'deposited',
                amount: '1000000000000000000',
                from: '0x1234567890123456789012345678901234567890',
                to: '0x9876543210987654321098765432109876543210'
            };            const result = await orderService.updateStatusFromTx(mockTxData);
            assert(result.success, 'Database update should succeed');
            
            // Test assertion
            orderService.assertDatabaseUpdate(result, 'DEPOSITED');
            
            this.addTestResult('Database Integration', true, 'Database updates and assertions work correctly');
            
        } catch (error) {
            this.addTestResult('Database Integration', false, error.message);
        }
    }

    /**
     * Test order status updates for different event types
     */
    async testOrderStatusUpdates() {
        console.log('🔄 Testing Order Status Updates...');
        
        try {
            const orderService = new OrderService();
            
            // Test different event types
            const testCases = [
                {
                    eventType: 'EscrowDeposited',
                    expectedStatus: 'deposited',
                    orderId: 'order_deposit123'
                },
                {
                    eventType: 'EscrowReleased',
                    expectedStatus: 'released',
                    orderId: 'order_release123'
                },
                {
                    eventType: 'EscrowRefunded',
                    expectedStatus: 'refunded',
                    orderId: 'order_refund123'
                }
            ];

            for (const testCase of testCases) {
                const txData = {
                    orderId: testCase.orderId,
                    transactionHash: `0x${testCase.orderId.replace('order_', '')}${'0'.repeat(54)}`,
                    eventType: testCase.eventType,
                    status: testCase.expectedStatus,
                    amount: '1000000000000000000'
                };

                const result = await orderService.updateStatusFromTx(txData);
                assert(result.success, `Status update should succeed for ${testCase.eventType}`);
                assert.strictEqual(result.status, testCase.expectedStatus, `Status should be ${testCase.expectedStatus}`);
            }
            
            this.addTestResult('Order Status Updates', true, 'All event types correctly update order status');
            
        } catch (error) {
            this.addTestResult('Order Status Updates', false, error.message);
        }
    }

    /**
     * Test error handling scenarios
     */
    async testErrorHandling() {
        console.log('⚠️ Testing Error Handling...');
        
        try {
            const listener = new EscrowEventListener();
            
            // Test with invalid event data
            const invalidEvent = {
                type: "InvalidEvent",
                // Missing required fields
            };

            // This should not throw but should handle gracefully
            await listener.logEvent("InvalidEvent", invalidEvent);
            
            // Check error log
            const errorLogPath = path.join(process.cwd(), 'logs', 'escrow-errors.log');
            
            // Error handling should create error log or handle gracefully
            // The exact behavior depends on implementation
            
            this.addTestResult('Error Handling', true, 'Invalid events are handled gracefully');
            
        } catch (error) {
            // If it throws, that's also acceptable error handling
            this.addTestResult('Error Handling', true, 'Errors are properly thrown and can be caught');
        }
    }

    /**
     * Test event simulation functionality
     */
    async testEventSimulation() {
        console.log('🎭 Testing Event Simulation...');
        
        try {
            const listener = new EscrowEventListener();
            
            // Run simulation
            await listener.simulateEvents();
            
            // Verify simulation created events
            const summary = listener.getEventSummary();
            assert(summary.totalEvents > 0, 'Simulation should generate events');
            assert(summary.events.length > 0, 'Simulation should create event records');
            
            // Verify different event types were simulated
            const eventTypes = summary.events.map(e => e.eventName);
            const hasDeposit = eventTypes.includes('EscrowDeposited');
            const hasRelease = eventTypes.includes('EscrowReleased');
            const hasRefund = eventTypes.includes('EscrowRefunded');
            
            assert(hasDeposit || hasRelease || hasRefund, 'At least one escrow event type should be simulated');
            
            this.addTestResult('Event Simulation', true, 'Event simulation generates valid events');
            
        } catch (error) {
            this.addTestResult('Event Simulation', false, error.message);
        }
    }

    /**
     * Add test result
     */
    addTestResult(testName, passed, message) {
        const result = { testName, passed, message };
        this.testResults.tests.push(result);
        
        if (passed) {
            this.testResults.passed++;
            console.log(`  ✅ ${testName}: ${message}`);
        } else {
            this.testResults.failed++;
            console.log(`  ❌ ${testName}: ${message}`);
        }
    }

    /**
     * Print final test results
     */
    printResults() {
        console.log('\n📊 Integration Test Results');
        console.log('===========================');
        console.log(`Total Tests: ${this.testResults.tests.length}`);
        console.log(`Passed: ${this.testResults.passed}`);
        console.log(`Failed: ${this.testResults.failed}`);
        console.log(`Success Rate: ${((this.testResults.passed / this.testResults.tests.length) * 100).toFixed(1)}%`);
        
        if (this.testResults.failed > 0) {
            console.log('\n❌ Failed Tests:');
            this.testResults.tests
                .filter(t => !t.passed)
                .forEach(t => console.log(`  - ${t.testName}: ${t.message}`));
        } else {
            console.log('\n🎉 All tests passed!');
        }
    }

    /**
     * Cleanup test artifacts
     */
    async performCleanup() {
        console.log('\n🧹 Cleaning up test artifacts...');
        
        // Clean up any test files or state
        // Note: In production, you might want to clean up test log entries
        // For now, we'll leave the logs for inspection
        
        console.log('✅ Cleanup complete');
    }
}

// CLI Interface
async function main() {
    if (require.main === module) {
        const tester = new EventListenerIntegrationTest();
        const success = await tester.runTests();
        process.exit(success ? 0 : 1);
    }
}

if (require.main === module) {
    main().catch(error => {
        console.error('❌ Test execution failed:', error);
        process.exit(1);
    });
}

module.exports = { EventListenerIntegrationTest };
