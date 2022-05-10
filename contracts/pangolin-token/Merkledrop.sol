// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "../Claimable.sol";

contract Merkledrop is Claimable, Pausable {
    mapping(address => uint256) public claimedAmounts;
    IERC20 public immutable PNG;
    bytes32 public merkleRoot;

    event Claimed(address account, uint256 amount);
    event MerkleRootSet(bytes32 newMerkleRoot);

    constructor(address airdropToken, address initialOwner) Claimable(initialOwner) {
        require(airdropToken != address(0), "invalid token address");
        PNG = IERC20(airdropToken);
        _pause();
    }

    function claim(uint256 amount, bytes32[] calldata merkleProof) external whenNotPaused {
        require(amount != 0 && amount <= type(uint96).max, "invalid amount");
        uint256 previouslyClaimed = claimedAmounts[msg.sender];
        require(previouslyClaimed < amount, "nothing to claim");
        bytes32 node = bytes32(abi.encodePacked(msg.sender, uint96(amount)));
        require(MerkleProof.verify(merkleProof, merkleRoot, node), "invalid proof");
        claimedAmounts[msg.sender] = amount;
        unchecked {
            amount -= previouslyClaimed;
        }
        require(PNG.transfer(msg.sender, amount), "transfer failed");
        emit Claimed(msg.sender, amount);
    }

    function setMerkleRoot(bytes32 newMerkleRoot) external whenPaused onlyOwner {
        merkleRoot = newMerkleRoot;
        emit MerkleRootSet(newMerkleRoot);
    }

    function recover(IERC20 token, uint256 amount) external whenPaused onlyOwner {
        require(token.transfer(msg.sender, amount), "transfer failed");
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        require(merkleRoot != 0x00, "merkle root not set");
        _unpause();
    }
}
