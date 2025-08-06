/**
 * @fileoverview TypeScript type definitions for SwappiQ Signature Verification System
 * @author SwappiQ Protocol
 */

import { BigNumber, BigNumberish } from 'ethers';

// ========== ENUMS ==========

export enum SignatureType {
    STANDARD = 0,
    MULTISIG = 1,
    HARDWARE_WALLET = 2,
    CROSS_CHAIN = 3
}

export enum SignatureStatus {
    VALID = 0,
    EXPIRED = 1,
    REVOKED = 2,
    USED = 3,
    INVALID = 4
}

export enum OrderSide {
    BUY = 0,
    SELL = 1
}

// ========== CORE INTERFACES ==========

export interface EIP712Domain {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: string;
}

export interface OrderParams {
    trader: string;
    baseToken: string;
    quoteToken: string;
    side: OrderSide;
    amount: BigNumberish;
    price: BigNumberish;
    deadline?: number;
    salt?: string;
}

export interface Order {
    trader: string;
    baseToken: string;
    quoteToken: string;
    side: OrderSide;
    amount: BigNumber;
    price: BigNumber;
    deadline: number;
    salt: string;
    chainId: number;
}

export interface SignedOrder extends Order {
    signature: string;
    sigType: SignatureType;
}

export interface MultiSigOrderParams extends OrderParams {
    requiredSignatures: number;
    signers: string[];
}

export interface MultiSigOrder extends Order {
    requiredSignatures: number;
    signers: string[];
    signatures: string[];
}

export interface CrossChainOrderParams extends OrderParams {
    sourceChain: number;
    targetChain: number;
    bridgeId?: string;
}

export interface CrossChainOrder extends Order {
    sourceChain: number;
    targetChain: number;
    bridgeId: string;
    signature: string;
}

// ========== WALLET CONFIGURATIONS ==========

export interface HardwareWalletConfig {
    walletAddress: string;
    deviceType: 'ledger' | 'trezor' | string;
    deviceId: string;
    requiresExtendedDeadline: boolean;
    owner?: string;
    registrationTime?: number;
}

export interface MultiSigWalletConfig {
    walletAddress: string;
    requiredSignatures: number;
    signers: string[];
    isActive?: boolean;
    totalSigners?: number;
}

export interface HardwareWalletInfo {
    isRegistered: boolean;
    deviceType: string;
    deviceId: string;
    owner: string;
    registrationTime: number;
    requiresExtendedDeadline: boolean;
}

export interface MultiSigWalletInfo {
    isActive: boolean;
    requiredSignatures: number;
    totalSigners: number;
    signers: string[];
}

// ========== DELEGATION AND AUTHORIZATION ==========

export interface DelegationParams {
    owner: string;
    delegate: string;
    deadline: number;
    nonce: number;
    chainId: number;
}

export interface SignedDelegation extends DelegationParams {
    signature: string;
}

export interface RevocationParams {
    signatureHash: string;
    deadline: number;
    nonce: number;
    chainId: number;
}

export interface SignedRevocation extends RevocationParams {
    signature: string;
}

// ========== VERIFICATION RESULTS ==========

export interface VerificationResult {
    isValid: boolean;
    signatureHash: string;
    order: SignedOrder;
    error?: string;
}

export interface MultiSigVerificationResult {
    isValid: boolean;
    orderHash: string;
    validSignatures: number;
    requiredSignatures: number;
    order: MultiSigOrder;
    error?: string;
}

export interface CrossChainVerificationResult {
    isValid: boolean;
    orderHash: string;
    order: CrossChainOrder;
    error?: string;
}

// ========== CACHING ==========

export interface SignatureCache {
    structHash: string;
    signer: string;
    expiryTime: number;
    isValid: boolean;
    sigType: SignatureType;
}

export interface CacheEntry {
    order: SignedOrder;
    timestamp: number;
    ttl: number;
}

export interface CacheSettings {
    enabled: boolean;
    defaultTTL: number;
    maxTTL: number;
}

// ========== SDK CONFIGURATION ==========

export interface SignatureSDKConfig {
    contractAddress: string;
    provider: any; // ethers.providers.Provider
    name?: string;
    version?: string;
    chainId?: number;
    cacheSettings?: Partial<CacheSettings>;
}

export interface BatchOperationResult<T> {
    success: boolean;
    data?: T;
    error?: string;
}

export interface BatchVerificationResult {
    signatureHash: string;
    isValid: boolean;
    order: SignedOrder;
    error?: string;
}

export interface BatchRevocationResult {
    signatureHash: string;
    txHash?: string;
    success: boolean;
    error?: string;
}

// ========== HARDWARE WALLET INTEGRATION ==========

export interface LedgerConfig {
    address: string;
    deviceType: 'ledger';
    deviceId: string;
    requiresExtendedDeadline: boolean;
    chainCode?: string;
}

export interface TrezorConfig {
    address: string;
    deviceType: 'trezor';
    deviceId: string;
    requiresExtendedDeadline: boolean;
    serialNumber?: string;
}

export interface HardwareWalletConnection {
    address: string;
    deviceType: string;
    deviceId: string;
    requiresExtendedDeadline: boolean;
}

// ========== CROSS-CHAIN SUPPORT ==========

export interface ChainConfig {
    chainId: number;
    name: string;
    rpcUrl: string;
    verifierContract?: string;
    supported: boolean;
}

