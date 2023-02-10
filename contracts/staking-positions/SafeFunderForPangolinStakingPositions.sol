// SPDX-License-Identifier: GPLv3
pragma solidity 0.8.15;

import "@openzeppelin/contracts/access/AccessControlEnumerable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./EmissionDiversionFromPangoChefToPangolinStakingPositions.sol";
import "./PangolinStakingPositionsFunding.sol";

/**
 * @author shung for Pangolin
 * @dev Old versions of PangolinStakingPositions deployed on Hedera, Flare, and Songbird have
 * an overflow bug in an intermediate operation:
 * https://github.com/pangolindex/exchange-contracts/blob/aef18133b7dd8a990de3a80263a865e14b53cec0/contracts/staking-positions/PangolinStakingPositionsFunding.sol#L141
 * For those versions, this contract should be given the sole `FUNDER_ROLE` of
 * PangolinStakingPositions to prevent the overflow. `FUNDER_ROLE` of this contract should be
 * used to give funding access to anyone else.
 */
contract SafeFunderForPangolinStakingPositions is AccessControlEnumerable {
    EmissionDiversionFromPangoChefToPangolinStakingPositions public immutable diverter;
    PangolinStakingPositionsFunding public immutable pangolinStakingPositions;

    bytes32 public constant FUNDER_ROLE = keccak256("FUNDER_ROLE");

    modifier whenNotOverflowing() {
        uint256 rewardRate = pangolinStakingPositions.rewardRate();
        uint256 lastUpdate = pangolinStakingPositions.lastUpdate();
        uint256 periodFinish = pangolinStakingPositions.periodFinish();

        if (periodFinish > lastUpdate) {
            uint256 leftover = (periodFinish - lastUpdate) * rewardRate;
            require(leftover <= type(uint80).max, "OVERFLOW");
        }
        _;
    }

    constructor(EmissionDiversionFromPangoChefToPangolinStakingPositions newDiverter) {
        address newPangolinStakingPositions = address(newDiverter.pangolinStakingPositions());
        diverter = newDiverter;
        pangolinStakingPositions = PangolinStakingPositionsFunding(newPangolinStakingPositions);

        IERC20 rewardsToken = IERC20(pangolinStakingPositions.rewardsToken());
        rewardsToken.approve(newPangolinStakingPositions, type(uint256).max);

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    function claimAndAddRewardUsingDiverter(
        uint256 poolId
    ) external whenNotOverflowing onlyRole(FUNDER_ROLE) {
        diverter.claimAndAddReward(poolId);
    }

    function notifyRewardAmountUsingDiverter(
        uint256 amount
    ) external whenNotOverflowing onlyRole(FUNDER_ROLE) {
        diverter.notifyRewardAmount(amount);
    }

    function notifyRewardAmount(uint256 amount) external whenNotOverflowing onlyRole(FUNDER_ROLE) {
        pangolinStakingPositions.addReward(amount);
    }
}
