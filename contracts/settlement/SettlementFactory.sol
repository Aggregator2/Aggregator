// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./AdvancedSettlementContract.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title SettlementFactory
 * @notice Factory contract for deploying AdvancedSettlementContract instances using CREATE2
 * @dev Enables deterministic addresses across different chains
 */
contract SettlementFactory is Ownable {
    // Events
    event SettlementDeployed(
        address indexed settlement,
        bytes32 indexed salt,
        string name,
        string version,
        address protocolFeeRecipient,
        address deployer
    );

    event ImplementationUpdated(
        address indexed oldImplementation,
        address indexed newImplementation
    );

    // State variables
    mapping(bytes32 => address) public deployments;
    mapping(address => bool) public isValidSettlement;
    address[] public allSettlements;
    
    // Deployment parameters cache
    struct DeploymentParams {
        string name;
        string version;
        address protocolFeeRecipient;
        address deployer;
        uint256 timestamp;
    }
    
    mapping(address => DeploymentParams) public deploymentInfo;

    /**
     * @notice Deploy a new AdvancedSettlementContract using CREATE2
     * @param salt Unique salt for deterministic address
     * @param name EIP-712 domain name
     * @param version EIP-712 domain version
     * @param protocolFeeRecipient Address to receive protocol fees
     * @return settlement The deployed settlement contract address
     */
    function deploySettlement(
        bytes32 salt,
        string memory name,
        string memory version,
        address protocolFeeRecipient
    ) external returns (address settlement) {
        require(protocolFeeRecipient != address(0), "Invalid fee recipient");
        require(deployments[salt] == address(0), "Salt already used");
        
        // Calculate deployment address
        bytes memory bytecode = abi.encodePacked(
            type(AdvancedSettlementContract).creationCode,
            abi.encode(name, version, protocolFeeRecipient)
        );
        
        bytes32 hash = keccak256(
            abi.encodePacked(
                bytes1(0xff),
                address(this),
                salt,
                keccak256(bytecode)
            )
        );
        
        settlement = address(uint160(uint256(hash)));
        
        // Deploy using CREATE2
        assembly {
            settlement := create2(0, add(bytecode, 0x20), mload(bytecode), salt)
            if iszero(extcodesize(settlement)) {
                revert(0, 0)
            }
        }
        
        // Update state
        deployments[salt] = settlement;
        isValidSettlement[settlement] = true;
        allSettlements.push(settlement);
        
        // Store deployment info
        deploymentInfo[settlement] = DeploymentParams({
            name: name,
            version: version,
            protocolFeeRecipient: protocolFeeRecipient,
            deployer: msg.sender,
            timestamp: block.timestamp
        });
        
        // Transfer ownership to deployer
        AdvancedSettlementContract(settlement).transferOwnership(msg.sender);
        
        emit SettlementDeployed(
            settlement,
            salt,
            name,
            version,
            protocolFeeRecipient,
            msg.sender
        );
    }

    /**
     * @notice Calculate the deterministic address for a deployment
     * @param salt The salt to use
     * @param name EIP-712 domain name
     * @param version EIP-712 domain version
     * @param protocolFeeRecipient Protocol fee recipient
     * @return The address where the contract would be deployed
     */
    function calculateAddress(
        bytes32 salt,
        string memory name,
        string memory version,
        address protocolFeeRecipient
    ) external view returns (address) {
        bytes memory bytecode = abi.encodePacked(
            type(AdvancedSettlementContract).creationCode,
            abi.encode(name, version, protocolFeeRecipient)
        );
        
        bytes32 hash = keccak256(
            abi.encodePacked(
                bytes1(0xff),
                address(this),
                salt,
                keccak256(bytecode)
            )
        );
        
        return address(uint160(uint256(hash)));
    }

    /**
     * @notice Get the bytecode hash for verification
     * @param name EIP-712 domain name
     * @param version EIP-712 domain version
     * @param protocolFeeRecipient Protocol fee recipient
     * @return The bytecode hash
     */
    function getBytecodeHash(
        string memory name,
        string memory version,
        address protocolFeeRecipient
    ) external pure returns (bytes32) {
        bytes memory bytecode = abi.encodePacked(
            type(AdvancedSettlementContract).creationCode,
            abi.encode(name, version, protocolFeeRecipient)
        );
        
        return keccak256(bytecode);
    }

    /**
     * @notice Check if an address is a valid settlement deployed by this factory
     * @param settlement Address to check
     * @return Whether the address is a valid settlement
     */
    function isSettlement(address settlement) external view returns (bool) {
        return isValidSettlement[settlement];
    }

    /**
     * @notice Get total number of deployments
     * @return The total number of settlements deployed
     */
    function getDeploymentCount() external view returns (uint256) {
        return allSettlements.length;
    }

    /**
     * @notice Get all deployed settlements
     * @return Array of all settlement addresses
     */
    function getAllSettlements() external view returns (address[] memory) {
        return allSettlements;
    }

    /**
     * @notice Get settlements deployed by a specific address
     * @param deployer The deployer address
     * @return settlements Array of settlement addresses deployed by the deployer
     */
    function getSettlementsByDeployer(
        address deployer
    ) external view returns (address[] memory settlements) {
        uint256 count = 0;
        
        // First, count settlements by deployer
        for (uint256 i = 0; i < allSettlements.length; i++) {
            if (deploymentInfo[allSettlements[i]].deployer == deployer) {
                count++;
            }
        }
        
        // Create array and populate
        settlements = new address[](count);
        uint256 index = 0;
        
        for (uint256 i = 0; i < allSettlements.length; i++) {
            if (deploymentInfo[allSettlements[i]].deployer == deployer) {
                settlements[index] = allSettlements[i];
                index++;
            }
        }
    }

    /**
     * @notice Get deployment info for a settlement
     * @param settlement The settlement address
     * @return info The deployment parameters
     */
    function getDeploymentInfo(
        address settlement
    ) external view returns (DeploymentParams memory info) {
        require(isValidSettlement[settlement], "Not a valid settlement");
        return deploymentInfo[settlement];
    }

    /**
     * @notice Batch deploy multiple settlements
     * @param configs Array of deployment configurations
     * @return settlements Array of deployed settlement addresses
     */
    function batchDeploySettlements(
        DeployConfig[] calldata configs
    ) external returns (address[] memory settlements) {
        settlements = new address[](configs.length);
        
        for (uint256 i = 0; i < configs.length; i++) {
            settlements[i] = this.deploySettlement(
                configs[i].salt,
                configs[i].name,
                configs[i].version,
                configs[i].protocolFeeRecipient
            );
        }
    }

    struct DeployConfig {
        bytes32 salt;
        string name;
        string version;
        address protocolFeeRecipient;
    }
}