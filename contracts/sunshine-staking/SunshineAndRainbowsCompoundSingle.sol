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
pragma solidity 0.8.13;

import "./SunshineAndRainbows.sol";

/**
 * @title Sunshine and Rainbows Extension: Single Stake Compound
 * @notice An extension to `SunshineAndRainbows` that implements locked-stake
 * harvesting feature when the reward and staking tokens are the same
 * @author shung for Pangolin
 */
contract SunshineAndRainbowsCompoundSingle is SunshineAndRainbows {
    using SafeCast for int;

    /**
     * @notice Constructs a new SunshineAndRainbows staking contract with
     * locked-stake harvesting feature
     * @param newStakingToken Contract address of the staking token
     * @param newRewardRegulator Contract address of the reward regulator which
     * distributes reward tokens
     */
    constructor(address newStakingToken, address newRewardRegulator)
        SunshineAndRainbows(newStakingToken, newRewardRegulator)
    {
        require(
            newStakingToken ==
                address(IRewardRegulator(newRewardRegulator).rewardToken()),
            "SAR::Constructor: invalid staking token"
        );
    }

    /// @notice Stakes the rewards of the user without resetting APR
    function compound() external {
        _updateRewardVariables();

        // Harvest pending rewards, and record it as debt (negative value). We
        // record it as debt because we're not updating user variabless that
        // govern the reward rate for the user.
        int amount = _earned();
        users[msg.sender].stash -= amount;
        emit Harvested(msg.sender, amount.toUint256());

        // stake the rewards using the balance of this contract
        _stake(amount.toUint256(), address(this));
    }
}
