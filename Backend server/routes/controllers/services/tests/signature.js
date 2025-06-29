import { Wallet, utils } from "ethers";


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
// eslint-disable-next-line @typescript-eslint/no-unused-vars
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


