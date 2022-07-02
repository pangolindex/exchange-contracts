// SPDX-License-Identifier: GPLv3
pragma solidity 0.8.15;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title Pangolin Staking Positions Funding
 * @author Shung for Pangolin
 * @notice A contract that is only the rewards part of `StakingRewards`.
 * @dev The inheriting contract must call `_claim()` to check its reward since the last time the
 * same call was made. Then, based on the reward amount, the inheriting contract shall determine
 * the distribution to stakers. The purpose of this architecture is to separate the logic of
 * funding from the staking and reward distribution.
 */
abstract contract PangolinStakingPositionsFunding is AccessControl {
    uint80 public rewardRate;
    uint40 public lastUpdate;
    uint40 public periodFinish;
    uint96 public totalRewardAdded;

    uint256 public periodDuration = 1 days;

    uint256 private constant MIN_PERIOD_DURATION = uint256(type(uint16).max) + 1;
    uint256 private constant MAX_PERIOD_DURATION = type(uint32).max;
    uint256 private constant MAX_TOTAL_REWARD = type(uint96).max;

    bytes32 private constant FUNDER_ROLE = keccak256("FUNDER_ROLE");

    IERC20 public immutable rewardsToken;

    event RewardAdded(uint256 reward);
    event PeriodDurationUpdated(uint256 newDuration);

    error RewardFunding__OngoingPeriod();
    error RewardFunding__FailedTransfer();
    error RewardFunding__RewardRateTruncatedToZero();
    error RewardFunding__InvalidInputAmount(uint256 inputAmount);
    error RewardFunding__InvalidInputDuration(uint256 inputDuration);

    /**
     * @notice Constructor to create PangolinStakingPositionsFunding contract.
     * @param newRewardsToken The token used for both for staking and reward.
     * @param newAdmin The initial owner of the contract.
     */
    constructor(address newRewardsToken, address newAdmin) {
        rewardsToken = IERC20(newRewardsToken);
        _grantRole(DEFAULT_ADMIN_ROLE, newAdmin);
        _grantRole(FUNDER_ROLE, newAdmin);
    }

    /**
     * @notice External restricted function to change the reward period duration.
     * @param newDuration The duration the feature periods will last.
     */
    function setPeriodDuration(uint256 newDuration) external onlyRole(DEFAULT_ADMIN_ROLE) {
        // Ensure there is no ongoing period.
        if (periodFinish > block.timestamp) {
            revert RewardFunding__OngoingPeriod();
        }

        // Ensure the new period is within the bounds.
        if (newDuration < MIN_PERIOD_DURATION || newDuration > MAX_PERIOD_DURATION) {
            revert RewardFunding__InvalidInputDuration(newDuration);
        }

        // Assign the new duration to the state variable, and emit the associated event.
        periodDuration = newDuration;
        emit PeriodDurationUpdated(newDuration);
    }

    /**
     * @notice External restricted function to fund the contract.
     * @param amount The amount of reward tokens to add to the contract.
     */
    function addReward(uint256 amount) external onlyRole(FUNDER_ROLE) {
        // For efficiency, stash the periodDuration in memory.
        uint256 tmpPeriodDuration = periodDuration;

        // Ensure amount fits 96 bits.
        if (amount > MAX_TOTAL_REWARD) {
            revert RewardFunding__InvalidInputAmount(amount);
        }

        // Increment totalRewardAdded, reverting on overflow to ensure it fits 96 bits.
        totalRewardAdded += uint96(amount);

        // Update the rewardRate, ensuring leftover rewards from the ongoing period are included.
        uint256 tmpRewardRate;
        if (lastUpdate >= periodFinish) {
            tmpRewardRate = amount / tmpPeriodDuration;
        } else {
            unchecked {
                uint256 leftover = (periodFinish - lastUpdate) * rewardRate;
                tmpRewardRate = (amount + leftover) / tmpPeriodDuration;
            }
        }

        // Ensure sufficient amount is supplied hence reward rate is non-zero.
        if (tmpRewardRate == 0) {
            revert RewardFunding__RewardRateTruncatedToZero();
        }

        // Assign the tmpRewardRate back to storage.
        // MAX_TOTAL_REWARD / MIN_PERIOD_DURATION fits 80 bits.
        rewardRate = uint80(tmpRewardRate);

        // Update lastUpdate and periodFinish.
        lastUpdate = uint40(block.timestamp);
        periodFinish = uint40(block.timestamp + tmpPeriodDuration);

        // Transfer reward tokens from the caller to the contract.
        if (!rewardsToken.transferFrom(msg.sender, address(this), amount)) {
            revert RewardFunding__FailedTransfer();
        }
        emit RewardAdded(amount);
    }

    /**
     * @notice Internal function to get the amount of reward tokens to distribute since last call
     * to this function.
     * @return reward The amount of reward tokens that is marked for distribution.
     */
    function _claim() internal returns (uint256 reward) {
        // Get the pending reward amount since last update was last updated.
        reward = _pendingRewards();

        // Update last update time.
        lastUpdate = uint40(block.timestamp);
    }

    /**
     * @notice Internal view function to get the amount of accumulated reward tokens since last
     * update time.
     * @return The amount of reward tokens that has been accumulated since last update time.
     */
    function _pendingRewards() internal view returns (uint256) {
        // For efficiency, stash periodFinish timestamp in memory.
        uint256 tmpPeriodFinish = periodFinish;

        // Get end of the reward distribution period or block timestamp, whichever is less.
        // `lastTimeRewardApplicable` is the ending timestamp of the period we are calculating
        // the total rewards for.
        uint256 lastTimeRewardApplicable = tmpPeriodFinish < block.timestamp
            ? tmpPeriodFinish
            : block.timestamp;

        // For efficiency, stash lastUpdate timestamp in memory. `lastUpdate` is the beginning
        // timestamp of the period we are calculating the total rewards for.
        uint256 tmpLastUpdate = lastUpdate;

        // If the reward period is a positive range, return the rewards by multiplying the duration
        // by reward rate.
        if (lastTimeRewardApplicable > tmpLastUpdate) {
            unchecked {
                return (lastTimeRewardApplicable - tmpLastUpdate) * rewardRate;
            }
        }

        // If the reward period is an invalid or a null range, return zero.
        return 0;
    }
}
