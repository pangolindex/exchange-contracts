// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.5.0;

import './pool/IElixirPoolImmutables.sol';
import './pool/IElixirPoolState.sol';
import './pool/IElixirPoolDerivedState.sol';
import './pool/IElixirPoolActions.sol';
import './pool/IElixirPoolOwnerActions.sol';
import './pool/IElixirPoolEvents.sol';

/// @title The interface for a Elixir Pool
/// @notice A Pangolin pool facilitates swapping and automated market making between any two assets that strictly conform
/// to the ERC20 specification
/// @dev The pool interface is broken up into many smaller pieces
interface IElixirPool is
    IElixirPoolImmutables,
    IElixirPoolState,
    IElixirPoolDerivedState,
    IElixirPoolActions,
    IElixirPoolOwnerActions,
    IElixirPoolEvents
{

}
