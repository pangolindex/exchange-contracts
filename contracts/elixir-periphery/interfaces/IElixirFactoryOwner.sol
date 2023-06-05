// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

interface IElixirFactoryOwner {

    function setRewardRate(address pool, uint144 rewardPerSecondX48, uint32 rewardRateEffectiveUntil) external;


    // TODO: add do anything function
}
