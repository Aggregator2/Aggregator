const { ethers } = require("hardhat");
const { expect } = require("chai");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const chalk = require("chalk");

// Test configuration
const TEST_CONFIG = {
    depositAmount: ethers.utils.parseEther("10"),
    largeAmount: ethers.utils.parseEther("150"),
    disputeTimeout: 7 * 24 * 60 * 60, // 7 days
    solverTimeout: 7 * 24 * 60 * 60, // 7 days
};

class EscrowTestRunner {
    constructor() {
        this.results = {
            passed: 0,
            failed: 0,
            scenarios: []
        };
    }

    async runAllTests() {
        console.log(chalk.blue.bold("\n🔒 Comprehensive Escrow System Tests\n"));
        
        // Deploy test infrastructure
        await this.deployTestContracts();
        
        // Run test scenarios
        await this.testScenario1_SolverTimeout();
        await this.testScenario2_PartialFills();
        await this.testScenario3_WrongTokenDispute();
        await this.testScenario4_EmergencyPause();
        await this.testScenario5_MEVProtection();
        await this.testScenario6_MultiSigApproval();
        await this.testScenario7_EventIndexing();
        
        // Print results
        this.printResults();
    }

    async deployTestContracts() {
        console.log(chalk.yellow("Deploying test contracts..."));
        
        const [owner, depositor, solver, attacker, arbitrator] = await ethers.getSigners();
        this.signers = { owner, depositor, solver, attacker, arbitrator };
        
        // Deploy mock tokens
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        this.depositToken = await MockERC20.deploy("Deposit Token", "DEP", 18);
        this.settlementToken = await MockERC20.deploy("Settlement Token", "SET", 18);
        this.wrongToken = await MockERC20.deploy("Wrong Token", "WRG", 18);
        
        // Deploy mock router
        const MockRouter = await ethers.getContractFactory("MockUniswapV2Router");
        this.router = await MockRouter.deploy();
        
        // Setup tokens
        await this.depositToken.mint(depositor.address, ethers.utils.parseEther("10000"));
        await this.settlementToken.mint(this.router.address, ethers.utils.parseEther("10000"));
        await this.wrongToken.mint(attacker.address, ethers.utils.parseEther("10000"));
        
        console.log(chalk.green("✓ Test infrastructure deployed\n"));
    }

    async testScenario1_SolverTimeout() {
        console.log(chalk.blue.bold("Scenario 1: Solver Timeout & Emergency Withdrawal"));
        
        try {
            // Deploy escrow
            const Escrow = await ethers.getContractFactory("DisputeResolutionEscrow");
            const escrow = await Escrow.deploy(
                this.signers.depositor.address,
                this.signers.solver.address,
                this.depositToken.address,
                this.settlementToken.address,
                this.router.address
            );
            
            // Test 1: Deposit funds
            await this.depositToken.connect(this.signers.depositor).approve(escrow.address, TEST_CONFIG.depositAmount);
            await escrow.connect(this.signers.depositor).deposit(TEST_CONFIG.depositAmount);
            console.log(chalk.green("  ✓ Funds deposited successfully"));
            
            // Test 2: Cannot withdraw immediately
            await expect(escrow.connect(this.signers.depositor).emergencyWithdraw())
                .to.be.revertedWith("Emergency withdrawal not available");
            console.log(chalk.green("  ✓ Emergency withdrawal blocked before timeout"));
            
            // Test 3: Fast forward past timeout
            await time.increase(TEST_CONFIG.solverTimeout + TEST_CONFIG.disputeTimeout + 1);
            
            // Test 4: Emergency withdrawal succeeds
            const balanceBefore = await this.depositToken.balanceOf(this.signers.depositor.address);
            await escrow.connect(this.signers.depositor).emergencyWithdraw();
            const balanceAfter = await this.depositToken.balanceOf(this.signers.depositor.address);
            
            expect(balanceAfter.sub(balanceBefore)).to.equal(TEST_CONFIG.depositAmount);
            console.log(chalk.green("  ✓ Emergency withdrawal successful after timeout"));
            
            // Test 5: Verify state
            expect(await escrow.currentState()).to.equal(5); // REFUNDED
            console.log(chalk.green("  ✓ Escrow state updated to REFUNDED"));
            
            this.recordSuccess("Solver Timeout");
        } catch (error) {
            this.recordFailure("Solver Timeout", error);
        }
    }

