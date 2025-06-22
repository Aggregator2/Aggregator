const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
const { OrderService } = require("./orderService");
require("dotenv").config({ path: ".env.local" });

/**
 * Enhanced Escrow Event Listener
 * - Subscribes to EscrowReleased, EscrowRefunded, and EscrowDeposited events
 * - Handles disconnections with automatic reconnection
 * - Parses transactions to extract order data
 * - Integrates with OrderService for database updates
 * - Comprehensive logging to console and structured log files
 */

class EscrowEventListener {
    constructor(options = {}) {
        this.contractAddress = options.contractAddress || process.env.ESCROW_CONTRACT_ADDRESS;
        this.providerUrl = options.providerUrl || process.env.PROVIDER_URL || "http://127.0.0.1:8545";
        this.logDir = options.logDir || path.join(__dirname, "..", "logs");
        this.logFile = path.join(this.logDir, "escrow-events.log");
        this.errorLogFile = path.join(this.logDir, "escrow-errors.log");
        
        // Connection management
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectDelay = 5000; // 5 seconds
        this.heartbeatInterval = 30000; // 30 seconds
        this.heartbeatTimer = null;
        
        // Order service integration
        this.orderService = new OrderService();
        
        this.initializeProvider();
        this.initializeContract();
        this.ensureLogDirectory();
    }    initializeProvider() {
        console.log(`🔗 Connecting to provider: ${this.providerUrl}`);
        this.provider = new ethers.JsonRpcProvider(this.providerUrl);
        
        // Disable ENS resolution for local networks
        this.provider.network = {
            ...this.provider.network,
            ensAddress: null
        };
        
        // Set up connection error handling
        this.provider.on('error', (error) => {
            console.error('🚨 Provider error:', error.message);
            this.logError('Provider error', error);
            this.handleDisconnection();
        });

        // Set up network detection
        this.provider.getNetwork().then((network) => {
            const networkName = network.chainId === 31337n ? 'Hardhat' : 
                               network.chainId === 1337n ? 'Ganache' : 
                               network.name || 'Unknown';
            console.log(`🌐 Connected to network: ${networkName} (chainId: ${network.chainId})`);
            this.isConnected = true;
            this.reconnectAttempts = 0;
            this.startHeartbeat();
        }).catch((error) => {
            console.error('❌ Failed to connect to network:', error.message);
            this.handleDisconnection();
        });
    }initializeContract() {
        if (!this.contractAddress) {
            throw new Error("❌ ESCROW_CONTRACT_ADDRESS not set in environment variables");
        }

        // Validate that the contract address is a proper Ethereum address, not an ENS name
        if (!ethers.isAddress(this.contractAddress)) {
            throw new Error(`❌ Invalid contract address: ${this.contractAddress}. Please provide a valid Ethereum address (0x...)`);
        }

        // Load the ABI from compiled artifacts
        const artifactPath = path.join(__dirname, "..", "artifacts", "contracts", "FixedEscrow.sol", "FixedEscrow.json");
        
        if (!fs.existsSync(artifactPath)) {
            throw new Error(`❌ Contract artifact not found at: ${artifactPath}`);
        }

        const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
        this.contractABI = artifact.abi;

        console.log(`📋 Contract address: ${this.contractAddress}`);
        this.contract = new ethers.Contract(this.contractAddress, this.contractABI, this.provider);
    }

