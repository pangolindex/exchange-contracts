// SPDX-License-Identifier: MIT
// solhint-disable not-rely-on-time
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/**
 * @title Fundable Reward Regulator
 * @notice A StakingRewards replacement that distributes to multiple contracts
 * @dev This contract is a partial implementation of Synthetix' StakingRewards.
 * The contract does not hold any staking tokens, and lacks withdrawing,
 * harvesting, and staking functions. It only holds the reward token, and
 * distributes the reward token to downstream recipient contracts. In essence,
 * this is StakingRewards broken into two components. First component is this
 * contract, which holds the reward token and then determines the global
 * reward rate. The second component is separate contracts which handle
 * distribution of rewards to end users. We will call these separate contracts
 * recipients. A recipient contract must call `setReward()` of RewardRegulator
 * to "declare" its reward. When its reward is declared, RewardRegulator
 * updates the properties of the recipient, and returns the amount of reward
 * tokens the recipient is eligible since the last declaration. The recipient
 * contract then must call `claim()` to claim the reward tokens it is eligible.
 * RewardRegulator is agnostic to how the recipient distributes its rewards, as
 * long as the recipient do not claim more tokens than it is eligible.
 * @author shung for Pangolin
 */
contract RewardRegulatorFundable is AccessControl {
    using EnumerableSet for EnumerableSet.AddressSet;
    using SafeERC20 for IERC20;
    using SafeCast for int;

    struct Recipient {
        uint allocation; // The emission allocation of the recipient
        uint unclaimed; // The reward amount the account can request to claim
        uint undeclared; // The reward amount stashed when allocation changes
        uint rewardStored; // The _rewardStored when recipient was last updated
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

    /// @notice The timestamp of the last update
    uint private _lastUpdate;

    /// @notice The amount of reward tokens allocated to be distributed
    uint private _reserved;

    /// @notice Sum of allocations (either 0 or DENOMINATOR)
    uint private _totalAllocations;

    /// @notice Total rewards emitted until last update (≈rewardPerTokenStored)
    uint private _rewardStored;

    /// @notice The divisor for allocations
    uint private constant DENOMINATOR = 10000;

    /// @notice The role for calling `notifyRewardAmount` function
    bytes32 private constant FUNDER = keccak256("FUNDER");

    event RecipientSet(address indexed account, uint newAllocation);
    event RewardDeclared(address indexed account, uint reward);
    event Initiated(bool initiated);
    event RewardAdded(uint reward);
    event RewardsDurationUpdated(uint newDuration);

    /**
     * @notice Construct a new RewardRegulatorFundable contract
     * @param newRewardToken The reward token the contract will distribute
     */
    constructor(address newRewardToken) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        rewardToken = IERC20(newRewardToken);
    }

    /**
     * @notice Requests the declaration of reward for the message sender
     * @return The amount of reward tokens that became eligible for claiming
     */
    function setReward() external returns (uint) {
        address sender = msg.sender;

        Recipient storage recipient = recipients[sender];

        _globalUpdate();
        uint reward = getRewards(sender);
        require(reward != 0, "setReward: no rewards");

        recipient.rewardStored = _rewardStored;
        recipient.unclaimed += reward;
        recipient.undeclared = 0;

        emit RewardDeclared(sender, reward);
        return reward;
    }

    /**
     * @notice Claims the `amount` of tokens to `to`
     * @param to The recipient address of the claimed tokens
     * @param amount The amount of tokens to claim
     */
    function claim(address to, uint amount) external {
        address sender = msg.sender;
        require(
            amount <= recipients[sender].unclaimed && amount != 0,
            "claim: invalid claim amount"
        );
        unchecked {
            recipients[sender].unclaimed -= amount;
        }
        _reserved -= amount;
        rewardToken.safeTransfer(to, amount);
    }

    /**
     * @notice Withdraws `amount` of `token` to message sender
     * @param token Address of the token to withdraw
     * @param amount Amount of token to withdraw
     */
    function recover(address token, uint amount)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(
            token != address(rewardToken) || unreserved() >= amount,
            "recover: insufficient unlocked supply"
        );
        IERC20(token).safeTransfer(msg.sender, amount);
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

        // Ensure sufficient balance for the reward amount
        require(
            unreserved() >= reward,
            "notifyRewardAmount: provided reward too high"
        );
        // increase locked supply to ensure above require check works next time
        _reserved += reward;

        require(
            _totalAllocations == DENOMINATOR,
            "notifyRewardAmount: no allocation is defined"
        );

        // update _rewardStored based on previous rewardRate
        // don't call _globalUpdate() as we will have to set _lastUpdate
        _rewardStored = rewardTotal();

        // Set new reward rate
        if (blockTime >= periodFinish) {
            rewardRate = reward / rewardsDuration;
        } else {
            uint leftover = (periodFinish - blockTime) * rewardRate;
            rewardRate = (reward + leftover) / rewardsDuration;
        }

        // update the end of this period
        periodFinish = blockTime + rewardsDuration;

        // update the lastUpdate time
        _lastUpdate = blockTime;

        emit RewardAdded(reward);
    }

    /**
     * @notice Changes recipient allocations
     * @param accounts The list of addresses to have a new allocation
     * @param allocations The list of allocations corresponding to `accounts`
     */
    function setRecipients(
        address[] calldata accounts,
        uint[] calldata allocations
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint length = accounts.length;
        require(
            length == allocations.length,
            "setRecipients: arrays must be of equal lengths"
        );

        _globalUpdate();

        int totalAllocChange;
        for (uint i; i < length; ++i) {
            address account = accounts[i];
            uint allocation = allocations[i];
            Recipient storage recipient = recipients[account];
            uint oldAlloc = recipient.allocation;
            require(
                allocation != oldAlloc,
                "setRecipients: new allocation must not be same"
            );

            // add the new recipient to the set
            _recipients.add(account);
            // stash the undeclared rewards
            recipient.undeclared = getRewards(account);
            recipient.rewardStored = _rewardStored;
            recipient.allocation = allocation;

            emit RecipientSet(account, allocation);
            totalAllocChange += int(allocation) - int(oldAlloc);
        }

        // ensure change in allocation is acceptable
        if (totalAllocChange != 0) {
            require(
                block.timestamp > periodFinish,
                "setRecipients: ongoing period"
            );
            _totalAllocations = (int(_totalAllocations) + totalAllocChange)
                .toUint256();
            // confirm allocations
            if (_totalAllocations == 0) {
                emit Initiated(false);
            } else if (_totalAllocations == DENOMINATOR) {
                emit Initiated(true);
            } else {
                revert("setRecipients: invalid allocation change");
            }
        }
    }

    /// @notice Gets the total rewards for the current period
    function getRewardForDuration() external view returns (uint) {
        return rewardRate * rewardsDuration;
    }

    /// @notice Gets all the recipient addresses for easy access
    function getAllRecipients() external view returns (address[] memory) {
        return _recipients.values();
    }

    /// @notice Gets the tokens that can be withdrawn or added to rewards
    function unreserved() public view returns (uint) {
        return rewardToken.balanceOf(address(this)) - _reserved;
    }

    /**
     * @notice Gets the amount of reward tokens yet to be declared for account
     * @param account Address of the contract to check rewards
     * @return The amount of reward accumulated since the last declaration
     */
    function getRewards(address account) public view returns (uint) {
        Recipient memory recipient = recipients[account];
        return
            recipient.undeclared +
            ((rewardTotal() - recipient.rewardStored) * recipient.allocation) /
            DENOMINATOR;
    }

    /// @notice The total amount of reward tokens emitted until the call
    function rewardTotal() public view returns (uint) {
        if (_totalAllocations == 0) {
            return _rewardStored;
        }
        return
            _rewardStored +
            (lastTimeRewardApplicable() - _lastUpdate) *
            rewardRate;
    }

    /// @notice The time of last emission (now or end of last emission period)
    function lastTimeRewardApplicable() public view returns (uint) {
        return Math.min(block.timestamp, periodFinish);
    }

    /// @notice Updates reward stored whenever rewards are declared or changed
    function _globalUpdate() private {
        _rewardStored = rewardTotal();
        _lastUpdate = lastTimeRewardApplicable();
    }
}
