// SPDX-License-Identifier: GPLv3
pragma solidity >=0.6.0;

interface IRewarder {
    function onReward(
        uint256 pid,
        address user,
        bool destructiveAction,
        uint256 rewardAmount,
        uint256 newLpAmount
    ) external;
}
