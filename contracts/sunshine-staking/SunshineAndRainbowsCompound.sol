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
    /**
     * @notice A custom type that defines the properties of child positions
     */
    struct Child {
        uint parent; // ID of the parent position
        uint initTime; // timestamp of the creation of the child position
    }

    /**
     *  @notice A mapping of child positions’ IDs to their properties
     */
    mapping(uint => Child) public children;

    /**
     * @notice Constructs a new SunshineAndRainbows staking contract with
     * locked-stake harvesting feature
     * @param _stakingToken Contract address of the staking token
     * @param _rewardRegulator Contract address of the reward regulator which
     * distributes reward tokens
     */
    constructor(
        address _stakingToken,
        address _rewardRegulator
    ) SunshineAndRainbows(_stakingToken, _rewardRegulator) {
        require(
            _stakingToken == address(rewardRegulator.rewardToken()),
            "SAR::Constructor: staking token is different than reward token"
        );
    }

    /**
     * @notice Creates a new position with the rewards of another position
     * @dev New position is considered locked, and it cannot be withdrawn until
     * the parent position is updated after the creation of the new position
     * @param posId ID of the parent position whose rewards are harvested
     * @param to Address of the recipient of the new position
     */
    function compound(uint posId, address to)
        external
        virtual
        nonReentrant
        whenNotPaused
    {
        // update the state variables that govern the reward distribution
        _updateRewardVariables();

        // create a new position
        uint childPosId = _createPosition(to);

        // harvest parent position and stake its rewards to child position
        _stake(childPosId, _lockedHarvest(posId), address(this));

        // record parent-child relation to lock the child position
        Child storage child = children[childPosId];
        child.parent = posId;
        child.initTime = block.timestamp;
    }

    /**
     * @dev Prepend to the over-ridden `_withdraw` function a special rule that
     * disables withdrawal if the parent position was not updated at least once
     * after the creation of the child position
     */
    function _withdraw(uint amount, uint posId) internal override {
        Child memory child = children[posId];
        if (child.parent != 0) {
            require(
                child.initTime < positions[child.parent].lastUpdate,
                "SAR::_withdraw: parent position not updated"
            );
        }
        super._withdraw(amount, posId);
    }

    /**
     * @dev An analogue to `_harvest` function of the inherited contract, that is
     * used to harvest from a position without resetting its reward rate
     */
    function _lockedHarvest(uint posId) private returns (uint) {
        Position storage position = positions[posId];
        require(position.owner == msg.sender, "SAR::_harvest: unauthorized");
        int reward = _earned(posId, _idealPosition, _rewardsPerStakingDuration);
        assert(reward >= 0);
        if (reward != 0) {
            // since the position is not updated, `_earned()` will not reset,
            // so we must decrease its rewards
            position.reward -= reward;
            rewardRegulator.mint(address(this), uint(reward));
            emit Harvest(posId, uint(reward));
        }
        return uint(reward);
    }
}
