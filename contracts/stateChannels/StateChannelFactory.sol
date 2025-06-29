// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./StateChannel.sol";
import "../security/SignatureVerifier.sol";

contract StateChannelFactory is SignatureVerifier {
    struct ChannelParams {
        address[] participants;
        address token;
        uint256 challengePeriod;
        uint256 nonce;
    }

    mapping(bytes32 => address) public channels;
    mapping(address => bytes32[]) public participantChannels;
    
    uint256 private constant MAX_PARTICIPANTS = 10;
    uint256 private constant MIN_CHALLENGE_PERIOD = 1 hours;
    uint256 private constant MAX_CHALLENGE_PERIOD = 7 days;

    event ChannelCreated(
        bytes32 indexed channelId,
        address indexed channelAddress,
        address[] participants,
        address token,
        uint256 challengePeriod
    );

    error InvalidParticipantCount();
    error InvalidChallengePeriod();
    error ChannelAlreadyExists();
    error DuplicateParticipant();
    error InvalidSignature();
    error SignatureMismatch();

    function createChannel(
        ChannelParams calldata params,
        bytes[] calldata signatures
    ) external returns (address channelAddress) {
        _validateChannelParams(params);
        
        bytes32 channelId = getChannelId(params);
        if (channels[channelId] != address(0)) {
            revert ChannelAlreadyExists();
        }

        _verifyAllSignatures(params, signatures);

        StateChannel channel = new StateChannel(
            params.participants,
            params.token,
            params.challengePeriod,
            address(this)
        );

        channelAddress = address(channel);
        channels[channelId] = channelAddress;

        for (uint256 i = 0; i < params.participants.length; i++) {
            participantChannels[params.participants[i]].push(channelId);
        }

        emit ChannelCreated(
            channelId,
            channelAddress,
            params.participants,
            params.token,
            params.challengePeriod
        );
    }

    function getChannelId(ChannelParams calldata params) public pure returns (bytes32) {
        return keccak256(abi.encode(
            params.participants,
            params.token,
            params.challengePeriod,
            params.nonce
        ));
    }

    function getParticipantChannelCount(address participant) external view returns (uint256) {
        return participantChannels[participant].length;
    }

    function getParticipantChannelAt(address participant, uint256 index) external view returns (bytes32) {
        return participantChannels[participant][index];
    }

    function _validateChannelParams(ChannelParams calldata params) private pure {
        if (params.participants.length < 2 || params.participants.length > MAX_PARTICIPANTS) {
            revert InvalidParticipantCount();
        }

        if (params.challengePeriod < MIN_CHALLENGE_PERIOD || 
            params.challengePeriod > MAX_CHALLENGE_PERIOD) {
            revert InvalidChallengePeriod();
        }

        for (uint256 i = 0; i < params.participants.length; i++) {
            for (uint256 j = i + 1; j < params.participants.length; j++) {
                if (params.participants[i] == params.participants[j]) {
                    revert DuplicateParticipant();
                }
            }
        }
    }

    function _verifyAllSignatures(
        ChannelParams calldata params,
        bytes[] calldata signatures
    ) private view {
        if (signatures.length != params.participants.length) {
            revert SignatureMismatch();
        }

        bytes32 messageHash = keccak256(abi.encode(
            "StateChannel",
            params.participants,
            params.token,
            params.challengePeriod,
            params.nonce,
            block.chainid,
            address(this)
        ));

        bytes32 ethSignedMessageHash = getEthSignedMessageHash(messageHash);

        for (uint256 i = 0; i < params.participants.length; i++) {
            address recoveredSigner = recoverSigner(ethSignedMessageHash, signatures[i]);
            if (recoveredSigner != params.participants[i]) {
                revert InvalidSignature();
            }
        }
    }
}