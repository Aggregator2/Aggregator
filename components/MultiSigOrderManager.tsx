import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { useAccount, useContract, useSigner } from 'wagmi';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, Shield, Clock, Users, Key, CheckCircle2 } from 'lucide-react';
import { toast } from 'react-hot-toast';

const MultiSigOrderManager = ({ multiSigContract, orderData }) => {
    const { address } = useAccount();
    const { data: signer } = useSigner();
    
    const [sigScheme, setSigScheme] = useState('EOA');
    const [threshold, setThreshold] = useState(2);
    const [signers, setSigners] = useState([]);
    const [newSigner, setNewSigner] = useState('');
    const [timeLock, setTimeLock] = useState(0);
    const [pendingOrders, setPendingOrders] = useState([]);
    const [hardwareWallet, setHardwareWallet] = useState(null);
    
    // Multi-sig contract instance
    const multiSigManager = useContract({
        address: multiSigContract,
        abi: [
            'function createMultiSigOrder(bytes orderData, uint256 requiredSigs, address[] signers, uint8 scheme, uint256 timeLock) returns (bytes32)',
            'function signOrder(bytes32 orderId)',
            'function executeOrder(bytes32 orderId)',
            'function getOrderDetails(bytes32 orderId) view returns (tuple(bytes orderData, uint256 requiredSignatures, address[] signers, uint256 signatureCount, uint8 signatureScheme, uint256 timeLock, uint256 createdAt, bool executed, mapping(address => bool) hasSigned))',
            'function signWithHardwareWallet(bytes32 orderId, bytes signature)',
            'event OrderCreated(bytes32 indexed orderId, uint256 requiredSignatures)',
            'event OrderSigned(bytes32 indexed orderId, address indexed signer)',
            'event OrderExecuted(bytes32 indexed orderId)'
        ],
        signerOrProvider: signer
    });
    
    // Signature schemes
    const signatureSchemes = [
        { value: 'EOA', label: 'Standard Wallet', icon: Key },
        { value: 'EIP1271', label: 'Smart Contract Wallet', icon: Shield },
        { value: 'Threshold', label: 'Threshold Signature', icon: Users },
        { value: 'TimeLocked', label: 'Time-Locked', icon: Clock },
        { value: 'GnosisSafe', label: 'Gnosis Safe', icon: Shield }
    ];
    
    // Load pending orders
    useEffect(() => {
        loadPendingOrders();
    }, [multiSigContract]);
    
    const loadPendingOrders = async () => {
        try {
            // In production, this would query events or a backend API
            // For now, using mock data
            const mockOrders = [
                {
                    orderId: '0x123...',
                    type: 'SWAP',
                    amount: '1000 USDC',
                    requiredSigs: 2,
                    currentSigs: 1,
                    signers: ['0xabc...', '0xdef...'],
                    timeLock: 0,
                    executed: false
                }
            ];
            setPendingOrders(mockOrders);
        } catch (error) {
            console.error('Failed to load orders:', error);
        }
    };
    
    const handleAddSigner = () => {
        if (ethers.utils.isAddress(newSigner) && !signers.includes(newSigner)) {
            setSigners([...signers, newSigner]);
            setNewSigner('');
        } else {
            toast.error('Invalid address or already added');
        }
    };
    
    const handleRemoveSigner = (address) => {
        setSigners(signers.filter(s => s !== address));
    };
    
    const createMultiSigOrder = async () => {
        try {
            if (signers.length < threshold) {
                toast.error('Not enough signers for threshold');
                return;
            }
            
            // Encode order data
            const encodedOrderData = ethers.utils.defaultAbiCoder.encode(
                ['address', 'uint256', 'address', 'uint256', 'bytes'],
                [orderData.tokenIn, orderData.amountIn, orderData.tokenOut, orderData.minAmountOut, '0x']
            );
            
            // Create multi-sig order
            const tx = await multiSigManager.createMultiSigOrder(
                encodedOrderData,
                threshold,
                signers,
                signatureSchemes.findIndex(s => s.value === sigScheme),
                timeLock
            );
            
            toast.loading('Creating multi-sig order...');
            const receipt = await tx.wait();
            
            // Get order ID from event
            const event = receipt.events.find(e => e.event === 'OrderCreated');
            const orderId = event.args.orderId;
            
            toast.success(`Multi-sig order created: ${orderId.slice(0, 10)}...`);
            loadPendingOrders();
            
        } catch (error) {
            console.error('Failed to create order:', error);
            toast.error('Failed to create multi-sig order');
        }
    };
    
    const signOrder = async (orderId) => {
        try {
            if (hardwareWallet) {
                // Sign with hardware wallet
                const orderDetails = await multiSigManager.getOrderDetails(orderId);
                const signature = await hardwareWallet.signMultiSigOrder({
                    orderId,
                    orderData: orderDetails.orderData,
                    threshold: orderDetails.requiredSignatures
                });
                
                const tx = await multiSigManager.signWithHardwareWallet(orderId, signature);
                toast.loading('Signing with hardware wallet...');
                await tx.wait();
            } else {
                // Sign with connected wallet
                const tx = await multiSigManager.signOrder(orderId);
                toast.loading('Signing order...');
                await tx.wait();
            }
            
            toast.success('Order signed successfully');
            loadPendingOrders();
            
        } catch (error) {
            console.error('Failed to sign order:', error);
            toast.error('Failed to sign order');
        }
    };
    
    const executeOrder = async (orderId) => {
        try {
            const tx = await multiSigManager.executeOrder(orderId);
            toast.loading('Executing order...');
            await tx.wait();
            
            toast.success('Order executed successfully');
            loadPendingOrders();
            
        } catch (error) {
            console.error('Failed to execute order:', error);
            toast.error('Failed to execute order');
        }
    };
    
    const connectHardwareWallet = async (type) => {
        try {
            let connector;
            if (type === 'ledger') {
                const { LedgerConnector } = await import('@/lib/hardware-wallet/LedgerConnector');
                connector = new LedgerConnector();
            } else if (type === 'trezor') {
                const { TrezorConnector } = await import('@/lib/hardware-wallet/TrezorConnector');
                connector = new TrezorConnector();
            }
            
            await connector.connect();
            setHardwareWallet(connector);
            toast.success(`${type} connected successfully`);
            
        } catch (error) {
            console.error('Failed to connect hardware wallet:', error);
            toast.error(`Failed to connect ${type}`);
        }
    };
    
    return (
        <div className="space-y-6">
            {/* Create Multi-Sig Order */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Shield className="h-5 w-5" />
                        Create Multi-Signature Order
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    {/* Signature Scheme */}
                    <div>
                        <label className="block text-sm font-medium mb-2">
                            Signature Scheme
                        </label>
                        <Select value={sigScheme} onValueChange={setSigScheme}>
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {signatureSchemes.map(scheme => (
                                    <SelectItem key={scheme.value} value={scheme.value}>
                                        <div className="flex items-center gap-2">
                                            <scheme.icon className="h-4 w-4" />
                                            {scheme.label}
                                        </div>
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    
                    {/* Threshold */}
                    <div>
                        <label className="block text-sm font-medium mb-2">
                            Required Signatures
                        </label>
                        <Input
                            type="number"
                            min="1"
                            max={signers.length || 1}
                            value={threshold}
                            onChange={(e) => setThreshold(parseInt(e.target.value))}
                        />
                        <p className="text-sm text-gray-500 mt-1">
                            {threshold} of {signers.length} signatures required
                        </p>
                    </div>
                    
                    {/* Signers */}
                    <div>
                        <label className="block text-sm font-medium mb-2">
                            Authorized Signers
                        </label>
                        <div className="space-y-2">
                            {signers.map((signer, index) => (
                                <div key={index} className="flex items-center gap-2">
                                    <Input
                                        value={signer}
                                        readOnly
                                        className="flex-1"
                                    />
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handleRemoveSigner(signer)}
                                    >
                                        Remove
                                    </Button>
                                </div>
                            ))}
                            <div className="flex gap-2">
                                <Input
                                    placeholder="Add signer address"
                                    value={newSigner}
                                    onChange={(e) => setNewSigner(e.target.value)}
                                />
                                <Button onClick={handleAddSigner}>
                                    Add
                                </Button>
                            </div>
                        </div>
                    </div>
                    
                    {/* Time Lock */}
                    {sigScheme === 'TimeLocked' && (
                        <div>
                            <label className="block text-sm font-medium mb-2">
                                Time Lock (seconds)
                            </label>
                            <Input
                                type="number"
                                min="0"
                                value={timeLock}
                                onChange={(e) => setTimeLock(parseInt(e.target.value))}
                            />
                        </div>
                    )}
                    
                    {/* Hardware Wallet */}
                    <div className="flex gap-2">
                        <Button
                            variant="outline"
                            onClick={() => connectHardwareWallet('ledger')}
                            disabled={hardwareWallet?.type === 'ledger'}
                        >
                            {hardwareWallet?.type === 'ledger' ? 'Ledger Connected' : 'Connect Ledger'}
                        </Button>
                        <Button
                            variant="outline"
                            onClick={() => connectHardwareWallet('trezor')}
                            disabled={hardwareWallet?.type === 'trezor'}
                        >
                            {hardwareWallet?.type === 'trezor' ? 'Trezor Connected' : 'Connect Trezor'}
                        </Button>
                    </div>
                    
                    <Button
                        className="w-full"
                        onClick={createMultiSigOrder}
                        disabled={signers.length < threshold}
                    >
                        Create Multi-Sig Order
                    </Button>
                </CardContent>
            </Card>
            
            {/* Pending Orders */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Clock className="h-5 w-5" />
                        Pending Multi-Sig Orders
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="space-y-4">
                        {pendingOrders.map((order) => (
                            <div
                                key={order.orderId}
                                className="border rounded-lg p-4 space-y-3"
                            >
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="font-medium">
                                            {order.type} - {order.amount}
                                        </p>
                                        <p className="text-sm text-gray-500">
                                            Order ID: {order.orderId}
                                        </p>
                                    </div>
                                    <Badge variant={order.executed ? 'success' : 'warning'}>
                                        {order.executed ? 'Executed' : 'Pending'}
                                    </Badge>
                                </div>
                                
                                <div className="flex items-center gap-4 text-sm">
                                    <span className="flex items-center gap-1">
                                        <Users className="h-4 w-4" />
                                        {order.currentSigs}/{order.requiredSigs} signatures
                                    </span>
                                    {order.timeLock > 0 && (
                                        <span className="flex items-center gap-1">
                                            <Clock className="h-4 w-4" />
                                            Time-locked
                                        </span>
                                    )}
                                </div>
                                
                                <div className="flex gap-2">
                                    {!order.executed && order.currentSigs < order.requiredSigs && (
                                        <Button
                                            size="sm"
                                            onClick={() => signOrder(order.orderId)}
                                        >
                                            Sign Order
                                        </Button>
                                    )}
                                    {!order.executed && order.currentSigs >= order.requiredSigs && (
                                        <Button
                                            size="sm"
                                            variant="success"
                                            onClick={() => executeOrder(order.orderId)}
                                        >
                                            Execute Order
                                        </Button>
                                    )}
                                </div>
                            </div>
                        ))}
                        
                        {pendingOrders.length === 0 && (
                            <div className="text-center py-8 text-gray-500">
                                <Shield className="h-12 w-12 mx-auto mb-3 opacity-50" />
                                <p>No pending multi-sig orders</p>
                            </div>
                        )}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
};

export default MultiSigOrderManager;