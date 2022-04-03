// SPDX-License-Identifier: GPLv3
// solhint-disable not-rely-on-time
pragma solidity ^0.8.0;

import "./SunshineAndRainbowsCompound.sol";

/**
 * @title Sunshine and Rainbows Extension: Single Stake Compound
 * @notice An extension to `SunshineAndRainbows` that implements locked-stake
 * harvesting feature when the reward and staking tokens are the same
 * @author shung for Pangolin
 */
contract SunshineAndRainbowsCompoundSingle is SunshineAndRainbowsCompound {

    /**
     * @notice Constructs a new SunshineAndRainbows staking contract with
     * locked-stake harvesting feature
     * @param newStakingToken Contract address of the staking token
     * @param newRewardRegulator Contract address of the reward regulator which
     * distributes reward tokens
     */
    constructor(address newStakingToken, address newRewardRegulator)
        SunshineAndRainbowsCompound(newStakingToken, newRewardRegulator)
    {
        require(
            newStakingToken ==
                address(IRewardRegulator(newRewardRegulator).rewardToken()),
            "SAR::Constructor: staking token is different than reward token"
        );
    }

    /**
     * @notice Creates a new position with the rewards of the given position
     * @dev New position is considered locked, and it cannot be withdrawn until
     * the parent position is updated after the creation of the new position
     * @param posId ID of the parent position whose rewards are harvested
     */
    function compound(uint posId) external nonReentrant {
        // update the state variables that govern the reward distribution
        _updateRewardVariables();

        // create a new position
        uint childPosId = positions.length;

        // record parent-child relation to lock the child position
        children[childPosId] = Child(posId, block.timestamp);

        // harvest parent position
        uint amount = _harvestWithDebt(posId);

        // stake parent position rewards to child position
        _open(amount, address(this));

        emit Compounded(posId, childPosId, amount);
    }
}

