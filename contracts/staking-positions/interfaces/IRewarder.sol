// SPDX-License-Identifier: GPLv3
pragma solidity ^0.8.0;

interface IRewarder {
    function onReward(
        uint256 pid,
        address user,
        address recipient,
        uint256 rewardAmount,
        uint256 newLpAmount
    ) external;
}
