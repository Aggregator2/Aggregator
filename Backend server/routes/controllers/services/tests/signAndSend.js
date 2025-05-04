import axios from "axios";
import { Wallet } from "ethers";
import { domain, types } from "../Backend server/signAndSend/lib/signature.js";
import { verifySignature } from "../Backend server/signAndSend/lib/signature.js";

// Hardcoded private key (example only, do not use in production)
const privateKey = "0xYourPrivateKeyHere";
const wallet = new Wallet(privateKey);

// Valid order object
const validOrder = {
    maker: wallet.address,
    taker: "0xdef456...",
    amount: 100,
    price: 2,
    nonce: 1,
    expiry: Math.floor(Date.now() / 1000) + 3600 // 1 hour from now
};

// Tampered order object
const tamperedOrder = {
    ...validOrder,
    amount: 200 // Modified amount
};

async function testVerifyOrder() {
    try {
        // Sign the valid order
        const validSignature = await wallet._signTypedData(domain, types, validOrder);

        // Verify the signature
        if (!verifySignature(validOrder, validSignature, wallet.address)) {
            console.log("❌ Invalid signature");
            throw new Error("Invalid signature for the valid order");
        }
        console.log("✅ Signature verified");

        // Send valid order
        const validResponse = await axios.post("http://localhost:3000/api/verify-order", {
            order: validOrder,
            signature: validSignature,
            signer: wallet.address
        });
        console.log("✅ Valid Order Response:", validResponse.status, validResponse.data);

        // Send tampered order with the same signature
        const tamperedResponse = await axios.post("http://localhost:3000/api/verify-order", {
            order: tamperedOrder,
            signature: validSignature,
            signer: wallet.address
        });
        console.log("❌ Tampered Order Response:", tamperedResponse.status, tamperedResponse.data);
    } catch (error) {
        if (error.response) {
            console.error("Server Response Error:", error.response.status, error.response.data);
        } else {
            console.error("Error:", error.message);
        }
    }
}

testVerifyOrder();

