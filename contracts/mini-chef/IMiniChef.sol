// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;


interface IMiniChef {

    function poolLength() external view returns (uint256 poolLength);
    function lpTokens() external view;
    function poolInfos() external view;
    function disableMigrator() external;
    function migrate(uint256 _pid) external;
    function pendingReward(uint256 _pid, address _user) external view returns (uint256 pending);
    function deposit(uint256 pid, uint256 amount, address to) external;
    function depositWithPermit(uint256 pid, uint256 amount, address to, uint deadline, uint8 v, bytes32 r, bytes32 s) external;
    function withdraw(uint256 pid, uint256 amount, address to) external;
    function harvest(uint256 pid, address to) external;
    function withdrawAndHarvest(uint256 pid, uint256 amount, address to) external;
    function emergencyWithdraw(uint256 pid, address to) external;
    function addFunder(address _funder) external;
    function removeFunder(address _funder) external;
    function isFunder(address _funder) external view returns (bool allowed);
    function fundRewards(uint256 funding, uint256 duration) external;
    function resetRewardsDuration(uint256 duration) external;
    function extendRewardsViaFunding(uint256 funding, uint256 minExtension) external;
    function extendRewardsViaDuration(uint256 extension, uint256 maxFunding) external;
    function setPool(uint256 _pid, uint256 _allocPoint, address _rewarder, bool overwrite) external;
    function setPools(uint256[] calldata pids, uint256[] calldata allocPoints, address[] calldata rewarders, bool[] calldata overwrites) external;
    function addPools(uint256[] calldata _allocPoints, address[] calldata _lpTokens, address[] calldata _rewarders) external;
    function addPool(uint256 _allocPoint, address _lpToken, address _rewarder) external;
}