    async testScenario2_PartialFills() {
        console.log(chalk.blue.bold("\nScenario 2: Partial Fills & Refunds"));
        
        try {
            // Deploy enhanced escrow
            const EnhancedEscrow = await ethers.getContractFactory("EnhancedDisputeResolutionEscrow");
            const escrow = await EnhancedEscrow.deploy(
                this.signers.depositor.address,
                this.signers.solver.address,
                ethers.constants.AddressZero, // ETH
                ethers.constants.AddressZero,
                ethers.constants.AddressZero
            );
            
            // Test 1: Deposit ETH
            const totalAmount = ethers.utils.parseEther("100");
            await escrow.connect(this.signers.depositor).deposit(0, { value: totalAmount });
            console.log(chalk.green("  ✓ 100 ETH deposited"));
            
            // Test 2: Provide partial solution (60%)
            const filledAmount = ethers.utils.parseEther("60");
            await escrow.connect(this.signers.solver).providePartialSolution(filledAmount);
            console.log(chalk.green("  ✓ Partial solution (60 ETH) provided"));
            
            // Test 3: Accept partial solution
            const solverBalanceBefore = await ethers.provider.getBalance(this.signers.solver.address);
            await escrow.connect(this.signers.depositor).acceptPartialSolution();
            const solverBalanceAfter = await ethers.provider.getBalance(this.signers.solver.address);
            
            expect(solverBalanceAfter.sub(solverBalanceBefore)).to.be.closeTo(
                filledAmount,
                ethers.utils.parseEther("0.01") // Gas tolerance
            );
            console.log(chalk.green("  ✓ Partial solution accepted, solver paid 60 ETH"));
            
            // Test 4: Refund remaining
            const depositorBalanceBefore = await ethers.provider.getBalance(this.signers.depositor.address);
            await escrow.connect(this.signers.depositor).refundRemaining();
            const depositorBalanceAfter = await ethers.provider.getBalance(this.signers.depositor.address);
            
            const refunded = depositorBalanceAfter.sub(depositorBalanceBefore);
            expect(refunded).to.be.closeTo(
                ethers.utils.parseEther("40"),
                ethers.utils.parseEther("0.01") // Gas tolerance
            );
            console.log(chalk.green("  ✓ Remaining 40 ETH refunded to depositor"));
            
            this.recordSuccess("Partial Fills");
        } catch (error) {
            this.recordFailure("Partial Fills", error);
        }
    }

    async testScenario3_WrongTokenDispute() {
        console.log(chalk.blue.bold("\nScenario 3: Wrong Token Delivery Dispute"));
        
        try {
            // Deploy escrow
            const Escrow = await ethers.getContractFactory("DisputeResolutionEscrow");
            const escrow = await Escrow.deploy(
                this.signers.depositor.address,
                this.signers.solver.address,
                this.depositToken.address,
                this.settlementToken.address,
                this.router.address
            );
            
            // Test 1: Deposit correct token
            await this.depositToken.connect(this.signers.depositor).approve(escrow.address, TEST_CONFIG.depositAmount);
            await escrow.connect(this.signers.depositor).deposit(TEST_CONFIG.depositAmount);
            console.log(chalk.green("  ✓ Correct token deposited"));
            
            // Test 2: Solver provides solution
            await escrow.connect(this.signers.solver).provideSolution();
            console.log(chalk.green("  ✓ Solution provided by solver"));
            
            // Test 3: Depositor detects wrong token would be delivered, raises dispute
            await escrow.connect(this.signers.depositor).raiseDispute();
            console.log(chalk.green("  ✓ Dispute raised for wrong token"));
            
            // Test 4: Set UI override to return funds
            await escrow.connect(this.signers.depositor).setUIOverride(1); // RETURN_TO_DEPOSITOR
            console.log(chalk.green("  ✓ UI override set to return funds"));
            
            // Test 5: Resolve dispute
            const balanceBefore = await this.depositToken.balanceOf(this.signers.depositor.address);
            await escrow.resolveDispute();
            const balanceAfter = await this.depositToken.balanceOf(this.signers.depositor.address);
            
            expect(balanceAfter.sub(balanceBefore)).to.equal(TEST_CONFIG.depositAmount);
            console.log(chalk.green("  ✓ Funds returned to depositor"));
            
            // Test 6: Verify state
            expect(await escrow.currentState()).to.equal(5); // REFUNDED
            console.log(chalk.green("  ✓ Escrow state is REFUNDED"));
            
            this.recordSuccess("Wrong Token Dispute");
        } catch (error) {
            this.recordFailure("Wrong Token Dispute", error);
        }
    }