export interface BridgeConfig {
    bridgeId: string;
    name: string;
    supportedChains: number[];
    contractAddress?: string;
}

// ========== EVENT TYPES ==========

export interface SignatureVerifiedEvent {
    signatureHash: string;
    signer: string;
    sigType: SignatureType;
    cached: boolean;
    blockNumber: number;
    transactionHash: string;
}

export interface SignatureRevokedEvent {
    signatureHash: string;
    revoker: string;
    timestamp: number;
    blockNumber: number;
    transactionHash: string;
}

export interface MultiSigWalletRegisteredEvent {
    wallet: string;
    requiredSignatures: number;
    signers: string[];
    blockNumber: number;
    transactionHash: string;
}

export interface HardwareWalletRegisteredEvent {
    wallet: string;
    deviceType: string;
    deviceId: string;
    blockNumber: number;
    transactionHash: string;
}

export interface DelegationGrantedEvent {
    owner: string;
    delegate: string;
    deadline: number;
    blockNumber: number;
    transactionHash: string;
}

export interface CrossChainOrderProcessedEvent {
    orderHash: string;
    sourceChain: number;
    targetChain: number;
    blockNumber: number;
    transactionHash: string;
}

// ========== ERROR TYPES ==========

export class SignatureError extends Error {
    public readonly code: string;
    public readonly details?: any;

    constructor(message: string, code: string, details?: any) {
        super(message);
        this.name = 'SignatureError';
        this.code = code;
        this.details = details;
    }
}

export class ValidationError extends SignatureError {
    constructor(message: string, details?: any) {
        super(message, 'VALIDATION_ERROR', details);
        this.name = 'ValidationError';
    }
}

export class HardwareWalletError extends SignatureError {
    constructor(message: string, details?: any) {
        super(message, 'HARDWARE_WALLET_ERROR', details);
        this.name = 'HardwareWalletError';
    }
}

export class MultiSigError extends SignatureError {
    constructor(message: string, details?: any) {
        super(message, 'MULTISIG_ERROR', details);
        this.name = 'MultiSigError';
    }
}

export class CrossChainError extends SignatureError {
    constructor(message: string, details?: any) {
        super(message, 'CROSS_CHAIN_ERROR', details);
        this.name = 'CrossChainError';
    }
}

// ========== UTILITY TYPES ==========

export type Address = string;
export type Hash = string;
export type Bytes32 = string;
export type Signature = string;

export interface TypedData {
    types: Record<string, Array<{ name: string; type: string }>>;
    primaryType: string;
    domain: EIP712Domain;
    message: Record<string, any>;
}

export interface SigningOptions {
    cache?: boolean;
    validateOnSign?: boolean;
    extendDeadline?: boolean;
    hardwareWalletSupport?: boolean;
}

export interface VerificationOptions {
    useCache?: boolean;
    skipExpiration?: boolean;
    allowRevoked?: boolean;
}

// ========== CONTRACT ABI TYPES ==========

export interface ContractOrder {
    trader: string;
    baseToken: string;
    quoteToken: string;
    side: number;
    amount: BigNumber;
    price: BigNumber;
    deadline: number;
    salt: BigNumber;
    chainId: number;
    signature: string;
    sigType: number;
}

export interface ContractMultiSigOrder {
    trader: string;
    baseToken: string;
    quoteToken: string;
    side: number;
    amount: BigNumber;
    price: BigNumber;
    deadline: number;
    salt: BigNumber;
    chainId: number;
    requiredSignatures: number;
    signers: string[];
    signatures: string[];
}

export interface ContractCrossChainOrder {
    trader: string;
    baseToken: string;
    quoteToken: string;
    side: number;
    amount: BigNumber;
    price: BigNumber;
    deadline: number;
    salt: BigNumber;
    sourceChain: number;
    targetChain: number;
    bridgeId: string;
    signature: string;
}

// ========== SDK METHOD RETURN TYPES ==========

export interface SignOrderResult {
    order: SignedOrder;
    signatureHash: string;
    cached: boolean;
}

export interface SignMultiSigOrderResult {
    order: MultiSigOrder;
    orderHash: string;
    validSignatures: number;
}

export interface SignCrossChainOrderResult {
    order: CrossChainOrder;
    orderHash: string;
}

export interface RegisterWalletResult {
    txHash: string;
    walletAddress: string;
    confirmed: boolean;
}

export interface RevocationResult {
    txHash: string;
    signatureHash: string;
    confirmed: boolean;
}

// ========== ADVANCED FEATURES ==========

export interface OrderMetadata {
    orderId?: string;
    timestamp: number;
    source: string;
    version: string;
    tags?: string[];
}

export interface SignedOrderWithMetadata extends SignedOrder {
    metadata: OrderMetadata;
}

export interface AnalyticsData {
    signatureCount: number;
    verificationCount: number;
    revocationCount: number;
    errorRate: number;
    averageSigningTime: number;
    hardwareWalletUsage: number;
    multiSigUsage: number;
    crossChainUsage: number;
}

// ========== EXPORT ALL ==========

export {
    // Re-export commonly used ethers types
    BigNumber,
    BigNumberish
} from 'ethers';

// Default export for easier importing
export default {
    SignatureType,
    SignatureStatus,
    OrderSide,
    SignatureError,
    ValidationError,
    HardwareWalletError,
    MultiSigError,
    CrossChainError
};