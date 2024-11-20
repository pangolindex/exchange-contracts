// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.7.5;
pragma abicoder v2;

import './IMulticall.sol';
import './ISelfPermit.sol';
import './IPoolInitializer.sol';

/// @title PangolinV3 Migrator
/// @notice Enables migration of liqudity from Pangolin v1-compatible pairs into PangolinV3 pools
interface IPangolinV3Migrator is IMulticall, ISelfPermit, IPoolInitializer {
    struct MigrateParams {
        address pair; // the Pangolin v1-compatible pair
        uint256 liquidityToMigrate; // expected to be balanceOf(msg.sender)
        uint8 percentageToMigrate; // represented as a numerator over 100
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Min; // must be discounted by percentageToMigrate
        uint256 amount1Min; // must be discounted by percentageToMigrate
        address recipient;
        uint256 deadline;
        bool refundAsETH;
    }

    /// @notice Migrates liquidity to elxir by burning v1 liquidity and minting a new position for PangolinV3
    /// @dev Slippage protection is enforced via `amount{0,1}Min`, which should be a discount of the expected values of
    /// the maximum amount of PangolinV3 liquidity that the v1 liquidity can get. For the special case of migrating to an
    /// out-of-range position, `amount{0,1}Min` may be set to 0, enforcing that the position remains out of range
    /// @param params The params necessary to migrate v1 liquidity, encoded as `MigrateParams` in calldata
    function migrate(MigrateParams calldata params) external;
}
