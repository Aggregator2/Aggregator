const { expect } = require('chai');

describe('Escrow Contract', () => {
    let escrow;
    let depositor;
    let nonDepositor;
    let token;

    beforeEach(async () => {
        // Setup code to deploy the contract and initialize variables
    });

    it('should succeed if depositor has approved tokens and calls deposit()', async () => {
        // Code to simulate token approval and call deposit()
        expect(await escrow.deposit(amount)).to.not.be.reverted;
    });

    it('should revert if non-depositor tries to call deposit()', async () => {
        await expect(escrow.connect(nonDepositor).deposit(amount)).to.be.revertedWith('Not the depositor');
    });

    it('should revert if deposit amount is zero', async () => {
        await expect(escrow.deposit(0)).to.be.revertedWith('Deposit amount must be greater than zero');
    });

    it('should revert if no token approval is given', async () => {
        await expect(escrow.deposit(amount)).to.be.revertedWith('Token not approved');
    });
});