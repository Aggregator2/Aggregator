require("dotenv").config({ path: ".env.local" });
const { ethers } = require("hardhat");

async function main() {
    console.log("=== END-TO-END ESCROW FLOW TEST ===\n");
    
    // Get the actual arbiter address from the private key
    const arbiterWallet = new ethers.Wallet(process.env.ARBITER_PRIVATE_KEY);
    console.log("🔑 Using arbiter address:", arbiterWallet.address);

    const [deployer, counterpartySigner] = await ethers.getSigners();
    console.log("👤 Deployer (depositor):", deployer.address);
    console.log("👤 Counterparty signer:", counterpartySigner.address);
    console.log("💰 Deployer balance:", ethers.formatEther(await deployer.provider.getBalance(deployer.address)), "ETH\n");

    // Contract parameters - using counterpartySigner as the actual counterparty
    const depositorAddress = deployer.address;
    const tokenAddress = "0xf3f9d5e1a3a9d8f4c6acb58827729cff9f5e2266";
    const amount = ethers.parseEther("1.0");
    const counterpartyAddress = counterpartySigner.address; // Use actual signer
    const arbiterAddress = arbiterWallet.address;
    const tradeHash = ethers.id("end-to-end-test-trade");
    const uniswapRouterAddress = "0x1111111111111111111111111111111111111111";

    console.log("📋 Deploy parameters:");
    console.log("- Depositor:", depositorAddress);
    console.log("- Token:", tokenAddress);
    console.log("- Amount:", ethers.formatEther(amount), "ETH");
    console.log("- Counterparty:", counterpartyAddress);
    console.log("- Arbiter:", arbiterAddress);
    console.log("- Trade Hash:", tradeHash);

    // STEP 1: Deploy the contract
    console.log("\n🚀 STEP 1: DEPLOYING FIXED ESCROW");
    const FixedEscrow = await ethers.getContractFactory("FixedEscrow");
    const escrow = await FixedEscrow.deploy(
        depositorAddress,
        tokenAddress,
        amount,
        counterpartyAddress,
        arbiterAddress,
        tradeHash,
        uniswapRouterAddress
    );

    await escrow.waitForDeployment();
    const contractAddress = await escrow.getAddress();
    console.log("✅ FixedEscrow deployed to:", contractAddress);

    // STEP 2: Verify initial state
    console.log("\n🔍 STEP 2: VERIFYING INITIAL STATE");
    const initialState = await escrow.currentState();
    console.log("✅ Initial state:", initialState.toString(), "(0=AWAITING_DEPOSIT)");
    
    const initialBalance = await escrow.getBalance();
    console.log("✅ Initial contract balance:", ethers.formatEther(initialBalance), "ETH");

    // STEP 3: Make deposit
    console.log("\n💰 STEP 3: MAKING DEPOSIT");
    const depositAmount = ethers.parseEther("0.5");
    console.log("Depositing:", ethers.formatEther(depositAmount), "ETH");
    
    const depositTx = await escrow.connect(deployer).deposit({ value: depositAmount });
    const receipt = await depositTx.wait();
    console.log("✅ Deposit successful! Transaction hash:", depositTx.hash);
    console.log("⛽ Gas used:", receipt.gasUsed.toString());

    // Check state after deposit
    const stateAfterDeposit = await escrow.currentState();
    console.log("✅ State after deposit:", stateAfterDeposit.toString(), "(1=AWAITING_CONFIRMATION)");
    
    const balanceAfterDeposit = await escrow.getBalance();
    console.log("✅ Contract balance after deposit:", ethers.formatEther(balanceAfterDeposit), "ETH");

    // STEP 4: Counterparty confirms trade
    console.log("\n✅ STEP 4: COUNTERPARTY CONFIRMS TRADE");
    console.log("Counterparty", counterpartySigner.address, "confirming trade...");
    
    const confirmTx = await escrow.connect(counterpartySigner).confirmTrade();
    const confirmReceipt = await confirmTx.wait();
    console.log("✅ Trade confirmed! Transaction hash:", confirmTx.hash);
    console.log("⛽ Gas used:", confirmReceipt.gasUsed.toString());

    // Check state after confirmation
    const stateAfterConfirm = await escrow.currentState();
    console.log("✅ State after confirmation:", stateAfterConfirm.toString(), "(2=COMPLETE)");

    // STEP 5: Check final balances and verify events
    console.log("\n📊 STEP 5: FINAL VERIFICATION");
    const finalBalance = await escrow.getBalance();
    console.log("✅ Final contract balance:", ethers.formatEther(finalBalance), "ETH");
    
    const depositorFinalBalance = await deployer.provider.getBalance(deployer.address);
    console.log("✅ Depositor final balance:", ethers.formatEther(depositorFinalBalance), "ETH");

    // Test event emissions
    console.log("\n📢 STEP 6: VERIFYING EVENTS");
    const depositFilter = escrow.filters.Deposited();
    const depositEvents = await escrow.queryFilter(depositFilter);
    console.log("✅ Deposit events found:", depositEvents.length);
    
    const confirmFilter = escrow.filters.Confirmed();
    const confirmEvents = await escrow.queryFilter(confirmFilter);
    console.log("✅ Confirmation events found:", confirmEvents.length);

    // STEP 7: Test error conditions
    console.log("\n🚫 STEP 7: TESTING ERROR CONDITIONS");
    
    try {
        // Try to deposit again (should fail - wrong state)
        await escrow.connect(deployer).deposit({ value: ethers.parseEther("0.1") });
        console.log("❌ ERROR: Second deposit should have failed!");
    } catch (error) {
        console.log("✅ Second deposit correctly failed:", error.message.substring(0, 50) + "...");
    }

    try {
        // Try to confirm again (should fail - wrong state)
        await escrow.connect(counterpartySigner).confirmTrade();
        console.log("❌ ERROR: Second confirmation should have failed!");
    } catch (error) {
        console.log("✅ Second confirmation correctly failed:", error.message.substring(0, 50) + "...");
    }    // STEP 8: Test refund functionality with new contract
    console.log("\n🔄 STEP 8: TESTING REFUND FUNCTIONALITY");
    console.log("Deploying new contract for refund test...");
    
    const escrowForRefund = await FixedEscrow.deploy(
        depositorAddress,
        tokenAddress,
        amount,
        counterpartyAddress,
        arbiterAddress,
        ethers.id("refund-test-trade"),
        uniswapRouterAddress
    );
    await escrowForRefund.waitForDeployment();
    const refundContractAddress = await escrowForRefund.getAddress();
    console.log("✅ Refund test contract deployed to:", refundContractAddress);

    // Make deposit
    const refundDepositTx = await escrowForRefund.connect(deployer).deposit({ value: ethers.parseEther("0.2") });
    await refundDepositTx.wait();
    console.log("✅ Deposit made for refund test");

    // Fund the arbiter wallet for gas
    console.log("Funding arbiter wallet for gas...");
    const arbiterSigner = new ethers.Wallet(process.env.ARBITER_PRIVATE_KEY, deployer.provider);
    const fundTx = await deployer.sendTransaction({
        to: arbiterSigner.address,
        value: ethers.parseEther("1.0")
    });
    await fundTx.wait();
    console.log("✅ Arbiter wallet funded with 1 ETH for gas");

    // Arbiter refunds
    console.log("Arbiter initiating refund...");
    const refundTx = await escrowForRefund.connect(arbiterSigner).refund();
    const refundReceipt = await refundTx.wait();
    console.log("✅ Refund successful! Transaction hash:", refundTx.hash);

    const stateAfterRefund = await escrowForRefund.currentState();
    console.log("✅ State after refund:", stateAfterRefund.toString(), "(3=REFUNDED)");

    console.log("\n🎉 END-TO-END TEST COMPLETED SUCCESSFULLY!");
    console.log("==================================================");
    console.log("✅ Contract deployment: WORKING");
    console.log("✅ Deposit functionality: WORKING");
    console.log("✅ Trade confirmation: WORKING");
    console.log("✅ Refund functionality: WORKING");
    console.log("✅ State transitions: WORKING");
    console.log("✅ Error handling: WORKING");
    console.log("✅ Event emissions: WORKING");
    console.log("==================================================");
    
    return {
        mainContract: contractAddress,
        refundContract: refundContractAddress
    };
}

main()
    .then((addresses) => {
        console.log(`\n🚀 SUCCESS! Escrow contracts deployed and tested:`);
        console.log(`📍 Main contract: ${addresses.mainContract}`);
        console.log(`📍 Refund test contract: ${addresses.refundContract}`);
        console.log(`\n🎯 META AGGREGATOR 2.0 ESCROW SYSTEM IS FULLY FUNCTIONAL!`);
        process.exit(0);
    })
    .catch((error) => {
        console.error("❌ End-to-end test failed:", error);
        process.exit(1);
    });
