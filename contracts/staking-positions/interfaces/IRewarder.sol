// SPDX-License-Identifier: GPLv3
pragma solidity ^0.8.0;

interface IRewarder {
    function onReward(
        uint256 pid,
        address user,
        uint256 rewardAmount,
        uint256 newLpAmount,
        uint256 lastTimeEmergencyExited
    ) external;
}
