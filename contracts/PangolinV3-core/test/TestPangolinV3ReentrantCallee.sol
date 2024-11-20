// SPDX-License-Identifier: UNLICENSED
pragma solidity =0.7.6;

import "../libraries/TickMath.sol";

import "../interfaces/callback/IPangolinV3SwapCallback.sol";

import "../interfaces/IPangolinV3Pool.sol";

contract TestPangolinV3ReentrantCallee is IPangolinV3SwapCallback {
    string private constant expectedReason = "LOK";

    function swapToReenter(address pool) external {
        IPangolinV3Pool(pool).swap(
            address(0),
            false,
            1,
            TickMath.MAX_SQRT_RATIO - 1,
            new bytes(0)
        );
    }

    function pangolinv3SwapCallback(
        int256,
        int256,
        bytes calldata
    ) external override {
        // try to reenter swap
        try
            IPangolinV3Pool(msg.sender).swap(address(0), false, 1, 0, new bytes(0))
        {} catch Error(string memory reason) {
            require(
                keccak256(abi.encode(reason)) ==
                    keccak256(abi.encode(expectedReason))
            );
        }

        // try to reenter mint
        try
            IPangolinV3Pool(msg.sender).mint(address(0), 0, 0, 0, new bytes(0))
        {} catch Error(string memory reason) {
            require(
                keccak256(abi.encode(reason)) ==
                    keccak256(abi.encode(expectedReason))
            );
        }

        // try to reenter collect
        try
            IPangolinV3Pool(msg.sender).collect(address(0), 0, 0, 0, 0)
        {} catch Error(string memory reason) {
            require(
                keccak256(abi.encode(reason)) ==
                    keccak256(abi.encode(expectedReason))
            );
        }

        // try to reenter burn
        try IPangolinV3Pool(msg.sender).burn(0, 0, 0) {} catch Error(
            string memory reason
        ) {
            require(
                keccak256(abi.encode(reason)) ==
                    keccak256(abi.encode(expectedReason))
            );
        }

        // try to reenter flash
        try
            IPangolinV3Pool(msg.sender).flash(address(0), 0, 0, new bytes(0))
        {} catch Error(string memory reason) {
            require(
                keccak256(abi.encode(reason)) ==
                    keccak256(abi.encode(expectedReason))
            );
        }

        // try to reenter collectProtocol
        try
            IPangolinV3Pool(msg.sender).collectProtocol(address(0), 0, 0)
        {} catch Error(string memory reason) {
            require(
                keccak256(abi.encode(reason)) ==
                    keccak256(abi.encode(expectedReason))
            );
        }

        require(false, "Unable to reenter");
    }
}
