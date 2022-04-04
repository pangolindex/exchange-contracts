// SPDX-License-Identifier: GPLv3
// solhint-disable not-rely-on-time
pragma solidity ^0.8.0;

import "./RewardRegulator.sol";

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

interface IERC20Mintable {
    function mint(address to, uint amount) external;
}

/**
 * @title Mintable Reward Regulator
 * @notice A StakingRewards replacement that distributes to multiple contracts
 * @dev This contract directly mints from the reward token contract and it
 * allows manually setting the global reward rate
 * @author shung for Pangolin
 */
contract RewardRegulatorMintableSimple is RewardRegulator {
    using SafeMath for uint;

    /// @notice Rewards emitted per second
    uint public rewardRate;

    /// @notice The amount the reward rate can be increased at each call
    uint public rewardRateChangeLimit;

    /// @notice The time when the reward rate can be changed
    uint public rewardRateUnlockTime;

    /// @notice The minimum duration between changing reward rates
    uint public constant COOLDOWN = 2 days;

    event RewardRateSet(uint newRewardRate);
    event PeriodFinishSet(uint newPeriodFinish);

    /**
     * @notice Construct a new RewardRegulator Simple Mintable contract
     * @dev This contract allows priveleged users to manually set reward rate
     * @param newRewardToken The reward token the contract will distribute
     * @param newRewardRateChangeLimit The amount the reward rate can increase
     * at a time. This limit exists to prevent instant rugpulls
     */
    constructor(address newRewardToken, uint newRewardRateChangeLimit)
        RewardRegulator(newRewardToken)
    {
        rewardRateChangeLimit = newRewardRateChangeLimit;
    }

    function setPeriodFinish(uint newPeriodFinish)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(
            newPeriodFinish > block.timestamp && newPeriodFinish > periodFinish,
            "setPeriodFinish: too early"
        );
        periodFinish = newPeriodFinish;
        emit PeriodFinishSet(newPeriodFinish);
    }

    function setRewardRate(uint newRewardRate)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (newRewardRate > rewardRate) {
            unchecked {
                require(
                    newRewardRate - rewardRate <= rewardRateChangeLimit,
                    "setRewardRate: cannot increase reward rate by that much"
                );
            }
        }
        require(
            block.timestamp >= rewardRateUnlockTime,
            "setRewardRate: cannot update that often"
        );
        update();
        rewardRateUnlockTime = block.timestamp + COOLDOWN;
        rewardRate = newRewardRate;
        emit RewardRateSet(newRewardRate);
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
        IERC20Mintable(address(rewardToken)).mint(msg.sender, reward);
    }
}
