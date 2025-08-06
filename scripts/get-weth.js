const { ethers } = require("hardhat");

async function main() {
  // WETH contract address on mainnet
  const WETH_ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
  
  // Get the test account
  const [signer] = await ethers.getSigners();
  console.log("Using account:", signer.address);
  console.log("ETH Balance:", ethers.formatEther(await ethers.provider.getBalance(signer.address)), "ETH");
  
  // WETH ABI (just the functions we need)
  const WETH_ABI = [
    "function deposit() payable",
    "function balanceOf(address) view returns (uint256)",
    "function decimals() view returns (uint8)",
    "function symbol() view returns (string)"
  ];
  
  // Connect to WETH contract
  const weth = new ethers.Contract(WETH_ADDRESS, WETH_ABI, signer);
  
  // Check WETH details
  const symbol = await weth.symbol();
  console.log("\nToken Symbol:", symbol);
  
  // Deposit 100 ETH to get 100 WETH
  console.log("\nDepositing 100 ETH to get WETH...");
  const tx = await weth.deposit({ value: ethers.parseEther("100") });
  await tx.wait();
  
  // Check new WETH balance
  const wethBalance = await weth.balanceOf(signer.address);
  console.log("WETH Balance:", ethers.formatEther(wethBalance), "WETH");
  
  // Also give some USDC by impersonating a whale
  const USDC_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
  const USDC_WHALE = "0x47ac0Fb4F2D84898e4D9E7b4DaB3C24507a6D503"; // Binance wallet with lots of USDC
  
  // Impersonate the whale
  await ethers.provider.send("hardhat_impersonateAccount", [USDC_WHALE]);
  const whale = await ethers.getSigner(USDC_WHALE);
  
  // Send whale some ETH for gas
  await signer.sendTransaction({
    to: USDC_WHALE,
    value: ethers.parseEther("1")
  });
  
  // USDC ABI
  const USDC_ABI = [
    "function transfer(address to, uint256 amount) returns (bool)",
    "function balanceOf(address) view returns (uint256)",
    "function decimals() view returns (uint8)"
  ];
  
  const usdc = new ethers.Contract(USDC_ADDRESS, USDC_ABI, whale);
  
  // Transfer 10,000 USDC to our test account
  console.log("\nTransferring USDC from whale...");
  const usdcAmount = ethers.parseUnits("10000", 6); // USDC has 6 decimals
  await usdc.transfer(signer.address, usdcAmount);
  
  // Check USDC balance
  const usdcBalance = await usdc.connect(signer).balanceOf(signer.address);
  console.log("USDC Balance:", ethers.formatUnits(usdcBalance, 6), "USDC");
  
  console.log("\n✅ Success! You now have:");
  console.log("- 100 WETH");
  console.log("- 10,000 USDC");
  console.log("- Ready to test swaps!");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});