require("dotenv").config({ path: ".env.local" });
const { ethers } = require("hardhat");

async function main() {
    // Contract address
    const escrowAddress = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";
    
    // Get the arbiter wallet (same as used in API)
    const arbiterPrivateKey = process.env.ARBITER_PRIVATE_KEY;
    if (!arbiterPrivateKey) {
        throw new Error("ARBITER_PRIVATE_KEY not found in environment");
    }
    
    const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
    const arbiterWallet = new ethers.Wallet(arbiterPrivateKey, provider);
    
    console.log("Arbiter address:", arbiterWallet.address);
    
    // Get contract instance
    const Escrow = await ethers.getContractFactory("Escrow");
    const escrow = Escrow.attach(escrowAddress);
    
    // Check contract arbiter
    const contractArbiter = await escrow.arbiter();
    console.log("Contract arbiter:", contractArbiter);
    console.log("Arbiter matches:", arbiterWallet.address.toLowerCase() === contractArbiter.toLowerCase());
    
    // Test signature generation and verification
    const testData = {
        escrowAddress: escrowAddress,
        to: "0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199",
        token: ethers.ZeroAddress, // Use zero address for ETH
        amount: "50000000000000000" // 0.05 ETH
    };
    
    console.log("\nTest data:", testData);
    
    // EIP-712 domain (matching our API)
    const domain = {
        name: 'Escrow',
        version: '1',
        chainId: 31337,
        verifyingContract: escrowAddress
    };
    
    const types = {
        Release: [
            { name: 'escrowAddress', type: 'address' },
            { name: 'to', type: 'address' },
            { name: 'token', type: 'address' },
            { name: 'amount', type: 'uint256' }
        ]
    };
    
    console.log("\nEIP-712 Domain:", domain);
    console.log("EIP-712 Types:", types);
    
    // Generate signature
    const signature = await arbiterWallet.signTypedData(domain, types, testData);
    console.log("\nGenerated signature:", signature);
    
    // Try to verify the signature manually
    const digest = ethers.TypedDataEncoder.hash(domain, types, testData);
    console.log("Message digest:", digest);
    
    const recoveredAddress = ethers.recoverAddress(digest, signature);
    console.log("Recovered address:", recoveredAddress);
    console.log("Recovery matches arbiter:", recoveredAddress.toLowerCase() === arbiterWallet.address.toLowerCase());
    
    // Test with contract call (dry run)
    try {
        console.log("\n--- Testing contract call ---");
        const tx = await escrow.releaseWithSignature.staticCall(
            testData.to,
            testData.token,
            testData.amount,
            signature
        );
        console.log("✅ Contract call would succeed");
    } catch (error) {
        console.log("❌ Contract call failed:", error.message);
        
        // Let's check if it's a state issue vs signature issue
        const currentState = await escrow.currentState();
        console.log("Current contract state:", currentState.toString());
        console.log("State meanings: 0=AWAITING_DEPOSIT, 1=AWAITING_CONFIRMATION, 2=COMPLETE, 3=REFUNDED");
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
