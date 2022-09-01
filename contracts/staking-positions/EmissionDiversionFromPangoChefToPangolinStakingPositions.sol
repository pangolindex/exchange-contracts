// SPDX-License-Identifier: GPLv3
pragma solidity 0.8.15;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IPangoChef {
    function claim(uint256 poolId) external returns (uint256 reward);

    function rewardsToken() external view returns (address);

    function addReward(uint256 amount) external;

    function hasRole(bytes32 role, address account) external view returns (bool);
}

/** @author shung for Pangolin */
contract EmissionDiversionFromPangoChefToPangolinStakingPositions {
    IPangoChef public immutable pangoChef;
    IPangoChef public immutable pangolinStakingPositions;
    address public immutable rewardsToken;
    bytes32 private constant FUNDER_ROLE = keccak256("FUNDER_ROLE");

    modifier onlyFunder() {
        require(pangolinStakingPositions.hasRole(FUNDER_ROLE, msg.sender), "unauthorized");
        _;
    }

    constructor(address newPangoChef, address newStakingPositions) {
        require(newPangoChef.code.length != 0, "empty contract");
        address newRewardsToken = IPangoChef(newPangoChef).rewardsToken();
        require(
            newRewardsToken == IPangoChef(newStakingPositions).rewardsToken(),
            "invalid addresses"
        );
        IERC20(newRewardsToken).approve(newStakingPositions, type(uint256).max);
        pangoChef = IPangoChef(newPangoChef);
        pangolinStakingPositions = IPangoChef(newStakingPositions);
        rewardsToken = newRewardsToken;
    }

    function claimAndAddReward(uint256 poolId) external onlyFunder {
        uint256 amount = pangoChef.claim(poolId);
        pangolinStakingPositions.addReward(amount);
    }

    function notifyRewardAmount(uint256 amount) external onlyFunder {
        pangolinStakingPositions.addReward(amount);
    }
}
