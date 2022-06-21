// SPDX-License-Identifier: GPLv3
pragma solidity 0.8.15;

library TokenMetadata {

    function generateTokenURI(
        uint256 totalStaked,
        uint256 sumOfEntryTimes,
        uint256 rewardRate,
        uint256 positionBalance,
        uint256 positionEntryTimes,
        uint256 positionRewardRate,
        uint256 positionPendingRewards,
        address positionOwner
    ) internal pure returns (string memory) {
        return "Placeholder";
    }
}
