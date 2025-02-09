// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.5.0;

/// @title Permissioned pool actions
/// @notice Contains pool methods that may only be called by the factory owner
interface IPangolinV3PoolOwnerActions {
    /// @notice Initialize the pool to set immutable parameters
    /// @param _token0 The first of the two tokens of the pool, sorted by address
    /// @param _token1 The second of the two tokens of the pool, sorted by address
    /// @param _fee The pool's fee in hundredths of a bip, i.e. 1e-6
    /// @param _tickSpacing The pool tick spacing
    function initialize(address _token0, address _token1, uint24 _fee, int24 _tickSpacing) external;

    /// @notice Set the denominator of the protocol's % share of the fees
    /// @param feeProtocol0 new protocol fee for token0 of the pool
    /// @param feeProtocol1 new protocol fee for token1 of the pool
    function setFeeProtocol(uint8 feeProtocol0, uint8 feeProtocol1) external;

    function setFee(uint24 _fee) external;

    /// @notice Collect the protocol fee accrued to the pool
    /// @param recipient The address to which collected protocol fees should be sent
    /// @param amount0Requested The maximum amount of token0 to send, can be 0 to collect fees in only token1
    /// @param amount1Requested The maximum amount of token1 to send, can be 0 to collect fees in only token0
    /// @return amount0 The protocol fee collected in token0
    /// @return amount1 The protocol fee collected in token1
    function collectProtocol(
        address recipient,
        uint128 amount0Requested,
        uint128 amount1Requested
    ) external returns (uint128 amount0, uint128 amount1);

    /// @notice Set the reward rate the active liquidity receives per second
    /// @param rewardPerSecondX48 The new reward rate per second (in Q48)
    /// @param rewardRateEffectiveUntil The timestamp when the new reward rate will expire
    function setRewardRate(uint144 rewardPerSecondX48, uint32 rewardRateEffectiveUntil) external;
}
