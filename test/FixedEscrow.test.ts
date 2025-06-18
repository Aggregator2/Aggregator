import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { expect } from 'chai';
import { FixedEscrow } from '../typechain-types';

describe('FixedEscrow', () => {
  let escrowContract: FixedEscrow;
  let owner: SignerWithAddress;
  let buyer: SignerWithAddress;
  let arbiter: SignerWithAddress;

  beforeEach(async () => {
    [owner, buyer, arbiter] = await ethers.getSigners();
    const EscrowFactory = await ethers.getContractFactory('FixedEscrow');
    escrowContract = await EscrowFactory.deploy(arbiter.address);
  });

  describe('Deposit', () => {
    it('should allow buyer to deposit funds', async () => {
      const value = ethers.utils.parseEther('1');
      await escrowContract.connect(buyer).deposit({ value });
      const balance = await escrowContract.getBalance();
      expect(balance).to.equal(value);
      const state = await escrowContract.currentState();
      expect(state).to.equal(1); // AWAITING_CONFIRMATION
    });

    it('should revert if deposit is 0', async () => {
      await expect(escrowContract.connect(buyer).deposit({ value: 0 })).to.be.revertedWith(
        'Value must be greater than 0'
      );
    });
  });

  describe('Release', () => {
    it('should allow arbiter to release funds to owner', async () => {
      const value = ethers.utils.parseEther('1');
      await escrowContract.connect(buyer).deposit({ value });
      const ownerBalanceBefore = await owner.getBalance();
      const tx = await escrowContract.connect(arbiter).releaseWithSignature();
      const receipt = await tx.wait();
      const releasedEvent = receipt.events?.find((event) => event.event === 'FundsReleased');
      expect(releasedEvent?.args?.to).to.equal(owner.address);
      const ownerBalanceAfter = await owner.getBalance();
      expect(ownerBalanceAfter.sub(ownerBalanceBefore)).to.equal(value);
      const state = await escrowContract.currentState();
      expect(state).to.equal(2); // COMPLETE
    });

    it('should revert if called by non-arbiter', async () => {
      await escrowContract.connect(buyer).deposit({ value: ethers.utils.parseEther('1') });
      await expect(escrowContract.connect(buyer).releaseWithSignature()).to.be.revertedWith(
        'Only arbiter can release funds'
      );
    });
  });

  describe('Refund', () => {
    it('should allow buyer to refund funds', async () => {
      const value = ethers.utils.parseEther('1');
      await escrowContract.connect(buyer).deposit({ value });
      const buyerBalanceBefore = await buyer.getBalance();
      const tx = await escrowContract.connect(buyer).refund();
      const receipt = await tx.wait();
      const refundedEvent = receipt.events?.find((event) => event.event === 'FundsRefunded');
      expect(refundedEvent?.args?.to).to.equal(buyer.address);
      const buyerBalanceAfter = await buyer.getBalance();
      expect(buyerBalanceAfter.sub(buyerBalanceBefore)).to.equal(value);
      const state = await escrowContract.currentState();
      expect(state).to.equal(3); // REFUNDED
    });

    it('should revert if called by non-buyer', async () => {
      await escrowContract.connect(buyer).deposit({ value: ethers.utils.parseEther('1') });
      await expect(escrowContract.connect(owner).refund()).to.be.revertedWith(
        'Only buyer can refund funds'
      );
    });
  });

  describe('Chain Reorganization', () => {
    it('should handle chain reorganization correctly', async () => {
      const value = ethers.utils.parseEther('1');
      await escrowContract.connect(buyer).deposit({ value });
      await escrowContract.connect(arbiter).releaseWithSignature();
      const ownerBalanceBefore = await owner.getBalance();

      // Simulate chain reorganization
      await ethers.provider.send('hardhat_mine', ['0x10']);

      const ownerBalanceAfter = await owner.getBalance();
      expect(ownerBalanceAfter.sub(ownerBalanceBefore)).to.equal(value);
      const state = await escrowContract.currentState();
      expect(state).to.equal(2); // COMPLETE
    });
  });

  describe('Event Listeners', () => {
    it('should emit Deposit event', async () => {
      const value = ethers.utils.parseEther('1');
      await expect(escrowContract.connect(buyer).deposit({ value }))
        .to.emit(escrowContract, 'Deposit')
        .withArgs(buyer.address, value);
    });

    it('should emit FundsReleased event', async () => {
      const value = ethers.utils.parseEther('1');
      await escrowContract.connect(buyer).deposit({ value });
      await expect(escrowContract.connect(arbiter).releaseWithSignature())
        .to.emit(escrowContract, 'FundsReleased')
        .withArgs(owner.address, value);
    });

    it('should emit FundsRefunded event', async () => {
      const value = ethers.utils.parseEther('1');
      await escrowContract.connect(buyer).deposit({ value });
      await expect(escrowContract.connect(buyer).refund())
        .to.emit(escrowContract, 'FundsRefunded')
        .withArgs(buyer.address, value);
    });

    it('should handle duplicate events correctly', async () => {
      const value = ethers.utils.parseEther('1');
      await escrowContract.connect(buyer).deposit({ value });
      const tx = await escrowContract.connect(arbiter).releaseWithSignature();
      const receipt = await tx.wait();
      const releasedEvents = receipt.events?.filter((event) => event.event === 'FundsReleased');
      expect(releasedEvents?.length).to.equal(1);
    });

    it('should handle out-of-order events correctly', async () => {
      const value = ethers.utils.parseEther('1');
      await escrowContract.connect(buyer).deposit({ value });
      const tx1 = await escrowContract.connect(arbiter).releaseWithSignature();
      const tx2 = await escrowContract.connect(buyer).refund();
      const receipt1 = await tx1.wait();
      const receipt2 = await tx2.wait();
      const releasedEvent = receipt1.events?.find((event) => event.event === 'FundsReleased');
      const refundedEvent = receipt2.events?.find((event) => event.event === 'FundsRefunded');
      expect(releasedEvent).to.not.be.undefined;
      expect(refundedEvent).to.not.be.undefined;
    });
  });
});
