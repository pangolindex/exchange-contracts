// SPDX-License-Identifier: UNLICENSED
// solhint-disable not-rely-on-time
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./FullMath.sol";

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
    using FullMath for FullMath.Uint512;

    struct Position {
        // Owner of the position
        address owner;
        // Amount of tokens staked in the position
        uint balance;
        // Last time the position was updated
        uint lastUpdate;
        // `_idealPosition` on position's last update
        FullMath.Uint512 idealPosition;
        // `_rewardsPerStakingDuration` on position's last update
        FullMath.Uint512 rewardsPerStakingDuration;
    }

    /// @notice The mapping of positions' ids to their properties
    Position[] public positions;

    /// @notice A set of all positions of a user used for interfacing
    mapping(address => EnumerableSet.UintSet) internal _userPositions;

    /// @notice The contract that determines the rewards of this contract
    IRewardRegulator public immutable rewardRegulator;

    /// @notice The token that is distributed as reward
    IERC20 public immutable rewardToken;

    /// @notice The token that can be staked in the contract
    IERC20 public immutable stakingToken;

    /**
     * @notice Sum of all intervals' (`rewards`/`stakingDuration`)
     * @dev Refer to `sum of r/S` in the proof for more details.
     */
    FullMath.Uint512 private _rewardsPerStakingDuration;

    /**
     * @notice Hypothetical rewards accumulated by an ideal position whose
     * `lastUpdate` equals `_initTime`, and `balance` equals one.
     * @dev Refer to `sum of I` in the proof for more details.
     */
    FullMath.Uint512 private _idealPosition;

    /// @notice Total amount of tokens staked in the contract
    uint public totalSupply;

    /// @notice Sum of all active positions' `lastUpdate * balance`
    uint public sumOfEntryTimes;

    /// @notice Time stamp of first stake event
    uint private _initTime;

    event Opened(uint position, uint amount);
    event Closed(uint position, uint amount, uint reward);
    event Harvested(uint position, uint reward);
    event Withdrawn(uint position, uint amount, uint reward);

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
        rewardToken = IRewardRegulator(newRewardRegulator).rewardToken();
    }

    /**
     * @notice Creates a new position and stakes tokens to it
     * @dev The reward rate of the new position starts from zero
     * @param amount Amount of tokens to stake
     */
    function open(uint amount) external virtual nonReentrant {
        if (totalSupply != 0) {
            _updateRewardVariables();
        } else if (_initTime == 0) {
            _initTime = block.timestamp;
        }
        _open(amount, msg.sender);
    }

    /**
     * @notice Exits from a position by withdrawing & harvesting all
     * @param posId The ID of the position to exit from
     */
    function close(uint posId) external virtual nonReentrant {
        _updateRewardVariables();
        _close(posId);
    }

    /**
     * @notice Harvests all rewards of a position, resetting its reward rate
     * @param posId The ID of the position to harvest from
     */
    function harvest(uint posId) external virtual nonReentrant {
        _updateRewardVariables();
        _harvest(posId);
    }

    /**
     * @notice Partially withdraws & harvests a position
     * @param posId The ID of the position to partially close
     * @param amount The amount of tokens to withdraw from the position
     */
    function withdraw(uint posId, uint amount) external virtual nonReentrant {
        _updateRewardVariables();
        _withdraw(posId, amount);
    }

    /**
     * @notice Exits from multiple positions by withdrawing all their tokens
     * and harvesting all the rewards
     * @param posIds The list of IDs of the positions to exit from
     */
    function multiClose(uint[] calldata posIds) external virtual nonReentrant {
        require(posIds.length <= 20, "SAR::multiClose: long array");
        _updateRewardVariables(); // saves gas by updating only once
        for (uint i; i < posIds.length; ++i) _close(posIds[i]);
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
        (
            FullMath.Uint512 memory idealPosition,
            FullMath.Uint512 memory rewardsPerStakingDuration
        ) = _rewardVariables(rewardRegulator.pendingRewards(address(this)));
        uint[] memory rewards = new uint[](posIds.length);
        for (uint i; i < posIds.length; ++i) {
            Position memory position = positions[posIds[i]];
            if (position.lastUpdate == 0) rewards[i] = 0;
            // duplicate of `_earned()` with temporary reward variables
            rewards[i] = idealPosition
                .sub(position.idealPosition)
                .sub(
                    rewardsPerStakingDuration
                        .sub(position.rewardsPerStakingDuration)
                        .mul(position.lastUpdate - _initTime)
                )
                .mul(position.balance)
                .shiftToUint256();
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
     * @notice Updates position, withdraws all its tokens, and harvests rewards
     * @dev It must always be called after `_updateRewardVariables()`
     * @param posId ID of the position to withdraw from
     */
    function _close(uint posId) internal virtual {
        Position storage position = positions[posId];
        require(position.owner == msg.sender, "SAR::_close: unauthorized");
        uint amount = position.balance;
        require(amount != 0, "SAR::_close: zero amount");

        // update global variables
        sumOfEntryTimes -= (position.lastUpdate * amount);
        totalSupply -= amount;

        // remove position from the set of the user
        _userPositions[msg.sender].remove(posId);

        // get earned rewards
        uint reward = _earned(posId);

        // disables the position
        position.balance = 0;

        // transfer rewards & stake balance to owner
        if (reward != 0) rewardToken.safeTransfer(msg.sender, reward);
        stakingToken.safeTransfer(msg.sender, amount);

        emit Closed(posId, amount, reward);
    }

    /**
     * @notice Creates positions then stakes tokens to it
     * @param amount Amount of tokens to stake
     * @param from The address that will supply the tokens for the position
     */
    function _open(uint amount, address from) internal virtual {
        require(amount != 0, "SAR::_open: zero amount");

        // update global variables
        sumOfEntryTimes += (block.timestamp * amount);
        totalSupply += amount;

        // update position variables
        uint posId = positions.length;
        positions.push(
            Position(
                msg.sender,
                amount,
                block.timestamp,
                _idealPosition,
                _rewardsPerStakingDuration
            )
        );

        // add position to the set for interfacing
        _userPositions[msg.sender].add(posId);

        // transfer tokens from user to the contract
        if (from != address(this))
            stakingToken.safeTransferFrom(from, address(this), amount);
        emit Opened(posId, amount);
    }

    /**
     * @notice Harvests rewards of a position
     * @dev This will reset the reward rate to zero, making the position behave
     * as a newly opened position
     * @param posId The Id of position to harvest the rewards from
     */
    function _harvest(uint posId) internal {
        Position storage position = positions[posId];
        require(position.owner == msg.sender, "SAR::_harvest: unauthorized");

        // update sumOfEntryTimes
        // by removing (balance * lastUpdate) and adding (balance * now).
        sumOfEntryTimes += ((block.timestamp - position.lastUpdate) *
            position.balance);

        // get earned rewards
        uint reward = _earned(posId);
        require(reward != 0, "SAR::_harvest: zero reward");

        // update position's variables (behaves as if position is re-opened)
        position.lastUpdate = block.timestamp;
        position.idealPosition = _idealPosition;
        position.rewardsPerStakingDuration = _rewardsPerStakingDuration;

        // transfer tokens from user to the contract
        rewardToken.safeTransfer(msg.sender, reward);
        emit Harvested(posId, reward);
    }

    /**
     * @notice Withdraws a portion of a position, and harvests rewards of the
     * withdrawn amount
     * @dev This will not reset the reward rate to zero, as it is only
     * harvesting the rewards of the withdrawn amount
     * @param posId The Id of position to withdraw from
     * @param amount The amount of tokens to withdraw
     */
    function _withdraw(uint posId, uint amount) internal {
        Position storage position = positions[posId];
        require(position.owner == msg.sender, "SAR::_withdraw: unauthorized");
        require(position.balance > amount, "SAR::_withdraw: use `close()`");
        require(amount != 0, "SAR::_withdraw: zero amount");

        // update global variables
        sumOfEntryTimes -= (position.lastUpdate * amount);
        totalSupply -= amount;

        // get earned rewards:
        // we only want the withdrawn amount's rewards to be harvested, so
        // we will do a little hack by temporarily changing position.balance
        // to withdrawn amount, which will be the balance used by _earned(),
        // then changing it back to actual remaining balance.
        uint remainingBalance = position.balance - amount;
        position.balance = amount;
        uint reward = _earned(posId);
        position.balance = remainingBalance;

        // transfer withdrawn amount to user
        stakingToken.safeTransfer(msg.sender, amount);
        if (reward != 0) rewardToken.safeTransfer(msg.sender, reward);
        emit Withdrawn(posId, amount, reward);
    }

    /// @notice Updates the two variables that govern the reward distribution
    function _updateRewardVariables() internal {
        (_idealPosition, _rewardsPerStakingDuration) = _rewardVariables(
            rewardRegulator.claim()
        );
    }

    /**
     * @notice Gets the pending rewards of a position based on given reward
     * variables
     * @dev Refer to the derived formula at the end of section 2.3 of proof
     * @param posId The ID of the position to check the rewards
     */
    function _earned(uint posId) internal view virtual returns (uint) {
        Position memory position = positions[posId];
        if (position.lastUpdate == 0) return 0;
        /*
         * core formula in EQN(7):
         * ( ( sum I from 1 to m - sum I from 1 to n-1 ) -
         * ( sum (R/s) from 1 to m - sum (R/s) from 1 to n-1 )
         * times ( sum t from 1 to n-1 ) ) times y
         */
        return
            _idealPosition
                .sub(position.idealPosition)
                .sub(
                    _rewardsPerStakingDuration
                        .sub(position.rewardsPerStakingDuration)
                        .mul(position.lastUpdate - _initTime)
                )
                .mul(position.balance)
                .shiftToUint256();
    }

    /**
     * @notice Calculates the variables that govern the reward distribution
     * @dev For `idealPosition`, refer to `I` in the proof, for
     * `stakingDuration`, refer to `S`, and for `_rewardsPerStakingDuration`,
     * refer to `r/S`
     * @param rewards The rewards this contract is eligible to distribute
     * during the last interval (i.e., since the last update)
     */
    function _rewardVariables(uint rewards)
        private
        view
        returns (FullMath.Uint512 memory, FullMath.Uint512 memory)
    {
        uint stakingDuration = block.timestamp * totalSupply - sumOfEntryTimes;
        if (stakingDuration == 0)
            return (_idealPosition, _rewardsPerStakingDuration);
        return (
            // `sum (t times r over S)` with 2**256 fixed denominator
            _idealPosition.add(
                FullMath.mul(
                    (block.timestamp - _initTime) * rewards,
                    FullMath.div256(stakingDuration)
                )
            ),
            // `sum (r over S)` with 2**256 fixed denominator
            _rewardsPerStakingDuration.add(
                FullMath.mul(rewards, FullMath.div256(stakingDuration))
            )
        );
    }
}
