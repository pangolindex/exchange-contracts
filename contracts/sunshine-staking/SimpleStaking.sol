// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/IRewardRegulator.sol";

/**
 * @title Simple Staking for Reward Regulator
 * @notice Simple Staking (with Synthetix' Staking Rewards algorithm)
 * that works by being coupled with  Reward Regulator.
 * @author shung for Pangolin
 */
contract SimpleStaking is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct User {
        uint stash;
        uint balance;
        uint rewardPerTokenPaid;
    }

    /// @notice Mapping of user addresses to their info
    mapping(address => User) public users;

    /// @notice The contract that determines the rewards of this contract
    IRewardRegulator public immutable rewardRegulator;

    /// @notice The token that is distributed as reward
    IERC20 public immutable rewardToken;

    /// @notice The token that can be staked in the contract
    IERC20 public immutable stakingToken;

    /// @notice The multiplier to prevent high precision loss
    uint private constant PRECISION = 1e18;

    /// @notice The amount of reward tokens for each staking token
    uint private _rewardPerTokenStored;

    /// @notice Total amount of tokens staked in the contract
    uint public totalSupply;

    event Staked(address indexed user, uint amount);
    event Withdrawn(address indexed user, uint amount, uint reward);
    event Harvested(address indexed user, uint reward);
    event Exited(address indexed user, uint amount);

    modifier update() {
        _rewardPerTokenStored += ((rewardRegulator.claim() * PRECISION) /
            totalSupply);
        _;
    }

    /**
     * @notice Constructs the Simple Staking Contract for Reward Regulator
     * @param newStakingToken The token that will be staked for rewards
     * @param newRewardRegulator The contract that will determine reward rate
     */
    constructor(address newStakingToken, address newRewardRegulator) {
        require(
            newStakingToken != address(0) && newRewardRegulator != address(0),
            "Constructor: zero address"
        );
        stakingToken = IERC20(newStakingToken);
        rewardRegulator = IRewardRegulator(newRewardRegulator);
        rewardToken = IRewardRegulator(newRewardRegulator).rewardToken();
    }

    /// @notice Stakes `amount` tokens to user
    function stake(uint amount) external nonReentrant update {
        User storage user = users[msg.sender];
        require(amount != 0, "stake: zero amount");

        totalSupply += amount;
        user.stash += ((user.balance *
            (_rewardPerTokenStored - user.rewardPerTokenPaid)) / PRECISION);
        user.balance += amount;
        user.rewardPerTokenPaid = _rewardPerTokenStored;

        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
        emit Staked(msg.sender, amount);
    }

    /// @notice Withdraws `amount` tokens of users and harvests pending rewards
    function withdraw(uint amount) external nonReentrant update {
        User storage user = users[msg.sender];
        require(user.balance >= amount, "withdraw: insufficient balance");
        require(amount != 0, "withdraw: zero amount");

        uint reward = user.stash +
            (user.balance * (_rewardPerTokenStored - user.rewardPerTokenPaid)) /
            PRECISION;

        totalSupply -= amount;
        user.stash = 0;
        user.rewardPerTokenPaid = _rewardPerTokenStored;
        unchecked {
            user.balance -= amount;
        }

        if (reward != 0) rewardToken.safeTransfer(msg.sender, reward);
        stakingToken.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount, reward);
    }

    /// @notice Harvests all rewards of a user
    function harvest() external nonReentrant update {
        User storage user = users[msg.sender];

        uint reward = user.stash +
            (user.balance * (_rewardPerTokenStored - user.rewardPerTokenPaid)) /
            PRECISION;
        require(reward != 0, "harvest: nothing to harvest");

        user.rewardPerTokenPaid = _rewardPerTokenStored;
        user.stash = 0;

        rewardToken.safeTransfer(msg.sender, reward);
        emit Harvested(msg.sender, reward);
    }

    /// @notice Withdraws all tokens without harvesting rewards (emergency only)
    function emergencyExit() external {
        User storage user = users[msg.sender];
        uint amount = user.balance;
        totalSupply -= amount;
        user.balance = 0;
        stakingToken.safeTransfer(msg.sender, amount);
        emit Exited(msg.sender, amount);
    }

    /// @notice Gets the pending rewards of a user
    function earned() external view returns (uint) {
        User memory user = users[msg.sender];
        return
            user.stash +
            (user.balance * (rewardPerToken() - user.rewardPerTokenPaid)) /
            PRECISION;
    }

    /// @notice Gets the pending rewards of a user
    function rewardPerToken() public view returns (uint) {
        return
            _rewardPerTokenStored +
            (rewardRegulator.pendingRewards(address(this)) * PRECISION) /
            totalSupply;
    }
}
