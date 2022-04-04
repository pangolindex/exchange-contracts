/*
 * SPDX-License-Identifier: GPLv3
 * solhint-disable not-rely-on-time
 *
 * Sunshine and Rainbows: Single Token Compound
 * Copyright (C) 2022 - shung <twitter:shunduquar>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */
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

