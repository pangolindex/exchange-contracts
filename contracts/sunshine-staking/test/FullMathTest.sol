// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "../libraries/FullMath.sol";

contract FullMathTest {
    using FullMath for FullMath.Uint512;

    FullMath.Uint512 public testValue;
    uint256 public testValue2;

    function add(FullMath.Uint512 memory a, FullMath.Uint512 memory b) external {
        testValue = a.add(b);
    }

    function sub(FullMath.Uint512 memory a, FullMath.Uint512 memory b) external {
        testValue = a.sub(b);
    }

    function mul256(uint a, uint b) external {
        testValue = FullMath.mul(a, b);
    }

    function mul512(FullMath.Uint512 memory a, uint b) external {
        testValue = a.mul(b);
    }

    function div256(uint a) external {
        testValue = FullMath.div256(a);
    }

    function shiftToUint256(FullMath.Uint512 memory a) external {
        testValue2 = a.shiftToUint256();
    }
}
