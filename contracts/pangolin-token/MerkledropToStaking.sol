// SPDX-License-Identifier: MIT
pragma solidity 0.8.15;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface IPangolinStakingPositions is IERC721 {
    function mint(uint256 amount) external returns (uint256 positionId);
}

contract Merkledrop is Ownable, Pausable {
    mapping(address => uint96) public claimedAmounts;
    IERC20 public immutable PNG;
    IPangolinStakingPositions public immutable SAR;
    bytes32 public merkleRoot;

    event Claimed(address account, uint96 amount);
    event MerkleRootSet(bytes32 newMerkleRoot);

    constructor(address airdropToken, address stakingPositions, address initialOwner) {
        require(airdropToken.code.length != 0, "invalid token address");
        require(stakingPositions.code.length != 0, "invalid staking address");
        require(initialOwner != address(0), "invalid initial owner");
        _transferOwnership(initialOwner);
        IERC20(airdropToken).approve(stakingPositions, type(uint256).max);
        PNG = IERC20(airdropToken);
        SAR = IPangolinStakingPositions(stakingPositions);
        _pause();
    }

    function claim(uint96 amount, bytes32[] calldata merkleProof) external whenNotPaused {
        uint96 previouslyClaimed = claimedAmounts[msg.sender];
        require(previouslyClaimed < amount, "nothing to claim");
        bytes32 node = bytes32(abi.encodePacked(msg.sender, amount));
        require(MerkleProof.verify(merkleProof, merkleRoot, node), "invalid proof");
        claimedAmounts[msg.sender] = amount;
        unchecked {
            amount -= previouslyClaimed;
        }
        uint256 positionId = SAR.mint(amount);
        SAR.safeTransferFrom(address(this), msg.sender, positionId);
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