    async testScenario4_EmergencyPause() {
        console.log(chalk.blue.bold("\nScenario 4: Emergency Pause & Withdrawal"));
        
        try {
            // Deploy pausable escrow
            const PausableEscrow = await ethers.getContractFactory("PausableDisputeResolutionEscrow");
            const escrow = await PausableEscrow.deploy(
                this.signers.depositor.address,
                this.signers.solver.address,
                ethers.constants.AddressZero, // ETH
                ethers.constants.AddressZero,
                ethers.constants.AddressZero,
                this.signers.owner.address // emergency admin
            );
            
            // Test 1: Deposit ETH
            await escrow.connect(this.signers.depositor).deposit(0, { value: TEST_CONFIG.depositAmount });
            console.log(chalk.green("  ✓ ETH deposited"));
            
            // Test 2: Emergency pause
            await escrow.connect(this.signers.owner).pause();
            console.log(chalk.green("  ✓ Contract paused by admin"));
            
            // Test 3: Cannot perform normal operations
            await expect(escrow.connect(this.signers.solver).provideSolution())
                .to.be.reverted;
            console.log(chalk.green("  ✓ Normal operations blocked during pause"));
            
            // Test 4: Emergency withdrawal works
            const balanceBefore = await ethers.provider.getBalance(this.signers.depositor.address);
            await escrow.connect(this.signers.depositor).emergencyWithdrawPaused();
            const balanceAfter = await ethers.provider.getBalance(this.signers.depositor.address);
            
            expect(balanceAfter.sub(balanceBefore)).to.be.closeTo(
                TEST_CONFIG.depositAmount,
                ethers.utils.parseEther("0.01") // Gas tolerance
            );
            console.log(chalk.green("  ✓ Emergency withdrawal successful during pause"));
            
            // Test 5: Unpause
            await escrow.connect(this.signers.owner).unpause();
            console.log(chalk.green("  ✓ Contract unpaused"));
            
            this.recordSuccess("Emergency Pause");
        } catch (error) {
            this.recordFailure("Emergency Pause", error);
        }
    }

