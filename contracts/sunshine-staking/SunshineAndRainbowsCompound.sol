/*
 * SPDX-License-Identifier: GPLv3
 * solhint-disable not-rely-on-time
 *
 * Sunshine and Rainbows: Abstract for Compound
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

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "./SunshineAndRainbows.sol";

/**
 * @title Sunshine and Rainbows Compounding Extensions Framework
 * @notice An extension framework for `SunshineAndRainbows` that implements
 * locked-stake harvesting feature. This allows harvesting rewards without
 * having to reset APR.
 * @author shung for Pangolin
 */
abstract contract SunshineAndRainbowsCompound is SunshineAndRainbows {
    using SafeMath for uint;

    struct Child {
        uint parent; // ID of the parent position
        uint initTime; // timestamp of the creation of the child position
    }

    /// @notice A mapping of child positions' IDs to their properties
    mapping(uint => Child) public children;

    /// @notice A mapping of position to its reward debt
    mapping(uint => uint) private _debts;

    /// @notice Emitted when rewards from a position creates another position
    event Compounded(uint parentPosId, uint childPosId, uint amount);

    /**
     * @dev Disables withdrawing from a position if it has an active parent
     * position which was not updated after creation of the child position
     */
    modifier ifNotLocked(uint posId) {
        Child memory child = children[posId];
        if (child.initTime != 0) {
            Position memory parent = positions[child.parent];
            require(
                parent.balance == 0 || child.initTime <= parent.lastUpdate,
                "SAR::_withdraw: parent position not updated"
            );
        }
        _;
    }

    /// @dev Subtracts debts from the over-ridden `pendingRewards` function
    function pendingRewards(uint[] memory posIds)
        public
        view
        override
        returns (uint[] memory)
    {
        uint[] memory rewards = new uint[](posIds.length);
        rewards = super.pendingRewards(posIds);
        for (uint i; i < posIds.length; ++i) {
            // we have to use trySub, because to save gas
            // we had not deleted debt after position closure
            (, rewards[i]) = rewards[i].trySub(_debts[posIds[i]]);
        }
        return rewards;
    }

    /**
     * @dev Prepends to the over-ridden `_close` function a special rule
     * that disables withdrawal until the parent position is closed or updated
     */
    function _close(uint posId) internal override ifNotLocked(posId) {
        super._close(posId);
        // no need to waste gas with debt=0, as closed positions are unusable
    }

    /**
     * @dev Reset debts after harvesting rewards. In the harvest function, the
     * rewards are calculated based on the modified `_earned()` function below,
     * hence debts are paid.
     */
    function _harvest(uint posId) internal override {
        super._harvest(posId);
        _debts[posId] = 0;
    }

    /// @dev Adjust debts before and after balance change & reward harvest
    function _withdraw(uint posId, uint amount)
        internal
        override
        ifNotLocked(posId)
    {
        uint balance = positions[posId].balance;

        /*
         * update debt before & after withdrawal:
         * The debt calculated in `harvestWithDebt()` considers the whole
         * balance. In `_withdraw()`, we're only harvesting rewards for a
         * portion of the position's balance. So we do this little hack to make
         * `_earned()` subtract only the debt of the harvested portion.
         */
        uint remainingDebt = (_debts[posId] * (balance - amount)) / balance;
        _debts[posId] -= remainingDebt;
        super._withdraw(posId, amount);
        _debts[posId] = remainingDebt;
        /*
         * There is a risk of a reentrancy attack here, resulting from the
         * debts being updated after the transfer of the staking token. It
         * requires staking token is also the owner of the position. Since it
         * is an unlikely situation, and the risk only effects the rewards of
         * the stakers of the malicious staking token, it does not warrant
         * wrapping all external functions with reentrancy guards.
         *
         * (When doing the reentrancy analyses in SAR, we always assume reward
         * token and RewardRegulator are not malicious)
         */
    }

    /**
     * @notice Harvests without update and records reward as debt
     * @dev Special harvest method that does not update the position,
     * therefore records 'earned' as debt.
     * @param posId ID of the position to harvest rewards from
     * @return The reward amount
     */
    function _harvestWithDebt(uint posId) internal returns (uint) {
        Position storage position = positions[posId];
        require(
            position.owner == msg.sender,
            "SAR::_harvestWithDebt: unauthorized"
        );
        // get pending rewards (expects _updateRewardVariables is called)
        uint reward = _earned(posId);
        // record earned amount as virtual debt as we will not update position.
        // exclude position.reward as it will be reset by _harvestWithoutUpdate
        _debts[posId] += reward;
        // harvest the position and return reward amount
        return reward;
    }

    /**
     * @dev Subtracts debts from the over-ridden `_earned` function.
     * Debts are accrued when harvesting without updating the position.
     */
    function _earned(uint posId) internal view override returns (uint) {
        uint earned = super._earned(posId);
        return earned - _debts[posId];
    }
}
