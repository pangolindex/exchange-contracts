// SPDX-License-Identifier: GPLv3
pragma solidity 0.8.13;

interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
}

interface IPangolinPositions {
    function rewardsToken() external view returns (address);

    function addReward(uint256 amount) external;

    function hasRole(bytes32 role, address account) external view returns (bool);
}

/// @notice Compatibility contract between FeeCollector and PangolinStakingPositions.
contract StakingRewardsForwarder {
    IPangolinPositions public immutable pangolinPositions;
    address public immutable feeCollector;
    address public immutable rewardsToken;
    bytes32 private constant FUNDER_ROLE = keccak256("FUNDER_ROLE");

    constructor(address newPangolinPositions, address newFeeCollector) {
        address newRewardsToken = IPangolinPositions(newPangolinPositions).rewardsToken();
        IERC20(newRewardsToken).approve(newPangolinPositions, type(uint256).max);
        pangolinPositions = IPangolinPositions(newPangolinPositions);
        feeCollector = newFeeCollector;
        rewardsToken = newRewardsToken;
    }

    function notifyRewardAmount(uint256 amount) external {
        require(msg.sender == feeCollector || isAuthorized(msg.sender), "unauthorized");
        pangolinPositions.addReward(amount);
    }

    function isAuthorized(address account) public view returns (bool) {
        return pangolinPositions.hasRole(FUNDER_ROLE, account);
    }
}
