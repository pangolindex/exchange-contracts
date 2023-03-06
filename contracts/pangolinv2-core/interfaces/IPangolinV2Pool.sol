// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.5.0;

import './pool/IPangolinV2PoolImmutables.sol';
import './pool/IPangolinV2PoolState.sol';
import './pool/IPangolinV2PoolDerivedState.sol';
import './pool/IPangolinV2PoolActions.sol';
import './pool/IPangolinV2PoolOwnerActions.sol';
import './pool/IPangolinV2PoolEvents.sol';

/// @title The interface for a Pangolin V2 Pool
/// @notice A Pangolin pool facilitates swapping and automated market making between any two assets that strictly conform
/// to the ERC20 specification
/// @dev The pool interface is broken up into many smaller pieces
interface IPangolinV2Pool is
    IPangolinV2PoolImmutables,
    IPangolinV2PoolState,
    IPangolinV2PoolDerivedState,
    IPangolinV2PoolActions,
    IPangolinV2PoolOwnerActions,
    IPangolinV2PoolEvents
{

}
