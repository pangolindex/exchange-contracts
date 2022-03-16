// SPDX-License-Identifier: MIT
// solhint-disable not-rely-on-time
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @notice A StakingRewards replacement that distributes to multiple contracts
 * @dev Downstream staking contract must ask for declaration of its rewards
 * through the `setRewards()` function. Then the declared rewards can be
 * claimed through the `mint()` function.
 * @author shung for Pangolin
 */
contract RewardRegulatorFundable is AccessControl {
    using EnumerableSet for EnumerableSet.AddressSet;
    using SafeERC20 for IERC20;

    /**
     * @notice The properties of a recipient contract
     */
    struct Recipient {
        uint allocation; // The emission allocation of the account
        uint unclaimed; // The reward amount the account can request to mint
        uint undeclared; // The reward amount stashed when allocation changes
        uint rewardStored; // The _rewardStored when recipient was last updated
    }

    /// @notice The mapping of accounts (i.e. recipients) to their information
    mapping(address => Recipient) public recipients;

    /// @notice A set of recipient addresses (for interfacing/transparency)
    EnumerableSet.AddressSet private _recipientAddresses;

    /// @notice The reward token the contract will distribute
    IERC20 public immutable rewardToken;

    /// @notice The timestamp of the last update
    uint public lastUpdate;

    /// @notice How long the staking last after `notifyRewardAmount` is called
    uint public rewardsDuration = 1 days;

    /// @notice The end time of the reward period
    uint public periodFinish;

    /// @notice Rewards emitted per second
    uint public rewardRate;

    /// @notice The amount of reward tokens allocated to be distributed
    uint public lockedSupply;

    /// @notice Sum of allocations (either 0 or DENOMINATOR)
    uint public totalAllocations;

    /// @notice Total rewards emitted until last update (≈rewardPerTokenStored)
    uint private _rewardStored;

    /// @notice The divisor for allocations
    uint private constant DENOMINATOR = 10000;

    /// @notice The role for calling `notifyRewardAmount` function
    bytes32 private constant FUNDER = keccak256("FUNDER");

    /// @notice The event that is emitted when an account’s allocation changes
    event NewAllocation(address indexed account, uint newAllocation);

    /// @notice The event that is emitted when an account’s rewards are declared
    event RewardDeclaration(address indexed account, uint rewards);

    /// @notice The event for total allocations changing from or to zero
    event Initiation(bool initiated);

    /// @notice The event for adding rewards
    event RewardAddition(uint reward);

    /// @notice The event for changing reward duration
    event RewardsDurationUpdate(uint newDuration);

    /// @notice Construct a new RewardRegulatorFundable contract
    /// @param newRewardToken The reward token the contract will distribute
    constructor(address newRewardToken) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        rewardToken = IERC20(newRewardToken);
    }

    /// @notice Requests the declaration of rewards for the message sender
    /// @return The amount of reward tokens that became eligible for claiming
    function setRewards() external returns (uint) {
        address sender = msg.sender;

        Recipient storage recipient = recipients[sender];

        _globalUpdate();
        uint rewards = getRewards(sender);
        require(rewards != 0, "setRewards: no rewards");

        recipient.rewardStored = _rewardStored;
        recipient.unclaimed += rewards;
        recipient.undeclared = 0;

        emit RewardDeclaration(sender, rewards);
        return rewards;
    }

    /// @notice Claims the `amount` of tokens to `to`
    /// @param to The recipient address of the claimed tokens
    /// @param amount The amount of tokens to claim
    function mint(address to, uint amount) external {
        address sender = msg.sender;
        require(
            amount <= recipients[sender].unclaimed && amount != 0,
            "mint: invalid mint amount"
        );
        unchecked {
            recipients[sender].unclaimed -= amount;
        }
        lockedSupply -= amount;
        rewardToken.safeTransfer(to, amount);
    }

    /// @notice Withdraws `amount` of `token` to message sender
    /// @param token Address of the token to withdraw
    /// @param amount Amount of token to withdraw
    function recover(address token, uint amount)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(
            token != address(rewardToken) || unlockedSupply() >= amount,
            "recover: insufficient unlocked supply"
        );
        IERC20(token).safeTransfer(msg.sender, amount);
    }

    /// @notice Changes how long the distribution will last for
    /// @param newRewardsDuration The length of the nex distribution
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
        emit RewardsDurationUpdate(rewardsDuration);
    }

    /// @notice Starts or extends a period by adding rewards
    /// @dev Requires that enough tokens are transferred beforehand
    /// @param reward The added amount of rewards
    function notifyRewardAmount(uint reward) external onlyRole(FUNDER) {
        uint blockTime = block.timestamp;

        // Ensure sufficient balance for the reward amount
        require(
            unlockedSupply() >= reward,
            "notifyRewardAmount: provided reward too high"
        );
        // increase locked supply to ensure above require check works next time
        lockedSupply += reward;

        require(
            totalAllocations == DENOMINATOR,
            "notifyRewardAmount: no allocation is defined"
        );

        // update _rewardStored based on previous rewardRate
        // don't call _globalUpdate() as we will have to reset lastUpdate
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
        lastUpdate = blockTime;

        emit RewardAddition(reward);
    }

    /// @notice Changes recipient allocations
    /// @param accounts The list of addresses to have a new allocation
    /// @param allocations The list of allocations corresponding to `accounts`
    function setRecipients(address[] memory accounts, uint[] memory allocations)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        uint length = accounts.length;
        require(
            length == allocations.length,
            "setRecipients: arrays must be of equal lengths"
        );

        _globalUpdate();

        int totalAllocChange;
        for (uint i; i < length; ++i) {
            totalAllocChange += _setAllocation(accounts[i], allocations[i]);
        }

        // ensure change in allocation is acceptable
        if (totalAllocChange != 0) {
            require(
                block.timestamp > periodFinish,
                "setRecipients: ongoing period"
            );
            int tmpAlloc = int(totalAllocations) + totalAllocChange;
            require(tmpAlloc >= 0, "setRecipients: invalid allocation change");
            totalAllocations = uint(tmpAlloc);
            // confirm allocations
            if (totalAllocations == 0) {
                emit Initiation(false);
            } else if (totalAllocations == DENOMINATOR) {
                emit Initiation(true);
            } else {
                revert("setRecipients: invalid allocation change");
            }
        }
    }

    /// @notice Gets the accounts with allocations
    /// @return The list of recipient addresses
    function getRecipients() external view returns (address[] memory) {
        return _recipientAddresses.values();
    }

    /// @notice Gets the total rewards for the current period
    /// @return The amount of tokens being distributed during this period
    function getRewardForDuration() external view returns (uint) {
        return rewardRate * rewardsDuration;
    }

    /// @notice Gets the tokens that can be withdrawn or added to rewards
    /// @return The amount of tokens in the contract not set to be distributed
    function unlockedSupply() public view returns (uint) {
        return rewardToken.balanceOf(address(this)) - lockedSupply;
    }

    /// @notice Gets the amount of reward tokens yet to be declared for account
    /// @param account Address of the contract to check rewards
    /// @return The amount of reward accumulated since the last declaration
    function getRewards(address account) public view returns (uint) {
        Recipient memory recipient = recipients[account];
        return
            recipient.undeclared +
            ((rewardTotal() - recipient.rewardStored) * recipient.allocation) /
            DENOMINATOR;
    }

    function rewardTotal() public view returns (uint) {
        if (totalAllocations == 0) {
            return _rewardStored;
        }
        return
            _rewardStored +
            (lastTimeRewardApplicable() - lastUpdate) *
            rewardRate;
    }

    function lastTimeRewardApplicable() public view returns (uint) {
        return Math.min(block.timestamp, periodFinish);
    }

    function _setAllocation(address account, uint allocation)
        private
        returns (int)
    {
        Recipient storage recipient = recipients[account];
        uint oldAlloc = recipient.allocation;
        require(
            allocation != oldAlloc,
            "_setAllocation: new allocation must not be same"
        );

        // add the new recipient to the set
        _recipientAddresses.add(account);
        // stash the undeclared rewards
        recipient.undeclared = getRewards(account);
        recipient.rewardStored = _rewardStored;
        recipient.allocation = allocation;

        emit NewAllocation(account, allocation);
        return int(allocation) - int(oldAlloc);
    }

    function _globalUpdate() private {
        _rewardStored = rewardTotal();
        lastUpdate = lastTimeRewardApplicable();
    }
}
