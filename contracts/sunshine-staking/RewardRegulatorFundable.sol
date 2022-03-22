// SPDX-License-Identifier: MIT
// solhint-disable not-rely-on-time
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/**
 * @title Fundable Reward Regulator
 * @notice A StakingRewards replacement that distributes to multiple contracts
 * @dev This contract is a partial implementation of Synthetix' StakingRewards.
 * The contract does not hold any staking tokens, and lacks withdrawing,
 * harvesting, and staking functions. It only holds the reward token, and
 * distributes the reward token to downstream recipient contracts. In essence,
 * this is StakingRewards broken into two components. First component is this
 * contract, which holds the reward token and then determines the global reward
 * rate. The second component is separate contracts which handle distribution
 * of rewards to end users. We will call these separate contracts recipients.
 * A recipient contract must call `claim()` of RewardRegulator to receive its
 * reward since its last `claim()` call. Then the recipient should manage
 * distributing the tokens in its balance to end users. RewardRegulator is
 * agnostic to how the recipient distributes its rewards.
 * @author shung for Pangolin
 */
contract RewardRegulatorFundable is AccessControl {
    using EnumerableSet for EnumerableSet.AddressSet;
    using SafeERC20 for IERC20;
    using SafeCast for int;
    using SafeMath for uint;

    struct Recipient {
        uint weight; // The emission weight of the recipient
        uint stash; // The reward amount stashed when weight changes
        uint rewardPerWeightPaid; // The _rewardPerWeightStored on update
    }

    /// @notice The mapping of accounts (i.e. recipients) to their information
    mapping(address => Recipient) public recipients;

    /// @notice A set of recipient addresses (for interfacing/transparency)
    EnumerableSet.AddressSet private _recipients;

    /// @notice The reward token the contract will distribute
    IERC20 public immutable rewardToken;

    /// @notice The duration of staking after `notifyRewardAmount` is called
    uint public rewardsDuration = 1 days;

    /// @notice The end time of the reward period
    uint public periodFinish;

    /// @notice Rewards emitted per second
    uint public rewardRate;

    /// @notice Sum of all weight
    uint public totalWeight;

    /// @notice The timestamp of the last update
    uint private _lastUpdate;

    /// @notice The amount of reward tokens reserved to be distributed
    uint private _reserved;

    /// @notice Total rewards emitted per weight until last update
    uint private _rewardPerWeightStored;

    /// @notice The role for calling `notifyRewardAmount` function
    bytes32 private constant FUNDER = keccak256("FUNDER");

    event RecipientSet(address indexed account, uint newWeight);
    event Claimed(address indexed account, uint reward);
    event RewardAdded(uint reward);
    event RewardsDurationUpdated(uint newDuration);

    /**
     * @notice Construct a new RewardRegulatorFundable contract
     * @param newRewardToken The reward token the contract will distribute
     */
    constructor(address newRewardToken) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        require(newRewardToken != address(0), "Construct: zero address");
        rewardToken = IERC20(newRewardToken);
    }

    /**
     * @notice Sends the rewards to message sender
     * @return The amount of reward tokens that became eligible for claiming
     */
    function claim() external returns (uint) {
        address sender = msg.sender;
        Recipient storage recipient = recipients[sender];

        _globalUpdate();

        uint reward = pendingRewards(sender);
        require(reward != 0, "setReward: no rewards");

        recipient.rewardPerWeightPaid = _rewardPerWeightStored;
        recipient.stash = 0;

        _reserved -= reward;

        rewardToken.safeTransfer(sender, reward);
        emit Claimed(sender, reward);

        return reward;
    }

    /**
     * @notice Withdraws `amount` of `token` to message sender
     * @param token Address of the token to withdraw
     * @param amount Amount of token to withdraw
     */
    function recover(IERC20 token, uint amount)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(
            token != rewardToken || unreserved() >= amount,
            "recover: insufficient unlocked supply"
        );
        token.safeTransfer(msg.sender, amount);
    }

    /**
     * @notice Changes how long the distribution will last for
     * @param newRewardsDuration The length of the nex distribution
     */
    function setRewardsDuration(uint newRewardsDuration)
        external
        onlyRole(FUNDER)
    {
        require(
            block.timestamp > periodFinish,
            "setRewardsDuration: ongoing period"
        );
        require(
            newRewardsDuration != 0,
            "setRewardsDuration: invalid duration length"
        );
        rewardsDuration = newRewardsDuration;
        emit RewardsDurationUpdated(rewardsDuration);
    }

    /**
     * @notice Starts or extends a period by adding rewards
     * @dev Requires that enough tokens are transferred beforehand
     * @param reward The added amount of rewards
     */
    function notifyRewardAmount(uint reward) external onlyRole(FUNDER) {
        uint blockTime = block.timestamp;
        require(totalWeight != 0, "notifyRewardAmount: no recipients");
        require(reward != 0, "notifyRewardAmount: zero reward");
        require(
            unreserved() >= reward,
            "notifyRewardAmount: insufficient balance for reward"
        );

        _globalUpdate();

        // Set new reward rate after setting _rewardPerWeightStored
        if (blockTime >= periodFinish) {
            rewardRate = reward / rewardsDuration;
        } else {
            uint leftover = (periodFinish - blockTime) * rewardRate;
            rewardRate = (reward + leftover) / rewardsDuration;
        }

        // update the end of this period after setting reward rate
        periodFinish = blockTime + rewardsDuration;

        _reserved += reward;
        emit RewardAdded(reward);
    }

    /**
     * @notice Changes recipient weights
     * @dev It is suggested to use two decimals for weights (e.g.: 100 for 1x)
     * @param accounts The list of addresses to have new weights
     * @param weights The list of weights corresponding to `accounts`
     */
    function setRecipients(address[] calldata accounts, uint[] calldata weights)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(
            accounts.length == weights.length,
            "setRecipients: arrays must be of equal lengths"
        );

        _globalUpdate();

        for (uint i; i < weights.length; ++i) {
            address account = accounts[i];
            uint weight = weights[i];
            Recipient storage recipient = recipients[account];

            uint oldWeight = recipient.weight;
            require(weight != oldWeight, "setRecipients: same weight");
            totalWeight += weight - oldWeight;

            // add or remove the recipient to/from the set
            if (oldWeight == 0) _recipients.add(account);
            if (weight == 0) _recipients.remove(account);

            // stash the unclaimed rewards
            recipient.stash = pendingRewards(account);
            recipient.rewardPerWeightPaid = _rewardPerWeightStored;
            recipient.weight = weight;

            emit RecipientSet(account, weight);
        }

        require(
            totalWeight != 0 || block.timestamp > periodFinish,
            "setRecipients: ongoing period"
        );
    }

    /// @notice Gets the total rewards for the current period
    function getRewardForDuration() external view returns (uint) {
        return rewardRate * rewardsDuration;
    }

    /// @notice Gets all the recipient addresses for easy access
    function getAllRecipients() external view returns (address[] memory) {
        return _recipients.values();
    }

    /// @notice Gets the `address` of recipient contract at `index`
    function getRecipientAt(uint index) external view returns (address) {
        return _recipients.at(index);
    }

    /// @notice Gets the tokens that can be withdrawn or added to rewards
    function unreserved() public view returns (uint) {
        return rewardToken.balanceOf(address(this)) - _reserved;
    }

    /**
     * @notice Gets the amount of reward tokens yet to be claimed for account
     * @param account Address of the contract to check rewards
     * @return The amount of reward accumulated since the last claimed
     */
    function pendingRewards(address account) public view returns (uint) {
        Recipient memory recipient = recipients[account];
        return
            recipient.stash +
            (rewardPerWeight() - recipient.rewardPerWeightPaid) *
            recipient.weight;
    }

    /// @notice The total amount of reward tokens emitted until the call
    function rewardPerWeight() public view returns (uint) {
        if (totalWeight == 0) return _rewardPerWeightStored;
        (, uint duration) = lastTimeRewardApplicable().trySub(_lastUpdate);
        return _rewardPerWeightStored + (duration * rewardRate) / totalWeight;
    }

    /// @notice The time of last emission (now or end of last emission period)
    function lastTimeRewardApplicable() public view returns (uint) {
        return Math.min(block.timestamp, periodFinish);
    }

    /// @notice Updates reward stored whenever rewards are claimed or changed
    function _globalUpdate() private {
        _rewardPerWeightStored = rewardPerWeight();
        _lastUpdate = block.timestamp;
    }
}
