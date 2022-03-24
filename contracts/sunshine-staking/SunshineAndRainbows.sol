// SPDX-License-Identifier: UNLICENSED
// solhint-disable not-rely-on-time
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

interface IRewardRegulator {
    function pendingRewards(address account) external view returns (uint);

    function rewardRate() external view returns (uint);

    function claim() external returns (uint);

    function rewardToken() external returns (IERC20);
}

/**
 * @title Sunshine and Rainbows
 * @notice Sunshine and Rainbows is a novel staking algorithm that gives
 * more rewards to users with longer staking durations
 * @dev For a general overview refer to `README.md`. For the proof of the
 * algorithm refer to the proof linked in `README.md`.
 * @author shung for Pangolin & cryptofrens.xyz
 */
contract SunshineAndRainbows is ReentrancyGuard {
    using EnumerableSet for EnumerableSet.UintSet;
    using SafeERC20 for IERC20;
    using Math for uint;

    struct Position {
        // Amount of claimable rewards of the position
        uint reward;
        // Amount of tokens staked in the position
        uint balance;
        // Last time the position was updated
        uint lastUpdate;
        // `_rewardsPerStakingDuration` on position's last update
        uint rewardsPerStakingDuration;
        // `_idealPosition` on position's last update
        uint idealPosition;
        // Owner of the position
        address owner;
    }

    /// @notice The mapping of positions' ids to their properties
    mapping(uint => Position) public positions;

    /// @notice A set of all positions of a user used for interfacing
    mapping(address => EnumerableSet.UintSet) internal _userPositions;

    /// @notice The contract that determines the rewards of this contract
    IRewardRegulator public immutable rewardRegulator;

    /// @notice The token that is distributed as reward
    IERC20 public immutable rewardToken;

    /// @notice The token that can be staked in the contract
    IERC20 public immutable stakingToken;

    /// @notice Total amount of tokens staked in the contract
    uint public totalSupply;

    /// @notice Number of all positions created with the contract
    uint public positionsLength;

    /// @notice Time stamp of first stake event
    uint public initTime;

    /// @notice Sum of all active positions' `lastUpdate * balance`
    uint public sumOfEntryTimes;

    /**
     * @dev We have the precision to prevent zero rewards on rewardVariable
     * calculations, which can happen when staked tokens are more than reward
     * tokens. This precision is sufficient when the reward rate per second
     * to total staked supply ratio is above 1/(3*10^18). This high precision
     * introduces the risk of DOS due to overflow. To prevent overflow, one
     * must ensure that the amount of rewards emitted in total must never pass
     * 10^35. This guarantees +100 years of operations.
     */
    uint private constant PRECISION = 10**30;

    /**
     * @notice Sum of all intervals' (`rewards`/`stakingDuration`)
     * @dev Refer to `sum of r/S` in the proof for more details.
     */
    uint internal _rewardsPerStakingDuration;

    /**
     * @notice Hypothetical rewards accumulated by an ideal position whose
     * `lastUpdate` equals `initTime`, and `balance` equals one.
     * @dev Refer to `sum of I` in the proof for more details.
     */
    uint internal _idealPosition;

    event Harvested(uint position, uint reward);
    event Staked(uint position, uint amount);
    event Withdrawn(uint position, uint amount);

    /**
     * @notice Makes state changes to the properties' of a position whenever it
     * is staked, withdrawn, or harvested. Those events resets to reward rate
     * of a position to zero, which then gradually increase.
     * @dev Note that the modifier mostly concerns with the position being
     * updated. The only exception is sumOfEntryTimes, which is concerned with
     * the global reward rate.
     */
    modifier updatePosition(uint posId) {
        Position storage position = positions[posId];
        bool updated;
        // only make changes if it wasn't already updated this instance
        if (position.lastUpdate != block.timestamp) {
            updated = true;
            // calculated earned rewards when this isn't the first staking
            if (position.lastUpdate != 0) {
                position.reward = _earned(
                    posId,
                    _idealPosition,
                    _rewardsPerStakingDuration
                );
                // update sum of entry times by removing old balance
                sumOfEntryTimes -= (position.lastUpdate * position.balance);
            }
            // update position's properties
            position.lastUpdate = block.timestamp;
            position.idealPosition = _idealPosition;
            position.rewardsPerStakingDuration = _rewardsPerStakingDuration;
        }
        _;
        // update sum of entry times by adding new balance
        if (updated) sumOfEntryTimes += (block.timestamp * position.balance);
    }

    /**
     * @notice Constructs the Sunshine And Rainbows contract
     * @param newStakingToken The token that will be staked for rewards
     * @param newRewardRegulator The contract that will determine the global
     * reward rate
     */
    constructor(address newStakingToken, address newRewardRegulator) {
        require(
            newStakingToken != address(0) && newRewardRegulator != address(0),
            "SAR::Constructor: zero address"
        );
        stakingToken = IERC20(newStakingToken);
        rewardRegulator = IRewardRegulator(newRewardRegulator);
        rewardToken = rewardRegulator.rewardToken();
    }

    /**
     * @notice Harvests the accumulated rewards from multiple positions
     * @dev This call also resets the positions' reward rates to zero
     * @param posIds IDs of the positions to harvest from
     */
    function harvest(uint[] calldata posIds) external nonReentrant {
        _updateRewardVariables();
        for (uint i; i < posIds.length; ++i) {
            require(
                _harvest(posIds[i], msg.sender) != 0,
                "SAR::harvest: no reward"
            );
        }
    }

    /**
     * @notice Creates a new position and stakes tokens to it
     * @dev The reward rate of the new position starts from zero
     * @param amount Amount of tokens to stake
     * @param to Owner of the new position
     */
    function stake(uint amount, address to)
        external
        virtual
        nonReentrant
    {
        _updateRewardVariables();
        _stake(_createPosition(to), amount, msg.sender);
    }

    /**
     * @notice Withdraws tokens from multiple positions
     * @dev This call also resets the positions' reward rates to zero
     * @param posIds IDs of the positions to withdraw from
     * @param amounts Amount of tokens to withdraw from corresponding positions
     */
    function withdraw(uint[] calldata posIds, uint[] calldata amounts)
        external
        virtual
        nonReentrant
    {
        _updateRewardVariables();
        for (uint i; i < posIds.length; ++i) {
            _withdraw(posIds[i], amounts[i]);
        }
    }

    /**
     * @notice Exits from multiple positions by withdrawing all their tokens
     * and harvesting all the rewards
     * @param posIds The list of IDs of the positions to exit from
     */
    function exit(uint[] calldata posIds) external virtual nonReentrant {
        _updateRewardVariables(); // saves gas by updating only once
        for (uint i; i < posIds.length; ++i) {
            uint posId = posIds[i];
            _withdraw(posId, positions[posId].balance);
            _harvest(posId, msg.sender);
        }
    }

    /**
     * @notice Returns the pending rewards of multiple positions
     * @param posIds The IDs of the positions to check the rewards
     * @return The amount of tokens that can be claimed for each position
     */
    function pendingRewards(uint[] calldata posIds)
        external
        view
        returns (uint[] memory)
    {
        (uint x, uint y) = _rewardVariables(
            rewardRegulator.pendingRewards(address(this))
        );
        uint[] memory rewards = new uint[](posIds.length);
        for (uint i; i < posIds.length; ++i) {
            rewards[i] = _earned(posIds[i], x, y);
        }
        return rewards;
    }

    /**
     * @notice Returns the reward rates of multiple position
     * @param posIds The IDs of the positions to check the reward rates
     * @return The reward rates per second of each position
     */
    function rewardRates(uint[] calldata posIds)
        external
        view
        returns (uint[] memory)
    {
        uint[] memory rates = new uint[](posIds.length);
        uint stakingDuration = block.timestamp * totalSupply - sumOfEntryTimes;
        if (stakingDuration == 0) return rates;
        for (uint i; i < posIds.length; ++i) {
            Position memory position = positions[posIds[i]];
            rates[i] =
                (rewardRegulator.rewardRate() *
                    (block.timestamp - position.lastUpdate) *
                    position.balance) /
                stakingDuration;
        }
        return rates;
    }

    /**
     * @notice Simple interfacing function to list all positions of a user
     * @return The list of user's positions
     */
    function positionsOf(address account)
        external
        view
        returns (uint[] memory)
    {
        return _userPositions[account].values();
    }

    /**
     * @notice Updates position then withdraws tokens it
     * @dev It must always be called after `_updateRewardVariables()`
     * @param amount Amount of tokens to withdraw
     * @param posId ID of the position to withdraw from
     */
    function _withdraw(uint posId, uint amount)
        internal
        virtual
        updatePosition(posId)
    {
        Position storage position = positions[posId];
        require(amount != 0, "SAR::_withdraw: zero amount");
        require(position.owner == msg.sender, "SAR::_withdraw: unauthorized");
        require(position.balance >= amount, "SAR::_withdraw: low balance");
        unchecked {
            position.balance -= amount;
        }
        totalSupply -= amount;
        stakingToken.safeTransfer(msg.sender, amount);
        emit Withdrawn(posId, amount);
    }

    /**
     * @notice Updates positions then stakes tokens to it
     * @param posId ID of the position to stake to
     * @param amount Amount of tokens to stake
     * @param from The address that will supply the tokens for the position
     */
    function _stake(
        uint posId,
        uint amount,
        address from
    ) internal virtual updatePosition(posId) {
        require(amount != 0, "SAR::_stake: zero amount");
        if (initTime == 0) initTime = block.timestamp;
        totalSupply += amount;
        positions[posId].balance += amount;
        if (from != address(this))
            stakingToken.safeTransferFrom(msg.sender, address(this), amount);
        emit Staked(posId, amount);
    }

    /**
     * @notice Updates position then harvests its rewards
     * @param posId ID of the position to harvest from
     * @param to The address that will receive the rewards of the position
     */
    function _harvest(uint posId, address to)
        internal
        updatePosition(posId)
        returns (uint)
    {
        Position storage position = positions[posId];
        require(position.owner == msg.sender, "SAR::_harvest: unauthorized");
        // Remove position from the set: Due to `!= 0` check in `harvest()`
        // function, if position has no rewards the position will not be
        // removed. This is not ideal but we can live with it.
        if (position.balance == 0) _userPositions[msg.sender].remove(posId);
        uint reward = position.reward;
        if (reward != 0) {
            position.reward = 0;
            rewardToken.safeTransfer(to, reward);
            emit Harvested(posId, reward);
        }
        return reward;
    }

    /**
     * @notice Creates a new position
     * @param to The address that will own the position
     * @return The ID of the position that was created
     */
    function _createPosition(address to) internal returns (uint) {
        require(to != address(0), "SAR::_createPosition: bad recipient");
        positionsLength++; // posIds start from 1
        _userPositions[to].add(positionsLength); // for interfacing
        positions[positionsLength].owner = to;
        return positionsLength;
    }

    /// @notice Updates the two variables that govern the reward distribution
    function _updateRewardVariables() internal {
        if (totalSupply != 0)
            (_idealPosition, _rewardsPerStakingDuration) = _rewardVariables(
                rewardRegulator.claim()
            );
    }

    /**
     * @notice Gets the pending rewards of a position based on given reward
     * variables
     * @dev Refer to the derived formula at the end of section 2.3 of proof
     * @param posId The ID of the position to check the rewards
     * @param idealPosition The sum of ideal position's rewards at a reference
     * time
     * @param rewardsPerStakingDuration The sum of rewards per staking duration
     * at the same reference time
     */
    function _earned(
        uint posId,
        uint idealPosition,
        uint rewardsPerStakingDuration
    ) internal view virtual returns (uint) {
        Position memory position = positions[posId];
        if (position.lastUpdate == 0) return position.reward;
        /*
         * core formula in eqn:
         * ( ( sum I from 1 to m - sum I from 1 to n-1 ) -
         * ( sum (R/s) from 1 to m - sum (R/s) from 1 to n-1 )
         * times ( sum t from 1 to n-1 ) ) times y
         */
        return
            ((idealPosition -
                position.idealPosition -
                (rewardsPerStakingDuration -
                    position.rewardsPerStakingDuration) *
                (position.lastUpdate - initTime)) * position.balance) /
            PRECISION +
            position.reward;
    }

    /**
     * @notice Calculates the variables that govern the reward distribution
     * @dev For `idealPosition`, refer to `I` in the proof, for
     * `stakingDuration`, refer to `S`, and for `_rewardsPerStakingDuration`,
     * refer to `r/S`
     * @param rewards The rewards this contract is eligible to distribute
     * during the last interval (i.e., since the last update)
     */
    function _rewardVariables(uint rewards) private view returns (uint, uint) {
        uint stakingDuration = block.timestamp * totalSupply - sumOfEntryTimes;
        if (stakingDuration == 0)
            return (_idealPosition, _rewardsPerStakingDuration);
        return (
            // in eqn: sum (t times r over S)
            _idealPosition +
                ((block.timestamp - initTime) * rewards * PRECISION).ceilDiv(
                    stakingDuration
                ),
            // in eqn: sum (r over S)
            _rewardsPerStakingDuration +
                (rewards * PRECISION).ceilDiv(stakingDuration)
        );
        // use ceiling division for less rewards in `_earned()`. this causes
        // dust accumulation but prevents insufficient balance when all
        // positions get harvested at the same time. dust accumulation is
        // preferable to the latter.
    }
}
