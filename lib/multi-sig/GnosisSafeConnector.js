const { ethers } = require('ethers');
const axios = require('axios');

/**
 * Gnosis Safe Integration for SwappiQ Multi-Signature Orders
 * Supports transaction building, signing, and execution through Gnosis Safe
 */
class GnosisSafeConnector {
    constructor(safeAddress, provider, network = 'mainnet') {
        this.safeAddress = safeAddress;
        this.provider = provider;
        this.network = network;
        
        // Gnosis Safe Service URLs
        this.serviceUrls = {
            mainnet: 'https://safe-transaction-mainnet.safe.global',
            goerli: 'https://safe-transaction-goerli.safe.global',
            polygon: 'https://safe-transaction-polygon.safe.global',
            arbitrum: 'https://safe-transaction-arbitrum.safe.global',
            optimism: 'https://safe-transaction-optimism.safe.global'
        };
        
        this.serviceUrl = this.serviceUrls[network] || this.serviceUrls.mainnet;
        
        // Gnosis Safe contract addresses
        this.contracts = {
            masterCopy: {
                mainnet: '0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552',
                goerli: '0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552'
            }
        };
        
        // ABI for essential Safe functions
        this.safeAbi = [
            'function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool)',
            'function getTransactionHash(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, uint256 _nonce) view returns (bytes32)',
            'function nonce() view returns (uint256)',
            'function getOwners() view returns (address[])',
            'function getThreshold() view returns (uint256)',
            'function isOwner(address) view returns (bool)'
        ];
        
        this.safe = new ethers.Contract(safeAddress, this.safeAbi, provider);
    }
    
    /**
     * Create a multi-sig order transaction for Gnosis Safe
     */
    async createMultiSigOrderTransaction(orderData, multiSigContract) {
        // Encode the order execution call
        const iface = new ethers.utils.Interface([
            'function executeOrder(bytes32 orderId)'
        ]);
        
        const data = iface.encodeFunctionData('executeOrder', [orderData.orderId]);
        
        // Get current nonce
        const nonce = await this.safe.nonce();
        
        // Build Safe transaction
        const safeTx = {
            to: multiSigContract,
            value: '0',
            data: data,
            operation: 0, // CALL
            safeTxGas: 0,
            baseGas: 0,
            gasPrice: 0,
            gasToken: ethers.constants.AddressZero,
            refundReceiver: ethers.constants.AddressZero,
            nonce: nonce.toString()
        };
        
        // Calculate transaction hash
        const txHash = await this.safe.getTransactionHash(
            safeTx.to,
            safeTx.value,
            safeTx.data,
            safeTx.operation,
            safeTx.safeTxGas,
            safeTx.baseGas,
            safeTx.gasPrice,
            safeTx.gasToken,
            safeTx.refundReceiver,
            safeTx.nonce
        );
        
        return {
            safeTx,
            txHash,
            safeAddress: this.safeAddress
        };
    }
    
    /**
     * Sign a Safe transaction hash
     */
    async signTransaction(txHash, signer) {
        // EIP-712 signature for Gnosis Safe
        const signature = await signer._signTypedData(
            {
                chainId: (await this.provider.getNetwork()).chainId,
                verifyingContract: this.safeAddress
            },
            {
                SafeTx: [
                    { type: 'address', name: 'to' },
                    { type: 'uint256', name: 'value' },
                    { type: 'bytes', name: 'data' },
                    { type: 'uint8', name: 'operation' },
                    { type: 'uint256', name: 'safeTxGas' },
                    { type: 'uint256', name: 'baseGas' },
                    { type: 'uint256', name: 'gasPrice' },
                    { type: 'address', name: 'gasToken' },
                    { type: 'address', name: 'refundReceiver' },
                    { type: 'uint256', name: 'nonce' }
                ]
            },
            txHash
        );
        
        return signature;
    }
    
    /**
     * Submit transaction to Gnosis Safe Transaction Service
     */
    async proposeTransaction(safeTx, signature, signerAddress) {
        const endpoint = `${this.serviceUrl}/api/v1/safes/${this.safeAddress}/multisig-transactions/`;
        
        const payload = {
            safe: this.safeAddress,
            to: safeTx.to,
            value: safeTx.value,
            data: safeTx.data || null,
            operation: safeTx.operation,
            safeTxGas: safeTx.safeTxGas,
            baseGas: safeTx.baseGas,
            gasPrice: safeTx.gasPrice,
            gasToken: safeTx.gasToken,
            refundReceiver: safeTx.refundReceiver,
            nonce: safeTx.nonce,
            contractTransactionHash: safeTx.txHash,
            sender: signerAddress,
            signature: signature,
            origin: 'SwappiQ Protocol'
        };
        
        try {
            const response = await axios.post(endpoint, payload);
            return response.data;
        } catch (error) {
            console.error('Failed to propose transaction:', error.response?.data || error.message);
            throw error;
        }
    }
    
