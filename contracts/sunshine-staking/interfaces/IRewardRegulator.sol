// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IRewardRegulator {
    struct Recipient {
        uint weight;
        uint stash;
        uint rewardPerWeightPaid;
    }

    function pendingRewards(address account) external view returns (uint);

    function rewardRate() external view returns (uint);

    function totalWeight() external view returns (uint);

    function recipients(address account)
        external
        view
        returns (Recipient memory);

    function claim() external returns (uint);

    function rewardToken() external returns (IERC20);
}
