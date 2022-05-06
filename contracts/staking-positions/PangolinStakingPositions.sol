// SPDX-License-Identifier: GPLv3
// solhint-disable not-rely-on-time
pragma solidity 0.8.13;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "./RewardFunding.sol";

/**
 * @title Pangolin Staking Positions
 * @notice Pangolin Staking Positions is a unique staking solution. It utilizes the Sunshine
 * and Rainbows (SAR) algorithm, which distributes rewards as a function of balance and
 * staking duration. See README and the proof paper to see how SAR works. In this
 * implementation, we track positions instead of users, and also make each position an NFT.
 *
 * @dev
 *
 * SAR algorithm distributes a given reward for an interval based on the following formula:
 *
 * `(balance_position / balance_total) * (stakingDuration_position / stakingDuration_average)`.
 *
 * Staking duration is how long a token has been staked. The staking duration of a token starts
 * when it is staked, restarts when its rewards are harvested, and ends when it is withdrawn.
 *
 * We can define `balance * stakingDuration` as `value`. So the new simplified formula becomes
 * `value_position / value_total`.
 *
 * Although this looks similar to just `balance_user / balance_total`, unlike balance, the value of
 * every position is constantly changing as a function of time. Therefore we cannot simply use the
 * standard staking algorithm (i.e.: Synthetix StakingRewards) for calculating rewards of users in
 * constant time. A new algorithm had to be invented for this reason.
 *
 * To understand the algorithm, one should read the proof. Then `_rewardVariabes()` and `_earned()`
 * functions can make sense.
 *
 * @author shung for Pangolin
 */
