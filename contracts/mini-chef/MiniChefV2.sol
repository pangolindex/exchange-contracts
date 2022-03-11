// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "@boringcrypto/boring-solidity/contracts/libraries/BoringMath.sol";
import "openzeppelin-contracts-legacy/access/Ownable.sol";
import "openzeppelin-contracts-legacy/math/SignedSafeMath.sol";
import "openzeppelin-contracts-legacy/utils/SafeCast.sol";

import "./IRewarder.sol";

interface IMigratorChef {
    // Take the current LP token address and return the new LP token address.
    // Migrator should have full access to the caller's LP token.
    function migrate(IERC20 token) external returns (IERC20);
}

/// @notice The (older) MiniChefV2 contract gives out a reward tokens per block.
// The reward tokens must be topped up regularly to ensure users do not accrue non-existent rewards
// This implementation aims to avoid that issue by using a dynamic window of funding
contract MiniChefV2 is Ownable {
    using BoringMath for uint256;
    using BoringMath128 for uint128;
    using BoringERC20 for IERC20;
    using SignedSafeMath for int256;
    using SafeCast for int256;

    /// @notice Info of each MCV2 user.
    /// `amount` LP token amount the user has provided.
    /// `rewardDebt` The amount of reward entitled to the user.
    struct UserInfo {
        uint256 amount;
        int256 rewardDebt;
    }

    /// @notice Info of each MCV2 pool.
    /// `allocPoint` The amount of allocation points assigned to the pool.
    /// Also known as the amount of reward to distribute per block.
    struct PoolInfo {
        uint128 accRewardPerShare;
        uint64 lastRewardTime;
        uint64 allocPoint;
    }

    /// @notice Address of reward (PNG) contract.
    IERC20 public immutable REWARD;
    // @notice The migrator contract. It has a lot of power. Can only be set through governance (owner).
    IMigratorChef public migrator;
    bool public migrationDisabled;

    /// @notice Info of each MCV2 pool.
    PoolInfo[] public poolInfo;
    /// @notice Address of the LP token for each MCV2 pool.
    IERC20[] public lpToken;
    /// @notice Address of each `IRewarder` contract in MCV2.
    IRewarder[] public rewarder;

    /// @notice Info of each user that stakes LP tokens.
    mapping (uint256 => mapping (address => UserInfo)) public userInfo;

    /// @dev Tokens added
    mapping (address => bool) public addedTokens;

    /// @dev Addresses allowed to change rewardsExpiration duration
    mapping (address => bool) private funder;

    /// @dev Total allocation points. Must be the sum of all allocation points in all pools.
    uint256 public totalAllocPoint;

    uint256 public rewardPerSecond;
    uint256 private constant ACC_REWARD_PRECISION = 1e12;

    /// @dev Block time when the rewards per second stops
    uint256 public rewardsExpiration;

    event Deposit(address indexed user, uint256 indexed pid, uint256 amount, address indexed to);
    event Withdraw(address indexed user, uint256 indexed pid, uint256 amount, address indexed to);
    event EmergencyWithdraw(address indexed user, uint256 indexed pid, uint256 amount, address indexed to);
    event Harvest(address indexed user, uint256 indexed pid, uint256 amount);
    event PoolAdded(uint256 indexed pid, uint256 allocPoint, IERC20 indexed lpToken, IRewarder indexed rewarder);
    event PoolSet(uint256 indexed pid, uint256 allocPoint, IRewarder indexed rewarder, bool overwrite);
    event PoolUpdate(uint256 indexed pid, uint64 lastRewardTime, uint256 lpSupply, uint256 accRewardPerShare);
    event MigratorSet(address migrator);
    event MigratorDisabled();
    event Migrate(uint256 pid);
    event FunderAdded(address funder);
    event FunderRemoved(address funder);
    event LogRewardPerSecond(uint256 rewardPerSecond);
    event LogRewardsExpiration(uint256 rewardsExpiration);

    /// @param _rewardToken The reward token contract address.
    /// @param _firstOwner Initial owner of the contract.
    constructor(address _rewardToken, address _firstOwner) public {
        require(
            _rewardToken != address(0)
            && _firstOwner != address(0),
            "MiniChefV2::Cannot construct with zero address"
        );

        REWARD = IERC20(_rewardToken);
        transferOwnership(_firstOwner);
    }

    /// @notice Returns the number of MCV2 pools.
    function poolLength() public view returns (uint256 pools) {
        pools = poolInfo.length;
    }

    /// @notice Returns list of all lpTokens for ease of interfacing
    function lpTokens() external view returns (IERC20[] memory) {
        return lpToken;
    }

    /// @notice Returns list of all pool infos for ease of interfacing
    function poolInfos() external view returns (PoolInfo[] memory) {
        return poolInfo;
    }

    /// @notice Returns the status of an address as a funder
    function isFunder(address _funder) external view returns (bool allowed) {
        allowed = funder[_funder];
    }

    /// @notice Add a single reward pool after appropriately updating all pools
    function addPool(uint256 _allocPoint, IERC20 _lpToken, IRewarder _rewarder) external onlyOwner {
        massUpdateAllPools();
        add(_allocPoint, _lpToken, _rewarder);
    }


    /// @notice Add multiple reward pools after appropriately updating all pools
    function addPools(uint256[] calldata _allocPoints, IERC20[] calldata _lpTokens, IRewarder[] calldata _rewarders) external onlyOwner {
        require(
            _allocPoints.length == _lpTokens.length
            && _lpTokens.length == _rewarders.length,
            "MiniChefV2: invalid parameter lengths"
        );

        massUpdateAllPools();

        uint256 len = _allocPoints.length;
        for (uint256 i = 0; i < len; ++i) {
            add(_allocPoints[i], _lpTokens[i], _rewarders[i]);
        }
    }

    /// @notice Add a new LP to the pool. Can only be called by the owner.
    /// DO NOT add the same LP token more than once. Rewards will be messed up if you do.
    /// @param allocPoint AP of the new pool.
    /// @param _lpToken Address of the LP ERC-20 token.
    /// @param _rewarder Address of the rewarder delegate.
    function add(uint256 allocPoint, IERC20 _lpToken, IRewarder _rewarder) internal {
        require(addedTokens[address(_lpToken)] == false, "Token already added");
        totalAllocPoint = totalAllocPoint.add(allocPoint);
        lpToken.push(_lpToken);
        rewarder.push(_rewarder);

        poolInfo.push(PoolInfo({
            allocPoint: allocPoint.to64(),
            lastRewardTime: block.timestamp.to64(),
            accRewardPerShare: 0
        }));
        addedTokens[address(_lpToken)] = true;
        emit PoolAdded(lpToken.length.sub(1), allocPoint, _lpToken, _rewarder);
    }

    /// @notice Change information for one pool after appropriately updating all pools
    function setPool(uint256 _pid, uint256 _allocPoint, IRewarder _rewarder, bool overwrite) external onlyOwner {
        massUpdateAllPools();
        set(_pid, _allocPoint, _rewarder, overwrite);
    }

    /// @notice Change information for multiple pools after appropriately updating all pools
    function setPools(uint256[] calldata pids, uint256[] calldata allocPoints, IRewarder[] calldata rewarders, bool[] calldata overwrites) external onlyOwner {
        require(
            pids.length == allocPoints.length
            && allocPoints.length == rewarders.length
            && rewarders.length == overwrites.length,
            "MiniChefV2: invalid parameter lengths"
        );

        massUpdateAllPools();

        uint256 len = pids.length;
        for (uint256 i = 0; i < len; ++i) {
            set(pids[i], allocPoints[i], rewarders[i], overwrites[i]);
        }
    }

    /// @notice Update the given pool's reward allocation point and `IRewarder` contract. Can only be called by the owner.
    /// @param _pid The index of the pool. See `poolInfo`.
    /// @param _allocPoint New AP of the pool.
    /// @param _rewarder Address of the rewarder delegate.
    /// @param overwrite True if _rewarder should be `set`. Otherwise `_rewarder` is ignored.
    function set(uint256 _pid, uint256 _allocPoint, IRewarder _rewarder, bool overwrite) internal {
        totalAllocPoint = totalAllocPoint.sub(poolInfo[_pid].allocPoint).add(_allocPoint);
        poolInfo[_pid].allocPoint = _allocPoint.to64();
        if (overwrite) { rewarder[_pid] = _rewarder; }
        emit PoolSet(_pid, _allocPoint, overwrite ? _rewarder : rewarder[_pid], overwrite);
    }

    /// @notice Set the `migrator` contract. Can only be called by the owner.
    /// @param _migrator The contract address to set.
    function setMigrator(IMigratorChef _migrator) public onlyOwner {
        require(!migrationDisabled, "MiniChefV2: migration has been disabled");
        migrator = _migrator;
        emit MigratorSet(address(_migrator));
    }

    /// @notice Permanently disable the `migrator` functionality.
    /// This can only effectively be called once.
    function disableMigrator() public onlyOwner {
        migrationDisabled = true;
        emit MigratorDisabled();
    }

    /// @notice Migrate LP token to another LP contract through the `migrator` contract.
    /// @param _pid The index of the pool. See `poolInfo`.
    function migrate(uint256 _pid) public onlyOwner {
        require(!migrationDisabled, "MiniChefV2: migration has been disabled");
        require(address(migrator) != address(0), "MiniChefV2: no migrator set");
        IERC20 _lpToken = lpToken[_pid];
        uint256 bal = _lpToken.balanceOf(address(this));
        _lpToken.approve(address(migrator), bal);
        IERC20 newLpToken = migrator.migrate(_lpToken);
        require(bal == newLpToken.balanceOf(address(this)), "MiniChefV2: migrated balance must match");
        lpToken[_pid] = newLpToken;
        emit Migrate(_pid);
    }

    /// @notice View function to see pending reward on frontend.
    /// @param _pid The index of the pool. See `poolInfo`.
    /// @param _user Address of user.
    /// @return pending reward for a given user.
    function pendingReward(uint256 _pid, address _user) external view returns (uint256 pending) {
        PoolInfo memory pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][_user];
        uint256 accRewardPerShare = pool.accRewardPerShare;
        uint256 lpSupply = lpToken[_pid].balanceOf(address(this));
        if (block.timestamp > pool.lastRewardTime && lpSupply != 0) {
            uint256 time = block.timestamp <= rewardsExpiration
                ? block.timestamp.sub(pool.lastRewardTime) // Accrue rewards until now
                : rewardsExpiration > pool.lastRewardTime
                    ? rewardsExpiration.sub(pool.lastRewardTime) // Accrue rewards until expiration
                    : 0; // No rewards to accrue
            uint256 reward = time.mul(rewardPerSecond).mul(pool.allocPoint) / totalAllocPoint;
            accRewardPerShare = accRewardPerShare.add(reward.mul(ACC_REWARD_PRECISION) / lpSupply);
        }
        pending = int256(user.amount.mul(accRewardPerShare) / ACC_REWARD_PRECISION).sub(user.rewardDebt).toUint256();
    }

    /// @notice Update reward variables for all pools. Be careful of gas spending!
    /// @param pids Pool IDs of all to be updated. Make sure to update all active pools.
    function massUpdatePools(uint256[] calldata pids) external {
        uint256 len = pids.length;
        for (uint256 i = 0; i < len; ++i) {
            updatePool(pids[i]);
        }
    }

    /// @notice Update reward variables for all pools. Be careful of gas spending!
    function massUpdateAllPools() public {
        uint256 len = poolInfo.length;
        for (uint256 pid = 0; pid < len; ++pid) {
            updatePool(pid);
        }
    }

    /// @notice Update reward variables of the given pool.
    /// @param pid The index of the pool. See `poolInfo`.
    /// @return pool Returns the pool that was updated.
    function updatePool(uint256 pid) public returns (PoolInfo memory pool) {
        pool = poolInfo[pid];
        if (block.timestamp > pool.lastRewardTime) {
            uint256 lpSupply = lpToken[pid].balanceOf(address(this));
            if (lpSupply > 0) {
                uint256 time = block.timestamp <= rewardsExpiration
                    ? block.timestamp.sub(pool.lastRewardTime) // Accrue rewards until now
                    : rewardsExpiration > pool.lastRewardTime
                        ? rewardsExpiration.sub(pool.lastRewardTime) // Accrue rewards until expiration
                        : 0; // No rewards to accrue
                uint256 reward = time.mul(rewardPerSecond).mul(pool.allocPoint) / totalAllocPoint;
                pool.accRewardPerShare = pool.accRewardPerShare.add((reward.mul(ACC_REWARD_PRECISION) / lpSupply).to128());
            }
            pool.lastRewardTime = block.timestamp.to64();
            poolInfo[pid] = pool;
            emit PoolUpdate(pid, pool.lastRewardTime, lpSupply, pool.accRewardPerShare);
        }
    }

    /// @notice Deposit LP tokens to MCV2 for reward allocation.
    /// @param pid The index of the pool. See `poolInfo`.
    /// @param amount LP token amount to deposit.
    /// @param to The receiver of `amount` deposit benefit.
    function deposit(uint256 pid, uint256 amount, address to) public {
        PoolInfo memory pool = updatePool(pid);
        UserInfo storage user = userInfo[pid][to];

        // Effects
        user.amount = user.amount.add(amount);
        user.rewardDebt = user.rewardDebt.add(int256(amount.mul(pool.accRewardPerShare) / ACC_REWARD_PRECISION));

        // Interactions
        IRewarder _rewarder = rewarder[pid];
        if (address(_rewarder) != address(0)) {
            _rewarder.onReward(pid, to, to, 0, user.amount);
        }

        lpToken[pid].safeTransferFrom(msg.sender, address(this), amount);

        emit Deposit(msg.sender, pid, amount, to);
    }

    function depositWithPermit(uint256 pid, uint256 amount, address to, uint deadline, uint8 v, bytes32 r, bytes32 s) external {
        // permit
        lpToken[pid].permit(msg.sender, address(this), amount, deadline, v, r, s);

        // deposit
        deposit(pid, amount, to);
    }

    /// @notice Withdraw LP tokens from MCV2.
    /// @param pid The index of the pool. See `poolInfo`.
    /// @param amount LP token amount to withdraw.
    /// @param to Receiver of the LP tokens.
    function withdraw(uint256 pid, uint256 amount, address to) public {
        PoolInfo memory pool = updatePool(pid);
        UserInfo storage user = userInfo[pid][msg.sender];

        // Effects
        user.rewardDebt = user.rewardDebt.sub(int256(amount.mul(pool.accRewardPerShare) / ACC_REWARD_PRECISION));
        user.amount = user.amount.sub(amount);

        // Interactions
        IRewarder _rewarder = rewarder[pid];
        if (address(_rewarder) != address(0)) {
            _rewarder.onReward(pid, msg.sender, to, 0, user.amount);
        }

        lpToken[pid].safeTransfer(to, amount);

        emit Withdraw(msg.sender, pid, amount, to);
    }

    /// @notice Harvest proceeds for transaction sender to `to`.
    /// @param pid The index of the pool. See `poolInfo`.
    /// @param to Receiver of rewards.
    function harvest(uint256 pid, address to) public {
        PoolInfo memory pool = updatePool(pid);
        UserInfo storage user = userInfo[pid][msg.sender];
        int256 accumulatedReward = int256(user.amount.mul(pool.accRewardPerShare) / ACC_REWARD_PRECISION);
        uint256 _pendingReward = accumulatedReward.sub(user.rewardDebt).toUint256();

        // Effects
        user.rewardDebt = accumulatedReward;

        // Interactions
        if (_pendingReward != 0) {
            REWARD.safeTransfer(to, _pendingReward);
        }

        IRewarder _rewarder = rewarder[pid];
        if (address(_rewarder) != address(0)) {
            _rewarder.onReward( pid, msg.sender, to, _pendingReward, user.amount);
        }

        emit Harvest(msg.sender, pid, _pendingReward);
    }

    /// @notice Withdraw LP tokens from MCV2 and harvest proceeds for transaction sender to `to`.
    /// @param pid The index of the pool. See `poolInfo`.
    /// @param amount LP token amount to withdraw.
    /// @param to Receiver of the LP tokens and rewards.
    function withdrawAndHarvest(uint256 pid, uint256 amount, address to) public {
        PoolInfo memory pool = updatePool(pid);
        UserInfo storage user = userInfo[pid][msg.sender];
        int256 accumulatedReward = int256(user.amount.mul(pool.accRewardPerShare) / ACC_REWARD_PRECISION);
        uint256 _pendingReward = accumulatedReward.sub(user.rewardDebt).toUint256();

        // Effects
        user.rewardDebt = accumulatedReward.sub(int256(amount.mul(pool.accRewardPerShare) / ACC_REWARD_PRECISION));
        user.amount = user.amount.sub(amount);

        // Interactions
        REWARD.safeTransfer(to, _pendingReward);

        IRewarder _rewarder = rewarder[pid];
        if (address(_rewarder) != address(0)) {
            _rewarder.onReward(pid, msg.sender, to, _pendingReward, user.amount);
        }

        lpToken[pid].safeTransfer(to, amount);

        emit Withdraw(msg.sender, pid, amount, to);
        emit Harvest(msg.sender, pid, _pendingReward);
    }

    /// @notice Withdraw without caring about rewards. EMERGENCY ONLY.
    /// @param pid The index of the pool. See `poolInfo`.
    /// @param to Receiver of the LP tokens.
    function emergencyWithdraw(uint256 pid, address to) public {
        UserInfo storage user = userInfo[pid][msg.sender];
        uint256 amount = user.amount;
        user.amount = 0;
        user.rewardDebt = 0;

        // Note: transfer can fail or succeed if `amount` is zero.
        lpToken[pid].safeTransfer(to, amount);
        emit EmergencyWithdraw(msg.sender, pid, amount, to);
    }

    /// @notice Give permission for an address to change the rewards duration
    /// @param _funder The address to be added
    function addFunder(address _funder) external onlyOwner {
        funder[_funder] = true;
        emit FunderAdded(_funder);
    }

    /// @notice Remove permission for an address to change the rewards duration
    /// @param _funder The address to be removed
    function removeFunder(address _funder) external onlyOwner {
        funder[_funder] = false;
        emit FunderRemoved(_funder);
    }

    modifier onlyFunder() {
        require(msg.sender == owner() || funder[msg.sender] == true, "MiniChefV2: caller is not a funder");
        _;
    }

    /// @notice Add funding and potentially extend duration of the rolling reward period
    /// @param funding Amount of reward token to add
    /// @param duration Total time (seconds) during which the additional funds are distributed
    function fundRewards(uint256 funding, uint256 duration) external onlyFunder {
        require(funding > 0, "MiniChefV2: funding cannot be zero");

        REWARD.safeTransferFrom(msg.sender, address(this), funding);

        if (block.timestamp >= rewardsExpiration) {
            require(duration > 0, "MiniChefV2: reward duration cannot be zero");
            massUpdateAllPools();
            rewardsExpiration = block.timestamp.add(duration);
            rewardPerSecond = funding / duration;
        } else {
            uint256 remainingTime = rewardsExpiration.sub(block.timestamp);
            uint256 remainingRewards = remainingTime.mul(rewardPerSecond);
            uint256 newRewardsExpiration = rewardsExpiration.add(duration);
            uint256 newRewardPerSecond = remainingRewards.add(funding) / (newRewardsExpiration.sub(block.timestamp));
            if (newRewardPerSecond != rewardPerSecond) {
                massUpdateAllPools();
            }
            rewardsExpiration = newRewardsExpiration;
            rewardPerSecond = newRewardPerSecond;
        }

        emit LogRewardPerSecond(rewardPerSecond);
        emit LogRewardsExpiration(rewardsExpiration);
    }

    /// @notice Allocate the existing rewards during a newly defined period starting now
    /// @param duration Time (seconds) to fully distribute the currently present rewards
    function resetRewardsDuration(uint256 duration) external onlyOwner {
        require(duration > 0, "MiniChefV2: reward duration cannot be zero");

        massUpdateAllPools();

        uint256 remainingTime = rewardsExpiration.sub(block.timestamp);
        uint256 remainingRewards = remainingTime.mul(rewardPerSecond);
        rewardsExpiration = block.timestamp.add(duration);
        rewardPerSecond = remainingRewards / (rewardsExpiration.sub(block.timestamp));

        emit LogRewardPerSecond(rewardPerSecond);
        emit LogRewardsExpiration(rewardsExpiration);
    }

    /// @notice Extends the rolling reward period by adding funds without changing the reward rate
    /// @param funding Amount of reward token to add
    /// @notice minExtension Minimum time (seconds) that the reward duration must be increased
    function extendRewardsViaFunding(uint256 funding, uint256 minExtension) external {
        require(funding > 0, "MiniChefV2: funding amount cannot be zero");

        uint256 extensionDuration = funding / rewardPerSecond;
        require(extensionDuration >= minExtension, "MiniChefV2: insufficient extension limit");

        rewardsExpiration = rewardsExpiration.add(extensionDuration);

        REWARD.safeTransferFrom(msg.sender, address(this), funding);

        emit LogRewardsExpiration(rewardsExpiration);
    }

    /// @notice Extends the rolling reward period by adding funds without changing the reward rate
    /// @param extension Time (seconds) to increase the rewards duration
    /// @param maxFunding Maximum amount of the reward token that can be used
    function extendRewardsViaDuration(uint256 extension, uint256 maxFunding) external {
        require(extension > 0, "MiniChefV2: extension duration cannot be zero");

        uint256 fundingRequired = rewardPerSecond.mul(extension);
        require(fundingRequired <= maxFunding, "MiniChefV2: insufficient funding limit");

        rewardsExpiration = rewardsExpiration.add(extension);

        REWARD.safeTransferFrom(msg.sender, address(this), fundingRequired);

        emit LogRewardsExpiration(rewardsExpiration);
    }
}
