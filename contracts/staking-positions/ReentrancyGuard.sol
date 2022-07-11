// SPDX-License-Identifier: AGPLv3
pragma solidity ^0.8.0;

/**
 * @title ReentrancyGuard
 * @author Shung for Pangolin
 * @author Modified from Solmate
 *         (https://github.com/Rari-Capital/solmate/blob/main/src/utils/ReentrancyGuard.sol)
 */
abstract contract ReentrancyGuard {
    uint256 private locked = 1;

    error Reentrancy();

    function _notEntered() internal view {
        if (locked == 2) revert Reentrancy();
    }

    modifier nonReentrant() {
        _notEntered();
        locked = 2;
        _;
        locked = 1;
    }

    modifier notEntered() {
        _notEntered();
        _;
    }
}
