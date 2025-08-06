const { ethers } = require("hardhat");

async function main() {
    console.log("🚀 Deploying simple mock contracts...");
    
    const [deployer] = await ethers.getSigners();
    console.log("📋 Deployer:", deployer.address);
    
    // Deploy MockERC20 tokens
    console.log("\n🪙 Deploying mock tokens...");
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    
    // Deploy WETH
    const weth = await MockERC20.deploy("Wrapped Ether", "WETH");
    await weth.waitForDeployment();
    const wethAddress = await weth.getAddress();
    console.log("  WETH deployed to:", wethAddress);
    
    // Deploy USDC
    const usdc = await MockERC20.deploy("USD Coin", "USDC");
    await usdc.waitForDeployment();
    const usdcAddress = await usdc.getAddress();
    console.log("  USDC deployed to:", usdcAddress);
    
    // Mint some tokens to the deployer
    await weth.mint(deployer.address, ethers.parseEther("1000"));
    await usdc.mint(deployer.address, ethers.parseUnits("1000000", 6));
    
    console.log("\n✅ Deployment completed!");
    console.log("📍 Contract Addresses:");
    console.log(`  WETH: ${wethAddress}`);
    console.log(`  USDC: ${usdcAddress}`);
    
    return {
        weth: wethAddress,
        usdc: usdcAddress
    };
}

if (require.main === module) {
    main()
        .then(() => process.exit(0))
        .catch((error) => {
            console.error("❌ Deployment failed:", error);
            process.exit(1);
        });
}

module.exports = main;