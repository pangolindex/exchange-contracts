// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.5.0;

/// @title Callback for IPangolinV2PoolActions#mint
/// @notice Any contract that calls IPangolinV2PoolActions#mint must implement this interface
interface IPangolinV2MintCallback {
    /// @notice Called to `msg.sender` after minting liquidity to a position from IPangolinV2Pool#mint.
    /// @dev In the implementation you must pay the pool tokens owed for the minted liquidity.
    /// The caller of this method must be checked to be a PangolinV2Pool deployed by the canonical PangolinV2Factory.
    /// @param amount0Owed The amount of token0 due to the pool for the minted liquidity
    /// @param amount1Owed The amount of token1 due to the pool for the minted liquidity
    /// @param data Any data passed through by the caller via the IPangolinV2PoolActions#mint call
    function pangolinV2MintCallback(
        uint256 amount0Owed,
        uint256 amount1Owed,
        bytes calldata data
    ) external;
}
