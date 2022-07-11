// SPDX-License-Identifier: GPLv3
pragma solidity 0.8.15;

import "@openzeppelin/contracts/access/AccessControlEnumerable.sol";
import "@rari-capital/solmate/src/utils/SafeTransferLib.sol";
import "./GenericErrors.sol";

/**
 * @title PangoChef Funding
 * @author Shung for Pangolin
 * @notice A contract that is only the reward funding part of `PangoChef`.
 * @dev The pools of the inheriting contract must call `_claim()` to check their rewards since the
 *      last time they made the same call. Then, based on the reward amount, the pool shall
 *      determine the distribution to stakers. It uses the same algorithm as Synthetix’
 *      StakingRewards, but instead of distributing rewards to stakers based on their staked
 *      amount, it distributes rewards to pools based on arbitrary weights.
 */
abstract contract PangoChefFunding is AccessControlEnumerable, GenericErrors {
    using SafeTransferLib for ERC20;

    struct PoolRewardInfo {
        // Pool’s weight determines the proportion of the global rewards it will receive.
        uint32 weight;
        // Pool’s previous non-claimed rewards, stashed when its weight changes.
        uint96 stashedRewards;
        // `rewardPerWeightStored` snapshot as `rewardPerWeightPaid` when the pool gets updated.
        uint128 rewardPerWeightPaid;
    }

    /**
     * @notice The mapping from poolId to the struct that stores variables for determining pools’
     * shares of the global rewards.
     */
    mapping(uint256 => PoolRewardInfo) public poolRewardInfos;

    /** @notice The variable representing how much rewards are distributed per weight. It stores in fixed denominator. */
    uint128 public rewardPerWeightStored;

    /** @notice The timestamp when the last time the rewards were claimed by a pool. */
    uint48 public lastUpdate;

    /** @notice The rewards given out per second during a rewarding period. */
    uint80 public globalRewardRate;

    /** @notice The timestamp when the current period will end or the latest period has ended. */
    uint48 public periodFinish;

    /** @notice The amount of total rewards added. */
    uint96 public totalRewardAdded;

    /** @notice The sum of all pools’ weights. */
    uint32 public totalWeight;

    /** @notice The duration of how long the rewards will last after `addReward` is called. */
    uint256 public periodDuration = 1 days;

    /** @notice The minimum duration a period can last. */
    uint256 private constant MIN_PERIOD_DURATION = 2**16 + 1;

    /** @notice The maximum duration a period can last. */
    uint256 private constant MAX_PERIOD_DURATION = 2**32;

    /** @notice The fixed denominator used when storing `rewardPerWeight` variables. */
    uint256 private constant WEIGHT_PRECISION = 2**32;

    /** @notice The maximum amount for the sum of all pools’ weights. */
    uint256 private constant MAX_TOTAL_WEIGHT = type(uint32).max;

    /** @notice The maximum amount of rewards that can ever be distributed. */
    uint256 private constant MAX_TOTAL_REWARD = type(uint96).max;

    /** @notice The privileged role that can call `addReward` function */
    bytes32 private constant FUNDER_ROLE = keccak256("FUNDER_ROLE");

    /** @notice The privileged role that can change pool weights. */
    bytes32 internal constant POOL_MANAGER_ROLE = keccak256("POOL_MANAGER_ROLE");

    /** @notice The reward token that is distributed to stakers. */
    ERC20 public immutable rewardsToken;

    /** @notice The event emitted when a period is manually cut short. */
    event PeriodEnded();

    /** @notice The event emitted when a period is started or extended through funding. */
    event RewardAdded(uint256 reward);

    /** @notice The event emitted when the period duration is changed. */
    event PeriodDurationUpdated(uint256 newDuration);

    /** @notice The event emitted when the weight of a pool changes. */
    event WeightSet(uint256 poolId, uint256 newWeight);

    /**
     * @notice Constructor to create PangoChefFunding contract.
     * @param newRewardsToken The token that is distributed as reward.
     * @param newAdmin The initial owner of the contract.
     */
    constructor(address newRewardsToken, address newAdmin) {
        if (newAdmin == address(0)) revert NullInput();
        if (newRewardsToken.code.length == 0) revert InvalidToken();

        rewardsToken = ERC20(newRewardsToken);
        _grantRole(DEFAULT_ADMIN_ROLE, newAdmin);
        _grantRole(FUNDER_ROLE, newAdmin);
        _grantRole(POOL_MANAGER_ROLE, newAdmin);
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
            uint256 leftover = (periodFinish - block.timestamp) * globalRewardRate;

            // Decrement totalRewardAdded by the amount to be withdrawn.
            totalRewardAdded -= uint96(leftover);

            // Update periodFinish.
            periodFinish = uint48(block.timestamp);

            // Transfer leftover tokens from the contract to the caller.
            rewardsToken.safeTransfer(msg.sender, leftover);
            emit PeriodEnded();
        }
    }

    /**
     * @notice External restricted function to fund the contract.
     * @param amount The amount of reward tokens to add to the contract.
     */
    function addReward(uint256 amount) external onlyRole(FUNDER_ROLE) {
        _updateRewardPerWeightStored();

        // For efficiency, move the periodDuration to memory.
        uint256 tmpPeriodDuration = periodDuration;

        // Ensure amount fits 96 bits.
        if (amount > MAX_TOTAL_REWARD) revert Overflow();

        // Increment totalRewardAdded, reverting on overflow to ensure it fits 96 bits.
        totalRewardAdded += uint96(amount);

        // Update the rewardRate, ensuring leftover rewards from the ongoing period are included.
        uint256 tmpRewardRate;
        if (block.timestamp >= periodFinish) {
            tmpRewardRate = amount / tmpPeriodDuration;
        } else {
            unchecked {
                uint256 leftover = (periodFinish - block.timestamp) * globalRewardRate;
                tmpRewardRate = (amount + leftover) / tmpPeriodDuration;
            }
        }

        // Ensure sufficient amount is supplied hence reward rate is non-zero.
        if (tmpRewardRate == 0) revert NoEffect();

        // Assign the tmpRewardRate back to storage.
        // MAX_TOTAL_REWARD / MIN_PERIOD_DURATION fits 80 bits.
        globalRewardRate = uint80(tmpRewardRate);

        // Update periodFinish.
        periodFinish = uint48(block.timestamp + tmpPeriodDuration);

        // Transfer reward tokens from the caller to the contract.
        rewardsToken.safeTransferFrom(msg.sender, address(this), amount);
        emit RewardAdded(amount);
    }

    /**
     * @notice External restricted function to change the weights of pools.
     * @dev It requires that pool is created by the parent contract.
     * @param poolIds The identifiers of the pools to change the weights of.
     * @param weights The new weights to set the respective pools to.
     */
    function setWeights(uint256[] calldata poolIds, uint32[] calldata weights)
        external
        onlyRole(POOL_MANAGER_ROLE)
    {
        _updateRewardPerWeightStored();

        // Get the supplied array lengths and ensure they are equal.
        uint256 length = poolIds.length;
        if (length != weights.length) revert MismatchedArrayLengths();

        // Get `poolsLength` to ensure in the loop that pools for a `poolId` exists.
        uint256 tmpPoolsLength = poolsLength();

        // Loop through all the supplied pools, and calculate total weight change.
        int256 weightChange;
        for (uint256 i = 0; i < length; ) {
            uint256 poolId = poolIds[i];
            uint256 weight = weights[i];

            // Ensure pool is initialized by the parent contract.
            if (poolId >= tmpPoolsLength) revert OutOfBounds();

            // Create storage pointer for the pool.
            PoolRewardInfo storage pool = poolRewardInfos[poolId];

            // Ensure weight is changed.
            uint256 oldWeight = pool.weight;
            if (weight == oldWeight) revert NoEffect();

            // Update the weightChange local variable.
            weightChange += (int256(weight) - int256(oldWeight));

            // Stash the rewards of the pool since last update, and update the pool weight.
            pool.stashedRewards = uint96(_updateRewardPerWeightPaid(pool));
            pool.weight = uint32(weight);
            emit WeightSet(poolId, weight);

            // Counter cannot realistically overflow.
            unchecked {
                ++i;
            }
        }

        // Ensure weight change is reasonable, then update the totalWeight state variable.
        int256 newTotalWeight = int256(uint256(totalWeight)) + weightChange;
        if (newTotalWeight < 0) revert OutOfBounds();
        if (uint256(newTotalWeight) > MAX_TOTAL_WEIGHT) revert OutOfBounds();
        totalWeight = uint32(uint256(newTotalWeight));
    }

    /**
     * @notice External view function to get the reward rate of a pool
     * @param poolId The identifier of the pool to check the reward rate of.
     * @return The rewards per second of the pool.
     */
    function poolRewardRate(uint256 poolId) external view returns (uint256) {
        // If reward period is over, simply return zero.
        if (periodFinish < block.timestamp) return 0;

        // Return the rewardRate of the pool.
        uint256 poolWeight = poolRewardInfos[poolId].weight;
        return poolWeight == 0 ? 0 : (globalRewardRate * poolWeight) / totalWeight;
    }

    /**
     * @notice External view function to get the global reward rate.
     * @return The rewards per second distributed to all pools combined.
     */
    function rewardRate() external view returns (uint256) {
        return periodFinish < block.timestamp ? 0 : globalRewardRate;
    }

    /**
     * @notice Public view function to return the number of pools created by parent contract.
     * @dev This function must be overridden by the parent contract.
     * @return The number of pools created.
     */
    function poolsLength() public view virtual returns (uint256) {
        return 0;
    }

    /**
     * @notice Internal function to get the amount of reward tokens to distribute to a pool since
     *         the last call for the same pool was made to this function.
     * @param poolId The identifier of the pool to claim the rewards of.
     * @return reward The amount of reward tokens that is marked for distributing to the pool.
     */
    function _claim(uint256 poolId) internal returns (uint256 reward) {
        _updateRewardPerWeightStored();
        PoolRewardInfo storage pool = poolRewardInfos[poolId];
        reward = _updateRewardPerWeightPaid(pool);
        pool.stashedRewards = 0;
    }

    /**
     * @notice Internal function to snapshot the `rewardPerWeightStored` for the pool.
     * @param pool The pool to update its `rewardPerWeightPaid`.
     * @return reward The amount of reward tokens that is marked for distributing to the pool.
     */
    function _updateRewardPerWeightPaid(PoolRewardInfo storage pool) internal returns (uint256) {
        uint256 rewards = _poolPendingRewards(pool, false);
        pool.rewardPerWeightPaid = rewardPerWeightStored;
        return rewards;
    }

    /** @notice Internal function to increment the `rewardPerWeightStored`. */
    function _updateRewardPerWeightStored() internal {
        rewardPerWeightStored += _getRewardPerWeightIncrementation();
        lastUpdate = uint48(block.timestamp);
    }

    /**
     * @notice Internal view function to get the pending rewards of a pool.
     * @param pool The pool to get its pending rewards.
     * @param increment A flag to choose whether use incremented `rewardPerWeightStored` or not.
     * @return The amount of rewards earned by the pool since the last update of the pool.
     */
    function _poolPendingRewards(PoolRewardInfo storage pool, bool increment)
        internal
        view
        returns (uint256)
    {
        uint256 rewardPerWeight = increment
            ? rewardPerWeightStored + _getRewardPerWeightIncrementation()
            : rewardPerWeightStored;
        uint256 rewardPerWeightPayable = rewardPerWeight - pool.rewardPerWeightPaid;
        return pool.stashedRewards + ((pool.weight * rewardPerWeightPayable) / WEIGHT_PRECISION);
    }

    /**
     * @notice Internal view function to get how much to increment `rewardPerWeightStored`.
     * @return The incrementation amount for the `rewardPerWeightStored`.
     */
    function _getRewardPerWeightIncrementation() internal view returns (uint128) {
        uint256 tmpTotalWeight = totalWeight;
        if (tmpTotalWeight == 0) return 0;

        return uint128((_globalPendingRewards() * WEIGHT_PRECISION) / tmpTotalWeight);
    }

    /**
     * @notice Internal view function to get the amount of accumulated reward tokens since last
     *         update time.
     * @return The amount of reward tokens that has been accumulated since last update time.
     */
    function _globalPendingRewards() internal view returns (uint256) {
        // For efficiency, move periodFinish timestamp to memory.
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
                return (lastTimeRewardApplicable - tmpLastUpdate) * globalRewardRate;
            }
        }

        // If the reward period is an invalid or a null range, return zero.
        return 0;
    }
}
