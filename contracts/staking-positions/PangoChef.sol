// SPDX-License-Identifier: GPLv3
pragma solidity 0.8.15;

import "./PangoChefFunding.sol";

interface IPangolinFactory {
    function getPair(address tokenA, address tokenB) external view returns (address pair);
}

interface IPangolinPair {
    function token0() external view returns (address);

    function token1() external view returns (address);

    function getReserves()
        external
        view
        returns (
            uint112 reserve0,
            uint112 reserve1,
            uint32 blockTimestampLast
        );

    function mint(address to) external returns (uint256 liquidity);
}

interface IWAVAX {
    function deposit() external payable;
}

interface IRewarder {
    function onReward(
        uint256 pid,
        address user,
        address recipient,
        uint256 rewardAmount,
        uint256 newLpAmount
    ) external;
}

/**
 * @title PangoChef
 * @author Shung for Pangolin
 */
contract PangoChef is PangoChefFunding {
    using SafeTransferLib for ERC20;

    enum PoolType {
        UNSET_POOL,
        ERC20_POOL,
        RELAYER_POOL
    }

    enum StakeType {
        REGULAR,
        COMPOUND
    }

    struct ValueVariables {
        // The amount of tokens staked by the user in the pool or total staked in the pool.
        uint104 balance;
        // The sum of each staked token in the position or contract multiplied by its update time.
        uint152 sumOfEntryTimes;
    }

    struct RewardVariables {
        // Imaginary rewards accrued by a position with `lastUpdate == 0 && balance == 1`. At the
        // end of each interval, the ideal position has a staking duration of `block.timestamp`.
        // Since its balance is one, its “value” equals its staking duration. So, its value
        // is also `block.timestamp` , and for a given reward at an interval, the ideal position
        // accrues `reward * block.timestamp / totalValue`. Refer to `Ideal Position` section of
        // the Proofs on why we need this variable.
        uint256 idealPosition;
        // The sum of `reward/totalValue` of each interval. `totalValue` is the sum of all staked
        // tokens multiplied by their respective staking durations.  On every update, the
        // `rewardPerValue` is incremented by rewards given during that interval divided by the
        // total value, which is average staking duration multiplied by total staked. See `Regular
        // Position from Ideal Position` for more details.
        uint256 rewardPerValue;
    }

    struct User {
        // Two variables that determine the share of rewards a user receives from the pool.
        ValueVariables valueVariables;
        // Reward variables snapshotted on the last update of the user.
        RewardVariables rewardVariablesPaid;
        // The sum of values (`balance * (block.timestamp - lastUpdate)`) of previous intervals. It
        // is only updated accordingly when more tokens are staked into an existing position. Other
        // calls than staking (i.e.: harvest and withdraw) must reset the value to zero. Correctly
        // updating this property allows for the staking duration of the existing balance of the
        // position to not restart when staking more tokens to the position. So it allows combining
        // together multiple positions with different staking durations. Refer to the `Combined
        // Positions` section of the Proofs on why this works.
        uint152 previousValues;
        // The last time the user info was updated.
        uint48 lastUpdate;
        bool isLockingPoolZero;
        uint96 stashedRewards;
    }

    struct Pool {
        // updated only once (immutable)
        address tokenOrRecipient; // 160
        PoolType poolType; // 8
        // updated whenever someone stakes, withdraws, etc.
        ValueVariables valueVariables;
        // updated whenever someone stakes, withdraws, etc.
        RewardVariables rewardVariablesStored;
        // updated whenever admin changes rewarder
        IRewarder rewarder; // 160
        // updated whenever someone stakes, withdraws, etc.
        mapping(address => User) users;
    }

    uint256 private _poolsLength = 0;

    mapping(uint256 => Pool) public pools;
    mapping(address => uint256) public poolZeroLockCount;
    mapping(uint256 => address) public rewardPairs;

    IPangolinFactory public immutable factory;
    address immutable wrappedNativeToken;

    uint256 private constant MAX_STAKED_AMOUNT_IN_POOL = type(uint104).max;

    /** @notice The fixed denominator used for storing reward variables. */
    uint256 private constant PRECISION = 2**128;

    /** @notice The event emitted when withdrawing or harvesting from a position. */
    event Withdrawn(
        uint256 indexed positionId,
        address indexed userId,
        uint256 amount,
        uint256 reward
    );

    /** @notice The event emitted when staking to, minting, or compounding a position. */
    event Staked(uint256 indexed positionId, address indexed userId, uint256 amount);

    /** @notice The event emitted when a pool is created. */
    event PoolInitialized(uint256 indexed poolId, address indexed tokenOrRecipient);

    event RewarderSet(uint256 indexed poolId, address indexed rewarder);

    /**
     * @notice Constructor to create and initialize PangoChef contract.
     * @param newRewardsToken The token distributed as reward.
     * @param newAdmin The initial owner of the contract.
     */
    constructor(
        address newRewardsToken,
        address newAdmin,
        IPangolinFactory newFactory,
        address newWrappedNativeToken
    ) PangoChefFunding(newRewardsToken, newAdmin) {
        address poolZeroPair = newFactory.getPair(newRewardsToken, newWrappedNativeToken);
        if (poolZeroPair == address(0)) revert NullInput();

        rewardPairs[0] = newWrappedNativeToken;
        _initializePool(poolZeroPair, PoolType.ERC20_POOL);

        factory = newFactory;
        wrappedNativeToken = newWrappedNativeToken;
    }

    function setRewarder(uint256 poolId, address rewarder) external onlyRole(POOL_MANAGER_ROLE) {
        _onlyERC20Pool(pool);
        pools[poolId].rewarder = rewarder;
        emit RewarderSet(poolId, rewarder);
    }

    function initializePool(address tokenOrRecipient, PoolType poolType)
        external
        onlyRole(POOL_MANAGER_ROLE)
    {
        _initializePool(tokenOrRecipient, poolType);
    }

    function stake(uint256 poolId, uint256 amount) external {
        _stake(poolId, msg.sender, amount, StakeType.REGULAR, 0);
    }

    function stakeTo(
        uint256 poolId,
        address userId,
        uint256 amount
    ) external {
        _stake(poolId, userId, amount, StakeType.REGULAR, 0);
    }

    function compound(uint256 poolId, uint256 maxPairAmount) external payable {
        _stake(poolId, msg.sender, 0, StakeType.COMPOUND, maxPairAmount);
    }

    function withdraw(uint256 poolId, uint256 amount) external {
        _withdraw(poolId, amount);
    }

    function harvest(uint256 poolId) external {
        _withdraw(poolId, 0);
    }

    function emergencyExit(uint256 poolId) external {
        _exit(poolId);
    }

    function compoundToPoolZero(uint256 poolId, uint256 maxPairAmount) external payable {
        uint256 reward = _harvestWithoutReset(poolId);

        _stake(0, msg.sender, reward, StakeType.COMPOUND_TO_POOL_ZERO, 0);
    }

    function _stake(
        uint256 poolId,
        address userId,
        uint256 amount,
        StakeType stakeType,
        uint256 maxPairAmount
    ) private {
        // Create a storage pointers for the pool and the user.
        Pool storage pool = pools[poolId];
        User storage user = pool.users[userId];

        // Ensure pool is ERC20 type.
        _onlyERC20Pool(pool);

        _updateRewardVariables(poolId, pool);

        // Before everything else, get & update rewards accrued by the user.
        uint256 reward = _userPendingRewards(poolId, pool, user);

        uint256 transferAmount = 0;
        if (stakeType == StakeType.REGULAR) {
            transferAmount = amount;
            user.stashedRewards = uint96(reward);
            reward = 0;
        } else if (stakeType == StakeType.COMPOUND_TO_POOL_ZERO) {
            amount = _addLiquidity(
                pool.tokenOrRecipient,
                amount,
                wrappedNativeToken,
                maxPairAmount
            );
            user.stashedRewards = uint96(reward);
            reward = 0;
        } else {
            address rewardPair = _setAndGetRewardPair(poolId, pool);
            amount = _addLiquidity(pool.tokenOrRecipient, reward, rewardPair, maxPairAmount);
            user.stashedRewards = 0;
        }

        if (amount == 0) revert NoEffect();

        // Get the new total staked amount and ensure it fits MAX_STAKED_AMOUNT_IN_POOL.
        ValueVariables storage poolValueVariables = pool.valueVariables;
        uint256 newTotalStaked = poolValueVariables.balance + amount;
        if (newTotalStaked > MAX_STAKED_AMOUNT_IN_POOL) revert Overflow();

        // Increment the pool info pertaining to pool’s total value calculation.
        uint152 addedEntryTimes = uint152(block.timestamp * amount);
        poolValueVariables.sumOfEntryTimes += addedEntryTimes;
        poolValueVariables.balance = uint96(newTotalStaked);

        // Increment the user info pertaining to user value calculation.
        ValueVariables storage userValueVariables = user.valueVariables;
        uint256 oldBalance = userValueVariables.balance;
        uint256 newBalance = oldBalance + amount;
        unchecked {
            userValueVariables.balance = uint96(newBalance);
        }
        userValueVariables.sumOfEntryTimes += addedEntryTimes;

        // Increment the previousValues.
        user.previousValues += uint152(oldBalance * (block.timestamp - user.lastUpdate));

        // Snapshot the lastUpdate and reward variables.
        _snapshotRewardVariables(pool, user);

        // Transfer amount tokens from caller to the contract, and emit the staking event.
        if (transferAmount != 0) {
            ERC20(pool.tokenOrRecipient).safeTransferFrom(
                msg.sender,
                address(this),
                transferAmount
            );
        }
        emit Staked(poolId, userId, amount, reward);

        IRewarder rewarder = pool.rewarder;
        if (address(rewarder) != address(0)) {
            rewarder.onReward(poolId, userId, userId, reward, newBalance);
        }
    }

    function _withdraw(uint256 poolId, uint256 amount) private {
        // Create a storage pointer for the pool and the user.
        Pool storage pool = pools[poolId];
        User storage user = pool.users[msg.sender];

        // Ensure pool is ERC20 type.
        _onlyERC20Pool(pool);

        // Update pool reward variables that govern the reward distribution from pool to users.
        _updateRewardVariables(poolId, pool);

        // Decrement lock count on pool zero if this pool was locking it.
        if (poolId == 0) {
            if (poolZeroLockCount[msg.sender] != 0) revert Locked();
        } else if (user.isLockingPoolZero) {
            --poolZeroLockCount[msg.sender];
            user.isLockingPoolZero = false;
        }

        // Get position balance and ensure sufficient balance exists.
        ValueVariables storage userValueVariables = user.valueVariables;
        uint256 oldBalance = userValueVariables.balance;
        if (amount > oldBalance) revert InsufficientBalance();

        // Before everything else, get the rewards accrued by the user, then delete the user stash.
        uint256 reward = _userPendingRewards(poolId, pool, user);
        user.stashedRewards = 0;

        // Ensure we are either withdrawing something or claiming rewards.
        if (amount == 0 && reward == 0) revert NoEffect();

        // Get the remaining balance in the position.
        uint256 remaining;
        unchecked {
            remaining = oldBalance - amount;
        }

        // Decrement the withdrawn amount from totalStaked.
        ValueVariables storage poolValueVariables = pool.valueVariables;
        poolValueVariables.balance -= uint96(amount);

        // Update sumOfEntryTimes. The new sumOfEntryTimes can be greater or less than the previous
        // sumOfEntryTimes depending on the withdrawn amount and the time passed since lastUpdate.
        uint256 newEntryTimes = block.timestamp * remaining;
        poolValueVariables.sumOfEntryTimes = uint152(
            poolValueVariables.sumOfEntryTimes + newEntryTimes - userValueVariables.sumOfEntryTimes
        );

        // Decrement the withdrawn amount from user balance, and update the user entry times.
        userValueVariables.balance = uint96(remaining);
        userValueVariables.sumOfEntryTimes = uint152(newEntryTimes);

        // Reset the previous values, as we have restarted the staking duration.
        user.previousValues = 0;

        // Snapshot the lastUpdate and reward variables.
        _snapshotRewardVariables(pool, user);

        // Transfer withdrawn tokens.
        rewardsToken.safeTransfer(msg.sender, reward);
        if (amount != 0) ERC20(pool.tokenOrRecipient).safeTransfer(msg.sender, amount);
        emit Withdrawn(poolId, msg.sender, amount, reward);

        IRewarder rewarder = pool.rewarder;
        if (address(rewarder) != address(0)) {
            rewarder.onReward(poolId, msg.sender, msg.sender, reward, remaining);
        }
    }

    function _exit(uint256 poolId) private {
        // Create a storage pointers for the pool and the user.
        Pool storage pool = pools[poolId];
        User storage user = pool.users[msg.sender];

        // Ensure pool is ERC20 type.
        _onlyERC20Pool(pool);

        ValueVariables memory poolValueVariables = pool.valueVariables;
        ValueVariables memory userValueVariables = user.valueVariables;

        // Decrement the state variables pertaining to total value calculation.
        uint96 balance = userValueVariables.balance;
        poolValueVariables.balance -= balance;
        poolValueVariables.sumOfEntryTimes -= userValueVariables.sumOfEntryTimes;

        delete pools[poolId].user[msg.sender];

        ERC20(pool.tokenOrRecipient).safeTransfer(msg.sender, balance);
        emit Withdrawn(poolId, msg.sender, balance, 0);
    }

    function _harvestWithoutReset(uint256 poolId) private returns (uint256 reward) {
        // Create a storage pointer for the pool and the user.
        Pool storage pool = pools[poolId];
        User storage user = pool.users[msg.sender];

        // Ensure pool is ERC20 type.
        _onlyERC20Pool(pool);

        // Update pool reward variables that govern the reward distribution from pool to users.
        _updateRewardVariables(poolId, pool);

        // Pool zero should instead use `compound()`.
        if (poolId == 0) revert Locked();

        // Increment lock count on pool zero if this pool was not already locking it.
        if (!user.isLockingPoolZero) {
            ++poolZeroLockCount[msg.sender];
            user.isLockingPoolZero = true;
        }

        // Get the rewards accrued by the user, then delete the user stash.
        reward = _userPendingRewards(poolId, pool, user);
        user.stashedRewards = 0;

        // Ensure we are either withdrawing something or claiming rewards.
        if (reward == 0) revert NoEffect();

        // Increment the previousValues to not reset the staking duration.
        uint256 userBalance = user.valueVariables.balance;
        user.previousValues += uint152(userBalance * (block.timestamp - user.lastUpdate));

        // Snapshot the lastUpdate and reward variables.
        _snapshotRewardVariables(pool, user);

        emit Withdrawn(poolId, msg.sender, 0, reward);

        IRewarder rewarder = pool.rewarder;
        if (address(rewarder) != address(0)) {
            rewarder.onReward(poolId, msg.sender, msg.sender, reward, userBalance);
        }
    }

    function claim(uint256 poolId) external returns (uint256 reward) {
        // Create a storage pointer for the pool.
        Pool storage pool = pools[poolId];

        // Ensure pool is RELAYER type.
        _onlyRelayerPool(pool);

        // Ensure only relayer itself can claim the rewards.
        if (msg.sender != pool.tokenOrRecipient) revert UnprivilegedCaller();

        // Get the pool’s rewards.
        reward = _claim(poolId);

        rewardsToken.safeTransfer(msg.sender, reward);
        emit Withdrawn(poolId, msg.sender, 0, reward);
    }

    /**
     * @notice External view function to get the reward rate of a user of a pool.
     * @dev In SAR, users have different APRs, unlike other staking algorithms. This external
     * function clearly demonstrates how the SAR algorithm is supposed to distribute the rewards
     * based on “value”, which is balance times staking duration. This external function can be
     * considered as a specification.
     * @param poolId The identifier of the pool the user is in.
     * @param userId The identifier of the user in the pool.
     * @return The rewards per second of the user.
     */
    function userRewardRate(uint256 poolId, address userId) external view returns (uint256) {
        // Get totalValue and positionValue.
        Pool storage pool = pools[poolId];
        uint256 poolValue = _getValue(pool.valueVariables);
        uint256 userValue = _getValue(pool.users[userId].valueVariables);

        // Return the rewardRate of the user. Do not revert if poolValue is zero.
        return userValue == 0 ? 0 : (globalRewardRate * userValue) / poolValue;
    }

    /**
     * @notice External view function to get the accrued rewards of a user. It takes the
     * pending rewards of the pool since lastUpdate into consideration.
     * @param poolId The identifier of the pool the user is in.
     * @param userId The identifier of the user in the pool.
     * @return The amount of rewards that have been accrued in the position.
     */
    function userPendingRewards(uint256 poolId, address userId) external view returns (uint256) {
        // Create a storage pointer for the position.
        Pool storage pool = pools[poolId];
        User storage user = pool.users[userId];

        // Get the delta of reward variables. Use incremented `rewardVariablesStored` based on the
        // pending rewards.
        RewardVariables memory deltaRewardVariables = _getDeltaRewardVariables(
            poolId,
            pool,
            user,
            true
        );

        // Return the pending rewards of the user based on the difference in rewardVariables.
        return _earned(deltaRewardVariables, user);
    }

    function poolsLength() public view override returns (uint256) {
        return _poolsLength;
    }

    function _initializePool(address tokenOrRecipient, PoolType poolType) private {
        // Get the next `poolId` from `_poolsLength`, then increment `_poolsLength`.
        uint256 poolId = _poolsLength;
        ++_poolsLength;

        // Ensure address is not empty.
        if (tokenOrRecipient == address(0)) revert NullInput();

        // Ensure token is a contract.
        if (poolType == PoolType.ERC20_POOL && tokenOrRecipient.code.length == 0) revert();

        // Assign the function arguments to the pool mapping then emit the associated event.
        Pool storage pool = pools[poolId];
        pool.tokenOrRecipient = tokenOrRecipient;
        pool.poolType = poolType;
        emit PoolInitialized(poolId, tokenOrRecipient);
    }

    function _addLiquidity(
        address poolToken,
        uint256 rewardAmount,
        address rewardPair,
        uint256 maxPairAmount
    ) private returns (uint256 poolTokenAmount) {
        // SET REENTRANCY GUARD HERE

        // Get token amounts from the pool.
        (uint256 reserve0, uint256 reserve1, ) = IPangolinPair(poolToken).getReserves();

        // Get the reward token’s pair’s amount from the reserves.
        ERC20 tmpRewardsToken = rewardsToken;
        uint256 pairAmount = address(tmpRewardsToken) < rewardPair
            ? (reserve1 * rewardAmount) / reserve0
            : (reserve0 * rewardAmount) / reserve1;

        // Ensure slippage is not above the limit.
        if (pairAmount > maxPairAmount) revert();

        // Transfer reward tokens from the contract to the pair contract.
        tmpRewardsToken.safeTransfer(poolToken, rewardAmount);

        // Non-zero message value signals desire to pay with native token.
        if (rewardPair == wrappedNativeToken && msg.value > 0) {
            // Ensure consistent slippage control.
            if (msg.value != maxPairAmount) revert();

            // Wrap the native token.
            IWAVAX(rewardPair).deposit{ value: pairAmount }();

            // Refund user.
            SafeTransferLib.safeTransferETH(msg.sender, maxPairAmount - pairAmount);
        } else if (msg.value > 0) {
            // If rewardPair is not wrapped native token, do not allow non-zero message value.
            revert();
        } else {
            // Transfer reward pair tokens from the user to the pair contract.
            ERC20(rewardPair).safeTransferFrom(msg.sender, poolToken, pairAmount);
        }

        // Mint liquidity tokens to the PangoChef and return the amount minted.
        poolTokenAmount = IPangolinPair(poolToken).mint(address(this));

        // UNSET REENTRANCY GUARD HERE
    }

    /**
     * @notice Private function to ensure the pool token is a Pangolin liquidity token created by Pangolin Factory, and that the one of the pair tokens is the reward token. Reverts if not true.
     */
    function _setAndGetRewardPair(uint256 poolId, Pool storage pool) private returns (address) {
        address tmpRewardPair = rewardPairs[poolId];

        if (tmpRewardPair == address(0)) {
            address poolToken = pool.tokenOrRecipient;
            address token0 = IPangolinPair(poolToken).token0();
            address token1 = IPangolinPair(poolToken).token1();

            if (token0 == address(rewardsToken)) {
                tmpRewardPair = token1;
            } else if (token1 == address(rewardsToken)) {
                tmpRewardPair = token0;
            } else {
                revert InvalidType();
            }

            // Ensure the pool token was created by the pair factory.
            if (factory.getPair(token0, token1) != poolToken) revert InvalidType();

            rewardPairs[poolId] = tmpRewardPair;
        }

        return tmpRewardPair;
    }

    function _onlyERC20Pool(Pool storage pool) private view {
        if (pool.poolType != PoolType.ERC20_POOL) revert InvalidType();
    }

    function _onlyRelayerPool(Pool storage pool) private view {
        if (pool.poolType != PoolType.RELAYER_POOL) revert InvalidType();
    }

    /**
     * @notice Private function to claim the pool’s pending rewards, and based on the claimed
     * amount update the two variables that govern the reward distribution.
     * @param poolId The identifier of the pool to update the rewards of.
     * @param pool The properties of the pool to update the rewards of.
     * @return The amount of rewards claimed by the pool.
     */
    function _updateRewardVariables(uint256 poolId, Pool storage pool) private returns (uint256) {
        // Get rewards, in the process updating the last update time.
        uint256 rewards = _claim(poolId);

        // Get incrementations based on the reward amount.
        (
            uint256 idealPositionIncrementation,
            uint256 rewardPerValueIncrementation
        ) = _getRewardVariableIncrementations(pool, rewards);

        // Increment the reward variables.
        RewardVariables storage rewardVariablesStored = pool.rewardVariablesStored;
        rewardVariablesStored.idealPosition += idealPositionIncrementation;
        rewardVariablesStored.rewardPerValue += rewardPerValueIncrementation;

        return rewards;
    }

    /**
     * @notice Private function to snapshot two rewards variables and record the timestamp.
     * @param pool The storage pointer to the pool to record the snapshot from.
     * @param user The storage pointer to the user to record the snapshot to.
     */
    function _snapshotRewardVariables(Pool storage pool, User storage user) private {
        user.lastUpdate = uint48(block.timestamp);
        user.rewardVariablesPaid = pool.rewardVariablesStored;
    }

    /**
     * @notice Private view function to get the accrued rewards of a user in a pool.
     * @dev The call to this function must only be made after the reward variables are updated
     * through `_updateRewardVariables()`.
     * @param poolId The identifier of the pool.
     * @param pool The properties of the pool.
     * @param user The properties of the user.
     * @return The accrued rewards of the position.
     */
    function _userPendingRewards(
        uint256 poolId,
        Pool storage pool,
        User storage user
    ) private view returns (uint256) {
        // Get the change in reward variables since the position was last updated. When calculating
        // the delta, do not increment `rewardVariablesStored`, as they had to be updated anyways.
        RewardVariables memory deltaRewardVariables = _getDeltaRewardVariables(
            poolId,
            pool,
            user,
            false
        );

        // Return the pending rewards of the user.
        return _earned(deltaRewardVariables, user);
    }

    /**
     * @notice Private view function to get the difference between a user’s reward variables
     * (‘paid’) and a pool’s reward variables (‘stored’).
     * @param poolId The identifier of the pool.
     * @param pool The pool to take the basis for stored reward variables.
     * @param user The user for which to calculate the delta of reward variables.
     * @param increment Whether to the incremented `rewardVariablesStored` based on the pending
     * rewards of the pool.
     * @return The difference between the `rewardVariablesStored` and `rewardVariablesPaid`.
     */
    function _getDeltaRewardVariables(
        uint256 poolId,
        Pool storage pool,
        User storage user,
        bool increment
    ) private view returns (RewardVariables memory) {
        // If user had no update to its reward variables yet, return zero.
        if (user.lastUpdate == 0) return RewardVariables(0, 0);

        // Create storage pointers to the user’s and pool’s reward variables.
        RewardVariables storage rewardVariablesPaid = user.rewardVariablesPaid;
        RewardVariables storage rewardVariablesStored = pool.rewardVariablesStored;

        // If requested, return the incremented `rewardVariablesStored`.
        if (increment) {
            // Get pending rewards of the pool, without updating any state variables.
            uint256 rewards = _poolPendingRewards(poolRewardInfos[poolId], increment);

            // Get incrementations based on the reward amount.
            (
                uint256 idealPositionIncrementation,
                uint256 rewardPerValueIncrementation
            ) = _getRewardVariableIncrementations(pool, rewards);

            // Increment and return the incremented the reward variables.
            return
                RewardVariables(
                    rewardVariablesStored.idealPosition +
                        idealPositionIncrementation -
                        rewardVariablesPaid.idealPosition,
                    rewardVariablesStored.rewardPerValue +
                        rewardPerValueIncrementation -
                        rewardVariablesPaid.rewardPerValue
                );
        }

        // Otherwise just return the the delta, ignoring any incrementation from pending rewards.
        return
            RewardVariables(
                rewardVariablesStored.idealPosition - rewardVariablesPaid.idealPosition,
                rewardVariablesStored.rewardPerValue - rewardVariablesPaid.rewardPerValue
            );
    }

    /**
     * @notice Private view function to calculate the `rewardVariablesStored` incrementations based
     * on the given reward amount.
     * @param pool The pool to get the incrementations for.
     * @param rewards The amount of rewards to use for calculating the incrementation.
     * @return idealPositionIncrementation The incrementation to make to the idealPosition.
     * @return rewardPerValueIncrementation The incrementation to make to the rewardPerValue.
     */
    function _getRewardVariableIncrementations(Pool storage pool, uint256 rewards)
        private
        view
        returns (uint256 idealPositionIncrementation, uint256 rewardPerValueIncrementation)
    {
        // Calculate the totalValue, then get the incrementations only if value is non-zero.
        uint256 totalValue = _getValue(pool.valueVariables);
        if (totalValue != 0) {
            idealPositionIncrementation = (rewards * block.timestamp * PRECISION) / totalValue;
            rewardPerValueIncrementation = (rewards * PRECISION) / totalValue;
        }
    }

    /**
     * @notice Private view function to get the user or pool value.
     * @dev Value refers to the sum of each `wei` of tokens’ staking durations. So if there are
     * 10 tokens staked in the contract, and each one of them has been staked for 10 seconds, then
     * the value is 100 (`10 * 10`). To calculate value we use sumOfEntryTimes, which is the sum of
     * each `wei` of tokens’ staking-duration-starting timestamp. The formula below is intuitive
     * and simple to derive. We will leave proving it to the reader.
     * @return The total value of a user or a pool.
     */
    function _getValue(ValueVariables storage valueVariables) private view returns (uint256) {
        return block.timestamp * valueVariables.balance - valueVariables.sumOfEntryTimes;
    }

    /**
     * @notice Low-level private view function to get the accrued rewards of a user.
     * @param deltaRewardVariables The difference between the ‘stored’ and ‘paid’ reward variables.
     * @param user The user of a pool to check the accrued rewards of.
     * @return The accrued rewards of the position.
     */
    function _earned(RewardVariables memory deltaRewardVariables, User storage user)
        private
        view
        returns (uint256)
    {
        // Refer to the Combined Position section of the Proofs on why and how this formula works.
        return
            user.lastUpdate == 0
                ? 0
                : user.stashedRewards +
                    ((((deltaRewardVariables.idealPosition -
                        (deltaRewardVariables.rewardPerValue * user.lastUpdate)) *
                        user.valueVariables.balance) +
                        (deltaRewardVariables.rewardPerValue * user.previousValues)) / PRECISION);
    }
}
