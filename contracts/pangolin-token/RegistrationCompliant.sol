// SPDX-License-Identifier: MIT
pragma solidity 0.8.15;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract RegistrationCompliant is Ownable, Pausable {
    using ECDSA for bytes;
    using ECDSA for bytes32;

    mapping(address => bool) public registrations;

    string public constant COMPLIANCE_MESSAGE = "By signing this transaction, I hereby acknowledge that I am not a US resident or citizen. (Citizens or residents of the United States of America are not allowed to the token airdrop due to applicable law.)";
    bytes32 public immutable COMPLIANCE_HASH;

    event Registered(address indexed from, address indexed to);

    constructor(address firstOwner) {
        COMPLIANCE_HASH = bytes(COMPLIANCE_MESSAGE).toEthSignedMessageHash();
        transferOwnership(firstOwner);
    }

    function register(
        address destinationAddress,
        bytes calldata signature
    ) external whenNotPaused {
        require(destinationAddress != address(0), "Invalid destination");
        require(!registrations[msg.sender], "Already registered");
        require(COMPLIANCE_HASH.recover(signature) == msg.sender, "Invalid signature");
        registrations[msg.sender] = true;
        emit Registered(msg.sender, destinationAddress);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
