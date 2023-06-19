// SPDX-License-Identifier: GPLv3
pragma solidity 0.8.19;

import "./interfaces/IElixirRewarder.sol";
import "./interfaces/ElixirRewarderTypes.sol";
import "../elixir-core/interfaces/IElixirPool.sol";
import "../elixir-core/interfaces/IElixirFactory.sol";
import "../elixir-periphery/interfaces/IElixirFactoryOwner.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract ElixirRewarder is ReentrancyGuard, Ownable2Step, IElixirRewarder, ElixirRewarderTypes {
    using SafeERC20 for IERC20;

    address public immutable nonfungiblePositionManager;
    address public immutable factory;
    address public defaultRewardManager;

    mapping(address => Farm) public farms;

    constructor(address _positionManager, address _factory) {
        nonfungiblePositionManager = _positionManager;
        factory = _factory;
    }

    function addReward(address pool, uint256 amount, uint256 numOfDays) external nonReentrant {
        Farm storage farm = farms[pool];
        if (msg.sender != farm.manager &&
            msg.sender != defaultRewardManager &&
            msg.sender != owner()
        ) revert NotPrivileged();
        if (numOfDays == 0 || numOfDays > 14) revert InvalidDayRange();

        uint256 balanceBefore = IERC20(farm.rewardToken).balanceOf(address(this));
        IERC20(farm.rewardToken).transferFrom(msg.sender, address(this), amount);
        uint256 balanceAfter = IERC20(farm.rewardToken).balanceOf(address(this));

        amount = balanceAfter - balanceBefore;
        if (amount == 0) revert NoOp();
        if (amount > type(uint112).max) revert Overflow();

        farm.rewardAdded += uint112(amount);

        uint256 duration = numOfDays * 1 days;
        uint256 newEndTime = block.timestamp + duration;
        if (newEndTime > type(uint32).max) revert Overflow();

        uint256 newRewardRate;
        if (block.timestamp >= farm.distributionEndTime) {
            newRewardRate = (amount << 48) / duration;
        } else {
            (uint256 oldRewardRate, ) = IElixirPool(pool).rewardSlot();
            newRewardRate =
                ((amount << 48) + (farm.distributionEndTime - block.timestamp) * oldRewardRate) /
                duration;
        }

        if (newRewardRate == 0) revert NoOp();
        if (newRewardRate > type(uint144).max) revert Overflow();
        farm.distributionEndTime = uint32(newEndTime);

        IElixirFactoryOwner(IElixirFactory(factory).owner()).setRewardRate({
            pool: pool,
            rewardPerSecondX48: uint144(newRewardRate),
            rewardRateEffectiveUntil: uint32(newEndTime)
        });
    }

    function deactivateFarm(address pool) external onlyOwner nonReentrant {
        Farm storage farm = farms[pool];
        if (block.timestamp < farm.distributionEndTime) revert WaitForDistributionToEnd();
        if (!farm.active) revert NoOp();

        farm.deactivationTime = _clampedTimestamp();
        farm.active = false;
        farm.manager = address(0);

        emit FarmDeactivated(pool);
    }

    function cancelDeactivation(address pool) external onlyOwner nonReentrant {
        Farm storage farm = farms[pool];
        if (farm.active || farm.deactivationTime == 0) revert NoOp();

        farm.active = true;

        emit CancelledDeactivation(pool);
    }

    function activateFarm(
        address pool,
        address newRewardToken,
        bool noRevert
    ) external onlyOwner nonReentrant {
        Farm storage farm = farms[pool];
        if (farm.active) revert FarmAlreadyActive();
        if (block.timestamp < farm.deactivationTime + 2 weeks) revert TooEarlyToActivateFarm();
        if (newRewardToken == farm.rewardToken) revert NoOp();

        if (farm.deactivationTime == 0) {
            // first time activation
            farm.rewardToken = newRewardToken;
            farm.active = true;
        } else {
            uint112 rewardDistributed = farm.rewardDistributed;
            uint112 rewardAdded = farm.rewardAdded;
            address oldRewardToken = farm.rewardToken;

            farm.manager = address(0);
            farm.rewardToken = newRewardToken;
            unchecked {
                ++farm.rewardTokenChangeCounter;
            }
            farm.active = true;
            farm.rewardDistributed = 0;
            farm.rewardAdded = 0;

            if (rewardAdded > rewardDistributed) {
                unchecked {
                    uint112 undistributed = rewardAdded - rewardDistributed;
                    if (noRevert) {
                        // use low-level non-reverting assembly for transfer. we have the noRevert
                        // switch, because if this is by default, caller can send insufficient gas
                        // and the undistributed rewards will be locked in the contract. however
                        // we need this option to bypass a malicious rewardToken locking us from
                        // activating the farm.
                        if (gasleft() < 100_000) revert IncreaseGasLimit();
                        bytes memory transferData = abi.encodeWithSelector(
                            IERC20.transfer.selector,
                            owner(),
                            undistributed
                        );
                        assembly {
                            pop(
                                call(
                                    gas(),
                                    oldRewardToken,
                                    0,
                                    add(transferData, 0x20),
                                    mload(transferData),
                                    0,
                                    0
                                )
                            )
                        }
                    } else {
                        IERC20(oldRewardToken).safeTransfer(owner(), undistributed);
                    }
                }
            }
        }

        emit FarmActivated(pool, newRewardToken);
    }

    function _clampedTimestamp() internal view returns (uint32) {
        return block.timestamp > type(uint32).max ? type(uint32).max : uint32(block.timestamp);
    }

    function claimReward(
        address recipient,
        uint256 rewardOwed,
        uint256 tokenId,
        address pool,
        uint32 /* rewardLastUpdated */,
        uint32 /*rewardLastCollected*/
    ) external nonReentrant {
        if (msg.sender != nonfungiblePositionManager) revert NotPrivileged();

        Farm storage farm = farms[pool];
        address userAddress = IERC721(nonfungiblePositionManager).ownerOf(tokenId);
        User storage user = farm.users[userAddress];

        if (user.rewardTokenChangeCounter != farm.rewardTokenChangeCounter) {
            user.rewardTokenChangeCounter = farm.rewardTokenChangeCounter;
            // don't send rewards. community should be notified to claim rewards right before and after a reward token change
        } else {
            if (rewardOwed > type(uint112).max) revert Overflow();
            farm.rewardDistributed += uint112(rewardOwed);
            IERC20(farm.rewardToken).safeTransfer(recipient, rewardOwed);
        }

        emit RewardClaimed(tokenId, pool, userAddress, recipient, rewardOwed);
    }

    function setDefaultRewardManager(address newDefaultRewardManager) external onlyOwner nonReentrant {
        defaultRewardManager = newDefaultRewardManager;
        emit DefaultRewardManagerSet(newDefaultRewardManager);
    }

    function setFarmManager(address pool, address newFarmManager) external onlyOwner nonReentrant {
        Farm storage farm = farms[pool];
        if (!farm.active) revert FarmIsInactive();
        farm.manager = newFarmManager;
        emit FarmManagerSet(pool, newFarmManager);
    }
}
