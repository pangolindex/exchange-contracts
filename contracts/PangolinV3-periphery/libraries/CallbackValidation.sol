// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity =0.7.6;

import '../../PangolinV3-core/interfaces/IPangolinV3Pool.sol';
import './PoolAddress.sol';

/// @notice Provides validation for callbacks from PangolinV3 Pools
library CallbackValidation {
    /// @notice Returns the address of a valid PangolinV3 Pool
    /// @param factory The contract address of the PangolinV3 factory
    /// @param tokenA The contract address of either token0 or token1
    /// @param tokenB The contract address of the other token
    /// @param fee The fee collected upon every swap in the pool, denominated in hundredths of a bip
    /// @return pool The PangolinV3 pool contract address
    function verifyCallback(
        address factory,
        address tokenA,
        address tokenB,
        uint24 fee
    ) internal view returns (IPangolinV3Pool pool) {
        return verifyCallback(factory, PoolAddress.getPoolKey(tokenA, tokenB, fee));
    }

    /// @notice Returns the address of a valid PangolinV3 Pool
    /// @param factory The contract address of the PangolinV3 factory
    /// @param poolKey The identifying key of the PangolinV3 pool
    /// @return pool The Pangoli pool contract address
    function verifyCallback(address factory, PoolAddress.PoolKey memory poolKey)
        internal
        view
        returns (IPangolinV3Pool pool)
    {
        pool = IPangolinV3Pool(PoolAddress.computeAddress(factory, poolKey));
        require(msg.sender == address(pool));
    }
}
