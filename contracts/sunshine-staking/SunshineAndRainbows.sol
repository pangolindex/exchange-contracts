/*
 * SPDX-License-Identifier: GPLv3
 * solhint-disable not-rely-on-time
 *
 * Sunshine and Rainbows: Core Implementation
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

import "./libraries/FullMath.sol";
import "./interfaces/IRewardRegulator.sol";

/**
 * @title Sunshine and Rainbows
 * @notice Sunshine and Rainbows is a novel staking algorithm that gives
 * more rewards to users with longer staking durations
 * @dev For a general overview refer to `README.md`. For the proof of the
 * algorithm refer to the proof linked in `README.md`.
 * @author shung for Pangolin & cryptofrens.xyz
 */
contract SunshineAndRainbows {
    using SafeCast for uint;
    using SafeCast for int;
    using SafeERC20 for IERC20;
    using FullMath for FullMath.Uint512;

    struct User {
        // Amount of tokens staked by the user
        uint balance;
        // Last time the position was updated
        uint lastUpdate;
        // Positive refers to recorded but unclaimed rewards on last update
        // Negative refers to debt when rewards were claimed without update
        int stash;
        // The previous staking duration (balance * duration) of the user
        uint stakingDuration;
        // The sum of each staked token of user multiplied by its update time
        uint entryTimes;
        // `_idealPosition` on user's last update
        FullMath.Uint512 idealPosition;
        // `_rewardsPerStakingDuration` on user's last update
        FullMath.Uint512 rewardsPerStakingDuration;
    }

    /// @notice The mapping of users to their properties
    mapping(address => User) public users;

    /// @notice The contract that determines the rewards of this contract
    IRewardRegulator public immutable rewardRegulator;

    /// @notice The token that is distributed as reward
    IERC20 public immutable rewardToken;

    /// @notice The token that can be staked in the contract
    IERC20 public immutable stakingToken;

    /**
     * @notice Sum of all intervals' (`rewards`/`stakingDuration`)
     * @dev Refer to `sum of r/S` in the proof for more details.
     */
    FullMath.Uint512 internal _rewardsPerStakingDuration;

    /**
     * @notice Hypothetical rewards accumulated by an ideal position whose
     * `lastUpdate` equals `initTime`, and `balance` equals one.
     * @dev Refer to `sum of I` in the proof for more details.
     */
    FullMath.Uint512 internal _idealPosition;

    /// @notice Sum of all users' `balance`
    uint public totalSupply;

    /// @notice Sum of all users' `entryTimes`
    uint public sumOfEntryTimes;

    /// @notice Time stamp of first stake event
    uint public initTime;

    event Staked(address user, uint amount);
    event Withdrawn(address user, uint amount, uint reward);
    event Harvested(address user, uint reward);

    /**
     * @notice Constructs the Sunshine And Rainbows contract
     * @param newStakingToken The token that will be staked for rewards
     * @param newRewardRegulator The contract that will determine the global
     * reward rate
     */
    constructor(address newStakingToken, address newRewardRegulator) {
        require(
            newStakingToken != address(0) && newRewardRegulator != address(0),
            "SAR::Constructor: zero address"
        );
        stakingToken = IERC20(newStakingToken);
        rewardRegulator = IRewardRegulator(newRewardRegulator);
        rewardToken = IRewardRegulator(newRewardRegulator).rewardToken();
    }

    /**
     * @notice Stakes tokens of caller
     * @param amount Amount of tokens to stake
     * @dev The reward rate of the existing balance will not reset to zero, but
     * the reward rate of the added amount will start from zero.
     */
    function stake(uint amount) external virtual {
        if (totalSupply != 0) {
            _updateRewardVariables();
        } else if (initTime == 0) {
            initTime = block.timestamp;
        }
        _stake(amount, msg.sender);
    }

    /// @notice Claims all rewards and withdraws all stake of the caller
    function withdraw(uint amount) external virtual {
        _updateRewardVariables();
        _withdraw(amount);
    }

    /**
     * @notice Harvests rewards of a user
     * @dev This will reset the reward rate to zero, making the staked balance
     * behave as if it is newly staked.
     */
    function harvest() external virtual {
        _updateRewardVariables();
        _harvest();
    }

    /**
     * @notice Returns the reward rate of a user
     * @return The reward rates per second of each position
     */
    function rewardRate(address account) external view returns (uint) {
        uint stakingDuration = block.timestamp * totalSupply - sumOfEntryTimes;
        require(stakingDuration != 0, "SAR::rewardRate: zero stake duration");
        User memory user = users[account];
        uint userStakingDuration = block.timestamp *
            user.balance -
            user.entryTimes;
        return
            (rewardRegulator.rewardRate() *
                rewardRegulator.recipients(address(this)).weight *
                userStakingDuration) /
            rewardRegulator.totalWeight() /
            stakingDuration;
    }

    /**
     * @notice Returns the pending rewards of a user
     * @param account The address of the user
     * @return The amount of tokens that can be claimed by the user
     */
    function pendingRewards(address account) external view returns (uint) {
        (
            FullMath.Uint512 memory tmpIdealPosition,
            FullMath.Uint512 memory tmpRewardsPerStakingDuration
        ) = _rewardVariables(rewardRegulator.pendingRewards(address(this)));
        // duplicate of `_earned()` with temporary reward variables
        User memory user = users[account];
        FullMath.Uint512
            memory rewardsPerStakingDuration = tmpRewardsPerStakingDuration.sub(
                user.rewardsPerStakingDuration
            );
        return
            (tmpIdealPosition
                .sub(user.idealPosition)
                .sub(rewardsPerStakingDuration.mul(user.lastUpdate - initTime))
                .mul(user.balance)
                .add(rewardsPerStakingDuration.mul(user.stakingDuration))
                .shiftToUint256()
                .toInt256() + user.stash).toUint256();
    }

    function _withdraw(uint amount) internal virtual {
        User storage user = users[msg.sender];

        uint balance = user.balance;
        require(amount != 0, "SAR::_withdraw: zero amount");

        // get earned rewards
        uint reward = _earned().toUint256();

        // update the user variables and sumOfEntryTimes
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
            revert("SAR::_withdraw: insufficient balance");
        }

        // update global variables (sumOfEntryTimes updated in above if-else)
        totalSupply -= amount;

        // transfer rewards & stake balance to owner
        if (reward != 0) rewardToken.safeTransfer(msg.sender, reward);
        stakingToken.safeTransfer(msg.sender, amount);

        emit Withdrawn(msg.sender, amount, reward);
    }

    function _stake(uint amount, address from) internal virtual {
        User storage user = users[msg.sender];
        require(amount != 0, "SAR::_stake: zero amount");

        uint balance = user.balance; // gas saving
        uint entryTimes = block.timestamp * amount;

        // update  global variables
        sumOfEntryTimes += entryTimes;
        totalSupply += amount;

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
        if (from != address(this))
            stakingToken.safeTransferFrom(from, address(this), amount);
        emit Staked(msg.sender, amount);
    }

    function _harvest() internal virtual {
        User storage user = users[msg.sender];

        // update global variables (totalSupply is not changed)
        uint entryTimes = block.timestamp * user.balance;
        sumOfEntryTimes += entryTimes - user.entryTimes;

        // get earned rewards
        uint reward = _earned().toUint256();
        require(reward != 0, "SAR::_harvest: zero reward");

        // update user variables (must behave as if position is re-opened)
        user.lastUpdate = block.timestamp;
        user.stash = 0;
        user.stakingDuration = 0;
        user.entryTimes = entryTimes;
        user.idealPosition = _idealPosition;
        user.rewardsPerStakingDuration = _rewardsPerStakingDuration;

        // transfer tokens from user to the contract
        rewardToken.safeTransfer(msg.sender, reward);
        emit Harvested(msg.sender, reward);
    }

    /**
     * @dev Claims pending rewards from RewardRegulator, and based on the
     * claimed amount updates the two variables that govern the reward
     * distribution.
     */
    function _updateRewardVariables() internal {
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
    function _earned() internal view virtual returns (int) {
        User memory user = users[msg.sender];
        FullMath.Uint512
            memory rewardsPerStakingDuration = _rewardsPerStakingDuration.sub(
                user.rewardsPerStakingDuration
            );
        /*
         * core formula in EQN(7):
         * ( ( sum I from 1 to m - sum I from 1 to n-1 ) -
         * ( sum (R/s) from 1 to m - sum (R/s) from 1 to n-1 )
         * times ( sum t from 1 to n-1 ) ) times y
         */
        return
            _idealPosition
                .sub(user.idealPosition)
                .sub(rewardsPerStakingDuration.mul(user.lastUpdate - initTime))
                .mul(user.balance)
                .add(rewardsPerStakingDuration.mul(user.stakingDuration))
                .shiftToUint256()
                .toInt256() + user.stash;
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
        uint stakingDuration = block.timestamp * totalSupply - sumOfEntryTimes;
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
