// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IRewardRegulator {
    function pendingRewards(address account) external view returns (uint);

    function rewardRate() external view returns (uint);

    function claim() external returns (uint);

    function rewardToken() external returns (IERC20);
}
