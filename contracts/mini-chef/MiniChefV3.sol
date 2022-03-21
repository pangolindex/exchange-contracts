// SPDX-License-Identifier: MIT

pragma solidity 0.8.13;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";

import "./IRewarderV2.sol";
import "./IERC20Permit.sol";

contract MiniChefV3 is Ownable {
    using SafeCast for int256;
    using SafeCast for uint256;
    using SafeERC20 for IERC20;
    using SafeERC20 for IERC20Permit;

    struct UserInfo {
        uint256 amount;
        int256 rewardDebt;
    }

    struct PoolInfo {
        uint128 accRewardPerShare;
        uint64 lastRewardTime;
        uint64 allocPoint;
    }

    uint256 public poolCount;

    mapping(uint256 => PoolInfo) public poolInfo;
    mapping(uint256 => IERC20Permit) public lpToken;
    mapping(uint256 => IRewarderV2) public rewarder;

    mapping(uint256 => mapping(address => UserInfo)) public userInfo;

    mapping(address => bool) public addedTokens;

    /// @dev Addresses allowed to change rewardsExpiration duration
    mapping(address => bool) public funder;

    /// @notice Address of reward (PNG) contract.
    IERC20 public immutable REWARD;

    /// @dev Block time when the rewards per second stops
    uint256 public rewardsExpiration;

    uint256 public rewardPerSecond;
    uint256 private constant ACC_REWARD_PRECISION = 1e12;

    /// @dev Total allocation points. Must be the sum of all allocation points in all pools.
    uint256 public immutable TOTAL_ALLOC_POINT;

    event Deposit(address indexed user, uint256 indexed pid, uint256 amount, address indexed to);
    event Withdraw(address indexed user, uint256 indexed pid, uint256 amount, address indexed to);
    event EmergencyWithdraw(address indexed user, uint256 indexed pid, uint256 amount, address indexed to);
    event Harvest(address indexed user, uint256 indexed pid, uint256 amount);
    event PoolAdded(uint256 indexed pid, IERC20Permit indexed lpToken, IRewarderV2 indexed rewarder);
    event PoolSetAllocPoint(uint256 indexed pid, uint256 allocPoint);
    event PoolSetRewarder(uint256 indexed pid, IRewarderV2 indexed rewarder);
    event PoolUpdate(uint256 indexed pid, uint64 lastRewardTime, uint256 accRewardPerShare);
    event FunderAdded(address funder);
    event FunderRemoved(address funder);
    event LogRewardPerSecond(uint256 rewardPerSecond);
    event LogRewardsExpiration(uint256 rewardsExpiration);

    constructor(address rewardToken, uint256 totalAllocPoint, address firstOwner) {
        require(
            rewardToken != address(0) && firstOwner != address(0),
            "Invalid zero address"
        );

        require(totalAllocPoint > 0, "Insufficient allocation points");

        TOTAL_ALLOC_POINT = totalAllocPoint;
        REWARD = IERC20(rewardToken);
        transferOwnership(firstOwner);
    }

    function getAllPoolInfos() external view returns (PoolInfo[] memory) {
        uint256 len = poolCount;
        PoolInfo[] memory allPoolInfos = new PoolInfo[](len);
        for (uint256 i; i < len; ++i) {
            allPoolInfos[i] = poolInfo[i];
        }
        return allPoolInfos;
    }

    function getAllLpTokens() external view returns (IERC20Permit[] memory) {
        uint256 len = poolCount;
        IERC20Permit[] memory allLpTokens = new IERC20Permit[](len);
        for (uint256 i; i < len; ++i) {
            allLpTokens[i] = lpToken[i];
        }
        return allLpTokens;
    }

    function getAllRewarders() external view returns (IRewarderV2[] memory) {
        uint256 len = poolCount;
        IRewarderV2[] memory allRewarders = new IRewarderV2[](len);
        for (uint256 i; i < len; ++i) {
            allRewarders[i] = rewarder[i];
        }
        return allRewarders;
    }

    function addPools(IERC20Permit[] calldata _lpTokens, IRewarderV2[] calldata _rewarders) external onlyOwner {
        uint256 len = _lpTokens.length;
        require(len == _rewarders.length, "Invalid parameter lengths");

        for (uint256 i; i < len; ++i) {
            IERC20Permit _lpToken = _lpTokens[i];
            IRewarderV2 _rewarder = _rewarders[i];
            uint256 newPid = poolCount;

            require(addedTokens[address(_lpToken)] == false, "Token already added");
            lpToken[newPid] = _lpToken;
            rewarder[newPid] = _rewarder;

            PoolInfo memory pool;
            // Omit redundant assignments of accRewardPerShare = 0 and allocPoint = 0
            pool.lastRewardTime = block.timestamp.toUint64();
            poolInfo[newPid] = pool;

            addedTokens[address(_lpToken)] = true;
            poolCount = newPid + 1;
            emit PoolAdded(newPid, _lpToken, _rewarder);
        }
    }

    function setAllocPoints(uint256[] calldata pids, uint64[] calldata allocPoints) external onlyOwner {
        uint256 len = pids.length;
        require(len == allocPoints.length, "Invalid parameter lengths");

        uint64 oldAllocPointSum;
        uint64 newAllocPointSum;

        for (uint256 i; i < len; ++i) {
            uint256 pid = pids[i];
            uint64 allocPoint = allocPoints[i];

            PoolInfo memory pool = updatePool(pid);
            unchecked { oldAllocPointSum += pool.allocPoint; } // SUM(pool.allocPoint) <= TOTAL_ALLOC_POINT
            newAllocPointSum += allocPoint;
            poolInfo[pid].allocPoint = allocPoint;

            emit PoolSetAllocPoint(pid, allocPoint);
        }

        if (len == poolCount) {
            /// Handles first assignment where all pool.allocPoint = 0
            require(newAllocPointSum == TOTAL_ALLOC_POINT, "Illegal allocPoint adjustment");
        } else {
            require(newAllocPointSum == oldAllocPointSum, "Illegal allocPoint adjustment");
        }
    }

    function setRewarders(uint256[] calldata pids, IRewarderV2[] calldata rewarders) external onlyOwner {
        uint256 len = pids.length;
        require(len == rewarders.length, "Invalid parameter lengths");

        for (uint256 i; i < len; ++i) {
            uint256 pid = pids[i];
            IRewarderV2 _rewarder = rewarders[i];

            rewarder[pid] = _rewarder;
            emit PoolSetRewarder(pid, _rewarder);
        }
    }

    function pendingReward(uint256 pid, address recipient) public view returns (uint256 pending) {
        PoolInfo memory pool = poolInfo[pid];
        UserInfo storage user = userInfo[pid][recipient];
        uint256 accRewardPerShare = pool.accRewardPerShare;
        uint256 lpSupply = lpToken[pid].balanceOf(address(this));
        if (block.timestamp > pool.lastRewardTime && lpSupply > 0) {
            uint256 time = block.timestamp <= rewardsExpiration
                ? block.timestamp - pool.lastRewardTime // Accrue rewards until now
                : rewardsExpiration > pool.lastRewardTime
                    ? rewardsExpiration - pool.lastRewardTime // Accrue rewards until expiration
                    : 0; // No rewards to accrue
            uint256 reward = time * rewardPerSecond * pool.allocPoint / TOTAL_ALLOC_POINT;
            accRewardPerShare += (reward * ACC_REWARD_PRECISION / lpSupply);
        }
        pending = (int256(user.amount * accRewardPerShare / ACC_REWARD_PRECISION) - user.rewardDebt).toUint256();
    }

    function deposit(uint256 pid, uint256 amount, address to) public {
        PoolInfo memory pool = updatePool(pid);
        UserInfo storage user = userInfo[pid][to];

        // Effects
        user.amount += amount;
        user.rewardDebt += int256(amount * pool.accRewardPerShare / ACC_REWARD_PRECISION);

        // Interactions
        IRewarderV2 _rewarder = rewarder[pid];
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

    function withdraw(uint256 pid, uint256 amount, address to) external {
        PoolInfo memory pool = updatePool(pid);
        UserInfo storage user = userInfo[pid][msg.sender];

        // Effects
        user.rewardDebt -= int256(amount * pool.accRewardPerShare / ACC_REWARD_PRECISION);
        user.amount -= amount;

        // Interactions
        IRewarderV2 _rewarder = rewarder[pid];
        if (address(_rewarder) != address(0)) {
            _rewarder.onReward(pid, msg.sender, to, 0, user.amount);
        }

        lpToken[pid].safeTransfer(to, amount);

        emit Withdraw(msg.sender, pid, amount, to);
    }

    function harvest(uint256 pid, address to) public {
        PoolInfo memory pool = updatePool(pid);
        UserInfo storage user = userInfo[pid][msg.sender];
        int256 accumulatedReward = int256(user.amount * pool.accRewardPerShare / ACC_REWARD_PRECISION);
        uint256 _pendingReward = (accumulatedReward - user.rewardDebt).toUint256();

        // Effects
        user.rewardDebt = accumulatedReward;

        // Interactions
        if (_pendingReward > 0) {
            REWARD.safeTransfer(to, _pendingReward);
        }

        IRewarderV2 _rewarder = rewarder[pid];
        if (address(_rewarder) != address(0)) {
            _rewarder.onReward( pid, msg.sender, to, _pendingReward, user.amount);
        }

        emit Harvest(msg.sender, pid, _pendingReward);
    }

    function harvestMultiple(uint256[] calldata pids, address to) external {
        uint256 len = pids.length;
        for (uint256 i; i < len; ++i) {
            harvest(pids[i], to);
        }
    }

    /// @notice Returns a list of pids which can be harvested. Use this list with `harvestMultiple`
    function getHarvestablePids(address user) external view returns (uint256[] memory pids) {
        uint256 counter;
        uint256 len = poolCount;

        uint256[] memory temp = new uint256[](len);

        for (uint256 pid; pid < len; ++pid) {
            uint256 _pendingReward = pendingReward(pid, user);

            if (_pendingReward > 0) {
                temp[counter++] = pid;
                continue;
            }

            IRewarderV2 _rewarder = rewarder[pid];
            if (address(_rewarder) != address(0)) {
                (, uint256[] memory amounts) = _rewarder.pendingTokens(pid, user, _pendingReward);
                uint256 amountLength = amounts.length;
                for (uint256 i; i < amountLength; ++i) {
                    if (amounts[i] > 0) {
                        temp[counter++] = pid;
                        break;
                    }
                }
            }
        }

        pids = new uint256[](counter);

        for (uint256 i; i < counter; ++i) {
            pids[i] = temp[i];
        }
    }

    /// @notice Withdraw LP tokens from MCV3 and harvest proceeds for transaction sender to `to`
    function withdrawAndHarvest(uint256 pid, uint256 amount, address to) external {
        PoolInfo memory pool = updatePool(pid);
        UserInfo storage user = userInfo[pid][msg.sender];
        int256 accumulatedReward = int256(user.amount * pool.accRewardPerShare / ACC_REWARD_PRECISION);
        uint256 _pendingReward = (accumulatedReward - user.rewardDebt).toUint256();

        // Effects
        user.rewardDebt = accumulatedReward - int256(amount * pool.accRewardPerShare / ACC_REWARD_PRECISION);
        user.amount -= amount;

        // Interactions
        REWARD.safeTransfer(to, _pendingReward);

        IRewarderV2 _rewarder = rewarder[pid];
        if (address(_rewarder) != address(0)) {
            _rewarder.onReward(pid, msg.sender, to, _pendingReward, user.amount);
        }

        lpToken[pid].safeTransfer(to, amount);

        emit Withdraw(msg.sender, pid, amount, to);
        emit Harvest(msg.sender, pid, _pendingReward);
    }

    /// @notice Withdraw without caring about rewards. EMERGENCY ONLY.
    function emergencyWithdraw(uint256 pid, address to) external {
        UserInfo storage user = userInfo[pid][msg.sender];
        uint256 amount = user.amount;
        user.amount = 0;
        user.rewardDebt = 0;

        IRewarderV2 _rewarder = rewarder[pid];
        if (address(_rewarder) != address(0)) {
            _rewarder.onReward(pid, msg.sender, to, 0, 0);
        }

        // Note: transfer can fail or succeed if `amount` is zero.
        lpToken[pid].safeTransfer(to, amount);
        emit EmergencyWithdraw(msg.sender, pid, amount, to);
    }

    /// @notice Update reward variables of the given pool
    function updatePool(uint256 pid) internal returns (PoolInfo memory pool) {
        pool = poolInfo[pid];
        if (block.timestamp > pool.lastRewardTime) {
            if (pool.allocPoint > 0) {
                uint256 lpSupply = lpToken[pid].balanceOf(address(this));
                if (lpSupply > 0) {
                    uint256 time = block.timestamp <= rewardsExpiration
                        ? block.timestamp - pool.lastRewardTime // Accrue rewards until now
                        : rewardsExpiration > pool.lastRewardTime
                            ? rewardsExpiration - pool.lastRewardTime // Accrue rewards until expiration
                            : 0; // No rewards to accrue
                    uint256 reward = time * rewardPerSecond * pool.allocPoint / TOTAL_ALLOC_POINT;
                    pool.accRewardPerShare += (reward * ACC_REWARD_PRECISION / lpSupply).toUint128();
                }
            }
            pool.lastRewardTime = block.timestamp.toUint64();
            poolInfo[pid] = pool;
            emit PoolUpdate(pid, pool.lastRewardTime, pool.accRewardPerShare);
        }
    }

    /// @notice Update reward variables for all pools. Be careful of gas spending!
    function updateAllPools() internal {
        uint256 len = poolCount;
        for (uint256 pid; pid < len; ++pid) {
            updatePool(pid);
        }
    }

    modifier onlyFunder() {
        require(msg.sender == owner() || funder[msg.sender] == true, "Caller is not a funder");
        _;
    }

    /// @notice Give permission for an address to change the rewards duration
    function addFunder(address _funder) external onlyOwner {
        funder[_funder] = true;
        emit FunderAdded(_funder);
    }

    /// @notice Remove permission for an address to change the rewards duration
    function removeFunder(address _funder) external onlyOwner {
        funder[_funder] = false;
        emit FunderRemoved(_funder);
    }

    /// @notice Add funding and potentially extend duration of the rolling reward period
    function fundRewards(uint256 funding, uint256 duration) external onlyFunder {
        require(funding > 0, "Funding cannot be zero");

        REWARD.safeTransferFrom(msg.sender, address(this), funding);

        if (block.timestamp >= rewardsExpiration) {
            require(duration > 0, "Reward duration cannot be zero");
            updateAllPools();
            uint256 newRewardsExpiration = block.timestamp + duration;
            rewardsExpiration = newRewardsExpiration;
            rewardPerSecond = funding / duration;
            emit LogRewardPerSecond(rewardPerSecond);
            emit LogRewardsExpiration(newRewardsExpiration);
        } else {
            uint256 remainingTime = rewardsExpiration - block.timestamp;
            uint256 remainingRewards = remainingTime * rewardPerSecond;
            uint256 newRewardsExpiration = rewardsExpiration + duration;
            uint256 newRewardPerSecond = (remainingRewards + funding) / (newRewardsExpiration - block.timestamp);
            if (newRewardPerSecond != rewardPerSecond) {
                updateAllPools();
                rewardPerSecond = newRewardPerSecond;
                emit LogRewardPerSecond(newRewardPerSecond);
            }
            rewardsExpiration = newRewardsExpiration;
            emit LogRewardsExpiration(newRewardsExpiration);
        }
    }

    function resetRewardsPerSecond(uint256 newRewardsPerSecond, uint256 minRewardsExpiration, uint256 maxRewardsExpiration) external onlyOwner {
        require(newRewardsPerSecond > 0, "Reward rate cannot be zero");

        updateAllPools();

        uint256 remainingTime = rewardsExpiration - block.timestamp;
        uint256 remainingRewards = remainingTime * rewardPerSecond;

        rewardPerSecond = newRewardsPerSecond;
        rewardsExpiration = block.timestamp + (remainingRewards / newRewardsPerSecond);

        require(rewardsExpiration > block.timestamp, "Expiration has already passed");
        require(rewardsExpiration > minRewardsExpiration && rewardsExpiration < maxRewardsExpiration, "Expiration exceeds bounds");

        emit LogRewardPerSecond(newRewardsPerSecond);
        emit LogRewardsExpiration(rewardsExpiration);
    }

    /// @notice Extends the rolling reward period by adding funds without changing the reward rate
    function extendRewardsViaFunding(uint256 funding, uint256 minExtension) external {
        require(funding > 0, "Funding amount cannot be zero");

        uint256 extensionDuration = funding / rewardPerSecond;
        require(extensionDuration >= minExtension, "Insufficient extension limit");

        rewardsExpiration += extensionDuration;

        REWARD.safeTransferFrom(msg.sender, address(this), funding);

        emit LogRewardsExpiration(rewardsExpiration);
    }

}
