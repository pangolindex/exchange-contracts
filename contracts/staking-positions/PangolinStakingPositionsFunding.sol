// SPDX-License-Identifier: GPLv3
pragma solidity 0.8.15;

import "@openzeppelin/contracts/access/AccessControlEnumerable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./GenericErrors.sol";

/**
 * @title Pangolin Staking Positions Funding
 * @author Shung for Pangolin
 * @notice A contract that is only the rewards part of `StakingRewards`.
 * @dev The inheriting contract must call `_claim()` to check its reward since the last time the
 * same call was made. Then, based on the reward amount, the inheriting contract shall determine
 * the distribution to stakers. The purpose of this architecture is to separate the logic of
 * funding from the staking and reward distribution.
 */
abstract contract PangolinStakingPositionsFunding is AccessControlEnumerable, GenericErrors {
    /** @notice The rewards given out per second during a reward period. */
    uint80 public rewardRate;

    /** @notice The timestamp when the last time the rewards were claimed by the child contract. */
    uint40 public lastUpdate;

    /** @notice The timestamp when the current period will end or the latest period has ended. */
    uint40 public periodFinish;

    /** @notice The amount of total rewards added. */
    uint96 public totalRewardAdded;

    /** @notice The duration for how long the rewards will last after `addReward` is called. */
    uint256 public periodDuration = 14 days;

    /** @notice The minimum duration a period can last. */
    uint256 private constant MIN_PERIOD_DURATION = 2**16 + 1;

    /** @notice The maximum duration a period can last. */
    uint256 private constant MAX_PERIOD_DURATION = 2**32;

    /** @notice The maximum amount of rewards that can ever be distributed. */
    uint256 private constant MAX_TOTAL_REWARD = type(uint96).max;

    /** @notice The privileged role that can call `addReward` function */
    bytes32 private constant FUNDER_ROLE = keccak256("FUNDER_ROLE");

    /** @notice The reward token that is distributed to stakers. */
    IERC20 public immutable rewardsToken;

    /** @notice The event emitted when a period is manually cut short. */
    event PeriodEnded();

    /** @notice The event emitted when a period is started or extended through funding. */
    event RewardAdded(uint256 reward);

    /** @notice The event emitted when the period duration is changed. */
    event PeriodDurationUpdated(uint256 newDuration);

    /**
     * @notice Constructor to create PangolinStakingPositionsFunding contract.
     * @param newRewardsToken The token used for both for staking and reward.
     * @param newAdmin The initial owner of the contract.
     */
    constructor(address newRewardsToken, address newAdmin) {
        if (newAdmin == address(0)) revert NullInput();
        if (newRewardsToken.code.length == 0) revert InvalidToken();

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
        if (periodFinish > block.timestamp) revert TooEarly();

        // Ensure the new period is within the bounds.
        if (newDuration < MIN_PERIOD_DURATION) revert OutOfBounds();
        if (newDuration > MAX_PERIOD_DURATION) revert OutOfBounds();

        // Assign the new duration to the state variable, and emit the associated event.
        periodDuration = newDuration;
        emit PeriodDurationUpdated(newDuration);
    }

    /** @notice External restricted function to end the period and withdraw leftover rewards. */
    function endPeriod() external onlyRole(DEFAULT_ADMIN_ROLE) {
        // Ensure period has not already ended.
        if (block.timestamp >= periodFinish) revert TooLate();

        unchecked {
            // Get the rewards remaining to be distributed.
            uint256 leftover = (periodFinish - block.timestamp) * rewardRate;

            // Decrement totalRewardAdded by the amount to be withdrawn.
            totalRewardAdded -= uint96(leftover);

            // Update periodFinish.
            periodFinish = uint40(block.timestamp);

            // Transfer leftover tokens from the contract to the caller.
            _transferToCaller(leftover);
            emit PeriodEnded();
        }
    }

    /**
     * @notice External restricted function to fund the contract.
     * @param amount The amount of reward tokens to add to the contract.
     */
    function addReward(uint256 amount) external onlyRole(FUNDER_ROLE) {
        // For efficiency, move periodDuration to memory.
        uint256 tmpPeriodDuration = periodDuration;

        // Ensure amount fits 96 bits.
        if (amount > MAX_TOTAL_REWARD) revert Overflow();

        // Increment totalRewardAdded, reverting on overflow to ensure it fits 96 bits.
        totalRewardAdded += uint96(amount);

        // Update the rewardRate, ensuring leftover rewards from the ongoing period are included.
        // Note that we are using `lastUpdate` instead of `block.timestamp`, otherwise we would
        // have to “stash” the rewards from `lastUpdate` to `block.timestamp` in storage. We
        // do not want to stash the rewards to keep the cost low. However, using this method means
        // that `_pendingRewards()` will change, hence a user might “lose” rewards earned since
        // `lastUpdate`. It is not a very big deal as the `lastUpdate` is likely to be updated
        // frequently, but just something to acknowledge.
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
        if (tmpRewardRate == 0) revert NoEffect();

        // Assign the tmpRewardRate back to storage.
        // MAX_TOTAL_REWARD / MIN_PERIOD_DURATION fits 80 bits.
        rewardRate = uint80(tmpRewardRate);

        // Update lastUpdate and periodFinish.
        lastUpdate = uint40(block.timestamp);
        periodFinish = uint40(block.timestamp + tmpPeriodDuration);

        // Transfer reward tokens from the caller to the contract.
        _transferFromCaller(amount);
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
     * @notice Internal function to transfer `rewardsToken` from the contract to caller.
     * @param amount The amount of tokens to transfer.
     */
    function _transferToCaller(uint256 amount) internal {
        if (!rewardsToken.transfer(msg.sender, amount)) revert FailedTransfer();
    }

    /**
     * @notice Internal function to transfer `rewardsToken` from caller to the contract.
     * @param amount The amount of tokens to transfer.
     */
    function _transferFromCaller(uint256 amount) internal {
        if (!rewardsToken.transferFrom(msg.sender, address(this), amount)) revert FailedTransfer();
    }

    /**
     * @notice Internal view function to get the amount of accumulated reward tokens since last
     * update time.
     * @return The amount of reward tokens that has been accumulated since last update time.
     */
    function _pendingRewards() internal view returns (uint256) {
        // For efficiency, move periodFinish timestamp to memory.
        uint256 tmpPeriodFinish = periodFinish;

        // Get end of the reward distribution period or block timestamp, whichever is less.
        // `lastTimeRewardApplicable` is the ending timestamp of the period we are calculating
        // the total rewards for.
        uint256 lastTimeRewardApplicable = tmpPeriodFinish < block.timestamp
            ? tmpPeriodFinish
            : block.timestamp;

        // For efficiency, move lastUpdate timestamp to memory. `lastUpdate` is the beginning
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
