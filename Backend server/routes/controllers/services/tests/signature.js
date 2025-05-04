import { Wallet } from "ethers";
import { domain, types } from "./signature.js";
import { utils } from "ethers";

export function generateOrderHash(order) {
    return utils._TypedDataEncoder.hash(domain, types, order);
}

// Test order object
const order = {
    maker: "0xabc123...",
    taker: "0xdef456...",
    amount: 100,
    price: 2,
    nonce: 1,
    expiry: Math.floor(Date.now() / 1000) + 3600 // 1 hour from now
};

// Simulate signing the order using EIP-712
async function simulateSigning() {
    const privateKey = "0xYourPrivateKeyHere"; // Hardcoded private key (example only, do not use in production)
    const wallet = new Wallet(privateKey);
    const signature = await wallet._signTypedData(domain, types, order);
    console.log("Order:", order);
    console.log("Signature:", signature);
    console.log("Signer Address:", wallet.address);
}

export function verifySignature(order, signature, signer) {
    const recoveredAddress = utils.verifyTypedData(domain, types, order, signature);
    return recoveredAddress.toLowerCase() === signer.toLowerCase();
}

export const domain = {
    name: 'TradeProtocol',
    version: '1',
    chainId: 1,
    verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC'
};

export const types = {
    Order: [
        { name: 'maker', type: 'address' },
        { name: 'taker', type: 'address' },
        { name: 'amount', type: 'uint256' },
        { name: 'price', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'expiry', type: 'uint256' }
    ]
};

