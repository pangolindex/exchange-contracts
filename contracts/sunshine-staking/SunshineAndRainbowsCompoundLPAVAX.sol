// SPDX-License-Identifier: GPLv3
// solhint-disable not-rely-on-time
pragma solidity ^0.8.0;

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
     * @notice Creates a new position with the rewards of the given position
     * @dev New position is considered locked, and it cannot be withdrawn until
     * the parent position is updated after the creation of the new position.
     * The new position also requires equal amount of pair token to the reward
     * amount
     * @param posId ID of the parent position whose rewards are harvested
     */
    function compoundAVAX(uint posId) external payable nonReentrant {
        // update the state variables that govern the reward distribution
        _updateRewardVariables();

        // create a new position
        uint childPosId = positions.length;

        // record parent-child relation to lock the child position
        children[childPosId] = Child(posId, block.timestamp);

        // harvest parent position and add liquidity with that
        uint amount = _addLiquidityAVAX(_harvestWithDebt(posId));

        // stake parent position rewards to child position
        _open(amount, address(this));

        emit Compounded(posId, childPosId, amount);
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
                require(payable(msg.sender).send(msg.value - pairAmount));
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
