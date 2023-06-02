// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.7.5;
pragma abicoder v2;

/// @title IElixirRewarder - Elixir Rewarder interface
/// @notice ElixirRewarder is the reward manager contract for Elixir. It works with NonfungiblePositionManager.
/// It does not need to do any calculation, and it trusts the amounts notified by NonfungiblePositionManager.
interface IElixirRewarder {
    /// @notice Send `rewardOwed` to the `recipient`
    /// @param recipient The address to which the reward should be sent
    /// rewardOwed The amount of reward the will be sent
    /// tokenId The position token ID for which the reward is being claimed
    /// pool The address of the pool from which the position belongs to, this will determine reward token
    /// rewardLastUpdated The last timestamp when there was an operation on the position
    /// rewardLastCollected The last timestamp when the reward was collected for the position
    function claimReward(
        address recipient,
        uint256 rewardOwed,
        uint256 tokenId,
        address pool,
        uint32 rewardLastUpdated,
        uint32 rewardLastCollected
    ) external;
}