contract PangolinStakingPositions is ERC721, RewardFunding {
    struct Position {
        // The amount of tokens staked in the position.
        uint96 balance;
        // The sum of values (`balance * (block.timestamp - lastUpdate)`) of previous intervals. It
        // is only updated accordingly when more tokens are staked into an existing position. Other
        // calls than staking (i.e.: harvest and withdraw) must reset the value to zero. Correctly
        // updating this property allows for the staking duration of the existing balance of the
        // position to not restart when staking more tokens to the position. So it allows combining
        // together multiple positions with different staking durations. Refer to the `Combined
        // Positions` section of proofs on why this works.
        uint160 previousValues;
        // The last time the position was updated.
        uint48 lastUpdate;
        // The sum of each staked token of the position multiplied by its update time.
        uint160 entryTimes;
        // The last time the position's staking duration was restarted (withdraw or harvest).
        // This is used to prevent frontrunning when selling the NFT. It is not part of core algo.
        uint48 lastDevaluation;
        // `_idealPosition` on position's last update. Refer to `Ideal Position` section of proof.
        uint256 idealPosition;
        // `_rewardPerValue` on position's last update. See `Regular Position from Ideal Position`.
        uint256 rewardPerValue;
    }

    /// @notice The mapping of IDs of positions to their properties.
    mapping(uint256 => Position) public positions;

    /// @notice The sum of `balance` of all positions (PNG total supply fits 96 bits).
    uint96 public totalStaked;

    /// @notice The sum of `entryTimes` of all positions.
    uint160 public sumOfEntryTimes;

    /**
     * @notice The time stamp of the first deposit made to the contract, which is the start time of
     * the staking duration of the ideal position.
     */
    uint256 public initTime;

    /// @notice The duration when the NFT approvals are ignored after an update that devalues it.
    uint256 public approvalPauseDuration = 2 hours;

    /// @notice The total number of positions ever opened.
    uint256 private _positionsLength;

    /**
     * @notice The sum of `reward/totalValue` of each interval.
     * @dev `totalValue` is the sum of all staked tokens multiplied by their respective staking
     * durations.
     */
    uint256 private _rewardPerValue;

    /**
     * @notice Imaginary rewards accrued by a position with `lastUpdate == initTime && balance == 1`.
     * @dev At the end of each interval, the ideal position has a staking duration of
     * `block.timestamp - initTime`. Since its balance is one, its value equals its staking
     * duration. So, its value is also `block.timestamp - initTime`, and for a given reward at an
     * interval, the ideal position accrues `reward * (block.timestamp - initTime) / totalValue`.
     */
    uint256 private _idealPosition;

    /// @notice The fixed denominator used for storing reward variables.
    uint256 private constant PRECISION = 2**128;

    /// @notice The maximum approvalPauseDuration that can be set by the admin
    uint256 private constant MAX_APPROVAL_PAUSE_DURATION = 2 days;

    event Opened(uint256 position, uint256 amount);
    event Closed(uint256 position, uint256 amount, uint256 reward);
    event Staked(uint256 position, uint256 amount, uint256 reward);
    event Withdrawn(uint256 position, uint256 amount, uint256 reward);
    event Harvested(uint256 position, uint256 reward);
    event Compounded(uint256 position, uint256 reward);
    event EmergencyExited(uint256 position, uint256 amount);
    event ApprovalPauseDurationSet(uint256 approvalPauseDuration);

    error PNGPos__InsufficientBalance(uint256 currentBalance, uint256 requiredBalance);
    error PNGPos__InvalidApprovalPauseDuration(uint256 newApprovalPauseDuration);
    error PNGPos__InvalidInputAmount(uint256 inputAmount);
    error PNGPos__RewardOverflow(uint256 rewardAdded);
    error PNGPos__NotOwnerOfPosition(uint256 posId);
    error PNGPos__NoReward();
    error ERC721__InvalidToken(uint256 tokenId);

    modifier onlyOwner(uint256 posId) {
        if (ownerOf(posId) != msg.sender) revert PNGPos__NotOwnerOfPosition(posId);
        _;
    }

    /**
     * @notice Constructs a new PangolinStakingPositions contract.
     * @param newRewardsToken Both the staking and the reward token.
     * @param newAdmin The initial owner of the contract.
     */
    constructor(address newRewardsToken, address newAdmin)
        ERC721("Pangolin Staking Positions", "PNG-POS")
        RewardFunding(newRewardsToken, newAdmin)
    {}

    /**
     * @notice Opens a new position for the message sender.
     * @param amount The amount of tokens to transfer to the opened position.
     */
    function open(uint256 amount) external {
        if (totalStaked == 0) {
            // restart all when total staked is zero
            initTime = block.timestamp;
            (_idealPosition, _rewardPerValue) = (0, 0);
        } else {
            _updateRewardVariables();
        }
        _open(amount);
    }

    /**
     * @notice Deposits tokens to a position.
     * @param amount The amount of tokens to deposit into the position.
     * @param posId The ID of the position to deposit the funds into.
     */
    function stake(uint256 posId, uint256 amount) external {
        if (totalStaked == 0) {
            // restart all when total staked is zero
            // open and stake are the only actions that can be made when there is nothing staked
            initTime = block.timestamp;
            (_idealPosition, _rewardPerValue) = (0, 0);
        } else {
            _updateRewardVariables();
        }
        _stake(posId, amount);
    }

    /**
     * @notice Claims the accrued rewards of a position.
     * @param posId The ID of the position to claim the rewards of.
     */
    function harvest(uint256 posId) external {
        _updateRewardVariables();
        _harvest(posId);
    }

    /**
     * @notice Deposits the accrued rewards of a position back to itself.
     * @param posId The ID of the position to compound the rewards of.
     */
    function compound(uint256 posId) external {
        _updateRewardVariables();
        _compound(posId);
    }

    /**
     * @notice Withdraws all the accrued rewards and some or all the balance from the position.
     * @param posId The ID of the position to withdraw the balance.
     */
    function withdraw(uint256 posId, uint256 amount) external {
        _updateRewardVariables();
        _withdraw(posId, amount);
    }

    /**
     * @notice Closes a position by withdrawing the balance and claiming accrued rewards.
     * @param posId The ID of the position to close.
     */
    function close(uint256 posId) external {
        _updateRewardVariables();
        _close(posId);
    }

    /**
     * @notice Exits from a position by forgoing rewards.
     * @param posId The ID of the position to exit.
     */
    function emergencyExit(uint256 posId) external onlyOwner(posId) {
        Position memory position = positions[posId];
        uint96 balance = position.balance;
        totalStaked -= balance;
        sumOfEntryTimes -= position.entryTimes;
        position.balance = 0;
        position.previousValues = 0;
        position.entryTimes = 0;
        position.lastDevaluation = uint48(block.timestamp);
        _sendRewardsToken(msg.sender, balance);
        emit EmergencyExited(posId, balance);
    }

    /// @notice Closes multiple positions, saving gas than calling `close` multiple times.
    function multiClose(uint256[] calldata posIds) external {
        _updateRewardVariables();
        uint256 length = posIds.length;
        for (uint256 i; i < length; ++i) _close(posIds[i]);
    }

    /// @notice Compounds multiple positions, saving gas than calling `compound` multiple times.
    function multiCompound(uint256[] calldata posIds) external {
        _updateRewardVariables();
        uint256 length = posIds.length;
        for (uint256 i; i < length; ++i) _compound(posIds[i]);
    }

    /// @notice Sets how long the token approvals should be ignored after a destructive action.
    function setApprovalPauseDuration(uint256 newApprovalPauseDuration)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (newApprovalPauseDuration > MAX_APPROVAL_PAUSE_DURATION) {
            revert PNGPos__InvalidApprovalPauseDuration(newApprovalPauseDuration);
        }
        approvalPauseDuration = newApprovalPauseDuration;
        emit ApprovalPauseDurationSet(newApprovalPauseDuration);
    }

    /**
     * @notice Returns the reward rate of a position.
     * @param posId The ID of the position to check the reward rate of.
     * @return The reward rate per second of the position.
     */
    function positionRewardRate(uint256 posId) external view returns (uint256) {
        uint256 totalValue = block.timestamp * totalStaked - sumOfEntryTimes;
        if (totalValue == 0) return 0;
        Position memory position = positions[posId];
        uint256 positionValue = block.timestamp * position.balance - position.entryTimes;
        return (rewardRate * positionValue) / totalValue;
    }

    /**
     * @notice Returns the pending rewards of a position.
     * @param posId The ID of the position to check the pending rewards of.
     * @return The amount of rewards that have been accrued in the position.
     */
    function positionPendingRewards(uint256 posId) external view returns (uint256) {
        (uint256 tmpIdealPosition, uint256 tmpRewardPerValue) = _rewardVariables(
            _pendingRewards()
        );
        Position memory position = positions[posId];
        uint256 balance = position.balance;
        if (balance == 0) return 0;
        tmpRewardPerValue -= position.rewardPerValue;
        tmpIdealPosition -= position.idealPosition;
        // duplicate of `_earned()` with temporary/local reward variables
        return
            (((tmpIdealPosition - (tmpRewardPerValue * (position.lastUpdate - initTime))) *
                balance) + (tmpRewardPerValue * position.previousValues)) / PRECISION;
    }

    /**
     * @notice A suggested interface standard for NFT slippage control. Join the discussion:
     * https://ethereum-magicians.org/t/erc721-extension-valueof-as-a-slippage-control/9071
     */
    function valueOf(uint256 tokenId) external view returns (uint256) {
        if (!_exists(tokenId)) revert ERC721__InvalidToken(tokenId);
        Position memory position = positions[tokenId];
        return block.timestamp * position.balance - position.entryTimes;
    }

    /// @notice NFT metadata
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        /*************** TBD ***************/
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, AccessControl)
        returns (bool)
    {
        return
            AccessControl.supportsInterface(interfaceId) || ERC721.supportsInterface(interfaceId);
    }

    function _isApprovedOrOwner(address spender, uint256 tokenId)
        internal
        view
        override(ERC721)
        returns (bool)
    {
        if (!_exists(tokenId)) revert ERC721__InvalidToken(tokenId);
        address owner = ERC721.ownerOf(tokenId);
        if (spender == owner) return true;
        // The following if statement is added to prevent frontrunning due to MEV or due to NFT
        // marketplaces being slow in updating metadata. Since there is no standardized way of
        // slippage checks for NFTs, we simply ignore token approvals for `approvalPauseDuration`
        // after an action which inherently devalues the NFT is made (i.e.: `withdraw` and
        // `harvest`). This prevents MEV, and greatly reduces the risk of buyers getting tricked.
        if (block.timestamp < positions[tokenId].lastDevaluation + approvalPauseDuration) {
            return false;
        }
        return (getApproved(tokenId) == spender || isApprovedForAll(owner, spender));
    }

    /**
     * @dev Specs:
     * 1) Mint a new NFT,
     * 2) Open a new position linked to the NFT,
     * 3) Deposit `amount` tokens to the position,
     * 4) Make the staking duration of `amount` start from zero.
     */
    function _open(uint256 amount) private {
        uint256 newTotalStaked = totalStaked + amount;
        if (amount == 0 || newTotalStaked > type(uint96).max) {
            revert PNGPos__InvalidInputAmount(amount);
        }

        // update global variables
        uint160 addedEntryTimes = uint160(block.timestamp * amount);
        sumOfEntryTimes += addedEntryTimes;
        totalStaked = uint96(newTotalStaked);

        // mint nft and create position
        uint256 posId = _positionsLength++;
        _mint(msg.sender, posId);
        Position storage position = positions[posId];
        position.balance = uint96(amount);
        position.lastUpdate = uint48(block.timestamp);
        position.entryTimes = addedEntryTimes;
        position.idealPosition = _idealPosition;
        position.rewardPerValue = _rewardPerValue;

        // send tokens from user to the contract
        _receiveRewardsToken(msg.sender, amount);
        emit Opened(posId, amount);
    }

    /**
     * @dev Specs:
     * 1) Burn the NFT associated with `posId`,
     * 2) Close the position associated with `posId`,
     * 3) Send `balance` tokens of the position to the user wallet,
     * 4) Send `reward` tokens accumulated in the position to the user wallet.
     */
    function _close(uint256 posId) private onlyOwner(posId) {
        Position memory position = positions[posId];

        uint96 balance = position.balance;
        uint256 reward = _earned(posId);

        totalStaked -= balance;
        sumOfEntryTimes -= position.entryTimes;

        delete positions[posId];
        _burn(posId);

        _sendRewardsToken(msg.sender, balance + reward);
        emit Closed(posId, balance, reward);
    }

    /**
     * @dev Specs:
     * 1) Deposit `amount` tokens to the position associated with `posId`,
     * 2) Make the staking duration of `amount` restart,
     * 3) Do not make the staking duration of the existing `balance` restart,
     * 4) Claim accrued `reward` tokens of the position,
     * 5) Deposit `reward` tokens back into the position,
     * 6) Make the staking duration of `reward` tokens start from zero.
     */
    function _stake(uint256 posId, uint256 amount) private onlyOwner(posId) {
        Position storage position = positions[posId];

        uint256 reward = _earned(posId);
        uint256 totalAmount = amount + reward;
        uint256 newTotalStaked = totalStaked + totalAmount;
        if (amount == 0 || newTotalStaked > type(uint96).max) {
            revert PNGPos__InvalidInputAmount(amount);
        }

        uint160 addedEntryTimes = uint160(block.timestamp * totalAmount);
        sumOfEntryTimes += addedEntryTimes;
        totalStaked = uint96(newTotalStaked);

        uint256 oldBalance = position.balance;
        position.previousValues += uint160(oldBalance * (block.timestamp - position.lastUpdate));
        unchecked {
            position.balance = uint96(oldBalance + totalAmount);
        }
        position.lastUpdate = uint48(block.timestamp);
        position.entryTimes += addedEntryTimes;
        position.idealPosition = _idealPosition;
        position.rewardPerValue = _rewardPerValue;

        // transfer tokens from user to the contract
        _receiveRewardsToken(msg.sender, amount);
        emit Staked(posId, amount, reward);
    }

    /**
     * @dev Specs:
     * 1) Claim accrued `reward` tokens of the position,
     * 2) Deposit `reward` tokens back into the position,
     * 3) Make the staking duration of `reward` tokens restart,
     * 4) Do not make the staking duration of the existing `balance` restart.
     */
    function _compound(uint256 posId) private onlyOwner(posId) {
        Position storage position = positions[posId];

        uint256 reward = _earned(posId);
        uint256 newTotalStaked = totalStaked + reward;
        if (reward == 0) revert PNGPos__NoReward();
        if (newTotalStaked > type(uint96).max) revert PNGPos__RewardOverflow(reward);

        uint160 addedEntryTimes = uint160(block.timestamp * reward);
        sumOfEntryTimes += addedEntryTimes;
        totalStaked = uint96(newTotalStaked);

        uint256 oldBalance = position.balance;
        position.previousValues += uint160(oldBalance * (block.timestamp - position.lastUpdate));
        unchecked {
            position.balance = uint96(oldBalance + reward);
        }
        position.lastUpdate = uint48(block.timestamp);
        position.entryTimes += addedEntryTimes;
        position.idealPosition = _idealPosition;
        position.rewardPerValue = _rewardPerValue;

        emit Compounded(posId, reward);
    }

    /**
     * @dev Specs:
     * 1) Claim accrued `reward` tokens of the position,
     * 2) Send `reward` tokens to the user wallet,
     * 3) Make the staking duration of the existing `balance` restart,
     * 4) Ignore NFT spending approvals for a duration set by the admin.
     */
    function _harvest(uint256 posId) private onlyOwner(posId) {
        Position storage position = positions[posId];

        uint96 balance = position.balance;
        uint256 reward = _earned(posId); // get earned rewards
        if (reward == 0) revert PNGPos__NoReward();

        // update global variables (totalStaked is not changed)
        uint160 newEntryTimes = uint160(block.timestamp * balance);
        sumOfEntryTimes += (newEntryTimes - position.entryTimes);

        // update position variables (must behave as if position is re-opened)
        position.lastUpdate = uint48(block.timestamp);
        position.lastDevaluation = uint48(block.timestamp);
        position.previousValues = 0;
        position.entryTimes = newEntryTimes;
        position.idealPosition = _idealPosition;
        position.rewardPerValue = _rewardPerValue;

        // transfer rewards to the user
        _sendRewardsToken(msg.sender, reward);
        emit Harvested(posId, reward);
    }

    /**
     * @dev Specs:
     * 1) Claim accrued `reward` tokens of the position,
     * 2) Send `reward` tokens to the user wallet,
     * 3) Send `amount` tokens from the user `balance` to the user wallet,
     * 4) Make the staking duration of the remaining `balance` restart,
     * 5) Ignore NFT spending approvals for a duration set by the admin.
     */
    function _withdraw(uint256 posId, uint256 amount) private onlyOwner(posId) {
        Position storage position = positions[posId];

        uint256 oldBalance = position.balance;
        if (amount > oldBalance) revert PNGPos__InsufficientBalance(oldBalance, amount);
        uint256 remaining;
        unchecked {
            remaining = oldBalance - amount;
        }
        uint256 reward = _earned(posId); // get earned rewards

        // update global variables
        uint256 newEntryTimes = block.timestamp * remaining;
        totalStaked -= uint96(amount);
        sumOfEntryTimes = uint160(sumOfEntryTimes + newEntryTimes - position.entryTimes);

        // update position variables (must behave as if position is re-opened)
        position.balance = uint96(remaining);
        position.lastUpdate = uint48(block.timestamp);
        position.lastDevaluation = uint48(block.timestamp);
        position.previousValues = 0;
        position.entryTimes = uint160(newEntryTimes);
        position.idealPosition = _idealPosition;
        position.rewardPerValue = _rewardPerValue;

        // transfer rewards and withdrawn amount to the user
        _sendRewardsToken(msg.sender, reward + amount);
        emit Withdrawn(posId, amount, reward);
    }

    /**
     * @dev Claims pending rewards from RewardFunding, and based on the claimed amount updates the
     * two variables that govern the reward distribution.
     */
    function _updateRewardVariables() private {
        (_idealPosition, _rewardPerValue) = _rewardVariables(_claim());
    }

    /**
     * @dev Gets the pending rewards of caller. The call to this function must only be made after
     * the reward variables are updated through `_updateRewardVariables()`.
     */
    function _earned(uint256 posId) private view returns (uint256) {
        Position memory position = positions[posId];
        uint256 balance = position.balance;
        if (balance == 0) return 0;
        uint256 rewardPerValue = _rewardPerValue - position.rewardPerValue;
        uint256 idealPosition = _idealPosition - position.idealPosition;
        return
            (((idealPosition - (rewardPerValue * (position.lastUpdate - initTime))) * balance) +
                (rewardPerValue * position.previousValues)) / PRECISION;
    }

    /**
     * @dev Calculates the variables that govern the reward distribution.
     * @param rewards The amount of reward this contract can distribute.
     */
    function _rewardVariables(uint256 rewards) private view returns (uint256, uint256) {
        uint256 totalValue = block.timestamp * totalStaked - sumOfEntryTimes;
        if (totalValue == 0) return (_idealPosition, _rewardPerValue);
        return (
            _idealPosition + ((rewards * (block.timestamp - initTime)) * PRECISION) / totalValue,
            _rewardPerValue + (rewards * PRECISION) / totalValue
        );
    }
}
