// SPDX-License-Identifier: MIT
// solhint-disable not-rely-on-time
pragma solidity ^0.8.0;

import "./SunshineAndRainbows.sol";

/**
 * @title Sunshine and Rainbows Extension: Single Stake Compound
 * @notice An extension to `SunshineAndRainbows` that implements locked-stake
 * harvesting feature when the reward and staking tokens are the same
 * @author shung for Pangolin
 */
contract SunshineAndRainbowsCompound is SunshineAndRainbows {
    struct Child {
        uint parent; // ID of the parent position
        uint initTime; // timestamp of the creation of the child position
    }

    /// @notice A mapping of child positions' IDs to their properties
    mapping(uint => Child) public children;

    /// @notice A mapping of position to its reward debt
    mapping(uint => uint) private _debts;

    /// @notice Emitted when rewards from a position creatas another position
    event Compounded(uint parentPosId, uint childPosId, uint amount);

    /**
     * @notice Constructs a new SunshineAndRainbows staking contract with
     * locked-stake harvesting feature
     * @param newStakingToken Contract address of the staking token
     * @param newRewardRegulator Contract address of the reward regulator which
     * distributes reward tokens
     */
    constructor(address newStakingToken, address newRewardRegulator)
        SunshineAndRainbows(newStakingToken, newRewardRegulator)
    {
        require(
            newStakingToken ==
                address(IRewardRegulator(newRewardRegulator).rewardToken()),
            "SAR::Constructor: staking token is different than reward token"
        );
    }

    /**
     * @notice Creates a new position with the rewards of the given position
     * @dev New position is considered locked, and it cannot be withdrawn until
     * the parent position is updated after the creation of the new position
     * @param posId ID of the parent position whose rewards are harvested
     */
    function compound(uint posId) external nonReentrant {
        // update the state variables that govern the reward distribution
        _updateRewardVariables();

        // create a new position
        uint childPosId = positions.length;

        // record parent-child relation to lock the child position
        children[childPosId] = Child(posId, block.timestamp);

        // harvest parent position
        uint amount = _harvestWithDebt(posId);

        // stake parent position rewards to child position
        _open(amount, address(this));

        emit Compounded(posId, childPosId, amount);
    }

    /**
     * @dev Prepends to the over-ridden `_close` function a special rule
     * that disables withdrawal until the parent position is closed
     */
    function _close(uint posId) internal override {
        Child memory child = children[posId];
        if (child.initTime != 0)
            require(
                child.initTime < positions[child.parent].lastUpdate,
                "SAR::_withdraw: parent position not updated"
            );
        super._close(posId);
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
    function _withdraw(uint posId, uint amount) internal override {
        uint balance = positions[posId].balance;

        // update debt before & after withdrawal:
        // The debt calculated in `harvestWithDebt()` considers the whole
        // balance. In `_withdraw()`, we're only harvesting rewards for a
        // portion of the position's balance. So we do this little hack to make
        // `_earned()` subtract only the debt of the harvested portion.
        uint remainingDebt = (_debts[posId] * (balance - amount)) / balance;
        _debts[posId] -= remainingDebt;
        super._withdraw(posId, amount);
        _debts[posId] = remainingDebt;
    }

    /**
     * @dev Subtracts debts from the over-ridden `_earned` function.
     * Debts are accrued when harvesting without updating the position.
     * `pendingRewards()` will not be effected by this override. Therefore any
     * user interface must subtract debt from pendingRewards.
     */
    function _earned(uint posId) internal view override returns (uint) {
        uint earned = super._earned(posId);
        return earned - _debts[posId];
    }

    /**
     * @notice Harvests without update and records reward as debt
     * @dev Special harvest method that does not update the position,
     * therefore records 'earned' as debt.
     * @param posId ID of the position to harvest rewards from
     * @return The reward amount
     */
    function _harvestWithDebt(uint posId) private returns (uint) {
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
}
