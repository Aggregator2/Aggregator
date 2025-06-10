require("dotenv").config({ path: ".env.local" });
const { ethers } = require("hardhat");

async function main() {
    // Get the first account (which has 10000 ETH)
    const [sender] = await ethers.getSigners();
    
    // Get arbiter address from private key
    const arbiterWallet = new ethers.Wallet(process.env.ARBITER_PRIVATE_KEY);
    const arbiterAddress = arbiterWallet.address;
    
    console.log("Sender address:", sender.address);
    console.log("Sender balance:", ethers.formatEther(await sender.provider.getBalance(sender.address)), "ETH");
    console.log("Arbiter address:", arbiterAddress);
    console.log("Arbiter balance before:", ethers.formatEther(await sender.provider.getBalance(arbiterAddress)), "ETH");
    
    // Send 1 ETH to the arbiter
    const tx = await sender.sendTransaction({
        to: arbiterAddress,
        value: ethers.parseEther("1.0")
    });
    
    await tx.wait();
    console.log("✅ Transferred 1 ETH to arbiter. Transaction hash:", tx.hash);
    console.log("Arbiter balance after:", ethers.formatEther(await sender.provider.getBalance(arbiterAddress)), "ETH");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("❌ Transfer failed:", error);
        process.exit(1);
    });
