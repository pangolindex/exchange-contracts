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
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC721/extensions/IERC721Enumerable.sol";
import "./SunshineAndRainbows.sol";

contract SunshineAndRainbowsERC721 is SunshineAndRainbows {
    using EnumerableSet for EnumerableSet.UintSet;
    using SafeERC20 for IERC20;

    /// @notice Staking token stored as ERC721 interface
    IERC721 private immutable _stakingToken;

    /// @notice Set of tokens stored in a position
    mapping(uint => EnumerableSet.UintSet) private _tokensOf;

    constructor(address newStakingToken, address newRewardRegulator)
        SunshineAndRainbows(newStakingToken, newRewardRegulator)
    {
        _stakingToken = IERC721(newStakingToken);
    }

    /**
     * @notice Creates a new position and stakes tokens to it
     * @dev The reward rate of the new position starts from zero
     * @param tokens The list of token IDs to stake
     */
    function openERC721(uint[] calldata tokens) external {
        if (totalSupply != 0) {
            _updateRewardVariables();
        } else if (initTime == 0) {
            initTime = block.timestamp;
        }
        _openERC721(tokens);
    }

    /**
     * @notice Partially withdraws & harvests a position
     * @param posId The ID of the position to partially close
     * @param tokens The list of tokens to withdraw from the position
     */
    function withdrawERC721(uint posId, uint[] calldata tokens) external {
        _updateRewardVariables();
        _withdrawERC721(posId, tokens);
    }

    /**
     * @notice Closes some positions and partially withdraws from one position
     * @param posIds The list of IDs of the positions to fully close
     * @param posId The ID of the position to partially close
     * @param tokens The list of tokens to withdraw from the position
     */
    function multiWithdrawERC721(
        uint[] calldata posIds,
        uint posId,
        uint[] calldata tokens
    ) external {
        _updateRewardVariables();
        for (uint i; i < posIds.length; ++i) _close(posIds[i]);
        _withdrawERC721(posId, tokens);
    }

    /// @notice Returns tokens of a position
    function tokensOf(uint posId) external view returns (uint[] memory) {
        return _tokensOf[posId].values();
    }

    /// @dev Disable ERC20 `open()` function
    function open(uint) external pure override {
        revert("SAR::open: use `openERC721`");
    }

    /// @dev Disable ERC20 `withdraw()` function
    function withdraw(uint, uint) external pure override {
        revert("SAR::withdraw: use `withdrawERC721`");
    }

    function multiWithdraw(
        uint[] calldata,
        uint,
        uint
    ) external pure override {
        revert("SAR::closeSomeWithdrawOne: use `closeSomeWithdrawOneERC721`");
    }

    /**
     * @notice Updates position, withdraws all its tokens, and harvests rewards
     * @dev Overrides the regulaor `_close()` function to work with ERC721.
     * @param posId ID of the position to close
     */
    function _close(uint posId) internal override {
        Position storage position = positions[posId];
        require(position.owner == msg.sender, "SAR::_close: unauthorized");
        uint[] memory tokens = _tokensOf[posId].values();
        uint amount = tokens.length;
        require(amount != 0, "SAR::_close: zero amount");

        // update global variables
        sumOfEntryTimes -= (position.lastUpdate * amount);
        totalSupply -= amount;

        // remove position from the set of the user
        _userPositions[msg.sender].remove(posId);

        // get earned rewards
        uint reward = _earned(posId);

        // disables the position: zero balanced position becomes unusable,
        // therefore no need to update other position properties
        position.balance = 0;

        // transfer rewards & stake balance to owner
        if (reward != 0) rewardToken.safeTransfer(msg.sender, reward);
        for (uint i; i < amount; ++i) {
            uint tokenId = tokens[i];
            require(
                _tokensOf[posId].remove(tokenId),
                "SAR::_close: wrong tokenId"
            );
            _stakingToken.transferFrom(address(this), msg.sender, tokenId);
        }

        emit Closed(posId, amount, reward);
    }

    /// @dev Disable ERC20 `_open()` function
    function _open(uint, address) internal pure override {
        revert();
    }

    /// @dev Disable ERC20 `_withdraw()` function
    function _withdraw(uint, uint) internal pure override {
        revert();
    }

    /**
     * @notice Withdraws a portion of a position, and harvests rewards of the
     * withdrawn amount
     * @dev This will not reset the reward rate to zero, as it is only
     * harvesting the rewards of the withdrawn amount
     * @param posId The Id of position to withdraw from
     * @param tokens The list of tokens to withdraw
     */
    function _withdrawERC721(uint posId, uint[] memory tokens) private {
        Position storage position = positions[posId];
        require(
            position.owner == msg.sender,
            "SAR::_withdrawERC721: unauthorized"
        );
        uint amount = tokens.length;
        require(
            position.balance > amount,
            "SAR::_withdrawERC721: use `close()`"
        );
        require(amount != 0, "SAR::_withdrawERC721: zero amount");

        // update global variables
        sumOfEntryTimes -= (position.lastUpdate * amount);
        totalSupply -= amount;

        // get earned rewards:
        // we only want the withdrawn amount's rewards to be harvested, so
        // we will do a little hack by temporarily changing position.balance
        // to withdrawn amount, which will be the balance used by _earned(),
        // then changing it back to actual remaining balance.
        uint remainingBalance = position.balance - amount;
        position.balance = amount;
        uint reward = _earned(posId);
        position.balance = remainingBalance;

        // transfer reward & withdrawn amount to user
        if (reward != 0) rewardToken.safeTransfer(msg.sender, reward);
        for (uint i; i < amount; ++i) {
            uint tokenId = tokens[i];
            require(
                _tokensOf[posId].remove(tokenId),
                "SARS::_withdrawERC721: wrong tokenId"
            );
            _stakingToken.transferFrom(address(this), msg.sender, tokenId);
        }
        emit Withdrawn(posId, amount, reward);
    }

    /**
     * @notice Creates positions then stakes tokens to it
     * @param tokens The list of token IDs to stake
     */
    function _openERC721(uint[] memory tokens) private {
        uint amount = tokens.length;
        require(amount != 0, "SAR::_openERC721: zero amount");
        require(amount <= 20, "SAR::_openERC721: too many tokens");

        // update global variables
        sumOfEntryTimes += (block.timestamp * amount);
        totalSupply += amount;

        // update position variables
        uint posId = positions.length;
        positions.push(
            Position(
                msg.sender,
                amount,
                block.timestamp,
                _idealPosition,
                _rewardsPerStakingDuration
            )
        );

        // add position to the set for interfacing
        _userPositions[msg.sender].add(posId);

        // transfer tokens from user to the contract
        for (uint i; i < amount; ++i) {
            uint tokenId = tokens[i];
            _tokensOf[posId].add(tokenId);
            _stakingToken.transferFrom(msg.sender, address(this), tokenId);
        }

        emit Opened(posId, amount);
    }
}
