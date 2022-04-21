/*
 * SPDX-License-Identifier: GPLv3
 * solhint-disable not-rely-on-time
 *
 * Reward Regulator Abstract
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

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";

/**
 * @title Reward Regulator Framework
 * @notice A StakingRewards replacement that distributes to multiple contracts
 * @dev This contract is a partial implementation of Synthetix' StakingRewards.
 * The contract does not hold any staking tokens, and lacks withdrawing,
 * harvesting, and staking functions. It only holds the reward token, and
 * distributes the reward token to downstream recipient contracts. In essence,
 * this is StakingRewards broken into two components. First component is this
 * contract, which holds the reward token and then determines the global reward
 * rate. The second component is separate contracts which handle distribution
 * of rewards to end users. We will call these separate contracts recipients.
 * A recipient contract must call `claim()` of RewardRegulator to receive its
 * reward since its last `claim()` call. Then the recipient should manage
 * distributing the tokens in its balance to end users. RewardRegulator is
 * agnostic to how the recipient distributes its rewards.
 * @author shung for Pangolin
 */
abstract contract RewardRegulator is AccessControl {
    using EnumerableSet for EnumerableSet.AddressSet;
    using SafeERC20 for IERC20;
    using SafeCast for uint;
    using SafeCast for int;

    struct Recipient {
        uint weight; // The emission weight of the recipient
        uint stash; // The reward amount stashed when weight changes
        uint rewardPerWeightPaid; // The _rewardPerWeightStored on update
    }

    /// @notice The mapping of accounts (i.e. recipients) to their information
    mapping(address => Recipient) public recipients;

    /// @notice A set of recipient addresses (for interfacing/transparency)
    EnumerableSet.AddressSet internal _recipients;

    /// @notice The reward token the contract will distribute
    IERC20 public immutable rewardToken;

    /// @notice The end time of the reward period
    uint public periodFinish;

    /// @notice Sum of all weight
    uint public totalWeight;

    /// @notice The timestamp of the last update
    uint internal _lastUpdate;

    /// @notice The amount of reward tokens reserved to be distributed
    uint internal _reserved;

    /// @notice Total rewards emitted per weight until last update
    uint internal _rewardPerWeightStored;

    event RecipientSet(address indexed account, uint newWeight);
    event Claimed(address indexed account, uint reward);
    event Recovered(address indexed token, uint amount);

    /**
     * @notice Construct a new RewardRegulatorFundable contract
     * @param newRewardToken The reward token the contract will distribute
     */
    constructor(address newRewardToken) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        require(newRewardToken != address(0), "Construct: zero address");
        rewardToken = IERC20(newRewardToken);
    }

    /**
     * @notice Sends the rewards to message sender
     * @return The amount of reward tokens that became eligible for claiming
     */
    function claim() external returns (uint) {
        Recipient storage recipient = recipients[msg.sender];

        _update();

        uint reward = _pendingRewards(msg.sender);
        if (reward == 0) return 0;

        recipient.rewardPerWeightPaid = _rewardPerWeightStored;
        recipient.stash = 0;

        _reserved -= reward;

        _send(reward);
        emit Claimed(msg.sender, reward);

        return reward;
    }

    /**
     * @notice Withdraws `amount` of `token` to message sender
     * @param token Address of the token to withdraw
     * @param amount Amount of token to withdraw
     */
    function recover(IERC20 token, uint amount)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(
            token != rewardToken || unreserved() >= amount,
            "recover: insufficient unlocked supply"
        );
        token.safeTransfer(msg.sender, amount);
        emit Recovered(address(token), amount);
    }

    /**
     * @notice Changes recipient weights
     * @dev It is suggested to use two decimals for weights (e.g.: 100 for 1x)
     * @param accounts The list of addresses to have new weights
     * @param weights The list of weights corresponding to `accounts`
     */
    function setRecipients(address[] calldata accounts, uint[] calldata weights)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        uint length = accounts.length;
        require(length == weights.length, "setRecipients: unequal lengths");

        _update();

        int weightChange;
        for (uint i; i < length; ++i) {
            address account = accounts[i];
            uint weight = weights[i];
            Recipient storage recipient = recipients[account];

            uint oldWeight = recipient.weight;
            require(weight != oldWeight, "setRecipients: same weight");
            weightChange += weight.toInt256() - oldWeight.toInt256();

            // add or remove the recipient to/from the set
            if (oldWeight == 0) {
                _recipients.add(account);
            } else {
                // stash the unclaimed rewards (oldWeight = 0 => pending = 0)
                recipient.stash = _pendingRewards(account);
            }
            if (weight == 0) _recipients.remove(account);

            recipient.rewardPerWeightPaid = _rewardPerWeightStored;
            recipient.weight = weight;

            emit RecipientSet(account, weight);
        }

        totalWeight = (int(totalWeight) + weightChange).toUint256();
        if (totalWeight == 0)
            require(
                block.timestamp > periodFinish,
                "setRecipients: active period"
            );
    }

    /// @notice Gets all the recipient addresses for easy access
    function getAllRecipients() external view returns (address[] memory) {
        return _recipients.values();
    }

    /**
     * @notice Gets the amount of reward tokens yet to be claimed for account
     * @param account Address of the contract to check rewards
     * @return The amount of reward accumulated since the last claimed
     */
    function pendingRewards(address account)
        external
        view
        virtual
        returns (uint)
    {
        Recipient memory recipient = recipients[account];
        return
            recipient.stash +
            ((rewardPerWeight() - recipient.rewardPerWeightPaid) *
                recipient.weight);
    }

    /// @notice Gets the tokens that can be withdrawn or added to rewards
    function unreserved() public view returns (uint) {
        return rewardToken.balanceOf(address(this)) - _reserved;
    }

    /**
     * @notice The total amount of reward tokens emitted per weight
     * @dev Inheriting contract must override this function
     */
    function rewardPerWeight() public view virtual returns (uint);

    /**
     * @notice Send reward (arg1) to msg.sender
     * @dev Inheriting contract must override this function and use the
     * appropriate method (e.g. mint, transfer, transferFrom, etc.)
     */
    function _send(uint) internal virtual;

    /// @notice Updates reward stored whenever rewards are claimed or changed
    function _update() internal virtual {
        _rewardPerWeightStored = rewardPerWeight();
        _lastUpdate = block.timestamp;
    }

    /**
     * @notice Static `pendingRewards()` only called after `_update()`
     * @param account Address of the contract to check rewards
     * @return The amount of reward accumulated since the last claimed
     */
    function _pendingRewards(address account)
        internal
        view
        virtual
        returns (uint)
    {
        Recipient memory recipient = recipients[account];
        return
            recipient.stash +
            ((_rewardPerWeightStored - recipient.rewardPerWeightPaid) *
                recipient.weight);
    }
}
