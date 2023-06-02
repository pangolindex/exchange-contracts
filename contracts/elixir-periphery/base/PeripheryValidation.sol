// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity =0.7.6;

abstract contract PeripheryValidation {
    modifier checkDeadline(uint256 deadline) {
        _checkDeadline(deadline);
        _;
    }

    function _checkDeadline(uint256 deadline) private view {
        require(block.timestamp <= deadline, 'Transaction too old');
    }
}