    /**
     * Get pending transactions for the Safe
     */
    async getPendingTransactions() {
        const endpoint = `${this.serviceUrl}/api/v1/safes/${this.safeAddress}/multisig-transactions/`;
        
        try {
            const response = await axios.get(endpoint, {
                params: {
                    executed: false,
                    ordering: '-nonce'
                }
            });
            return response.data.results;
        } catch (error) {
            console.error('Failed to fetch pending transactions:', error);
            throw error;
        }
    }
    
    /**
     * Add confirmation signature to existing transaction
     */
    async confirmTransaction(safeTxHash, signature, signerAddress) {
        const endpoint = `${this.serviceUrl}/api/v1/multisig-transactions/${safeTxHash}/confirmations/`;
        
        const payload = {
            signature: signature
        };
        
        try {
            const response = await axios.post(endpoint, payload, {
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            return response.data;
        } catch (error) {
            console.error('Failed to confirm transaction:', error.response?.data || error.message);
            throw error;
        }
    }
    
    /**
     * Execute transaction when threshold is reached
     */
    async executeTransaction(safeTx, signatures) {
        // Sort signatures by signer address (required by Gnosis Safe)
        const sortedSignatures = this._sortSignatures(signatures);
        
        // Concatenate signatures
        const packedSignatures = ethers.utils.hexConcat(
            sortedSignatures.map(sig => sig.signature)
        );
        
        // Execute through Safe contract
        const tx = await this.safe.execTransaction(
            safeTx.to,
            safeTx.value,
            safeTx.data,
            safeTx.operation,
            safeTx.safeTxGas,
            safeTx.baseGas,
            safeTx.gasPrice,
            safeTx.gasToken,
            safeTx.refundReceiver,
            packedSignatures
        );
        
        return tx;
    }
    
    /**
     * Get Safe configuration
     */
    async getSafeInfo() {
        const [owners, threshold] = await Promise.all([
            this.safe.getOwners(),
            this.safe.getThreshold()
        ]);
        
        return {
            address: this.safeAddress,
            owners,
            threshold: threshold.toNumber(),
            network: this.network
        };
    }
    
    /**
     * Check if address is owner
     */
    async isOwner(address) {
        return await this.safe.isOwner(address);
    }
    
    /**
     * Create a batch transaction for multiple orders
     */
    async createBatchOrderTransaction(orders, multiSigContract) {
        // MultiCall interface for batching
        const multiCallAbi = [
            'function multiCall(bytes[] calldata data) external'
        ];
        
        const orderInterface = new ethers.utils.Interface([
            'function executeOrder(bytes32 orderId)'
        ]);
        
        // Encode each order execution
        const calls = orders.map(order => 
            orderInterface.encodeFunctionData('executeOrder', [order.orderId])
        );
        
        const multiCallInterface = new ethers.utils.Interface(multiCallAbi);
        const batchData = multiCallInterface.encodeFunctionData('multiCall', [calls]);
        
        // Get current nonce
        const nonce = await this.safe.nonce();
        
        const safeTx = {
            to: multiSigContract,
            value: '0',
            data: batchData,
            operation: 0, // CALL
            safeTxGas: 0,
            baseGas: 0,
            gasPrice: 0,
            gasToken: ethers.constants.AddressZero,
            refundReceiver: ethers.constants.AddressZero,
            nonce: nonce.toString()
        };
        
        const txHash = await this.safe.getTransactionHash(
            safeTx.to,
            safeTx.value,
            safeTx.data,
            safeTx.operation,
            safeTx.safeTxGas,
            safeTx.baseGas,
            safeTx.gasPrice,
            safeTx.gasToken,
            safeTx.refundReceiver,
            safeTx.nonce
        );
        
        return {
            safeTx,
            txHash,
            safeAddress: this.safeAddress,
            orderCount: orders.length
        };
    }
    
    /**
     * Helper to sort signatures by signer address
     */
    _sortSignatures(signatures) {
        return signatures.sort((a, b) => {
            const addrA = a.signer.toLowerCase();
            const addrB = b.signer.toLowerCase();
            return addrA < addrB ? -1 : 1;
        });
    }
}

module.exports = GnosisSafeConnector;