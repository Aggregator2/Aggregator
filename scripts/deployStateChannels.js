const { ethers } = require("hardhat");

async function main() {
  const [deployer, alice, bob] = await ethers.getSigners();

  console.log("Deploying State Channel contracts with the account:", deployer.address);
  console.log("Account balance:", (await deployer.getBalance()).toString());

  // Deploy MockERC20 for testing
  console.log("\nDeploying MockERC20...");
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const token = await MockERC20.deploy("State Channel Token", "SCT");
  await token.deployed();
  console.log("MockERC20 deployed to:", token.address);

  // Mint tokens to test accounts
  console.log("\nMinting tokens...");
  await token.mint(alice.address, ethers.utils.parseEther("10000"));
  await token.mint(bob.address, ethers.utils.parseEther("10000"));
  console.log("Minted 10,000 SCT to Alice:", alice.address);
  console.log("Minted 10,000 SCT to Bob:", bob.address);

  // Deploy StateChannelFactory
  console.log("\nDeploying StateChannelFactory...");
  const StateChannelFactory = await ethers.getContractFactory("StateChannelFactory");
  const factory = await StateChannelFactory.deploy();
  await factory.deployed();
  console.log("StateChannelFactory deployed to:", factory.address);

  // Create a sample channel
  console.log("\nCreating a sample state channel...");
  const participants = [alice.address, bob.address];
  const challengePeriod = 3600; // 1 hour
  const nonce = 1;

  const params = {
    participants,
    token: token.address,
    challengePeriod,
    nonce
  };

  // Create message hash for signatures
  const messageHash = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ["string", "address[]", "address", "uint256", "uint256", "uint256", "address"],
      ["StateChannel", participants, token.address, challengePeriod, nonce, 31337, factory.address]
    )
  );

  // Get signatures from participants
  const aliceSignature = await alice.signMessage(ethers.utils.arrayify(messageHash));
  const bobSignature = await bob.signMessage(ethers.utils.arrayify(messageHash));

  // Create channel
  const tx = await factory.connect(alice).createChannel(params, [aliceSignature, bobSignature]);
  const receipt = await tx.wait();

  // Extract channel address from events
  const event = receipt.events?.find(e => e.event === "ChannelCreated");
  const channelAddress = event?.args?.channelAddress;
  const channelId = event?.args?.channelId;

  console.log("\nState Channel created!");
  console.log("Channel ID:", channelId);
  console.log("Channel Address:", channelAddress);

  // Save deployment info
  const deploymentInfo = {
    network: network.name,
    timestamp: new Date().toISOString(),
    contracts: {
      token: {
        address: token.address,
        name: "State Channel Token",
        symbol: "SCT"
      },
      factory: {
        address: factory.address
      },
      sampleChannel: {
        id: channelId,
        address: channelAddress,
        participants: participants,
        token: token.address,
        challengePeriod: challengePeriod
      }
    },
    testAccounts: {
      alice: alice.address,
      bob: bob.address
    }
  };

  console.log("\n=== Deployment Summary ===");
  console.log(JSON.stringify(deploymentInfo, null, 2));

  // Write to file
  const fs = require("fs");
  const path = require("path");
  const deploymentsDir = path.join(__dirname, "../deployments");
  
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir);
  }

  const filename = path.join(deploymentsDir, `stateChannels-${network.name}-${Date.now()}.json`);
  fs.writeFileSync(filename, JSON.stringify(deploymentInfo, null, 2));
  console.log(`\nDeployment info saved to: ${filename}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });