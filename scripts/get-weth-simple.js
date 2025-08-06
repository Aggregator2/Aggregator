const { ethers } = require("ethers");

async function main() {
  // Connect to local Hardhat node
  const provider = new ethers.JsonRpcProvider("http://localhost:8545");
  
  // Use test account private key
  const privateKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
  const wallet = new ethers.Wallet(privateKey, provider);
  
  console.log("Account:", wallet.address);
  console.log("ETH Balance:", ethers.formatEther(await provider.getBalance(wallet.address)), "ETH");
  
  // WETH contract
  const WETH_ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
  const WETH_ABI = [
    "function deposit() payable",
    "function balanceOf(address) view returns (uint256)"
  ];
  
  const weth = new ethers.Contract(WETH_ADDRESS, WETH_ABI, wallet);
  
  // Deposit 100 ETH to get WETH
  console.log("\nDepositing 100 ETH to WETH...");
  const tx = await weth.deposit({ value: ethers.parseEther("100") });
  console.log("Transaction hash:", tx.hash);
  await tx.wait();
  
  // Check WETH balance
  const balance = await weth.balanceOf(wallet.address);
  console.log("WETH Balance:", ethers.formatEther(balance), "WETH");
  
  console.log("\n✅ Success! You now have WETH!");
  console.log("Import this account to MetaMask:");
  console.log("Private Key:", privateKey);
}

main().catch(console.error);