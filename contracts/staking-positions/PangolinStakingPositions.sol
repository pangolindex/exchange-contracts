// SPDX-License-Identifier: GPLv3
pragma solidity 0.8.15;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "./PangolinStakingPositionsFunding.sol";

interface ITokenMetadata {
    function tokenURI(PangolinStakingPositions pangolinStakingPositions, uint256 tokenId)
        external
        view
        returns (string memory);
}

/**
 * @title Pangolin Staking Positions
 * @author shung for Pangolin
 *
 * @notice Pangolin Staking Positions is a unique staking solution. It utilizes the Sunshine and
 *         Rainbows (SAR) algorithm, which distributes rewards as a function of balance and staking
 *         duration. See README and the Proofs paper to see how SAR works. In this implementation,
 *         the staking token is the same as the reward token, and staking information is recorded
 *         as positions where each position is an NFT.
 *
 * @dev SAR Algorithm:

 *      SAR allocates a user (or position) the following proportion of any given rewards:
 *
 *      `(balance_position / balance_total) * (stakingDuration_position /
 *      stakingDuration_average)`.
 *
 *      Staking duration is how long a token has been staked. The staking duration of a token
 *      starts when it is staked, restarts when its rewards are harvested, and ends when it is
 *      withdrawn.
 *
 *      We can refer to `balance * stakingDuration` as `value`. Based on this definition, the
 *      formula above can be simplified to `value_position / value_total`.
 *
 *      Although this looks similar to just `balance_position / balance_total`, unlike balance, the
 *      value of every position is constantly changing as a function of time. Therefore, we cannot
 *      simply use the standard staking algorithm (i.e.: Synthetix StakingRewards) for calculating
 *      rewards of users in constant time. A new algorithm had to be invented for this reason.
 *
 *      To understand the algorithm, one must read the Proofs. Then
 *      `_getRewardSummationsIncrementations()` and `_earned()` functions will make sense.
 *
 * @dev Assumptions (not checked to be true):
 *      - `rewardsToken` reverts or returns false on invalid transfers,
 *      - `block.timestamp * totalRewardAdded` fits 128 bits,
 *      - `block.timestamp` is never greater than `2**40 - 1 - 2**32`.
 *
 * @dev Limitations (checked to be true):
 *      - `totalStaked` fits 96 bits.
 *      - `totalRewardAdded` fits 96 bits.
 */
