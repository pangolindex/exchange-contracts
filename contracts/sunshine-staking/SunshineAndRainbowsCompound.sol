// SPDX-License-Identifier: UNLICENSED
// solhint-disable not-rely-on-time
pragma solidity ^0.8.0;

import "./SunshineAndRainbows.sol";

/// @notice Can be used when staking token is same as reward token
contract SunshineAndRainbowsCompound is SunshineAndRainbows {
    using SafeERC20 for IERC20;

    struct Child {
        uint parent;
        uint initTime;
    }

    /// @notice Child position ID => Its properties
    mapping(uint => Child) public children;

    constructor(
        address _stakingToken,
        address _rewardRegulator
    ) SunshineAndRainbows(_stakingToken, _rewardRegulator) {}

    /// @dev special harvest method that does not reset APR
    function compound(uint posId, address to)
        external
        virtual
        nonReentrant
        whenNotPaused
    {
        _updateRewardVariables();

        // Harvest & Stake
        uint childPosId = _createPosition(to);
        _stake(childPosId, _lockedHarvest(posId), address(this));

        // record parent-child relation
        Child storage child = children[childPosId];
        child.parent = posId;
        child.initTime = block.timestamp;
    }

    function _withdraw(uint amount, uint posId) internal override {
        // do not allow withdrawal if parent position was not
        // reset at least once after creation of child position
        Child memory child = children[posId];
        if (child.parent != 0) {
            require(
                child.initTime < positions[child.parent].lastUpdate,
                "SARS::_withdraw: parent position not updated"
            );
        }
        super._withdraw(amount, posId);
    }

    function _lockedHarvest(uint posId) private returns (uint) {
        Position storage position = positions[posId];
        require(position.owner == msg.sender, "SARS::_harvest: unauthorized");
        int reward = _earned(posId, _idealPosition, _rewardsPerStakingDuration);
        assert(reward >= 0);
        if (reward != 0) {
            positions[posId].reward = -reward;
            rewardRegulator.mint(address(this), uint(reward));
            emit Harvest(posId, uint(reward));
        }
        return uint(reward);
    }
}
