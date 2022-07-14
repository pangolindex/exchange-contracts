// SPDX-License-Identifier: MIT

pragma solidity 0.8.13;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IChef {
    function lpToken(uint256 pid) external view returns (IERC20);
}

// @dev Modified from OpenZeppelin Contracts v4.4.1 (utils/math/SafeCast.sol)
library SimpleSafeCast {
    function toUint176(uint256 value) internal pure returns (uint176) {
        require(value <= type(uint176).max, "Value doesn't fit in 176 bits");
        return uint176(value);
    }
    function toUint40(uint256 value) internal pure returns (uint40) {
        require(value <= type(uint40).max, "Value doesn't fit in 40 bits");
        return uint40(value);
    }
}

contract SuperFarmRewarder is Ownable {
    using SimpleSafeCast for uint256;
    using SafeERC20 for IERC20;

    struct RewardInfo {
        IERC20 reward;
        uint256 rewardRatePerSecond;
        uint176 accRewardPerShare;
        uint40 beginning;
        uint40 expiration;
    }

    struct UserInfo {
        uint256 credits;
        uint256 debts;
    }

    uint256 public rewardCount;
    uint256 public constant MAX_REWARD_COUNT = 32;

    mapping(uint256 => RewardInfo) public rewardInfos;

    uint256 public lastUpdateTime;
    uint256 private lpSupply;

    mapping(address => uint256) public userAmounts;
    mapping(address => mapping(uint256 => UserInfo)) public userInfos;

    // Permissions (RewardID => Manager => Permission)
    mapping(uint256 => mapping(address => mapping(bytes32 => bool))) public permissions;
    bytes32 public constant MANAGE_PERMISSION = keccak256("MANAGE_PERMISSION");
    bytes32 public constant MODIFY_REWARD = keccak256("MODIFY_REWARD");
    bytes32 public constant FUND_REWARD = keccak256("FUND_REWARD");
    bytes32 public constant RENEW_REWARD = keccak256("RENEW_REWARD");
    bytes32 public constant CANCEL_REWARD = keccak256("CANCEL_REWARD");

    address public immutable CHEF;
    uint256 public immutable PID;

    uint256 private constant PRECISION = 1e18;
    uint256 private constant MAX_REWARD = type(uint256).max / PRECISION;

    event RewardPaid(uint256 indexed rewardId, address indexed owner, uint256 amount, address indexed to);
    event PermissionChange(uint256 indexed rewardId, bytes32 indexed permission, address indexed manager, bool allowed, address issuer);
    event RewardAdded(uint256 indexed rewardId, IERC20 reward, uint256 amount, uint40 beginning, uint40 expiration);
    event RewardModified(uint256 indexed rewardId, uint256 remainingRewards, uint256 newRewardRatePerSecond, uint40 newExpiration, address indexed issuer);
    event RewardFunded(uint256 indexed rewardId, uint256 amount, uint40 newExpiration, address indexed issuer);
    event RewardRenewed(uint256 indexed rewardId, uint256 amount, uint40 beginning, uint40 expiration, address indexed issuer);
    event RewardCancelled(uint256 indexed rewardId, uint256 remainingRewards, address to, address indexed issuer);

    constructor (
        address _CHEF,
        uint256 _PID,
        address owner
    ) {
        IERC20 lpToken = IChef(_CHEF).lpToken(_PID);
        require(address(lpToken) != address(0), "Invalid PID");
        CHEF = _CHEF;
        PID = _PID;
        transferOwnership(owner);
    }

    modifier onlyChef {
        require(msg.sender == CHEF, "Only Chef allowed");
        _;
    }

    /*
     * @dev Allows a user with a particular role scoped to a reward to perform certain actions
     * @dev Always allows the SuperFarm's owner to perform all permissioned actions
     */
    modifier onlyPermitted(bytes32 permission, uint256 rewardId) {
        require(rewardId < rewardCount, "Invalid reward ID");
        require(msg.sender == owner() || permissions[rewardId][msg.sender][permission], "Access denied");
        _;
    }

    function onReward(
        uint256 pid,
        address user,
        address recipient,
        uint256 rewardAmount,
        uint256 newLpAmount
    ) external onlyChef {
        require(pid == PID, "PID mismatch");

        uint256 _lpSupply = lpSupply;

        _updateRewards(_lpSupply);

        uint256 userAmount = userAmounts[user];

        uint256 _rewardCount = rewardCount;
        for (uint256 i; i < _rewardCount; ++i) {
            RewardInfo storage rewardInfo = rewardInfos[i];
            UserInfo storage userInfo = userInfos[user][i];
            if (userAmount > 0) {
                uint256 owed = userInfo.credits + (userAmount * rewardInfo.accRewardPerShare / PRECISION) - userInfo.debts;
                if (rewardAmount > 0) {
                    userInfo.credits = 0;
                    rewardInfo.reward.safeTransfer(recipient, owed);
                    emit RewardPaid(i, user, owed, recipient);
                } else {
                    userInfo.credits = owed;
                }
            }
            userInfo.debts = newLpAmount * rewardInfo.accRewardPerShare / PRECISION;
        }

        if (newLpAmount != userAmount) {
            lpSupply = _lpSupply - userAmount + newLpAmount;
        }

        userAmounts[user] = newLpAmount;
    }

    // @dev Claim desired rewards.
    // @dev onReward() should cover most harvest calls but scenarios exist where rewardAmount is 0
    function forceClaimRewards(uint256[] calldata rewardIds, address to) external {
        _updateRewards(lpSupply);

        uint256 userAmount = userAmounts[msg.sender];

        uint256 len = rewardIds.length;
        for (uint256 i; i < len; ++i) {
            uint256 rewardId = rewardIds[i];
            RewardInfo storage rewardInfo = rewardInfos[rewardId];
            UserInfo storage userInfo = userInfos[msg.sender][rewardId];
            uint256 accumulated = userAmount * rewardInfo.accRewardPerShare / PRECISION;
            uint256 owed = userInfo.credits + accumulated - userInfo.debts;
            userInfo.debts = accumulated;
            if (owed > 0) {
                userInfo.credits = 0;
                rewardInfo.reward.safeTransfer(to, owed);
                emit RewardPaid(rewardId, msg.sender, owed, to);
            }
        }
    }

    function getRewardInfos() external view returns (RewardInfo[] memory) {
        uint256 _rewardCount = rewardCount;

        RewardInfo[] memory _rewardInfos = new RewardInfo[](_rewardCount);

        for (uint256 i; i < _rewardCount; ++i) {
            _rewardInfos[i] = rewardInfos[i];
        }

        return _rewardInfos;
    }

    function pendingTokens(
        uint256 pid,
        address user,
        uint256 rewardAmount
    ) external view returns (
        IERC20[] memory rewardTokens,
        uint256[] memory rewardAmounts
    ) {
        uint256 _rewardCount = rewardCount;
        uint256 _lastUpdateTime = lastUpdateTime;
        uint256 userAmount = userAmounts[user];
        uint256 _lpSupply = lpSupply;

        rewardTokens = new IERC20[](_rewardCount);
        rewardAmounts = new uint256[](_rewardCount);

        for (uint256 i; i < _rewardCount; ++i) {
            RewardInfo memory rewardInfo = rewardInfos[i];
            UserInfo memory userInfo = userInfos[user][i];
            if (block.timestamp > _lastUpdateTime && block.timestamp > rewardInfo.beginning && _lpSupply > 0) {
                uint256 time;
                unchecked {
                    if (block.timestamp < rewardInfo.expiration) {
                        time = _lastUpdateTime > rewardInfo.beginning
                            ? block.timestamp - _lastUpdateTime // [last updated -> now]
                            : block.timestamp - rewardInfo.beginning; // [beginning -> now]
                    } else if (_lastUpdateTime < rewardInfo.expiration) {
                        time = _lastUpdateTime > rewardInfo.beginning
                            ? rewardInfo.expiration - _lastUpdateTime // [last updated -> expiration]
                            : rewardInfo.expiration - rewardInfo.beginning; // [beginning -> expiration]
                    }
                }
                uint256 pending = time * rewardInfo.rewardRatePerSecond; // range: [0, funding]
                rewardInfo.accRewardPerShare += (pending * PRECISION / _lpSupply).toUint176();
            }
            rewardTokens[i] = rewardInfos[i].reward;
            rewardAmounts[i] = userInfo.credits + (userAmount * rewardInfo.accRewardPerShare / PRECISION) - userInfo.debts;
        }

        return (rewardTokens, rewardAmounts);
    }

    function _updateRewards(uint256 _lpSupply) internal {
        uint256 _lastUpdateTime = lastUpdateTime;
        if (block.timestamp > _lastUpdateTime && _lpSupply > 0) {
            uint256 _rewardCount = rewardCount;
            for (uint256 i; i < _rewardCount; ++i) {
                RewardInfo storage rewardInfo = rewardInfos[i];
                if (block.timestamp > rewardInfo.beginning && _lastUpdateTime < rewardInfo.expiration) {
                    uint256 time; // range: [0, expiration - beginning]
                    unchecked {
                        if (block.timestamp < rewardInfo.expiration) {
                            time = _lastUpdateTime > rewardInfo.beginning
                                ? block.timestamp - _lastUpdateTime // [last updated -> now]
                                : block.timestamp - rewardInfo.beginning; // [beginning -> now]
                        } else if (_lastUpdateTime < rewardInfo.expiration) {
                            time = _lastUpdateTime > rewardInfo.beginning
                                ? rewardInfo.expiration - _lastUpdateTime // [last updated -> expiration]
                                : rewardInfo.expiration - rewardInfo.beginning; // [beginning -> expiration]
                        }
                    }
                    uint256 pending = time * rewardInfo.rewardRatePerSecond; // range: [0, funding]
                    rewardInfo.accRewardPerShare += (pending * PRECISION / _lpSupply).toUint176();
                }
            }
            lastUpdateTime = block.timestamp;
        }
    }

    /**
     * @dev Add a new reward campaign that begins later
     * @param reward - Reward token
     * @param amount - Reward amount to be distributed
     * @param beginning - Reward period start time
     * @param expiration - Reward period end time
     */
    function addReward(
        IERC20 reward,
        uint256 amount,
        uint40 beginning,
        uint40 expiration
    ) external onlyOwner {
        _addReward(reward, amount, beginning, expiration);
    }

    /**
     * @dev Add a new reward campaign that begins immediately
     * @param reward - Reward token
     * @param amount - Reward amount to be distributed
     * @param duration - Reward period length starting upon tx execution
     */
    function addRewardNow(
        IERC20 reward,
        uint256 amount,
        uint40 duration
    ) external onlyOwner {
        _addReward(reward, amount, uint40(block.timestamp), uint40(block.timestamp) + duration);
    }

    /**
     * @dev Called externally via addReward or addRewardNow
     */
    function _addReward(
        IERC20 reward,
        uint256 amount,
        uint40 beginning,
        uint40 expiration
    ) internal {
        require(amount > 0 && amount < MAX_REWARD, "Invalid amount");
        require(beginning >= block.timestamp, "Invalid beginning");
        require(expiration > beginning, "Invalid duration");

        uint256 _rewardCount = rewardCount++;
        require(_rewardCount < MAX_REWARD_COUNT, "Reward limit reached");

        _updateRewards(lpSupply);

        uint256 duration = expiration - beginning;
        uint256 rewardRatePerSecond = amount / duration;
        require(rewardRatePerSecond > 0, "Invalid reward rate");

        // Adjust for dust due to truncation during division
        amount = rewardRatePerSecond * duration;

        RewardInfo memory rewardInfo;
        rewardInfo.reward = reward;
        rewardInfo.beginning = beginning;
        rewardInfo.expiration = expiration;
        rewardInfo.rewardRatePerSecond = rewardRatePerSecond;
        rewardInfos[_rewardCount] = rewardInfo;

        reward.safeTransferFrom(msg.sender, address(this), amount);

        emit RewardAdded(_rewardCount, reward, amount, beginning, expiration);
    }

    /**
     * @dev Set reward-specific permissions to true/false
     * @param rewardId - Reward ID which the permission will apply
     * @param permission - Permission name
     * @param allowed - True when granting a permission, or False when removing a permission
     * @param manager - User whose permission is being modified
     */
    function setPermission(
        uint256 rewardId,
        bytes32 permission,
        bool allowed,
        address manager
    ) external onlyPermitted(MANAGE_PERMISSION, rewardId) {
        permissions[rewardId][manager][permission] = allowed;
        emit PermissionChange(rewardId, permission, manager, allowed, msg.sender);
    }

    /**
     * @dev Sets a new expiration date and calculates the appropriate reward rate
     * @dev Can be called before a period expires
     * @param rewardId - Reward ID of the reward being modified
     * @param expiration - New expiration time
     */
    function modifyRewardExpiration(
        uint256 rewardId,
        uint40 expiration
    ) external onlyPermitted(MODIFY_REWARD, rewardId) {
        _updateRewards(lpSupply);

        RewardInfo storage rewardInfo = rewardInfos[rewardId];

        require(rewardInfo.rewardRatePerSecond > 0, "Reward is cancelled");
        require(block.timestamp < rewardInfo.expiration, "Reward is expired");
        require(expiration != rewardInfo.expiration, "Identical period");
        require(
            expiration > rewardInfo.beginning && expiration > block.timestamp,
            "Invalid reward period"
        );

        // range: [rewardInfo.beginning, rewardInfo.expiration)
        uint40 extensionTime = block.timestamp > rewardInfo.beginning
            ? uint40(block.timestamp)
            : rewardInfo.beginning;

        uint256 remainingRewards = (rewardInfo.expiration - extensionTime) * rewardInfo.rewardRatePerSecond;
        uint256 newDuration = expiration - extensionTime;
        uint256 newRewardRatePerSecond = remainingRewards / newDuration;
        require(newRewardRatePerSecond > 0, "Invalid reward rate");

        // Dust created due to truncation during division
        uint256 dust = remainingRewards - (newRewardRatePerSecond * newDuration);

        rewardInfo.expiration = expiration;
        rewardInfo.rewardRatePerSecond = newRewardRatePerSecond;

        if (dust > 0) {
            rewardInfo.reward.safeTransfer(msg.sender, dust);
        }

        emit RewardModified(rewardId, remainingRewards, newRewardRatePerSecond, expiration, msg.sender);
    }

    /**
     * @dev Adds funding for a reward (at the current rate) and calculates the appropriate expiration
     * @dev Can be called before a period expires or is cancelled
     * @param rewardId - Reward ID of the reward being changed
     * @param amount - Additional reward funding to add
     */
    function fundReward(
        uint256 rewardId,
        uint256 amount
    ) external onlyPermitted(FUND_REWARD, rewardId) {
        require(amount > 0, "Invalid amount");

        _updateRewards(lpSupply);

        RewardInfo storage rewardInfo = rewardInfos[rewardId];

        require(rewardInfo.rewardRatePerSecond > 0, "Reward is cancelled");
        require(block.timestamp < rewardInfo.expiration, "Reward is expired");

        uint256 extraDuration = amount / rewardInfo.rewardRatePerSecond;
        require(extraDuration > 0, "Invalid duration");

        uint256 remainingTime = block.timestamp > rewardInfo.beginning
            ? rewardInfo.expiration - block.timestamp
            : rewardInfo.expiration - rewardInfo.beginning;

        uint256 remainingRewards = remainingTime * rewardInfo.rewardRatePerSecond;
        require(remainingRewards + amount < MAX_REWARD);

        // Adjust for dust due to truncation during division
        amount = rewardInfo.rewardRatePerSecond * extraDuration;

        rewardInfo.expiration += extraDuration.toUint40();

        rewardInfo.reward.safeTransferFrom(msg.sender, address(this), amount);

        emit RewardFunded(rewardId, amount, rewardInfo.expiration, msg.sender);
    }

    /**
     * @dev Defines a new campaign for an existing reward that begins later
     * @dev Can be called after a period has expired or been cancelled
     * @param rewardId - Reward ID of the reward being renewed
     * @param amount - Reward funding to add
     * @param beginning - Start time of the reward period
     * @param expiration - End time of the reward period
     */
    function renewReward(
        uint256 rewardId,
        uint256 amount,
        uint40 beginning,
        uint40 expiration
    ) external onlyPermitted(RENEW_REWARD, rewardId) {
        _renewReward(rewardId, amount, beginning, expiration);
    }

    /**
     * @dev Defines a new campaign for an existing reward that begins immediately
     * @dev Can be called after a period has expired or been cancelled
     * @param rewardId - Reward ID of the reward being renewed
     * @param amount - Reward funding to add
     * @param duration - Total time of the reward period
     */
    function renewRewardNow(
        uint256 rewardId,
        uint256 amount,
        uint40 duration
    ) external onlyPermitted(RENEW_REWARD, rewardId) {
        _renewReward(rewardId, amount, uint40(block.timestamp), uint40(block.timestamp) + duration);
    }

    /**
     * @dev Called externally via renewReward or renewRewardNow
     */
    function _renewReward(
        uint256 rewardId,
        uint256 amount,
        uint40 beginning,
        uint40 expiration
    ) internal {
        require(amount > 0 && amount < MAX_REWARD, "Invalid amount");
        require(beginning >= block.timestamp, "Invalid beginning");
        require(expiration > beginning, "Invalid duration");

        _updateRewards(lpSupply);

        RewardInfo storage rewardInfo = rewardInfos[rewardId];

        require(
            block.timestamp >= rewardInfo.expiration || rewardInfo.rewardRatePerSecond == 0,
            "Reward is not expired"
        );

        uint256 duration = expiration - beginning;
        uint256 rewardRatePerSecond = amount / duration;
        require(rewardRatePerSecond > 0, "Invalid reward rate");

        // Adjust for dust due to truncation during division
        amount = rewardRatePerSecond * duration;

        rewardInfo.beginning = beginning;
        rewardInfo.expiration = expiration;
        rewardInfo.rewardRatePerSecond = rewardRatePerSecond;

        rewardInfo.reward.safeTransferFrom(msg.sender, address(this), amount);

        emit RewardRenewed(rewardId, amount, beginning, expiration, msg.sender);
    }

    /**
     * @dev Cancel a reward period which still has unallocated rewards and recover this amount
     * @dev Cannot cancel a reward that has already been fully allocated
     * @param rewardId - Reward ID of the reward being changed
     * @param to - Recipient of the remaining rewards
	 */
    function cancelReward(
        uint256 rewardId,
        address to
    ) public onlyPermitted(CANCEL_REWARD, rewardId) {
        _updateRewards(lpSupply);

        RewardInfo storage rewardInfo = rewardInfos[rewardId];

        uint40 cancellationTime = rewardInfo.beginning;

        // Return entire amount if no deposits where made
        if (rewardInfo.accRewardPerShare > 0) {
            require(block.timestamp < rewardInfo.expiration, "Fully allocated");

            if (block.timestamp > rewardInfo.beginning) {
                // range: [rewardInfo.beginning, rewardInfo.expiration)
                cancellationTime = uint40(block.timestamp);
            }
        }

        uint256 remainingRewards = (rewardInfo.expiration - cancellationTime) * rewardInfo.rewardRatePerSecond;

        rewardInfo.rewardRatePerSecond = 0;
        rewardInfo.expiration = cancellationTime;

        rewardInfo.reward.safeTransfer(to, remainingRewards);

        emit RewardCancelled(rewardId, remainingRewards, to, msg.sender);
    }

    /**
     * @dev Safety method to recover non-reward tokens sent to this contract
     * @param recoveryToken - Token to be recovered
     * @param to - Recipient of the recovered token
     */
    function recoverERC20(
        IERC20 recoveryToken,
        address to
    ) external onlyOwner {
        uint256 _rewardCount = rewardCount;
        for (uint256 i; i < _rewardCount; ++i) {
            IERC20 reward = rewardInfos[i].reward;
            require(recoveryToken != reward, "Cannot recover reward asset");
        }
        uint256 tokenBalance = recoveryToken.balanceOf(address(this));
        recoveryToken.safeTransfer(to, tokenBalance);
    }

}
