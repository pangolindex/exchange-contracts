// SPDX-License-Identifier: GPLv3
pragma solidity 0.8.15;

import "@rari-capital/solmate/src/tokens/ERC721.sol";
import "./RewardFunding.sol";
import "./TokenMetadata.sol";

/**
 * @title Pangolin Staking Positions
 * @author shung for Pangolin
 *
 * @notice
 * Pangolin Staking Positions is a unique staking solution. It utilizes the Sunshine and Rainbows
 * (SAR) algorithm, which distributes rewards as a function of balance and staking duration. See
 * README and the Proofs paper to see how SAR works. In this implementation, the staking token
 * is the same as the reward token, and staking information is recorded as positions where each
 * position is an NFT.
 *
 * @dev SAR Algorithm:
 * SAR allocates a user (or position) the following proportion of any given rewards:
 *
 * `(balance_position / balance_total) * (stakingDuration_position / stakingDuration_average)`.
 *
 * Staking duration is how long a token has been staked. The staking duration of a token starts
 * when it is staked, restarts when its rewards are harvested, and ends when it is withdrawn.
 *
 * We can refer to `balance * stakingDuration` as `value`. Based on this definition, the formula
 * above can be simplifed to `value_position / value_total`.
 *
 * Although this looks similar to just `balance_position / balance_total`, unlike balance, the
 * value of every position is constantly changing as a function of time. Therefore, we cannot
 * simply use the standard staking algorithm (i.e.: Synthetix StakingRewards) for calculating
 * rewards of users in constant time. A new algorithm had to be invented for this reason.
 *
 * To understand the algorithm, one must read the Proofs. Then `_rewardVariabes()` and `_earned()`
 * functions will make sense.
 *
 * @dev Assumptions (not checked to be true):
 * - `rewardsToken` reverts or returns false on invalid transfers,
 * - `block.timestamp - initTime` times ‘sum of all rewards’ fits 128 bits.
 *
 * @dev Limitations (checked to be true):
 * - `totalStaked` fits 96 bits.
 *
 * @dev Some invariants (must hold true at any given state):
 * - Sum of all positions’ ‘values’ equals to ‘total value’,
 * - Sum of all positions’ `balance` equals to `totalStaked`,
 * - Sum of all positions’ `entryTimes` equals to `sumOfEntryTimes`,
 * - `_idealPosition` is greater or equal to the `idealPosition` of any position,
 * - `_rewardPerValue` is greater or equal to the `rewardPerValue` of any position,
 * - The sum of total claimed and pending rewards from `RewardFunding`, must equal to sum of all
 *   positions’ lost (due to `emergencyExit()`), harvested, and pending rewards.
 */