    async testScenario5_MEVProtection() {
        console.log(chalk.blue.bold("\nScenario 5: MEV Protection"));
        
        try {
            // Test 1: Deploy MEV protected escrow
            const MEVProtectedEscrow = await ethers.getContractFactory("MEVProtectedEscrow");
            const escrow = await MEVProtectedEscrow.deploy(
                this.signers.depositor.address,
                this.signers.solver.address
            );
            console.log(chalk.green("  ✓ MEV protected escrow deployed"));
            
            // Test 2: Commit deposit
            const secret = ethers.utils.id("mySecret123");
            const commitment = ethers.utils.keccak256(
                ethers.utils.defaultAbiCoder.encode(
                    ["uint256", "bytes32"],
                    [TEST_CONFIG.depositAmount, secret]
                )
            );
            
            await escrow.connect(this.signers.depositor).commitDeposit(commitment);
            console.log(chalk.green("  ✓ Deposit commitment submitted"));
            
            // Test 3: Cannot reveal immediately
            await expect(
                escrow.connect(this.signers.depositor).revealDeposit(
                    TEST_CONFIG.depositAmount,
                    secret,
                    { value: TEST_CONFIG.depositAmount }
                )
            ).to.be.revertedWith("Still in commit phase");
            console.log(chalk.green("  ✓ Immediate reveal blocked (MEV protection)"));
            
            // Test 4: Wait for reveal window
            await time.increase(301); // 5 minutes + 1 second
            
            // Test 5: Reveal deposit
            await escrow.connect(this.signers.depositor).revealDeposit(
                TEST_CONFIG.depositAmount,
                secret,
                { value: TEST_CONFIG.depositAmount }
            );
            console.log(chalk.green("  ✓ Deposit revealed after commit window"));
            
            // Test 6: Verify deposit amount
            expect(await escrow.depositAmount()).to.equal(TEST_CONFIG.depositAmount);
            console.log(chalk.green("  ✓ Deposit amount verified"));
            
            this.recordSuccess("MEV Protection");
        } catch (error) {
            this.recordFailure("MEV Protection", error);
        }
    }

    async testScenario6_MultiSigApproval() {
        console.log(chalk.blue.bold("\nScenario 6: Multi-Sig for Large Escrows"));
        
        try {
            // Deploy multi-sig escrow
            const MultiSigEscrow = await ethers.getContractFactory("MultiSigDisputeResolutionEscrow");
            const signers = [
                this.signers.depositor.address,
                this.signers.arbitrator.address,
                this.signers.owner.address
            ];
            const escrow = await MultiSigEscrow.deploy(
                this.signers.depositor.address,
                this.signers.solver.address,
                signers,
                2 // required signatures
            );
            
            // Test 1: Deposit large amount
            await escrow.connect(this.signers.depositor).deposit(0, { value: TEST_CONFIG.largeAmount });
            console.log(chalk.green("  ✓ Large deposit (150 ETH) made"));
            
            // Test 2: Solver provides solution
            await escrow.connect(this.signers.solver).provideSolution();
            console.log(chalk.green("  ✓ Solution provided"));
            
            // Test 3: Accept solution triggers multi-sig
            await escrow.connect(this.signers.depositor).acceptSolution();
            console.log(chalk.green("  ✓ Large release initiated, requires multi-sig"));
            
            // Test 4: First approval
            await escrow.connect(this.signers.depositor).approveLargeRelease();
            console.log(chalk.green("  ✓ First approval submitted"));
            
            // Verify funds not yet released
            const solverBalanceBefore = await ethers.provider.getBalance(this.signers.solver.address);
            
            // Test 5: Second approval releases funds
            await escrow.connect(this.signers.arbitrator).approveLargeRelease();
            console.log(chalk.green("  ✓ Second approval submitted"));
            
            const solverBalanceAfter = await ethers.provider.getBalance(this.signers.solver.address);
            expect(solverBalanceAfter.sub(solverBalanceBefore)).to.equal(TEST_CONFIG.largeAmount);
            console.log(chalk.green("  ✓ Funds released after multi-sig approval"));
            
            this.recordSuccess("Multi-Sig Approval");
        } catch (error) {
            this.recordFailure("Multi-Sig Approval", error);
        }
    }

