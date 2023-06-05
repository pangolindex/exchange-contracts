// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.7.5;

/// @title IElixirRewarder - Elixir Rewarder interface
/// @notice ElixirRewarder is the reward manager contract for Elixir. It works with
/// NonfungiblePositionManager. It does not do any reward calculation, and it trusts the amounts
/// notified by NonfungiblePositionManager.
interface IElixirRewarder {
    /// @notice Get the NonfungiblePositionManager address
    /// @return NonfungiblePositionManager address
    function nonfungiblePositionManager() external view returns (address);

    /// @notice Get the ElixirFactory address
    /// @return ElixirFactory address
    function factory() external view returns (address);

    /// @notice Get the default farm manager address
    /// @return The default manager address that can add rewards for any farm
    function defaultRewardManager() external view returns (address);

    /// @notice Send `rewardOwed` to the `recipient`
    /// @param recipient The address to which the reward should be sent
    /// @param rewardOwed The amount of reward the will be sent
    /// @param tokenId The position token ID for which the reward is being claimed
    /// @param pool The address of the pool from which the position belongs to, this will determine reward token
    /// @param rewardLastUpdated The last timestamp when there was an operation on the position
    /// @param rewardLastCollected The last timestamp when the reward was collected for the position
    function claimReward(
        address recipient,
        uint256 rewardOwed,
        uint256 tokenId,
        address pool,
        uint32 rewardLastUpdated,
        uint32 rewardLastCollected
    ) external;

    /// @notice Add reward to the pool for duration.
    /// @param pool The Elixir Pool address to send the rewards to.
    /// @param amount The amount of rewards to add.
    /// @param numOfDays The day count for which the rewards will last for.
    function addReward(address pool, uint256 amount, uint256 numOfDays) external;

    /// @notice Initiate deactivation of the farm to change its reward token.
    /// @param pool The Elixir Pool address to deactivate the farm form.
    function deactivateFarm(address pool) external;

    /// @notice Cancel the farm deactivation.
    /// @param pool The Elixir Pool address to cancel the deactivation of.
    function cancelDeactivation(address pool) external;

    /// @notice Activate the farm for a pool.
    /// @param pool The Elixir Pool address to create a farm for.
    /// @param newRewardToken The token that will be used for liquidity rewards.
    /// @param noRevert Whether to revert on failed transfer for recovering undistributed tokens.
    function activateFarm(
        address pool,
        address newRewardToken,
        bool noRevert
    ) external;

    /// @notice Set a manager for a farm.
    /// @param pool The Elixir Pool address to set the farm manager for.
    /// @param newFarmManager The address that will be able to add rewards for a farm.
    function setFarmManager(address pool, address newFarmManager) external;
}
