/*
 * SPDX-License-Identifier: GPLv3
 * solhint-disable not-rely-on-time
 *
 * Sunshine and Rainbows: Liquidity Pool Token Compound for WETH
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

import "./SunshineAndRainbowsCompoundLP.sol";

import "../pangolin-periphery/interfaces/IWAVAX.sol";

/**
 * @title Sunshine and Rainbows Extension: LP Stake Compound
 * @notice An extension to `SunshineAndRainbows` that implements locked-stake
 * harvesting feature when the staking tokens is a pool token, the reward token
 * is one of the tokens in the LP pair, and the paired tokens is WAVAX/WETH
 * @author shung for Pangolin
 */
contract SunshineAndRainbowsCompoundLPAVAX is SunshineAndRainbowsCompoundLP {
    using SafeCast for int;
    using SafeERC20 for IERC20;

    /**
     * @notice Constructs a new SunshineAndRainbows staking contract with
     * locked-stake harvesting feature
     * @param newStakingToken Contract address of the staking token
     * @param newRewardRegulator Contract address of the reward regulator which
     * distributes reward tokens
     * @param newRouter Address of the router that will be used to deposit
     */
    constructor(
        address newStakingToken,
        address newRewardRegulator,
        address newRouter
    )
        SunshineAndRainbowsCompoundLP(
            newStakingToken,
            newRewardRegulator,
            newRouter
        )
    {
        require(
            address(_pairToken) == IPangolinRouter(newRouter).WAVAX(),
            "SAR::Constructor: pair token not wavax"
        );
    }

    /**
     * @notice Reinvests rewards by pairing it with AVAX (or ETH)
     * @dev This method does not reset reward rate as the rewards never leave
     * the contract. However, equivalent AVAX to the reward amount must be
     * provided for adding liquidity & staking that. The newly staked tokens
     * then start with a zero reward rate, without resetting the reward rate of
     * the existing balance.
     */
    function compoundAVAX() external payable {
        _updateRewardVariables();

        // Harvest pending rewards, and record it as debt (negative value). We
        // record it as debt because we're not updating user variabless that
        // govern the reward rate for the user.
        int reward = _earned();
        users[msg.sender].stash -= reward;
        emit Harvested(msg.sender, reward.toUint256());

        // provide liquidity and get LP amount
        uint amount = _addLiquidityAVAX(reward.toUint256());

        // stake LP amount back into the user's deposit
        _stake(amount, address(this));
    }

    /**
     * @notice Adds liquidity with the harvested reward & supplied pair
     * @param reward The amount of reward tokens harvested
     */
    function _addLiquidityAVAX(uint reward) private returns (uint) {
        require(reward != 0, "SAR::_addLiquidityAVAX: no reward");
        IPangolinPair pair = IPangolinPair(address(stakingToken));
        (uint reserve0, uint reserve1, ) = pair.getReserves();
        require(
            reserve0 > 1000 && reserve1 > 1000,
            "SAR::_addLiquidityAVAX: low reserves"
        );

        uint pairAmount = _rewardTokenIs0
            ? (reward * reserve1) / reserve0
            : (reward * reserve0) / reserve1;

        if (msg.value > pairAmount) {
            unchecked {
                payable(msg.sender).transfer(msg.value - pairAmount);
            }
        } else if (msg.value < pairAmount) {
            revert("SAR::_addLiquidityAVAX: high slippage");
        }

        IWAVAX(address(_pairToken)).deposit{ value: pairAmount }();

        (, , uint amount) = router.addLiquidity(
            address(rewardToken), // tokenA
            address(_pairToken), // tokenB
            reward, // amountADesired
            pairAmount, // amountBDesired
            1, // amountAMin
            1, // amountBMin
            address(this), // to
            block.timestamp // deadline
        );

        return amount;
    }
}
