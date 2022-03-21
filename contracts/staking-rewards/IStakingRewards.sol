// SPDX-License-Identifier: MIT

pragma solidity 0.8.9;

interface IStakingRewards {
    event RewardAdded(uint256 reward);
    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 reward);
    event RewardsDurationUpdated(uint256 newDuration);
    event Recovered(address token, uint256 amount);

    function setRewardsDuration(uint256 _rewardsDuration) external;
    function recoverERC20(address tokenAddress, uint256 tokenAmount) external;
    function notifyRewardAmount(uint256 reward) external;
    function exit() external;
    function getReward() external;
    function transferOwnership(address newOwner) external;
    function owner() external view;
    function rewardsDuration() external view;
    function withdraw(uint256 amount) external;
    function stake(uint256 amount) external;
    function stakeWithPermit(uint256 amount, uint deadline, uint8 v, bytes32 r, bytes32 s) external;
    function getRewardForDuration() external view;
    function earned(address account) external view;
    function rewardPerToken() external view;
    function lastTimeRewardApplicable() external view;
    function balanceOf(address account) external view;
    function totalSupply() external view;
    function rewardsToken() external view returns (address);

}