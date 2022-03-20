// SPDX-License-Identifier: UNLICENSED
// solhint-disable not-rely-on-time
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface IRewardRegulator {
    function getRewards(address account) external view returns (uint);

    function setRewards() external returns (uint);

    function mint(address to, uint amount) external;

    function rewardToken() external returns (address); // For compound ext.
}

/**
 * @title Sunshine and Rainbows
 * @notice Sunshine and Rainbows is a novel staking algorithm that gives
 * more rewards to users with longer staking durations
 * @dev For a general overview refer to `README.md`. For the proof of the
 * algorithm refer to the proof linked in `README.md`.
 * @author shung for Pangolin & cryptofrens.xyz
 */
contract SunshineAndRainbows is Pausable, Ownable, ReentrancyGuard {
    using EnumerableSet for EnumerableSet.UintSet;
    using SafeERC20 for IERC20;

    struct Position {
        // Amount of claimable rewards of the position
        // It uses `int` instead of `uint` to support LP extension
        int reward;
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

    /// @notice The list of all positions
    mapping(uint => Position) public positions;

    /// @notice A set of all positions of an account used for interfacing
    mapping(address => EnumerableSet.UintSet) internal _userPositions;

    /// @notice The contract that determines the rewards of this contract
    IRewardRegulator public immutable rewardRegulator;

    /// @notice The token that can be staked in the contract
    address public stakingToken;

    /// @notice Total amount of tokens staked in the contract
    uint public totalSupply;

    /// @notice Number of all positions created with the contract
    uint public positionsLength;

    /// @notice Time stamp of first stake event
    uint public initTime;

    /// @notice Sum of all active positions' `lastUpdate * balance`
    uint public sumOfEntryTimes;

    /// @dev Ensure that (1) total emitted rewards will not pass 100 * 10^33,
    /// and (2) reward rate per second to total staked supply ratio will never
    /// fall below 1:3*10^18. The failure of condition (1) could lock the
    /// contract due to overflow, and the failure of condition (2) could be
    /// zero-reward emissions.
    uint private constant PRECISION = 10**30;

    /// @notice Sum of all intervals' (`rewards`/`stakingDuration`)
    /// @dev Refer to `sum of r/S` in the proof for more details.
    uint internal _rewardsPerStakingDuration;

    /// @notice Hypothetical rewards accumulated by an ideal position whose
    /// `lastUpdate` equals `initTime`, and `balance` equals one.
    /// @dev Refer to `sum of I` in the proof for more details.
    uint internal _idealPosition;

    event Harvest(uint position, uint reward);
    event Stake(uint position, uint amount);
    event Withdraw(uint position, uint amount);

    modifier updatePosition(uint posId) {
        Position storage position = positions[posId];
        sumOfEntryTimes -= (position.lastUpdate * position.balance);
        if (position.lastUpdate != block.timestamp) {
            if (position.lastUpdate != 0) {
                position.reward = _earned(
                    posId,
                    _idealPosition,
                    _rewardsPerStakingDuration
                );
                assert(position.reward >= 0);
            }
            position.lastUpdate = block.timestamp;
            position.idealPosition = _idealPosition;
            position.rewardsPerStakingDuration = _rewardsPerStakingDuration;
        }
        _;
        sumOfEntryTimes += (block.timestamp * positions[posId].balance);
    }

    constructor(address _stakingToken, address _rewardRegulator) {
        require(
            _stakingToken != address(0) && _rewardRegulator != address(0),
            "SAR::Constructor: zero address"
        );
        stakingToken = _stakingToken;
        rewardRegulator = IRewardRegulator(_rewardRegulator);
        _pause();
    }

    function resume() external onlyOwner {
        _unpause();
    }

    /// @notice Harvests accumulated rewards of the user
    /// @param posId ID of the position to be harvested from
    function harvest(uint posId) external nonReentrant {
        _updateRewardVariables();
        require(_harvest(posId, msg.sender) != 0, "SAR::harvest: no reward");
    }

    /// @notice Creates a new position and stakes `amount` tokens to it
    /// @param amount Amount of tokens to stake
    /// @param to Owner of the new position
    function stake(uint amount, address to)
        external
        virtual
        nonReentrant
        whenNotPaused
    {
        _updateRewardVariables();
        _stake(_createPosition(to), amount, msg.sender);
    }

    /// @notice Withdraws `amount` tokens from `posId`
    /// @param amount Amount of tokens to withdraw
    /// @param posId ID of the position to withdraw from
    function withdraw(uint amount, uint posId) external virtual nonReentrant {
        _updateRewardVariables();
        _withdraw(amount, posId);
    }

    function massExit(uint[] calldata posIds) external virtual nonReentrant {
        _updateRewardVariables();
        for (uint i; i < posIds.length; ++i) {
            uint posId = posIds[i];
            _withdraw(positions[posId].balance, posId);
            _harvest(posId, msg.sender);
        }
    }

    function pendingRewards(uint posId) external view returns (int) {
        (uint x, uint y) = _rewardVariables(
            rewardRegulator.getRewards(address(this))
        );
        return _earned(posId, x, y);
    }

    function positionsOf(address account)
        external
        view
        returns (uint[] memory)
    {
        return _userPositions[account].values();
    }

    function _withdraw(uint amount, uint posId)
        internal
        virtual
        updatePosition(posId)
    {
        Position storage position = positions[posId];
        address sender = msg.sender;
        require(amount != 0, "SAR::_withdraw: zero amount");
        require(position.owner == sender, "SAR::_withdraw: unauthorized");
        if (position.balance == amount) {
            position.balance = 0;
            _userPositions[sender].remove(posId);
        } else if (position.balance < amount) {
            revert("SAR::_withdraw: insufficient balance");
        } else {
            position.balance -= (position.balance - amount);
        }
        totalSupply -= amount;
        IERC20(stakingToken).safeTransfer(sender, amount);
        emit Withdraw(posId, amount);
    }

    function _stake(
        uint posId,
        uint amount,
        address from
    ) internal virtual updatePosition(posId) {
        require(amount != 0, "SAR::_stake: zero amount");
        if (initTime == 0) {
            initTime = block.timestamp;
        }
        totalSupply += amount;
        positions[posId].balance += amount;
        if (from != address(this)) {
            IERC20(stakingToken).safeTransferFrom(
                msg.sender,
                address(this),
                amount
            );
        }
        emit Stake(posId, amount);
    }

    function _harvest(uint posId, address to)
        internal
        updatePosition(posId)
        returns (uint)
    {
        Position storage position = positions[posId];
        require(position.owner == msg.sender, "SAR::_harvest: unauthorized");
        uint reward = uint(position.reward);
        if (reward != 0) {
            position.reward = 0;
            rewardRegulator.mint(to, reward);
            emit Harvest(posId, reward);
        }
        return reward;
    }

    function _updateRewardVariables() internal {
        if (totalSupply != 0) {
            (_idealPosition, _rewardsPerStakingDuration) = _rewardVariables(
                rewardRegulator.setRewards()
            );
        }
    }

    function _createPosition(address to) internal returns (uint) {
        require(to != address(0), "SAR::_createPosition: bad recipient");
        positionsLength++; // posIds start from 1
        _userPositions[to].add(positionsLength);
        positions[positionsLength].owner = to;
        return positionsLength;
    }

    /// @param posId position id
    /// @return amount of reward tokens the account can harvest
    function _earned(
        uint posId,
        uint idealPosition,
        uint rewardsPerStakingDuration
    ) internal view returns (int) {
        Position memory position = positions[posId];
        if (position.lastUpdate == 0) {
            return 0;
        }
        return
            int(
                ((idealPosition -
                    position.idealPosition -
                    (rewardsPerStakingDuration -
                        position.rewardsPerStakingDuration) *
                    (position.lastUpdate - initTime)) * position.balance) /
                    PRECISION
            ) + position.reward;
    }

    /// @notice Two variables used in per-user APR calculation
    /// @param rewards The rewards of this contract for the last interval
    function _rewardVariables(uint rewards) private view returns (uint, uint) {
        // `stakingDuration` refers to `S` in the proof
        uint stakingDuration = block.timestamp * totalSupply - sumOfEntryTimes;
        if (stakingDuration == 0)
            return (_idealPosition, _rewardsPerStakingDuration);
        return (
            _idealPosition +
                ((block.timestamp - initTime) * rewards * PRECISION) /
                stakingDuration,
            _rewardsPerStakingDuration + (rewards * PRECISION) / stakingDuration
        );
    }
}
