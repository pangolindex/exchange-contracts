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
        // `_rewardsPerStakingDuration` on position's last update
        FullMath.Uint512 rewardsPerStakingDuration;
        // `_idealPosition` on position's last update
        FullMath.Uint512 idealPosition;
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
    FullMath.Uint512 internal _rewardsPerStakingDuration;

    /**
     * @notice Hypothetical rewards accumulated by an ideal position whose
     * `lastUpdate` equals `initTime`, and `balance` equals one.
     * @dev Refer to `sum of I` in the proof for more details.
     */
    FullMath.Uint512 internal _idealPosition;

    /// @notice Time stamp of first stake event
    uint public initTime;

    /// @notice Total amount of tokens staked in the contract
    uint public totalSupply;

    /// @notice Sum of all active positions' `lastUpdate * balance`
    uint public sumOfEntryTimes;

    event Staked(uint position, uint amount);
    event Exited(uint position, uint amount, uint reward);

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
    function stake(uint amount) external virtual nonReentrant {
        if (totalSupply != 0) {
            _updateRewardVariables();
        } else if (initTime == 0) {
            initTime = block.timestamp;
        }
        _stake(amount, msg.sender);
    }

    /**
     * @notice Exit from a position by withdrawing & harvesting all
     * @param posId The ID of the position to exit from
     */
    function exit(uint posId) external virtual nonReentrant {
        _updateRewardVariables();
        _exit(posId);
    }

    /**
     * @notice Exits from multiple positions by withdrawing all their tokens
     * and harvesting all the rewards
     * @param posIds The list of IDs of the positions to exit from
     */
    function massExit(uint[] calldata posIds) external virtual nonReentrant {
        require(posIds.length <= 20, "SAR::massExit: long array");
        _updateRewardVariables(); // saves gas by updating only once
        for (uint i; i < posIds.length; ++i) _exit(posIds[i]);
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
            FullMath.Uint512 memory x,
            FullMath.Uint512 memory y
        ) = _rewardVariables(rewardRegulator.pendingRewards(address(this)));
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
     * @notice Updates position then withdraws all its tokens
     * @dev It must always be called after `_updateRewardVariables()`
     * @param posId ID of the position to withdraw from
     */
    function _exit(uint posId) internal virtual {
        Position storage position = positions[posId];
        require(position.owner == msg.sender, "SAR::_exit: unauthorized");
        uint amount = position.balance;
        require(amount != 0, "SAR::_exit: zero amount");

        // update global variables
        sumOfEntryTimes -= (position.lastUpdate * amount);
        totalSupply -= amount;

        // remove position from the set of the user
        _userPositions[msg.sender].remove(posId);

        // get earned rewards
        uint reward = _earned(
            posId,
            _idealPosition,
            _rewardsPerStakingDuration
        );

        // disables the position
        delete position.balance;

        // transfer rewards & stake balance to owner
        if (reward != 0) rewardToken.safeTransfer(msg.sender, reward);
        stakingToken.safeTransfer(msg.sender, amount);

        emit Exited(posId, amount, reward);
    }

    /**
     * @notice Creates positions then stakes tokens to it
     * @param amount Amount of tokens to stake
     * @param from The address that will supply the tokens for the position
     */
    function _stake(uint amount, address from) internal virtual {
        require(amount != 0, "SAR::_stake: zero amount");

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
                _rewardsPerStakingDuration,
                _idealPosition
            )
        );

        // add position to the set for interfacing
        _userPositions[msg.sender].add(posId);

        // transfer tokesn from user to the contract
        if (from != address(this))
            stakingToken.safeTransferFrom(from, address(this), amount);
        emit Staked(posId, amount);
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
     * @param idealPosition The sum of ideal position's rewards at a reference
     * time
     * @param rewardsPerStakingDuration The sum of rewards per staking duration
     * at the same reference time
     */
    function _earned(
        uint posId,
        FullMath.Uint512 memory idealPosition,
        FullMath.Uint512 memory rewardsPerStakingDuration
    ) internal view virtual returns (uint) {
        Position memory position = positions[posId];
        if (position.lastUpdate == 0) return 0;
        /*
         * core formula in EQN(7):
         * ( ( sum I from 1 to m - sum I from 1 to n-1 ) -
         * ( sum (R/s) from 1 to m - sum (R/s) from 1 to n-1 )
         * times ( sum t from 1 to n-1 ) ) times y
         */
        return
            idealPosition
                .sub(position.idealPosition)
                .sub(
                    rewardsPerStakingDuration
                        .sub(position.rewardsPerStakingDuration)
                        .mul(position.lastUpdate - initTime)
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
                    (block.timestamp - initTime) * rewards,
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
