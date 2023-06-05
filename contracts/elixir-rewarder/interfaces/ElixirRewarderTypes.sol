// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

interface ElixirRewarderTypes {
    event RewardClaimed(uint256 indexed tokenId, address indexed pool, address indexed userAddress, address recipient, uint256 rewardOwed);
    event DefaultRewardManagerSet(address indexed newDefaultRewardManager);
    event FarmManagerSet(address indexed pool, address indexed newFarmManager);
    event FarmActivated(address indexed pool, address indexed newRewardToken);
    event FarmDeactivated(address indexed pool);
    event CancelledDeactivation(address indexed pool);

    error IncreaseGasLimit();
    error NoOp();
    error WaitForDistributionToEnd();
    error FarmAlreadyActive();
    error TooEarlyToActivateFarm();
    error FarmIsInactive();
    error CheckYourPrivilege();
    error Overflow();
    error InvalidDayRange();

    struct Farm {
        address manager;

        address rewardToken;
        uint56 rewardTokenChangeCounter;
        uint32 deactivationTime;
        bool inactive;

        uint112 rewardDistributed;
        uint112 rewardAdded;
        uint32 distributionEndTime; // this is also recorded in pool contract as rewardRateEffectiveUntil

        mapping(address => User) users;
    }

    struct User {
        uint80 rewardTokenChangeCounter;
    }
}
