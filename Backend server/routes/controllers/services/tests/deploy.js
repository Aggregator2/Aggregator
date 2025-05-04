async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying contracts with account:", deployer.address);
  
    const Escrow = await ethers.getContractFactory("Escrow");
    const escrow = await Escrow.deploy(/* constructor args if any */);
    await escrow.deployed();
  
    console.log("Escrow deployed to:", escrow.address);
  }
  
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
  