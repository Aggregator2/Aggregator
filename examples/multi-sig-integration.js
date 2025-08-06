const { ethers } = require('ethers');
const LedgerConnector = require('../lib/hardware-wallet/LedgerConnector');
const TrezorConnector = require('../lib/hardware-wallet/TrezorConnector');
const GnosisSafeConnector = require('../lib/multi-sig/GnosisSafeConnector');
const DKGCoordinator = require('../lib/multi-sig/DKGCoordinator');

/**
 * Multi-Signature Integration Examples
 * Demonstrates various multi-sig scenarios for SwappiQ Protocol
 */

// Configuration
const config = {
    rpcUrl: process.env.RPC_URL || 'http://localhost:8545',
    multiSigContract: process.env.MULTISIG_CONTRACT,
    network: process.env.NETWORK || 'mainnet'
};

// Initialize provider
const provider = new ethers.providers.JsonRpcProvider(config.rpcUrl);

/**
 * Example 1: Create a 2-of-3 multi-sig order with hardware wallets
 */
async function example1_HardwareWalletMultiSig() {
    console.log('\n=== Example 1: Hardware Wallet Multi-Sig (2-of-3) ===\n');
    
    // Connect hardware wallets
    const ledger = new LedgerConnector();
    const trezor = new TrezorConnector();
    
    try {
        // Connect devices
        await ledger.connect();
        await trezor.connect();
        
        // Get addresses
        const ledgerAddress = await ledger.getAddress();
        const trezorAddress = await trezor.getAddress();
        const softwareWallet = ethers.Wallet.createRandom();
        
        console.log('Ledger Address:', ledgerAddress);
        console.log('Trezor Address:', trezorAddress);
        console.log('Software Wallet:', softwareWallet.address);
        
        // Create multi-sig order
        const multiSigManager = new ethers.Contract(
            config.multiSigContract,
            [
                'function createMultiSigOrder(bytes orderData, uint256 requiredSigs, address[] signers, uint8 scheme, uint256 timeLock) returns (bytes32)'
            ],
            provider
        );
        
        const orderData = ethers.utils.defaultAbiCoder.encode(
            ['address', 'uint256', 'address', 'uint256'],
            [
                '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
                ethers.utils.parseUnits('1000', 6), // 1000 USDC
                '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
                ethers.utils.parseEther('0.3') // Min 0.3 ETH
            ]
        );
        
        const signers = [ledgerAddress, trezorAddress, softwareWallet.address];
        const requiredSigs = 2;
        
        // Create order (would need signer with gas)
        console.log('\nCreating multi-sig order...');
        console.log('Required signatures:', requiredSigs);
        console.log('Signers:', signers);
        
        // Sign with hardware wallets
        const order = {
            type: 'SWAP',
            trader: ledgerAddress,
            amount: '1000',
            token: 'USDC'
        };
        
        console.log('\nSigning with Ledger...');
        const ledgerSig = await ledger.signMultiSigOrder(order);
        console.log('Ledger signature:', ledgerSig.signature);
        
        console.log('\nSigning with Trezor...');
        const trezorSig = await trezor.signMultiSigOrder(order);
        console.log('Trezor signature:', trezorSig.signature);
        
        console.log('\n✅ Multi-sig order created and signed with hardware wallets');
        
    } catch (error) {
        console.error('Hardware wallet error:', error.message);
    } finally {
        await ledger.disconnect();
        await trezor.disconnect();
    }
}

/**
 * Example 2: Gnosis Safe integration for institutional trading
 */
async function example2_GnosisSafeIntegration() {
    console.log('\n=== Example 2: Gnosis Safe Integration ===\n');
    
    // Example Gnosis Safe address (mainnet)
    const safeAddress = '0x123...'; // Replace with actual Safe address
    
    const gnosisSafe = new GnosisSafeConnector(safeAddress, provider, config.network);
    
    try {
        // Get Safe info
        const safeInfo = await gnosisSafe.getSafeInfo();
        console.log('Safe Address:', safeInfo.address);
        console.log('Owners:', safeInfo.owners);
        console.log('Threshold:', safeInfo.threshold, 'of', safeInfo.owners.length);
        
        // Create multi-sig order transaction
        const orderData = {
            orderId: ethers.utils.id('order-123'),
            type: 'SWAP',
            amount: '10000 USDC'
        };
        
        const { safeTx, txHash } = await gnosisSafe.createMultiSigOrderTransaction(
            orderData,
            config.multiSigContract
        );
        
        console.log('\nSafe transaction created:');
        console.log('Transaction hash:', txHash);
        console.log('To:', safeTx.to);
        console.log('Data:', safeTx.data);
        
        // In practice, each owner would sign
        console.log('\nOwners need to sign the transaction...');
        
        // Example: Create batch transaction for multiple orders
        const orders = [
            { orderId: ethers.utils.id('order-1') },
            { orderId: ethers.utils.id('order-2') },
            { orderId: ethers.utils.id('order-3') }
        ];
        
        const batchTx = await gnosisSafe.createBatchOrderTransaction(
            orders,
            config.multiSigContract
        );
        
        console.log('\nBatch transaction created for', batchTx.orderCount, 'orders');
        
    } catch (error) {
        console.error('Gnosis Safe error:', error.message);
    }
}

/**
 * Example 3: Distributed Key Generation for institutional threshold signatures
 */