contract PangolinStakingPositions is ERC721, RewardFunding {

    struct Position {
        // The amount of tokens staked in the position.
        uint96 balance;
        // The sum of each staked token of the position multiplied by its update time.
        uint160 entryTimes;
        // The sum of values (`balance * (block.timestamp - lastUpdate)`) of previous intervals. It
        // is only updated accordingly when more tokens are staked into an existing position. Other
        // calls than staking (i.e.: harvest and withdraw) must reset the value to zero. Correctly
        // updating this property allows for the staking duration of the existing balance of the
        // position to not restart when staking more tokens to the position. So it allows combining
        // together multiple positions with different staking durations. Refer to the `Combined
        // Positions` section of the Proofs on why this works.
        uint160 previousValues;
        // The last time the position was updated.
        uint48 lastUpdate;
        // The last time the position’s staking duration was restarted (withdraw or harvest).
        // This is used to prevent frontrunning when selling the NFT. It is not part of core algo.
        uint48 lastDevaluation;
        // `_idealPosition` on position’s last update. Refer to `Ideal Position` section of the
        // Proofs.
        uint256 idealPosition;
        // `_rewardPerValue` on position’s last update. See `Regular Position from Ideal Position`.
        uint256 rewardPerValue;
    }

    /**
     * @notice The mapping of position identifiers to their properties.
     */
    mapping(uint256 => Position) public positions;

    /**
     * @notice The sum of `balance` of all positions.
     */
    uint96 public totalStaked;

    /**
     * @notice The sum of `entryTimes` of all positions.
     * @dev Together with `totalStaked`, `sumOfEntryTimes` allows calculating the “total value”
     * For example, if 1 token is staked at second 5, and 2 tokens are staked at second 10, then
     * the `sumOfEntryTimes` is `1 * 5 + 2 * 10 = 25`. Then, the average staking duration can be
     * simply derived from that. Continuing the example, if current time stamp is second 15, then
     * the average staking duration of those 3 tokens would be `(3 * 15 - 25)/3 = 6.67`. And the
     * total value would be `6.67 * 3 = 20`. Since we do not care about the intermediate staking
     * duration, we can just use `3 * 15 - 25`. The proof for this math is not provided in the
     * Proofs, as it is trivial to verify by hand.
     */
    uint160 public sumOfEntryTimes;

    /**
     * @notice The time stamp of the first deposit.
     * @dev `initTime` is used for calculating `_idealPosition`. Note that any deposit made when
     * `totalStaked` is zero is considered the first deposit for the purposes of the algorithm. For
     * example, if a period of staking is followed by a period where no one is staking, the next
     * deposit made must update the `initTime` and the “reward variables”. This can be considered
     * as a “fresh start”.
     */
    uint256 public initTime;

    /**
     * @notice The duration when the NFT approvals are ignored after an update that devalues it.
     * @dev This is a hacky solution to prevent frontrunning NFT sales. This is a general issue
     * with all NFTs with mutable state, because NFT marketplaces do not have a standard method for
     * “slippage control”. This allows a malicious actor utilizing MEV to devalue the NFT token in
     * the same block as someone buying the NFT. For example, if a position has 5 PNG tokens, and
     * someone makes a transaction to buy its NFT, the owner of the position can withdraw all PNG
     * in the position, resulting in buyer to buy a position with 0 balance instead of 5. By using
     * `approvalPauseDuration` we simply disable transfers made by non-owners (i.e.: marketplace
     * contract) for a period.
     */
    uint256 public approvalPauseDuration = 2 hours;

    /**
     * @notice The total number of positions ever opened.
     * @dev This is simply a counter for determining the next position identifier.
     */
    uint256 private _positionsLength;

    /**
     * @notice The sum of `reward/totalValue` of each interval.
     * @dev `totalValue` is the sum of all staked tokens multiplied by their respective staking
     * durations. This variable is one of “reward variables” that govern the reward distribution.
     * On every update, the `_rewardPerValue` is incremented by rewards given during that interval
     * divided by the total value, which is average staking duration multiplied by total staked.
     */
    uint256 private _rewardPerValue;

    /**
     * @notice Imaginary rewards accrued by a position with `lastUpdate == initTime && balance == 1`.
     * @dev At the end of each interval, the ideal position has a staking duration of
     * `block.timestamp - initTime`. Since its balance is one, its value equals its staking
     * duration. So, its “value” is also `block.timestamp - initTime`, and for a given reward at an
     * interval, the ideal position accrues `reward * (block.timestamp - initTime) / totalValue`.
     */
    uint256 private _idealPosition;

    /**
     * @notice The fixed denominator used for storing reward variables.
     */
    uint256 private constant PRECISION = 2**128;

    /**
     * @notice The maximum approvalPauseDuration that can be set by the admin.
     */
    uint256 private constant MAX_APPROVAL_PAUSE_DURATION = 2 days;

    event Withdrawn(uint256 indexed positionId, uint256 amount, uint256 reward);
    event Staked(uint256 indexed positionId, uint256 amount, uint256 reward);
    event Closed(uint256 indexed positionId, uint256 amount, uint256 reward);
    event Compounded(uint256 indexed positionId, uint256 reward);
    event Harvested(uint256 indexed positionId, uint256 reward);
    event Opened(uint256 indexed positionId, uint256 amount);
    event PauseDurationSet(uint256 approvalPauseDuration);

    error PNGPos__InsufficientBalance(uint256 currentBalance, uint256 requiredBalance);
    error PNGPos__InvalidApprovalPauseDuration(uint256 newApprovalPauseDuration);
    error PNGPos__InvalidInputAmount(uint256 inputAmount);
    error PNGPos__NotOwnerOfPosition(uint256 positionId);
    error PNGPos__RewardOverflow(uint256 rewardAdded);
    error PNGPos__InvalidToken(uint256 tokenId);
    error PNGPos__ApprovalPaused(uint256 until);
    error PNGPos__FailedTransfer();
    error PNGPos__NoBalance();
    error PNGPos__NoReward();

    modifier onlyOwner(uint256 positionId) {
        if (ownerOf(positionId) != msg.sender) {
            revert PNGPos__NotOwnerOfPosition(positionId);
        }
        _;
    }

    /**
     * @notice Constructor to create and initialize PangolinStakingPositions contract.
     * @param newRewardsToken The token used for both for staking and reward.
     * @param newAdmin The initial owner of the contract.
     */
    constructor(address newRewardsToken, address newAdmin)
        ERC721("Pangolin Staking Positions", "PNG-POS")
        RewardFunding(newRewardsToken, newAdmin)
    {}

    /**
     * @notice External function to open a new position to the caller.
     * @param amount The amount of tokens to transfer from the caller to the position.
     */
    function open(uint256 amount) external {
        if (totalStaked == 0) {
            // Update `initTime` on first stake. It is used for calculating `_idealPosition`.
            initTime = block.timestamp;

            // Reset reward variables to zero. This is in case in the unlikely scenario that reward
            // variables are non-zero on first staking (i.e.: a period of staking is followed by a
            // period of no one staking).
            (_idealPosition, _rewardPerValue) = (0, 0);
        } else {
            // Update reward variables that govern the reward distribution. One can regard these
            // variables as analogue of `rewardPerTokenStored` of Synthetix’ Staking rewards.
            _updateRewardVariables();
        }

        // Use a private function to handle the logic pertaining to opening a position.
        _open(amount);
    }

    /**
     * @notice External function to deposit tokens to an existing position.
     * @param amount The amount of tokens to deposit into the position.
     * @param positionId The identifier of the position to deposit the funds into.
     */
    function stake(uint256 positionId, uint256 amount) external {
        if (totalStaked == 0) {
            // Update `initTime` on first stake. It is used for calculating `_idealPosition`.
            initTime = block.timestamp;

            // Reset reward variables to zero. This is in case in the unlikely scenario that reward
            // variables are non-zero on first staking (i.e.: a period of staking is followed by a
            // period of no one staking).
            (_idealPosition, _rewardPerValue) = (0, 0);
        } else {
            // Update reward variables that govern the reward distribution. One can regard these
            // variables as analogue of `rewardPerTokenStored` of Synthetix’ Staking rewards.
            _updateRewardVariables();
        }

        // Use a private function to handle the logic pertaining to depositing into a position.
        _stake(positionId, amount);
    }

    /**
     * @notice External function to claim the accrued rewards of a position.
     * @param positionId The identifier of the position to claim the rewards of.
     */
    function harvest(uint256 positionId) external {
        // Update reward variables that govern the reward distribution.
        _updateRewardVariables();

        // Use a private function to handle the logic pertaining to harvesting rewards.
        _harvest(positionId);
    }

    /**
     * @notice External function to deposit the accrued rewards of a position back to itself.
     * @param positionId The identifier of the position to compound the rewards of.
     */
    function compound(uint256 positionId) external {
        // Update reward variables that govern the reward distribution.
        _updateRewardVariables();

        // Use a private function to handle the logic pertaining to compounding rewards.
        _compound(positionId);
    }

    /**
     * @notice External function to withdraw given amount of staked balance, plus all the accrued
     * rewards from the position.
     * @param positionId The identifier of the position to withdraw the balance.
     * @param amount The amount of staked tokens, excluding rewards, to withdraw from the position.
     */
    function withdraw(uint256 positionId, uint256 amount) external {
        // Update reward variables that govern the reward distribution.
        _updateRewardVariables();

        // Use a private function to handle the logic pertaining to withdrawing the staked balance.
        _withdraw(positionId, amount);
    }

    /**
     * @notice External function to close a position by withdrawing the staked balance and claiming
     * all the accrued rewards.
     * @param positionId The identifier of the position to close.
     */
    function close(uint256 positionId) external {
        // Update reward variables that govern the reward distribution.
        _updateRewardVariables();

        // Use a private function to handle the logic pertaining to closing the position.
        _close(positionId);
    }

    /**
     * @notice External function to exit from a position by forgoing rewards.
     * @param positionId The identifier of the position to exit.
     */
    function emergencyExit(uint256 positionId) external {
        // Do not update reward variables, because a faulty rewarding algorithm might be the
        // culprit locking the staked balance in the contract. Nonetheless, for consistency, use a
        // private function to handle the logic pertaining to emergency exit.
        _emergencyExit(positionId);
    }

    /**
     * @notice External function to compounds multiple positions.
     * @dev This saves gas by updating reward variables only once.
     * @param positionIds An array of identifiers of positions to compound the rewards of.
     */
    function multiCompound(uint256[] calldata positionIds) external {
        // Update reward variables only once.
        _updateRewardVariables();

        uint256 length = positionIds.length;
        for (uint256 i = 0; i < length;) {
            _compound(positionIds[i]);

            // Counter realistically cannot overflow.
            unchecked {
                ++i;
            }
        }
    }

    /**
     * @notice External function to close multiple positions.
     * @dev This saves gas by updating reward variables only once.
     * @param positionIds An array of identifiers of positions to compound the rewards of.
     */
    function multiClose(uint256[] calldata positionIds) external {
        // Update reward variables only once.
        _updateRewardVariables();

        uint256 length = positionIds.length;
        for (uint256 i = 0; i < length;) {
            _close(positionIds[i]);

            // Counter realistically cannot overflow.
            unchecked {
                ++i;
            }
        }
    }

    /**
     * @notice Sets how long the token approvals should be ignored after a devaluing action.
     * @param newApprovalPauseDuration The new duration during which token approval are ignored.
     */
    function setApprovalPauseDuration(uint256 newApprovalPauseDuration)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        // Ensure new approvalPauseDuration is less than the max allowed.
        if (newApprovalPauseDuration > MAX_APPROVAL_PAUSE_DURATION) {
            revert PNGPos__InvalidApprovalPauseDuration(newApprovalPauseDuration);
        }

        // Update the state variable and emit an event.
        approvalPauseDuration = newApprovalPauseDuration;
        emit PauseDurationSet(newApprovalPauseDuration);
    }

    /**
     * @notice External view function to get the reward rate of a position.
     * @dev In SAR, positions have different reward rates, unlike other staking algorithms.
     * @param positionId The identifier of the position to check the reward rate of.
     * @return The rewards per second of the position.
     */
    function positionRewardRate(uint256 positionId) public view returns (uint256) {
        // Get totalValue, which is totalStaked times ‘average staking duration’.
        uint256 totalValue = block.timestamp * totalStaked - sumOfEntryTimes;

        // When totalValue is zero, positionValue must be zero, hence positionRewardRate is zero.
        if (totalValue == 0) {
            return 0;
        }

        // Stash the queried position in memory.
        Position memory position = positions[positionId];

        // Get positionValue, which is position.balance times ‘staking duration of the position’.
        uint256 positionValue = block.timestamp * position.balance - position.entryTimes;

        // Return the rewardRate of the position.
        return (rewardRate * positionValue) / totalValue;
    }

    /**
     * @notice External view function to get the accrued rewards of a position.
     * @param positionId The identifier of the position to check the accrued rewards of.
     * @return The amount of rewards that have been accrued in the position.
     */
    function positionPendingRewards(uint256 positionId) public view returns (uint256) {
        // Get reward variables based on the total pending rewards since the last update.
        (uint256 tmpIdealPosition, uint256 tmpRewardPerValue) = _rewardVariables(
            _pendingRewards()
        );

        // Stash the queried position in memory.
        Position memory position = positions[positionId];

        // Stash balance in a local variable for efficiency, and return zero if balance is zero.
        // A position cannot have positive accrued rewards if balance is zero, because any action
        // that would have made its balance zero (i.e.: withdraw), also harvests the rewards,
        // leaving no accrued rewards. And when balance is zero, no more rewards can be accrued for
        // the position.
        uint256 balance = position.balance;
        if (balance == 0) {
            return 0;
        }

        // Get the deltas of reward variables since position was last updated.
        tmpRewardPerValue -= position.rewardPerValue;
        tmpIdealPosition -= position.idealPosition;

        // Return the pending rewards of the position. This is the same formula used in
        // `_earned()`, but it uses temporary reward variables instead of state reward variables.
        // Refer to the Combined Position section of the Proofs on why and how this formula works.
        return
            (((tmpIdealPosition - (tmpRewardPerValue * (position.lastUpdate - initTime))) *
                balance) + (tmpRewardPerValue * position.previousValues)) / PRECISION;
    }

    /**
     * @notice Private function to open a new position to the caller.
     * @param amount The amount of tokens to transfer from the caller to the position.
     * @dev Specifications:
     * - Mint a new NFT,
     * - Open a new position linked to the NFT,
     * - Deposit `amount` tokens to the position,
     * - Make the staking duration of `amount` start from zero.
     */
    function _open(uint256 amount) private {
        // Get the new total staked amount and ensure it fits 96 bits.
        uint256 newTotalStaked = totalStaked + amount;
        if (amount == 0 || newTotalStaked > type(uint96).max) {
            revert PNGPos__InvalidInputAmount(amount);
        }

        // Increment the state variables pertaining to total value calculation.
        uint160 addedEntryTimes = uint160(block.timestamp * amount);
        sumOfEntryTimes += addedEntryTimes;
        totalStaked = uint96(newTotalStaked);

        // Use unchecked block because `_positionsLength` counter cannot realistically overflow.
        unchecked {
            // Get the position identifier, starting from 1.
            uint256 positionId = ++_positionsLength;

            // Mint the NFT associated with the position.
            _mint(msg.sender, positionId);

            // Create a storage pointer for the position.
            Position storage position = positions[positionId];

            // Update the position properties without incrementation, as this is the first deposit.
            position.balance = uint96(amount);
            position.entryTimes = addedEntryTimes;

            // Snapshot the lastUpdate and reward variables.
            position.lastUpdate = uint48(block.timestamp);
            position.idealPosition = _idealPosition;
            position.rewardPerValue = _rewardPerValue;

            // Transfer amount tokens from user to the contract, and emit the associated event.
            if (!rewardsToken.transferFrom(msg.sender, address(this), amount)) {
                revert PNGPos__FailedTransfer();
            }
            emit Opened(positionId, amount);
        }
    }

    /**
     * @notice Private function to deposit tokens to an existing position.
     * @param amount The amount of tokens to deposit into the position.
     * @param positionId The identifier of the position to deposit the funds into.
     * @dev Specifications:
     * - Deposit `amount` tokens to the position associated with `positionId`,
     * - Make the staking duration of `amount` restart,
     * - Do not make the staking duration of the existing `balance` restart,
     * - Claim accrued `reward` tokens of the position,
     * - Deposit `reward` tokens back into the position,
     * - Make the staking duration of `reward` tokens start from zero.
     */
    function _stake(uint256 positionId, uint256 amount) private onlyOwner(positionId) {
        // Create a storage pointer for the position.
        Position storage position = positions[positionId];

        // Get rewards accrued in the position.
        uint256 reward = _earned(position);

        // Include reward amount in total amount to be staked.
        uint256 totalAmount = amount + reward;

        // Get the new total staked amount and ensure it fits 96 bits.
        uint256 newTotalStaked = totalStaked + totalAmount;
        if (amount == 0 || newTotalStaked > type(uint96).max) {
            revert PNGPos__InvalidInputAmount(amount);
        }

        // Increment the state variables pertaining to total value calculation.
        uint160 addedEntryTimes = uint160(block.timestamp * totalAmount);
        sumOfEntryTimes += addedEntryTimes;
        totalStaked = uint96(newTotalStaked);

        // Increment the position properties pertaining to position value calculation.
        uint256 oldBalance = position.balance;
        unchecked {
            position.balance = uint96(oldBalance + totalAmount);
        }
        position.entryTimes += addedEntryTimes;

        // Increment the previousValues.
        position.previousValues += uint160(oldBalance * (block.timestamp - position.lastUpdate));

        // Snapshot the lastUpdate and reward variables.
        position.lastUpdate = uint48(block.timestamp);
        position.idealPosition = _idealPosition;
        position.rewardPerValue = _rewardPerValue;

        // Transfer amount tokens from user to the contract, and emit the associated event.
        if (!rewardsToken.transferFrom(msg.sender, address(this), amount)) {
            revert PNGPos__FailedTransfer();
        }
        emit Staked(positionId, amount, reward);
    }

    /**
     * @notice Private function to claim the accrued rewards of a position.
     * @param positionId The identifier of the position to claim the rewards of.
     * @dev Specifications:
     * - Claim accrued `reward` tokens of the position,
     * - Send `reward` tokens to the user wallet,
     * - Make the staking duration of the existing `balance` restart,
     * - Ignore NFT spending approvals for a duration set by the admin.
     */
    function _harvest(uint256 positionId) private onlyOwner(positionId) {
        // Create a storage pointer for the position.
        Position storage position = positions[positionId];

        // Stash balance to save gas.
        uint96 balance = position.balance;

        // Get accrued rewards of the position, and revert if there are no rewards.
        uint256 reward = _earned(position);
        if (reward == 0) {
            revert PNGPos__NoReward();
        }

        // Only update sumOfEntryTimes, as totalStaked is not changed.
        uint160 newEntryTimes = uint160(block.timestamp * balance);
        sumOfEntryTimes += (newEntryTimes - position.entryTimes);

        // Update the entryTimes to now so that the staking duration restarts from zero.
        position.entryTimes = newEntryTimes;

        // Reset the previous values, as we have restarted the staking duration.
        position.previousValues = 0;

        // Update lastDevaluation, as resetting the staking duration devalues the position.
        position.lastDevaluation = uint48(block.timestamp);

        // Snapshot the lastUpdate and reward variables.
        position.lastUpdate = uint48(block.timestamp);
        position.idealPosition = _idealPosition;
        position.rewardPerValue = _rewardPerValue;

        // Transfer reward tokens to the user, and emit the associated event.
        if (!rewardsToken.transfer(msg.sender, reward)) {
            revert PNGPos__FailedTransfer();
        }
        emit Harvested(positionId, reward);
    }

    /**
     * @notice Private function to deposit the accrued rewards of a position back to itself.
     * @param positionId The identifier of the position to compound the rewards of.
     * @dev Specifications:
     * - Claim accrued `reward` tokens of the position,
     * - Deposit `reward` tokens back into the position,
     * - Make the staking duration of `reward` tokens restart,
     * - Do not make the staking duration of the existing `balance` restart.
     */
    function _compound(uint256 positionId) private onlyOwner(positionId) {
        // Create a storage pointer for the position.
        Position storage position = positions[positionId];

        // Get accrued rewards of the position, and revert if there are no rewards.
        uint256 reward = _earned(position);
        if (reward == 0) {
            revert PNGPos__NoReward();
        }

        // Get the new total staked amount and ensure it fits 96 bits.
        uint256 newTotalStaked = totalStaked + reward;
        if (newTotalStaked > type(uint96).max) {
            revert PNGPos__RewardOverflow(reward);
        }

        // Increment the state variables pertaining to total value calculation.
        uint160 addedEntryTimes = uint160(block.timestamp * reward);
        sumOfEntryTimes += addedEntryTimes;
        totalStaked = uint96(newTotalStaked);

        // Increment the position properties pertaining to position value calculation.
        uint256 oldBalance = position.balance;
        unchecked {
            position.balance = uint96(oldBalance + reward);
        }
        position.entryTimes += addedEntryTimes;

        // Increment the previousValues.
        position.previousValues += uint160(oldBalance * (block.timestamp - position.lastUpdate));

        // Snapshot the lastUpdate and reward variables.
        position.lastUpdate = uint48(block.timestamp);
        position.idealPosition = _idealPosition;
        position.rewardPerValue = _rewardPerValue;

        // Only emit the associated event, as there is no need to transfer.
        emit Compounded(positionId, reward);
    }

    /**
     * @notice Private function to withdraw given amount of staked balance, plus all the accrued
     * rewards from the position.
     * @param positionId The identifier of the position to withdraw the balance.
     * @param amount The amount of staked tokens, excluding rewards, to withdraw from the position.
     * @dev Specifications:
     * - Claim accrued `reward` tokens of the position,
     * - Send `reward` tokens to the position owner,
     * - Send `amount` tokens from the user `balance` to the position owner,
     * - Make the staking duration of the remaining `balance` restart,
     * - Ignore NFT spending approvals for a duration set by the admin.
     */
    function _withdraw(uint256 positionId, uint256 amount) private onlyOwner(positionId) {
        // Create a storage pointer for the position.
        Position storage position = positions[positionId];

        // Get position balance and ensure sufficient balance exists.
        uint256 oldBalance = position.balance;
        if (amount > oldBalance) {
            revert PNGPos__InsufficientBalance(oldBalance, amount);
        }

        // Get the remaining balance in the position.
        uint256 remaining;
        unchecked {
            remaining = oldBalance - amount;
        }

        // Get accrued rewards of the position.
        uint256 reward = _earned(position);

        // Decrement the withdrawn amount from totalStaked.
        totalStaked -= uint96(amount);

        // Update sumOfEntryTimes. The new sumOfEntryTimes can be greater or less than the previous
        // sumOfEntryTimes depending on the withdrawn amount and the time passed since lastUpdate.
        uint256 newEntryTimes = block.timestamp * remaining;
        sumOfEntryTimes = uint160(sumOfEntryTimes + newEntryTimes - position.entryTimes);

        // Decrement the withdrawn amount from position balance.
        position.balance = uint96(remaining);

        // update position variables (must behave as if position is re-opened)
        position.entryTimes = uint160(newEntryTimes);

        // Reset the previous values, as we have restarted the staking duration.
        position.previousValues = 0;

        // Update lastDevaluation, as resetting the staking duration devalues the position.
        position.lastDevaluation = uint48(block.timestamp);

        // Snapshot the lastUpdate and reward variables.
        position.lastUpdate = uint48(block.timestamp);
        position.idealPosition = _idealPosition;
        position.rewardPerValue = _rewardPerValue;

        // Transfer withdrawn amount and rewards to the user, and emit the associated event.
        if (!rewardsToken.transfer(msg.sender, reward + amount)) {
            revert PNGPos__FailedTransfer();
        }
        emit Withdrawn(positionId, amount, reward);
    }

    /**
     * @notice Private function to close a position by withdrawing the staked balance and claiming
     * all the accrued rewards.
     * @param positionId The identifier of the position to close.
     * @dev Specifications:
     * - Burn the NFT associated with `positionId`,
     * - Close the position associated with `positionId`,
     * - Send `balance` tokens of the position to the user wallet,
     * - Send `reward` tokens accumulated in the position to the user wallet.
     */
    function _close(uint256 positionId) private onlyOwner(positionId) {
        // Create a storage pointer for the position.
        Position storage position = positions[positionId];

        // Get the position balance and the accrued rewards.
        uint96 balance = position.balance;
        uint256 reward = _earned(position);

        // Decrement the state variables pertaining to total value calculation.
        totalStaked -= balance;
        sumOfEntryTimes -= position.entryTimes;

        // Delete the position and burn the NFT.
        delete positions[positionId];
        _burn(positionId);

        // Transfer withdrawn amount and rewards to the user, and emit the associated event.
        if (!rewardsToken.transfer(msg.sender, balance + reward)) {
            revert PNGPos__FailedTransfer();
        }
        emit Closed(positionId, balance, reward);
    }

    /**
     * @notice External function to exit from a position by forgoing rewards.
     * @param positionId The identifier of the position to exit from.
     * @dev Specifications:
     * - Burn the NFT associated with `positionId`,
     * - Close the position associated with `positionId`,
     * - Send `balance` tokens of the position to the user wallet,
     * - Ignore `reward` tokens, making them permanently irrecoverable.
     */
    function _emergencyExit(uint256 positionId) private onlyOwner(positionId) {
        // Stash the queried position in memory.
        Position memory position = positions[positionId];

        // Get the position balance only, ignoring the accrued rewards.
        uint96 balance = position.balance;

        // Decrement the state variables pertaining to total value calculation.
        totalStaked -= balance;
        sumOfEntryTimes -= position.entryTimes;

        // Delete the position and burn the NFT.
        delete positions[positionId];
        _burn(positionId);

        // Transfer only the staked balance from the contract to user.
        if (!rewardsToken.transfer(msg.sender, balance)) {
            revert PNGPos__FailedTransfer();
        }
        emit Closed(positionId, balance, 0);
    }

    /**
     * @notice Private function to claim the total pending rewards, and based on the claimed amount
     * update the two variables that govern the reward distribution.
     */
    function _updateRewardVariables() private {
        (_idealPosition, _rewardPerValue) = _rewardVariables(_claim());
    }

    /**
     * @notice Priate view function to get the accrued rewards of a position.
     * @dev The call to this function must only be made after the reward variables are updated
     * through `_updateRewardVariables()`.
     * @param position The properties of the position.
     * @return The accrued rewards of the position.
     */
    function _earned(Position storage position) private view returns (uint256) {
        // Get the balance of the position, and return zero if balance is zero.
        uint256 balance = position.balance;
        if (balance == 0) {
            return 0;
        }

        // Get the deltas of the reward variables since the position was last updated.
        uint256 rewardPerValue = _rewardPerValue - position.rewardPerValue;
        uint256 idealPosition = _idealPosition - position.idealPosition;

        // Return the pending rewards of the position. Refer to the Combined Position section of
        // the Proofs on why and how this formula works.
        return
            (((idealPosition - (rewardPerValue * (position.lastUpdate - initTime))) * balance) +
                (rewardPerValue * position.previousValues)) / PRECISION;
    }

    /**
     * @dev Calculates the variables that govern the reward distribution.
     * @param rewards The amount of reward this contract can distribute.
     * @return The incremented _idealPosition.
     * @return The incremented _rewardPerValue.
     */
    function _rewardVariables(uint256 rewards) private view returns (uint256, uint256) {
        // Calculate the totalValue, and return non-incremented reward values if value is zero.
        uint256 totalValue = block.timestamp * totalStaked - sumOfEntryTimes;
        if (totalValue == 0) return (_idealPosition, _rewardPerValue);

        // Return the incremented reward variables. Refer to the Proofs on why this is needed.
        return (
            _idealPosition + ((rewards * (block.timestamp - initTime)) * PRECISION) / totalValue,
            _rewardPerValue + (rewards * PRECISION) / totalValue
        );
    }

    /* ************* */
    /*   OVERRIDES   */
    /* ************* */

    function transferFrom(address from, address to, uint256 id) public override(ERC721) {
        uint256 approvalPauseUntil = positions[id].lastDevaluation + approvalPauseDuration;
        if (msg.sender != from && block.timestamp <= approvalPauseUntil) {
            revert PNGPos__ApprovalPaused(approvalPauseUntil);
        }
        super.transferFrom(from, to, id);
    }

    function tokenURI(uint256 tokenId) public view override(ERC721) returns (string memory) {
        Position memory position = positions[tokenId];
        return TokenMetadata.generateTokenURI(
            totalStaked,
            sumOfEntryTimes,
            rewardRate,
            position.balance,
            position.entryTimes,
            positionRewardRate(tokenId),
            positionPendingRewards(tokenId),
            ownerOf(tokenId)
        );
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, AccessControl)
        returns (bool)
    {
        return
            AccessControl.supportsInterface(interfaceId) ||
            ERC721.supportsInterface(interfaceId);
    }
}