/*
 * SPDX-License-Identifier: GPLv3
 * solhint-disable not-rely-on-time
 *
 * Sunshine and Rainbows: ERC721 Staking
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

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/IERC721Enumerable.sol";

import "./SunshineAndRainbows.sol";

contract SunshineAndRainbowsERC721 is SunshineAndRainbows {
    using EnumerableSet for EnumerableSet.UintSet;
    using SafeERC20 for IERC20;
    using SafeCast for int;

    /// @notice Staking token stored as ERC721 interface
    IERC721 private immutable _stakingToken;

    /// @notice Set of tokens stored in a position
    mapping(address => EnumerableSet.UintSet) private _tokensOf;

    constructor(address newStakingToken, address newRewardRegulator)
        SunshineAndRainbows(newStakingToken, newRewardRegulator)
    {
        _stakingToken = IERC721(newStakingToken);
    }

    /**
     * @notice Stakes tokens to caller
     * @param tokens The list of token IDs to stake
     * @dev The reward rate of the existing balance will not reset to zero, but
     * the reward rate of the added amount will start from zero.
     */
    function stakeERC721(uint[] calldata tokens) external {
        if (totalSupply != 0) {
            _updateRewardVariables();
        } else if (initTime == 0) {
            initTime = block.timestamp;
        }
        _stakeERC721(tokens);
    }

    /**
     * @notice Partially withdraws & harvests a position
     * @param tokens The list of tokens to withdraw from the position
     * @dev The reward rate for remaining balance will reset to zero
     */
    function withdrawERC721(uint[] calldata tokens) external {
        _updateRewardVariables();
        _withdrawERC721(tokens);
    }

    /// @notice Returns tokens of a position
    function tokensOf(address account) external view returns (uint[] memory) {
        return _tokensOf[account].values();
    }

    /// @dev Disable ERC20 `open()` function
    function stake(uint) external pure override {
        revert("SAR::stake: use `stakeERC721`");
    }

    /// @dev Disable ERC20 `withdraw()` function
    function withdraw(uint) external pure override {
        revert("SAR::withdraw: use `withdrawERC721`");
    }

    /// @dev Disable ERC20 `_stake()` function
    function _stake(uint, address) internal pure override {
        revert();
    }

    /// @dev Disable ERC20 `_withdraw()` function
    function _withdraw(uint) internal pure override {
        revert();
    }

    function _stakeERC721(uint[] memory tokens) private {
        User storage user = users[msg.sender];
        uint amount = tokens.length;
        require(amount != 0, "SAR::_openERC721: zero amount");
        //require(amount <= 20, "SAR::_openERC721: too many tokens");

        // update global variables
        uint balance = user.balance; // gas saving
        uint entryTimes = block.timestamp * amount;
        sumOfEntryTimes += entryTimes;
        totalSupply += amount;

        // update position variables
        if (balance == 0) {
            user.balance = amount;
            user.lastUpdate = block.timestamp;
            user.entryTimes = entryTimes;
            user.idealPosition = _idealPosition;
            user.rewardsPerStakingDuration = _rewardsPerStakingDuration;
        } else {
            users[msg.sender] = User(
                balance + amount,
                block.timestamp,
                _earned(),
                user.stakingDuration +
                    (balance * (block.timestamp - user.lastUpdate)),
                user.entryTimes + entryTimes,
                _idealPosition,
                _rewardsPerStakingDuration
            );
        }

        // transfer tokens from user to the contract
        for (uint i; i < amount; ++i) {
            uint tokenId = tokens[i];
            _tokensOf[msg.sender].add(tokenId);
            _stakingToken.transferFrom(msg.sender, address(this), tokenId);
        }

        emit Staked(msg.sender, amount);
    }

    function _withdrawERC721(uint[] memory tokens) private {
        User storage user = users[msg.sender];

        uint amount = tokens.length;
        uint balance = user.balance;
        require(amount != 0, "SAR::_withdraw: zero amount");

        // get earned rewards
        uint reward = _earned().toUint256();

        // disables the position
        if (balance > amount) {
            uint remaining;
            unchecked {
                remaining = balance - amount;
            }
            uint newEntryTimes = remaining * block.timestamp;
            sumOfEntryTimes = sumOfEntryTimes - user.entryTimes + newEntryTimes;
            users[msg.sender] = User(
                remaining,
                block.timestamp,
                0,
                0,
                newEntryTimes,
                _idealPosition,
                _rewardsPerStakingDuration
            );
        } else if (balance == amount) {
            sumOfEntryTimes -= user.entryTimes;
            user.balance = 0;
            user.lastUpdate = block.timestamp;
            user.stash = 0;
            user.stakingDuration = 0;
            user.entryTimes = 0;
        } else {
            revert("SAR::_withdraw: wrong tokenId");
        }

        // update global variables (sumOfEntryTimes updated in above if-else)
        totalSupply -= amount;

        // transfer rewards & stake balance to owner
        if (reward != 0) rewardToken.safeTransfer(msg.sender, reward);
        for (uint i; i < amount; ++i) {
            uint tokenId = tokens[i];
            require(
                _tokensOf[msg.sender].remove(tokenId),
                "SAR::_withdraw: wrong tokenId"
            );
            _stakingToken.transferFrom(address(this), msg.sender, tokenId);
        }

        emit Withdrawn(msg.sender, amount, reward);
    }
}