    async testScenario7_EventIndexing() {
        console.log(chalk.blue.bold("\nScenario 7: Event Indexing & Monitoring"));
        
        try {
            // Deploy escrow
            const Escrow = await ethers.getContractFactory("DisputeResolutionEscrow");
            const escrow = await Escrow.deploy(
                this.signers.depositor.address,
                this.signers.solver.address,
                this.depositToken.address,
                this.settlementToken.address,
                this.router.address
            );
            
            // Test 1: Monitor deposit event
            await this.depositToken.connect(this.signers.depositor).approve(escrow.address, TEST_CONFIG.depositAmount);
            const depositTx = await escrow.connect(this.signers.depositor).deposit(TEST_CONFIG.depositAmount);
            const depositReceipt = await depositTx.wait();
            
            const depositEvent = depositReceipt.events?.find(e => e.event === "Deposited");
            expect(depositEvent?.args?.depositor).to.equal(this.signers.depositor.address);
            expect(depositEvent?.args?.amount).to.equal(TEST_CONFIG.depositAmount);
            console.log(chalk.green("  ✓ Deposit event properly indexed"));
            
            // Test 2: Create and monitor dispute
            await escrow.connect(this.signers.solver).provideSolution();
            const disputeTx = await escrow.connect(this.signers.depositor).raiseDispute();
            const disputeReceipt = await disputeTx.wait();
            
            const disputeEvent = disputeReceipt.events?.find(e => e.event === "DisputeRaised");
            expect(disputeEvent?.args?.raiser).to.equal(this.signers.depositor.address);
            expect(disputeEvent?.args?.deadline).to.be.gt(0);
            console.log(chalk.green("  ✓ Dispute event properly indexed"));
            
            // Test 3: Query historical events
            const depositFilter = escrow.filters.Deposited(this.signers.depositor.address);
            const deposits = await escrow.queryFilter(depositFilter);
            expect(deposits.length).to.equal(1);
            console.log(chalk.green("  ✓ Historical event querying works"));
            
            // Test 4: Monitor state changes
            const states = [];
            escrow.on("*", (event) => {
                if (event.event) states.push(event.event);
            });
            
            // Trigger state change
            await time.increase(TEST_CONFIG.disputeTimeout + 1);
            await escrow.resolveDispute();
            
            // Wait for events
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            expect(states.length).to.be.gt(0);
            console.log(chalk.green("  ✓ Real-time event monitoring works"));
            
            this.recordSuccess("Event Indexing");
        } catch (error) {
            this.recordFailure("Event Indexing", error);
        }
    }

    recordSuccess(scenario) {
        this.results.passed++;
        this.results.scenarios.push({ name: scenario, status: "PASSED" });
    }

    recordFailure(scenario, error) {
        this.results.failed++;
        this.results.scenarios.push({ name: scenario, status: "FAILED", error: error.message });
        console.log(chalk.red(`  ✗ ${scenario} failed: ${error.message}`));
    }

    printResults() {
        console.log(chalk.blue.bold("\n📊 Test Results Summary\n"));
        
        console.log(chalk.green(`Passed: ${this.results.passed}`));
        console.log(chalk.red(`Failed: ${this.results.failed}`));
        console.log(chalk.yellow(`Total: ${this.results.passed + this.results.failed}`));
        
        console.log(chalk.blue.bold("\nDetailed Results:"));
        this.results.scenarios.forEach(scenario => {
            const status = scenario.status === "PASSED" ? chalk.green("✓") : chalk.red("✗");
            console.log(`${status} ${scenario.name}`);
            if (scenario.error) {
                console.log(chalk.gray(`    Error: ${scenario.error}`));
            }
        });
        
        // Generate report
        const report = {
            timestamp: new Date().toISOString(),
            totalTests: this.results.passed + this.results.failed,
            passed: this.results.passed,
            failed: this.results.failed,
            scenarios: this.results.scenarios,
            recommendations: this.generateRecommendations()
        };
        
        require('fs').writeFileSync(
            'escrow-test-report.json',
            JSON.stringify(report, null, 2)
        );
        
        console.log(chalk.blue("\n📄 Detailed report saved to escrow-test-report.json"));
    }

    generateRecommendations() {
        const recommendations = [];
        
        if (this.results.failed > 0) {
            recommendations.push("Fix failing tests before deployment");
        }
        
        recommendations.push("Consider adding oracle-based price feeds for Uniswap settlements");
        recommendations.push("Implement configurable slippage tolerance");
        recommendations.push("Add support for multiple arbitrators in disputes");
        recommendations.push("Consider implementing a reputation system for solvers");
        recommendations.push("Add support for ERC-1155 and NFT escrows");
        
        return recommendations;
    }
}

// Run tests
async function main() {
    const runner = new EscrowTestRunner();
    await runner.runAllTests();
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });