// SPDX-License-Identifier: GPLv3
pragma solidity ^0.8.0;

interface IPangolinFactory {
    function getPair(address tokenA, address tokenB) external view returns (address pair);
}