async function example3_DistributedKeyGeneration() {
    console.log('\n=== Example 3: Distributed Key Generation (3-of-5) ===\n');
    
    // Mock communication layer
    const mockComm = {
        getNodeAddress: async () => '0xnode1...',
        broadcast: async (type, data) => console.log('Broadcasting:', type),
        sendPrivate: async (recipient, type, data) => console.log('Sending to:', recipient),
        on: (event, handler) => {}
    };
    
    const dkgCoordinator = new DKGCoordinator(mockComm);
    
    try {
        // Start DKG session
        const participants = [
            '0xnode1...',
            '0xnode2...',
            '0xnode3...',
            '0xnode4...',
            '0xnode5...'
        ];
        
        const sessionConfig = {
            threshold: 3,
            participants,
            sessionId: ethers.utils.id('dkg-session-1')
        };
        
        console.log('Starting DKG session...');
        console.log('Threshold:', sessionConfig.threshold);
        console.log('Participants:', sessionConfig.participants.length);
        
        // Listen for events
        dkgCoordinator.on('sessionCompleted', ({ sessionId, keyMaterial }) => {
            console.log('\n✅ DKG session completed!');
            console.log('Session ID:', sessionId);
            console.log('Group public key:', keyMaterial.groupPublicKey);
            console.log('Threshold:', keyMaterial.threshold);
        });
        
        dkgCoordinator.on('storeKeyMaterial', ({ sessionId, keyMaterial }) => {
            console.log('\n📁 Store key material securely:');
            console.log('- Secret key share (keep private!)');
            console.log('- Public key share:', keyMaterial.publicKeyShare);
        });
        
        // Start session (in practice, this would be coordinated across nodes)
        const sessionId = await dkgCoordinator.startSession(sessionConfig);
        console.log('Session started:', sessionId);
        
        // Example: Create threshold signature
        console.log('\nCreating threshold signature...');
        const message = 'Sign this order: 0x123...';
        
        // Each participant creates their signature share
        // In practice, this happens on different nodes
        const signatureShare = await dkgCoordinator.createThresholdSignature(
            message,
            sessionId
        );
        
        console.log('Signature share created');
        
    } catch (error) {
        console.error('DKG error:', error.message);
    }
}

/**
 * Example 4: Time-locked multi-sig order
 */
async function example4_TimeLockedOrder() {
    console.log('\n=== Example 4: Time-Locked Multi-Sig Order ===\n');
    
    const wallet1 = ethers.Wallet.createRandom();
    const wallet2 = ethers.Wallet.createRandom();
    const wallet3 = ethers.Wallet.createRandom();
    
    console.log('Creating time-locked order...');
    console.log('Signers:');
    console.log('- Wallet 1:', wallet1.address);
    console.log('- Wallet 2:', wallet2.address);
    console.log('- Wallet 3:', wallet3.address);
    
    // Order parameters
    const orderParams = {
        type: 'LIMIT',
        tokenIn: 'USDC',
        tokenOut: 'ETH',
        amount: '5000',
        price: '0.0003',
        timeLock: 86400, // 24 hours
        requiredSignatures: 2
    };
    
    console.log('\nOrder details:');
    console.log('- Type:', orderParams.type);
    console.log('- Amount:', orderParams.amount, orderParams.tokenIn);
    console.log('- Time lock:', orderParams.timeLock / 3600, 'hours');
    console.log('- Required signatures:', orderParams.requiredSignatures);
    
    console.log('\n⏰ Order will be executable after signatures and time lock period');
}

/**
 * Example 5: Complex multi-sig scenario with mixed wallets
 */
async function example5_ComplexMultiSig() {
    console.log('\n=== Example 5: Complex Multi-Sig (Mixed Wallets) ===\n');
    
    // Different types of signers
    const signers = {
        hardwareLedger: '0xledger...',
        hardwareTrezor: '0xtrezor...',
        gnosisSafe: '0xsafe...',
        thresholdWallet: '0xthreshold...',
        eoaWallet: ethers.Wallet.createRandom().address
    };
    
    console.log('Multi-sig configuration:');
    console.log('- Hardware Wallet (Ledger):', signers.hardwareLedger);
    console.log('- Hardware Wallet (Trezor):', signers.hardwareTrezor);
    console.log('- Gnosis Safe (2-of-3):', signers.gnosisSafe);
    console.log('- Threshold Wallet (3-of-5):', signers.thresholdWallet);
    console.log('- EOA Wallet:', signers.eoaWallet);
    
    console.log('\nRequirement: 3 of 5 signatures');
    console.log('This allows flexible signing combinations:');
    console.log('- 2 hardware wallets + 1 other');
    console.log('- Gnosis Safe + Threshold wallet + 1 other');
    console.log('- Any valid combination of 3 signers');
    
    console.log('\n🔐 Maximum security with operational flexibility');
}

/**
 * Run all examples
 */
async function runExamples() {
    console.log('SwappiQ Protocol - Multi-Signature Integration Examples');
    console.log('======================================================');
    
    try {
        // Run examples sequentially
        await example1_HardwareWalletMultiSig();
        await example2_GnosisSafeIntegration();
        await example3_DistributedKeyGeneration();
        await example4_TimeLockedOrder();
        await example5_ComplexMultiSig();
        
        console.log('\n✅ All examples completed successfully!');
        
    } catch (error) {
        console.error('\n❌ Error running examples:', error);
    }
}

// Export for use in other modules
module.exports = {
    example1_HardwareWalletMultiSig,
    example2_GnosisSafeIntegration,
    example3_DistributedKeyGeneration,
    example4_TimeLockedOrder,
    example5_ComplexMultiSig,
    runExamples
};

// Run if called directly
if (require.main === module) {
    runExamples().then(() => process.exit(0)).catch(() => process.exit(1));
}