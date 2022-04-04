// SPDX-License-Identifier: GPLv3
// solhint-disable not-rely-on-time
pragma solidity ^0.8.0;

import "./RewardRegulator.sol";

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

/**
 * @title Fundable Reward Regulator
 * @notice A StakingRewards replacement that distributes to multiple contracts
 * @dev This contract is a drop-in replacement for Synthetix' StakingRewards.
 * @author shung for Pangolin
 */
contract RewardRegulatorFundable is RewardRegulator {
    using SafeERC20 for IERC20;
    using SafeMath for uint;

    /// @notice The role for calling `notifyRewardAmount` function
    bytes32 private constant FUNDER = keccak256("FUNDER");

    /// @notice The duration of staking after `notifyRewardAmount` is called
    uint public rewardsDuration = 1 days;

    /// @notice Rewards emitted per second
    uint public rewardRate;

    event RewardAdded(uint reward);
    event RewardsDurationUpdated(uint newDuration);

    /**
     * @notice Construct a new RewardRegulatorFundable contract
     * @param newRewardToken The reward token the contract will distribute
     */
    constructor(address newRewardToken) RewardRegulator(newRewardToken) {}

    /**
     * @notice Changes how long the distribution will last for
     * @param newRewardsDuration The length of the nex distribution
     */
    function setRewardsDuration(uint newRewardsDuration)
        external
        onlyRole(FUNDER)
    {
        require(
            block.timestamp > periodFinish,
            "setRewardsDuration: ongoing period"
        );
        require(newRewardsDuration != 0, "setRewardsDuration: short duration");
        rewardsDuration = newRewardsDuration;
        emit RewardsDurationUpdated(rewardsDuration);
    }

    /**
     * @notice Starts or extends a period by adding rewards
     * @dev Requires that enough tokens are transferred beforehand
     * @param reward The added amount of rewards
     */
    function notifyRewardAmount(uint reward) external onlyRole(FUNDER) {
        require(totalWeight != 0, "notifyRewardAmount: no recipients");
        require(reward != 0, "notifyRewardAmount: zero reward");
        require(
            unreserved() >= reward,
            "notifyRewardAmount: insufficient balance for reward"
        );

        update();

        // Set new reward rate after setting _rewardPerWeightStored
        if (block.timestamp >= periodFinish) {
            rewardRate = reward / rewardsDuration;
        } else {
            uint leftover = (periodFinish - block.timestamp) * rewardRate;
            rewardRate = (reward + leftover) / rewardsDuration;
        }

        // update the end of this period after setting reward rate
        periodFinish = block.timestamp + rewardsDuration;

        _reserved += reward;
        emit RewardAdded(reward);
    }

    /// @notice The total amount of reward tokens emitted until the call
    function rewardPerWeight() public view override returns (uint) {
        if (totalWeight == 0) return _rewardPerWeightStored;
        (, uint duration) = lastTimeRewardApplicable().trySub(_lastUpdate);
        return _rewardPerWeightStored + (duration * rewardRate) / totalWeight;
    }

    /// @notice The time of last emission (now or end of last emission period)
    function lastTimeRewardApplicable() public view returns (uint) {
        return Math.min(block.timestamp, periodFinish);
    }

    function _send(uint reward) internal override {
        rewardToken.safeTransfer(msg.sender, reward);
    }
}
