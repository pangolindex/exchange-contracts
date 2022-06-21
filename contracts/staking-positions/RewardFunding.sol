// SPDX-License-Identifier: GPLv3
pragma solidity 0.8.15;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title Reward Funding
 * @author Shung for Pangolin
 * @notice A contract that is only the rewards part of `StakingRewards`.
 * @dev The inheriting contract must call `_claim()` to check its reward since the last time the
 * same call was made. Then, based on the reward amount, the inheriting contract shall determine
 * the distribution to stakers. The purpose of this architecture is to separate the logic of
 * funding from the staking and the reward distribution.
 */
abstract contract RewardFunding is AccessControl {

    uint128 public rewardRate;
    uint64 public lastUpdate;
    uint64 public periodFinish;

    uint256 public periodDuration = 1 days;
    uint256 private constant MAX_DURATION = type(uint32).max;

    bytes32 private constant FUNDER_ROLE = keccak256("FUNDER_ROLE");
    bytes32 private constant DURATION_ROLE = keccak256("DURATION_ROLE");

    IERC20 public immutable rewardsToken;

    event RewardAdded(uint256 reward);
    event PeriodDurationUpdated(uint256 newDuration);

    error RewardFunding__ZeroAddress();
    error RewardFunding__OngoingPeriod();
    error RewardFunding__FailedTransfer();
    error RewardFunding__InvalidInputAmount(uint256 inputAmount);
    error RewardFunding__InvalidInputDuration(uint256 inputDuration);

    constructor(address newRewardsToken, address newAdmin) {
        if (newRewardsToken == address(0)) {
            revert RewardFunding__ZeroAddress();
        }
        rewardsToken = IERC20(newRewardsToken);
        _grantRole(DEFAULT_ADMIN_ROLE, newAdmin);
        _grantRole(FUNDER_ROLE, newAdmin);
        _grantRole(DURATION_ROLE, newAdmin);
    }

    function setPeriodDuration(uint256 newDuration) external onlyRole(DURATION_ROLE) {
        if (periodFinish > block.timestamp) {
            revert RewardFunding__OngoingPeriod();
        }
        if (newDuration == 0 || newDuration > MAX_DURATION) {
            revert RewardFunding__InvalidInputDuration(newDuration);
        }
        periodDuration = newDuration;
        emit PeriodDurationUpdated(newDuration);
    }

    function addReward(uint256 amount) external onlyRole(FUNDER_ROLE) {
        uint256 tmpPeriodDuration = periodDuration;
        if (amount == 0 || amount > type(uint96).max) {
            revert RewardFunding__InvalidInputAmount(amount);
        }
        if (lastUpdate >= periodFinish) {
            rewardRate = uint128(amount / tmpPeriodDuration);
        } else {
            uint256 leftover = (periodFinish - lastUpdate) * rewardRate;
            rewardRate = uint128((amount + leftover) / tmpPeriodDuration);
        }
        lastUpdate = uint64(block.timestamp);
        periodFinish = uint64(block.timestamp + tmpPeriodDuration);
        if (!rewardsToken.transferFrom(msg.sender, address(this), amount)) {
            revert RewardFunding__FailedTransfer();
        }
        emit RewardAdded(amount);
    }

    function _claim() internal returns (uint256) {
        uint256 reward = _pendingRewards();
        lastUpdate = uint64(block.timestamp);
        return reward;
    }

    function _pendingRewards() internal view returns (uint256) {
        unchecked {
            uint256 tmpPeriodFinish = periodFinish;
            uint256 lastTimeRewardApplicable = tmpPeriodFinish < block.timestamp
                ? tmpPeriodFinish
                : block.timestamp;
            uint256 tmpLastUpdate = lastUpdate;
            uint256 duration = lastTimeRewardApplicable > tmpLastUpdate
                ? lastTimeRewardApplicable - tmpLastUpdate
                : 0;
            return duration * rewardRate;
        }
    }
}
