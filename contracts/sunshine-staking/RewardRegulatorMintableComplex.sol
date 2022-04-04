/*
 * SPDX-License-Identifier: GPLv3
 * solhint-disable not-rely-on-time
 *
 * Complex/Scheduled Mintable Reward Regulator
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

import "./RewardRegulator.sol";

interface IERC20MintableComplex {
    function mint(address to, uint amount) external;

    function cap() external view returns (uint);

    /**
     / @dev Note that OpenZeppelin's burnable extension does not keep track of
     / the burned supply, therefore burned supply tracking and a view function
     / for the burned supply should be implemented to the reward token contract
     / for this Reward Regulator to work.
     */
    function burnedSupply() external view returns (uint);
}

/**
 * @title Complex Mintable Reward Regulator
 * @notice A StakingRewards replacement that distributes to multiple contracts
 * @dev This contract directly mints from the reward token contract. It
 * determines the reward rate based on a simple algorithm defined in the
 * _getReward() function. This is a special schedule algorithm that takes
 * burned supply, and hardcap of the token into the account. It also assumes to
 * be the only contract with minting access (i.e. the reward token can only be
 * minted by this contract).
 * @author shung for Pangolin
 */
contract RewardRegulatorMintableComplex is RewardRegulator {

    /// @notice The core variable that determines the reward rate
    uint public halfSupply = 200 days;

    /// @notice The time when the reward rate can be changed
    uint public halfSupplyCooldownFinish;

    /// @notice The amount the half supply can be decreased at each call
    uint public constant HALF_SUPPLY_MAX_DECREASE = 20 days;

    /// @notice The minimum duration between changing half supply
    uint public constant COOLDOWN = 2 days;

    /// @notice The minimum value half supply can have
    uint public constant MIN_HALF_SUPPLY = 10 days;

    /**
     * @notice The hardcap of the reward token
     * @dev This amount excludes totalSupply that already existed during the
     * creation of this contract
     */
    uint private immutable _cap;

    /// @notice The burned supply of the reward token at deployment
    uint private immutable _initialBurnedSupply;

    /**
     * @notice The amount of reward tokens emitted by this contract
     * @dev This amount includes both the minted and stashed tokens
     */
    uint private _totalEmitted;

    event HalfSupplySet(uint newHalfSupply);

    /**
     * @notice Construct a new RewardRegulator Simple Mintable contract
     * @dev This contract allows priveleged users to manually set reward rate
     * @param newRewardToken The reward token the contract will distribute
     */
    constructor(address newRewardToken) RewardRegulator(newRewardToken) {
        periodFinish = type(uint).max;
        // record tokens that can be minted by this contract. algorithm will
        // assume `_cap` amount of tokens are solely in the discretion of this
        // contract to mint, not other contract can mint from the reward token
        _cap =
            IERC20MintableComplex(newRewardToken).cap() -
            IERC20(newRewardToken).totalSupply();
        _initialBurnedSupply = IERC20MintableComplex(newRewardToken)
            .burnedSupply();
    }

    function beginSchedule() external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(totalWeight != 0, "beginSchedule: no recipients set");
        _lastUpdate = block.timestamp;
    }

    function setHalfSupply(uint newHalfSupply)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (newHalfSupply < halfSupply) {
            unchecked {
                require(
                    halfSupply - newHalfSupply <= HALF_SUPPLY_MAX_DECREASE,
                    "setHalfSupply: cannot lower by that much"
                );
            }
        }
        require(
            newHalfSupply != halfSupply,
            "setHalfSupply: new half supply is the same"
        );
        require(
            newHalfSupply >= MIN_HALF_SUPPLY,
            "setHalfSupply: new half supply is too low"
        );
        require(
            block.timestamp >= halfSupplyCooldownFinish,
            "setHalfSupply: cannot update that often"
        );
        _update();
        halfSupplyCooldownFinish = block.timestamp + COOLDOWN;
        halfSupply = newHalfSupply;
        emit HalfSupplySet(newHalfSupply);
    }

    /// @notice The total amount of reward tokens emitted per weight
    function rewardPerWeight() public view override returns (uint) {
        if (totalWeight == 0) return _rewardPerWeightStored;
        return _rewardPerWeightStored + _getReward() / totalWeight;
    }

    function _send(uint reward) internal override {
        IERC20MintableComplex(address(rewardToken)).mint(msg.sender, reward);
    }

    function _update() internal override {
        uint reward = _getReward();
        _totalEmitted += reward;
        _rewardPerWeightStored += (reward / totalWeight);
        _lastUpdate = block.timestamp;
    }

    /// @dev Gets the rewards for the current interval
    function _getReward() private view returns (uint) {
        require(_lastUpdate != 0, "_getReward: schedule not started");
        uint interval = block.timestamp - _lastUpdate;
        uint burned = IERC20MintableComplex(address(rewardToken))
            .burnedSupply() - _initialBurnedSupply;
        uint reward = (interval * (_cap + burned - _totalEmitted)) /
            (halfSupply + interval);
        return reward;
    }
}
