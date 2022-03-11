pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";

interface ILiquidityPoolManagerV2 {
    function stakes(address pair) external view returns (address);
}

interface IPangolinPair {
    function totalSupply() external view returns (uint);
    function balanceOf(address owner) external view returns (uint);
}

interface IPangolinERC20 {
    function balanceOf(address owner) external view returns (uint);
    function getCurrentVotes(address account) external view returns (uint);
    function delegates(address account) external view returns (address);
}

interface IStakingRewards {
    function rewardsToken() external view returns (address);
    function stakingToken() external view returns (address);
    function balanceOf(address owner) external view returns (uint);
    function earned(address account) external view returns (uint);
}

// SPDX-License-Identifier: GPL-3.0-or-later
contract PangolinVoteCalculator is Ownable {

    IPangolinERC20 png;
    ILiquidityPoolManagerV2 liquidityManager;

    constructor(address _png, address _liquidityManager) {
        png = IPangolinERC20(_png);
        liquidityManager = ILiquidityPoolManagerV2(_liquidityManager);
    }

    function getVotesFromFarming(address voter, address[] calldata farms) external view returns (uint votes) {
        for (uint i; i<farms.length; i++) {
            IPangolinPair pair = IPangolinPair(farms[i]);
            IStakingRewards staking = IStakingRewards(liquidityManager.stakes(farms[i]));

            // Handle pairs that are no longer whitelisted
            if (address(staking) == address(0)) continue;

            uint pair_total_PNG = png.balanceOf(farms[i]);
            uint pair_total_PGL = pair.totalSupply(); // Could initially be 0 in rare situations

            uint PGL_hodling = pair.balanceOf(voter);
            uint PGL_staking = staking.balanceOf(voter);

            uint pending_PNG = staking.earned(voter);

            votes += ((PGL_hodling + PGL_staking) * pair_total_PNG) / pair_total_PGL + pending_PNG;
        }
    }

    function getVotesFromStaking(address voter, address[] calldata stakes) external view returns (uint votes) {
        for (uint i; i<stakes.length; i++) {
            IStakingRewards staking = IStakingRewards(stakes[i]);

            uint staked_PNG = staking.stakingToken() == address(png) ? staking.balanceOf(voter) : uint(0);

            uint pending_PNG = staking.rewardsToken() == address(png) ? staking.earned(voter) : uint(0);

            votes += (staked_PNG + pending_PNG);
        }
    }

    function getVotesFromWallets(address voter) external view returns (uint votes) {
        // Votes delegated to the voter
        votes += png.getCurrentVotes(voter);

        // Voter has never delegated
        if (png.delegates(voter) == address(0)) {
            votes += png.balanceOf(voter);
        }
    }

    function changeLiquidityPoolManager(address _liquidityManager) external onlyOwner {
        liquidityManager = ILiquidityPoolManagerV2(_liquidityManager);
    }

}
