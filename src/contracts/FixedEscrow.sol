// FixedEscrow Smart Contract
pragma solidity ^0.8.0;

contract FixedEscrow {
  enum State { AWAITING_DEPOSIT, AWAITING_CONFIRMATION, COMPLETE, REFUNDED }
  State public currentState;

  function deposit() public payable {
    require(currentState == State.AWAITING_DEPOSIT, 'Already deposited');
    currentState = State.AWAITING_CONFIRMATION;
  }

  function releaseWithSignature(bytes memory signature) public {
    require(currentState == State.AWAITING_CONFIRMATION, 'Not awaiting confirmation');
    // Verify signature logic goes here
    currentState = State.COMPLETE;
  }

  function getBalance() public view returns (uint) {
    return address(this).balance;
  }
}