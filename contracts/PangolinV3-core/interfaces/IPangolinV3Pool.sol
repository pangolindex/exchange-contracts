// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.5.0;

import './pool/IPangolinV3PoolImmutables.sol';
import './pool/IPangolinV3PoolState.sol';
import './pool/IPangolinV3PoolDerivedState.sol';
import './pool/IPangolinV3PoolActions.sol';
import './pool/IPangolinV3PoolOwnerActions.sol';
import './pool/IPangolinV3PoolEvents.sol';

/// @title The interface for a PangolinV3 Pool
/// @notice A Pangolin pool facilitates swapping and automated market making between any two assets that strictly conform
/// to the ERC20 specification
/// @dev The pool interface is broken up into many smaller pieces
interface IPangolinV3Pool is
    IPangolinV3PoolImmutables,
    IPangolinV3PoolState,
    IPangolinV3PoolDerivedState,
    IPangolinV3PoolActions,
    IPangolinV3PoolOwnerActions,
    IPangolinV3PoolEvents
{

}
