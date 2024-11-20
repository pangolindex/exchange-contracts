// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.5.0;

/// @title Callback for IPangolinV3PoolActions#flash
/// @notice Any contract that calls IPangolinV3PoolActions#flash must implement this interface
interface IPangolinV3FlashCallback {
    /// @notice Called to `msg.sender` after transferring to the recipient from IPangolinV3Pool#flash.
    /// @dev In the implementation you must repay the pool the tokens sent by flash plus the computed fee amounts.
    /// The caller of this method must be checked to be a PangolinV3Pool deployed by the canonical PangolinV3Factory.
    /// @param fee0 The fee amount in token0 due to the pool by the end of the flash
    /// @param fee1 The fee amount in token1 due to the pool by the end of the flash
    /// @param data Any data passed through by the caller via the IPangolinV3PoolActions#flash call
    function pangolinv3FlashCallback(
        uint256 fee0,
        uint256 fee1,
        bytes calldata data
    ) external;
}