    ensureLogDirectory() {
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }
    }    /**
     * Log event data to both console and file, with order service integration
     */
    async logEvent(eventName, eventData) {
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            eventName,
            contractAddress: this.contractAddress,
            ...eventData
        };

        // Console logging with colors
        console.log(`\n🎯 ${eventName.toUpperCase()} EVENT`);
        console.log(`⏰ Timestamp: ${timestamp}`);
        console.log(`📍 Contract: ${this.contractAddress}`);
        console.log(`🔗 Tx Hash: ${eventData.transactionHash}`);
        console.log(`📦 Block: ${eventData.blockNumber}`);
        console.log(`🏷️  Event Args:`, eventData.args);
        
        // Parse transaction for order data
        const txData = await this.parseTxForOrderData(eventData);
        if (txData.orderId) {
            console.log(`� Order ID: ${txData.orderId}`);
            logEntry.orderId = txData.orderId;
        }

        console.log(`�📝 Full Event Data:`, JSON.stringify(logEntry, null, 2));

        // File logging
        const logLine = JSON.stringify(logEntry) + '\n';
        fs.appendFileSync(this.logFile, logLine);

        // Update database via order service
        if (txData.orderId) {
            try {
                const updateData = {
                    orderId: txData.orderId,
                    eventType: eventData.type,
                    transactionHash: eventData.transactionHash,
                    blockNumber: eventData.blockNumber,
                    amount: eventData.args.amount || null
                };

                const result = await this.orderService.updateStatusFromTx(updateData);
                this.orderService.assertDatabaseUpdate(result, this.orderService.getStateFromEventType(eventData.type));
                
                console.log(`✅ Database updated for order ${txData.orderId}`);
                
            } catch (error) {
                console.error(`❌ Failed to update database for order ${txData.orderId}:`, error.message);
                this.logError('Database update failed', { 
                    orderId: txData.orderId, 
                    error: error.message,
                    eventData 
                });
            }
        }
    }    /**
     * Parse transaction to extract order ID and relevant data
     */
    async parseTxForOrderData(eventData) {
        try {
            // For simulation mode, skip actual transaction lookup
            if (eventData.transactionHash.startsWith('0xmock')) {
                const orderId = `order_${eventData.transactionHash.slice(-8)}`;
                let status = null;
                
                switch (eventData.type) {
                    case 'EscrowDeposited':
                        status = 'DEPOSITED';
                        break;
                    case 'EscrowReleased':
                        status = 'SETTLED';
                        break;
                    case 'EscrowRefunded':
                        status = 'REFUNDED';
                        break;
                    default:
                        status = 'PROCESSING';
                }
                
                return {
                    orderId,
                    status,
                    txHash: eventData.transactionHash,
                    blockNumber: eventData.blockNumber,
                    gasUsed: '21000', // Mock gas usage
                    from: eventData.args.depositor || eventData.args.to || '0x0000000000000000000000000000000000000000',
                    to: this.contractAddress,
                    value: eventData.args.amount || '0'
                };
            }
            
            // Get full transaction details for real transactions
            const tx = await this.provider.getTransaction(eventData.transactionHash);
            const receipt = await this.provider.getTransactionReceipt(eventData.transactionHash);
            
            // Extract order ID from transaction data or logs
            let orderId = null;
            let status = null;
            
            // Method 1: Look for order ID in transaction input data
            if (tx.data && tx.data.length > 10) {
                // Parse transaction input data for encoded order ID
                // This is contract-specific and may need adjustment
                try {
                    const iface = new ethers.Interface(this.contractABI);
                    const decoded = iface.parseTransaction({ data: tx.data, value: tx.value });
                    
                    if (decoded && decoded.args) {
                        // Look for order-related parameters
                        if (decoded.args.orderId) {
                            orderId = decoded.args.orderId.toString();
                        } else if (decoded.args.order && decoded.args.order.id) {
                            orderId = decoded.args.order.id.toString();
                        }
                    }
                } catch (parseError) {
                    // Continue with other methods if parsing fails
                }
            }
            
            // Method 2: Extract from event logs or generate deterministic ID
            if (!orderId) {
                // Generate a deterministic order ID from tx hash
                orderId = `order_${eventData.transactionHash.slice(-8)}`;
            }
            
            // Determine status based on event type
            switch (eventData.type) {
                case 'EscrowDeposited':
                    status = 'DEPOSITED';
                    break;
                case 'EscrowReleased':
                    status = 'SETTLED';
                    break;
                case 'EscrowRefunded':
                    status = 'REFUNDED';
                    break;
                default:
                    status = 'PROCESSING';
            }
            
            return {
                orderId,
                status,
                txHash: eventData.transactionHash,
                blockNumber: eventData.blockNumber,
                gasUsed: receipt.gasUsed.toString(),
                from: tx.from,
                to: tx.to,
                value: tx.value.toString()
            };
            
        } catch (error) {
            console.error('❌ Error parsing transaction:', error.message);
            this.logError('Transaction parsing failed', { 
                txHash: eventData.transactionHash, 
                error: error.message 
            });
            
            // Return fallback data for failed parsing
            return {
                orderId: `order_${eventData.transactionHash.slice(-8)}`,
                status: 'PROCESSING',
                error: error.message
            };
        }
    }/**
     * Subscribe to all relevant escrow events with enhanced error handling
     */
    async subscribeToEvents() {
        if (!this.isConnected) {
            console.log('⚠️ Provider not connected. Skipping event subscription.');
            return;
        }

        try {
            console.log("🎧 Starting event subscription...");

            // Remove any existing listeners first
            this.contract.removeAllListeners();

            // Subscribe to Deposited events (maps to EscrowDeposited)
            this.contract.on("Deposited", async (depositor, amount, event) => {
                try {
                    const eventData = {
                        type: "EscrowDeposited",
                        depositor,
                        amount: amount.toString(),
                        transactionHash: event.log.transactionHash,
                        blockNumber: event.log.blockNumber,
                        blockHash: event.log.blockHash,
                        logIndex: event.log.index,
                        args: {
                            depositor,
                            amount: amount.toString()
                        }
                    };
                    await this.logEvent("EscrowDeposited", eventData);
                } catch (error) {
                    console.error('❌ Error processing Deposited event:', error.message);
                    this.logError('Event processing failed', { event: 'Deposited', error: error.message });
                }
            });

            // Subscribe to FundsReleased events (maps to EscrowReleased)
            this.contract.on("FundsReleased", async (to, amount, event) => {
                try {
                    const eventData = {
                        type: "EscrowReleased",
                        to,
                        amount: amount.toString(),
                        transactionHash: event.log.transactionHash,
                        blockNumber: event.log.blockNumber,
                        blockHash: event.log.blockHash,
                        logIndex: event.log.index,
                        args: {
                            to,
                            amount: amount.toString()
                        }
                    };
                    await this.logEvent("EscrowReleased", eventData);
                } catch (error) {
                    console.error('❌ Error processing FundsReleased event:', error.message);
                    this.logError('Event processing failed', { event: 'FundsReleased', error: error.message });
                }
            });

            // Subscribe to Refunded events (maps to EscrowRefunded)
            this.contract.on("Refunded", async (depositor, amount, event) => {
                try {
                    const eventData = {
                        type: "EscrowRefunded",
                        depositor,
                        amount: amount.toString(),
                        transactionHash: event.log.transactionHash,
                        blockNumber: event.log.blockNumber,
                        blockHash: event.log.blockHash,
                        logIndex: event.log.index,
                        args: {
                            depositor,
                            amount: amount.toString()
                        }
                    };
                    await this.logEvent("EscrowRefunded", eventData);
                } catch (error) {
                    console.error('❌ Error processing Refunded event:', error.message);
                    this.logError('Event processing failed', { event: 'Refunded', error: error.message });
                }
            });

            // Subscribe to additional events for complete monitoring
            this.contract.on("Confirmed", async (sender, event) => {
                try {
                    const eventData = {
                        type: "EscrowConfirmed",
                        sender,
                        transactionHash: event.log.transactionHash,
                        blockNumber: event.log.blockNumber,
                        blockHash: event.log.blockHash,
                        logIndex: event.log.index,
                        args: { sender }
                    };
                    await this.logEvent("EscrowConfirmed", eventData);
                } catch (error) {
                    console.error('❌ Error processing Confirmed event:', error.message);
                    this.logError('Event processing failed', { event: 'Confirmed', error: error.message });
                }
            });

            this.contract.on("TradeExecuted", async (sender, amountOutMin, path, deadline, event) => {
                try {
                    const eventData = {
                        type: "TradeExecuted",
                        sender,
                        amountOutMin: amountOutMin.toString(),
                        path,
                        deadline: deadline.toString(),
                        transactionHash: event.log.transactionHash,
                        blockNumber: event.log.blockNumber,
                        blockHash: event.log.blockHash,
                        logIndex: event.log.index,
                        args: {
                            sender,
                            amountOutMin: amountOutMin.toString(),
                            path,
                            deadline: deadline.toString()
                        }
                    };
                    await this.logEvent("TradeExecuted", eventData);
                } catch (error) {
                    console.error('❌ Error processing TradeExecuted event:', error.message);
                    this.logError('Event processing failed', { event: 'TradeExecuted', error: error.message });
                }
            });

            // Log successful subscription
            console.log("✅ Successfully subscribed to all escrow events");
            console.log("📁 Events will be logged to:", this.logFile);
            console.log("🚨 Errors will be logged to:", this.errorLogFile);
            
            // Test connection
            const network = await this.provider.getNetwork();
            console.log(`🌐 Connected to network: ${network.name} (chainId: ${network.chainId})`);

        } catch (error) {
            console.error("❌ Error subscribing to events:", error);
            this.logError('Event subscription failed', { error: error.message });
            throw error;
        }
    }

    /**
     * Query historical events from a specific block range
     */
    async queryHistoricalEvents(fromBlock = 0, toBlock = "latest") {
        try {
            console.log(`🔍 Querying historical events from block ${fromBlock} to ${toBlock}...`);

            const events = await this.contract.queryFilter("*", fromBlock, toBlock);
            
            console.log(`📊 Found ${events.length} historical events`);

            for (const event of events) {
                const eventData = {
                    type: event.event,
                    transactionHash: event.transactionHash,
                    blockNumber: event.blockNumber,
                    blockHash: event.blockHash,
                    logIndex: event.logIndex,
                    args: Object.fromEntries(
                        Object.entries(event.args).map(([key, value]) => [
                            key,
                            typeof value === 'bigint' ? value.toString() : value
                        ])
                    )
                };
                this.logEvent(`Historical_${event.event}`, eventData);
            }

            return events;
        } catch (error) {
            console.error("❌ Error querying historical events:", error);
            throw error;
        }
    }    /**
     * Stop event listening and cleanup
     */
    stop() {
        console.log("🛑 Stopping event listener...");
        
        this.stopHeartbeat();
        
        if (this.contract) {
            this.contract.removeAllListeners();
            console.log("� Removed all event listeners");
        }
        
        this.isConnected = false;
        console.log("�🛑 Event listener stopped");
    }

    /**
     * Graceful shutdown with cleanup
     */
    async shutdown() {
        console.log("🔄 Initiating graceful shutdown...");
        
        // Stop all listeners and timers
        this.stop();
        
        // Log shutdown event
        const shutdownEvent = {
            timestamp: new Date().toISOString(),
            event: 'LISTENER_SHUTDOWN',
            reason: 'Graceful shutdown requested'
        };
        
        const logLine = JSON.stringify(shutdownEvent) + '\n';
        fs.appendFileSync(this.logFile, logLine);
        
        console.log("✅ Shutdown complete");
    }    /**
     * Simulate events for testing (Hardhat/Ganache local fork testing)
     */
    async simulateEvents() {
        console.log("🧪 Starting event simulation for testing...");
        
        try {
            // Use a mock block number if provider is not connected
            let currentBlock = 123456;
            if (this.isConnected) {
                try {
                    currentBlock = await this.provider.getBlockNumber();
                } catch (error) {
                    console.log('⚠️ Could not get current block number, using mock value');
                }
            } else {
                console.log('⚠️ Provider not connected, using mock block numbers for simulation');
            }
              // Simulate a deposit event (using valid 64-character hex hashes)
            const mockDepositEvent = {
                type: "EscrowDeposited",
                depositor: "0x1234567890123456789012345678901234567890",
                amount: ethers.parseEther("1.0").toString(),
                transactionHash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
                blockNumber: currentBlock,
                blockHash: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
                logIndex: 0,
                args: {
                    depositor: "0x1234567890123456789012345678901234567890",
                    amount: ethers.parseEther("1.0").toString()
                }
            };
            
            console.log("🎭 Simulating deposit event...");
            await this.logEvent("EscrowDeposited", mockDepositEvent);
            
            // Wait a bit
            await new Promise(resolve => setTimeout(resolve, 2000));
              // Simulate a release event (using valid 64-character hex hashes)
            const mockReleaseEvent = {
                type: "EscrowReleased",
                to: "0x9876543210987654321098765432109876543210",
                amount: ethers.parseEther("1.0").toString(),
                transactionHash: "0x5678901234abcdef5678901234abcdef5678901234abcdef5678901234abcdef",
                blockNumber: currentBlock + 1,
                blockHash: "0xbcdef12345678901bcdef12345678901bcdef12345678901bcdef12345678901",
                logIndex: 1,
                args: {
                    to: "0x9876543210987654321098765432109876543210",
                    amount: ethers.parseEther("1.0").toString()
                }
            };
            
            console.log("🎭 Simulating release event...");
            await this.logEvent("EscrowReleased", mockReleaseEvent);
            
            // Wait a bit more
            await new Promise(resolve => setTimeout(resolve, 1000));
              // Simulate a refund event (using valid 64-character hex hashes)
            const mockRefundEvent = {
                type: "EscrowRefunded",
                depositor: "0x1234567890123456789012345678901234567890",
                amount: ethers.parseEther("0.5").toString(),
                transactionHash: "0x9012345678abcdef9012345678abcdef9012345678abcdef9012345678abcdef",
                blockNumber: currentBlock + 2,
                blockHash: "0xcdef123456789012cdef123456789012cdef123456789012cdef123456789012",
                logIndex: 2,
                args: {
                    depositor: "0x1234567890123456789012345678901234567890",
                    amount: ethers.parseEther("0.5").toString()
                }
            };
            
            console.log("🎭 Simulating refund event...");
            await this.logEvent("EscrowRefunded", mockRefundEvent);
            
            console.log("✅ Event simulation complete");
            
        } catch (error) {
            console.error("❌ Error during event simulation:", error.message);
            this.logError('Event simulation failed', { error: error.message });
        }
    }

    /**
     * Get event logs summary
     */
    getEventSummary() {
        if (!fs.existsSync(this.logFile)) {
            return { totalEvents: 0, events: [] };
        }

        const logContent = fs.readFileSync(this.logFile, "utf8");
        const lines = logContent.trim().split('\n').filter(line => line);
        const events = lines.map(line => JSON.parse(line));

        const summary = {
            totalEvents: events.length,
            eventTypes: {},
            latestEvent: events[events.length - 1] || null,
            events: events.slice(-10) // Last 10 events
        };

        events.forEach(event => {
            summary.eventTypes[event.eventName] = (summary.eventTypes[event.eventName] || 0) + 1;
        });

        return summary;
    }    /**
     * Handle provider disconnection with enhanced retry logic
     */
    async handleDisconnection() {
        if (!this.isConnected) return; // Already handling disconnection
        
        this.isConnected = false;
        this.stopHeartbeat();
        console.log('🔌 Provider disconnected. Attempting reconnection...');
        this.logError('Provider disconnected', { timestamp: new Date().toISOString() });
        
        // Use enhanced retry logic for reconnection
        try {
            await this.retryWithBackoff(
                async () => {
                    // Reinitialize provider and contract
                    this.initializeProvider();
                    
                    // Test connection
                    await this.provider.getBlockNumber();
                    
                    if (!this.isConnected) {
                        throw new Error('Provider connection test failed');
                    }
                    
                    // Restart event subscriptions
                    await this.subscribeToEvents();
                    
                    console.log('✅ Reconnected successfully!');
                    this.reconnectAttempts = 0;
                    return true;
                },
                {
                    maxAttempts: this.maxReconnectAttempts,
                    baseDelay: this.reconnectDelay,
                    maxDelay: 60000, // Max 1 minute
                    operationName: 'reconnection',
                    retryCondition: (error) => {
                        // Always retry connection errors
                        return true;
                    }
                }
            );
        } catch (error) {
            console.error('💥 Failed to reconnect after all attempts:', error.message);
            this.logError('Reconnection failed permanently', { 
                error: error.message, 
                attempts: this.maxReconnectAttempts 
            });
            
            // Consider this a critical failure
            process.exit(1);
        }
    }

    /**
     * Attempt to reconnect to the provider (legacy - now uses retryWithBackoff)
     */
    async attemptReconnection() {
        // This method is now deprecated in favor of handleDisconnection with retry logic
        await this.handleDisconnection();
    }

    /**
     * Retry logic with exponential backoff
     * @param {Function} operation - Function to retry
     * @param {Object} options - Retry options
     * @returns {Promise} - Result of successful operation
     */
    async retryWithBackoff(operation, options = {}) {
        const {
            maxAttempts = 5,
            baseDelay = 1000, // Start with 1 second
            maxDelay = 32000, // Max 32 seconds
            backoffFactor = 2,
            jitter = true,
            retryCondition = () => true,
            operationName = 'operation'
        } = options;

        let lastError;
        
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                console.log(`🔄 ${operationName} - Attempt ${attempt}/${maxAttempts}`);
                const result = await operation();
                
                if (attempt > 1) {
                    console.log(`✅ ${operationName} succeeded on attempt ${attempt}`);
                }
                
                return result;
                
            } catch (error) {
                lastError = error;
                console.error(`❌ ${operationName} failed on attempt ${attempt}:`, error.message);
                
                // Check if we should retry this error
                if (!retryCondition(error)) {
                    console.log(`🚫 ${operationName} - Error not retryable, giving up`);
                    throw error;
                }
                
                // Don't delay after last attempt
                if (attempt === maxAttempts) {
                    break;
                }
                
                // Calculate delay with exponential backoff
                let delay = Math.min(baseDelay * Math.pow(backoffFactor, attempt - 1), maxDelay);
                
                // Add jitter to prevent thundering herd
                if (jitter) {
                    delay = delay * (0.5 + Math.random() * 0.5);
                }
                
                console.log(`⏳ ${operationName} - Retrying in ${Math.round(delay)}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                
                // Log each retry attempt
                this.logError(`Retry attempt ${attempt} failed`, { 
                    operation: operationName, 
                    error: error.message,
                    nextRetryIn: attempt < maxAttempts ? `${Math.round(delay)}ms` : 'no more retries'
                });
            }
        }
        
        console.error(`💥 ${operationName} failed after ${maxAttempts} attempts`);
        this.logError(`Operation failed after ${maxAttempts} attempts`, { 
            operation: operationName, 
            finalError: lastError.message 
        });
        throw lastError;
    }

    /**
     * Start heartbeat to monitor connection
     */
    startHeartbeat() {
        this.heartbeatTimer = setInterval(async () => {
            try {
                await this.provider.getBlockNumber();
                // Connection is healthy
            } catch (error) {
                console.error('💔 Heartbeat failed:', error.message);
                this.handleDisconnection();
            }
        }, this.heartbeatInterval);
    }

    /**
     * Stop heartbeat timer
     */
    stopHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }

    /**
     * Log error data to error log file
     */
    logError(message, data) {
        const timestamp = new Date().toISOString();
        const errorEntry = {
            timestamp,
            message,
            ...data
        };

        const errorLine = JSON.stringify(errorEntry) + '\n';
        fs.appendFileSync(this.errorLogFile, errorLine);
    }
}

// Export the class for use in other modules
module.exports = { EscrowEventListener };

// CLI usage
if (require.main === module) {    async function main() {
        const listener = new EscrowEventListener();
        let healthService = null;
        
        try {
            // Parse command line arguments
            const args = process.argv.slice(2);
            const shouldSimulate = args.includes('--simulate') || args.includes('-s');
            const shouldQueryHistory = args.includes('--history') || args.includes('-h');
            const withHealth = args.includes('--with-health') || args.includes('--health');

            // Start health service if requested
            if (withHealth) {
                const { HealthService } = require('./healthService');
                healthService = new HealthService();
                healthService.setListener(listener);
                await healthService.start();
            }
            
            if (shouldQueryHistory) {
                // Query historical events first
                console.log('📚 Querying historical events...');
                await listener.queryHistoricalEvents();
            }
            
            if (shouldSimulate) {
                // Run simulation mode
                console.log('🧪 Running in simulation mode...');
                await listener.simulateEvents();
                
                // Show summary and exit
                const summary = listener.getEventSummary();
                console.log("\n📊 Event Summary:");
                console.log(`Total events logged: ${summary.totalEvents}`);
                console.log("Event types:", summary.eventTypes);
                process.exit(0);
            }
            
            // Start real-time event listening
            await listener.subscribeToEvents();
            
            console.log("\n🚀 Event listener is running...");                console.log("📖 Available options:");
                console.log("  --simulate, -s    Run event simulation and exit");
                console.log("  --history, -h     Query historical events first");
                console.log("  --with-health     Start health monitoring service");
                if (withHealth) {
                    console.log(`  🏥 Health service: http://localhost:${healthService.port}/health/listener`);
                }
                console.log("\nPress Ctrl+C to stop");

                // Graceful shutdown handling
                const gracefulShutdown = async (signal) => {
                    console.log(`\n🛑 Received ${signal}, shutting down gracefully...`);
                    
                    await listener.shutdown();
                    
                    if (healthService) {
                        healthService.stop();
                    }
                    
                    // Show summary
                    const summary = listener.getEventSummary();
                    console.log("\n📊 Event Summary:");
                    console.log(`Total events logged: ${summary.totalEvents}`);
                    console.log("Event types:", summary.eventCounts);
                    
                    process.exit(0);
                };

                process.on('SIGINT', () => gracefulShutdown('SIGINT'));
                process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

            // Handle uncaught exceptions
            process.on('uncaughtException', async (error) => {
                console.error("\n💥 Uncaught exception:", error);
                listener.logError('Uncaught exception', { error: error.message, stack: error.stack });
                await listener.shutdown();
                process.exit(1);
            });

            // Keep alive
            setInterval(() => {
                if (listener.isConnected) {
                    console.log(`💓 Event listener heartbeat - ${new Date().toLocaleTimeString()}`);
                } else {
                    console.log(`💔 Event listener disconnected - ${new Date().toLocaleTimeString()}`);
                }
            }, 60000); // Every minute

        } catch (error) {
            console.error("❌ Failed to start event listener:", error);
            listener.logError('Startup failed', { error: error.message, stack: error.stack });
            process.exit(1);
        }
    }

    main();
}
