/*
 * SPDX-License-Identifier: GPLv3
 * solhint-disable not-rely-on-time
 *
 * Pangolin Staking Positions, powered by Sunshine and Rainbows Algorithm
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

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";

import "./libraries/FullMath.sol";
import "./interfaces/IRewardRegulator.sol";

/**
 * @title Pangolin Staking Positions
 * @notice Pangolin Staking Positions which utilizes Sunshine and Rainbows
 * (SAR) algorithm for distributing staking rewards to each position. See
 * README and linked proof in the README to see how SAR works. In this
 * implementation, each position is also a tradeable & stakeable NFT.
 * @author shung for Pangolin
 */
contract PangolinStakingPositions is ERC721Enumerable {
    using SafeCast for uint;
    using SafeCast for int;
    using SafeERC20 for IERC20;
    using FullMath for FullMath.Uint512;

    struct Position {
        // Amount of tokens staked in the position
        uint96 balance;
        // Last time the position was updated
        // Will work until: Sun Feb  7 06:28:15 AM UTC 2106. Migrate before.
        uint32 lastUpdate;
        // The sum of previous staking durations `(balance * (block.timestamp
        // - lastUpdate))` of the position. This variable is only updated
        // accordingly when more tokens are staked into an existing position.
        // Any calls other than staking (i.e.: harvest and close) must reset
        // the value to zero. Correctly updating stakingDuration allows
        // for reward rate to not reset when lastUpdate and other position
        // variables are updated. Refer to the proofs for why this works.
        uint128 stakingDuration;
        // The sum of each staked token of the position multiplied by its
        // update time
        uint entryTimes;
        // `_idealPosition` on position's last update
        FullMath.Uint512 idealPosition;
        // `_rewardsPerStakingDuration` on position's last update
        FullMath.Uint512 rewardsPerStakingDuration;
    }

    /// @notice The mapping of positions' ids to their properties
    Position[] public positions;

    /// @notice The contract that determines the rewards of this contract
    IRewardRegulator public immutable rewardRegulator;

    /// @notice The token that can be staked in the contract
    IERC20 public immutable PNG;

    /**
     * @notice Sum of all intervals' (`rewards`/`stakingDuration`)
     * @dev Refer to `sum of r/S` in the proof for more details.
     */
    FullMath.Uint512 private _rewardsPerStakingDuration;

    /**
     * @notice Hypothetical rewards accumulated by an ideal position whose
     * `lastUpdate` equals `initTime`, and `balance` equals one.
     * @dev Refer to `sum of I` in the proof for more details.
     */
    FullMath.Uint512 private _idealPosition;

    /// @notice Sum of all users' `balance`
    uint public totalStaked;

    /// @notice Sum of all users' `entryTimes`
    uint public sumOfEntryTimes;

    /// @notice Time stamp of first stake event
    uint public initTime;

    event Opened(uint position, uint amount);
    event Closed(uint position, uint amount, uint reward);
    event Staked(uint position, uint amount, uint reward);
    event Harvested(uint position, uint reward);
    event Compounded(uint position, uint reward);

    /**
     * @notice Constructs a new SunshineAndRainbows staking contract with
     * compounding & NFT features
     * @param newStakingToken Contract address of the staking token
     * @param newRewardRegulator Contract address of the reward regulator which
     * distributes reward tokens
     */
    constructor(address newStakingToken, address newRewardRegulator)
        ERC721("Pangolin Staking Positions", "PNG-POS")
    {
        require(
            newStakingToken ==
                address(IRewardRegulator(newRewardRegulator).rewardToken()),
            "SAR::Constructor: invalid staking token"
        );
        PNG = IERC20(newStakingToken);
        rewardRegulator = IRewardRegulator(newRewardRegulator);
    }

    /**
     * @notice Opens a new position
     * @param amount The amount of tokens to seed the position with
     */
    function open(uint amount) external {
        if (totalStaked != 0) {
            _updateRewardVariables();
        } else if (initTime == 0) {
            initTime = block.timestamp;
        }
        _open(amount);
    }

    /**
     * @notice Stakes `amount` tokens to `posId`
     * @param amount Amount of tokens to stake
     * @param posId The ID of the position to stake to
     * @dev The reward rate of the existing balance will not reset to zero, but
     * the reward rate of the added amount will start from zero. The pending
     * rewards will also be added to the staked balance.
     */
    function stake(uint posId, uint amount) external {
        _updateRewardVariables();
        _stake(posId, amount);
    }

    /**
     * @notice Harvests rewards from a position
     * @param posId The ID of the position to harvest from
     * @dev This will reset the reward rate to zero, making the staked balance
     * behave as if it is newly staked.
     */
    function harvest(uint posId) external {
        _updateRewardVariables();
        _harvest(posId);
    }

    /**
     * @notice Stakes the rewards of the position
     * @param posId The ID of the position to compound
     * @dev The reward rate of the existing balance will not reset to zero, but
     * the reward rate of the added pending reward amount will start from zero.
     */
    function compound(uint posId) external {
        _updateRewardVariables();
        _compound(posId);
    }

    function multiHarvest(uint[] calldata posIds) external {
        _updateRewardVariables(); // save gas by updating only once
        for (uint i; i < posIds.length; ++i) _harvest(posIds[i]);
    }

    function multiClose(uint[] calldata posIds) external {
        _updateRewardVariables();
        for (uint i; i < posIds.length; ++i) _close(posIds[i]);
    }

    function multiCompound(uint[] calldata posIds) external {
        _updateRewardVariables();
        for (uint i; i < posIds.length; ++i) _compound(posIds[i]);
    }

    /**
     * @notice Returns the reward rate of a position
     * @return The reward rate per second of the position
     */
    function rewardRate(uint posId) external view returns (uint) {
        uint stakingDuration = block.timestamp * totalStaked - sumOfEntryTimes;
        require(stakingDuration != 0, "SAR::rewardRate: zero stake duration");
        Position memory position = positions[posId];
        uint positionStakingDuration = block.timestamp *
            position.balance -
            position.entryTimes;
        return
            (rewardRegulator.rewardRate() *
                rewardRegulator.recipients(address(this)).weight *
                positionStakingDuration) /
            rewardRegulator.totalWeight() /
            stakingDuration;
    }

    /**
     * @notice Returns the pending rewards of a position
     * @param posId The position ID to check the pending rewards of
     * @return The amount of rewards that can have been accrued in the position
     */
    function pendingRewards(uint posId) external view returns (uint) {
        (
            FullMath.Uint512 memory tmpIdealPosition,
            FullMath.Uint512 memory tmpRewardsPerStakingDuration
        ) = _rewardVariables(rewardRegulator.pendingRewards(address(this)));
        // duplicate of `_earned()` with temporary reward variables
        Position memory position = positions[posId];
        FullMath.Uint512
            memory rewardsPerStakingDuration = tmpRewardsPerStakingDuration.sub(
                position.rewardsPerStakingDuration
            );
        return
            tmpIdealPosition
                .sub(position.idealPosition)
                .sub(
                    rewardsPerStakingDuration.mul(
                        position.lastUpdate - initTime
                    )
                )
                .mul(position.balance)
                .add(rewardsPerStakingDuration.mul(position.stakingDuration))
                .shiftToUint256();
    }

    function positionsOf(address user) external view returns (uint[] memory) {
        uint ownerTokenCount = balanceOf(user);
        uint[] memory tokenIds = new uint[](ownerTokenCount);
        for (uint i; i < ownerTokenCount; ++i) {
            tokenIds[i] = tokenOfOwnerByIndex(user, i);
        }
        return tokenIds;
    }

    function _open(uint amount) private {
        require(amount != 0, "SAR::_open: zero amount");
        uint entryTimes = block.timestamp * amount;

        // update global variables
        sumOfEntryTimes += entryTimes;
        totalStaked += amount;

        uint posId = positions.length;
        positions.push(
            Position(
                amount.toUint96(),
                block.timestamp.toUint32(),
                0,
                entryTimes,
                _idealPosition,
                _rewardsPerStakingDuration
            )
        );
        _mint(msg.sender, posId);

        PNG.safeTransferFrom(msg.sender, address(this), amount);
        emit Opened(posId, amount);
    }

    function _close(uint posId) private {
        Position memory position = positions[posId];
        require(
            _isApprovedOrOwner(msg.sender, posId),
            "SAR::_close: not owner"
        );

        uint balance = position.balance;
        uint reward = _earned(posId);

        totalStaked -= balance;
        sumOfEntryTimes -= position.entryTimes;

        delete positions[posId];
        _burn(posId);

        PNG.safeTransfer(msg.sender, balance + reward);
        emit Closed(posId, balance, reward);
    }

    function _stake(uint posId, uint amount) private {
        Position storage position = positions[posId];
        require(
            _isApprovedOrOwner(msg.sender, posId),
            "SAR::_stake: not owner"
        );
        require(amount != 0, "SAR::_stake: zero amount");

        // add accrued rewards to the amount
        uint reward = _earned(posId);
        uint totalAmount = amount + reward;
        uint entryTimes = block.timestamp * totalAmount;

        // update  global variables
        sumOfEntryTimes += entryTimes;
        totalStaked += totalAmount;

        position.stakingDuration += (position.balance *
            (block.timestamp - position.lastUpdate)).toUint128();
        position.balance += totalAmount.toUint96();
        position.lastUpdate = block.timestamp.toUint32();
        position.entryTimes += entryTimes;
        position.idealPosition = _idealPosition;
        position.rewardsPerStakingDuration = _rewardsPerStakingDuration;

        // transfer tokens from user to the contract
        PNG.safeTransferFrom(msg.sender, address(this), amount);
        emit Staked(posId, amount, reward);
    }

    function _harvest(uint posId) private {
        Position storage position = positions[posId];
        require(
            _isApprovedOrOwner(msg.sender, posId),
            "SAR::_harvest: not owner"
        );

        // update global variables (totalStaked is not changed)
        uint entryTimes = block.timestamp * position.balance;
        sumOfEntryTimes += entryTimes - position.entryTimes;

        // get earned rewards
        uint reward = _earned(posId);
        require(reward != 0, "SAR::_harvest: zero reward");

        // update position variables (must behave as if position is re-opened)
        position.lastUpdate = block.timestamp.toUint32();
        position.stakingDuration = 0;
        position.entryTimes = entryTimes;
        position.idealPosition = _idealPosition;
        position.rewardsPerStakingDuration = _rewardsPerStakingDuration;

        // transfer rewards to the user
        PNG.safeTransfer(msg.sender, reward);
        emit Harvested(posId, reward);
    }

    function _compound(uint posId) private {
        Position storage position = positions[posId];
        require(
            _isApprovedOrOwner(msg.sender, posId),
            "SAR::_compound: not owner"
        );

        // Harvest pending rewards, and record it as debt (negative value). We
        // record it as debt because we're not updating user variabless that
        // govern the reward rate for the user. However, when updating
        // the user position variables below, the lastUpdate and stakingDuration
        // is updated in a way that algorithm requires the rewards until that
        // point to be stashed. that cancels out debt. making stash zero.
        uint reward = _earned(posId);
        require(reward != 0, "SAR::_compound: no rewards");
        uint entryTimes = block.timestamp * reward;

        // update  global variables
        sumOfEntryTimes += entryTimes;
        totalStaked += reward;

        position.stakingDuration += (position.balance *
            (block.timestamp - position.lastUpdate)).toUint128();
        position.balance += reward.toUint96();
        position.lastUpdate = block.timestamp.toUint32();
        position.entryTimes += entryTimes;
        position.idealPosition = _idealPosition;
        position.rewardsPerStakingDuration = _rewardsPerStakingDuration;

        emit Compounded(posId, reward);
    }

    /**
     * @dev Claims pending rewards from RewardRegulator, and based on the
     * claimed amount updates the two variables that govern the reward
     * distribution.
     */
    function _updateRewardVariables() private {
        (_idealPosition, _rewardsPerStakingDuration) = _rewardVariables(
            rewardRegulator.claim()
        );
    }

    /**
     * @dev Gets the pending rewards of caller. The call to this function
     * must only be made after the reward variables are updated through
     * `_updateRewardVariables()`.
     * Refer to the derived formula at the end of section 2.3 of proof.
     */
    function _earned(uint posId) private view returns (uint) {
        Position memory position = positions[posId];
        FullMath.Uint512
            memory rewardsPerStakingDuration = _rewardsPerStakingDuration.sub(
                position.rewardsPerStakingDuration
            );
        /*
         * core formula in EQN(7):
         * ( ( sum I from 1 to m - sum I from 1 to n-1 ) -
         * ( sum (R/s) from 1 to m - sum (R/s) from 1 to n-1 )
         * times ( sum t from 1 to n-1 ) ) times y
         */
        return
            _idealPosition
                .sub(position.idealPosition)
                .sub(
                    rewardsPerStakingDuration.mul(
                        position.lastUpdate - initTime
                    )
                )
                .mul(position.balance)
                .add(rewardsPerStakingDuration.mul(position.stakingDuration))
                .shiftToUint256();
    }

    /**
     * @dev Calculates the variables that govern the reward distribution. For
     * `idealPosition`, refer to `I` in the proof, for `stakingDuration`, refer
     * to `S`, and for `_rewardsPerStakingDuration`, refer to `r/S`.
     * @param rewards The rewards this contract is eligible to distribute
     * during the last interval (i.e., since the last update)
     */
    function _rewardVariables(uint rewards)
        private
        view
        returns (FullMath.Uint512 memory, FullMath.Uint512 memory)
    {
        uint stakingDuration = block.timestamp * totalStaked - sumOfEntryTimes;
        if (stakingDuration == 0)
            return (_idealPosition, _rewardsPerStakingDuration);
        return (
            // `sum (t times r over S)` with 2**256 fixed denominator
            _idealPosition.add(
                FullMath.div256(stakingDuration).mul(
                    (block.timestamp - initTime) * rewards
                )
            ),
            // `sum (r over S)` with 2**256 fixed denominator
            _rewardsPerStakingDuration.add(
                FullMath.div256(stakingDuration).mul(rewards)
            )
        );
    }
}
