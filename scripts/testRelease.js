const { ethers } = require("hardhat");

async function main() {
    // Contract address
    const escrowAddress = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";
    
    // Get signers
    const [depositor] = await ethers.getSigners();
    
    // Get contract instance
    const Escrow = await ethers.getContractFactory("Escrow");
    const escrow = Escrow.attach(escrowAddress);
    
    // Check current state
    const currentState = await escrow.currentState();
    console.log("Current state:", currentState.toString());
    
    // Check contract balance
    const contractBalance = await ethers.provider.getBalance(escrowAddress);
    console.log("Contract balance:", ethers.formatEther(contractBalance), "ETH");
    
    // Prepare release parameters
    const to = "0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199";
    const token = ethers.ZeroAddress; // ETH
    const amount = ethers.parseEther("0.05"); // 0.05 ETH
    
    console.log("Release parameters:");
    console.log("- to:", to);
    console.log("- token:", token);
    console.log("- amount:", amount.toString());
    console.log("- escrowAddress:", escrowAddress);
    
    // Get arbiter private key and create wallet
    const arbiterPrivateKey = process.env.ARBITER_PRIVATE_KEY;
    const arbiterWallet = new ethers.Wallet(arbiterPrivateKey);
    console.log("Arbiter address:", arbiterWallet.address);
    
    // Check if arbiter matches contract arbiter
    const contractArbiter = await escrow.arbiter();
    console.log("Contract arbiter:", contractArbiter);
    console.log("Arbiter match:", arbiterWallet.address === contractArbiter);
    
    // Create EIP-712 domain
    const domain = {
        name: "Escrow",
        version: "1",
        chainId: 31337,
        verifyingContract: escrowAddress
    };
    
    // Create EIP-712 types
    const types = {
        Release: [
            { name: "escrowAddress", type: "address" },
            { name: "to", type: "address" },
            { name: "token", type: "address" },
            { name: "amount", type: "uint256" }
        ]
    };
    
    // Create value object for signing
    const value = {
        escrowAddress: escrowAddress,
        to: to,
        token: token,
        amount: amount.toString()
    };
    
    console.log("Signing value:", value);
    
    // Sign the message
    const signature = await arbiterWallet.signTypedData(domain, types, value);
    console.log("Generated signature:", signature);
    
    // Try to call the contract
    try {
        console.log("Attempting to release funds...");
        const tx = await escrow.connect(depositor).releaseWithSignature(to, token, amount, signature);
        await tx.wait();
        console.log("✅ Release successful! Transaction hash:", tx.hash);
    } catch (error) {
        console.error("❌ Release failed:", error.message);
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
