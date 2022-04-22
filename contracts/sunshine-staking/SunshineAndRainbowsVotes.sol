/*
 * SPDX-License-Identifier: GPLv3
 *
 * Sunshine and Rainbows: Vote Locking for Single Token Compound
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

import "./SunshineAndRainbowsCompoundSingle.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title Sunshine and Rainbows Extension: Vote Locking for Single Stake
 * @notice An extension to `SunshineAndRainbows` that allows an owner to lock
 * withdrawing and harvesting for a user. It is intended for owner to be a
 * governance contract. This governance contract would allow pseudo-staking of
 * tokens in SAR by locking their withdrawal. A user would have to lock their
 * tokens through governance to participate in proposals. The user must be
 * allowed to unlock anytime they wish, which would remove their votes from
 * the active proposals they have been participating in. Until the proper
 * governance contract impelementation is written and deployed, the ownership
 * should be transferred to an existing governance contract which would not be
 * touching the lock & unlock functions.
 * @author shung for Pangolin
 */
contract SunshineAndRainbowsVotes is
    SunshineAndRainbowsCompoundSingle,
    Ownable
{
    mapping(address => bool) public locked;

    modifier whenNotLocked() {
        require(!locked[msg.sender], "SAR:: tokens locked in governance");
        _;
    }

    constructor(
        address newStakingToken,
        address newRewardRegulator,
        address newLocker
    ) SunshineAndRainbowsCompoundSingle(newStakingToken, newRewardRegulator) {
        transferOwnership(newLocker);
    }

    function lock(address account) external onlyOwner {
        locked[account] = true;
    }

    function unlock(address account) external onlyOwner {
        locked[account] = false;
    }

    function _withdraw(uint amount) internal override whenNotLocked {
        super._withdraw(amount);
    }

    function _harvest() internal override whenNotLocked {
        super._harvest();
    }
}
