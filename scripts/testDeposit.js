const { ethers } = require("hardhat");

async function main() {
    // Contract address - use the latest deployment (this gets overwritten each deployment)
    const escrowAddress = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
    
    // Get signers - the depositor is the first signer (same as in deploy script)
    const [depositor] = await ethers.getSigners();
      console.log("Depositor address:", depositor.address);
    console.log("Depositor balance:", ethers.formatEther(await depositor.provider.getBalance(depositor.address)), "ETH");
      // Get contract instance - using FixedEscrow instead of Escrow
    const FixedEscrow = await ethers.getContractFactory("FixedEscrow");
    const escrow = FixedEscrow.attach(escrowAddress);
    
    // Check current state
    const currentState = await escrow.currentState();
    console.log("Current state:", currentState); // 0 = AWAITING_DEPOSIT, 1 = AWAITING_CONFIRMATION, 2 = COMPLETE, 3 = REFUNDED
    
    // Check if we need to deposit
    if (currentState == 0) { // AWAITING_DEPOSIT
        console.log("Making deposit...");
          // Make deposit (0.1 ETH)
        const depositAmount = ethers.parseEther("0.1");
        const tx = await escrow.connect(depositor).deposit({ value: depositAmount });
        await tx.wait();
        
        console.log("Deposit successful! Transaction hash:", tx.hash);
        console.log("Deposited amount:", ethers.formatEther(depositAmount), "ETH");
    } else {
        console.log("Contract is not in AWAITING_DEPOSIT state");
    }
    
    // Check new state
    const newState = await escrow.currentState();
    console.log("New state:", newState);
      // Check contract balance
    const contractBalance = await ethers.provider.getBalance(escrowAddress);
    console.log("Contract balance:", ethers.formatEther(contractBalance), "ETH");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
