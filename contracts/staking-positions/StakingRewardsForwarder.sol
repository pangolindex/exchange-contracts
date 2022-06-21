// SPDX-License-Identifier: GPLv3
pragma solidity 0.8.15;

interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
}

interface IPangolinPositions {
    function rewardsToken() external view returns (address);

    function addReward(uint256 amount) external;

    function hasRole(bytes32 role, address account) external view returns (bool);
}

/**
 * @author shung for Pangolin
 * @notice A compatibility contract for PangolinStakingPositions, as our FeeCollector (SushiMaker
 * equivalent) expects the staking contract to get funded like the Synthetix’ StakingRewards.
 * It also needs to check `rewardsToken`. So one can simply define this contract as the
 * StakingRewards, allowing FeeCollector to keep funding our new staking contract the usual way.
 */
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
        require(isAuthorized(msg.sender), "unauthorized");
        pangolinPositions.addReward(amount);
    }

    function isAuthorized(address account) public view returns (bool) {
        return account == feeCollector || pangolinPositions.hasRole(FUNDER_ROLE, account);
    }
}
