// SPDX-License-Identifier: GPLv3
// solhint-disable not-rely-on-time
pragma solidity 0.8.13;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title Reward Funding
 * @author Shung for Pangolin
 * @notice A contract that is only the rewards part of `StakingRewards`.
 * @dev The inheriting contract must call `_claim()` to check its reward since the last time the
 * same call was made. Then, based on the reward amount, the inheriting contract shall determine
 * the distribution to stakers. The purpose of this model is to separate the logic of funding from
 * the staking and the reward distribution.
 * @dev The inheriting contract must use `_sendRewardsToken()` and `_receiveRewardsToken()`
 * whenever transferring the `rewardsToken` to not mess the `reserved` amount. Failure to do so
 * might cause the balance check in `notifyRewardAmount()` to incorrectly pass.
 */
abstract contract RewardFunding is AccessControl {
    using SafeCast for uint256;
    using SafeERC20 for IERC20;

    uint80 public rewardRate;
    uint40 public lastUpdate;
    uint40 public periodFinish;
    uint96 public reserved;

    uint256 public periodDuration = 1 days;
    uint256 private constant MAX_DURATION = type(uint32).max;
    uint256 private constant MIN_DURATION = type(uint16).max + 1;

    bytes32 private constant FUNDER_ROLE = keccak256("FUNDER_ROLE");
    bytes32 private constant DURATION_ROLE = keccak256("DURATION_ROLE");

    IERC20 public immutable rewardsToken;

    event RewardAdded(uint256 reward);
    event PeriodDurationUpdated(uint256 newDuration);

    error RewardFunding__ZeroAddress();
    error RewardFunding__OngoingPeriod();
    error RewardFunding__InvalidInputAmount(uint256 inputAmount);
    error RewardFunding__InvalidInputDuration(uint256 inputDuration);

    constructor(address newRewardsToken, address newAdmin) {
        if (newRewardsToken == address(0)) revert RewardFunding__ZeroAddress();
        rewardsToken = IERC20(newRewardsToken);
        _grantRole(DEFAULT_ADMIN_ROLE, newAdmin);
        _grantRole(FUNDER_ROLE, newAdmin);
        _grantRole(DURATION_ROLE, newAdmin);
    }

    function setPeriodDuration(uint256 newDuration) external onlyRole(DURATION_ROLE) {
        if (periodFinish > block.timestamp) revert RewardFunding__OngoingPeriod();
        if (newDuration < MIN_DURATION || newDuration > MAX_DURATION) {
            revert RewardFunding__InvalidInputDuration(newDuration);
        }
        periodDuration = newDuration;
        emit PeriodDurationUpdated(newDuration);
    }

    function notifyRewardAmount(uint256 amount) external onlyRole(FUNDER_ROLE) {
        if (amount == 0 || amount > unreserved()) revert RewardFunding__InvalidInputAmount(amount);
        reserved += amount.toUint96(); // ensures amount fits 96 bits
        uint256 tmpPeriodDuration = periodDuration;
        if (lastUpdate >= periodFinish) {
            rewardRate = uint80(amount / tmpPeriodDuration);
        } else {
            uint256 leftover;
            unchecked {
                leftover = (periodFinish - lastUpdate) * rewardRate;
            }
            rewardRate = uint80((amount + leftover) / tmpPeriodDuration);
        }
        lastUpdate = uint40(block.timestamp);
        periodFinish = uint40(block.timestamp + tmpPeriodDuration);
        emit RewardAdded(amount);
    }

    function unreserved() public view returns (uint256) {
        return rewardsToken.balanceOf(address(this)) - reserved;
    }

    function _claim() internal returns (uint256) {
        uint256 reward = _pendingRewards();
        lastUpdate = uint40(block.timestamp);
        return reward;
    }

    function _sendRewardsToken(address to, uint256 amount) internal {
        reserved -= amount.toUint96();
        rewardsToken.safeTransfer(to, amount);
    }

    function _receiveRewardsToken(address from, uint256 amount) internal {
        reserved += amount.toUint96();
        rewardsToken.safeTransferFrom(from, address(this), amount);
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