contract PangolinStakingPositions is ERC721Enumerable, PangolinStakingPositionsFunding {
    struct ValueVariables {
        // The amount of tokens staked in the position or the contract.
        uint96 balance;
        // The sum of each staked token in the position or contract multiplied by its update time.
        uint160 sumOfEntryTimes;
    }

    struct RewardSummations {
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
        // total value, which is average staking duration multiplied by total staked. See Proofs.
        uint256 rewardPerValue;
    }

    struct Position {
        // Two variables that determine the share of rewards a position receives.
        ValueVariables valueVariables;
        // Summations snapshotted on the last update of the position.
        RewardSummations rewardSummationsPaid;
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
        // This is used to prevent frontrunning when buying the NFT. It is not part of core algo.
        uint48 lastDevaluation;
    }

    /** @notice The mapping of position identifiers to their properties. */
    mapping(uint256 => Position) public positions;

    /** @notice The contract that constructs and returns tokenURIs for position tokens. */
    ITokenMetadata public tokenMetadata;

    /** @notice The struct holding the totalStaked and sumOfEntryTimes. */
    ValueVariables public totalValueVariables;

    /** @notice The variables that govern the reward distribution. */
    RewardSummations public rewardSummationsStored;

    /**
     * @notice The duration during NFT approvals are ignored after an update that devalues it.
     * @dev This is a hacky solution to prevent frontrunning NFT sales. This is a general issue
     *      with all NFTs with mutable state, because NFT marketplaces do not have a standard
     *      method for “slippage control”. This allows a malicious actor utilizing MEV to
     *      devalue the NFT token in the same block as someone buying the NFT. For example, if a
     *      position has 5 PNG tokens, and someone makes a transaction to buy its NFT, the owner
     *      of the position can withdraw all PNG in the position, resulting in buyer to buy a
     *      position with 0 balance instead of 5. By using `approvalPauseDuration` we simply
     *      disable transfers made by non-owners (i.e.: marketplace contract) for a period.
     */
    uint256 public approvalPauseDuration = 2 hours;

    /**
     * @notice The total number of positions ever opened.
     * @dev This is simply a counter for determining the next position identifier.
     */
    uint256 private _positionsLength;

    /** @notice The fixed denominator used for storing summations. */
    uint256 private constant PRECISION = 2**128;

    /** @notice The maximum approvalPauseDuration that can be set by the admin. */
    uint256 private constant MAX_APPROVAL_PAUSE_DURATION = 2 days;

    /** @notice The event emitted when withdrawing or harvesting from a position. */
    event Withdrawn(uint256 indexed positionId, uint256 indexed amount, uint256 indexed reward);

    /** @notice The event emitted when staking to, minting, or compounding a position. */
    event Staked(uint256 indexed positionId, uint256 indexed amount, uint256 indexed reward);

    /** @notice The event emitted when admin changes `approvalPauseDuration`. */
    event PauseDurationSet(uint256 newApprovalPauseDuration);

    /** @notice The event emitted when admin changes `tokenMetadata`. */
    event TokenMetadataSet(ITokenMetadata newTokenMetadata);

    modifier onlyOwner(uint256 positionId) {
        if (ownerOf(positionId) != msg.sender) revert UnprivilegedCaller();
        _;
    }

    /**
     * @notice Constructor to create and initialize PangolinStakingPositions contract.
     * @param newRewardsToken The token used for both for staking and reward.
     * @param newAdmin The initial owner of the contract.
     * @param newTokenMetadata The contract that constructs tokenURIs for position NFTs.
     */
    constructor(
        address newRewardsToken,
        address newAdmin,
        ITokenMetadata newTokenMetadata
    )
        ERC721("Pangolin Staking Positions", "PNG-POS")
        PangolinStakingPositionsFunding(newRewardsToken, newAdmin)
    {
        tokenMetadata = newTokenMetadata;
    }

    /**
     * @notice External function to open a new position to the caller.
     * @param amount The amount of tokens to transfer from the caller to the position.
     * @param positionId The identifier of the newly created position.
     */
    function mint(uint256 amount) external returns (uint256 positionId) {
        // Update summations. Note that rewards accumulated when there is no one staking will
        // be lost. But this is only a small risk of value loss when the contract first goes live.
        _updateRewardSummations();

        // Get the new positionId and mint the associated NFT.
        positionId = ++_positionsLength;
        _mint(msg.sender, positionId);

        // Use a private function to handle the logic pertaining to depositing into a position.
        _stake(positionId, amount);
    }

    /**
     * @notice External function to deposit tokens to an existing position.
     * @param amount The amount of tokens to deposit into the position.
     * @param positionId The identifier of the position to deposit the funds into.
     */
    function stake(uint256 positionId, uint256 amount) external {
        // Update summations. Note that rewards accumulated when there is no one staking will
        // be lost. But this is only a small risk of value loss when the contract first goes live.
        _updateRewardSummations();

        // Use a private function to handle the logic pertaining to depositing into a position.
        _stake(positionId, amount);
    }

    /**
     * @notice External function to claim the accrued rewards of a position.
     * @param positionId The identifier of the position to claim the rewards of.
     */
    function harvest(uint256 positionId) external {
        // Update summations that govern the reward distribution.
        _updateRewardSummations();

        // Use a private function to handle the logic pertaining to harvesting rewards.
        // `_withdraw` with zero input amount works as harvesting.
        _withdraw(positionId, 0);
    }

    /**
     * @notice External function to deposit the accrued rewards of a position back to itself.
     * @param positionId The identifier of the position to compound the rewards of.
     */
    function compound(uint256 positionId) external {
        // Update summations that govern the reward distribution.
        _updateRewardSummations();

        // Use a private function to handle the logic pertaining to compounding rewards.
        // `_stake` with zero input amount works as compounding.
        _stake(positionId, 0);
    }

    /**
     * @notice External function to withdraw given amount of staked balance, plus all the accrued
     *         rewards from the position.
     * @param positionId The identifier of the position to withdraw the balance.
     * @param amount The amount of staked tokens, excluding rewards, to withdraw from the position.
     */
    function withdraw(uint256 positionId, uint256 amount) external {
        // Update summations that govern the reward distribution.
        _updateRewardSummations();

        // Use a private function to handle the logic pertaining to withdrawing the staked balance.
        _withdraw(positionId, amount);
    }

    /**
     * @notice External function to close a position by burning the associated NFT.
     * @param positionId The identifier of the position to close.
     */
    function burn(uint256 positionId) external {
        // To prevent mistakes, ensure only valueless positions can be burned.
        if (positions[positionId].valueVariables.balance != 0) revert InvalidToken();

        // Burn the associated NFT and delete all position properties.
        _burn(positionId);
    }

    /**
     * @notice External function to exit from a position by forgoing rewards.
     * @param positionId The identifier of the position to exit.
     */
    function emergencyExit(uint256 positionId) external {
        // Do not update summations, because a faulty rewarding algorithm might be the
        // culprit locking the staked balance in the contract. Nonetheless, for consistency, use a
        // private function to handle the logic pertaining to emergency exit.
        _emergencyExit(positionId);
    }

    /**
     * @notice External function to stake to or compound multiple positions.
     * @dev This saves gas by updating summations only once.
     * @param positionIds An array of identifiers of positions to stake to.
     * @param amounts An array of amount of tokens to stake to the corresponding positions.
     */
    function multiStake(uint256[] calldata positionIds, uint256[] calldata amounts) external {
        // Update summations only once. Note that rewards accumulated when there is no one
        // staking will be lost. But this is only a small risk of value loss if a reward period
        // during no one staking is followed by staking.
        _updateRewardSummations();

        // Ensure array lengths match.
        uint256 length = positionIds.length;
        if (length != amounts.length) revert MismatchedArrayLengths();

        for (uint256 i = 0; i < length; ) {
            _stake(positionIds[i], amounts[i]);

            // Counter realistically cannot overflow.
            unchecked {
                ++i;
            }
        }
    }

    /**
     * @notice External function to withdraw or harvest from multiple positions.
     * @dev This saves gas by updating summations only once.
     * @param positionIds An array of identifiers of positions to withdraw from.
     * @param amounts An array of amount of tokens to withdraw from corresponding positions.
     */
    function multiWithdraw(uint256[] calldata positionIds, uint256[] calldata amounts) external {
        // Update summations only once.
        _updateRewardSummations();

        // Ensure array lengths match.
        uint256 length = positionIds.length;
        if (length != amounts.length) revert MismatchedArrayLengths();

        for (uint256 i = 0; i < length; ) {
            _withdraw(positionIds[i], amounts[i]);

            // Counter realistically cannot overflow.
            unchecked {
                ++i;
            }
        }
    }

    /**
     * @notice External only-owner function to set how long the token approvals should be ignored.
     * @param newApprovalPauseDuration The new duration during which token approvals are ignored.
     */
    function setApprovalPauseDuration(uint256 newApprovalPauseDuration)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        // Ensure new approvalPauseDuration is less than the max allowed.
        if (newApprovalPauseDuration > MAX_APPROVAL_PAUSE_DURATION) revert OutOfBounds();

        // Update the state variable and emit an event.
        approvalPauseDuration = newApprovalPauseDuration;
        emit PauseDurationSet(newApprovalPauseDuration);
    }

    /**
     * @notice External only-owner function to change the contract that constructs tokenURIs.
     * @param newTokenMetadata The addresses of the new contract address that constructs tokenURIs.
     */
    function setTokenMetadata(ITokenMetadata newTokenMetadata)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        tokenMetadata = newTokenMetadata;
        emit TokenMetadataSet(newTokenMetadata);
    }

    /**
     * @notice External view function to get the reward rate of a position.
     * @dev In SAR, positions have different APRs, unlike other staking algorithms. This external
     *      function clearly demonstrates how the SAR algorithm is supposed to distribute the
     *      rewards based on “value”, which is balance times staking duration. This external
     *      function can be considered as a specification.
     * @param positionId The identifier of the position to check the reward rate of.
     * @return The rewards per second of the position.
     */
    function positionRewardRate(uint256 positionId) external view returns (uint256) {
        // Get totalValue and positionValue.
        uint256 totalValue = _getValue(totalValueVariables);
        uint256 positionValue = _getValue(positions[positionId].valueVariables);

        // Return the rewardRate of the position. Do not revert if totalValue is zero.
        return positionValue == 0 ? 0 : (rewardRate() * positionValue) / totalValue;
    }

    /**
     * @notice External view function to get the accrued rewards of a position. It takes the
     *         pending rewards since lastUpdate into consideration.
     * @param positionId The identifier of the position to check the accrued rewards of.
     * @return The amount of rewards that have been accrued in the position.
     */
    function positionPendingRewards(uint256 positionId) external view returns (uint256) {
        // Create a storage pointer for the position.
        Position storage position = positions[positionId];

        // Get the delta of summations. Use incremented `rewardSummationsStored` based on the
        // pending rewards.
        RewardSummations memory deltaRewardSummations = _getDeltaRewardSummations(position, true);

        // Return the pending rewards of the position based on the difference in rewardSummations.
        return _earned(deltaRewardSummations, position);
    }

    /**
     * @notice Private function to deposit tokens to an existing position.
     * @param amount The amount of tokens to deposit into the position.
     * @param positionId The identifier of the position to deposit the funds into.
     * @dev Specifications:
     *      - Deposit `amount` tokens to the position associated with `positionId`,
     *      - Make the staking duration of `amount` restart,
     *      - Claim accrued `reward` tokens of the position,
     *      - Deposit `reward` tokens back into the position,
     *      - Make the staking duration of `reward` tokens start from zero.
     *      - Do not make the staking duration of the existing `balance` restart,
     */
    function _stake(uint256 positionId, uint256 amount) private onlyOwner(positionId) {
        // Create a storage pointer for the position.
        Position storage position = positions[positionId];

        // Get rewards accrued in the position.
        uint256 reward = _positionPendingRewards(position);

        // Include reward amount in total amount to be staked.
        uint256 totalAmount = amount + reward;
        if (totalAmount == 0) revert NoEffect();

        // Get the new total staked amount and ensure it fits 96 bits.
        uint256 newTotalStaked = totalValueVariables.balance + totalAmount;
        if (newTotalStaked > type(uint96).max) revert Overflow();

        unchecked {
            // Increment the state variables pertaining to total value calculation.
            uint160 addedEntryTimes = uint160(block.timestamp * totalAmount);
            totalValueVariables.sumOfEntryTimes += addedEntryTimes;
            totalValueVariables.balance = uint96(newTotalStaked);

            // Increment the position properties pertaining to position value calculation.
            ValueVariables storage positionValueVariables = position.valueVariables;
            uint256 oldBalance = positionValueVariables.balance;
            positionValueVariables.balance = uint96(oldBalance + totalAmount);
            positionValueVariables.sumOfEntryTimes += addedEntryTimes;

            // Increment the previousValues.
            position.previousValues += uint160(
                oldBalance * (block.timestamp - position.lastUpdate)
            );
        }

        // Snapshot the lastUpdate and summations.
        _snapshotRewardSummations(position);

        // Transfer amount tokens from user to the contract, and emit the associated event.
        if (amount != 0) _transferFromCaller(amount);
        emit Staked(positionId, amount, reward);
    }

    /**
     * @notice Private function to withdraw given amount of staked balance, plus all the accrued
     *         rewards from the position. Also acts as harvest when input amount is zero.
     * @param positionId The identifier of the position to withdraw the balance.
     * @param amount The amount of staked tokens, excluding rewards, to withdraw from the position.
     * @dev Specifications:
     *      - Claim accrued `reward` tokens of the position,
     *      - Send `reward` tokens from the contract to the position owner,
     *      - Send `amount` tokens from the contract to the position owner,
     *      - Make the staking duration of the remaining `balance` restart,
     *      - Ignore NFT spending approvals for a duration set by the admin.
     */
    function _withdraw(uint256 positionId, uint256 amount) private onlyOwner(positionId) {
        // Create a storage pointer for the position.
        Position storage position = positions[positionId];

        // Get position balance and ensure sufficient balance exists.
        uint256 oldBalance = position.valueVariables.balance;
        if (amount > oldBalance) revert InsufficientBalance();

        // Get accrued rewards of the position and get totalAmount to withdraw (incl. rewards).
        uint256 reward = _positionPendingRewards(position);
        uint256 totalAmount = amount + reward;
        if (totalAmount == 0) revert NoEffect();

        unchecked {
            // Get the remaining balance in the position.
            uint256 remaining = oldBalance - amount;

            // Decrement the withdrawn amount from totalStaked.
            totalValueVariables.balance -= uint96(amount);

            // Update sumOfEntryTimes.
            uint256 newEntryTimes = block.timestamp * remaining;
            ValueVariables storage positionValueVariables = position.valueVariables;
            totalValueVariables.sumOfEntryTimes = uint160(
                totalValueVariables.sumOfEntryTimes +
                    newEntryTimes -
                    positionValueVariables.sumOfEntryTimes
            );

            // Decrement the withdrawn amount from position balance and update position entryTimes.
            positionValueVariables.balance = uint96(remaining);
            positionValueVariables.sumOfEntryTimes = uint160(newEntryTimes);
        }

        // Reset the previous values, as we have restarted the staking duration.
        position.previousValues = 0;

        // Update lastDevaluation, as resetting the staking duration devalues the position.
        position.lastDevaluation = uint48(block.timestamp);

        // Snapshot the lastUpdate and summations.
        _snapshotRewardSummations(position);

        // Transfer withdrawn amount and rewards to the user, and emit the associated event.
        _transferToCaller(totalAmount);
        emit Withdrawn(positionId, amount, reward);
    }

    /**
     * @notice External function to exit from a position by forgoing rewards.
     * @param positionId The identifier of the position to exit from.
     * @dev Specifications:
     *      - Burn the NFT associated with `positionId`,
     *      - Close the position associated with `positionId`,
     *      - Send `balance` tokens of the position to the user wallet,
     *      - Ignore `reward` tokens, making them permanently irrecoverable.
     */
    function _emergencyExit(uint256 positionId) private onlyOwner(positionId) {
        // Move the queried position to memory.
        ValueVariables memory positionValueVariables = positions[positionId].valueVariables;

        // Decrement the state variables pertaining to total value calculation.
        uint96 balance = positionValueVariables.balance;
        unchecked {
            totalValueVariables.balance -= balance;
            totalValueVariables.sumOfEntryTimes -= positionValueVariables.sumOfEntryTimes;
        }

        // Simply destroy the position.
        _burn(positionId);

        // Transfer only the staked balance from the contract to user.
        _transferToCaller(balance);
        emit Withdrawn(positionId, balance, 0);
    }

    /**
     * @notice Private function to claim the total pending rewards, and based on the claimed amount
     *         update the two variables that govern the reward distribution.
     */
    function _updateRewardSummations() private {
        // Get rewards, in the process updating the last update time.
        uint256 rewards = _claim();

        // Get incrementations based on the reward amount.
        (
            uint256 idealPositionIncrementation,
            uint256 rewardPerValueIncrementation
        ) = _getRewardSummationsIncrementations(rewards);

        // Increment the summations.
        rewardSummationsStored.idealPosition += idealPositionIncrementation;
        rewardSummationsStored.rewardPerValue += rewardPerValueIncrementation;
    }

    /**
     * @notice Private function to snapshot two rewards variables and record the timestamp.
     * @param position The storage pointer to the position to record the snapshot for.
     */
    function _snapshotRewardSummations(Position storage position) private {
        position.lastUpdate = uint48(block.timestamp);
        position.rewardSummationsPaid = rewardSummationsStored;
    }

    /**
     * @notice Private view function to get the accrued rewards of a position.
     * @dev The call to this function must only be made after the summations are updated
     *      through `_updateRewardSummations()`.
     * @param position The properties of the position.
     * @return The accrued rewards of the position.
     */
    function _positionPendingRewards(Position storage position) private view returns (uint256) {
        // Get the change in summations since the position was last updated. When calculating
        // the delta, do not increment `rewardSummationsStored`, as they had to be updated anyways.
        RewardSummations memory deltaRewardSummations = _getDeltaRewardSummations(position, false);

        // Return the pending rewards of the position.
        return _earned(deltaRewardSummations, position);
    }

    /**
     * @notice Private view function to get the difference between a position’s summations
     *         (‘paid’) and global summations (‘stored’).
     * @param position The position for which to calculate the delta of summations.
     * @param increment Whether to the incremented `rewardSummationsStored` based on the pending
     *                  rewards of the contract.
     * @return The difference between the `rewardSummationsStored` and `rewardSummationsPaid`.
     */
    function _getDeltaRewardSummations(Position storage position, bool increment)
        private
        view
        returns (RewardSummations memory)
    {
        // If position had no update to its summations yet, return zero.
        if (position.lastUpdate == 0) return RewardSummations(0, 0);

        // Create storage pointer to the position’s summations.
        RewardSummations storage rewardSummationsPaid = position.rewardSummationsPaid;

        // If requested, return the incremented `rewardSummationsStored`.
        if (increment) {
            // Get pending rewards, without updating the `lastUpdate`.
            uint256 rewards = _pendingRewards();

            // Get incrementations based on the reward amount.
            (
                uint256 idealPositionIncrementation,
                uint256 rewardPerValueIncrementation
            ) = _getRewardSummationsIncrementations(rewards);

            // Increment and return the incremented the summations.
            return
                RewardSummations(
                    rewardSummationsStored.idealPosition +
                        idealPositionIncrementation -
                        rewardSummationsPaid.idealPosition,
                    rewardSummationsStored.rewardPerValue +
                        rewardPerValueIncrementation -
                        rewardSummationsPaid.rewardPerValue
                );
        }

        // Otherwise just return the the delta, ignoring any incrementation from pending rewards.
        return
            RewardSummations(
                rewardSummationsStored.idealPosition - rewardSummationsPaid.idealPosition,
                rewardSummationsStored.rewardPerValue - rewardSummationsPaid.rewardPerValue
            );
    }

    /**
     * @notice Private view function to calculate the `rewardSummationsStored` incrementations
     *         based on the given reward amount.
     * @param rewards The amount of rewards to use for calculating the incrementation.
     * @return idealPositionIncrementation The incrementation to make to the idealPosition.
     * @return rewardPerValueIncrementation The incrementation to make to the rewardPerValue.
     */
    function _getRewardSummationsIncrementations(uint256 rewards)
        private
        view
        returns (uint256 idealPositionIncrementation, uint256 rewardPerValueIncrementation)
    {
        // Calculate the totalValue, then get the incrementations only if value is non-zero.
        uint256 totalValue = _getValue(totalValueVariables);
        if (totalValue != 0) {
            idealPositionIncrementation = (rewards * block.timestamp * PRECISION) / totalValue;
            rewardPerValueIncrementation = (rewards * PRECISION) / totalValue;
        }
    }

    /**
     * @notice Private view function to get the position or contract value.
     * @dev Value refers to the sum of each `wei` of tokens’ staking durations. So if there are
     *      10 tokens staked in the contract, and each one of them has been staked for 10 seconds,
     *      then the value is 100 (`10 * 10`). To calculate value we use sumOfEntryTimes, which is
     *      the sum of each `wei` of tokens’ staking-duration-starting timestamp. The formula
     *      below is intuitive and simple to derive. We will leave proving it to the reader.
     * @return The total value of contract or a position.
     */
    function _getValue(ValueVariables storage valueVariables) private view returns (uint256) {
        return block.timestamp * valueVariables.balance - valueVariables.sumOfEntryTimes;
    }

    /**
     * @notice Low-level private view function to get the accrued rewards of a position.
     * @param deltaRewardSummations The difference between the ‘stored’ and ‘paid’ summations.
     * @param position The position to check the accrued rewards of.
     * @return The accrued rewards of the position.
     */
    function _earned(RewardSummations memory deltaRewardSummations, Position storage position)
        private
        view
        returns (uint256)
    {
        // Refer to the Combined Position section of the Proofs on why and how this formula works.
        return
            position.lastUpdate == 0
                ? 0
                : (((deltaRewardSummations.idealPosition -
                    (deltaRewardSummations.rewardPerValue * position.lastUpdate)) *
                    position.valueVariables.balance) +
                    (deltaRewardSummations.rewardPerValue * position.previousValues)) / PRECISION;
    }

    /* *********************** */
    /* OVERRIDES and NFT STUFF */
    /* *********************** */

    function tokensOfOwnerByIndex(
        address owner,
        uint256 from,
        uint256 to
    ) external view returns (uint256[] memory) {
        if (from > to) revert OutOfBounds();

        uint256 length = to - from + 1;
        uint256[] memory tokens = new uint256[](length);
        while (from <= to) {
            tokens[from] = tokenOfOwnerByIndex(owner, from);
            unchecked {
                ++from;
            }
        }
        return tokens;
    }

    function _burn(uint256 tokenId) internal override onlyOwner(tokenId) {
        // Delete position when burning the NFT.
        delete positions[tokenId];
        super._burn(tokenId);
    }

    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 tokenId,
        uint256 batchSize
    ) internal override {
        // Ignore approvals for a period following a destructive action.
        if (msg.sender != from) {
            uint256 pausedUntil = positions[tokenId].lastDevaluation + approvalPauseDuration;
            if (block.timestamp <= pausedUntil) revert TooEarly();
        }

        super._beforeTokenTransfer(from, to, tokenId, batchSize);
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        ERC721._requireMinted(tokenId);

        // Use external contract to handle token metadata.
        return tokenMetadata.tokenURI(this, tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721Enumerable, AccessControlEnumerable)
        returns (bool)
    {
        return
            AccessControlEnumerable.supportsInterface(interfaceId) ||
            ERC721Enumerable.supportsInterface(interfaceId);
    }
}
